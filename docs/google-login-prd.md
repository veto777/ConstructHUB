# PRD: "Sign in with Google" for a New Site

## 1. Overview
Build a new website that lets users sign in with their Google account ("Sign in with Google" / Google OAuth 2.0). After signing in, a user has an authenticated session and can access the site's protected pages. This is the same authentication pattern ConstructHUB already uses successfully, reused for a separate site.

## 2. Objective & Background
- **Objective:** Give the new site a fast, secure, password-free login using Google as the identity provider.
- **Why Google login:** No passwords to store or reset, higher trust, faster signup, and it reuses infrastructure the team already understands.
- **Reference implementation:** ConstructHUB authenticates with Google OAuth via Passport.js, with sessions stored in PostgreSQL (`connect-pg-simple`). The new site should follow this proven approach unless there is a reason to diverge.

## 3. Goals
- A visitor can click "Sign in with Google," approve the Google consent screen, and land back on the site logged in.
- A first-time user automatically gets an account created on first sign-in.
- A returning user is recognized and logged into their existing account.
- Sessions persist across page reloads and browser restarts (until expiry or logout).
- A user can log out, which fully clears their session.

## 4. Non-Goals (Out of Scope for v1)
- Email/password login or other social providers (Apple, Facebook, etc.).
- Role-based permissions / admin tiers (can be layered on later).
- Multi-factor authentication beyond what Google itself enforces.
- Billing, subscriptions, or paywalls.

## 5. Key Decision: Account Model (must be chosen before building)
This is the single most important decision and changes the data model.

- **Option A — Independent site (recommended default):** The new site has its **own** user table and its own Google OAuth client. A user signing into the new site is a separate account from ConstructHUB, even if they use the same Google email. Simplest, fully isolated, no risk to ConstructHUB's data.
- **Option B — Shared Single Sign-On (SSO) with ConstructHUB:** One login works across both sites and they share the same user records. This is more powerful but more complex: it requires a shared auth service or shared user database, a shared session domain or token strategy, and careful security review. Only choose this if the two sites are meant to feel like one product.

**Recommendation:** Start with **Option A** unless the explicit requirement is "one account for both sites." The rest of this PRD assumes Option A; notes are added where Option B differs.

## 6. User Stories
1. As a new visitor, I can click "Sign in with Google" and create my account in one step.
2. As a returning user, I sign in with Google and immediately see my logged-in state (name, avatar).
3. As a logged-in user, I can navigate protected pages without re-authenticating.
4. As a logged-in user, I can log out and confirm I am signed out.
5. As a user who denies the Google consent screen, I am returned to the login page with a clear, friendly message.

## 7. Functional Requirements

### 7.1 Sign-in flow (OAuth 2.0 Authorization Code)
1. User clicks "Sign in with Google."
2. Site redirects to Google's OAuth consent screen with a `state` parameter (CSRF protection) and requested scopes.
3. User approves; Google redirects back to the site's **redirect URI** with an authorization code.
4. Server exchanges the code for tokens and fetches the user's Google profile (id, email, name, picture).
5. Server finds the user by Google account id (or email) — creates the account if it does not exist ("upsert").
6. Server establishes a session and redirects the user to the post-login landing page.

### 7.2 Requested scopes (minimum)
- `openid`
- `email`
- `profile`

Do not request more than needed. Extra scopes slow Google's verification and reduce user trust.

### 7.3 Session management
- Create a server-side session on successful login; store the session in PostgreSQL.
- Session cookie must be `httpOnly`, `secure` (HTTPS), and `sameSite=lax`.
- Reasonable expiry (e.g., 30 days) with sliding renewal acceptable.
- Logout destroys the server session and clears the cookie.

### 7.4 Account record (upsert) behavior
- On first sign-in, create a user with: Google subject id, email, display name, avatar URL, created timestamp.
- On subsequent sign-ins, update name/avatar if changed; do not duplicate the account.
- Match primarily on the stable Google `sub` (subject id), not just email.

