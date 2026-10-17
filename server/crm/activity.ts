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
 *
 * On read every row is named through the actor directory (actors.ts): the
 * member's CURRENT name with the owner labelled "Name (Owner)", the client's
 * name for "client" rows, the source for automatic rows — never an id.
 */
import type { Express } from "express";
import { db } from "../db";
import { crmActivityLog, crmAttachments, crmCustomers, crmMembers, type CrmActivityLogRow } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { loadActorDirectory, type ActorDirectory } from "./actors";
import { actorLabel, type CrmActor } from "@shared/crm-actor";
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

/** A photo's stage as words: "a project photo (in progress)". */
function photoNoun(m: Record<string, any>): string {
  if (m.stage === "progress") return "a project photo (in progress)";
  if (m.stage === "finished") return "a project photo (finished)";
  return "a photo";
}

/** The file an attachment row is about, as words (file names only). */
function attachmentAdded(m: Record<string, any>): string {
  const name = m.fileName ? ` — ${m.fileName}` : "";
  switch (m.kind) {
    case "photo": return m.byClient ? `shared a photo${name}` : `added ${photoNoun(m)}${name}`;
    case "estimate": return `attached ${m.fileName ?? "a file"} to estimate ${m.number ?? ""}`.trim();
    case "pamphlet": return `added ${m.fileName ?? "a file"} to the company files`;
    case "estimate_default": return `added ${m.fileName ?? "a file"} to the files for all future estimates`;
    default: return `added a file${name}`;
  }
}

function attachmentDeleted(m: Record<string, any>): string {
  const name = m.fileName ? ` — ${m.fileName}` : "";
  switch (m.kind) {
    case "photo": return `deleted ${photoNoun(m)}${name}`;
    case "estimate": return `removed ${m.fileName ?? "a file"} from estimate ${m.number ?? ""}`.trim();
    case "pamphlet": return `deleted the company file ${m.fileName ?? ""}`.trim();
    case "estimate_default": return `removed ${m.fileName ?? "a file"} from the files for all future estimates`;
    default: return `deleted a file${name}`;
  }
}

/** "Dave updated estimate E-1847" — the sentence the two audit UIs render.
 *  `actor` (resolved by the directory) names the row; without it the
 *  write-time snapshot label is used. */
export function activityText(row: {
  actorLabel: string;
  action: string;
  meta?: unknown;
}, actor?: CrmActor | null): string {
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
      case "review_pipeline.dismissed": return "set this client aside in the review pipeline (Not now)";
      case "review_pipeline.restored": return "put this client back in the review pipeline";
      case "review_pipeline.hidden": return "hid this client from review requests";
      case "review_pipeline.unhidden": return "allowed review requests to this client again";
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
      case "self_estimate.requested":
        return `asked for a price online${Array.isArray(m.trades) && m.trades.length ? ` (${m.trades.join(" + ")})` : ""}${m.lowCents != null && m.highCents != null ? ` — ballpark ${money(m.lowCents)}–${money(m.highCents)}` : ""}${m.number ? ` — draft estimate ${m.number} created` : ""}`;
      case "self_estimate.settings_updated": return `updated the client self-estimate prices${m.division ? ` (${m.division === "org" ? "no division" : "a division"})` : ""}`;
      case "task.done": return `marked a task done${m.title ? `: ${String(m.title).slice(0, 120)}` : ""}`;
      case "task.reopened": return `reopened a task${m.title ? `: ${String(m.title).slice(0, 120)}` : ""}`;
      case "payment.recorded":
        return `recorded payment ${money(m.amountCents)}${m.method ? ` via ${m.method}` : ""}${m.number ? ` on invoice ${m.number}` : ""}`;
      case "payment.reversed":
        return `reversed a ${money(m.amountCents)} payment${m.number ? ` on invoice ${m.number}` : ""}${m.reason ? ` — ${String(m.reason).slice(0, 140)}` : ""}`;
      case "payment.link.created":
        return `created a ${money(m.amountCents)} payment link for ${m.number ? `${m.kind === "estimate" ? "estimate" : "invoice"} ${m.number}` : "a client"}`;
      case "attachment.added": return attachmentAdded(m);
      case "attachment.deleted": return attachmentDeleted(m);
      case "attachment.attached": return `attached ${m.fileName ?? "a file"} to estimate ${m.number ?? ""} from the library`;
      case "attachment.auto_attached": return `added ${m.fileName ?? "a file"} to estimate ${m.number ?? ""} (set to attach to every new estimate)`;
      case "attachment.default_on": return `set ${m.fileName ?? "a file"} to attach to all future estimates`;
      case "attachment.default_off": return `stopped attaching ${m.fileName ?? "a file"} to future estimates`;
      case "followup.updated": {
        const parts: string[] = [];
        if (m.done) parts.push("marked a follow-up done");
        if ("cadenceDays" in m) parts.push(m.cadenceDays === 7 ? "set follow-ups to weekly" : m.cadenceDays === 14 ? "set follow-ups to every two weeks" : "turned follow-up reminders off");
        return parts.join(" and ") || "updated follow-ups";
      }
      case "jobcam.media.added": return `added ${media()} to JobCam`;
      case "jobcam.media.deleted": return `deleted ${media()} from JobCam`;
      case "jobcam.media.shown_to_client": return `showed ${media()} to the client`;
      case "jobcam.media.hidden_from_client": return `hid ${media()} from the client`;
      case "jobcam.share.created": return `created a JobCam ${m.kind === "timeline" ? "live timeline" : "gallery"} share link`;
      case "jobcam.share.revoked": return "switched off a JobCam share link";
      case "jobcam.share.sent": return `sent a JobCam share link${m.to ? ` to ${m.to}` : ""}${m.channel ? ` by ${m.channel}` : ""}`;
      case "jobcam.storage.requested": return "asked ConstructHUB for more JobCam storage";
      case "data.exported": return `exported the client list${m.rows != null ? ` (${m.rows} rows)` : ""}`;
      case "divisions.unassigned_sorted": {
        const n = (Number(m.customers) || 0) + (Number(m.projects) || 0) + (Number(m.estimates) || 0);
        const per = m.byDivision && typeof m.byDivision === "object"
          ? Object.entries(m.byDivision as Record<string, number>).map(([k, v]) => `${v} to ${k}`).join(", ") : "";
        return `sorted ${n} unassigned record${n === 1 ? "" : "s"} into divisions${per ? ` (${per})` : ""}`;
      }
      case "division.assigned": return `moved ${m.kind ?? "a record"}${m.label ? ` ${m.label}` : ""} to ${m.to ?? "no division"}`;
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
  const who = actor ? actorLabel(actor) : row.actorLabel;
  return `${who} ${verb}`.replace(/\s{2,}/g, " ").trim();
}

