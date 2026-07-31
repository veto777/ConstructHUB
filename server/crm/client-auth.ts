/**
 * Homeowner client portal auth — magic-link sign-in for the contractor's end
 * customers (client.constructhub.*). No password, no platform account.
 *
 * Anti-enumeration is the load-bearing rule: POST /request-link ALWAYS answers
 * 200 { sent: true } whether or not the email matches any customer, and the
 * per-email rate limit is keyed on the requested address (known or not) so a
 * 429 never reveals existence either.
 *
 * Raw tokens never touch the database — only their SHA-256. A link token is
 * 30-minute, single-use, and trades for a 30-day sliding session held in an
 * httpOnly cookie (`crm_client`, deliberately separate from the contractor
 * session cookie). A session snapshots the ids of EVERY crm_customers row
 * matching the email across all orgs, and every client query is scoped by
 * those ids — a homeowner can never reach another customer's documents.
 */
import type { Express } from "express";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmCustomers,
  crmOrgs,
  crmEstimates,
  crmInvoices,
  crmClientTokens,
  crmClientSessions,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { sendWithFallback } from "../email";
import { clientPortalBaseUrl } from "../site-context";

const COOKIE_NAME = "crm_client";
const TOKEN_TTL_MS = 30 * 60 * 1000; // magic link: 30 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // session: 30 days, sliding

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

function parseCookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // A malformed percent-encoding in one cookie must not 500 the request.
    }
  }
  return out;
}

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

// ── Rate limiting ───────────────────────────────────────────────────────────
// Fixed-window in-memory buckets, same process-local idiom the rest of the
// tower uses. Per-IP AND per-email; the email bucket is keyed on the requested
// address whether or not it exists, so throttling can't be an oracle.
const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 30;
const EMAIL_LIMIT = 5;
const buckets = new Map<string, number[]>();

function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

