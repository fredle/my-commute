import SwiftUI

struct ContentView: View {
    @ObservedObject private var engine = CommuteEngine.shared
    @State private var showSettings = false

    /// Mornings suggest London, afternoons home.
    private var suggested: CommuteDirection {
        Calendar.current.component(.hour, from: Date()) < 12 ? .toLondon : .home
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let direction = engine.direction {
                        runningCard(direction)
                    } else {
                        startButton(.toLondon, symbol: "tram.fill")
                        startButton(.home, symbol: "house.fill")
                        Text("Starts a Live Activity on your Lock Screen that checks the Elizabeth line and the drive every couple of minutes, and shouts only when something is wrong.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let message = engine.message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
            .navigationTitle("My Commute")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task { await engine.endStale() }
        }
    }

    private func startButton(_ direction: CommuteDirection, symbol: String) -> some View {
        Button {
            Task { await engine.start(direction) }
        } label: {
            Label(direction.title, systemImage: symbol)
                .font(.headline)
                .frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.borderedProminent)
        .tint(direction == suggested ? .purple : .gray)
    }

    private func runningCard(_ direction: CommuteDirection) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(direction.title).font(.title2.bold())
            if let state = engine.state {
                Label(
                    state.hasProblems ? "Something's wrong" : state.headline,
                    systemImage: state.hasProblems ? "exclamationmark.triangle.fill" : "checkmark.circle.fill"
                )
                .foregroundStyle(state.hasProblems ? .orange : .green)
                ForEach(state.problems, id: \.self) { Text($0) }
                if let drive = state.driveMinutes { Text("🚗 \(drive) min") }
                if !state.trains.isEmpty {
                    HStack(spacing: 8) {
                        Text("🚆")
                        ForEach(state.trains, id: \.self) { Text($0, style: .time) }
                    }
                }
                Text("Updated \(Text(state.updated, style: .time))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Button(role: .destructive) {
                Task { await engine.stop() }
            } label: {
                Text("Stop").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}
