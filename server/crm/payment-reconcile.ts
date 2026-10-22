/**
 * Payment reconciliation — money taken OFF the platform still lands in the ledger.
 *
 * Two moments produce a prompt series (shared/payment-settings.ts decides the
 * days, default 1, 3 and 5):
 *   - the job is **approved** → "how was the deposit received?"
 *   - the job is **closed out** → "how was the final payment received?"
 *
 * Each series is one open crm_tasks row (source "payment_reconcile", one per
 * project and kind). The in-app pop-up (client/src/components/reconcile-prompt.tsx)
 * shows it to the PM / sales / owners from the first scheduled day until it is
 * answered; the worker below also emails / texts on each scheduled day. The
 * task closes itself the moment the money it asks about lands — a deposit on
 * that estimate, or the project's invoices reaching a zero balance — online or
 * recorded by hand — or when staff answer "no payment was due" (with a note,
 * on the record).
 *
 * The off-platform deposit itself is recorded here too (POST
 * /api/crm/estimates/:id/payments): a required payment type, an optional photo
 * or copy of the check (an attachment of kind "payment_proof"), the same
 * ledger row an online deposit would make — under the estimate's row lock,
 * never while a Checkout session is open for it, and never once the estimate
 * has been invoiced (the money then belongs on the invoice).
 *
 * Amounts never live in stored or sent text: a seat without See prices gets
 * the question, not the number (the feed gates expectedCents per seat).
 */
import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  crmCustomers, crmEstimates, crmInvoices, crmMembers, crmOrgs, crmPayments, crmProjects, crmTasks, crmAttachments,
} from "@shared/schema";
import { amountDueCents } from "@shared/estimate-totals";
import {
  reconcileSettingsOf, MANUAL_PAYMENT_METHOD_VALUES, type ReconcileSettings,
} from "@shared/payment-settings";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { objectPolicy } from "./object-access";
import { notifyMembers } from "./notify";
import { sendWithFallback } from "../email";
import { sendSms, normalizePhone, resolveSmsSender } from "./sms";
import { logActivity } from "./activity";
import { workerInterval } from "../workers";
import { emitCrmEvent } from "./integrations";
import { autoSendDepositReceipt } from "./receipts";
import { paymentWriteLimit, claimIdempotent, answerIdempotent, rememberIdempotent, releaseIdempotent } from "./payment-guard";

type GetUser = (req: any, res: any) => any;
type Project = typeof crmProjects.$inferSelect;
type Task = typeof crmTasks.$inferSelect;

export const RECONCILE_SOURCE = "payment_reconcile";
export type ReconcileKind = "deposit" | "final";

/** What the task row remembers (crm_tasks.meta). */
export type ReconcileMeta = {
  kind: ReconcileKind;
  projectId: string;
  projectName: string | null;
  estimateId: string | null;
  invoiceIds: string[];
  /** What we expect was collected — shown only to seats with See prices. */
  expectedCents: number;
  /** ISO: approval / close-out time — the schedule counts from here. */
  anchorAt: string;
  /** The day offsets this series uses (a snapshot of Settings at creation). */
  days: number[];
  /** Offsets whose reminder went out. */
  sentDays: number[];
  /** ISO: the pop-up shows from here (first scheduled day; "not yet" pushes it to the next). */
  promptFrom: string;
  /** Who is asked besides the assignee (PM / sales / owners per Settings). */
  memberIds: string[];
  answers: { action: string; at: string; memberId: string | null; note?: string | null }[];
};

const DAY_MS = 24 * 3600_000;
const OPEN_SESSION_WINDOW_MIN = 30;
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const whatOf = (kind: ReconcileKind) => (kind === "deposit" ? "deposit" : "final payment");