function setSessionCookie(res: any, token: string, maxAgeMs: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`,
  );
}

/**
 * The client-portal gate. Resolves the `crm_client` cookie to the session's
 * customer ids (and slides the expiry), or answers 401. No contractor session
 * is involved anywhere in this module.
 */
export async function requireClient(req: any, res: any): Promise<{ customerIds: string[] } | null> {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || token.length < 32) {
    res.status(401).json({ message: "Sign in required" });
    return null;
  }
  const [sess] = await db
    .select()
    .from(crmClientSessions)
    .where(eq(crmClientSessions.tokenHash, sha256(token)))
    .limit(1);
  if (!sess || sess.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ message: "Sign in required" });
    return null;
  }
  // Sliding expiry: every use pushes the session 30 days out.
  await db
    .update(crmClientSessions)
    .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
    .where(eq(crmClientSessions.id, sess.id))
    .catch(() => {});
  return { customerIds: Array.isArray(sess.customerIds) ? sess.customerIds : [] };
}

export function registerCrmClientAuthRoutes(app: Express): void {
  // ── Request a magic link ──────────────────────────────────────────────────
  app.post("/api/client/auth/request-link", async (req: any, res) => {
    const parsed = z.object({ email: z.string().email().max(320) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid email address" });

    const email = parsed.data.email.trim().toLowerCase();
    if (!allow(`ip:${clientIp(req)}`, IP_LIMIT) || !allow(`em:${email}`, EMAIL_LIMIT)) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    // Every crm_customers row with this email, across every org — a homeowner
    // of two contractors sees both contractors' documents after one sign-in.
    const customers = await db
      .select()
      .from(crmCustomers)
      .where(sql`lower(${crmCustomers.email}) = ${email}`);

    if (customers.length) {
      const token = randomBytes(32).toString("hex");
      await db.insert(crmClientTokens).values({
        tokenHash: sha256(token),
        customerIds: customers.map((c) => c.id),
        email,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });

      // Brand-neutral, from the platform, short. The link lands on the API
      // (verify → session cookie → 302), not on a page.
      const link = `${clientPortalBaseUrl(req)}/api/client/auth/verify?token=${token}`;
      try {
        await sendWithFallback({
          to: email,
          subject: "Your sign-in link — ConstructHUB",
          html: `
            <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px">
              <p style="font-size:16px">Hi,</p>
              <p style="font-size:16px">Use the secure link below to view your estimates, invoices and signed contracts.</p>
              <p style="margin:28px 0">
                <a href="${link}" style="background:#4f46e5;color:#fff;padding:13px 24px;border-radius:6px;
                   text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Sign in to your documents</a>
              </p>
              <p style="font-size:13px;color:#666">This link expires in 30 minutes and can only be used once.
                 If you didn't request it, you can ignore this email.</p>
              <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
              <p style="font-size:13px;color:#666">Sent by ConstructHUB on behalf of your contractor.</p>
            </div>`,
        } as any);
      } catch (e: any) {
        // The response must not change when mail fails — same { sent: true }
        // either way, so SMTP behaviour is never an enumeration oracle.
        console.error("[crm] client magic-link email failed:", String(e?.message || e).slice(0, 300));
      }
    }

    res.json({ sent: true });
  });

  // ── Redeem a magic link ───────────────────────────────────────────────────
  // Success: single-use check, mint session, set cookie, 302 to /.
  // Failure (bogus / used / expired): 302 to /?auth=invalid — the SPA renders
  // the explanation there. `client=1` is forwarded so dev (where the client
  // face is query-forced) survives the redirect; harmless on real hosts.
  app.get("/api/client/auth/verify", async (req: any, res) => {
    const dev = req.query?.client === "1" ? "&client=1" : "";
    const devOnly = req.query?.client === "1" ? "?client=1" : "";
    const invalid = () => res.redirect(302, `/?auth=invalid${dev}`);

    const token = String(req.query?.token || "");
    if (token.length < 32) return invalid();

    // Atomic single-use: only one concurrent verify can flip used_at.
    const [row] = await db
      .update(crmClientTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(crmClientTokens.tokenHash, sha256(token)),
          isNull(crmClientTokens.usedAt),
          sql`${crmClientTokens.expiresAt} > now()`,
        ),
      )
      .returning();
    if (!row) return invalid();

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(crmClientSessions).values({
      tokenHash: sha256(sessionToken),
      customerIds: row.customerIds,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      lastSeenAt: new Date(),
    });

    setSessionCookie(res, sessionToken, SESSION_TTL_MS);
    res.redirect(302, `/${devOnly}`);
  });

  // ── Sign out ──────────────────────────────────────────────────────────────
  app.post("/api/client/auth/logout", async (req: any, res) => {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token && token.length >= 32) {
      await db
        .delete(crmClientSessions)
        .where(eq(crmClientSessions.tokenHash, sha256(token)))
        .catch(() => {});
    }
    setSessionCookie(res, "", 0);
    res.json({ ok: true });
  });

  // ── The homeowner's documents ─────────────────────────────────────────────
  // Scoped strictly to the session's customerIds — never an id from the
  // request. Only documents the contractor actually SENT are visible (drafts
  // stay internal), voided invoices are excluded, and money fields are the
  // client's own — the same numbers the public token pages show them.
  app.get("/api/client/documents", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    if (!client.customerIds.length) {
      return res.json({ customer: null, orgs: [], estimates: [], invoices: [], contracts: [] });
    }

    const customers = await db
      .select()
      .from(crmCustomers)
      .where(inArray(crmCustomers.id, client.customerIds));
    const orgIds = [...new Set(customers.map((c) => c.orgId))];
    const orgs = orgIds.length
      ? await db.select().from(crmOrgs).where(inArray(crmOrgs.id, orgIds))
      : [];
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));

    const estimates = await db
      .select()
      .from(crmEstimates)
      .where(and(inArray(crmEstimates.customerId, client.customerIds), sql`${crmEstimates.sentAt} is not null`))
      .orderBy(desc(crmEstimates.createdAt));
    const invoices = await db
      .select()
      .from(crmInvoices)
      .where(
        and(
          inArray(crmInvoices.customerId, client.customerIds),
          sql`${crmInvoices.sentAt} is not null`,
          isNull(crmInvoices.voidedAt),
        ),
      )
      .orderBy(desc(crmInvoices.createdAt));

    const primary = customers[0];
    res.json({
      customer: primary
        ? { displayName: primary.displayName, email: primary.email }
        : null,
      orgs: orgs.map((o) => ({ id: o.id, name: o.name, logoUrl: o.logoUrl })),
      estimates: estimates.map((e) => ({
        id: e.id, number: e.number, title: e.title, status: e.status,
        totalCents: e.totalCents, sentAt: e.sentAt, expiresAt: e.expiresAt,
        approvedAt: e.approvedAt, declinedAt: e.declinedAt,
        orgName: orgName.get(e.orgId) ?? null,
        link: `/e/${e.publicToken}`,
      })),
      invoices: invoices.map((i) => ({
        id: i.id, number: i.number, title: i.title, status: i.status,
        totalCents: i.totalCents,
        dueCents: Math.max(0, i.totalCents - (i.retainageCents ?? 0) - (i.paidCents ?? 0)),
        dueAt: i.dueAt, paidAt: i.paidAt, sentAt: i.sentAt,
        orgName: orgName.get(i.orgId) ?? null,
        link: `/i/${i.publicToken}`,
      })),
      // A signed contract IS an approved estimate — the typed name from the
      // approve flow is the signature.
      contracts: estimates
        .filter((e) => e.approvedAt)
        .map((e) => ({
          id: e.id, number: e.number, title: e.title, totalCents: e.totalCents,
          signedName: e.signatureName, signedAt: e.approvedAt,
          orgName: orgName.get(e.orgId) ?? null,
          link: `/e/${e.publicToken}`,
        })),
    });
  });
}
