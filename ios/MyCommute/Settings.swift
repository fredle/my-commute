import CoreLocation
import Foundation

/// User settings, kept in UserDefaults. Defaults match the old live-activities service.
final class Settings: ObservableObject {
    static let shared = Settings()
    private let defaults = UserDefaults.standard

    /// 0, 0 means "not set yet".
    @Published var homeLat: Double { didSet { defaults.set(homeLat, forKey: "homeLat") } }
    @Published var homeLon: Double { didSet { defaults.set(homeLon, forKey: "homeLon") } }
    /// Minutes the drive normally takes: home to Hayes (morning) and Hayes to home (evening).
    @Published var usualDriveAm: Int { didSet { defaults.set(usualDriveAm, forKey: "usualDriveAm") } }
    @Published var usualDrivePm: Int { didSet { defaults.set(usualDrivePm, forKey: "usualDrivePm") } }
    /// A drive this many minutes over the usual counts as a problem.
    @Published var driveSlowBy: Int { didSet { defaults.set(driveSlowBy, forKey: "driveSlowBy") } }

    /// Within this distance of Liverpool Street you count as "in London".
    let londonRadiusKm = 12.0

    private init() {
        func int(_ key: String, _ fallback: Int) -> Int {
            UserDefaults.standard.object(forKey: key) as? Int ?? fallback
        }
        homeLat = UserDefaults.standard.double(forKey: "homeLat")
        homeLon = UserDefaults.standard.double(forKey: "homeLon")
        usualDriveAm = int("usualDriveAm", 40)
        usualDrivePm = int("usualDrivePm", 36)
        driveSlowBy = int("driveSlowBy", 10)
    }

    var home: CLLocationCoordinate2D? {
        homeLat == 0 && homeLon == 0 ? nil : CLLocationCoordinate2D(latitude: homeLat, longitude: homeLon)
    }

    func setHome(_ coordinate: CLLocationCoordinate2D) {
        homeLat = coordinate.latitude
        homeLon = coordinate.longitude
    }
}