function metaOf(t: Task): ReconcileMeta | null {
  const m = t.meta as Partial<ReconcileMeta> | null;
  if (!m || (m.kind !== "deposit" && m.kind !== "final") || !m.projectId) return null;
  return {
    kind: m.kind, projectId: m.projectId, projectName: m.projectName ?? null,
    estimateId: m.estimateId ?? null, invoiceIds: Array.isArray(m.invoiceIds) ? m.invoiceIds : [],
    expectedCents: Number(m.expectedCents) || 0,
    anchorAt: m.anchorAt ?? (t.createdAt?.toISOString() ?? new Date().toISOString()),
    days: Array.isArray(m.days) && m.days.length ? m.days : [1, 3, 5],
    sentDays: Array.isArray(m.sentDays) ? m.sentDays : [],
    promptFrom: m.promptFrom ?? (t.dueAt?.toISOString() ?? new Date().toISOString()),
    memberIds: Array.isArray(m.memberIds) ? m.memberIds : [],
    answers: Array.isArray(m.answers) ? m.answers : [],
  };
}

/** Owners, PM, sales — whoever Settings says should be asked. */
async function recipientsFor(orgId: string, project: Project, settings: ReconcileSettings) {
  const members = await db.select().from(crmMembers).where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  const byId = (id: string | null | undefined) => (id ? members.find((m) => m.id === id) ?? null : null);
  const owners = members.filter((m) => m.role === "owner");
  const pm = byId(project.projectManagerMemberId);
  const sales = byId(project.salesMemberId);
  const assignee = pm ?? sales ?? owners[0] ?? null;
  const set = new Map<string, typeof members[number]>();
  if (assignee) set.set(assignee.id, assignee);
  if (settings.notify === "pm_sales" && sales) set.set(sales.id, sales);
  if (settings.notify === "owners") for (const o of owners) set.set(o.id, o);
  return { assignee, recipients: [...set.values()] };
}

/** Net money that settled (succeeded, less any refund) on an estimate / these invoices / a project. */
export async function collectedCents(orgId: string, where: { estimateId?: string | null; invoiceIds?: string[]; projectId?: string | null }, tx: any = db): Promise<number> {
  const ors: any[] = [];
  if (where.estimateId) ors.push(eq(crmPayments.estimateId, where.estimateId));
  if (where.invoiceIds?.length) ors.push(inArray(crmPayments.invoiceId, where.invoiceIds));
  if (where.projectId) ors.push(eq(crmPayments.projectId, where.projectId));
  if (!ors.length) return 0;
  const rows: { net: number }[] = await tx.select({
    net: sql<number>`coalesce(sum(greatest(0, ${crmPayments.amountCents} - coalesce(refunded_cents, 0))), 0)::int`,
  }).from(crmPayments).where(and(
    eq(crmPayments.orgId, orgId), inArray(crmPayments.status, ["succeeded", "partially_refunded"]),
    sql`(${sql.join(ors, sql` or `)})`,
  ));
  return rows[0]?.net ?? 0;
}

/** A Checkout session the client may still finish (the same window payments.ts uses). */
async function openSessionOnEstimate(orgId: string, estimateId: string, tx: any = db): Promise<boolean> {
  const rows = await tx.select({ id: crmPayments.id }).from(crmPayments).where(and(
    eq(crmPayments.orgId, orgId), eq(crmPayments.estimateId, estimateId), eq(crmPayments.status, "pending"),
    sql`${crmPayments.createdAt} >= now() - make_interval(mins => ${OPEN_SESSION_WINDOW_MIN})`,
  )).limit(1);
  return rows.length > 0;
}

/** What the project's live invoices still owe (retainage withheld). */
async function invoicesOutstanding(orgId: string, projectId: string) {
  const invoices = await db.select().from(crmInvoices)
    .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.projectId, projectId), isNull(crmInvoices.voidedAt)))
    .orderBy(asc(crmInvoices.createdAt));
  const due = (i: typeof invoices[number]) => Math.max(0, i.totalCents - (i.retainageCents ?? 0) - (i.paidCents ?? 0));
  return { invoices, outstanding: invoices.reduce((s, i) => s + due(i), 0), payable: invoices.find((i) => due(i) > 0) ?? null };
}

/**
 * Open (or start) the prompt series for a project. Nothing happens when the
 * org turned the prompts off, when money already landed, when nothing was
 * expected, when the job reached this stage long before the prompts existed
 * (no day-1 nag about a job approved months ago), or when this series already
 * exists (open or answered). Check-and-insert runs under an advisory lock so
 * two triggers at once never open two series.
 */
