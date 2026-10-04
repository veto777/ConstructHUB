# Lane 1 · Settings — the account-side tabs (`/settings`)

Audit agent: setme · branch audit/1 · 2026-10-04
Scope: the settings shell and the **Me** tabs (My account, Password & security, Notifications) plus
**Workspace → Integrations** and **Workspace → Audit log**. The other Workspace tabs (Billing,
Limits & usage, API keys, API usage) render panels owned by other lanes — they are listed in the
shell map only as nav entries. Dev user: platform admin id 1 (dev@constructhub.local) on
`constructhub_dev_a6`. The dev server runs portal-mode, so pages were verified in the growth app via
`?portal=0` (portal mode renders CRM home for `/settings`; the growth settings page is unreachable
there by design of `PortalRouter` — App.tsx:388).

Server files behind these pages: `server/auth.ts` (me, profile, change-password, 2FA),
`server/account-security.ts` (devices, recovery codes, reauth), `server/account-events.ts`
(notification prefs, account activity), `server/account/integrations-route.ts` (integrations),
`server/routes.ts` (review-templates, beta-codes, upload/logo, review-referral-settings),
`server/gbp/routes.ts` (gbp status/disconnect).

Legend — Verified how: SQL = read-only psql on constructhub_dev_a6; curl = GET/PUT against
127.0.0.1:8301/api (dev bypass user 1); browser = Playwright chromium with ch_consent=denied;
route check = route exists in client/src/App.tsx; code only = no live proof taken.

## Shell (`/settings`, client/src/pages/settings.tsx + settings/nav.tsx + settings/sections.tsx + settings/shared.tsx)

The shell: header "Account settings / Manage your account and workspace.", a close button, a left
rail (lg+) or sheet menu (below lg) with two groups, the section header (title + description + ⓘ
InfoTip from lib/info-content.ts), and the active section's panel. The open section is `?tab=` so
reloads/deep links reopen it; old tab names (profile, password, plans, invoices, usage, api, audit…)
resolve through TAB_ALIASES (sections.tsx:76). `/settings/billing[?billing=invoices]` and
`/settings/api[?api=usage]` redirect to `?tab=` (App.tsx:133-150). Unknown `?tab=` falls back to
My account. Signed-out visitors are sent to `/auth?next=/settings…` (SIGNED_IN_ONLY, App.tsx:336).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Account settings" title / text-settings-title | Heading | Names the page. | settings.tsx:66 | — client only | browser | OK |
| Close (X) / button-close-settings | Button | Goes back one entry if you arrived in-app, otherwise home (`/`). | settings.tsx:67-82 (previousEntryIsInApp:30) | — client only | code only | OK |
| Left rail "Me" group (My account, Password & security, Notifications) / nav-settings-group-me, button-settings-tab-account|security|notifications | Nav buttons | Switch the open section; sets `?tab=`. | nav.tsx:23-49, sections.tsx:27-30 | — client only | browser | OK |
| Left rail "Workspace" group (Billing, Limits & usage, API keys, API usage, Audit log, Integrations) / nav-settings-group-workspace, button-settings-tab-{id} | Nav buttons | Switch the open section; Billing deep views via ?view=. Billing/Limits/API panels are other lanes' pages. | nav.tsx:23-49, sections.tsx:31-36 | — client only | browser | OK |
| Mobile "Settings section: …" menu / button-settings-menu, sheet-settings-menu, button-settings-menu-{id} | Sheet + buttons | Below lg the rail becomes a menu button opening the same two groups in a left sheet. | nav.tsx:51-94 | — client only | code only | OK |
| Section header title + description + ⓘ / text-settings-section-title | Header + info popover | Shows the section's name, one-line description and an ⓘ explainer (infoKey → lib/info-content.ts:631-715, all 9 keys exist). | shared.tsx:19-37, sections.tsx:28-36 | — client only | route check (info-content.ts) | OK |
| `?tab=` / `?view=` URL params | URL state | Remember the open section (and Billing inner tab) across reloads/shared links; old names keep working. | settings.tsx:44-48, sections.tsx:76-104, hooks/use-url-param.ts | — client only | browser | OK |
| Loading state / LoadingCard | Placeholder | "Loading…" spinner while a panel's data loads. | shared.tsx:39-47 | — client only | code only | OK |
| Unknown section → My account | Redirect | A bad `?tab=` value opens My account instead of a blank page. | sections.tsx:99-104 | — client only | browser (portal=0 sanity) | OK |

