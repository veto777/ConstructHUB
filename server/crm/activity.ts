/**
 * Accountability log — HCP-style "who did what, when" for everything that
 * happens in the org. Writes are fire-and-forget one-liners at the real
 * mutation points (`recordActivity` / `logActivity`); reads feed the two
 * audit surfaces:
 *
 *   - GET /api/crm/customers/:id/activity — every audit row for one client,
 *     folded into the client-360 timeline on the client page (manageJobs).
 *   - GET /api/crm/members/:id/activity   — everything one person did,
 *     newest first, sign-ins included. OWNER role only (same hard gate as
 *     the hard-delete routes — a permission override must not grant it).
 *
 * actor_label is a snapshot taken at write time (member display name,
 * "client" or "system") so history survives renames and removals. meta
 * carries field names and amounts only — never passwords or tokens.
 */
import type { Express } from "express";
import { db } from "../db";
import { crmActivityLog, crmCustomers, crmMembers, type CrmActivityLogRow } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";

type GetUser = (req: any, res: any) => any;

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Sign-in / sign-out rows: one per org the user holds an active seat in. */
export async function logMemberAuth(
  user: { id: number; email: string; displayName: string | null },
  action: "login" | "logout",
): Promise<void> {
  const seats = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.userId, user.id), eq(crmMembers.status, "active")));
  for (const seat of seats) {
    recordActivity({
      orgId: seat.orgId,
      actorMemberId: seat.id,
      actorLabel: seat.displayName || user.displayName || user.email,
      action,
      entityType: "member",
      entityId: seat.id,
    });
  }
}

/** Insert one audit row. Never throws — a dead insert must not break the mutation it describes. */
export function recordActivity(row: {
  orgId: string;
  actorMemberId?: string | null;
  actorLabel: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  customerId?: string | null;
  meta?: Record<string, unknown> | null;
}): void {
  db.insert(crmActivityLog)
    .values({
      orgId: row.orgId,
      actorMemberId: row.actorMemberId ?? null,
      actorLabel: row.actorLabel.slice(0, 200),
      action: row.action,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      customerId: row.customerId ?? null,
      meta: row.meta ?? null,
    })
    .catch((e: any) => console.error("[crm] activity log failed:", e?.message || e));
}

/** The one-liner most routes want: actor from the org context. */
export function logActivity(
  ctx: OrgContext,
  action: string,
  extra: {
    entityType?: string | null;
    entityId?: string | null;
    customerId?: string | null;
    meta?: Record<string, unknown> | null;
  } = {},
): void {
  recordActivity({
    orgId: ctx.org.id,
    actorMemberId: ctx.member.id,
    actorLabel: ctx.member.displayName || ctx.member.email,
    action,
    ...extra,
  });
}

// ── Human text for the audit surfaces (pure) ────────────────────────────────

/** "Dave updated estimate E-1847" — the sentence the two audit UIs render. */
export function activityText(row: {
  actorLabel: string;
  action: string;
  meta?: unknown;
}): string {
  const m = (row.meta ?? {}) as Record<string, any>;
  const fields = Array.isArray(m.fields) && m.fields.length ? ` (${m.fields.join(", ")})` : "";
  const verb = (() => {
    switch (row.action) {
      case "login": return "signed in";
      case "logout": return "signed out";
      case "estimate.created": return `created estimate ${m.number ?? ""}`.trim();
      case "estimate.updated": return `updated estimate ${m.number ?? ""}`.trim();
      case "estimate.deleted": return `deleted estimate ${m.number ?? ""}`.trim();
      case "invoice.created": return `created invoice ${m.number ?? ""}`.trim();
      case "invoice.updated": return `updated invoice ${m.number ?? ""}${m.change ? ` (${m.change})` : ""}`.trim();
      case "invoice.deleted": return `deleted invoice ${m.number ?? ""}`.trim();
      case "customer.created": return "created this client";
      case "customer.updated": return `updated client details${fields}`;
      case "customer.deleted": return "deleted this client";
      case "member.updated": return `updated ${m.name ? `${m.name}'s` : "their"} account${fields}`;
      case "invitation.sent": return `invited ${m.email ?? "a new member"}`;
      case "invitation.resent": return `resent the invitation to ${m.email ?? ""}`.trim();
      case "invitation.revoked": return `revoked the invitation to ${m.email ?? ""}`.trim();
      case "invitation.accepted": return "accepted the invitation and joined the team";
      case "pricebook.updated": return `${m.change ?? "updated"} price book item ${m.name ?? ""}`.trim();
      case "discount.updated": return `updated discount offers on estimate ${m.number ?? ""}`.trim();
      case "payment.recorded":
        return `recorded payment ${money(m.amountCents)}${m.method ? ` via ${m.method}` : ""}${m.number ? ` on invoice ${m.number}` : ""}`;
      case "data.exported": return `exported the client list${m.rows != null ? ` (${m.rows} rows)` : ""}`;
      default: return row.action;
    }
  })();
  return `${row.actorLabel} ${verb}`;
}

/** The shape the client-360 timeline and the team-page dropdown both render. */
function present(row: CrmActivityLogRow) {
  return {
    id: `act-${row.id}`,
    kind: "audit" as const,
    action: row.action,
    actor: row.actorLabel,
    text: activityText(row),
    at: (row.createdAt ?? new Date()).toISOString(),
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmActivityRoutes(app: Express, getDevUser: GetUser): void {
  /** Every audit row for one client, newest first — folded into the client-360 timeline. */
  app.get("/api/crm/customers/:id/activity", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageJobs")) return;

    const [cust] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    const rows = await db.select().from(crmActivityLog)
      .where(and(eq(crmActivityLog.orgId, ctx.org.id), eq(crmActivityLog.customerId, cust.id)))
      .orderBy(desc(crmActivityLog.createdAt)).limit(100);
    res.json(rows.map(present));
  });

  /** Everything one person did, newest first, sign-ins included. Owner role only. */
  app.get("/api/crm/members/:id/activity", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (ctx.member.role !== "owner") {
      return res.status(403).json({ message: "Only the account owner can review member activity." });
    }

    const rows = await db.select().from(crmActivityLog)
      .where(and(eq(crmActivityLog.orgId, ctx.org.id), eq(crmActivityLog.actorMemberId, req.params.id)))
      .orderBy(desc(crmActivityLog.createdAt)).limit(200);
    res.json(rows.map(present));
  });
}
