/**
 * Sign-up leads: the email (then name, mobile, trade and team size) of someone
 * part-way through the three-step sign-up on /auth?mode=signup, saved the
 * moment they give it — so the team can follow up with the ones who quit
 * before choosing a password (owner, 2026-10-21: "fix the sign-up flow like
 * the competitors"; Housecall Pro, Jobber and Roofr all capture the lead on
 * step 1).
 *
 *   POST /api/auth/signup-lead          step 1 — the email; says when it already has an account
 *   POST /api/auth/signup-lead/details  step 2 — name, mobile, trade, team size (this browser's lead only)
 *   POST /api/auth/finish-setup         the same questions once, for a brand-new Google account
 *
 * Step 3 is the existing POST /api/auth/signup (server/auth.ts), which keeps
 * every security rule it had (hashing, verification email, rate limits,
 * attribution) and then marks the lead converted here.
 *
 * Step 2 only ever updates the lead this browser's session started on step 1:
 * an email in a request body is never enough to rewrite someone's lead.
 *
 * No `./db` import at module scope: the unit tests import the pure parts.
 */
import type { Express } from "express";
import { normalizeSignupEmail, parseSignupDetails, type SignupDetails } from "@shared/signup";
import { firstTouchAttribution } from "./analytics-attribution";

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Idempotent DDL: boot runs it (setupAuth in server/auth.ts) and so does scripts/apply-schema-migration.ts.
 *  shared/schema.ts mirrors it (users.phone/trade/team_size, signupLeads). */
export const SIGNUP_LEADS_DDL: readonly string[] = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS trade text`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS team_size text`,
  `CREATE TABLE IF NOT EXISTS signup_leads (
     id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
     email text NOT NULL UNIQUE,
     first_name text,
     last_name text,
     phone text,
     trade text,
     team_size text,
     source text,
     utm_source text,
     utm_medium text,
     utm_campaign text,
     referrer_host text,
     converted_user_id integer,
     converted_at timestamp,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS signup_leads_created_idx ON signup_leads (created_at)`,
];

export async function ensureSignupLeadsSchema(q?: Queryable): Promise<void> {
  const target = q ?? (await import("./db")).pool;
  for (const sql of SIGNUP_LEADS_DDL) await target.query(sql);
}

/** Where the email came from: the auth page's own field, or a hand-off (the landing page's hero field). */
export function leadSource(raw: unknown): string {
  return typeof raw === "string" && /^[a-z0-9_-]{1,40}$/.test(raw) ? raw : "auth";
}

/** Step 1's body → the lead's email, or the message to show. */
export function parseLeadStart(body: any): { ok: true; email: string; source: string } | { ok: false; message: string } {
  const email = normalizeSignupEmail(body?.email);
  if (!email) return { ok: false, message: "Enter a valid email address" };
  return { ok: true, email, source: leadSource(body?.source) };
}

const pool = async (q?: Queryable) => q ?? (await import("./db")).pool;

/** True when any account (password or Google, any letter case) already uses this email. */
export async function emailHasAccount(email: string, q?: Queryable): Promise<boolean> {
  const r = await (await pool(q)).query(`SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
  return r.rows.length > 0;
}

/** Saves (or touches) the lead for this email and returns its id. A returning visitor keeps their first source and campaign. */
export async function upsertLead(email: string, source: string, cookieHeader: unknown, q?: Queryable): Promise<number> {
  const touch = await firstTouchAttribution(cookieHeader, q);
  const r = await (await pool(q)).query(
    `INSERT INTO signup_leads (email, source, utm_source, utm_medium, utm_campaign, referrer_host)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET
       source = COALESCE(signup_leads.source, EXCLUDED.source),
       utm_source = COALESCE(signup_leads.utm_source, EXCLUDED.utm_source),
       utm_medium = COALESCE(signup_leads.utm_medium, EXCLUDED.utm_medium),
       utm_campaign = COALESCE(signup_leads.utm_campaign, EXCLUDED.utm_campaign),
       referrer_host = COALESCE(signup_leads.referrer_host, EXCLUDED.referrer_host),
       updated_at = now()
     RETURNING id`,
    [email, source, touch?.utmSource ?? null, touch?.utmMedium ?? null, touch?.utmCampaign ?? null, touch?.referrerHost ?? null],
  );
  return r.rows[0].id;
}

export async function saveLeadDetails(leadId: number, d: SignupDetails, q?: Queryable): Promise<boolean> {
  const r = await (await pool(q)).query(
    `UPDATE signup_leads SET first_name = $2, last_name = $3, phone = $4, trade = $5, team_size = $6, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [leadId, d.firstName, d.lastName, d.phone, d.trade, d.teamSize],
  );
  return r.rows.length > 0;
}

