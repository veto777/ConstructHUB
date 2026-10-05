import { ensureAppPushSchema, registerAppPushRoutes } from "./app-push";
import { ensureAppleAuthSchema, registerAppleAuthRoutes } from "./apple-auth";
import { ensureAppConnectionsSchema, registerAppConnections } from "./app-connections";
import { safeNextPath } from "./app-shell";
import { ensureAppAuthSchema, mintAppCode, consumeAppCode, appAuthHost, appChallenge } from "./app-auth";
import { requireRecentAuth, markRecentAuth, trustedDevice, rememberDevice, activateTwoFactor, consumeRecoveryCode, revokeDevices, securityChanged } from "./account-security";
import { encryptToken, decryptToken } from "./gbp/token-crypto";
import { logActivity } from "./account-events";
import { rateLimit, takeBudget } from "./growth-limits";
import { createHash } from "node:crypto";
import { testAuthAdapter } from "./test-auth";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Express } from "express";
import { db } from "./db";
import { users, reviewRequests } from "@shared/schema";
import { eq } from "drizzle-orm";
import { pool } from "./db";
import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "crypto";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { sendWelcomeEmail, appBaseUrl } from "./account/billing-emails";
import { notifyMemberLogin, notifyMemberAccountChange } from "./crm/owner-notify";
import { logMemberAuth } from "./crm/activity";
import { resolveGoogleUrl } from "./google-url-resolver";
import { GOOGLE_REVIEW_LINK_MESSAGE, googleReviewLink } from "./route-guards";
import { isPlatformAdmin } from "./admin";
import { siteBaseUrl, oauthBaseUrl } from "./site-context";

export { safeNextPath } from "./app-shell";

export function generateAccountId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = 4 + randomInt(4);
  let id = "";
  for (let i = 0; i < len; i++) {
    id += chars[randomInt(chars.length)];
  }
  return id;
}

declare module "express-session" {
  interface SessionData {
    passport: { user: number };
    pending2FAUserId?: number;
    /** CRM beta invite token, carried through the Google OAuth round-trip. */
    betaToken?: string;
    authNext?: string;
    nativeGoogleHost?: string;
    nativeGoogleChallenge?: string;
    /** "Continue with Google" step-up: the signed-in user it may re-verify. */
    googleReauth?: { userId: number; expires: number };
  }
}

declare global {
  namespace Express {
    interface User {
      id: number;
      googleId: string | null;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
      emailVerified: boolean;
      createdAt: Date;
    }
  }
}

export function getBaseUrl(req: any): string {
  // Host-aware (allowlisted) so links generated on constructhub.app or on the
  // portal subdomain point back at the domain the user is actually using.
  // Unknown hosts fall back to the primary domain — a spoofed Host header must
  // never end up inside an outgoing email or an OAuth callback.
  return siteBaseUrl(req);
}