export async function ensureReconcileTask(orgId: string, kind: ReconcileKind, project: Project): Promise<Task | null> {
  try {
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
    if (!org) return null;
    const settings = reconcileSettingsOf(org.customFields);
    if (!settings.enabled) return null;
    const days = kind === "deposit" ? settings.approvalDays : settings.closeoutDays;
    // The schedule counts from the stage change itself, not from when this code ran.
    const anchor = project.stageChangedAt ? new Date(project.stageChangedAt) : new Date();
    if (Date.now() - anchor.getTime() > (days[days.length - 1] + 7) * DAY_MS) return null;
    const key = `${RECONCILE_SOURCE}:${kind}:${project.id}`;

    let estimateId: string | null = null;
    let invoiceIds: string[] = [];
    let expected = 0;
    if (kind === "deposit") {
      const [est] = await db.select().from(crmEstimates).where(and(
        eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, project.customerId),
        sql`${crmEstimates.approvedAt} is not null`,
        sql`(${crmEstimates.projectId} = ${project.id} or ${crmEstimates.projectId} is null)`,
      )).orderBy(desc(crmEstimates.approvedAt)).limit(1);
      if (!est) return null;
      estimateId = est.id;
      expected = amountDueCents(est) ?? 0; // the deposit, or the whole job when they signed for pay-in-full
      if (expected <= 0) return null;
      if ((await collectedCents(orgId, { estimateId: est.id })) > 0) return null;
    } else {
      const { invoices, outstanding } = await invoicesOutstanding(orgId, project.id);
      invoiceIds = invoices.map((i) => i.id);
      expected = invoices.length ? outstanding : Math.max(0, (project.contractValueCents ?? 0) - (await collectedCents(orgId, { projectId: project.id })));
      if (expected <= 0) return null;
    }

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, project.customerId))).limit(1);
    if (!cust) return null;
    const { assignee, recipients } = await recipientsFor(orgId, project, settings);
    const promptFrom = new Date(anchor.getTime() + days[0] * DAY_MS);
    const meta: ReconcileMeta = {
      kind, projectId: project.id, projectName: project.name ?? null, estimateId, invoiceIds,
      expectedCents: expected, anchorAt: anchor.toISOString(), days, sentDays: [],
      promptFrom: promptFrom.toISOString(), memberIds: recipients.map((m) => m.id), answers: [],
    };
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      const [existing] = await tx.select({ id: crmTasks.id }).from(crmTasks)
        .where(and(eq(crmTasks.orgId, orgId), eq(crmTasks.idempotencyKey, key))).limit(1);
      if (existing) return null;
      const [task] = await tx.insert(crmTasks).values({
        orgId, customerId: cust.id, estimateId, divisionId: project.divisionId ?? null,
        assignedMemberId: assignee?.id ?? null, source: RECONCILE_SOURCE, idempotencyKey: key,
        // No amount in stored text: the feed adds it for seats with See prices.
        title: `How was ${cust.displayName}'s ${whatOf(kind)} received?`.slice(0, 300),
        body: `Record the ${whatOf(kind)} for ${project.name ?? "the job"} — online payments land on their own; a check, cash or wire needs the payment type entered so the books stay right.`.slice(0, 2000),
        dueAt: promptFrom,
        meta,
      } as any).returning();
      return task;
    });
  } catch (e: any) {
    console.error(`[crm] reconcile task (${kind}) failed:`, e?.message || e);
    return null;
  }
}

/** Append an answer and (optionally) close, touching only the JSON fields involved — never a whole-meta overwrite. */
async function closeTask(taskId: string, answer: ReconcileMeta["answers"][number], doneBy: string | null): Promise<boolean> {
  const rows = await db.update(crmTasks).set({
    doneAt: new Date(), doneByMemberId: doneBy,
    meta: sql`jsonb_set(coalesce(${crmTasks.meta}, '{}'::jsonb), '{answers}', coalesce(${crmTasks.meta}->'answers', '[]'::jsonb) || ${JSON.stringify([answer])}::jsonb)`,
  }).where(and(eq(crmTasks.id, taskId), isNull(crmTasks.doneAt))).returning({ id: crmTasks.id });
  return rows.length > 0;
}