## My account (client/src/pages/settings/me-account.tsx → section-account)

Seeds from `GET /api/auth/me` (server/auth.ts:668 → users row for session user; fields id, accountId,
email, displayName, avatarUrl, emailVerified, googleId(bool), companyName, companyLogoUrl,
googleProfileUrl, totpEnabled, hasPassword, hasGbpAccess, isPlatformAdmin, createdAt).

**Profile information card (card-profile)**

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Avatar image / img-avatar | Image | Shows your profile photo, or initial-based placeholder. | me-account.tsx:174-188 | GET /api/auth/me → auth.ts:678 → users.avatar_url | SQL vs curl — both null for user 1 → placeholder shown | OK |
| Change-photo camera button / button-change-avatar, input-avatar-upload | File input | Picks a photo, downsizes to ≤256px/~400KB, uploads, then saves the URL on your profile. | me-account.tsx:115-132, 189-208 | POST /api/upload/logo {imageData,type:"avatar"} → routes.ts:5947 → R2 ("avatars"), then PATCH /api/auth/me … PATCH /api/auth/profile {avatarUrl} → auth.ts:736-742 → users.avatar_url (accepts data:, http(s), /api/files/) | code only (R2 not configured on dev → 503 toast path verified at routes.ts:5970) | OK |
| Name + email + "Verified" badge / text-profile-name, text-profile-email | Text + badge | Shows your display name, sign-in email, and a green "Verified" badge only when the email is verified. | me-account.tsx:210-218 | GET /api/auth/me → auth.ts:674-679 → users.display_name, users.email, users.email_verified | browser ("Veto", "dev@constructhub.local", no badge) = SQL | OK |
| Display name / input-display-name | Input (required) | Your name across the app; Save is blocked while empty. Writes users.display_name. | me-account.tsx:222-239, 69-73 | PATCH /api/auth/profile → auth.ts:705-709 → users.display_name (trim, ≤200, 400 if empty) | code only | OK |
| Email / input-email | Input (disabled) | Shows your sign-in email; cannot be edited here. | me-account.tsx:240-249 | GET /api/auth/me → users.email | browser = SQL | OK |
| Company name / input-company-name | Input | Your business name — printed on review-request emails; saving also rewrites it on your past review requests. Writes users.company_name. | me-account.tsx:250-260 | PATCH /api/auth/profile → auth.ts:710, 745-749 → users.company_name + review_requests.company_name (same userId) | browser ("Alpine Exteriors Test") = SQL | OK |
| Company logo / img-company-logo, button-remove-logo, logo-placeholder, input-logo-upload | Image + remove + file input | Shows your logo on review emails. Upload resizes and stores to R2; if storage fails the image stays in the form and is stored inline when you save. Writes users.company_logo_url. | me-account.tsx:261-305, 134-153 | POST /api/upload/logo {type:"company-logo"} → routes.ts:5947 → R2 "logos/company"; PATCH /api/auth/profile {companyLogoUrl} → auth.ts:711-720 → users.company_logo_url (≤1.5M chars, data:/http//api/files/ only) | code only (user 1 has ""; placeholder shown — SQL) | OK |
| Save changes / button-save-profile | Button | Saves name, company, logo. Never sends googleProfileUrl, so an old saved link can't block an unrelated save. | me-account.tsx:160-169, 65-83 | PATCH /api/auth/profile → auth.ts:698-767 → users; response = updated profile; client invalidates /api/auth/me | code only | OK |
| "Review referral settings" / details>summary | Collapsed section | Opens the referral-offer editor (toggle + 500-char terms → PUT /api/review-referral-settings → routes.ts:5702, parsed by referralSettingsInput). Current dev data {enabled:true, offer:"x"} is another lane's fixture — not touched. | me-account.tsx:312; review-referral-settings.tsx | GET/PUT /api/review-referral-settings → routes.ts:5698-5705 | curl (GET {enabled:true,offer:"x"}) | OK |

**Google Business Profiles card (card-gmb-profiles)** — the review-request destinations. Reads
`GET /api/review-templates` (routes.ts:5012 → storage.getReviewTemplatesByUser → review_templates
where user_id = you).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Add profile" / button-add-gmb-profile | Button | Opens the Add/Edit dialog. | me-account.tsx:423-425 | — client only | code only | OK |
| Empty state / empty-gmb-profiles | Empty state | "No GMB profiles added yet" when you have none. | me-account.tsx:430-435 | — client only | code only (user 1 has 1 row → list shown) | OK |
| Profile row (icon, name, "Default" badge, link) / gmb-profile-{id}, text-gmb-name-{id} | Row + badge | Lists one GMB location; the Default badge marks which one review requests use out of the box. | me-account.tsx:438-460 | GET /api/review-templates → review_templates.name, google_profile_url, is_default | browser 1 row "R2-r1 template", isDefault badge = SQL id 13 | OK |
| "Set Default" / button-set-default-{id} | Button | Makes that profile the default (only on non-default rows). | me-account.tsx:462-472 | PATCH /api/review-templates/:id {isDefault:true} → routes.ts:5098-5104 → clears other defaults, sets review_templates.is_default | code only | OK |
| Edit pencil / button-edit-gmb-{id} | Button | Opens the dialog pre-filled. | me-account.tsx:473-482 | — client only | code only | OK |
| Remove trash / button-delete-gmb-{id} + dialog-confirm-delete-gmb (Cancel / button-confirm-delete-gmb "Remove profile") | Button + confirm dialog | Deletes the profile after a confirm. Already-sent requests keep their link. | me-account.tsx:483-520, 373-385 | DELETE /api/review-templates/:id → routes.ts:5114 → storage.deleteReviewTemplate → review_templates (own rows only → 404 otherwise) | code only — NOT pressed (no AUDIT- template created; only fixture row exists) | OK |
| Dialog fields: "Profile / Location Name" / input-gmb-name; "Google Review Link" / input-gmb-url (+ format hint); "Description" / input-gmb-description; Cancel / button-cancel-gmb; Save / button-save-gmb | Dialog inputs + buttons | Adds or edits a profile. The link is validated client-side (Google hosts / g.page / goo.gl / share.google / maps) and re-checked server-side only when changed. | me-account.tsx:522-587, 45-55 | POST /api/review-templates → routes.ts:5023 (plan limit on review_templates count, resolveReviewLink) → review_templates.*; PATCH → routes.ts:5075 | code only | OK |

**Account details card (card-account)**

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Account ID / text-account-id | Code | Your unique identifier for support. Shows "—" when null. | me-account.tsx:608-616 | GET /api/auth/me → auth.ts:675 → users.account_id | browser "—" = SQL (NULL for user 1; 10/12 other users have one) | OK |
| Member since / text-member-since | Text | When you joined, in your browser's locale. | me-account.tsx:617-625 | GET /api/auth/me → users.created_at | browser "7/29/2026" = SQL 2026-07-29 | OK |
| Login method / text-login-method | Badge | "Google" when a Google account is linked, else "Email & Password". | me-account.tsx:626-642 | GET /api/auth/me → auth.ts:680 → users.google_id present | browser "Email & Password", googleId=false = SQL google_id NULL | OK |

Note: the badge only distinguishes Google vs not. For the rare account with neither a Google link
nor a password (possible shape per auth.ts email-code reauth path; true for dev user 1,
hasPassword=false) it still says "Email & Password". Dev-only shape — reported, not fixed.

**Trials and invite codes (platform admins only; open by default for admins)** — BetaAccessSection.
Reads `GET /api/beta-codes/status` (routes.ts:5675 → subscriptions row without stripe id, live
trial = status trialing/active and current_period_end in the future, joined with the newest
unrevoked redeemed beta_access_codes row) and, for admins, `GET /api/beta-codes` (routes.ts:5599 →
all beta_access_codes + redeemer user fields).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Trial status banner / text-beta-active, text-trial-plan | Banner | "Agency trial active" + time remaining while a trial grant is live; otherwise the code-entry form. Plan name from PLANS[effectivePlanKey(subscription plan)]. | me-account.tsx:820-855, 704-709 | GET /api/beta-codes/status → routes.ts:5675-5695 → subscriptions + beta_access_codes | curl {active:false}; browser shows entry form | OK |
| Code entry / input-beta-code + Activate / button-redeem-beta | Input + button | Redeems a trial code for the Agency plan; billing/limits/agency caches refresh after. | me-account.tsx:836-853, 719-737 | POST /api/beta-codes/redeem → routes.ts:5649 → beta_access_codes lookup (not revoked/used/expired) → redeemTrialCode | code only — NOT pressed (no AUDIT- code created) | OK |
| Admin "New Trial" / button-toggle-create-trial + create form (Unlimited ∞ / input-unlimited-toggle, days / input-trial-days + text-trial-days, quick picks button-trial-days-{7,30,365,1000}, recipient name/email inputs, generate / button-generate-trial) | Admin form | Creates a trial invite (1–1000 days or until-revoked), optionally emails it; copies the invite link to the clipboard; the toast reports truthfully whether the email sent. | me-account.tsx:859-971, 739-768 | POST /api/beta-codes/generate → routes.ts:5550 → isAdmin gate → trialCodeDays bounds → insert beta_access_codes (code TRIAL-XXXXXXXX, expiresAt now+days or 2099 for unlimited) + sendTrialInviteEmail | code only — NOT pressed | OK |
| Code list rows / row-beta-code-{id}, text-beta-code-{id}, button-copy-code-{id}, badge-status-{id}, button-revoke-{id} | Rows + badges + buttons | Lists every code: copy the invite link, a length badge (∞ or Nd), status (Pending / Active=redeemed / Expired / Revoked) and a Revoke button (except revoked/expired). | me-account.tsx:980-1050, 770-808 | GET /api/beta-codes → routes.ts:5599; POST /api/beta-codes/revoke/:id → routes.ts:5627 → revokeBetaAccessCode + endRevokedTrial | browser 10 rows = curl | OK |
| Status badge logic | Badge | revoked→"Revoked", redeemed→"Active", past redemption window→"Expired", else "Pending". Note: "Active" reflects the code being redeemed, not whether the trial itself is still live — reported as observation. | me-account.tsx:803-808 | — client only | code only | OK |
| "No trial codes yet" / text-no-codes | Empty state | Shown when the admin list is empty. | me-account.tsx:1046-1049 | — client only | code only | OK |

**Delete account (card-danger-zone)** — there is no self-serve deletion endpoint (comment at
me-account.tsx:594-599); "Request deletion" opens a dialog whose action is a prefilled
`mailto:support@constructhub.us` naming the account email + ID. Nothing is deleted by the app.
Per audit rules this is report-only.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Request deletion" / button-delete-account | Button | Opens the confirm dialog. | me-account.tsx:661-664 | — client only | browser (not pressed) | OK |
| Dialog: Cancel / button-cancel-request-deletion; "Email support@constructhub.us" / link-request-deletion-email; privacy-policy link | Dialog + mailto link | Composing the email is the request; support handles deletion under the privacy policy; the /privacy link renders the PrivacyPolicyPage (App.tsx:325). | me-account.tsx:668-685 | — client only (mailto + route check) | route check | OK |

## Password & security (client/src/pages/settings/me-security.tsx → section-security)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Two-factor card / card-two-factor | Card | Container for 2FA setup/disable/recovery codes. | me-security.tsx:206-360 | — client only | browser | OK |
| "Enable 2FA" / button-enable-2fa | Button | Starts TOTP setup: stores an encrypted secret (not yet enabled) and shows QR + manual key. | me-security.tsx:291-300, 157-168 | POST /api/auth/2fa/setup → auth.ts:803 (requires recent auth, 403 {reauth:true} otherwise → client opens the verify-identity dialog) → users.totp_secret (encrypted v1:), returns secret + QR data URL | code only — NOT pressed (would touch the dev admin's 2FA state) | OK |
| QR image / img-2fa-qr, secret / text-2fa-secret, copy / button-copy-2fa-secret | Image + code + copy | Shows the scannable QR and the manual entry key during setup. | me-security.tsx:303-331 | — client only | code only | OK |
| Verify code / input-verify-2fa-code + "Verify & Enable" / button-verify-2fa | Input + button | Verifies the first code; on success enables 2FA and shows 10 one-time recovery codes (each usable once, never shown again). | me-security.tsx:332-353, 170-185 | POST /api/auth/2fa/verify → auth.ts:842 → TOTP validate(window 1) → account-security.ts:66 activateTwoFactor (tx: users.totp_enabled=true + 10 rows account_recovery_codes) + security.2fa_changed activity/notification | code only — NOT pressed | OK |
| Recovery codes block + "I saved my codes" | One-time display | Lists the new codes after enable/regenerate; dismiss button. | me-security.tsx:211-217 | — client only | code only | OK |
| "Generate new recovery codes" | Button | Replaces all recovery codes (requires recent auth → verify-identity dialog). | me-security.tsx:218-232 | POST /api/auth/2fa/recovery-codes → account-security.ts:152-159 → replaceRecoveryCodes → DELETE+INSERT account_recovery_codes (tx) + security.recovery_codes_changed | code only — NOT pressed | OK |
| "2FA is enabled" panel + "Disable 2FA" / button-disable-2fa | Banner + button | Shows when enabled; opens the disable flow. | me-security.tsx:233-252 | state from GET /api/auth/me → users.totp_enabled | browser: not shown for user 1 (totp_enabled=f = SQL) | OK |
| Disable code / input-disable-2fa-code + "Confirm Disable" / button-confirm-disable-2fa + Cancel / button-cancel-disable-2fa | Input + buttons | Disables 2FA after a valid authenticator code; wipes secret, recovery codes and remembered devices. | me-security.tsx:254-281, 187-201 | POST /api/auth/2fa/disable → auth.ts:883 → users.totp_enabled=false, totp_secret=null, DELETE account_recovery_codes, revokeDevices + security.2fa_changed | code only — NOT pressed (never disable the dev admin's 2FA) | OK |
| "Cancel Setup" / button-cancel-2fa-setup | Button | Abandons setup (the stored secret stays but 2FA stays off; next setup overwrites it). | me-security.tsx:354-356 | — client only | code only | OK |
| Change password card / card-change-password (only when hasPassword) | Card + 3 password inputs + 2 show/hide eye toggles + "Update password" / button-change-password | Changes your password after checking the current one; signs out remembered devices and emails/notifies you. | me-security.tsx:45-147, 71-146 | POST /api/auth/change-password → auth.ts:769 → bcrypt compare → users.password_hash, revokeDevices (DELETE account_trusted_devices), security.password_changed activity + notifyUser + CRM owner-notification | code only — NOT pressed | OK |
| "No password" card / card-no-password | Card | For accounts without a password: explains you sign in with Google (or "nothing to change here"). | me-security.tsx:23-39 | GET /api/auth/me → hasPassword=!!users.password_hash, googleId | browser: shown for user 1 ("This account has no password set…") = SQL (no password_hash, no google_id) | OK |
| Remembered devices card ("No remembered devices.", per-device "Revoke device") | Card + list | Lists trusted devices (cookie-remembered for 30 days) with expiry; Revoke deletes one. | account-security.tsx:77 | GET /api/auth/devices → account-security.ts:140 → account_trusted_devices WHERE user_id AND expires_at>now() ORDER BY created_at DESC; DELETE /api/auth/devices/:id → :145 (id must be 32 hex; logs security.device_revoked) | browser "No remembered devices." = SQL count 0 | OK |
| "Wasn't you?" card (only with ?google=<subject>) | Card | Security remediation: disconnect that Google account + reset password links. | account-security.tsx:74-76 | POST /api/gbp/disconnect {subject} → gbp/routes.ts:67 (requires recent auth; 404 for unknown subject); GET /api/gbp/status → gbp/routes.ts:60 → gbp_grants | code only (no ?google= link followed) | OK |
| Account activity card (activity-type select, since date, rows / row-account-activity, "Most recent 200 events.") | Card + filter + list | The same 200 newest events as the Audit log, security-focused, client-filtered by kind and since-local-midnight. | account-security.tsx:78-82 | GET /api/account-activity → account-events.ts:107 → account_activity WHERE user_id=1 ORDER BY created_at DESC LIMIT 200 | browser 200 rows, 25 kind options; SQL 307 rows total → 200 returned | OK |

## Notifications (client/src/pages/settings/me-notifications.tsx → section-notifications → @/components/account-security.tsx NotificationPreferences)

One card listing every notification kind in the registry (server/notification-kinds.ts +
cloudflare/domains/api-key kind files — 25 kinds). "Security emails are always on. Changes save
immediately." Each row: label, an **In app** switch, an **Email** switch (labelled "Email (always
on)" and disabled for the 12 security kinds).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Preference rows (25) / switches aria-label "{label}: In app" / "{label}: Email" | Switch rows | Each flip immediately PUTs that one kind and re-reads the list. | account-security.tsx:20-24 | GET /api/notification-prefs → account-events.ts:91 → per kind: user_notification_prefs row if present else KIND_DEFAULTS; email forced true when kind.security. PUT /api/notification-prefs {prefs:[{kind,inApp,email}]} → :96 → INSERT … ON CONFLICT UPDATE user_notification_prefs(user_id,kind,in_app,email) | browser 25 rows/12 always-on; SQL: stored rows for social.post_failed, cloudflare.connected read back correctly | OK |
| "Email (always on)" enforcement | Disabled switch | Security kinds ignore the stored email flag: GET forces email=true and the sender (channelsFor, account-events.ts:41-46) forces email on regardless. | account-security.tsx:23 | channelsFor: email = d.security ? true : p.email — verified by PUTting email=false for security.password_changed: stored f, GET returned true | curl PUT + SQL + GET | OK |
| In-app toggle round-trip (AUDIT-safe) | Switch | Flipping "Site Scan completed" In app off/on wrote and re-wrote user_notification_prefs (in_app f→t), GET reflected each state; restored to defaults. | account-security.tsx:23 | PUT/GET as above | curl + SQL + browser (UI flip checked→unchecked→checked) | OK |
| Error line / role=alert | Text | Shows load/save errors. | account-security.tsx:23 | — | code only | OK |

## Integrations (client/src/pages/settings/integrations.tsx → section-integrations)

Every row comes from `GET /api/account/integrations` (server/account/integrations-route.ts:141 —
purely stored rows, nothing probed live; per-service queries of gbp_grants, ads_grants/ads_accounts,
edge_connections/edge_assets, social_connections, domain_connections/managed_domains,
mail_alert_grants/mail_alert_addresses). Badge: Connected / Not connected / Reconnect needed. Button
label Manage / Reconnect / Connect by status; href is the page that manages the connection. If the
endpoint is missing (404 or HTML fallback), an honest fallback card lists the manage pages instead
(all 8 fallback hrefs exist as routes, incl. /crm/integrations and /crm/payments, App.tsx:410-413).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading / Checking connections… | Placeholder | While GET /api/account/integrations loads. | integrations.tsx:55 | — | code only | OK |
| Error card / text-integrations-error | Error | 5xx/other failures surface as an error, never as an empty list. | integrations.tsx:57-65 | — | code only | OK |
| Fallback card / card-integrations-unavailable | Card + 8 links row-integration-page | Only when the status endpoint doesn't exist on the server: "Connection status isn't available on this server yet" + link per manage page. | integrations.tsx:67-88, 26-35 | — client only (route check for all 8 hrefs) | route check | OK |
| Empty state / text-integrations-empty | Empty state | "No integrations reported" when the endpoint returns zero items. | integrations.tsx:96-101 | — | code only | OK |
| Google Business Profile / row-integration-google_business, badge-integration-status-google_business, link-integration-manage-google_business | Row + badge + Connect/Manage | Status from gbp_grants: reconnect_required → "Reconnect needed" + which account; else Connected with the account emails; else Not connected. Manage → /google-business. | integrations.tsx:103-121; integrations-route.ts:50-57 | GET → SELECT email,reconnect_required FROM gbp_grants WHERE user_id=1 | browser "Not connected — No Google account connected." = SQL count 0 | OK |
| Google Ads manager / row-integration-google_ads | Row + badge + link | From ads_grants (manager) + ads_accounts count; unverified managers say so. Manage → /ads-manager. | integrations-route.ts:59-66 | ads_grants WHERE user_id=1 | browser "Not connected" = SQL 0 | OK |
| Cloudflare / row-integration-cloudflare | Row + badge + link | From edge_connections provider='cloudflare' (a Google token that expired with no refresh token → Reconnect needed) + edge_assets zone count. Manage → /cloudflare. | integrations-route.ts:69-86 | edge_connections/edge_assets WHERE user_id AND provider | browser "Not connected" = SQL 0 | OK |
| Google Search Console / row-integration-search_console | Row + badge + link | Same builder, provider='gsc', properties counted. Manage → /search-console. | integrations-route.ts:69-86 | edge_connections/edge_assets provider='gsc' | browser "Not connected" = SQL 0 | OK |
| Blotato (social media) / row-integration-blotato | Row + badge + link | From social_connections: account count, agency-wide vs per-business keys. Manage → /social-media. | integrations-route.ts:88-96 | social_connections WHERE user_id=1 | browser "Not connected" = SQL 0 | OK |
| Domain registrars / row-integration-registrars | Row + badge + link | From domain_connections (+ provider:label) and managed_domains count; without a key it says how many domains are monitored manually. Manage → /domains. | integrations-route.ts:98-107 | domain_connections, managed_domains WHERE user_id=1 | browser "Not connected — No registrar API key; 3 domains monitored manually." = SQL 3 domains, 0 connections | OK |
| Gmail alert forwarding / row-integration-gmail_alerts | Row + badge + link | From mail_alert_grants (needs_reconnect → Reconnect) + a forwarding address counts as connected. Manage → /mail-alerts. | integrations-route.ts:109-122 | mail_alert_grants, mail_alert_addresses WHERE user_id=1 | browser "Connected — Forwarding address set; no Gmail account connected." = SQL 1 address row, 0 grants | OK |

## Audit log (client/src/pages/settings/audit-log.tsx → section-audit-log)

Source: `GET /api/account-activity` → account-events.ts:107 → `SELECT id,kind,detail,ip,user_agent,
created_at FROM account_activity WHERE user_id=… ORDER BY created_at DESC LIMIT 200` (no time
window; everything ever recorded is kept in the table, only the newest 200 are returned). Times are
timestamptz rendered with `new Date().toLocaleString()` — browser-local time, and the `<time>`
element carries the UTC instant in `datetime`. Labels via the shared activityLabel map
(account-security.tsx:42).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Filters (mobile) button | Button | Below sm the filter grid collapses behind a Filters toggle. | audit-log.tsx:109 | — client only | code only | OK |
| Area select / select-audit-area | Select | Filters rows by the part before the dot in the kind (auth, security, google, gbp, sitescan, social, ads, agency…); options derived from the loaded rows. Resetting clears the Event choice. | audit-log.tsx:111-123, 68, 74-76 | — client only (labels: AREA_LABELS :28) | browser 8 area options; area=security → 28 rows | OK |
| Event select / select-audit-kind | Select | Filters to one exact kind; options depend on the chosen area. | audit-log.tsx:124-136, 69-72 | — client only (activityLabel) | browser 25 options; narrowing worked | OK |
| Since date / input-audit-since | Date input | Keeps rows at or after local midnight of the chosen day (activitySince, account-security.tsx:52). | audit-log.tsx:137-140, 77 | — client only | browser since=2026-10-02 → 54 rows = SQL count on the same 200-row window (>= 2026-10-02T00:00-04) | OK |
| Search / input-audit-search | Input | Case-insensitive match on label, kind, IP, user agent, or detail.email. | audit-log.tsx:141-147, 78-83 | — client only | e2e (settings-shell.spec.ts:260-265) | OK |
| Count line / text-audit-count | Text | "N of M events · the most recent 200 are kept. IP and device describe the request and may reflect a proxy." | audit-log.tsx:150-155 | M = rows returned (≤200) | browser "200 of 200" — copy BUG: older events are NOT deleted; 307 rows exist for user 1, the API just returns the newest 200. See bugs file. | BUG |
| Export CSV / button-audit-export | Button | Downloads the filtered view as CSV (disabled when nothing matches). Time column is UTC ISO while the table shows browser-local times; not labelled. | audit-log.tsx:156-158, 86-101 | — client only | browser: 201 lines (header+200), filename constructhub-audit-log-YYYY-MM-DD.csv, header Time,Event,Kind,Area,IP,Device,Email | OK (CSV-timezone note in bugs file) |
| Error line / text-audit-error | Error | API failures surface here. | audit-log.tsx:160 | — | code only | OK |
| Table header (Time / Event / IP / Device) | Header | xl+ grid header; below xl each row stacks its fields. | audit-log.tsx:167-169 | — | browser screenshot | OK |
| Empty states / text-audit-empty, text-audit-no-match | Text | "Sign-ins, security changes and tool activity will appear here." when there are no rows at all; "No activity matches these filters." when filters hide everything. | audit-log.tsx:170-175 | — | code only | OK |
| Event rows / row-audit-event (time, text-audit-event + area line, IP or "Unavailable", device summary or "Unavailable") | Rows | One row per event: local time, plain-language label (tooltip = raw kind), area (+ email from detail), IP, and a short device name (full UA in tooltip; "Unavailable" when null — background jobs log with no request). | audit-log.tsx:176-191, 37-44 | per-row: account_activity.kind/detail/ip/user_agent/created_at | browser: first row local "10/4/2026, 7:20:25 PM" = datetime attr 2026-10-04T23:20:25.949Z (EDT) ✓; "Social media: auto changed" label matches kind social.auto_changed; null ip/ua rows show "Unavailable" = SQL NULL | OK |
| CSV formula neutralisation | Behaviour | Cells starting with =,+,-,@,tab,CR are prefixed with ' so a spreadsheet never runs a logged email/UA as a formula. | audit-log.tsx:46-57 | — | e2e (settings-shell.spec.ts:275-278) | OK |

## Element counts

| Section | Total | OK | BUG | UNCLEAR | DEAD |
|---|---|---|---|---|---|
| Shell | 9 | 9 | 0 | 0 | 0 |
| My account | 34 | 34 | 0 | 0 | 0 |
| Password & security | 15 | 15 | 0 | 0 | 0 |
| Notifications | 4 | 4 | 0 | 0 | 0 |
| Integrations | 11 | 11 | 0 | 0 | 0 |
| Audit log | 13 | 12 | 1 | 0 | 0 |
| **Total** | **86** | **85** | **1** | **0** | **0** |

(Two observations logged in the bugs file without status BUG: the login-method badge edge case for
a no-password/no-Google account, and the CSV Time column being UTC while the table is local.)
