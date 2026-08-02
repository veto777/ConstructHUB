/**
 * Platform admin API — "watch all our users".
 *
 * These routes are for the people running ConstructHUB, not for CRM org
 * admins, so every handler is gated on the platform admin email list
 * (server/admin.ts) and NEVER on org membership. Everything is read-only
 * except issuing beta invites.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  users,
  subscriptions,
  crmOrgs,
  crmMembers,
  crmCustomers,
  crmProjects,
  crmEstimates,
  crmInvoices,
  crmPayments,
  crmBetaInvites,
} from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { isPlatformAdminEmail } from "../admin";
import { getBaseUrl } from "../auth";
import { sendWithFallback } from "../email";
import { getSeatUsage } from "./tenancy";
import { hashBetaToken, BETA_INVITE_DAYS } from "./beta";

type GetUser = (req: any, res: any) => any;

/**
 * Platform-admin gate. getDevUser may hand back a bare { id } (dev bypass /
 * demo autologin), so the email always comes from the users row — never from
 * the session object. Responds and returns null when the caller isn't one.
 */
async function requirePlatformAdmin(req: any, res: any, getDevUser: GetUser) {
  const user = getDevUser(req, res);
  if (!user) return null;
  const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!account || !isPlatformAdminEmail(account.email)) {
    res.status(403).json({ message: "Platform admin access required" });
    return null;
  }
  return account;
}

/** Per-owner subscription plan, keyed by user id (one subscriptions row each). */
async function plansByUserId() {
  const subs = await db.select().from(subscriptions);
  const map = new Map<number, { plan: string; status: string }>();
  for (const s of subs) map.set(s.userId, { plan: s.plan, status: s.status });
  return map;
}

const betaInviteSchema = z.object({ email: z.string().email() });