/**
 * A payment landed: close the series it answers. A deposit series closes when
 * money settles on ITS estimate; a final series when the project's invoices
 * reach a zero balance (or, with no invoices, when money lands on the
 * project). A $1 progress payment never silences a deposit question.
 */
export async function completeReconcileTasks(orgId: string, m: {
  estimateId?: string | null; invoiceId?: string | null; projectId?: string | null; customerId?: string | null;
}): Promise<number> {
  try {
    const open = await db.select().from(crmTasks)
      .where(and(eq(crmTasks.orgId, orgId), eq(crmTasks.source, RECONCILE_SOURCE), isNull(crmTasks.doneAt)));
    let n = 0;
    for (const t of open) {
      const meta = metaOf(t);
      if (!meta) continue;
      let answered = false;
      if (meta.kind === "deposit") {
        answered = Boolean(m.estimateId && meta.estimateId === m.estimateId)
          && (await collectedCents(orgId, { estimateId: meta.estimateId })) > 0;
      } else if (m.projectId === meta.projectId || (m.invoiceId && meta.invoiceIds.includes(m.invoiceId))) {
        const { invoices, outstanding } = await invoicesOutstanding(orgId, meta.projectId);
        answered = invoices.length ? outstanding <= 0 : (await collectedCents(orgId, { projectId: meta.projectId })) > 0;
      }
      if (!answered) continue;
      if (await closeTask(t.id, { action: "payment_recorded", at: new Date().toISOString(), memberId: null }, null)) n++;
    }
    return n;
  } catch (e: any) {
    console.error("[crm] reconcile complete failed:", e?.message || e);
    return 0;
  }
}

// ── The reminder worker ─────────────────────────────────────────────────────

function crmOrigin(): string {
  const env = (process.env.PORTAL_URL || "").replace(/\/+$/, "");
  return env || "https://portal.constructhub.us";
}

/** One reminder for one series, on every channel Settings turned on. No amounts: the pop-up shows those, per seat. */
async function sendReminder(org: typeof crmOrgs.$inferSelect, t: Task, meta: ReconcileMeta, day: number, settings: ReconcileSettings) {
  const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, t.customerId ?? "")).limit(1);
  const who = cust?.displayName ?? "the client";
  const title = `Day ${day}: how was ${who}'s ${whatOf(meta.kind)} received?`;
  const body = `${meta.projectName ?? "The job"} was ${meta.kind === "deposit" ? "approved" : "closed out"} ${day} day${day === 1 ? "" : "s"} ago and no payment is on file. Open the CRM and enter the payment type (check, cash, wire, card) — or mark that nothing was due.`;
  const link = `/crm/clients/${t.customerId}?reconcile=${t.id}`;
  await notifyMembers({
    org, pref: "paymentReceived", type: "paymentReconcile", title, body, link,
    extraMemberIds: meta.memberIds, smsHandled: true,
  });
  const ids = new Set([...(meta.memberIds ?? []), ...(t.assignedMemberId ? [t.assignedMemberId] : [])]);
  if (!ids.size) return;
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), inArray(crmMembers.id, [...ids]), eq(crmMembers.status, "active")));
  const url = `${crmOrigin()}${link}`;
  if (settings.channels.email) {
    for (const m of members) {
      if (!m.email) continue;
      await sendWithFallback({
        to: m.email,
        subject: `${org.name}: ${title}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
          <p style="font-size:16px">${body}</p>
          <p style="margin:24px 0"><a href="${url}" style="background:#ea580c;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Record the payment</a></p>
          <p style="font-size:13px;color:#666">You get this on the days set under Settings → Payments → Reconciliation prompts. It stops the moment a payment is recorded.</p>
        </div>`,
      } as any).catch((e: any) => console.error("[crm] reconcile email failed:", e?.message || e));
    }
  }
  if (settings.channels.sms && resolveSmsSender(org.customFields)) {
    for (const m of members) {
      const p = normalizePhone(m.phone);
      if (!p) continue;
      await sendSms(p, `${org.name}: ${title} Record it: ${url}`.slice(0, 320), org.customFields, org.id)
        .catch((e: any) => console.error("[crm] reconcile sms failed:", e?.message || e));
    }
  }
}

