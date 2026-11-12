import CoreLocation
import Foundation

struct Place: Codable, Equatable {
    var name: String
    var latitude: Double
    var longitude: Double

    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
}

struct Station: Codable, Hashable, Identifiable {
    /// CRS code for National Rail ("HAY"), NaPTAN id for the Tube and DLR ("940GZZLUOXC").
    var id: String
    var name: String
    var lat: Double
    var lon: Double
    /// "nr" or "tfl".
    var network: String

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lon) }
    var networkName: String { network == "nr" ? "National Rail" : "Tube / DLR" }
}

/// One day of the week: whether to commute, and when to start each Live Activity.
struct DayPlan: Codable, Equatable, Identifiable {
    /// 1 = Monday … 7 = Sunday.
    var day: Int
    var enabled: Bool
    /// Minutes after midnight.
    var toWork: Int
    var toHome: Int

    var id: Int { day }

    var name: String {
        // Calendar weekday symbols start on Sunday.
        Calendar.current.weekdaySymbols[day % 7]
    }
}

enum BankHolidayRegion: String, Codable, CaseIterable, Identifiable {
    case englandAndWales = "england-and-wales"
    case scotland
    case northernIreland = "northern-ireland"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .englandAndWales: return "England and Wales"
        case .scotland: return "Scotland"
        case .northernIreland: return "Northern Ireland"
        }
    }
}

/// Everything the user sets up. Home and work stay on the phone (for geofences); only a
/// rounded home location goes to the server, for drive times.
struct CommuteConfig: Codable, Equatable {
    var home: Place?
    var work: Place?
    var homeStation: Station?
    var workStation: Station?
    var week: [DayPlan] = (1...7).map { DayPlan(day: $0, enabled: $0 <= 5, toWork: 7 * 60, toHome: 17 * 60 + 30) }
    var slowDriveMinutes = 10
    var walkMinutes = 8
    var skipBankHolidays = true
    var bankHolidayRegion = BankHolidayRegion.englandAndWales
    /// No scheduled commutes up to and including this day.
    var pausedUntil: Date?

    var isComplete: Bool { home != nil && work != nil && homeStation != nil && workStation != nil }

    var isPaused: Bool {
        guard let pausedUntil else { return false }
        return Calendar.current.startOfDay(for: Date()) <= Calendar.current.startOfDay(for: pausedUntil)
    }

    /// The next scheduled start after `date`, skipping a pause (bank holidays are the server's job).
    func nextStart(after date: Date = Date()) -> (date: Date, direction: CommuteDirection)? {
        let cal = Calendar.current
        for offset in 0..<15 {
            guard let day = cal.date(byAdding: .day, value: offset, to: cal.startOfDay(for: date)) else { continue }
            if let pausedUntil, day <= cal.startOfDay(for: pausedUntil) { continue }
            let weekday = (cal.component(.weekday, from: day) + 5) % 7 + 1 // Monday = 1
            guard let plan = week.first(where: { $0.day == weekday }), plan.enabled else { continue }
            for (minutes, direction) in [(plan.toWork, CommuteDirection.toWork), (plan.toHome, .toHome)] {
                if let start = cal.date(byAdding: .minute, value: minutes, to: day), start > date {
                    return (start, direction)
                }
            }
        }
        return nil
    }
}

/// What the server is told (server/src/validate.ts checks it).
struct ServerConfig: Encodable {
    struct Coordinate: Encodable { var lat: Double; var lon: Double }
    struct Entry: Encodable { var day: Int; var direction: CommuteDirection; var start: String }

    var timeZone: String
    var home: Coordinate?
    var homeStation: Station?
    var workStation: Station?
    var schedule: [Entry]
    var slowDriveMinutes: Int
    var walkMinutes: Int
    var skipBankHolidays: Bool
    var bankHolidayRegion: String
    var pausedUntil: String?
    var pushToStartToken: String?
    var apnsEnvironment: String

    init(_ config: CommuteConfig, pushToStartToken: String?) {
        timeZone = TimeZone.current.identifier
        // About 100 m: plenty for a drive time, and not your front door.
        home = config.home.map {
            Coordinate(lat: ($0.latitude * 1000).rounded() / 1000, lon: ($0.longitude * 1000).rounded() / 1000)
        }
        homeStation = config.homeStation
        workStation = config.workStation
        schedule = config.week.filter(\.enabled).flatMap { plan in
            [
                Entry(day: plan.day, direction: .toWork, start: Self.clock(plan.toWork)),
                Entry(day: plan.day, direction: .toHome, start: Self.clock(plan.toHome)),
            ]
        }
        slowDriveMinutes = config.slowDriveMinutes
        walkMinutes = config.walkMinutes
        skipBankHolidays = config.skipBankHolidays
        bankHolidayRegion = config.bankHolidayRegion.rawValue
        pausedUntil = config.pausedUntil.map { Self.isoDay($0) }
        self.pushToStartToken = pushToStartToken
        #if DEBUG
        apnsEnvironment = "sandbox"
        #else
        apnsEnvironment = "production"
        #endif
    }

    static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

    static func isoDay(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// Keeps the configuration on the phone and in step with the server.
@MainActor
final class ConfigStore: ObservableObject {
    static let shared = ConfigStore()

    @Published var config: CommuteConfig {
        didSet {
            guard config != oldValue else { return }
            save()
            Task { await Geofences.shared.update(config) }
            scheduleSync()
        }
    }

    /// Lets the server start Live Activities by push. Arrives from ActivityKit at launch.
    var pushToStartToken: String? {
        didSet {
            guard pushToStartToken != oldValue else { return }
            UserDefaults.standard.set(pushToStartToken, forKey: Self.tokenKey)
            scheduleSync()
        }
    }

    @Published private(set) var syncError: String?

    private static let configKey = "commuteConfig"
    private static let tokenKey = "pushToStartToken"
    private var syncTask: Task<Void, Never>?

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.configKey),
           let saved = try? JSONDecoder().decode(CommuteConfig.self, from: data) {
            config = saved
        } else {
            config = CommuteConfig()
        }
        pushToStartToken = UserDefaults.standard.string(forKey: Self.tokenKey)
    }

    private func save() {
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: Self.configKey)
        }
    }

    /// Settings change a field at a time; send them once they settle.
    private func scheduleSync() {
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            await sync()
        }
    }

    func sync() async {
        guard config.isComplete else { return }
        do {
            try await Backend.putConfig(ServerConfig(config, pushToStartToken: pushToStartToken))
            syncError = nil
        } catch {
            syncError = "Couldn't reach the server, so scheduled alerts may be out of date. \(error.localizedDescription)"
        }
    }

    /// Forget everything, here and on the server.
    func eraseAll() async throws {
        try await Backend.deleteMe()
        syncTask?.cancel()
        UserDefaults.standard.removeObject(forKey: Self.configKey)
        Backend.forgetIdentity()
        config = CommuteConfig()
    }
}
