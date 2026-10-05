import UIKit
import UserNotifications

// Buffers cold-launch taps and tokens until SwiftUI has mounted the web view.
@MainActor
final class AppEvents {
    static let shared = AppEvents()
    weak var browser: BrowserController?
    var token: String?
    var pendingURL: URL?

    func openNotification(_ url: URL) {
        guard URLPolicy.isAllowed(url) else { return }
        if let browser = browser { browser.openPage(url) }
        else { pendingURL = url }
    }
}

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Already allowed on an earlier launch: register again so a changed device token reaches the server.
        if AppConfiguration.current.pushEnabled {
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                guard [.authorized, .provisional].contains(settings.authorizationStatus) else { return }
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        AppEvents.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppEvents.shared.browser?.sendPushToken()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppEvents.shared.browser?.showMessage("Notifications unavailable", "Please try enabling notifications again later.")
    }

    // Show the banner even while the app is open (the in-app bell updates on its own).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        let value = response.notification.request.content.userInfo["url"] as? String
        DispatchQueue.main.async {
            if let value = value, let url = URL(string: value) { AppEvents.shared.openNotification(url) }
            completionHandler()
        }
    }
}
