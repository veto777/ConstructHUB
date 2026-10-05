# ConstructHUB iPhone apps

Two free companion apps for existing ConstructHUB customers. The apps sell nothing. Apple team: **Construct Hub LLC**; use ConstructHUB's own signing credentials and App Store Connect API key. Read [the App Store plan](../docs/app/APP-STORE-PLAN.md) before submission.

| Scheme / display name | Bundle ID | Start URL | User-agent suffix |
| --- | --- | --- | --- |
| ConstructHUB | `us.constructhub.app` | `https://constructhub.us/` | `ConstructHUBApp/1.0` |
| ConstructHUB CRM | `us.constructhub.crm` | `https://portal.constructhub.us/` | `ConstructHUBCRM/1.0` |

Shared SwiftUI/UIKit implementation in `Shared/`; each target's Info.plist supplies `CHStartURL`, `CHUserAgentToken`, `CHAppKind` and `CHPushEnabled`. Icons: `scripts/generate-icons.py` (navy + orange CHUB for ConstructHUB; orange with "CRM" for the CRM). Version 1.0, build 1, iPhone only, minimum iOS 16, build with Xcode 26 / iOS 26 SDK. No third-party runtime dependencies. Swift 5 language mode intentionally avoids adopting Swift 6 strict concurrency while using Xcode 26's SDK signatures.

## Generate and build on a Mac

```sh
brew install xcodegen
cd ios
xcodegen generate
cd ..
xcodebuild -project ios/ConstructHUB.xcodeproj -scheme ConstructHUB \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/ConstructHUB.xcodeproj -scheme 'ConstructHUB CRM' \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Generated `.xcodeproj` and build products are ignored. Signing and a development team are deliberately unset. Camera/photo inputs use WebKit's native picker and the per-target camera, photos and microphone permission descriptions. There is no custom photo picker or blanket media permission grant.

`python3 ios/scripts/generate-icons.py` (from the repository root; requires Pillow) regenerates checked-in icons and offline logos. Platform uses `client/public/icon-512.png` (512²); CRM uses `client/public/chub-logo-square.png` (836²). Both are **upscaled placeholders**, composited onto white to produce opaque RGB 1024² PNGs. Replace with approved source-resolution artwork before release. No image-generation service was used.

## Native behavior

- Persistent `WKWebsiteDataStore.default()` retains sign-in. WebKit receives the normal user agent plus the per-app token. Back/forward swipe and pull-to-refresh are enabled; zoom bounce is disabled without disabling accessible pinch zoom.
- The web view fills the screen with automatic scroll insets disabled. The site's `viewport-fit=cover` and `env(safe-area-inset-*)` CSS own page safe-area padding; the native offline screen stays within SwiftUI's safe area.
- Only `constructhub.us` and its dot-delimited subdomains remain in-app. Lookalike suffixes and URLs with embedded credentials are rejected. Other HTTP(S) links go through `UIApplication.open`, as do `tel:`, `sms:`, `mailto:`, `maps:` and `comgooglemaps:`. Apple/Google Maps HTTPS links consequently go to the system too. ATS remains at its secure default; no blanket HTTP exception.
- Allowed `target=_blank` / `window.open(url)` navigations reuse the main web view. Unknown custom schemes are cancelled. Blank popup windows that are later manipulated by JavaScript are not supported.
- PDFs, audio responses, attachments, HTML download links and blob exports use `WKDownload` and then the system share sheet. WebKit preserves authenticated cookies; native URLSession doesn't copy them. Downloads use unique temporary directories and are removed after the sheet closes or a download fails. Other external-host links still open externally.
- `NWPathMonitor` and first-load errors show the native logo, “You're offline” and Retry. After a successful page load, a later failed navigation retains that page and shows an error; no network still shows the offline overlay. A recovered connection retries an unsuccessful initial load. No offline content cache is promised.

## Google OAuth / server contract

The navigation delegate cancels every `accounts.google.com` navigation and these own-host starts: `/api/auth/google`, `/api/gbp/connect`, `/api/ads/connect`, `/api/gsc/connect`. It starts `ASWebAuthenticationSession` with `app=1`, `callbackURLScheme: "constructhub"` and `prefersEphemeralWebBrowserSession = false`. Existing start-URL query parameters are retained. No Google OAuth page loads in WKWebView.

The server must finish with `constructhub://auth-done?code=<one-time-code>`. Only the active authentication session handles that callback; there is intentionally no generic URL handler accepting unsolicited exchange codes. The app verifies the callback scheme/host and loads `https://<originating-host>/api/auth/app-exchange?code=<encoded-code>` in WKWebView. The server sets its HttpOnly session cookie and redirects. The code is neither logged nor persisted nor used as the retry destination. Cancellation leaves the current page intact. Both apps register the required scheme; ASWebAuthenticationSession associates the callback with its calling session.

