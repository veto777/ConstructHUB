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
import { resolveGoogleUrl } from "./google-url-resolver";

function generateAccountId(): string {
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
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT) {
    return "https://constructhub.us";
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export async function setupAuth(app: Express) {
  const PgStore = connectPgSimple(session);

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
      secret: process.env.SESSION_SECRET || "construction-hub-session-secret",
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

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: "/api/auth/google/callback",
        proxy: true,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value || "";
          const displayName = profile.displayName || null;
          const avatarUrl = profile.photos?.[0]?.value || null;

          const tokenData: any = { emailVerified: true };
          if (accessToken) tokenData.googleAccessToken = accessToken;
          if (refreshToken) tokenData.googleRefreshToken = refreshToken;
          if (accessToken) tokenData.googleTokenExpiry = new Date(Date.now() + 3600 * 1000);

          const existingByGoogle = await db.select().from(users).where(eq(users.googleId, googleId));
          if (existingByGoogle.length > 0) {
            await db
              .update(users)
              .set({ email, displayName, avatarUrl, ...tokenData })
              .where(eq(users.googleId, googleId));
            return done(null, existingByGoogle[0]);
          }

          const existingByEmail = await db.select().from(users).where(eq(users.email, email));
          if (existingByEmail.length > 0) {
            await db
              .update(users)
              .set({ googleId, displayName, avatarUrl, ...tokenData })
              .where(eq(users.email, email));
            return done(null, { ...existingByEmail[0], googleId, displayName, avatarUrl });
          }

          const [newUser] = await db
            .insert(users)
            .values({ googleId, email, displayName, avatarUrl, accountId: generateAccountId(), ...tokenData })
            .returning();

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

  app.get("/api/auth/google", (req, res, next) => {
    const callbackURL = `${getBaseUrl(req)}/api/auth/google/callback`;
    const gbp = req.query.gbp === "1";
    const scopes = ["profile", "email"];
    if (gbp) {
      scopes.push("https://www.googleapis.com/auth/business.manage");
    }
    passport.authenticate("google", {
      scope: scopes,
      callbackURL,
      accessType: gbp ? "offline" : undefined,
      prompt: gbp ? "consent" : undefined,
    } as any)(req, res, next);
  });

  app.get(
    "/api/auth/google/callback",
    (req, res, next) => {
      const callbackURL = `${getBaseUrl(req)}/api/auth/google/callback`;
      passport.authenticate("google", { failureRedirect: "/auth?error=google-failed", callbackURL } as any)(req, res, next);
    },
    async (req, res) => {
      try {
        if (req.user) {
          const [fullUser] = await db.select().from(users).where(eq(users.id, req.user.id));
          if (fullUser?.totpEnabled && fullUser?.totpSecret) {
            req.session.pending2FAUserId = fullUser.id;
            req.logout(() => {
              res.redirect("/auth?mode=2fa");
            });
            return;
          }
        }
      } catch {}
      res.redirect("/?auth=success");
    }
  );

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (existing.length > 0) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const verificationToken = randomBytes(32).toString("hex");
      const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

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

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (!user.emailVerified) {
        return res.status(403).json({ message: "Please verify your email before logging in. Check your inbox for a verification link." });
      }

      if (user.totpEnabled && user.totpSecret) {
        req.session.pending2FAUserId = user.id;
        return res.json({ requires2FA: true });
      }

      req.login(user, (err) => {
        if (err) return res.status(500).json({ message: "Login failed" });
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

  app.post("/api/auth/2fa/login", async (req, res) => {
    try {
      const { code } = req.body;
      const pendingUserId = req.session.pending2FAUserId;
      if (!pendingUserId) {
        return res.status(400).json({ message: "No pending login. Please start over." });
      }
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code is required" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, pendingUserId));
      if (!user || !user.totpSecret) {
        return res.status(400).json({ message: "Invalid session. Please start over." });
      }

      const { TOTP } = await import("otpauth");
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: user.totpSecret,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ message: "Invalid verification code. Please try again." });
      }

      delete req.session.pending2FAUserId;
      req.login(user, (err) => {
        if (err) return res.status(500).json({ message: "Login failed" });
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

      await db
        .update(users)
        .set({ emailVerified: true, verificationToken: null, verificationExpiry: null })
        .where(eq(users.id, user.id));

      req.login(user, () => {
        res.redirect("/?auth=verified");
      });
    } catch (err) {
      res.redirect("/auth?error=verification-failed");
    }
  });

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
      await db
        .update(users)
        .set({ passwordHash, resetToken: null, resetExpiry: null, emailVerified: true })
        .where(eq(users.id, user.id));

      res.json({ message: "Password reset successfully. You can now log in." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
          hasGbpAccess: !!(fresh.googleAccessToken || fresh.googleRefreshToken),
          createdAt: fresh.createdAt,
        });
      } catch {
        res.json(null);
      }
    } else {
      res.json(null);
    }
  });

  app.patch("/api/auth/profile", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { displayName, companyName, companyLogoUrl, googleProfileUrl } = req.body;
      const updateData: any = {};
      if (displayName !== undefined) updateData.displayName = String(displayName).slice(0, 200);
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
        const resolved = await resolveGoogleUrl(String(googleProfileUrl).slice(0, 500));
        updateData.googleProfileUrl = resolved;
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
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.post("/api/auth/2fa/setup", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
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

      await db.update(users).set({ totpSecret: secret.base32 }).where(eq(users.id, user.id));

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

  app.post("/api/auth/2fa/verify", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ message: "Verification code is required" });
      }

      const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
      if (!user || !user.totpSecret) {
        return res.status(400).json({ message: "2FA setup not started. Please start setup first." });
      }

      const { TOTP } = await import("otpauth");
      const totp = new TOTP({
        issuer: "ConstructHUB",
        label: user.email,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: user.totpSecret,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ message: "Invalid code. Please check your authenticator app and try again." });
      }

      await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
      res.json({ message: "Two-factor authentication enabled successfully!" });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to verify 2FA" });
    }
  });

  app.post("/api/auth/2fa/disable", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { code } = req.body;
      if (!code || typeof code !== "string") {
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
        secret: user.totpSecret,
      });

      const delta = totp.validate({ token: code.trim(), window: 1 });
      if (delta === null) {
        return res.status(401).json({ message: "Invalid code. Please enter a valid code from your authenticator app." });
      }

      await db.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, user.id));
      res.json({ message: "Two-factor authentication has been disabled." });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to disable 2FA" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.json({ ok: true });
      });
    });
  });
}
