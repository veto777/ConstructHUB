import { objectPolicy, type ObjectKind } from "./object-access";
import { divisionScopeOf } from "./divisions";
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
import {
  CRM_PERMISSION_LABELS, CRM_MEMBER_FIELD_LABELS, CRM_CUSTOMER_FIELD_LABELS, crmFieldLabel,
} from "@shared/crm-access";

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
  // Field keys are stored as written (hourlyCostCents); a person reads labels ("cost rate").
  const labelled = (labels: Record<string, string>) => {
    const keys: string[] = Array.isArray(m.fields) ? m.fields.map(String) : [];
    const names = Array.from(new Set(keys.map((k) => crmFieldLabel(k, labels))));
    return names.length ? ` (${names.join(", ")})` : "";
  };
  const memberChange = () => {
    const who = m.name ? `${m.name}'s` : "their";
    const parts: string[] = [];
    if (m.role?.to) parts.push(`role ${m.role.from ? `${m.role.from} → ` : "set to "}${m.role.to}`);
    if (m.status?.to) parts.push(m.status.to === "disabled" ? "seat turned off" : m.status.to === "active" ? "seat turned back on" : `status ${m.status.to}`);
    const switches: { key: string; on: boolean }[] = Array.isArray(m.permissionChanges) ? m.permissionChanges : [];
    const label = (k: string) => `“${(CRM_PERMISSION_LABELS as Record<string, string>)[k] ?? crmFieldLabel(k, {})}”`;
    const on = switches.filter((x) => x.on).map((x) => label(x.key));
    const off = switches.filter((x) => !x.on).map((x) => label(x.key));
    if (on.length) parts.push(`turned on ${on.join(", ")}`);
    if (off.length) parts.push(`turned off ${off.join(", ")}`);
    // Whatever else changed, by label — role/status/permissions are already spelled out above.
    const rest: string[] = (Array.isArray(m.fields) ? m.fields.map(String) : [])
      .filter((k: string) => !(k === "role" && m.role) && !(k === "status" && m.status) && !(k === "permissions" && switches.length));
    const restNames = Array.from(new Set(rest.map((k) => crmFieldLabel(k, CRM_MEMBER_FIELD_LABELS))));
    if (restNames.length) parts.push(restNames.join(", "));
    return `updated ${who} account${parts.length ? ` (${parts.join("; ")})` : ""}`;
  };
  const doc = (kind: string) => `${kind} ${m.number ?? ""}`.trim();
  const sentTo = () => {
    const how = [m.emailed ? "email" : null, m.texted ? "text" : null].filter(Boolean).join(" and ");
    return `${m.to ? ` to ${m.to}` : ""}${how ? ` by ${how}` : ""}${m.resend ? " (resent)" : ""}`;
  };
  const media = () => (m.kind === "video" ? "a video" : "a photo");
  const verb = (() => {
    switch (row.action) {
      case "login": return "signed in";
      case "logout": return "signed out";
      case "estimate.created": return `created estimate ${m.number ?? ""}`.trim();
      case "estimate.updated": return `updated estimate ${m.number ?? ""}`.trim();
      case "estimate.deleted": return `deleted estimate ${m.number ?? ""}`.trim();
      case "estimate.sent": return `sent ${doc("estimate")}${sentTo()}`;
      case "estimate.reminded": return `sent a reminder about ${doc("estimate")}${m.to ? ` to ${m.to}` : ""}`;
      case "estimate.extended": return `extended ${doc("estimate")}${m.days ? ` by ${m.days} day${m.days === 1 ? "" : "s"}` : ""}`;
      case "invoice.sent": return `sent ${doc("invoice")}${sentTo()}`;
      case "receipt.sent": return `sent a payment receipt for ${doc("invoice")}${m.to ? ` to ${m.to}` : ""}`;
      case "changeorder.created": return `created change order ${m.number ?? ""}${m.title ? ` (${m.title})` : ""}`.replace(/\s+/g, " ").trim();
      case "changeorder.sent": return `sent change order ${m.number ?? ""} to the client`.replace(/\s+/g, " ").trim();
      case "invoice.created": return `created invoice ${m.number ?? ""}`.trim();
      case "invoice.updated": return `updated invoice ${m.number ?? ""}${m.change ? ` (${m.change})` : ""}`.trim();
      case "invoice.deleted": return `deleted invoice ${m.number ?? ""}`.trim();
      case "customer.created": return "created this client";
      case "customer.updated": return `updated client details${labelled(CRM_CUSTOMER_FIELD_LABELS)}`;
      case "customer.deleted": return "deleted this client";
      case "member.updated": return memberChange();
      case "member.removed": return `removed ${m.name ?? "a member"} from the team`;
      case "settings.updated": return `updated company settings${labelled(m.labels && typeof m.labels === "object" ? m.labels : {})}`;
      case "invitation.sent": return `invited ${m.email ?? "a new member"}`;
      case "invitation.resent": return `resent the invitation to ${m.email ?? ""}`.trim();
      case "invitation.revoked": return `revoked the invitation to ${m.email ?? ""}`.trim();
      case "invitation.accepted": return "accepted the invitation and joined the team";
      case "pricebook.updated": return `${m.change ?? "updated"} price book ${m.what ?? "item"} ${m.name ?? ""}`.trim();
      case "pricebook.adjusted": return `adjusted price book ${m.field === "cost" ? "costs" : "prices"} on ${m.count ?? "several"} material${m.count === 1 ? "" : "s"}${m.percent != null ? ` by ${m.percent > 0 ? "+" : ""}${m.percent}%` : ""}`;
      case "pricebook.floor_lock": return `turned the price-floor lock ${m.enabled ? "on" : "off"}`;
      case "discount.updated": return `updated discount offers on estimate ${m.number ?? ""}`.trim();
      case "payment.recorded":
        return `recorded payment ${money(m.amountCents)}${m.method ? ` via ${m.method}` : ""}${m.number ? ` on invoice ${m.number}` : ""}`;
      case "payment.reversed":
        return `reversed a ${money(m.amountCents)} payment${m.number ? ` on invoice ${m.number}` : ""}${m.reason ? ` — ${String(m.reason).slice(0, 140)}` : ""}`;
      case "payment.link.created":
        return `created a ${money(m.amountCents)} payment link for ${m.number ? `${m.kind === "estimate" ? "estimate" : "invoice"} ${m.number}` : "a client"}`;
      case "jobcam.media.added": return `added ${media()} to JobCam`;
      case "jobcam.media.deleted": return `deleted ${media()} from JobCam`;
      case "jobcam.media.shown_to_client": return `showed ${media()} to the client`;
      case "jobcam.media.hidden_from_client": return `hid ${media()} from the client`;
      case "jobcam.share.created": return `created a JobCam ${m.kind === "timeline" ? "live timeline" : "gallery"} share link`;
      case "jobcam.share.revoked": return "switched off a JobCam share link";
      case "jobcam.share.sent": return `sent a JobCam share link${m.to ? ` to ${m.to}` : ""}${m.channel ? ` by ${m.channel}` : ""}`;
      case "jobcam.storage.requested": return "asked ConstructHUB for more JobCam storage";
      case "data.exported": return `exported the client list${m.rows != null ? ` (${m.rows} rows)` : ""}`;
      // ── lane: calls+crm — Call Assistant rows (docs/call-assistant/LANES.md) ──
      case "call.answered": return `answered a call${m.outcome ? ` (${String(m.outcome).replace(/_/g, " ")})` : ""}${m.summary ? `: ${String(m.summary).slice(0, 140)}` : ""}`;
      case "call.lead": return `took a phone lead${m.need ? ` — ${String(m.need).slice(0, 100)}` : ""}${m.created ? " and created this client" : ""}`;
      case "call.alert": return `paged ${m.recipient ? String(m.recipient) : "the office"}: ${m.label ?? m.kind ?? "escalation"}${m.summary ? ` — ${String(m.summary).slice(0, 120)}` : ""}`;
      case "call.spam": return `screened a spam call${m.reason ? ` (${String(m.reason).slice(0, 100)})` : ""}${m.blocked ? " — number blocked" : ""}`;
      case "call.blocked": return `blocked ${m.phone ?? "a number"} from the Call Assistant`;
      case "call.unblocked": return `unblocked ${m.phone ?? "a number"} on the Call Assistant`;
      case "call.escalation_closed": return `closed a ${m.kind ? String(m.kind).replace(/_/g, " ") : ""} escalation${m.recipient ? ` to ${m.recipient}` : ""}`.replace(/\s+/g, " ");
      // ── end lane: calls+crm ──
      // An action without its own sentence still reads as words, never as a key.
      default: return row.action.replace(/[._]+/g, " ");
    }
  })();
  return `${row.actorLabel} ${verb}`.replace(/\s{2,}/g, " ").trim();
}

