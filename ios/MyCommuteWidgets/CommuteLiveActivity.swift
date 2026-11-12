import ActivityKit
import SwiftUI
import WidgetKit

struct CommuteLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CommuteAttributes.self) { context in
            CommuteLockScreenView(direction: context.attributes.direction, state: context.state)
                .padding(16)
                .activityBackgroundTint(Color.black.opacity(0.35))
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: state.hasProblems ? "exclamationmark.triangle.fill" : "tram.fill")
                        .foregroundStyle(state.hasProblems ? .orange : .purple)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.direction.title).font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    CommuteDetails(direction: context.attributes.direction, state: state)
                }
            } compactLeading: {
                Image(systemName: state.hasProblems ? "exclamationmark.triangle.fill" : "tram.fill")
                    .foregroundStyle(state.hasProblems ? .orange : .purple)
            } compactTrailing: {
                if let next = state.trains.first {
                    Text(next, style: .time).monospacedDigit().frame(maxWidth: 52)
                } else if let drive = state.driveMinutes {
                    Text("\(drive)m").monospacedDigit()
                } else {
                    Image(systemName: "checkmark")
                }
            } minimal: {
                Image(systemName: state.hasProblems ? "exclamationmark.triangle.fill" : "tram.fill")
                    .foregroundStyle(state.hasProblems ? .orange : .purple)
            }
        }
    }
}

struct CommuteLockScreenView: View {
    let direction: CommuteDirection
    let state: CommuteAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(direction.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(state.updated, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            CommuteDetails(direction: direction, state: state)
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
            if state.hasProblems {
                Label(state.stage == .normal ? "Problem" : state.headline, systemImage: "exclamationmark.triangle.fill")
                    .font(.headline)
                    .foregroundStyle(.orange)
                ForEach(state.problems, id: \.self) { Text($0).font(.subheadline) }
            } else {
                Label(state.headline, systemImage: state.stage == .normal ? "checkmark.circle.fill" : "location.fill")
                    .font(.headline)
                    .foregroundStyle(state.stage == .normal ? .green : .primary)
            }
            HStack(spacing: 16) {
                if direction == .toLondon {
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
        if !state.trains.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "tram.fill")
                ForEach(state.trains, id: \.self) { Text($0, style: .time) }
            }
        }
    }
}
