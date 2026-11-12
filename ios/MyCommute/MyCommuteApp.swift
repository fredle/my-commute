import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Runs for background launches too (a geofence crossing, or the system handing over a
    /// Live Activity the server started), when no window is ever shown.
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        MainActor.assumeIsolated {
            LiveActivities.shared.observe()
            Geofences.shared.start()
        }
        return true
    }
}

@main
struct MyCommuteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .onChange(of: scenePhase) { _, phase in
            // Catches a time zone change or a sync that failed while offline.
            if phase == .active { Task { await ConfigStore.shared.sync() } }
        }
    }
}

struct RootView: View {
    @ObservedObject private var store = ConfigStore.shared

    var body: some View {
        if store.config.isComplete {
            ContentView()
        } else {
            OnboardingView()
        }
    }
}
