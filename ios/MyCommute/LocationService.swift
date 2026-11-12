import CoreLocation
import Foundation

/// Keeps the app running in the background during a commute (so the Live Activity
/// can be refreshed) and tells us where you are. Used from the main thread only.
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    private let manager = CLLocationManager()
    private var waiters: [CheckedContinuation<CLLocation?, Never>] = []
    private(set) var latest: CLLocation?

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
        manager.activityType = .otherNavigation
    }

    private var authorised: Bool {
        manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
    }

    /// Start continuous updates, which also keep the app alive in the background.
    func start() {
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    /// A recent fix, asking for permission and a one-off reading if needed.
    func currentLocation() async -> CLLocation? {
        if let latest, Date().timeIntervalSince(latest.timestamp) < 60 { return latest }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
            for _ in 0..<60 where manager.authorizationStatus == .notDetermined {
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        guard authorised else { return nil }
        return await withCheckedContinuation { continuation in
            waiters.append(continuation)
            manager.requestLocation()
        }
    }

    private func resolveWaiters(_ location: CLLocation?) {
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(returning: location) }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let last = locations.last { latest = last }
        resolveWaiters(locations.last)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        resolveWaiters(nil)
    }
}