/** Every 10 minutes: open series with a scheduled day that has arrived and not been sent, oldest due first. */
export async function runReconcileReminders(now = new Date()): Promise<number> {
  // Only rows with days left to send are candidates, so a backlog of finished series never starves new ones.
  const open = await db.select().from(crmTasks).where(and(
    eq(crmTasks.source, RECONCILE_SOURCE), isNull(crmTasks.doneAt),
    sql`jsonb_array_length(coalesce(${crmTasks.meta}->'sentDays', '[]'::jsonb)) < jsonb_array_length(coalesce(${crmTasks.meta}->'days', '[1,3,5]'::jsonb))`,
  )).orderBy(asc(crmTasks.dueAt)).limit(2000);
  let sent = 0;
  const orgs = new Map<string, typeof crmOrgs.$inferSelect>();
  for (const t of open) {
    const meta = metaOf(t);
    if (!meta) continue;
    const anchor = new Date(meta.anchorAt).getTime();
    const due = meta.days.filter((d) => !meta.sentDays.includes(d) && anchor + d * DAY_MS <= now.getTime());
    if (!due.length) continue;
    let org = orgs.get(t.orgId);
    if (!org) {
      [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, t.orgId)).limit(1);
      if (!org) continue;
      orgs.set(t.orgId, org);
    }
    const settings = reconcileSettingsOf(org.customFields);
    if (!settings.enabled) continue;
    const day = due[due.length - 1];
    const sentDays = [...meta.sentDays, ...due];
    // Claim only the sentDays field, conditional on what we read — a snooze racing this tick keeps its promptFrom.
    const [claimed] = await db.update(crmTasks).set({
      meta: sql`jsonb_set(coalesce(${crmTasks.meta}, '{}'::jsonb), '{sentDays}', ${JSON.stringify(sentDays)}::jsonb)`,
    }).where(and(eq(crmTasks.id, t.id), isNull(crmTasks.doneAt),
      sql`coalesce(${crmTasks.meta}->'sentDays', '[]'::jsonb) = ${JSON.stringify(meta.sentDays)}::jsonb`))
      .returning({ id: crmTasks.id });
    if (!claimed) continue;
    await sendReminder(org, t, { ...meta, sentDays }, day, settings).catch((e: any) => console.error("[crm] reconcile reminder failed:", e?.message || e));
    sent++;
  }
  return sent;
}

export function startReconcileWorker(): void {
  workerInterval("Payment reconciliation prompts", () => runReconcileReminders(), 10 * 60 * 1000, { firstAfterMs: 90 * 1000 });
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function presentReconcile(ctx: OrgContext, rows: Task[]) {
  const custIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
  const custs = custIds.length ? await db.select({ id: crmCustomers.id, name: crmCustomers.displayName }).from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, ctx.org.id), inArray(crmCustomers.id, custIds))) : [];
  const cName = new Map(custs.map((c) => [c.id, c.name]));
  const settings = reconcileSettingsOf(ctx.org.customFields);
  const out = [];
  for (const t of rows) {
    const meta = metaOf(t)!;
    const anchor = new Date(meta.anchorAt).getTime();
    const name = cName.get(t.customerId ?? "") ?? "Client";
    // The final payment is recorded on the FIRST invoice that still owes something, decided now, not at creation.
    const payable = meta.kind === "final" ? (await invoicesOutstanding(ctx.org.id, meta.projectId)).payable : null;
    out.push({
      id: t.id, kind: meta.kind,
      title: ctx.permissions.seePrices
        ? `How was ${name}'s ${whatOf(meta.kind)} of ${money(meta.expectedCents)} received?`
        : `How was ${name}'s ${whatOf(meta.kind)} received?`,
      body: t.body,
      customerId: t.customerId, customerName: name,
      projectId: meta.projectId, projectName: meta.projectName, estimateId: meta.estimateId, invoiceIds: meta.invoiceIds,
      payableInvoiceId: payable?.id ?? null, payableInvoiceNumber: payable?.number ?? null,
      expectedCents: ctx.permissions.seePrices ? meta.expectedCents : null,
      anchorAt: meta.anchorAt, daysSince: Math.max(0, Math.floor((Date.now() - anchor) / DAY_MS)),
      days: meta.days, sentDays: meta.sentDays, promptFrom: meta.promptFrom,
      photo: settings.photo, answers: meta.answers,
      assignedToMe: t.assignedMemberId === ctx.member.id,
    });
  }
  return out;
}

