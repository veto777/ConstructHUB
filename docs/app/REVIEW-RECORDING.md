# The App Review screen recording (Remindr lesson 1)

Apple asked Remindr for a recording on a **physical iPhone** and that cost 12 days, so ours goes in with the first
submission. One recording per app, about 2–3 minutes each. Install both apps from **TestFlight** (the owner is in the
"Construct Hub team" internal group of each app), then turn on iPhone screen recording (Control Center → ⏺).

Accounts (passwords: `~/.constructhub-keys/review-demo.json` and `review-delete-demo.json` on the tower; the demo
password is also in App Store Connect → App Review Information):
- **Demo** `support+appreview@constructhub.us` — never delete it; it is the reviewer's account.
- **Throwaway** `support+deletedemo@constructhub.us` — deleted on camera. Recreate afterwards with
  `script/create-review-account.ts --plain` if another recording is needed.
- Never use your own account or Sign in with Apple for the deletion part: "Share My Email" could link to your own
  admin account.

## Recording 1 — ConstructHUB: Contractor Tools
1. Open the app from the home screen (shows the launch).
2. On the sign-in screen, tap **Continue with Apple**, show Apple's sheet, then **cancel** it.
3. Sign in with the **throwaway** email and password.
4. Settings → My account → **Delete account** → type DELETE → confirm. The app signs out.
5. Sign in with the **demo** email and password.
6. Menu → Database directory → search "Tampa" → open the City of Tampa portal (opens in Safari) → come back.
7. Property records → scroll a little.
8. Settings → Notifications → **Turn on** → the iPhone permission prompt appears → **Allow**.
9. Settings → Phone tab bar → change a tab → see the bottom bar change.
10. Stop recording.

## Recording 2 — ConstructHUB CRM
1. Open the app (launch), sign in with the **demo** email and password.
2. Clients → open Jordan Rivera.
3. Estimates → open E-1001 (the line items and total).
4. Pipeline, then Schedule (Agenda).
5. More → **Turn on** notifications (if not already allowed for this app) → **Allow**.
6. More → **Delete account** — show the screen, then go back (do **not** delete the demo account).
7. Stop recording.

Then send both videos to Claude (or attach them in App Store Connect → the app → 1.0 → App Review Information →
Attachment). Claude attaches them through the API and submits.
