import AuthenticationServices
import Combine
import Network
import UIKit
import UserNotifications
import WebKit

@MainActor
final class BrowserController: UIViewController, ObservableObject {
    @Published private(set) var showOffline = false
    private let config = AppConfiguration.current
    private let monitor = NWPathMonitor()
    private let refresh = UIRefreshControl()
    private var networkDown = false
    private var loadFailed = false
    private var hasLoaded = false
    private var retryURL: URL
    private var authenticationSession: ASWebAuthenticationSession?
    private var authenticationWindow: UIWindow?
    private var downloadFiles: [ObjectIdentifier: URL] = [:]
    private var pushRequestPending = false
    private var tokenRequestPending = false
    private(set) var webView: WKWebView!

    init() {
        retryURL = AppConfiguration.current.startURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Use init()") }

    override func viewDidLoad() {
        super.viewDidLoad()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = config.userAgent
        configuration.userContentController.add(WeakMessageHandler(self), name: "ch")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bouncesZoom = false
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.refreshControl = refresh
        refresh.addTarget(self, action: #selector(refreshPage), for: .valueChanged)
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        monitor.pathUpdateHandler = { [weak self] path in
            let disconnected = path.status != .satisfied
            DispatchQueue.main.async {
                guard let self = self else { return }
                let wasDown = self.networkDown
                self.networkDown = disconnected
                self.updateOffline()
                if wasDown && !disconnected && !self.hasLoaded { self.retry() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "us.constructhub.network"))
        AppEvents.shared.browser = self
        let initial = AppEvents.shared.pendingURL ?? config.startURL
        AppEvents.shared.pendingURL = nil
        openPage(initial)
    }

    deinit { monitor.cancel() }

    private func updateOffline() { showOffline = networkDown || loadFailed }

    func openPage(_ url: URL) {
        guard URLPolicy.isAllowed(url) else { return }
        loadViewIfNeeded()
        if URLPolicy.isGoogleStart(url) { beginAuthentication(url); return }
        retryURL = url
        loadFailed = false
        updateOffline()
        webView.load(URLRequest(url: url))
    }

    func retry() {
        loadFailed = false
        updateOffline()
        webView.load(URLRequest(url: retryURL))
    }

    @objc private func refreshPage() {
        if webView.url != nil { webView.reload() } else { retry() }
    }

    func showMessage(_ title: String, _ message: String) {
        guard presentedViewController == nil, viewIfLoaded?.window != nil else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func share(_ items: [Any], cleanup: URL? = nil) {
        guard presentedViewController == nil, viewIfLoaded?.window != nil else {
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
            return
        }
        let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { _, _, _, _ in
            if let cleanup = cleanup { try? FileManager.default.removeItem(at: cleanup) }
        }
        present(sheet, animated: true)
    }

    private func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https", "tel", "sms", "mailto", "maps", "comgooglemaps"].contains(scheme) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func beginAuthentication(_ intercepted: URL) {
        guard authenticationSession == nil, let window = viewIfLoaded?.window else { return }
        let currentOrigin = URLPolicy.origin(of: webView.url ?? config.startURL) ?? config.startURL
        var start = intercepted
        var exchangeOrigin = currentOrigin
        if URLPolicy.isAllowed(intercepted) {
            exchangeOrigin = URLPolicy.origin(of: intercepted) ?? currentOrigin
        } else if URLPolicy.isGoogle(intercepted) {
            // Preserve connection state/scope on direct Google URLs returned by a connect API.
            // App-aware connect APIs must already have marked that state for the scheme callback.
            let redirect = URLComponents(url: intercepted, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "redirect_uri" })?.value
            if let redirect = redirect, let callback = URL(string: redirect),
               let origin = URLPolicy.origin(of: callback) {
                exchangeOrigin = origin
                if callback.path == "/api/auth/google/callback" {
                    start = origin.appendingPathComponent("api/auth/google")
                }
            } else {
                start = currentOrigin.appendingPathComponent("api/auth/google")
            }
        } else { return }
        guard let authURL = URLPolicy.addingAppFlag(to: start) else { return }
        let origin = exchangeOrigin
        let session = ASWebAuthenticationSession(url: authURL, callbackURLScheme: "constructhub") { [weak self] callback, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.authenticationSession = nil
                self.authenticationWindow = nil
                if let error = error {
                    let nsError = error as NSError
                    if nsError.domain != ASWebAuthenticationSessionErrorDomain ||
                        nsError.code != ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        self.showMessage("Sign-in unavailable", "Please try connecting your Google account again.")
                    }
                    return
                }
                guard let callback = callback, callback.scheme == "constructhub", callback.host == "auth-done",
                      let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
                      let code = parts.queryItems?.first(where: { $0.name == "code" })?.value,
                      !code.isEmpty, code.count <= 8192 else {
                    self.showMessage("Sign-in unavailable", "The sign-in response was incomplete. Please try again.")
                    return
                }
                var exchange = URLComponents(url: origin.appendingPathComponent("api/auth/app-exchange"), resolvingAgainstBaseURL: false)!
                exchange.queryItems = [URLQueryItem(name: "code", value: code)]
                if let url = exchange.url {
                    // Never persist or retry the one-time code.
                    self.loadFailed = false
                    self.updateOffline()
                    self.webView.load(URLRequest(url: url))
                }
            }
        }
        authenticationWindow = window
        authenticationSession = session
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        if !session.start() {
            authenticationSession = nil
            authenticationWindow = nil
            showMessage("Sign-in unavailable", "Please try again.")
        }
    }