export function registerCrmAdminRoutes(app: Express, getDevUser: GetUser): void {
  /** Headline counters for the whole platform. */
  app.get("/api/admin/overview", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const count = async (table: any) => {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
      return row.n;
    };
    const [pay] = await db
      .select({
        count: sql<number>`count(*)::int`,
        succeededCents: sql<number>`coalesce(sum(case when ${crmPayments.status} = 'succeeded' then ${crmPayments.amountCents} else 0 end), 0)::int`,
      })
      .from(crmPayments);
    const [{ n: betaUsers }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.betaAt} is not null`);

    res.json({
      users: await count(users),
      orgs: await count(crmOrgs),
      customers: await count(crmCustomers),
      estimates: await count(crmEstimates),
      invoices: await count(crmInvoices),
      payments: { count: pay.count, succeededCents: pay.succeededCents },
      betaUsers,
    });
  });

  /** Every account, with its org memberships and billing plan. */
  app.get("/api/admin/users", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const memberships = await db
      .select({
        userId: crmMembers.userId,
        orgId: crmMembers.orgId,
        orgName: crmOrgs.name,
        role: crmMembers.role,
        status: crmMembers.status,
        lastActiveAt: crmMembers.lastActiveAt,
      })
      .from(crmMembers)
      .innerJoin(crmOrgs, eq(crmOrgs.id, crmMembers.orgId));
    const plans = await plansByUserId();

    const byUser = new Map<number, typeof memberships>();
    for (const m of memberships) {
      if (m.userId == null) continue;
      const list = byUser.get(m.userId) ?? [];
      list.push(m);
      byUser.set(m.userId, list);
    }

    res.json(
      allUsers.map((u) => {
        const orgs = byUser.get(u.id) ?? [];
        // The users table tracks no sign-in stamp; the closest honest signal
        // is the CRM activity stamp on their memberships.
        const lastActiveAt = orgs
          .map((o) => o.lastActiveAt)
          .filter(Boolean)
          .sort()
          .pop() ?? null;
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          createdAt: u.createdAt,
          lastActiveAt,
          betaAt: u.betaAt,
          plan: plans.get(u.id) ?? { plan: "free", status: "inactive" },
          orgs: orgs.map((o) => ({
            orgId: o.orgId,
            orgName: o.orgName,
            role: o.role,
            status: o.status,
          })),
        };
      }),
    );
  });

  /** Every org, with usage counts and the owner's plan. */
  app.get("/api/admin/orgs", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const countByOrg = async (table: any, col: any) => {
      const rows = await db
        .select({ orgId: col, n: sql<number>`count(*)::int` })
        .from(table)
        .groupBy(col);
      return new Map<string, number>(rows.map((r: any) => [r.orgId, r.n]));
    };

    const [orgs, memberCounts, customerCounts, projectCounts, estimateCounts, invoiceCounts, owners, plans] =
      await Promise.all([
        db.select().from(crmOrgs).orderBy(desc(crmOrgs.createdAt)),
        countByOrg(crmMembers, crmMembers.orgId),
        countByOrg(crmCustomers, crmCustomers.orgId),
        countByOrg(crmProjects, crmProjects.orgId),
        countByOrg(crmEstimates, crmEstimates.orgId),
        countByOrg(crmInvoices, crmInvoices.orgId),
        db.select({ id: users.id, email: users.email, betaAt: users.betaAt }).from(users),
        plansByUserId(),
      ]);
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    res.json(
      orgs.map((o) => {
        const owner = ownerById.get(o.ownerUserId);
        return {
          id: o.id,
          name: o.name,
          createdAt: o.createdAt,
          owner: owner ? { userId: owner.id, email: owner.email, betaAt: owner.betaAt } : null,
          plan: plans.get(o.ownerUserId) ?? { plan: "free", status: "inactive" },
          counts: {
            members: memberCounts.get(o.id) ?? 0,
            customers: customerCounts.get(o.id) ?? 0,
            projects: projectCounts.get(o.id) ?? 0,
            estimates: estimateCounts.get(o.id) ?? 0,
            invoices: invoiceCounts.get(o.id) ?? 0,
          },
        };
      }),
    );
  });

  /** One org in depth: members, seat usage, recent documents. */
  app.get("/api/admin/orgs/:id", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, req.params.id)).limit(1);
    if (!org) return res.status(404).json({ message: "Organization not found" });

    const [members, seats, recentEstimates, recentInvoices] = await Promise.all([
      db
        .select()
        .from(crmMembers)
        .where(eq(crmMembers.orgId, org.id))
        .orderBy(desc(crmMembers.lastActiveAt)),
      getSeatUsage(org),
      db
        .select({
          id: crmEstimates.id,
          number: crmEstimates.number,
          title: crmEstimates.title,
          status: crmEstimates.status,
          totalCents: crmEstimates.totalCents,
          createdAt: crmEstimates.createdAt,
        })
        .from(crmEstimates)
        .where(eq(crmEstimates.orgId, org.id))
        .orderBy(desc(crmEstimates.createdAt))
        .limit(10),
      db
        .select({
          id: crmInvoices.id,
          number: crmInvoices.number,
          title: crmInvoices.title,
          status: crmInvoices.status,
          totalCents: crmInvoices.totalCents,
          paidCents: crmInvoices.paidCents,
          createdAt: crmInvoices.createdAt,
        })
        .from(crmInvoices)
        .where(eq(crmInvoices.orgId, org.id))
        .orderBy(desc(crmInvoices.createdAt))
        .limit(10),
    ]);

    const [owner] = await db
      .select({ id: users.id, email: users.email, betaAt: users.betaAt })
      .from(users)
      .where(eq(users.id, org.ownerUserId))
      .limit(1);
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, org.ownerUserId))
      .limit(1);

    res.json({
      org,
      owner: owner ?? null,
      plan: sub ? { plan: sub.plan, status: sub.status } : { plan: "free", status: "inactive" },
      seats,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.email,
        role: m.role,
        status: m.status,
        displayName: m.displayName,
        lastActiveAt: m.lastActiveAt,
        createdAt: m.createdAt,
      })),
      recentEstimates,
      recentInvoices,
    });
  });

  // ── Beta invites ──────────────────────────────────────────────────────────
  // The one mutation in this module: issuing an invite. Acceptance happens in
  // the auth flows (server/auth.ts via server/crm/beta.ts).

  app.get("/api/admin/beta-invites", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const rows = await db
      .select()
      .from(crmBetaInvites)
      .orderBy(desc(crmBetaInvites.createdAt));
    const now = Date.now();
    // Never leak the token hash to a list view.
    res.json(
      rows.map(({ tokenHash: _h, ...inv }) => ({
        ...inv,
        status: inv.acceptedAt ? "accepted" : inv.expiresAt.getTime() < now ? "expired" : "pending",
      })),
    );
  });

  app.post("/api/admin/beta-invites", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;

    const parsed = betaInviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "A valid email is required" });
    const email = parsed.data.email.toLowerCase().trim();

    // One live invite per email — re-issuing would mint a second token for the
    // same person and muddy the "who's in the beta" list.
    const [pending] = await db
      .select()
      .from(crmBetaInvites)
      .where(
        and(
          sql`lower(${crmBetaInvites.email}) = ${email}`,
          isNull(crmBetaInvites.acceptedAt),
          sql`${crmBetaInvites.expiresAt} > now()`,
        ),
      )
      .limit(1);
    if (pending) {
      return res.status(409).json({ message: `${email} already has a pending invite` });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + BETA_INVITE_DAYS * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(crmBetaInvites)
      .values({
        email,
        tokenHash: hashBetaToken(token),
        invitedByUserId: admin.id,
        expiresAt,
      })
      .returning();

    const link = `${getBaseUrl(req)}/auth?beta=${token}`;
    let emailed = false;
    try {
      await sendWithFallback({
        to: email,
        subject: "You're invited to the ConstructHub CRM beta",
        html: `
          <p>You're invited to the ConstructHub CRM beta — unlimited access during beta.</p>
          <p><strong>This link creates a brand-new workspace for your own company</strong> — your clients, your price book, your team. Nothing is shared with anyone else.</p>
          <p><a href="${link}">Create your account</a></p>
          <p>This link expires in ${BETA_INVITE_DAYS} days and can be used once. If you weren't expecting it, you can ignore this email.</p>
        `,
      });
      emailed = true;
    } catch (e: any) {
      // SMTP failure must not lose the invite — return the link so the admin
      // UI can offer copy-to-clipboard instead.
      console.error("[crm] beta invite email failed:", e?.message || e);
    }

    const { tokenHash: _h, ...safe } = invite;
    res.status(201).json({ invite: { ...safe, status: "pending" }, link, emailed });
  });

  /** Revoke a PENDING invite: the row (and with it the only copy of the token
   *  hash) is deleted, so the emailed link stops minting beta access. An
   *  accepted invite can't be revoked — the account already exists. */
  app.delete("/api/admin/beta-invites/:id", async (req: any, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const [inv] = await db.select().from(crmBetaInvites)
      .where(eq(crmBetaInvites.id, req.params.id)).limit(1);
    if (!inv) return res.status(404).json({ message: "Invite not found" });
    if (inv.acceptedAt) {
      return res.status(409).json({ message: "This invite was already accepted — the account exists. Manage the user instead." });
    }
    await db.delete(crmBetaInvites).where(eq(crmBetaInvites.id, inv.id));
    res.json({ ok: true });
  });
}
