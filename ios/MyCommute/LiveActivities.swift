import ActivityKit
import Foundation

/// Watches this app's Live Activities and hands their push tokens to the server, which
/// is the only thing that writes their content. Scheduled commutes are started by the
/// server (push-to-start); the system then wakes the app here to collect the token.
@MainActor
final class LiveActivities: ObservableObject {
    static let shared = LiveActivities()

    @Published private(set) var current: Activity<CommuteAttributes>?
    @Published private(set) var message: String?

    private var tracked: Set<String> = []
    private var observing = false

    var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func observe() {
        guard !observing else { return }
        observing = true

        Task {
            for await data in Activity<CommuteAttributes>.pushToStartTokenUpdates {
                ConfigStore.shared.pushToStartToken = data.hex
            }
        }
        Task {
            for await activity in Activity<CommuteAttributes>.activityUpdates {
                track(activity)
            }
        }
        for activity in Activity<CommuteAttributes>.activities where activity.activityState == .active {
            track(activity)
        }
    }

    private func track(_ activity: Activity<CommuteAttributes>) {
        guard !tracked.contains(activity.id) else { return }
        tracked.insert(activity.id)
        current = activity
        let commuteId = activity.attributes.commuteId

        Task {
            for await token in activity.pushTokenUpdates {
                try? await Backend.setActivityToken(commuteId: commuteId, token: token.hex)
            }
        }
        Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard state == .dismissed || state == .ended else { continue }
                // Swiping it away means "stop": tell the server so it stops pushing.
                if state == .dismissed { try? await Backend.endCommute(commuteId: commuteId) }
                if self?.current?.id == activity.id { self?.current = nil }
                return
            }
        }
    }

    /// Start now (button, Shortcut or Siri). The server works out the first state.
    func start(_ direction: CommuteDirection) async {
        guard enabled else {
            message = "Live Activities are off for this app. Turn them on in Settings › \(Self.appName) › Live Activities."
            return
        }
        message = nil
        do {
            let started = try await Backend.startCommute(direction)
            for old in Activity<CommuteAttributes>.activities {
                await old.end(nil, dismissalPolicy: .immediate)
            }
            let activity = try Activity.request(
                attributes: started.activityAttributes,
                content: .init(state: started.state, staleDate: Date().addingTimeInterval(10 * 60)),
                pushType: .token
            )
            track(activity)
        } catch {
            message = "Couldn't start: \(error.localizedDescription)"
        }
    }

    func stop() async {
        for activity in Activity<CommuteAttributes>.activities {
            try? await Backend.endCommute(commuteId: activity.attributes.commuteId)
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        current = nil
    }

    static var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "this app"
    }
}