/** Google sign-in is offered only when both OAuth client values are set. */
export function googleSignInConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export async function setupAuth(app: Express) {
  const PgStore = connectPgSimple(session);
  await ensureAppAuthSchema();
  await ensureAppConnectionsSchema();
  await ensureAppPushSchema();
  await ensureAppleAuthSchema();

  // SECURITY: never fall back to a hardcoded secret in production — a constant
  // baked into source lets anyone forge signed session cookies. Fail fast so a
  // misconfigured prod deploy refuses to boot rather than running insecure.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    console.warn("SESSION_SECRET is not set — using an insecure development-only secret.");
  }
  const resolvedSessionSecret = sessionSecret || "dev-only-insecure-session-secret";

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    ) WITH (OIDS=FALSE);
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);

  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: false }),
      secret: resolvedSessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
  app.use(testAuthAdapter(async () => {
    const [user] = await db.select().from(users).where(eq(users.id, 1));
    return user;
  }));

  registerAppConnections(app);
  registerAppPushRoutes(app);
  registerAppleAuthRoutes(app);

  // Google sign-in needs both OAuth client values. Without them passport
  // cannot build the strategy (it throws, which used to stop the whole server
  // from booting), so it is skipped and the Google routes below send people
  // back to the sign-in page with an honest "not available" message.
  const googleConfigured = googleSignInConfigured();
  if (!googleConfigured) console.warn("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — Google sign-in is disabled.");
  if (googleConfigured) passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: "/api/auth/google/callback",
        proxy: true,
        passReqToCallback: true,
        state: true, // Bind the OAuth callback to the initiating browser session.
      },
      async (req: any, accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value || "";
          // An account with no email can't be told apart from any other
          // email-less account (every "" would match the same row) and can
          // never satisfy invite email-binding — refuse the login instead of
          // storing an empty email.
          if (!email) return done(null, false);
          const displayName = profile.displayName || null;
          const avatarUrl = profile.photos?.[0]?.value || null;

          // Step-up re-verification never creates, links or switches an
          // account: only the Google identity already linked to the signed-in
          // user can pass (the callback checks the id again).
          const reauth = req.session?.googleReauth;
          if (reauth) {
            const [linked] = await db.select().from(users).where(eq(users.googleId, googleId));
            return done(null, linked && linked.id === reauth.userId && reauth.expires > Date.now() ? linked : false);
          }

          // A beta invite rides the OAuth round-trip in the session; only a
          // brand-new account redeems it (below), never an existing login.
          const betaToken = req.session?.betaToken;

          const tokenData: any = { emailVerified: true };
          // Login credentials must never create or replace a GBP grant.

          const existingByGoogle = await db.select().from(users).where(eq(users.googleId, googleId));
          if (existingByGoogle.length > 0) {
            if (req.session) delete req.session.betaToken;
            await db
              .update(users)
              .set({ email, displayName, avatarUrl, ...tokenData })
              .where(eq(users.googleId, googleId));
            return done(null, existingByGoogle[0]);
          }

          const existingByEmail = await db.select().from(users).where(eq(users.email, email));
          if (existingByEmail.length > 0) {
            if (req.session) delete req.session.betaToken;
            await db
              .update(users)
              .set({ googleId, displayName, avatarUrl, ...tokenData })
              .where(eq(users.email, email));
            return done(null, { ...existingByEmail[0], googleId, displayName, avatarUrl });
          }

          if (req.session) delete req.session.betaToken;
          const { consumeBetaInvite } = await import("./crm/beta");
          const betaAt = await consumeBetaInvite(betaToken, email);

          const [newUser] = await db
            .insert(users)
            .values({ googleId, email, displayName, avatarUrl, accountId: generateAccountId(), betaAt, ...tokenData })
            .returning();

          // A Google account arrives verified, so this is its sign-up moment:
          // the welcome email goes now (once per user; never blocks the login).
          // Its links are app links (Pricing, Settings…), so they use the app
          // origin, not getBaseUrl(): in production that is the CRM portal host.
          void sendWelcomeEmail(newUser.id, appBaseUrl(req))
            .catch((err: any) => console.error("Failed to send welcome email:", err?.message || err));

          done(null, newUser);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      done(null, user || null);
    } catch (err) {
      done(err);
    }
  });

  app.use(["/api/auth/signup", "/api/auth/login", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/2fa/login"],
    rateLimit("growth-auth", 30, 60, 15 * 60_000), async (req, res, next) => {
      if (typeof req.body?.email === "string") {
        const account = createHash("sha256").update(req.body.email.trim().toLowerCase()).digest("hex");
        if (!(await takeBudget(`growth-auth:account:${account}`, 10, 1, 15 * 60_000))) return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }
      next();
    });

  app.use(["/api/auth/2fa/setup", "/api/auth/2fa/verify", "/api/auth/2fa/disable", "/api/auth/change-password"], rateLimit("security-changes", 10, 30, 15 * 60_000));

  // The Google button on /auth: starts Google OAuth; the callback signs the user in (making a
  // Google-only account when needed) and lands them on ?next= (validated) or the home page.
  app.get("/api/auth/google", (req, res, next) => {
    const challenge = appChallenge(req.query);
    if (req.query.app === "1" && !challenge) return res.status(400).json({ message: "S256 PKCE challenge required" });
    const callbackURL = `${oauthBaseUrl(req)}/api/auth/google/callback`;
    if (req.query.gbp === "1") return res.redirect("/api/gbp/connect");
    if (!googleConfigured) {
      // A step-up returns to its page with the usual failure flag; a sign-in
      // lands on /auth, which explains that Google sign-in is unavailable.
      if (req.query.reauth === "1" && req.user) {
        const back = safeNextPath(typeof req.query.next === "string" ? req.query.next : undefined) ?? "/settings?tab=security";
        return res.redirect(`${back}${back.includes("?") ? "&" : "?"}reauth=google-failed`);
      }
      return res.redirect("/auth?error=google-unavailable");
    }
    if (req.query.app === "1") req.session.nativeGoogleHost = appAuthHost(req);
    else delete req.session.nativeGoogleHost;
    if (req.query.app === "1") req.session.nativeGoogleChallenge = challenge!;
    else delete req.session.nativeGoogleChallenge;
    const gbp = false;
    // A CRM beta invite survives the OAuth round-trip in the session.
    if (typeof req.query.beta === "string" && req.query.beta) {
      req.session.betaToken = req.query.beta;
    }
    // So does a post-login destination (team-invite accept page) — same-origin
    // paths only, never anything a browser could resolve off-origin.
    const safeNext = safeNextPath(typeof req.query.next === "string" ? req.query.next : undefined);
    if (safeNext) {
      req.session.authNext = safeNext;
    }
    // ?reauth=1 is the "Continue with Google" step-up for a signed-in user
    // (sensitive actions need a verification from the last 12 hours). The
    // account chooser always shows, pre-filled with the account's email.
    const reauth = req.query.reauth === "1" && !!req.user;
    if (reauth) req.session.googleReauth = { userId: req.user!.id, expires: Date.now() + 10 * 60_000 };
    else delete req.session.googleReauth;
    const scopes = ["profile", "email"];
    if (gbp) {
      scopes.push("https://www.googleapis.com/auth/business.manage");
    }
    passport.authenticate("google", {
      scope: scopes,
      callbackURL,
      accessType: gbp ? "offline" : undefined,
      prompt: gbp ? "consent" : reauth ? "select_account" : undefined,
      loginHint: reauth ? req.user!.email : undefined,
    } as any)(req, res, next);
  });

  app.get(
    "/api/auth/google/callback",
    (req, res, next) => {
      if (!googleConfigured) return res.redirect("/auth?error=google-unavailable");
      const callbackURL = `${oauthBaseUrl(req)}/api/auth/google/callback`;
      // Read here, cleared in the callback: the verify function above must
      // still see it to stay in step-up mode (no account create/link/switch).
      const reauth = req.session.googleReauth;
      // A custom callback so every Google outcome lands on a page: passport's
      // failureRedirect only covers access_denied, and any other Google error
      // (server_error, temporarily_unavailable, …) used to surface as raw JSON.
      passport.authenticate("google", { callbackURL } as any, async (err: any, user: any) => {
        const nativeHost = req.session.nativeGoogleHost;
        const nativeChallenge = req.session.nativeGoogleChallenge;
        delete req.session.nativeGoogleHost;
        delete req.session.nativeGoogleChallenge;
        delete req.session.googleReauth; // single use
        // The visitor gets a page either way; the server log keeps the cause
        // (this error used to reach the global handler, which logged it).
        if (err) console.error("[auth] Google callback failed:", err?.message || err);
        if (reauth) {
          // Step-up only: the session keeps its signed-in user either way.
          const nextPath = safeNextPath(req.session.authNext) ?? "/settings?tab=security";
          delete req.session.authNext;
          const ok = !err && user && req.user?.id === reauth.userId && user.id === reauth.userId && reauth.expires > Date.now();
          if (ok && !user.totpEnabled) {
            markRecentAuth(req, user.id);
            try { await logActivity(req, user.id, "security.reauthenticated", { method: "google" }); } catch { /* audit is best-effort here */ }
            return res.redirect(nextPath);
          }
          return res.redirect(`${nextPath}${nextPath.includes("?") ? "&" : "?"}reauth=google-failed`);
        }
        if (err || !user) return res.redirect("/auth?error=google-failed");
        if (nativeHost) {
          if (nativeHost !== appAuthHost(req) || !nativeChallenge) return res.redirect("/auth?error=google-failed");
          try {
            const code = await mintAppCode(user.id, nativeHost, "login", nativeChallenge, req.session.authNext);
            delete req.session.authNext;
            return res.redirect(`constructhub://auth-done?code=${code}`);
          } catch { return res.redirect("/auth?error=google-failed"); }
        }
        // keepSessionInfo: the OAuth round-trip state (authNext) must survive
        // passport's session regeneration on login.
        req.logIn(user, { keepSessionInfo: true } as any, (loginErr) => {
          if (loginErr) return res.redirect("/auth?error=google-failed");
          next();
        });
      })(req, res, next);
    },
    (req, res) => finishGoogleLogin(req, res)
  );

  async function finishGoogleLogin(req: import("express").Request, res: import("express").Response, native = false) {
      try {
        if (req.user) {
          const [fullUser] = await db.select().from(users).where(eq(users.id, req.user.id));
          if (fullUser?.totpEnabled && !(await trustedDevice(req, fullUser.id))) {
            req.session.pending2FAUserId = fullUser.id;
            req.session.pending2FAExpires = Date.now() + 10 * 60_000;
            // keepSessionInfo: passport's logout regenerates the session,
            // which would wipe the pending 2FA marker we just set.
            req.logout({ keepSessionInfo: true } as any, () => {
              res.redirect("/auth?mode=2fa" + (native && safeNextPath(req.session.authNext) ? `&next=${encodeURIComponent(req.session.authNext!)}` : ""));
            });
            return;
          }
          // A fresh Google sign-in is a fresh authentication — the same as a
          // password login (below), so connecting Google Business Profile or
          // turning on 2FA right after signing in never asks for an email
          // code. 2FA accounts still re-verify with their authenticator.
          if (!fullUser?.totpEnabled) markRecentAuth(req, req.user.id);
          await logActivity(req, req.user.id, "auth.login_success", { method: "google" });
        }
      } catch {
        req.logout(() => res.redirect("/auth?error=google-failed"));
        return;
      }
      // Re-checked here: the stashed value only ever passed safeNextPath,
      // but the session is server-side state from an earlier request —
      // validate again before putting it in a Location header.
      const nextPath = safeNextPath(req.session.authNext);
      delete req.session.authNext;
      res.redirect(nextPath ?? (native ? "/" : "/?auth=success"));
    }

  app.get("/api/auth/app-exchange", rateLimit("app-auth-exchange", 30, 60), async (req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    try {
      const code = await consumeAppCode(req.query.code, appAuthHost(req), req.query.verifier);
      if (!code) return res.status(400).json({ message: "Invalid or expired app code" });
      if (code.purpose === "redirect") {
        if (req.user?.id !== code.user_id) return res.status(403).json({ message: "Sign in to the account that started this connection" });
        return res.redirect(safeNextPath(code.next) ?? "/");
      }
      const [user] = await db.select().from(users).where(eq(users.id, code.user_id));
      if (!user) return res.status(400).json({ message: "Invalid or expired app code" });
      // Clear any other account's session before applying this authenticated identity.
      req.session.regenerate(err => {
        if (err) return next(err);
        req.session.authNext = safeNextPath(code.next) ?? "/";
        req.logIn(user, { keepSessionInfo: true } as any, err => {
          if (err) return next(err);
          void finishGoogleLogin(req, res, true).catch(next);
        });
      });
    } catch (err) { next(err); }
  });

  // The auth page's "Get Started": creates the unverified account, emails a 24-hour
  // verification link, and applies a beta invite code when present.
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, displayName, beta, next } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      // Carry the post-signup destination (e.g. a /crm/join invite) through
      // email verification — same trick as the Google OAuth authNext.
      if (typeof next === "string" && /^\/[^\/\\]/.test(next)) {
        req.session.authNext = next;
      }

      const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (existing.length > 0) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const verificationToken = randomBytes(32).toString("hex");
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // CRM beta invite (single-use, 30-day expiry, email-bound). An invalid
      // or spent token never blocks the signup — it just doesn't flag.
      const { consumeBetaInvite } = await import("./crm/beta");
      const betaAt = await consumeBetaInvite(typeof beta === "string" ? beta : null, email.toLowerCase().trim());

      const [newUser] = await db
        .insert(users)
        .values({
          email: email.toLowerCase().trim(),
          passwordHash,
          displayName: displayName || null,
          emailVerified: false,
          verificationToken,
          verificationExpiry,
          accountId: generateAccountId(),
          betaAt,
        })
        .returning();

      try {
        const baseUrl = getBaseUrl(req);
        await sendVerificationEmail(newUser.email, verificationToken, baseUrl);
      } catch (emailErr) {
        console.error("Failed to send verification email:", emailErr);
      }

      res.json({ message: "Account created! Check your email to verify your account.", userId: newUser.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // The auth page's sign-in: checks email and password (and email verification), starts 2FA
  // when the account has it, otherwise opens the session.
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (!user || !user.passwordHash) {
        if (user) await logActivity(req, user.id, "auth.login_failure", { method: "password" });
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        await logActivity(req, user.id, "auth.login_failure", { method: "password" });
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (!user.emailVerified) {
        await logActivity(req, user.id, "auth.login_failure", { reason: "email_unverified" });
        return res.status(403).json({ message: "Please verify your email before logging in. Check your inbox for a verification link." });
      }

      if (user.totpEnabled && !(await trustedDevice(req, user.id))) {
        req.session.pending2FAUserId = user.id;
        req.session.pending2FAExpires = Date.now() + 10 * 60_000;
        return res.json({ requires2FA: true });
      }

      req.login(user, async (err) => {
        if (err) return res.status(500).json({ message: "Login failed" });
        if (!user.totpEnabled) markRecentAuth(req, user.id);
        await logActivity(req, user.id, "auth.login_success", { method: "password" });
        // Owner's "team member signs in" notice (debounced per user/org/hour).
        // Fire-and-forget: mail latency must never sit on the login path.
        notifyMemberLogin(user).catch((e: any) => console.error("[crm] login notify failed:", e?.message || e));
        // Accountability log: one 'login' row per org the user sits in.
        logMemberAuth(user, "login").catch((e: any) => console.error("[crm] login activity failed:", e?.message || e));
        res.json({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // The auth page's second factor: checks the 6-digit code for the pending login and, on
  // success, finishes the sign-in (remembering the device when asked).
  app.post("/api/auth/2fa/login", async (req, res) => {
    try {
      const { code } = req.body;
      const pendingUserId = req.session.pending2FAUserId;
      if (!pendingUserId || !req.session.pending2FAExpires || req.session.pending2FAExpires < Date.now()) {
        return res.status(400).json({ message: "No pending login. Please start over." });
      }
      if (typeof code !== "string" || !/^(?:[0-9]{6}|[a-fA-F0-9]{16})$/.test(code)) {
        return res.status(400).json({ message: "Verification code is required" });
      }

      if (!(await takeBudget(`security-2fa:user:${pendingUserId}`, 10, 1, 15*60_000))) return res.status(429).json({ message: "Too many attempts. Please try again later." });
      const [user] = await db.select().from(users).where(eq(users.id, pendingUserId));
      if (!user || !user.totpSecret || !user.totpEnabled) {
        return res.status(400).json({ message: "Invalid session. Please start over." });
      }

      const { TOTP } = await import("otpauth");
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: decryptToken(user.totpSecret)!,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null && !(await consumeRecoveryCode(user.id, code.trim()))) {
        await logActivity(req, user.id, "auth.login_failure", { method: "2fa" });
        return res.status(401).json({ message: "Invalid verification code. Please try again." });
      }

      delete req.session.pending2FAUserId;
      delete req.session.pending2FAExpires;
      req.login(user, async (err) => {
        if (err) return res.status(500).json({ message: "Login failed" });
        if (delta !== null) markRecentAuth(req, user.id);
        if (req.body.rememberDevice === true) await rememberDevice(req, res, user.id);
        await logActivity(req, user.id, "auth.login_success", { method: "2fa" });
        res.json({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/auth/verify-email", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.redirect("/auth?error=invalid-token");
      }

      const [user] = await db.select().from(users).where(eq(users.verificationToken, token));
      if (!user) {
        return res.redirect("/auth?error=invalid-token");
      }

      if (user.verificationExpiry && user.verificationExpiry < new Date()) {
        return res.redirect("/auth?error=token-expired");
      }

      const verified = await pool.query(`UPDATE users SET email_verified=true,verification_token=NULL,verification_expiry=NULL
        WHERE id=$1 AND verification_token=$2 AND verification_expiry>timezone('UTC',now()) RETURNING id`, [user.id, token]);
      if (!verified.rowCount) return res.redirect("/auth?error=invalid-token");

      // The account is usable from here: welcome + first steps, once per user.
      // The verification redirect never waits on (or fails because of) mail.
      // App origin for the links (see the Google sign-up hook above).
      void sendWelcomeEmail(user.id, appBaseUrl(req))
        .catch((err: any) => console.error("Failed to send welcome email:", err?.message || err));

      // A still-valid email link must never bypass a subsequently enabled second factor.
      if (user.totpEnabled) {
        req.session.pending2FAUserId = user.id;
        req.session.pending2FAExpires = Date.now() + 10 * 60_000;
        return req.logout({ keepSessionInfo: true } as any, (error) => {
          res.redirect(error ? "/auth?error=verification-failed" : "/auth?mode=2fa");
        });
      }

      // passport.regenerate on login wipes the session — capture (and clear)
      // the destination BEFORE req.login. A signup that started from an
      // invite link lands back on it instead of the generic home page.
      const nextPath = typeof req.session.authNext === "string" && /^\/[^\/\\]/.test(req.session.authNext)
        ? req.session.authNext
        : null;
      delete req.session.authNext;
      req.login(user, () => {
        res.redirect(nextPath ?? "/?auth=verified");
      });
    } catch (err) {
      res.redirect("/auth?error=verification-failed");
    }
  });

  // The auth page's "Resend verification email": issues a new 24-hour token and emails it.
  app.post("/api/auth/resend-verification", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (!user) return res.json({ message: "If an account exists, a verification email has been sent." });

      if (user.emailVerified) return res.json({ message: "Email is already verified. You can log in." });

      const verificationToken = randomBytes(32).toString("hex");
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db
        .update(users)
        .set({ verificationToken, verificationExpiry })
        .where(eq(users.id, user.id));

      const baseUrl = getBaseUrl(req);
      await sendVerificationEmail(user.email, verificationToken, baseUrl);

      res.json({ message: "Verification email sent. Check your inbox." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // The auth page's "Forgot password": emails a 1-hour reset link. Always answers the same
  // way whether or not the email exists.
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (!user || !user.passwordHash) {
        return res.json({ message: "If an account exists, a password reset email has been sent." });
      }

      const resetToken = randomBytes(32).toString("hex");
      const resetExpiry = new Date(Date.now() + 60 * 60 * 1000);

      await db
        .update(users)
        .set({ resetToken, resetExpiry })
        .where(eq(users.id, user.id));

      const baseUrl = getBaseUrl(req);
      await sendPasswordResetEmail(user.email, resetToken, baseUrl);

      res.json({ message: "If an account exists, a password reset email has been sent." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // The reset link's landing page (/auth?mode=reset-password&token=…): checks the token and
  // expiry, sets the new password, then signs out every session and revokes trusted devices.
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ message: "Token and password are required" });
      if (password.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });

      const [user] = await db.select().from(users).where(eq(users.resetToken, token));
      if (!user) return res.status(400).json({ message: "Invalid or expired reset link" });

      if (user.resetExpiry && user.resetExpiry < new Date()) {
        return res.status(400).json({ message: "Reset link has expired. Please request a new one." });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const changed = await connection.query(`UPDATE users SET password_hash=$1,reset_token=null,reset_expiry=null,email_verified=true
          WHERE id=$2 AND reset_token=$3 AND reset_expiry>timezone('UTC',now()) RETURNING id`, [passwordHash, user.id, token]);
        if (!changed.rowCount) {
          await connection.query("ROLLBACK");
          return res.status(400).json({ message: "Invalid or expired reset link" });
        }
        await connection.query(`DELETE FROM session WHERE sess->'passport'->>'user'=$1 OR sess->>'pending2FAUserId'=$1`, [String(user.id)]);
        await connection.query("COMMIT");
      } catch (error) { await connection.query("ROLLBACK"); throw error; }
      finally { connection.release(); }
      if (req.user?.id === user.id || req.session.pending2FAUserId === user.id) {
        await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie("connect.sid");
      }

      await revokeDevices(user.id);
      await securityChanged(req, user.id, "security.password_changed", "Your password was reset");
      res.json({ message: "Password reset successfully. You can now log in." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Who is signed in: the app shell's session check — every signed-in page (the home dashboard,
  // settings, the tools) renders behind this answer; null = signed out (the client shows the
  // public site / sign-in). Re-reads the users row so a deleted or changed account is reflected
  // at once; /settings reads it as SettingsUser and /invite/:code uses it to pick the
  // signed-out vs signed-in card.
  app.get("/api/auth/me", async (req, res) => {
    if (req.isAuthenticated() && req.user) {
      try {
        const [fresh] = await db.select().from(users).where(eq(users.id, req.user.id));
        if (!fresh) return res.json(null);
        res.json({
          id: fresh.id,
          accountId: fresh.accountId,
          email: fresh.email,
          displayName: fresh.displayName,
          avatarUrl: fresh.avatarUrl,
          emailVerified: fresh.emailVerified,
          googleId: fresh.googleId ? true : false,
          companyName: fresh.companyName,
          companyLogoUrl: fresh.companyLogoUrl,
          googleProfileUrl: fresh.googleProfileUrl,
          totpEnabled: fresh.totpEnabled,
          hasPassword: !!fresh.passwordHash,
          hasGbpAccess: (await (await import("./gbp/grants")).grantStatus(fresh.id)).connected,
          isPlatformAdmin: isPlatformAdmin(fresh),
          createdAt: fresh.createdAt,
        });
      } catch {
        res.json(null);
      }
    } else {
      res.json(null);
    }
  });

  // Me → My account "Save changes": display name, company name/logo, avatar, review link.
  // Blank display name and oversized/foreign-logo URLs are refused; a review link is only
  // re-validated when it changed, so an unrelated save is never blocked by an old link.
  app.patch("/api/auth/profile", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { displayName, companyName, companyLogoUrl, googleProfileUrl } = req.body;
      const updateData: any = {};
      if (displayName !== undefined) {
        const name = String(displayName ?? "").trim();
        if (!name) return res.status(400).json({ message: "Display name is required" });
        updateData.displayName = name.slice(0, 200);
      }
      if (companyName !== undefined) updateData.companyName = String(companyName).slice(0, 200);
      if (companyLogoUrl !== undefined) {
        const logoStr = String(companyLogoUrl);
        if (logoStr.length > 1500000) {
          return res.status(400).json({ message: "Logo image is too large. Please use a smaller image." });
        }
        if (logoStr && !logoStr.startsWith("data:image/") && !logoStr.startsWith("http") && !logoStr.startsWith("/api/files/")) {
          return res.status(400).json({ message: "Invalid logo URL format" });
        }
        updateData.companyLogoUrl = logoStr;
      }
      if (googleProfileUrl !== undefined) {
        // Same rule as review templates: resolve Google short links, then accept only Google hosts. Blank clears it.
        // Only a changed link is checked: resending the stored value (possibly a legacy
        // non-Google link) leaves it as is and must not block an unrelated profile save.
        let raw = String(googleProfileUrl ?? "").trim();
        const [current] = await db.select({ googleProfileUrl: users.googleProfileUrl }).from(users).where(eq(users.id, req.user.id));
        if (!raw) updateData.googleProfileUrl = null;
        else if (raw !== (current?.googleProfileUrl ?? "").trim()) {
          if (raw.length > 500) return res.status(400).json({ message: GOOGLE_REVIEW_LINK_MESSAGE });
          if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
          const link = googleReviewLink(await resolveGoogleUrl(raw));
          if (!link) return res.status(400).json({ message: GOOGLE_REVIEW_LINK_MESSAGE });
          updateData.googleProfileUrl = link;
        }
      }
      if (req.body.avatarUrl !== undefined) {
        const avatarStr = String(req.body.avatarUrl);
        if (avatarStr && !avatarStr.startsWith("data:image/") && !avatarStr.startsWith("http") && !avatarStr.startsWith("/api/files/")) {
          return res.status(400).json({ message: "Invalid avatar URL format" });
        }
        updateData.avatarUrl = avatarStr || null;
      }
      if (Object.keys(updateData).length > 0) {
        await db.update(users).set(updateData).where(eq(users.id, req.user.id));
        if (updateData.companyName) {
          await db.update(reviewRequests)
            .set({ companyName: updateData.companyName })
            .where(eq(reviewRequests.userId, req.user.id));
        }
      }
      const [updated] = await db.select().from(users).where(eq(users.id, req.user.id));
      res.json({
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        emailVerified: updated.emailVerified,
        googleId: updated.googleId ? true : false,
        companyName: updated.companyName,
        companyLogoUrl: updated.companyLogoUrl,
        googleProfileUrl: updated.googleProfileUrl,
        createdAt: updated.createdAt,
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Me → Password & security "Update password": checks the current password, rewrites
  // users.password_hash, signs out every remembered device and logs/notifies security.password_changed.
  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Both passwords are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user?.passwordHash) {
        return res.status(400).json({ message: "Account does not use password authentication" });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await db.update(users).set({ passwordHash: hash }).where(eq(users.id, req.user.id));
      await revokeDevices(user.id);
      await securityChanged(req, user.id, "security.password_changed", "Your password was changed");
      // Owner's "account changed" notice — field names only, never the password.
      notifyMemberAccountChange(req.user as any, ["password"])
        .catch((e: any) => console.error("[crm] account-change notify failed:", e?.message || e));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to change password" });
    }
  });


  // Me → Password & security "Enable 2FA": stores an encrypted (not yet active) TOTP secret and
  // returns the QR data URL + manual key. Requires a recent identity check (403 {reauth:true}).
  app.post("/api/auth/2fa/setup", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!requireRecentAuth(req, res)) return;
    try {
      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.totpEnabled) return res.status(400).json({ message: "2FA is already enabled" });

      const { TOTP, Secret } = await import("otpauth");
      const secret = new Secret({ size: 20 });
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret,
      });

      const otpauthUrl = totp.toString();

      const saved = await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2 AND totp_enabled=false RETURNING id', [encryptToken(secret.base32), user.id]);
      if (!saved.rowCount) return res.status(409).json({ message: 'Two-factor sign-in changed. Reload Settings.' });

      const QRCode = await import("qrcode");
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

      res.json({
        secret: secret.base32,
        qrCode: qrDataUrl,
        otpauthUrl,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to set up 2FA" });
    }
  });

  // Me → Password & security "Verify & Enable": validates the first authenticator code, then
  // enables 2FA and returns 10 one-time recovery codes in the same transaction.
  app.post("/api/auth/2fa/verify", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!requireRecentAuth(req, res)) return;
    try {
      const { code } = req.body;
      if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) {
        return res.status(400).json({ message: "Verification code is required" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user || !user.totpSecret || user.totpEnabled) {
        return res.status(400).json({ message: "2FA setup not started. Please start setup first." });
      }

      const { TOTP } = await import("otpauth");
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: decryptToken(user.totpSecret)!,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ message: "Invalid code. Please check your authenticator app and try again." });
      }

      const codes = await activateTwoFactor(user.id, user.totpSecret);
      if (!codes) return res.status(409).json({ message: 'Two-factor setup changed. Reload Settings and try again.' });
      markRecentAuth(req, user.id);
      await securityChanged(req, user.id, "security.2fa_changed", "Two-factor sign-in was enabled");
      res.json({ message: "Two-factor authentication enabled successfully!", codes });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });

  // Me → Password & security "Confirm Disable": one valid authenticator code turns 2FA off and
  // wipes the secret, recovery codes and remembered devices.
  app.post("/api/auth/2fa/disable", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!requireRecentAuth(req, res)) return;
    try {
      const { code } = req.body;
      if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) {
        return res.status(400).json({ message: "Verification code is required to disable 2FA" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user || !user.totpSecret || !user.totpEnabled) {
        return res.status(400).json({ message: "2FA is not enabled" });
      }

      const { TOTP } = await import("otpauth");
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: decryptToken(user.totpSecret)!,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ message: "Invalid code. Please enter a valid code from your authenticator app." });
      }

      await db.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, user.id));
      await revokeDevices(user.id);
      await pool.query("DELETE FROM account_recovery_codes WHERE user_id=$1", [user.id]);
      await securityChanged(req, user.id, "security.2fa_changed", "Two-factor sign-in was disabled");
      res.json({ message: "Two-factor authentication has been disabled." });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });

  // Sign out (the account menu and the auth page): ends the session and clears the cookie.
  app.post("/api/auth/logout", (req, res) => {
    // Capture the actor before the session goes away — a sign-out is only
    // worth logging when we know who it was.
    const actor = (req.isAuthenticated?.() && req.user) ? (req.user as any) : null;
    req.logout(() => {
      req.session.destroy(async () => {
        if (actor) {
          await logActivity(req, actor.id, "auth.logout")
            .catch((e: any) => console.error("[security] logout activity failed:", e?.message || e));
          logMemberAuth(actor, "logout")
            .catch((e: any) => console.error("[crm] logout activity failed:", e?.message || e));
        }
        res.json({ ok: true });
      });
    });
  });
}
