import Foundation

/// Turns train and drive readings into what the Live Activity shows.
/// It leads with whatever is wrong and stays quiet when nothing is.
enum CommuteLogic {
    static let trainGapMinutes = 20.0   // next train further off than this is a problem
    static let catchableMinutes = 2.0   // trains leaving sooner than this aren't shown

    static func makeState(
        train: TfL.Snapshot?,
        driveMinutes: Int?,
        usualDrive: Int,
        slowBy: Int,
        now: Date,
        stage: CommuteStage
    ) -> CommuteAttributes.ContentState {
        var problems: [String] = []
        var times: [Date] = []

        if let train {
            let next = train.next.filter { $0.at.timeIntervalSince(now) >= catchableMinutes * 60 }
            if !train.status.good {
                let reason = train.status.reason.isEmpty ? "" : ": \(train.status.reason)"
                problems.append("🚆 \(train.status.text)\(reason)")
                times = next.prefix(2).map(\.at)
            } else if let first = next.first {
                if first.at.timeIntervalSince(now) > trainGapMinutes * 60 {
                    problems.append("🚆 Next train \(clock(first.at))")
                } else {
                    times = next.prefix(2).map(\.at)
                }
            } else {
                problems.append("🚆 No trains listed")
            }
        }

        if let m = driveMinutes, m >= usualDrive + slowBy {
            problems.append("🚗 Drive \(m) min (+\(m - usualDrive))")
        }

        return .init(problems: problems, driveMinutes: driveMinutes, trains: times, stage: stage, updated: now)
    }

    static func clock(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Europe/London")
        return f.string(from: date)
    }
}