**Parallel server/web work is required:** native and browser-session cookies are separate, even with `prefersEphemeralWebBrowserSession = false`. Connection state must be bound securely on the server and usable across that transition. The existing GBP/GSC JSON flows and Ads POST return a direct Google URL: the shell preserves its OAuth state/scope and adds `app=1`, deriving the exchange host only from an allowed `redirect_uri`. Adding `app=1` to a Google URL does not itself change server-side OAuth state. Those APIs must create app-aware state and return a browser-ready connection URL (or directly issue the agreed callback after Google returns). Browser-start endpoints must support GET; a native auth session cannot replay an Ads POST body. A directly intercepted Google **login** callback falls back to the allowed host's `/api/auth/google?app=1`. End-to-end connections cannot work against the old server alone. Avoid returning `format=json` starts to the browser session.

## JavaScript bridge

Available only to HTTPS main-frame pages on allowed hosts:

```js
window.webkit?.messageHandlers.ch.postMessage({ type: 'enablePush' });
window.webkit?.messageHandlers.ch.postMessage({
  type: 'share', url: 'https://constructhub.us/example', title: 'Project update'
});
window.webkit?.messageHandlers.ch.postMessage({ type: 'haptic' });
```

`enablePush` asks for notification authorization only after that message. The page should send it following an intentional user action and explain the benefit. `share` accepts an HTTP(S) URL and optional title. `haptic` produces a light impact. Unknown types, untrusted origins and subframes are ignored. Messages are fire-and-forget; no promise/response protocol is exposed.

Push is **on** (`CH_PUSH_ENABLED=YES`, `CODE_SIGN_ENTITLEMENTS=Shared/Push.entitlements`). Push Notifications is enabled on both Apple app identifiers and the App Store profiles carry `aps-environment=production` (`npx tsx scripts/asc.ts ensure-push`, 2026-10-05). The entitlement reads `$(APS_ENVIRONMENT)`: `development` for Debug, `production` for Release. No silent/background push capability is needed for alert notifications.

The page sends `enablePush` from Settings → Notifications ("Notifications on this iPhone", `client/src/components/app-push-card.tsx`), shown only inside the app. On later launches the app registers again by itself when notifications are already allowed, so a changed device token reaches the server.

After APNs registration, the page runs a credentialed same-origin POST to `/api/app/push-token` with JSON `{token, app: "platform" | "crm", platform: "ios"}`. This uses the current allowed HTTPS page's session cookies without reading them in native code. Registration is idempotent and bound to the signed-in account and session (`server/app-push.ts`); a signed-out or expired session receives nothing. Unsuccessful sends retry on the next completed navigation or enable request. The token remains only in process memory. Tapped notifications containing an allowed HTTP(S) `userInfo.url` open that page, including cold launch; external URLs are ignored. Banners also show while the app is open.

Delivery: `server/apns.ts` (team APNs key, HTTP/2 to `api.push.apple.com`, topic = bundle ID). Every in-app alert pushes too: the site's bell (`notifyUser`) → ConstructHUB; CRM alerts (`notifyMembers`) → ConstructHUB CRM, except Call Assistant alerts, which open `/call-assistant` in ConstructHUB. Tokens Apple reports dead are deleted. Off unless `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID` are set on the server.

## CI and compilation evidence

[The workflow](../.github/workflows/ios-build-check.yml) runs on relevant pushes and manual dispatch. It lists `/Applications/Xcode_26*.app`, selects the highest numeric version, fails clearly if absent, installs XcodeGen, and builds **both** simulator schemes even if one fails. Its always-run result step writes `ios-build-check/<12-character-sha>.md` on a separate `ios-results` branch with each scheme's pass/fail, error lines first and the last 60 log lines. Setup failures are reported as builds not run. Logs and the report are also uploaded as an Actions artifact.

The built-in `GITHUB_TOKEN` needs `contents: write`; branch protection must permit the workflow's `ios-results` update. The publisher creates an orphan branch if missing and retries non-fast-forward races without force pushing. Result-only commits don't match the workflow's path filters. A checkout failure, runner termination or token/branch-policy failure can prevent publication; check the Actions run in those cases. No personal token is required by the workflow, and this worktree has not pushed or triggered it.

**Compilation is not yet proven.** This Linux tower has no Swift/Xcode toolchain. Local checks cover plists, assets, YAML, shell/Python syntax and report generation. The first Xcode 26 CI result is a release gate, not an assumed pass. SDK signatures were checked against Apple's documentation, including [WebKit downloads](https://developer.apple.com/documentation/webkit/wkdownloaddelegate), [async JavaScript](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:)), and [browser authentication](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession). The iOS 16-compatible `init(url:callbackURLScheme:completionHandler:)` exists but is deprecated in newer SDKs; it is intentionally used instead of the newer callback API.

## Still needed before release

- Successful Xcode 26 CI builds; real-device TestFlight coverage for both apps on minimum and current iOS: session persistence, safe areas/keyboard/rotation, offline recovery, OAuth login and all account connections, cancellation, camera/photo/video attachments, authenticated PDF/audio/blob downloads, external and blank-target links, and warm/cold push taps.
- ConstructHUB-specific signing, App Store Connect app records/API key, distribution profiles, final icons, screenshots, availability and privacy labels/review notes/demo accounts/recording.
- Test push delivery and taps on real devices (TestFlight).
- Share extension (not implemented); optional Face ID reopen (not implemented).
- Web-side App Store requirements from the plan: no sales UI or trackers, Sign in with Apple when Google is offered, AI consent and real account deletion. The native shell is not proof those web requirements are complete.
