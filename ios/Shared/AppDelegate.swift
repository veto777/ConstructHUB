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

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        AppEvents.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined()
        AppEvents.shared.browser?.sendPushToken()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        AppEvents.shared.browser?.showMessage("Notifications unavailable", "Please try enabling notifications again later.")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let value = response.notification.request.content.userInfo["url"] as? String
        DispatchQueue.main.async {
            if let value = value, let url = URL(string: value) { AppEvents.shared.openNotification(url) }
            completionHandler()
        }
    }
}
