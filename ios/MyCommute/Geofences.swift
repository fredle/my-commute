import ActivityKit
import CoreLocation
import Foundation

/// Geofences around home, work and both stations. iOS wakes the app when you cross
/// one, even if it isn't running, and the server moves the commute on (left home, at
/// the station, on the train, arrived). No continuous GPS, so it's light on battery.
@MainActor
final class Geofences: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = Geofences()

    enum Region: String, CaseIterable {
        case home, work, homeStation, workStation

        var radius: CLLocationDistance {
            switch self {
            case .home, .work: return 150
            case .homeStation, .workStation: return 250
            }
        }
    }

    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined
    private let manager = CLLocationManager()
    private var monitor: CLMonitor?
    private var oneShot: [CheckedContinuation<CLLocation?, Never>] = []
    /// CLMonitor keeps its regions across launches, so this is kept too. Re-adding them on
    /// every launch would reset them, and could drop the event that woke the app.
    private var monitoredKey: String? {
        get { UserDefaults.standard.string(forKey: "geofenceKey") }
        set { UserDefaults.standard.set(newValue, forKey: "geofenceKey") }
    }

    override private init() {
        super.init()
        authorization = manager.authorizationStatus
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var hasAlways: Bool { authorization == .authorizedAlways }

    /// iOS asks "While Using" first and offers "Always" later; both prompts come from this.
    func requestAlways() {
        if authorization == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if authorization == .authorizedWhenInUse {
            manager.requestAlwaysAuthorization()
        }
    }

    /// Called at every launch, including background launches for a geofence event.
    func start() {
        guard monitor == nil else { return }
        Task {
            let monitor = await CLMonitor("commute")
            self.monitor = monitor
            await update(ConfigStore.shared.config)
            do {
                for try await event in await monitor.events {
                    await handle(event)
                }
            } catch {
                self.monitor = nil
            }
        }
    }

    func update(_ config: CommuteConfig) async {
        guard let monitor else { return }
        let places: [(Region, CLLocationCoordinate2D?)] = [
            (.home, config.home?.coordinate),
            (.work, config.work?.coordinate),
            (.homeStation, config.homeStation?.coordinate),
            (.workStation, config.workStation?.coordinate),
        ]
        // Re-adding a region resets it, so only do it when a place actually moved.
        let key = places.map { "\($0.1?.latitude ?? 0),\($0.1?.longitude ?? 0)" }.joined(separator: ";")
        guard key != monitoredKey else { return }
        monitoredKey = key
        for (region, coordinate) in places {
            await monitor.remove(region.rawValue)
            guard let coordinate else { continue }
            let condition = CLMonitor.CircularGeographicCondition(center: coordinate, radius: region.radius)
            await monitor.add(condition, identifier: region.rawValue)
        }
    }

    private func handle(_ event: CLMonitor.Event) async {
        guard let region = Region(rawValue: event.identifier) else { return }
        let entered: Bool
        switch event.state {
        case .satisfied: entered = true
        case .unsatisfied: entered = false
        default: return
        }
        // Only a running commute cares; the server ignores moves that don't fit its stage.
        guard let activity = Activity<CommuteAttributes>.activities.first(where: { $0.activityState == .active }) else { return }
        _ = try? await Backend.reportRegion(commuteId: activity.attributes.commuteId, region: region.rawValue, entered: entered)
    }

    /// A single fix, for "use my current location".
    func currentLocation() async -> CLLocation? {
        if authorization == .notDetermined {
            manager.requestWhenInUseAuthorization()
            for _ in 0..<60 where authorization == .notDetermined {
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        guard authorization == .authorizedWhenInUse || authorization == .authorizedAlways else { return nil }
        return await withCheckedContinuation { continuation in
            oneShot.append(continuation)
            manager.requestLocation()
        }
    }

    private func resolve(_ location: CLLocation?) {
        let waiting = oneShot
        oneShot = []
        for c in waiting { c.resume(returning: location) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.authorization = status }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        Task { @MainActor in self.resolve(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.resolve(nil) }
    }
}
