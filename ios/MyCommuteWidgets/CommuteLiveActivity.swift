import ActivityKit
import SwiftUI
import WidgetKit

struct CommuteLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CommuteAttributes.self) { context in
            CommuteLockScreenView(attributes: context.attributes, state: context.state, stale: context.isStale)
                .padding(16)
                .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StatusIcon(state: state)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("\(context.attributes.fromName) → \(context.attributes.toName)")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    CommuteDetails(direction: context.attributes.direction, state: state)
                }
            } compactLeading: {
                StatusIcon(state: state)
            } compactTrailing: {
                if let next = state.departures.first {
                    Text(next.date, style: .time).monospacedDigit().frame(maxWidth: 52)
                } else if let drive = state.driveMinutes {
                    Text("\(drive)m").monospacedDigit()
                } else {
                    Image(systemName: "checkmark")
                }
            } minimal: {
                StatusIcon(state: state)
            }
        }
    }
}

private struct StatusIcon: View {
    let state: CommuteAttributes.ContentState

    var body: some View {
        let symbol: String = {
            if state.hasProblems { return "exclamationmark.triangle.fill" }
            switch state.stage {
            case .driving: return "car.fill"
            default: return "tram.fill"
            }
        }()
        Image(systemName: symbol).foregroundStyle(state.hasProblems ? Color.orange : Color.accentColor)
    }
}

struct CommuteLockScreenView: View {
    let attributes: CommuteAttributes
    let state: CommuteAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(attributes.fromName) → \(attributes.toName)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Group {
                    if stale {
                        Text("Not updating").foregroundStyle(.orange)
                    } else {
                        Text(state.updatedDate, style: .time).foregroundStyle(.secondary)
                    }
                }
                .font(.caption2)
            }
            CommuteDetails(direction: attributes.direction, state: state)
        }
    }
}

/// Problems first, then each leg in travel order: the drive then the trains in the
/// morning, the trains then the drive on the way home.
struct CommuteDetails: View {
    let direction: CommuteDirection
    let state: CommuteAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(state.headline, systemImage: state.hasProblems ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.headline)
                .foregroundStyle(state.hasProblems ? Color.orange : Color.green)
            ForEach(state.problems.prefix(3), id: \.self) { Text($0).font(.subheadline).lineLimit(2) }
            HStack(spacing: 16) {
                if direction == .toWork {
                    drive
                    trains
                } else {
                    trains
                    drive
                }
            }
            .font(.subheadline.monospacedDigit())
        }
    }

    @ViewBuilder private var drive: some View {
        if let minutes = state.driveMinutes {
            Label("\(minutes) min", systemImage: "car.fill")
        }
    }

    @ViewBuilder private var trains: some View {
        if !state.departures.isEmpty {
            HStack(spacing: 8) {
                Image(systemName: "tram.fill")
                ForEach(state.departures.prefix(3), id: \.self) { d in
                    HStack(spacing: 2) {
                        Text(d.date, style: .time)
                        if let p = d.platform { Text("P\(p)").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
            }
        }
    }
}
