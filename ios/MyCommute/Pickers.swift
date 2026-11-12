import MapKit
import SwiftUI

// MARK: - Places (home, work)

/// Address search as you type, from Apple Maps.
@MainActor
final class PlaceSearch: NSObject, ObservableObject, MKLocalSearchCompleterDelegate {
    @Published var query = "" { didSet { completer.queryFragment = query } }
    @Published private(set) var results: [MKLocalSearchCompletion] = []
    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = [.address, .pointOfInterest]
        completer.region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 54.0, longitude: -2.5),
            span: MKCoordinateSpan(latitudeDelta: 11, longitudeDelta: 11)
        )
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        let results = completer.results
        Task { @MainActor in self.results = results }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {}

    func resolve(_ completion: MKLocalSearchCompletion) async -> Place? {
        let response = try? await MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start()
        guard let item = response?.mapItems.first else { return nil }
        let c = item.placemark.coordinate
        return Place(name: completion.title, latitude: c.latitude, longitude: c.longitude)
    }
}

struct PlacePicker: View {
    let title: String
    @Binding var place: Place?
    @StateObject private var search = PlaceSearch()
    @State private var locating = false
    @State private var failed = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Section {
                Button {
                    locating = true
                    failed = false
                    Task {
                        if let here = await Geofences.shared.currentLocation() {
                            place = Place(name: "Current location", latitude: here.coordinate.latitude, longitude: here.coordinate.longitude)
                            dismiss()
                        } else {
                            failed = true
                        }
                        locating = false
                    }
                } label: {
                    Label(locating ? "Locating…" : "Use my current location", systemImage: "location.fill")
                }
                .disabled(locating)
                if failed {
                    Text("Couldn't get your location. Allow location access in Settings, or search instead.")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
            Section {
                ForEach(search.results, id: \.self) { result in
                    Button {
                        Task {
                            if let resolved = await search.resolve(result) {
                                place = resolved
                                dismiss()
                            }
                        }
                    } label: {
                        VStack(alignment: .leading) {
                            Text(result.title).foregroundStyle(.primary)
                            if !result.subtitle.isEmpty {
                                Text(result.subtitle).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $search.query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Address or postcode")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Stations

struct StationPicker: View {
    let title: String
    /// Suggests the stations nearest here before anything is typed.
    let near: Place?
    @Binding var station: Station?
    @State private var query = ""
    @State private var results: [Station] = []
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Section(query.isEmpty && near != nil ? "Nearby" : "") {
                ForEach(results) { s in
                    Button {
                        station = s
                        dismiss()
                    } label: {
                        HStack {
                            Text(s.name).foregroundStyle(.primary)
                            Spacer()
                            Text(s.network == "nr" ? s.id : s.networkName)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Station name or code")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) {
            // Wait for typing to pause.
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    results = try await Backend.searchStations(query)
                } else if let near {
                    results = try await Backend.stationsNear(latitude: near.latitude, longitude: near.longitude)
                } else {
                    results = []
                }
                error = nil
            } catch is CancellationError {
            } catch let e as URLError where e.code == .cancelled {
            } catch {
                self.error = "Couldn't search stations: \(error.localizedDescription)"
            }
        }
    }
}

// MARK: - Weekly schedule

struct ScheduleEditor: View {
    @Binding var week: [DayPlan]

    var body: some View {
        ForEach($week) { $plan in
            VStack(alignment: .leading, spacing: 8) {
                Toggle(plan.name, isOn: $plan.enabled.animation())
                if plan.enabled {
                    HStack {
                        TimeField(label: "To work", systemImage: CommuteDirection.toWork.symbol, minutes: $plan.toWork)
                        Spacer()
                        TimeField(label: "Home", systemImage: CommuteDirection.toHome.symbol, minutes: $plan.toHome)
                    }
                }
            }
        }
        Button("Copy Monday to every enabled weekday") {
            guard let monday = week.first(where: { $0.day == 1 }) else { return }
            for i in week.indices where week[i].enabled && week[i].day != 1 {
                week[i].toWork = monday.toWork
                week[i].toHome = monday.toHome
            }
        }
        .font(.footnote)
    }
}

/// A time of day held as minutes after midnight.
struct TimeField: View {
    let label: String
    let systemImage: String
    @Binding var minutes: Int

    private var date: Binding<Date> {
        Binding(
            get: { Calendar.current.date(byAdding: .minute, value: minutes, to: Calendar.current.startOfDay(for: Date())) ?? Date() },
            set: { minutes = Calendar.current.component(.hour, from: $0) * 60 + Calendar.current.component(.minute, from: $0) }
        )
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage).foregroundStyle(.secondary).accessibilityLabel(label)
            DatePicker(label, selection: date, displayedComponents: .hourAndMinute).labelsHidden()
        }
    }
}
