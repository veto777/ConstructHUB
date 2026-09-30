# Lane a1 — account security

Built on `lane/a1`, from main `7d2f1d4`. All work and tests use local port 8129 and `constructhub_dev_a1`. No deployment, push, production access, real Google writes, paid AI calls, or SMTP delivery.

## What changed / where to use it

- Growth app header: notification bell, unread count, recent notifications, individual/all mark-read, and destination links. Uses the existing `/api/notifications` service.
- **Settings → Notifications** (`/settings?tab=notifications`): real persisted per-kind in-app/email preferences. Security email is visibly always on and cannot be disabled. Malformed preference/read requests are rejected. `KIND_DEFAULTS` is unchanged; no new notification kinds.
- **Settings → Security & activity** (`/settings?tab=security`): password change, easy authenticator enrollment with QR, recovery codes, remembered-device revocation, and the newest 200 activity records with event-type/date filters, time, IP, and device. Removed the inert “sign out all other sessions” control rather than presenting it as functional.
- Every successfully saved GBP callback grant and each account actually disconnected generates the existing `google.connected` / `google.disconnected` notification plus activity record. Alerts include account email, UTC time, request IP, and device. **Wasn't you?** links to `/settings?tab=security&google=<subject>`. A deliberate button disconnects that account (with step-up), then prompts password reset; loading the link itself has no side effects. Google-only users are also prompted to secure their Google identity.
- Activity covers password and Google sign-in success, known-account password/2FA failures, password change/reset, 2FA enable/disable, GBP connect/disconnect, confirmed GBP reply publish/delete, reauthentication, recovery-code replacement, and device revocation. Unknown-account failures cannot be assigned to an owner and are not put in another user's log. Profile Guard/social lanes can continue calling the existing `logActivity`; their events appear automatically in the activity list/filter.
- Sensitive actions require verification within 12 hours: GBP connect/disconnect and 2FA disable. Verification uses TOTP when enabled, otherwise the account password, otherwise a short-lived emailed six-digit code. Codes have an attempt limit and use the local email sink in tests. Login with a remembered device or a recovery code does not grant fresh step-up verification. Recovery codes restore sign-in; changing protected settings still requires the configured verification method. Replies/posts do not require step-up.
- `apiRequest` detects `403 {reauth:true}`, opens the growth-app verification modal, then retries the original request once. Google connect links use JSON preflight before navigating to Google consent.
- Two-factor sign-in now has an actual challenge screen for password and Google sign-in. Pending challenges expire in 10 minutes. Ten random, hashed, one-time recovery codes are shown once at enrollment/replacement; atomic deletion prevents concurrent reuse. A signed, httpOnly, SameSite=Lax cookie can remember a device for 30 days; database ownership/expiry/revocation is checked each time. Password changes/resets and disabling 2FA revoke remembered devices. Device revocation requires 2FA on subsequent sign-in, but does not terminate an already authenticated session.
- Google sign-in's existing 2FA branch now fails closed on errors instead of swallowing them and continuing.

## Encryption and owner configuration

`GBP_TOKEN_KEY` must contain exactly 32 random bytes encoded as base64. Generate it once in the target environment:

```sh
openssl rand -base64 32
```

Store the result securely in the environment as `GBP_TOKEN_KEY`; do not commit it. Keep it with encrypted backups and retain it across restarts. Production boot fails if it is missing or invalid. Development can derive a key from `SESSION_SECRET`, with a loud warning; this is only a development fallback. Do not rotate either key casually: encrypted records need explicit decrypt/re-encrypt migration under the old/new keys. There is no automated key-rotation workflow in this lane.

GBP access/refresh tokens and existing authenticator secrets use AES-256-GCM with random 12-byte IVs and authentication tags (`v1:` envelope). Boot migrates existing plaintext with compare-and-swap updates and validates existing ciphertext; repeating boot does not re-encrypt rows. Grant access, refresh, and revocation decrypt only at the provider boundary. Token status responses never expose credentials. Auth/consent response bodies are excluded from request logs so QR enrollment seeds and recovery codes cannot leak through logging. The enrollment seed must be delivered once to the authenticated user's authenticator setup UI; stored secrets are never included in general account responses.

Schema additions are solely `ensureAccountSecuritySchema()` in `server/account-security.ts`, registered at boot next to `ensureGbpSchema`; GBP migration is `ensureGbpTokenEncryption()` in `server/gbp/token-crypto.ts`. No drizzle push. Tables: `account_recovery_codes`, `account_trusted_devices`.

## Integration contract for lane a2

```ts
import { requireRecentAuth } from './account-security';
// After authenticating and before changing Profile Guard mode:
if (!requireRecentAuth(req, res)) return;
// Also supports Express middleware usage with next().
```

The gate binds the verification timestamp to `req.user.id` and rejects expired/future timestamps. Client code using the existing `apiRequest` already gets the modal/retry behavior in the growth app. A reusable hook is exported from `client/src/hooks/use-recent-auth.ts`: `useRecentAuth().request` is that request helper, and `.verify()` explicitly opens verification. Continue using `logActivity(req, userId, kind, detail)` directly for Profile Guard approval/rejection and social publishing; this lane adds no competing event API.

## Validation

- Focused real-Postgres tests cover random-IV round trips, tamper detection, required production key, idempotent plaintext migration, 12-hour/owner binding, concurrent recovery-code consumption, remembered-device signing/expiry/owner isolation/revocation, password/TOTP step-up, Google-only email-code consumption/replay denial, and the Google callback's 2FA and trusted-device branches.
- Existing GBP integration tests continue using injected/mocked Google fetch, including callback, grant refresh, disconnect, reply publish/delete, and sync. Assertions now expect encrypted persistence.
- Playwright (`playwright.security.config.ts`), with bypass OFF: QR enrollment → recovery-code sign-in → remember/revoke device → expired-session TOTP modal and automatic retry → persisted preferences → bell/read state → activity filters → 2FA disable; a second flow follows the Google security alert through password step-up, account disconnect, reset prompt, and mocked Google consent.
- Email remains in `tmp/email-outbox.jsonl` through `EMAIL_FORCE_SINK=1`. GBP background sync is disabled while testing. Fixtures are isolated and cleaned up. OAuth consent/provider writes are mocked; no real Google consent/account was exercised.

Final validation: `npm run check` — 0 errors. `CRM_TEST_SINGLE_PORT=true npx vitest run` — 83 files passed, 2 files skipped; 791 tests passed, 43 skipped (existing single-port/conditional suites). `E2E_PORT=8129 E2E_DB=constructhub_dev_a1 npx playwright test --config=playwright.security.config.ts` — 2 flows passed, including a separate actual TOTP sign-in and rejection of a consumed recovery code. Browser runs require `DEV_AUTH_BYPASS_USER1=false`, `VITE_FORCE_PORTAL=false`, `GBP_SYNC_DISABLED=true`, and `EMAIL_FORCE_SINK=1`; the full Vitest server uses the lane's normal dev bypass. All environment variables are exported from the lane `.env` with Node 20 before launching.

## Limits

The activity view filters its most recent 200 records; it is not an archival export. IP/device strings are request metadata, not a verified physical location or device identity. Existing sessions are not globally revoked by a remembered-device revocation. Google-only users must secure their Google account at Google; the ConstructHUB reset endpoint deliberately does not add a password to those accounts. Production requires the persistent encryption key, existing session secret, normal email delivery configuration, and existing Google OAuth credentials/callback configuration. No external configuration was changed by this lane.