/** Meta without its amounts — what a price-blind seat's audit sentences are built from. */
function withoutMoney(meta: unknown): Record<string, unknown> {
  const m = { ...((meta ?? {}) as Record<string, unknown>) };
  for (const k of Object.keys(m)) if (/Cents$/.test(k)) delete m[k];
  // Older rows wrote the amount into a free-text change ("payment of $1,750.00 reversed").
  if (typeof m.change === "string" && m.change.includes("$")) m.change = m.change.replace(/\s*of \$[\d,.]+/g, "");
  return m;
}

/** The shape the client-360 timeline and the team-page dropdown both render. */
function present(row: CrmActivityLogRow, hideMoney = false) {
  return {
    id: `act-${row.id}`,
    kind: "audit" as const,
    action: row.action,
    actor: row.actorLabel,
    text: activityText(hideMoney ? { ...row, meta: withoutMoney(row.meta) } : row),
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

    // "Dave recorded payment $2,000.00" reads without the amount for a price-blind seat.
    const hideMoney = !ctx.permissions.seePrices;
    const rows = await db.select().from(crmActivityLog)
      .where(and(eq(crmActivityLog.orgId, ctx.org.id), eq(crmActivityLog.customerId, cust.id)))
      .orderBy(desc(crmActivityLog.createdAt)).limit(100);
    if (divisionScopeOf(ctx.member) || !ctx.permissions.viewAllJobs) {
      const access = objectPolicy(ctx);
      const types: Record<string, ObjectKind> = { customer: "customers", project: "projects", estimate: "estimates", invoice: "invoices", payment: "payments" };
      const visible = [];
      for (const r of rows) if (r.entityId && types[r.entityType ?? ""] && await access.visible(types[r.entityType!], r.entityId)) visible.push(r);
      return res.json(visible.map((r) => present(r, hideMoney)));
    }
    res.json(rows.map((r) => present(r, hideMoney)));
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
    res.json(rows.map((r) => present(r)));
  });
}
