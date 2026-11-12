import ActivityKit
import SwiftUI

struct ContentView: View {
    @ObservedObject private var store = ConfigStore.shared
    @ObservedObject private var activities = LiveActivities.shared
    @ObservedObject private var geofences = Geofences.shared
    @State private var showSettings = false
    @State private var preview: CommuteAttributes.ContentState?
    @State private var previewError: String?

    /// Mornings suggest work, afternoons home.
    private var suggested: CommuteDirection {
        Calendar.current.component(.hour, from: Date()) < 12 ? .toWork : .toHome
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    warnings
                    if let activity = activities.current {
                        RunningCard(activity: activity)
                    } else {
                        nowCard
                        startButton(.toWork)
                        startButton(.toHome)
                    }
                    if let message = activities.message {
                        Text(message).font(.footnote).foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    nextUp
                }
                .padding()
            }
            .refreshable { await loadPreview() }
            .navigationTitle(LiveActivities.appName)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task { await loadPreview() }
        }
    }

    private func loadPreview() async {
        do {
            preview = try await Backend.status(suggested)
            previewError = nil
        } catch {
            previewError = error.localizedDescription
        }
    }

    @ViewBuilder private var warnings: some View {
        if !activities.enabled {
            Banner(text: "Live Activities are off. Turn them on in Settings › \(LiveActivities.appName).", systemImage: "exclamationmark.triangle.fill")
        }
        if !geofences.hasAlways {
            Banner(text: "Allow location “Always” so commutes move on and stop by themselves.", systemImage: "location.slash") {
                geofences.requestAlways()
            }
        }
        if store.pushToStartToken == nil && activities.enabled {
            Banner(text: "Waiting for iOS to allow scheduled starts. This usually takes a moment after first launch.", systemImage: "clock")
        }
        if let error = store.syncError {
            Banner(text: error, systemImage: "icloud.slash")
        }
    }

    /// The status right now for the likely next journey, without starting anything.
    @ViewBuilder private var nowCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Right now · \(suggested == .toWork ? "to work" : "home")")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let preview {
                CommuteSummary(direction: suggested, state: preview)
            } else if let previewError {
                Text(previewError).font(.footnote).foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private func startButton(_ direction: CommuteDirection) -> some View {
        Button {
            Task { await activities.start(direction) }
        } label: {
            Label("Start commute \(direction == .toWork ? "to work" : "home")", systemImage: direction.symbol)
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .tint(direction == suggested ? .accentColor : .gray)
    }

    @ViewBuilder private var nextUp: some View {
        Group {
            if store.config.isPaused, let until = store.config.pausedUntil {
                Text("Paused until the end of \(until.formatted(date: .abbreviated, time: .omitted)).")
            } else if let next = store.config.nextStart() {
                Text("Next: \(next.direction == .toWork ? "to work" : "home") \(next.date.formatted(.relative(presentation: .named))), at \(next.date.formatted(date: .omitted, time: .shortened)).")
            } else {
                Text("No commutes scheduled. Choose days in Settings.")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct RunningCard: View {
    let activity: Activity<CommuteAttributes>
    @State private var state: CommuteAttributes.ContentState?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(activity.attributes.fromName) → \(activity.attributes.toName)")
                .font(.headline)
            CommuteSummary(direction: activity.attributes.direction, state: state ?? activity.content.state)
            Button(role: .destructive) {
                Task { await LiveActivities.shared.stop() }
            } label: {
                Text("Stop").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .task(id: activity.id) {
            for await content in activity.contentUpdates { state = content.state }
        }
    }
}

struct CommuteSummary: View {
    let direction: CommuteDirection
    let state: CommuteAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(state.headline, systemImage: state.hasProblems ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.headline)
                .foregroundStyle(state.hasProblems ? Color.orange : Color.green)
            ForEach(state.problems, id: \.self) { Text($0) }
            if let drive = state.driveMinutes {
                Label("\(drive) min drive", systemImage: "car.fill")
            }
            ForEach(state.departures, id: \.self) { d in
                HStack {
                    Image(systemName: "tram.fill").foregroundStyle(.secondary)
                    Text(d.date, style: .time).monospacedDigit()
                    if let late = d.late, late > 0 { Text("+\(late)").foregroundStyle(.orange) }
                    Text(d.destination).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if let p = d.platform { Text("Plat \(p)").foregroundStyle(.secondary) }
                }
                .font(.subheadline)
            }
            Text("Updated \(Text(state.updatedDate, style: .time))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct Banner: View {
    let text: String
    let systemImage: String
    var action: (() -> Void)?

    var body: some View {
        let content = Label(text, systemImage: systemImage)
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        if let action {
            Button(action: action) { content }.buttonStyle(.plain)
        } else {
            content
        }
    }
}
