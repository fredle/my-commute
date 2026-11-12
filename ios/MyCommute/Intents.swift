import AppIntents

extension CommuteDirection: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Direction"
    static let caseDisplayRepresentations: [CommuteDirection: DisplayRepresentation] = [
        .toWork: "To work",
        .toHome: "Home",
    ]
}

/// For days that aren't on the schedule: Siri, the Shortcuts app, or a Shortcuts automation.
struct StartCommuteIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Start commute"
    static let description = IntentDescription("Starts the commute Live Activity.")

    @Parameter(title: "Direction")
    var direction: CommuteDirection

    init() {}

    init(direction: CommuteDirection) {
        self.direction = direction
    }

    func perform() async throws -> some IntentResult {
        await LiveActivities.shared.start(direction)
        return .result()
    }
}

struct StopCommuteIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop commute"

    func perform() async throws -> some IntentResult {
        await LiveActivities.shared.stop()
        return .result()
    }
}

struct CommuteShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartCommuteIntent(direction: .toWork),
            phrases: ["Start my commute to work in \(.applicationName)"],
            shortTitle: "Commute to work",
            systemImageName: "briefcase.fill"
        )
        AppShortcut(
            intent: StartCommuteIntent(direction: .toHome),
            phrases: ["Start my commute home in \(.applicationName)"],
            shortTitle: "Commute home",
            systemImageName: "house.fill"
        )
        AppShortcut(
            intent: StopCommuteIntent(),
            phrases: ["Stop my commute in \(.applicationName)"],
            shortTitle: "Stop commute",
            systemImageName: "stop.fill"
        )
    }
}