    private func requestPush() {
        guard config.pushEnabled else {
            showMessage("Notifications unavailable", "Notifications aren't enabled in this app build yet.")
            return
        }
        guard !pushRequestPending else { return }
        pushRequestPending = true
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.pushRequestPending = false
                if granted { UIApplication.shared.registerForRemoteNotifications() }
                else { self.showMessage("Notifications are off", "You can allow notifications for this app in iPhone Settings.") }
            }
        }
    }

    func sendPushToken() {
        guard config.pushEnabled, hasLoaded, !tokenRequestPending,
              let token = AppEvents.shared.token, let current = webView.url,
              URLPolicy.isAllowed(current), current.scheme == "https" else { return }
        tokenRequestPending = true
        // Relative fetch runs in the page's origin with its HttpOnly session cookies.
        webView.callAsyncJavaScript("""
            if (location.protocol !== 'https:' || location.origin !== new URL(expectedOrigin).origin) return false;
            const response = await fetch('/api/app/push-token', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, app, platform: 'ios' })
            });
            return response.ok;
            """, arguments: ["token": token, "app": config.appKind,
                             "expectedOrigin": URLPolicy.origin(of: current)!.absoluteString],
            in: nil, in: .page) { [weak self] _ in
                // Keep the token in memory; retry after next navigation or enablePush request.
                self?.tokenRequestPending = false
            }
    }
}

extension BrowserController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if URLPolicy.isGoogle(url) || URLPolicy.isGoogleStart(url) {
            decisionHandler(.cancel)
            refresh.endRefreshing()
            beginAuthentication(url)
        } else if URLPolicy.isAllowed(url) {
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download)
            } else if navigationAction.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(navigationAction.request)
            } else { decisionHandler(.allow) }
        } else if url.scheme == "blob", URLPolicy.isAllowed(webView.url ?? config.startURL) {
            // Blob exports inherit the trusted page origin and are handled by WKDownload.
            decisionHandler(.download)
        } else if url.absoluteString == "about:blank", navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            refresh.endRefreshing()
            openExternal(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let response = navigationResponse.response
        let http = response as? HTTPURLResponse
        let mime = response.mimeType?.lowercased() ?? ""
        let attachment = http?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        if let status = http?.statusCode, status >= 400, navigationResponse.isForMainFrame {
            refresh.endRefreshing()
            if !hasLoaded { loadFailed = true; updateOffline() }
            else { showMessage("Page unavailable", "Please try again later.") }
            decisionHandler(.cancel)
        } else if attachment || mime == "application/pdf" || mime.hasPrefix("audio/") || !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target=_blank was routed by the navigation policy; never create another web view.
        nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoaded = true
        loadFailed = false
        refresh.endRefreshing()
        if let url = webView.url, URLPolicy.isAllowed(url), url.path != "/api/auth/app-exchange" { retryURL = url }
        updateOffline()
        sendPushToken()
    }

    private func navigationFailed(_ error: Error) {
        refresh.endRefreshing()
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if !hasLoaded || networkDown { loadFailed = true; updateOffline() }
        else { showMessage("Page unavailable", "Check your connection and try again.") }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadFailed = true
        updateOffline()
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        refresh.endRefreshing()
        download.delegate = self
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        refresh.endRefreshing()
        download.delegate = self
    }
}

extension BrowserController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Set before start(); retained for the entire authentication session.
        authenticationWindow!
    }
}

extension BrowserController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "ch", message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.scheme == "https", URLPolicy.isAllowed(frameURL),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "enablePush": requestPush()
        case "haptic": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "share":
            guard let value = body["url"] as? String, let url = URL(string: value),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return }
            var items: [Any] = []
            if let title = body["title"] as? String, !title.isEmpty { items.append(title) }
            items.append(url)
            share(items)
        default: break
        }
    }
}

extension BrowserController: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let safeName = (suggestedFilename as NSString).lastPathComponent
            let file = directory.appendingPathComponent(safeName.isEmpty || safeName == "." || safeName == ".." ? "Download" : safeName)
            downloadFiles[ObjectIdentifier(download)] = file
            completionHandler(file)
        } catch {
            completionHandler(nil)
            showMessage("Download unavailable", "Couldn't save this file. Please try again.")
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share([file], cleanup: file.deletingLastPathComponent())
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        }
        showMessage("Download unavailable", "Please try downloading the file again.")
    }
}

// WKUserContentController retains handlers; avoid a browser → handler → browser cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
