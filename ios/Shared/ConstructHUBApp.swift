import SwiftUI

@main
struct ConstructHUBApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var browser = BrowserController()

    var body: some Scene {
        WindowGroup {
            ZStack {
                BrowserView(controller: browser)
                    .ignoresSafeArea(.container)
                    .opacity(browser.showOffline ? 0 : 1)
                    .accessibilityHidden(browser.showOffline)
                if browser.showOffline {
                    VStack(spacing: 20) {
                        Image("Logo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 100, height: 100)
                            .accessibilityHidden(true)
                        Text("You're offline").font(.title2.bold())
                        Text("We couldn't load this page. Check your connection and try again.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.secondary)
                        Button("Retry", action: browser.retry)
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    }
                    .padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .systemBackground))
                }
            }
        }
    }
}

private struct BrowserView: UIViewControllerRepresentable {
    let controller: BrowserController
    func makeUIViewController(context: Context) -> BrowserController { controller }
    func updateUIViewController(_ uiViewController: BrowserController, context: Context) {}
}