/**
 * The account now exists: the lead for its email is converted (created here if
 * the person never had one — a Google sign-up, or a session that lapsed).
 * Never throws — the lead is follow-up data and must not break a sign-up.
 */
export async function markLeadConverted(email: string, userId: number, d: SignupDetails | null, source: string | null, q?: Queryable): Promise<void> {
  try {
    await (await pool(q)).query(
      `INSERT INTO signup_leads (email, first_name, last_name, phone, trade, team_size, source, converted_user_id, converted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (email) DO UPDATE SET
         first_name = COALESCE(EXCLUDED.first_name, signup_leads.first_name),
         last_name = COALESCE(EXCLUDED.last_name, signup_leads.last_name),
         phone = COALESCE(EXCLUDED.phone, signup_leads.phone),
         trade = COALESCE(EXCLUDED.trade, signup_leads.trade),
         team_size = COALESCE(EXCLUDED.team_size, signup_leads.team_size),
         source = COALESCE(signup_leads.source, EXCLUDED.source),
         converted_user_id = EXCLUDED.converted_user_id,
         converted_at = now(),
         updated_at = now()`,
      [email.trim().toLowerCase(), d?.firstName ?? null, d?.lastName ?? null, d?.phone ?? null, d?.trade ?? null, d?.teamSize ?? null, source, userId],
    );
  } catch (e: any) {
    console.error("[signup-leads] could not mark the lead converted:", e?.message || e);
  }
}

/** A Google account made in the last day that has not answered "About your business" yet gets that screen once. */
export async function needsSignupDetails(userId: number, q?: Queryable): Promise<boolean> {
  try {
    const r = await (await pool(q)).query(
      `SELECT 1 FROM users WHERE id = $1 AND phone IS NULL AND created_at > timezone('UTC', now()) - interval '1 day'`,
      [userId],
    );
    return r.rows.length > 0;
  } catch {
    return false; // never trap a sign-in behind this screen
  }
}

/** Rate limits sit in front of these paths in setupAuth (server/auth.ts), with the other sign-up endpoints. */
export function registerSignupLeadRoutes(app: Express): void {
  app.post("/api/auth/signup-lead", async (req, res) => {
    const parsed = parseLeadStart(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });
    try {
      // Same answer the old one-page form gave on submit (409 "already exists"), only sooner.
      if (await emailHasAccount(parsed.email)) return res.json({ exists: true });
      req.session.signupLeadId = await upsertLead(parsed.email, parsed.source, req.headers.cookie);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[signup-leads] POST /api/auth/signup-lead failed:", e?.message || e);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/auth/signup-lead/details", async (req, res) => {
    const parsed = parseSignupDetails(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });
    const leadId = req.session.signupLeadId;
    // No lead on this session (it lapsed, or step 1 was skipped): nothing to update. Step 3 still saves it all.
    if (!Number.isInteger(leadId)) return res.status(400).json({ message: "Start again with your email.", code: "no-lead" });
    try {
      await saveLeadDetails(leadId!, parsed.details);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[signup-leads] POST /api/auth/signup-lead/details failed:", e?.message || e);
      res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/auth/finish-setup", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ message: "Not authenticated" });
    const parsed = parseSignupDetails(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });
    const d = parsed.details;
    try {
      const { db } = await import("./db");
      const { users } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      // What they typed wins over the name Google sent.
      await db.update(users)
        .set({ displayName: `${d.firstName} ${d.lastName}`, phone: d.phone, trade: d.trade, teamSize: d.teamSize })
        .where(eq(users.id, req.user.id));
      void markLeadConverted(req.user.email, req.user.id, d, "google");
      res.json({ ok: true });
    } catch (e: any) {
      console.error("[signup-leads] POST /api/auth/finish-setup failed:", e?.message || e);
      res.status(500).json({ message: "Could not save. Please try again." });
    }
  });
}
