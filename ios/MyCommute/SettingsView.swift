import SwiftUI

struct SettingsView: View {
    @ObservedObject private var store = ConfigStore.shared
    @Environment(\.dismiss) private var dismiss
    @State private var confirmErase = false
    @State private var eraseError: String?

    /// Privacy policy and support pages, set in project.yml.
    private func link(_ key: String) -> URL? {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String).flatMap(URL.init(string:))
    }

    private var paused: Binding<Bool> {
        Binding(
            get: { store.config.pausedUntil != nil },
            set: { store.config.pausedUntil = $0 ? Calendar.current.date(byAdding: .day, value: 7, to: Date()) : nil }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Places") {
                    NavigationLink {
                        PlacePicker(title: "Home", place: $store.config.home)
                    } label: {
                        LabeledContent("Home", value: store.config.home?.name ?? "Not set")
                    }
                    NavigationLink {
                        PlacePicker(title: "Work", place: $store.config.work)
                    } label: {
                        LabeledContent("Work", value: store.config.work?.name ?? "Not set")
                    }
                }

                Section("Train") {
                    NavigationLink {
                        StationPicker(title: "Station near home", near: store.config.home, station: $store.config.homeStation)
                    } label: {
                        LabeledContent("You drive to", value: store.config.homeStation?.name ?? "Not set")
                    }
                    NavigationLink {
                        StationPicker(title: "Station near work", near: store.config.work, station: $store.config.workStation)
                    } label: {
                        LabeledContent("Train to", value: store.config.workStation?.name ?? "Not set")
                    }
                }

                Section("Schedule") {
                    ScheduleEditor(week: $store.config.week)
                }

                Section {
                    Toggle("Pause", isOn: paused.animation())
                    if let until = store.config.pausedUntil {
                        DatePicker(
                            "Until the end of",
                            selection: Binding(get: { until }, set: { store.config.pausedUntil = $0 }),
                            in: Date()...,
                            displayedComponents: .date
                        )
                    }
                    Toggle("Skip bank holidays", isOn: $store.config.skipBankHolidays)
                    if store.config.skipBankHolidays {
                        Picker("Bank holidays for", selection: $store.config.bankHolidayRegion) {
                            ForEach(BankHolidayRegion.allCases) { Text($0.title).tag($0) }
                        }
                    }
                } header: {
                    Text("Holidays")
                } footer: {
                    Text("Going on holiday or working from home? Pause, and scheduled alerts stop until the day after.")
                }

                Section {
                    Stepper("Slow drive: \(store.config.slowDriveMinutes) min over", value: $store.config.slowDriveMinutes, in: 3...60)
                    Stepper("Walk from work to station: \(store.config.walkMinutes) min", value: $store.config.walkMinutes, in: 0...45)
                } header: {
                    Text("Alerts")
                } footer: {
                    Text("A drive counts as slow when it's this much longer than with no traffic. The walk hides evening trains you couldn't reach in time.")
                }

                Section("Shortcuts") {
                    Text("“Start commute” and “Stop commute” are in the Shortcuts app and work with Siri, for days that aren't on your schedule.")
                        .font(.footnote)
                }

                Section("Privacy") {
                    if let privacy = link("PrivacyPolicyURL") { Link("Privacy policy", destination: privacy) }
                    Button("Delete my data", role: .destructive) { confirmErase = true }
                    if let eraseError { Text(eraseError).font(.footnote).foregroundStyle(.red) }
                }

                Section {
                    if let support = link("SupportURL") { Link("Help and feedback", destination: support) }
                    Text("Train times: National Rail Enquiries (Rail Data Marketplace) and Transport for London. Powered by TfL Open Data; contains OS data © Crown copyright and database rights.")
                    Text("Station list: UK railway stations by David Wheatley, under the Open Database Licence.")
                    Text("Drive times and maps: Apple Maps.")
                    Text("Bank holidays: GOV.UK, under the Open Government Licence.")
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")")
                } header: {
                    Text("About")
                }
                .font(.footnote)
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Delete everything?", isPresented: $confirmErase, titleVisibility: .visible) {
                Button("Delete my data", role: .destructive) {
                    Task {
                        do {
                            await LiveActivities.shared.stop()
                            try await store.eraseAll()
                            dismiss()
                        } catch {
                            eraseError = "Couldn't reach the server, so nothing was deleted. Try again later."
                        }
                    }
                }
            } message: {
                Text("Your places, stations and schedule are removed from this phone and from our server. You'll set up again from the start.")
            }
        }
    }
}
