import SwiftUI

/// First run: home, work, the two stations, the week, then permissions. Each step can be
/// changed later in Settings.
struct OnboardingView: View {
    @ObservedObject private var store = ConfigStore.shared
    @ObservedObject private var geofences = Geofences.shared
    @State private var draft = ConfigStore.shared.config

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Tell us your commute once. On the days and times you choose, a Live Activity appears on your Lock Screen with your next trains and the traffic, and calls out delays, cancellations and slow roads.")
                        .font(.callout)
                }

                Section {
                    NavigationLink {
                        PlacePicker(title: "Home", place: $draft.home)
                    } label: {
                        LabeledContent("Home", value: draft.home?.name ?? "Choose")
                    }
                    NavigationLink {
                        PlacePicker(title: "Work", place: $draft.work)
                    } label: {
                        LabeledContent("Work", value: draft.work?.name ?? "Choose")
                    }
                } header: {
                    Text("1 · Where you live and work")
                } footer: {
                    Text("These stay on your phone. Only an area about 100 m across around home is sent to our server, to work out drive times.")
                }

                Section {
                    NavigationLink {
                        StationPicker(title: "Station near home", near: draft.home, station: $draft.homeStation)
                    } label: {
                        LabeledContent("You drive to", value: draft.homeStation?.name ?? "Choose")
                    }
                    NavigationLink {
                        StationPicker(title: "Station near work", near: draft.work, station: $draft.workStation)
                    } label: {
                        LabeledContent("Train to", value: draft.workStation?.name ?? "Choose")
                    }
                    if let a = draft.homeStation, let b = draft.workStation, a.network != b.network {
                        Text("Pick two National Rail stations, or two Tube/DLR stations. Journeys that change between them aren't supported yet.")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                } header: {
                    Text("2 · Your train")
                } footer: {
                    Text("National Rail (including the Elizabeth line and Overground), the Tube and the DLR.")
                }

                Section {
                    ScheduleEditor(week: $draft.week)
                } header: {
                    Text("3 · When to alert you")
                } footer: {
                    Text("The Live Activity starts at these times and ends when you arrive.")
                }

                Section {
                    Button {
                        geofences.requestAlways()
                    } label: {
                        Label(geofences.hasAlways ? "Location: Always ✓" : "Allow location “Always”", systemImage: "location.fill")
                    }
                    .disabled(geofences.hasAlways)
                } header: {
                    Text("4 · Know where you are")
                } footer: {
                    Text("Used only to notice when you leave home, reach a station or arrive, so the Live Activity can move on and stop by itself. There's no tracking in between, and your location is never sent anywhere. Without it, you'll need to stop each commute yourself.")
                }

                Section {
                    Button("Start") {
                        store.config = draft
                    }
                    .disabled(!draft.isComplete || draft.homeStation?.network != draft.workStation?.network)
                }
            }
            .navigationTitle("Set up your commute")
        }
    }
}
