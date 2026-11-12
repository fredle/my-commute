import ActivityKit
import Foundation

enum CommuteDirection: String, Codable, Hashable, CaseIterable {
    case toLondon
    case home

    var title: String {
        switch self {
        case .toLondon: return "Commute to London"
        case .home: return "Commute home"
        }
    }
}

/// Where you are on the way home once you've left London.
enum CommuteStage: String, Codable, Hashable {
    case normal
    case onTrain
    case driving
}

struct CommuteAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Things that are wrong, worst first, e.g. "🚆 Severe Delays: track fault at Hayes & Harlington".
        var problems: [String]
        var driveMinutes: Int?
        /// The next catchable trains (at most two).
        var trains: [Date]
        var stage: CommuteStage
        var updated: Date

        var hasProblems: Bool { !problems.isEmpty }

        var headline: String {
            switch stage {
            case .onTrain: return "On the train"
            case .driving: return "On the way home"
            case .normal: return problems.isEmpty ? "All clear" : "Problem"
            }
        }
    }

    var direction: CommuteDirection
}