/** Who may see / answer a series: the people it was addressed to, or a seat that takes payments or runs settings
 *  AND may see the client (division / own-jobs scoping — server/crm/object-access.ts). */
async function reconcileVisible(ctx: OrgContext, t: Task, policy = objectPolicy(ctx)): Promise<boolean> {
  const meta = metaOf(t);
  if (!meta) return false;
  if (t.assignedMemberId === ctx.member.id || meta.memberIds.includes(ctx.member.id)) return true;
  if (!ctx.permissions.takePayment && !ctx.permissions.manageSettings) return false;
  return t.customerId ? policy.visible("customers", t.customerId) : false;
}
async function visibleReconcile(ctx: OrgContext, rows: Task[]): Promise<Task[]> {
  const policy = objectPolicy(ctx);
  const out: Task[] = [];
  for (const t of rows) if (await reconcileVisible(ctx, t, policy)) out.push(t);
  return out;
}

export function registerCrmReconcileRoutes(app: Express, getDevUser: GetUser): void {
  const ctxFor = async (req: any, res: any): Promise<OrgContext | null> => {
    const user = getDevUser(req, res);
    if (!user) return null;
    return requireOrg(req, res, user.id);
  };
  const openRows = (orgId: string) => db.select().from(crmTasks)
    .where(and(eq(crmTasks.orgId, orgId), eq(crmTasks.source, RECONCILE_SOURCE), isNull(crmTasks.doneAt)))
    .orderBy(asc(crmTasks.dueAt)).limit(500);

  /** The pop-up's feed: open series this seat should answer, whose first scheduled day has arrived. */
  app.get("/api/crm/reconcile/due", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!reconcileSettingsOf(ctx.org.customFields).enabled) return res.json({ due: [], open: 0 });
    const now = Date.now();
    const mine = await visibleReconcile(ctx, await openRows(ctx.org.id));
    const due = mine.filter((t) => new Date(metaOf(t)!.promptFrom).getTime() <= now);
    res.json({ due: await presentReconcile(ctx, due), open: mine.length });
  });

  /** Everything still open (the Payments page's "needs reconciling" list), due or not. */
  app.get("/api/crm/reconcile/open", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    res.json({ open: await presentReconcile(ctx, await visibleReconcile(ctx, await openRows(ctx.org.id))) });
  });

  /** "Not received yet" pushes the pop-up to the next scheduled day; "nothing was due" closes the series with a note. */
  app.post("/api/crm/reconcile/:id/answer", paymentWriteLimit, async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const parsed = z.object({
      action: z.enum(["not_yet", "no_payment_due"]),
      note: z.string().max(600).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick an answer" });
    const [t] = await db.select().from(crmTasks)
      .where(and(eq(crmTasks.orgId, ctx.org.id), eq(crmTasks.id, String(req.params.id)), eq(crmTasks.source, RECONCILE_SOURCE))).limit(1);
    if (!t || !(await reconcileVisible(ctx, t))) return res.status(404).json({ message: "Prompt not found" });
    if (t.doneAt) return res.status(409).json({ message: "This prompt was already answered." });
    const meta = metaOf(t)!;
    const note = parsed.data.note?.trim() || null;
    const answer = { action: parsed.data.action, at: new Date().toISOString(), memberId: ctx.member.id, note };
    if (parsed.data.action === "no_payment_due") {
      if (!note) return res.status(400).json({ message: "Say why nothing was due — it goes on the client's record." });
      if (!(await closeTask(t.id, answer, ctx.member.id))) return res.status(409).json({ message: "This prompt was already answered." });
      logActivity(ctx, "payment.reconcile.none", {
        entityType: "project", entityId: meta.projectId, customerId: t.customerId,
        meta: { kind: meta.kind, expectedCents: meta.expectedCents, note },
      });
      return res.json({ ok: true, done: true });
    }
    // Next scheduled day after now; past the last one, keep the last gap (never less than a day).
    const anchor = new Date(meta.anchorAt).getTime();
    const now = Date.now();
    const upcoming = meta.days.map((d) => anchor + d * DAY_MS).find((ts) => ts > now);
    const gapDays = meta.days.length >= 2 ? Math.max(1, meta.days[meta.days.length - 1] - meta.days[meta.days.length - 2]) : 2;
    const promptFrom = new Date(upcoming ?? now + gapDays * DAY_MS);
    await db.update(crmTasks).set({
      dueAt: promptFrom,
      meta: sql`jsonb_set(jsonb_set(coalesce(${crmTasks.meta}, '{}'::jsonb), '{promptFrom}', ${JSON.stringify(promptFrom.toISOString())}::jsonb), '{answers}', coalesce(${crmTasks.meta}->'answers', '[]'::jsonb) || ${JSON.stringify([answer])}::jsonb)`,
    }).where(and(eq(crmTasks.id, t.id), isNull(crmTasks.doneAt)));
    logActivity(ctx, "payment.reconcile.not_yet", {
      entityType: "project", entityId: meta.projectId, customerId: t.customerId,
      meta: { kind: meta.kind, expectedCents: meta.expectedCents, note, nextAt: promptFrom.toISOString() },
    });
    res.json({ ok: true, done: false, promptFrom: promptFrom.toISOString() });
  });

  /**
   * Record a deposit (or the full signed amount) received off the platform
   * against an approved estimate: payment type required, photo of the check
   * optional (Settings can require it). Same ledger row as an online deposit,
   * so the estimate reads "paid" everywhere and the prompt series closes.
   */
  app.post("/api/crm/estimates/:id/payments", paymentWriteLimit, async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "takePayment")) return;
    if (!requirePermission(res, ctx, "seePrices")) return;
    const claim = claimIdempotent(req, ctx.org.id);
    if (answerIdempotent(res, req, claim)) return;
    const fail = (status: number, body: Record<string, unknown>) => { releaseIdempotent(req, ctx.org.id); return res.status(status).json(body); };
    const parsed = z.object({
      amountCents: z.number().int().min(1).max(10_000_000_00),
      method: z.enum(MANUAL_PAYMENT_METHOD_VALUES),
      note: z.string().max(2000).nullable().optional(),
      paidAt: z.string().datetime().optional(),
      proofAttachmentId: z.string().max(64).nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) {
      const methodIssue = parsed.error.issues.find((i) => i.path[0] === "method");
      return fail(400, { message: methodIssue ? "Pick how the payment was received (check, cash, wire, card…)." : "Invalid payment", issues: parsed.error.issues });
    }
    const [est0] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, String(req.params.id)))).limit(1);
    // A seat scoped to its own jobs / division sees a colleague's estimate as "not found" — same as every by-id route.
    if (!est0 || !(await objectPolicy(ctx).visible("estimates", est0.id))) return fail(404, { message: "Estimate not found" });
    const paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) return fail(400, { message: "The payment date can't be in the future." });
    const settings = reconcileSettingsOf(ctx.org.customFields);
    let proof: typeof crmAttachments.$inferSelect | null = null;
    if (parsed.data.proofAttachmentId) {
      [proof] = await db.select().from(crmAttachments).where(and(
        eq(crmAttachments.orgId, ctx.org.id), eq(crmAttachments.id, parsed.data.proofAttachmentId),
        eq(crmAttachments.kind, "payment_proof"), eq(crmAttachments.refId, est0.customerId),
      )).limit(1);
      if (!proof) return fail(400, { message: "That photo isn't on this client's file — upload it again." });
    } else if (settings.photo === "required" && (parsed.data.method === "check" || parsed.data.method === "cash")) {
      return fail(400, { message: "Your settings require a photo or copy of the check for a check or cash payment." });
    }
    const note = [parsed.data.note?.trim() || null, proof ? `Proof of payment: ${proof.fileName} (attachment ${proof.id}).` : null]
      .filter(Boolean).join(" ") || null;

    // Lock the estimate: the balance check, the open-session check and the insert happen as one.
    const result = await db.transaction(async (tx) => {
      const [est] = await tx.select().from(crmEstimates)
        .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, est0.id))).limit(1).for("update");
      if (!est?.approvedAt) return { error: { status: 409, message: "Only an approved (signed) estimate can take a deposit." } };
      const [invoiced] = await tx.select({ id: crmInvoices.id, number: crmInvoices.number }).from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.estimateId, est.id), isNull(crmInvoices.voidedAt))).limit(1);
      if (invoiced) return { error: { status: 409, message: `This estimate is already invoiced as ${invoiced.number ?? "an invoice"} — record the payment on that invoice instead.` } };
      if (await openSessionOnEstimate(ctx.org.id, est.id, tx)) {
        return { error: { status: 409, message: "The client has a payment link open for this estimate right now. Wait for it to finish (or 30 minutes) before recording the deposit by hand." } };
      }
      const signedTotal = amountDueCents({ ...est, depositCents: null } as any) ?? 0;
      const already = await collectedCents(ctx.org.id, { estimateId: est.id }, tx);
      const room = Math.max(0, signedTotal - already);
      if (room <= 0) return { error: { status: 409, message: "This estimate is already paid in full." } };
      if (parsed.data.amountCents > room) return { error: { status: 400, message: `Only ${money(room)} is left to collect on this estimate.`, outstandingCents: room } };
      const [pay] = await tx.insert(crmPayments).values({
        orgId: ctx.org.id, customerId: est.customerId, estimateId: est.id, invoiceId: null,
        projectId: est.projectId ?? null, provider: "manual",
        purpose: est.depositCents && est.depositCents > 0 && parsed.data.amountCents <= est.depositCents ? "deposit" : "final",
        amountCents: parsed.data.amountCents, currency: "usd",
        method: parsed.data.method, status: "succeeded", note, paidAt,
      } as any).returning();
      return { est, pay };
    });
    if (result.error) { const { status, ...body } = result.error; return fail(status, body); }
    const { est, pay } = result;

    const closed = await completeReconcileTasks(ctx.org.id, { estimateId: est.id, projectId: est.projectId ?? null, customerId: est.customerId });
    await emitCrmEvent(ctx.org.id, "payment.succeeded", {
      paymentId: pay.id, amountCents: pay.amountCents, method: pay.method, estimateId: est.id, projectId: est.projectId,
    }).catch(() => {});
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    notifyMembers({
      org: ctx.org, pref: "paymentReceived", type: "paymentRecorded",
      title: `${pay.purpose === "deposit" ? "Deposit" : "Payment"} recorded by ${parsed.data.method.replace("_", " ")} from ${cust?.displayName ?? "a client"}`,
      body: `${est.number ?? "Estimate"} — ${est.title}. Recorded by ${ctx.member.displayName || ctx.member.email || "a team member"}.`,
      link: `/crm/clients/${est.customerId}`, excludeMemberIds: [ctx.member.id],
    }).catch(() => {});
    autoSendDepositReceipt(ctx.org.id, pay.id).catch((e: any) => console.error("[crm] deposit receipt failed:", e?.message || e));
    logActivity(ctx, "payment.recorded", {
      entityType: "payment", entityId: pay.id, customerId: est.customerId,
      meta: { amountCents: pay.amountCents, method: pay.method, number: est.number, estimateId: est.id, proofAttachmentId: proof?.id ?? null },
    });
    const body = { payment: pay, reconciledPrompts: closed };
    rememberIdempotent(req, ctx.org.id, 201, body);
    res.status(201).json(body);
  });
}

/** Approval / close-out hooks (server/crm/job-stage-auto.ts calls these). */
export async function reconcileOnStage(orgId: string, project: Project, stage: string): Promise<void> {
  if (stage === "approved") await ensureReconcileTask(orgId, "deposit", project);
  else if (stage === "closed_out") await ensureReconcileTask(orgId, "final", project);
}
