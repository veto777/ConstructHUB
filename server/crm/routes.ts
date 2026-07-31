/**
 * CRM identity API — profile, company, team, roles and invitations.
 *
 * Every route resolves the caller's active org through requireOrg() and scopes
 * all queries by that org id. An org id is never taken from the request body.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmOrgs,
  crmMembers,
  crmInvitations,
  users,
  crmEffectivePermissions,
  CRM_ROLES,
  CRM_PERMISSIONS,
  CRM_ROLE_DEFAULTS,
  CRM_NOTIFICATION_PREFS,
} from "@shared/schema";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { requireOrg, requirePermission, listOrgsForUser, getSeatUsage } from "./tenancy";
import { registerCrmEntityRoutes } from "./entities";
import { registerCrmPortalRoutes, registerCrmInvoicePortalRoutes } from "./portal";
import { registerCrmPaymentRoutes } from "./payments";
import { registerCrmOpsRoutes, registerCrmPhaseRoutes } from "./ops";
import { registerCrmIntegrationRoutes } from "./integrations";
import { registerCrmPriceBookRoutes, registerCrmMeasurementRoutes } from "./pricebook";
import { registerCrmClientAuthRoutes } from "./client-auth";
import { getBaseUrl } from "../auth";
import { sendWithFallback } from "../email";

type GetUser = (req: any, res: any) => any;

const roleSchema = z.enum(CRM_ROLES as unknown as [string, ...string[]]);
const permissionsSchema = z
  .record(z.boolean())
  .refine((o) => Object.keys(o).every((k) => (CRM_PERMISSIONS as readonly string[]).includes(k)), {
    message: "Unknown permission key",
  });

const orgPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legalEntityName: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  logoUrl: z.string().max(1000).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(60).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
  timezone: z.string().max(60).nullable().optional(),
  licenseNumber: z.string().max(80).nullable().optional(),
  licenseState: z.string().max(10).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  invoiceFooter: z.string().max(5000).nullable().optional(),
  estimateFooter: z.string().max(5000).nullable().optional(),
  termsAndConditions: z.string().max(20000).nullable().optional(),
  warrantyText: z.string().max(5000).nullable().optional(),
  defaultDepositBps: z.number().int().min(0).max(10000).nullable().optional(),
  // Merged INTO custom_fields (never a wholesale replace — the HCP importer
  // stores reference data there too). Unknown keys are rejected.
  notificationPrefs: z
    .record(z.boolean())
    .refine((o) => Object.keys(o).every((k) => (CRM_NOTIFICATION_PREFS as readonly string[]).includes(k)), {
      message: "Unknown notification preference key",
    })
    .optional(),
});

const profilePatchSchema = z.object({
  displayName: z.string().max(120).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  avatarUrl: z.string().max(1000).nullable().optional(),
  calendarColor: z.string().max(20).nullable().optional(),
});

const memberPatchSchema = z.object({
  role: roleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
  displayName: z.string().max(120).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  calendarColor: z.string().max(20).nullable().optional(),
  hourlyCostCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  permissions: permissionsSchema.nullable().optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: roleSchema.default("field"),
  permissions: permissionsSchema.optional(),
  displayName: z.string().max(120).optional(),
});

/** Strip anything the caller isn't allowed to see (cost rates are privileged). */
function presentMember(m: typeof crmMembers.$inferSelect, canSeeCosts: boolean) {
  return {
    id: m.id,
    userId: m.userId,
    email: m.email,
    role: m.role,
    status: m.status,
    displayName: m.displayName,
    title: m.title,
    phone: m.phone,
    avatarUrl: m.avatarUrl,
    calendarColor: m.calendarColor,
    hourlyCostCents: canSeeCosts ? m.hourlyCostCents : undefined,
    permissions: m.permissions ?? null,
    effectivePermissions: crmEffectivePermissions(m.role, m.permissions),
    lastActiveAt: m.lastActiveAt,
    createdAt: m.createdAt,
  };
}

