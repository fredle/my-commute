import SwiftUI

struct SettingsView: View {
    @ObservedObject private var settings = Settings.shared
    @Environment(\.dismiss) private var dismiss
    @State private var locating = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Home", value: settings.home == nil ? "Not set" : "Saved")
                    Button {
                        locating = true
                        failed = false
                        Task {
                            if let here = await LocationService.shared.currentLocation() {
                                settings.setHome(here.coordinate)
                            } else {
                                failed = true
                            }
                            locating = false
                        }
                    } label: {
                        Text(locating ? "Locating…" : "Use my current location as home")
                    }
                    .disabled(locating)
                    if failed {
                        Text("Couldn't get your location. Allow location access for My Commute in Settings.")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                } footer: {
                    Text("Needed for the drive time. Set it while you're at home.")
                }

                Section("Usual drive") {
                    Stepper("Home → Hayes: \(settings.usualDriveAm) min", value: $settings.usualDriveAm, in: 5...120)
                    Stepper("Hayes → home: \(settings.usualDrivePm) min", value: $settings.usualDrivePm, in: 5...120)
                    Stepper("Warn when \(settings.driveSlowBy) min over", value: $settings.driveSlowBy, in: 3...60)
                }

                Section("Automate") {
                    Text("In Shortcuts, add a Personal Automation (weekdays, 06:30 and 16:30) that runs “Start commute” from My Commute, so the Lock Screen activity starts by itself.")
                        .font(.footnote)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
