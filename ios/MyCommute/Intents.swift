import AppIntents

extension CommuteDirection: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Direction"
    static let caseDisplayRepresentations: [CommuteDirection: DisplayRepresentation] = [
        .toLondon: "To London",
        .home: "Home",
    ]
}

/// Lets a Shortcuts personal automation (e.g. weekdays at 06:30 and 16:30) start the
/// Live Activity without opening the app.
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
        await CommuteEngine.shared.start(direction)
        return .result()
    }
}

struct StopCommuteIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop commute"

    func perform() async throws -> some IntentResult {
        await CommuteEngine.shared.stop()
        return .result()
    }
}

struct CommuteShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartCommuteIntent(direction: .toLondon),
            phrases: ["Start my commute to London in \(.applicationName)"],
            shortTitle: "Commute to London",
            systemImageName: "tram.fill"
        )
        AppShortcut(
            intent: StartCommuteIntent(direction: .home),
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