export function registerCrmRoutes(app: Express, getDevUser: GetUser): void {
  // Entities (customers/projects/jobs/estimates) and the client portal live in
  // their own files to keep this one about identity.
  registerCrmEntityRoutes(app, getDevUser);
  registerCrmPortalRoutes(app, getDevUser);
  registerCrmInvoicePortalRoutes(app, getDevUser);
  registerCrmPaymentRoutes(app, getDevUser);
  registerCrmOpsRoutes(app, getDevUser);
  registerCrmPhaseRoutes(app, getDevUser);
  registerCrmIntegrationRoutes(app);
  registerCrmPriceBookRoutes(app, getDevUser);
  registerCrmMeasurementRoutes(app, getDevUser);
  // The homeowner client portal takes no contractor session at all.
  registerCrmClientAuthRoutes(app);

  // ── Identity ──────────────────────────────────────────────────────────────

  /** Everything the client needs to boot the CRM: user, org, role, permissions. */
  app.get("/api/crm/me", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const orgs = await listOrgsForUser(user.id);
    const seats = await getSeatUsage(ctx.org);

    // Best-effort activity stamp; never fail the request over it.
    db.update(crmMembers)
      .set({ lastActiveAt: new Date() })
      .where(eq(crmMembers.id, ctx.member.id))
      .catch(() => {});

    res.json({
      user: account
        ? { id: account.id, email: account.email, displayName: account.displayName, avatarUrl: account.avatarUrl }
        : { id: user.id },
      org: ctx.org,
      member: presentMember(ctx.member, ctx.permissions.seeCosts),
      permissions: ctx.permissions,
      orgs,
      seats,
      roles: CRM_ROLES,
      permissionKeys: CRM_PERMISSIONS,
      roleDefaults: CRM_ROLE_DEFAULTS,
    });
  });

  /** Update your own membership profile (name/title/phone/colour). */
  app.patch("/api/crm/profile", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid profile", issues: parsed.error.issues });

    const [row] = await db
      .update(crmMembers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(crmMembers.id, ctx.member.id))
      .returning();
    res.json(presentMember(row, ctx.permissions.seeCosts));
  });

  /** Switch active org. Only orgs the caller is an active member of. */
  app.post("/api/crm/org/switch", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const orgId = String(req.body?.orgId || "");
    if (!orgId) return res.status(400).json({ message: "orgId required" });

    const rows = await db
      .select()
      .from(crmMembers)
      .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.userId, user.id), eq(crmMembers.status, "active")))
      .limit(1);
    if (!rows.length) return res.status(403).json({ message: "Not a member of that organization" });

    if (req.session) req.session.activeOrgId = orgId;
    res.json({ ok: true, orgId });
  });

  // ── Onboarding pipeline ───────────────────────────────────────────────────
  // The server owns "what should this user do next" so the portal never dead-
  // ends. Every step reports done/blocked plus the path to go to, and the
  // client just follows nextPath.

  app.get("/api/crm/onboarding", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const members = await db.select().from(crmMembers).where(eq(crmMembers.orgId, ctx.org.id));
    const org = ctx.org;
    const me = ctx.member;

    const profileDone = Boolean(me.displayName?.trim() && me.phone?.trim());
    const companyDone = Boolean(
      org.name?.trim() && org.addressLine1?.trim() && org.city?.trim() && org.state?.trim() && org.phone?.trim(),
    );
    // "Team" counts as handled once anyone else exists (invited or active) —
    // a solo contractor is legitimate, so this step is never blocking.
    const teamDone = members.length > 1;

    const steps = [
      {
        key: "profile",
        label: "Your profile",
        description: "Your name and mobile, so your crew knows who's who.",
        path: "/crm/team?tab=profile",
        done: profileDone,
        required: true,
      },
      {
        key: "company",
        label: "Company details",
        description: "Business name, address and phone — these print on estimates and invoices.",
        path: "/crm/team?tab=company",
        done: companyDone,
        required: true,
        locked: !ctx.permissions.manageSettings,
      },
      {
        key: "team",
        label: "Invite your crew",
        description: "Add office staff, field techs or subs. You can do this later.",
        path: "/crm/team?tab=team",
        done: teamDone,
        required: false,
        locked: !ctx.permissions.manageTeam,
      },
    ];

    // Next = first unfinished step the caller is actually allowed to do.
    const actionable = steps.filter((s) => !s.done && !s.locked);
    const requiredLeft = actionable.filter((s) => s.required);
    const next = requiredLeft[0] ?? actionable[0] ?? null;

    const requiredComplete = steps.filter((s) => s.required).every((s) => s.done || s.locked);
    const dismissed = Boolean(org.onboardingDismissedAt);

    res.json({
      steps,
      nextStep: next?.key ?? null,
      nextPath: next?.path ?? "/",
      requiredComplete,
      dismissed,
      // The portal shows the checklist until the required steps are done AND
      // the owner has acknowledged it.
      showChecklist: !dismissed && !(requiredComplete && teamDone),
      completedCount: steps.filter((s) => s.done).length,
      totalCount: steps.length,
    });
  });

  app.post("/api/crm/onboarding/dismiss", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings")) return;

    const [row] = await db
      .update(crmOrgs)
      .set({ onboardingDismissedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmOrgs.id, ctx.org.id))
      .returning();
    res.json({ ok: true, dismissedAt: row?.onboardingDismissedAt ?? null });
  });

  // ── Company profile ───────────────────────────────────────────────────────

  app.get("/api/crm/org", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    res.json(ctx.org);
  });

  app.patch("/api/crm/org", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings")) return;

    const parsed = orgPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid company profile", issues: parsed.error.issues });

    // notificationPrefs is a virtual field: it merges into custom_fields so the
    // rest of that jsonb (e.g. HCP import reference data) is never clobbered.
    const { notificationPrefs, ...profile } = parsed.data;
    const [row] = await db
      .update(crmOrgs)
      .set({
        ...profile,
        ...(notificationPrefs
          ? {
              customFields: {
                ...((ctx.org.customFields as Record<string, unknown> | null) ?? {}),
                notificationPrefs: {
                  ...(((ctx.org.customFields as any)?.notificationPrefs as Record<string, boolean> | undefined) ?? {}),
                  ...notificationPrefs,
                },
              },
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(crmOrgs.id, ctx.org.id))
      .returning();
    res.json(row);
  });

  // ── Team ──────────────────────────────────────────────────────────────────

  app.get("/api/crm/members", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const rows = await db
      .select()
      .from(crmMembers)
      .where(eq(crmMembers.orgId, ctx.org.id))
      .orderBy(desc(crmMembers.createdAt));

    res.json({
      members: rows.map((m) => presentMember(m, ctx.permissions.seeCosts)),
      seats: await getSeatUsage(ctx.org),
    });
  });

  app.patch("/api/crm/members/:id", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageTeam")) return;

    const parsed = memberPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid member", issues: parsed.error.issues });

    const [target] = await db
      .select()
      .from(crmMembers)
      .where(and(eq(crmMembers.id, req.params.id), eq(crmMembers.orgId, ctx.org.id)))
      .limit(1);
    if (!target) return res.status(404).json({ message: "Member not found" });

    // The owner seat is load-bearing: it holds the subscription and the seat
    // limit. Never let it be demoted or disabled, including by itself.
    const isOwnerSeat = target.userId === ctx.org.ownerUserId;
    if (isOwnerSeat && (parsed.data.role !== undefined || parsed.data.status !== undefined)) {
      return res.status(400).json({
        message: "The owner's role and status cannot be changed. Transfer ownership first.",
      });
    }
    // Only an owner may mint another owner.
    if (parsed.data.role === "owner" && ctx.member.role !== "owner") {
      return res.status(403).json({ message: "Only an owner can grant the owner role" });
    }
    // Re-activating a seat has to respect the plan limit.
    if (parsed.data.status === "active" && target.status !== "active") {
      const seats = await getSeatUsage(ctx.org);
      if (!seats.canAddSeat) {
        return res.status(402).json({ message: "Seat limit reached", seats });
      }
    }

    const [row] = await db
      .update(crmMembers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(crmMembers.id, target.id))
      .returning();
    res.json(presentMember(row, ctx.permissions.seeCosts));
  });

  /** Deactivate rather than delete — job history must keep pointing somewhere. */
  app.delete("/api/crm/members/:id", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageTeam")) return;

    const [target] = await db
      .select()
      .from(crmMembers)
      .where(and(eq(crmMembers.id, req.params.id), eq(crmMembers.orgId, ctx.org.id)))
      .limit(1);
    if (!target) return res.status(404).json({ message: "Member not found" });
    if (target.userId === ctx.org.ownerUserId) {
      return res.status(400).json({ message: "The owner cannot be removed. Transfer ownership first." });
    }

    const [row] = await db
      .update(crmMembers)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(crmMembers.id, target.id))
      .returning();
    res.json(presentMember(row, ctx.permissions.seeCosts));
  });

  // ── Invitations ───────────────────────────────────────────────────────────

  app.get("/api/crm/invitations", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageTeam")) return;

    const rows = await db
      .select()
      .from(crmInvitations)
      .where(and(eq(crmInvitations.orgId, ctx.org.id), isNull(crmInvitations.acceptedAt), isNull(crmInvitations.revokedAt)))
      .orderBy(desc(crmInvitations.createdAt));
    // Never leak the raw token to a list view.
    res.json(rows.map(({ token, ...rest }) => rest));
  });

  app.post("/api/crm/invitations", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageTeam")) return;

    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid invitation", issues: parsed.error.issues });
    const { email, role, permissions, displayName } = parsed.data;

    if (role === "owner" && ctx.member.role !== "owner") {
      return res.status(403).json({ message: "Only an owner can invite another owner" });
    }

    const seats = await getSeatUsage(ctx.org);
    if (!seats.canAddSeat) {
      return res.status(402).json({
        message: `Your ${seats.planName} plan includes ${seats.limit} seat${seats.limit === 1 ? "" : "s"} and ${seats.used} ${seats.used === 1 ? "is" : "are"} in use.`,
        seats,
      });
    }

    const lower = email.toLowerCase();
    const existing = await db
      .select()
      .from(crmMembers)
      .where(and(eq(crmMembers.orgId, ctx.org.id), sql`lower(${crmMembers.email}) = ${lower}`))
      .limit(1);
    if (existing.length && existing[0].status !== "disabled") {
      return res.status(409).json({ message: "That person is already on your team" });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const [invite] = await db
      .insert(crmInvitations)
      .values({
        orgId: ctx.org.id,
        email: lower,
        role,
        permissions: permissions ?? null,
        token,
        invitedByUserId: user.id,
        expiresAt,
      })
      .returning();

    // Hold the seat immediately so two invites can't race past the limit.
    if (existing.length) {
      await db
        .update(crmMembers)
        .set({ status: "invited", role, permissions: permissions ?? null, displayName: displayName ?? null, updatedAt: new Date() })
        .where(eq(crmMembers.id, existing[0].id));
    } else {
      await db.insert(crmMembers).values({
        orgId: ctx.org.id,
        userId: null,
        email: lower,
        role,
        status: "invited",
        displayName: displayName ?? null,
        permissions: permissions ?? null,
      });
    }

    const link = `${getBaseUrl(req)}/crm/join?token=${token}`;
    let emailed = false;
    try {
      await sendWithFallback({
        to: email,
        subject: `You've been invited to join ${ctx.org.name} on ConstructHub CRM`,
        html: `
          <p>${ctx.org.name} has invited you to join their team on ConstructHub CRM.</p>
          <p><a href="${link}">Accept the invitation</a></p>
          <p>This link expires in 14 days. If you weren't expecting it, you can ignore this email.</p>
        `,
      });
      emailed = true;
    } catch (e: any) {
      // SMTP failure must not lose the invitation — return the link so the UI
      // can offer copy-to-clipboard instead.
      console.error("[crm] invite email failed:", e?.message || e);
    }

    const { token: _t, ...safe } = invite;
    res.status(201).json({ invitation: safe, link, emailed });
  });

  app.delete("/api/crm/invitations/:id", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageTeam")) return;

    const [invite] = await db
      .select()
      .from(crmInvitations)
      .where(and(eq(crmInvitations.id, req.params.id), eq(crmInvitations.orgId, ctx.org.id)))
      .limit(1);
    if (!invite) return res.status(404).json({ message: "Invitation not found" });

    await db.update(crmInvitations).set({ revokedAt: new Date() }).where(eq(crmInvitations.id, invite.id));
    // Release the held seat.
    await db
      .delete(crmMembers)
      .where(
        and(
          eq(crmMembers.orgId, ctx.org.id),
          sql`lower(${crmMembers.email}) = ${invite.email.toLowerCase()}`,
          eq(crmMembers.status, "invited"),
        ),
      );
    res.json({ ok: true });
  });

  /** Look up an invitation by token (public — shows who invited you before login). */
  app.get("/api/crm/invitations/lookup/:token", async (req: any, res) => {
    const [invite] = await db
      .select()
      .from(crmInvitations)
      .where(eq(crmInvitations.token, req.params.token))
      .limit(1);
    if (!invite || invite.revokedAt) return res.status(404).json({ message: "Invitation not found" });
    if (invite.acceptedAt) return res.status(409).json({ message: "This invitation has already been used" });
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "This invitation has expired" });
    }
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, invite.orgId)).limit(1);
    res.json({ email: invite.email, role: invite.role, orgName: org?.name ?? null });
  });

  /** Accept an invitation as the logged-in user. */
  app.post("/api/crm/invitations/accept", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ message: "token required" });

    const [invite] = await db.select().from(crmInvitations).where(eq(crmInvitations.token, token)).limit(1);
    if (!invite || invite.revokedAt) return res.status(404).json({ message: "Invitation not found" });
    if (invite.acceptedAt) return res.status(409).json({ message: "This invitation has already been used" });
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "This invitation has expired" });
    }

    const [account] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    // The invite is addressed to an email; accepting from a different account
    // would silently give the wrong person access.
    if (account?.email && account.email.toLowerCase() !== invite.email.toLowerCase()) {
      return res.status(403).json({
        message: `This invitation was sent to ${invite.email}. Sign in as that account to accept it.`,
      });
    }

    const [placeholder] = await db
      .select()
      .from(crmMembers)
      .where(
        and(
          eq(crmMembers.orgId, invite.orgId),
          sql`lower(${crmMembers.email}) = ${invite.email.toLowerCase()}`,
        ),
      )
      .limit(1);

    if (placeholder) {
      await db
        .update(crmMembers)
        .set({
          userId: user.id,
          status: "active",
          displayName: placeholder.displayName ?? account?.displayName ?? null,
          avatarUrl: account?.avatarUrl ?? null,
          updatedAt: new Date(),
        })
        .where(eq(crmMembers.id, placeholder.id));
    } else {
      await db.insert(crmMembers).values({
        orgId: invite.orgId,
        userId: user.id,
        email: invite.email,
        role: invite.role,
        status: "active",
        permissions: invite.permissions ?? null,
        displayName: account?.displayName ?? null,
        avatarUrl: account?.avatarUrl ?? null,
      });
    }

    await db.update(crmInvitations).set({ acceptedAt: new Date() }).where(eq(crmInvitations.id, invite.id));
    if (req.session) req.session.activeOrgId = invite.orgId;
    res.json({ ok: true, orgId: invite.orgId });
  });
}
