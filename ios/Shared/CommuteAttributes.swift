import ActivityKit
import Foundation

// Shared by the app and the Live Activity extension. The server builds these as JSON
// (server/src/types.ts), so field names and raw values must stay in step with it.

enum CommuteDirection: String, Codable, Hashable, CaseIterable, Sendable {
    case toWork
    case toHome

    var title: String {
        switch self {
        case .toWork: return "To work"
        case .toHome: return "Home"
        }
    }

    var symbol: String {
        switch self {
        case .toWork: return "briefcase.fill"
        case .toHome: return "house.fill"
        }
    }
}

/// Where you are on the journey, worked out by the server from geofences the phone crosses.
enum CommuteStage: String, Codable, Hashable, Sendable {
    case beforeLeaving
    case driving
    case atStation
    case onTrain
    case arrived
}

struct CommuteAttributes: ActivityAttributes {
    struct Departure: Codable, Hashable, Sendable {
        /// Unix seconds, expected departure.
        var time: Double
        /// Minutes late against the timetable, when known.
        var late: Int?
        var platform: String?
        var destination: String

        var date: Date { Date(timeIntervalSince1970: time) }
    }

    struct ContentState: Codable, Hashable, Sendable {
        /// Things that are wrong, worst first, e.g. "🚆 07:32 cancelled: shortage of train crew".
        var problems: [String]
        /// The next trains you can still catch (at most three).
        var departures: [Departure]
        var driveMinutes: Int?
        var stage: CommuteStage
        /// Unix seconds.
        var updated: Double

        var updatedDate: Date { Date(timeIntervalSince1970: updated) }
        var hasProblems: Bool { !problems.isEmpty }

        var headline: String {
            switch stage {
            case .driving: return "Driving"
            case .atStation: return hasProblems ? "Problem" : "At the station"
            case .onTrain: return "On the train"
            case .arrived: return "Arrived"
            case .beforeLeaving: return hasProblems ? "Problem" : "All clear"
            }
        }
    }

    var commuteId: String
    var direction: CommuteDirection
    var fromName: String
    var toName: String
}