### 7.5 Protected routes
- Unauthenticated requests to protected pages redirect to the login page.
- Authenticated requests resolve the current user from the session.

### 7.6 Error & edge handling
- User denies consent -> return to login with a friendly message.
- Invalid/expired `state` -> reject and restart the flow.
- Google profile missing email -> block with a clear error (email is required).
- Network/token-exchange failure -> show a retry-able error, log server-side.

## 8. Google Cloud Console Setup (prerequisite)
1. Create (or reuse) a Google Cloud project.
2. Configure the **OAuth consent screen**: app name, support email, app logo, privacy policy URL, terms URL, and authorized domain (the new site's domain).
3. Create an **OAuth 2.0 Client ID** of type **Web application**.
4. Add **Authorized redirect URI(s)** — one fixed, canonical URL per environment, e.g.:
   - Production: `https://<new-site-domain>/auth/google/callback`
   - Local dev (if needed): `http://localhost:5000/auth/google/callback`
5. Add **Authorized JavaScript origins** if a client-side library is used.
6. Publish the consent screen to **"In production"** so any Google user can sign in (in "Testing" mode only allow-listed test users, max 100, can log in).
7. Copy the **Client ID** and **Client Secret** into the site's secrets (see Section 11).

> Lesson learned from ConstructHUB: keep the redirect URI a **single fixed canonical value**, never derived from the request host. Every redirect URI must be pre-registered with Google, so one canonical URI = one registration that covers all users.

## 9. Data Model (Option A)
A minimal `users` table:
- `id` (primary key)
- `google_id` (Google `sub`, unique, indexed)
- `email` (unique)
- `name`
- `avatar_url`
- `created_at`

Plus a `sessions` table managed by the session store (e.g., `connect-pg-simple` auto-creates it).

> Option B (shared SSO) instead points both sites at one shared users/sessions store or a central auth service — not a per-site table.

## 10. Recommended Tech Stack
Mirror ConstructHUB for consistency and speed:
- **Frontend:** React + TypeScript + Vite.
- **Backend:** Express + TypeScript.
- **Auth:** Passport.js with the Google OAuth 2.0 strategy.
- **Session store:** PostgreSQL via `connect-pg-simple`.
- **DB/ORM:** PostgreSQL + Drizzle ORM.

(The flow is stack-agnostic; any framework with an OAuth client works. This stack is recommended only because the team already runs it.)

## 11. Configuration / Secrets
The new site needs its **own** credentials (do not reuse ConstructHUB's OAuth client unless doing Option B intentionally):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` (random long string for signing session cookies)
- `DATABASE_URL` (PostgreSQL connection)

## 12. Security Requirements
- Use the Authorization Code flow with a `state` parameter (and PKCE if using a public client).
- All traffic over HTTPS in production.
- Session cookies: `httpOnly`, `secure`, `sameSite=lax`.
- Never expose the client secret to the browser.
- Validate the `state` parameter on callback to prevent CSRF.
- Store only what is needed from the Google profile; do not store Google access/refresh tokens unless a Google API call is required later.

## 13. Acceptance Criteria
- [ ] Clicking "Sign in with Google" reaches Google's consent screen.
- [ ] Approving consent returns the user to the site fully logged in.
- [ ] A brand-new user gets exactly one account created.
- [ ] A returning user logs into their existing account (no duplicates).
- [ ] Protected pages redirect anonymous users to login.
- [ ] Logout clears the session; protected pages are no longer accessible.
- [ ] Denying consent shows a friendly message, no crash.
- [ ] Sessions survive a page reload and browser restart until expiry.
- [ ] Works in production over HTTPS with the consent screen published.

## 14. Open Questions
1. Account model: **Option A (independent)** or **Option B (shared SSO with ConstructHUB)**?
2. What is the new site's name, domain, and primary purpose? (Needed for the consent screen and product framing.)
3. Where will it be deployed, and what is the production domain (for the redirect URI)?
4. After login, what is the default landing page / what protected features exist?
