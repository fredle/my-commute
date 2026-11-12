import ActivityKit
import CoreLocation
import Foundation

/// Runs one commute: starts the Live Activity, then refreshes it every couple of
/// minutes until you arrive. Background location keeps the app running meanwhile.
@MainActor
final class CommuteEngine: ObservableObject {
    static let shared = CommuteEngine()

    static let hayes = CLLocationCoordinate2D(latitude: 51.503096, longitude: -0.420683)
    static let liverpoolStreet = CLLocationCoordinate2D(latitude: 51.5178, longitude: -0.0823)

    private static let refreshSeconds = 120.0
    private static let maxMorning = 3.0 * 3600
    private static let maxEvening = 5.0 * 3600

    @Published private(set) var direction: CommuteDirection?
    @Published private(set) var state: CommuteAttributes.ContentState?
    @Published private(set) var message: String?

    private var activity: Activity<CommuteAttributes>?
    private var loop: Task<Void, Never>?
    private var startedAt = Date()
    private var lastPush = Date.distantPast
    private let location = LocationService.shared
    private let settings = Settings.shared

    var isRunning: Bool { direction != nil }

    func start(_ dir: CommuteDirection) async {
        await stop()
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            message = "Live Activities are off for this app. Turn them on in Settings › My Commute."
            return
        }
        message = nil
        startedAt = Date()
        location.start()
        direction = dir

        let first = await compute(dir)
        state = first
        do {
            activity = try Activity.request(
                attributes: CommuteAttributes(direction: dir),
                content: .init(state: first, staleDate: staleDate()),
                pushType: nil
            )
            lastPush = Date()
        } catch {
            message = "Couldn't start the Live Activity: \(error.localizedDescription)"
            location.stop()
            direction = nil
            state = nil
            return
        }

        loop = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Self.refreshSeconds))
                guard !Task.isCancelled, let self else { return }
                await self.tick()
            }
        }
    }

    func stop() async {
        loop?.cancel()
        loop = nil
        location.stop()
        let finished = activity
        activity = nil
        direction = nil
        state = nil
        await finished?.end(nil, dismissalPolicy: .immediate)
    }

    /// End any Live Activity left behind by a run that was killed.
    func endStale() async {
        guard !isRunning else { return }
        for leftover in Activity<CommuteAttributes>.activities {
            await leftover.end(nil, dismissalPolicy: .immediate)
        }
    }

    private func staleDate() -> Date { Date().addingTimeInterval(10 * 60) }

    private func tick() async {
        guard let dir = direction, let activity else { return }
        if activity.activityState != .active || shouldFinish(dir) {
            await stop()
            return
        }
        let fresh = await compute(dir)
        state = fresh
        var comparable = fresh
        comparable.updated = activity.content.state.updated
        if comparable != activity.content.state || Date().timeIntervalSince(lastPush) > 300 {
            await activity.update(.init(state: fresh, staleDate: staleDate()))
            lastPush = Date()
        }
    }

    private func shouldFinish(_ dir: CommuteDirection) -> Bool {
        let elapsed = Date().timeIntervalSince(startedAt)
        let loc = location.latest
        switch dir {
        case .toLondon:
            if elapsed > Self.maxMorning { return true }
            guard let loc else { return false }
            return loc.distance(from: CLLocation(coordinate: Self.liverpoolStreet)) < 1500
        case .home:
            if elapsed > Self.maxEvening { return true }
            guard let loc, let home = settings.home, elapsed > 120 else { return false }
            return loc.distance(from: CLLocation(coordinate: home)) < 400
        }
    }

    private func compute(_ dir: CommuteDirection) async -> CommuteAttributes.ContentState {
        let now = Date()
        var stage = CommuteStage.normal
        var wantTrains = true
        var driveFrom: CLLocationCoordinate2D?
        var driveTo: CLLocationCoordinate2D?
        let route: (TfL.Station, TfL.Station)

        switch dir {
        case .toLondon:
            route = (.hayes, .lst)
            driveFrom = settings.home
            driveTo = Self.hayes
        case .home:
            route = (.lst, .hayes)
            driveFrom = Self.hayes
            driveTo = settings.home
            if let loc = location.latest {
                let inLondon = loc.distance(from: CLLocation(coordinate: Self.liverpoolStreet)) <= settings.londonRadiusKm * 1000
                if !inLondon {
                    // On the train until you're at (or west of) Hayes, then driving.
                    let atOrPastHayes = loc.coordinate.longitude <= Self.hayes.longitude
                        || loc.distance(from: CLLocation(coordinate: Self.hayes)) < 1500
                    stage = atOrPastHayes ? .driving : .onTrain
                    wantTrains = false
                    if atOrPastHayes { driveFrom = loc.coordinate }
                }
            }
        }

        let from = driveFrom, to = driveTo, trainsWanted = wantTrains
        async let trainResult: TfL.Snapshot? = trainsWanted ? (try? await TfL.snapshot(from: route.0, to: route.1, now: now)) : nil
        async let driveResult: Int? = (from != nil && to != nil) ? (try? await DriveTime.minutes(from: from!, to: to!)) : nil
        let (train, drive) = await (trainResult, driveResult)

        return CommuteLogic.makeState(
            train: train,
            driveMinutes: drive,
            usualDrive: dir == .toLondon ? settings.usualDriveAm : settings.usualDrivePm,
            slowBy: settings.driveSlowBy,
            now: now,
            stage: stage
        )
    }
}

private extension CLLocation {
    convenience init(coordinate: CLLocationCoordinate2D) {
        self.init(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}