/** Meta without its amounts — what a price-blind seat's audit sentences are built from. */
function withoutMoney(meta: unknown): Record<string, unknown> {
  const m = { ...((meta ?? {}) as Record<string, unknown>) };
  for (const k of Object.keys(m)) if (/Cents$/.test(k)) delete m[k];
  // Older rows wrote the amount into a free-text change ("payment of $1,750.00 reversed").
  if (typeof m.change === "string" && m.change.includes("$")) m.change = m.change.replace(/\s*of \$[\d,.]+/g, "");
  return m;
}

/** The shape the client-360 timeline and the team-page dropdown both render.
 *  `actor` is the named actor ({ kind, name, isOwner }); `text` the full
 *  sentence; `action_text` the sentence without the actor (for a bold name). */
export function presentActivity(row: CrmActivityLogRow, dir: ActorDirectory, hideMoney = false, clientName?: string | null) {
  const actor = dir.logActor(row, clientName);
  const base = hideMoney ? { ...row, meta: withoutMoney(row.meta) } : row;
  const text = activityText(base, actor);
  const lead = actorLabel(actor);
  return {
    id: `act-${row.id}`,
    kind: "audit" as const,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor,
    text,
    actionText: text.startsWith(lead) ? text.slice(lead.length).trim() : text,
    at: (row.createdAt ?? new Date()).toISOString(),
  };
}


/**
 * Restricted-seat visibility of an attachment log row whose attachment no
 * longer exists (deleted): the parent recorded in meta.refId / customerId,
 * mirroring object-access's attachment rule (estimate files and contracts
 * need seePrices + the estimate; photos/measurements the customer; org
 * collateral is visible to every seat).
 */
export async function deletedAttachmentVisible(
  ctx: OrgContext,
  access: { visible: (kind: ObjectKind, id: string) => Promise<boolean> },
  r: { entityId: string | null; customerId: string | null; meta: unknown },
): Promise<boolean> {
  const m = (r.meta ?? {}) as Record<string, any>;
  // The attachment still exists → its own check (already failed) is final.
  if (r.entityId && await attachmentExists(ctx.org.id, r.entityId)) return false;
  if (m.kind === "pamphlet" || m.kind === "estimate_default") return true;
  if (m.kind === "estimate" || m.kind === "contract") {
    return !!ctx.permissions.seePrices && typeof m.refId === "string" && access.visible("estimates", m.refId);
  }
  const customerId = (typeof m.refId === "string" && m.refId) || r.customerId;
  return !!customerId && access.visible("customers", customerId);
}

async function attachmentExists(orgId: string, id: string): Promise<boolean> {
  const [row] = await db.select({ id: crmAttachments.id }).from(crmAttachments)
    .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.id, id))).limit(1);
  return !!row;
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

    const [cust] = await db.select({ id: crmCustomers.id, displayName: crmCustomers.displayName }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!cust) return res.status(404).json({ message: "Customer not found" });

    // "Dave recorded payment $2,000.00" reads without the amount for a price-blind seat.
    const hideMoney = !ctx.permissions.seePrices;
    const rows = await db.select().from(crmActivityLog)
      // Every row, attachment adds included: the durable "who uploaded" record
      // must survive the file's deletion. The client page drops an add only
      // when its attachment line is actually in the timeline
      // (dedupeCarriedAudit, shared/crm-actor.ts).
      .where(and(eq(crmActivityLog.orgId, ctx.org.id), eq(crmActivityLog.customerId, cust.id)))
      .orderBy(desc(crmActivityLog.createdAt)).limit(100);
    const dir = await loadActorDirectory(ctx.org.id);
    const show = (r: CrmActivityLogRow) => presentActivity(r, dir, hideMoney, cust.displayName);
    if (divisionScopeOf(ctx) || !ctx.permissions.viewAllJobs) {
      const access = objectPolicy(ctx);
      const types: Record<string, ObjectKind> = { customer: "customers", project: "projects", estimate: "estimates", invoice: "invoices", payment: "payments", attachment: "attachments" };
      const visible = [];
      for (const r of rows) {
        if (!r.entityId || !types[r.entityType ?? ""]) continue;
        if (await access.visible(types[r.entityType!], r.entityId)) { visible.push(r); continue; }
        // A deleted attachment has no row left to check: gate by the parent
        // the log row recorded, with the same rules attachments use.
        if (r.entityType === "attachment" && await deletedAttachmentVisible(ctx, access, r)) visible.push(r);
      }
      return res.json(visible.map(show));
    }
    res.json(rows.map(show));
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
    const dir = await loadActorDirectory(ctx.org.id);
    res.json(rows.map((r) => presentActivity(r, dir)));
  });
}
