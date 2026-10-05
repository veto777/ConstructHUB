import Foundation

struct AppConfiguration {
    static let current = AppConfiguration()
    let startURL: URL
    let userAgent: String
    let appKind: String
    let pushEnabled: Bool

    private init() {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let start = info["CHStartURL"] as? String, let url = URL(string: start),
              URLPolicy.isAllowed(url), url.scheme == "https",
              let token = info["CHUserAgentToken"] as? String,
              let kind = info["CHAppKind"] as? String, ["platform", "crm"].contains(kind) else {
            preconditionFailure("Missing or invalid ConstructHUB target configuration")
        }
        startURL = url
        userAgent = "\(token)/\(info["CFBundleShortVersionString"] as? String ?? "1.0")"
        appKind = kind
        pushEnabled = ["YES", "TRUE", "1"].contains(String(describing: info["CHPushEnabled"] ?? "NO").uppercased())
    }
}

enum URLPolicy {
    static func isAllowed(_ url: URL) -> Bool {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.user == nil, url.password == nil, let host = url.host?.lowercased() else { return false }
        return host == "constructhub.us" || host.hasSuffix(".constructhub.us")
    }

    static func isGoogle(_ url: URL) -> Bool {
        url.host?.lowercased() == "accounts.google.com"
    }

    static func isGoogleStart(_ url: URL) -> Bool {
        guard isAllowed(url) else { return false }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return ["api/auth/google", "api/gbp/connect", "api/ads/connect", "api/gsc/connect"].contains(path)
    }

    static func origin(of url: URL) -> URL? {
        guard isAllowed(url), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.scheme = "https"
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    static func addingAppFlag(to url: URL) -> URL? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.queryItems = (parts.queryItems ?? []).filter { $0.name != "app" } + [URLQueryItem(name: "app", value: "1")]
        return parts.url
    }
}
