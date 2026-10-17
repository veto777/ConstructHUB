/**
 * The review pipeline (Google Reviews → Review requests, "Ready to ask"):
 * every CRM client with a WON job (an estimate in status "approved") who has
 * not been asked for a review yet, prefilled and ready to send.
 *
 * Nothing is copied or queued at win time: the list is derived from the CRM
 * on every read, so a job marked won anywhere (portal signature, manual mark,
 * import) appears at once, and one reverted to cancelled drops out again.
 * The only stored state is the owner's "Not now" (crm_review_pipeline).
 *
 * A client counts as asked when a live (not trashed) review request is linked
 * to them (review_requests.crm_customer_id, set by the composer) or went to
 * their email from any member of the team.
 *
 * Scoping: photoCtx (an existing CRM membership) + objectPolicy, the same rule
 * the composer's client search and photo grid use; platform paywall applies.
 *   GET    /api/reviews/pipeline                 the list
 *   POST   /api/reviews/pipeline/:customerId/dismiss   "Not now"
 *   DELETE /api/reviews/pipeline/:customerId/dismiss   back into the list
 *   POST   /api/reviews/pipeline/:customerId/hide       never ask this client (the send route refuses them)
 *   DELETE /api/reviews/pipeline/:customerId/hide       allow asking again
 */
import type { Express } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { crmCustomers, crmEstimates, crmProjects, crmReviewPipeline } from "@shared/schema";
import { objectPolicy } from "./object-access";
import { EXPORT_PERMS, photoCtx } from "./photo-library";
import type { OrgContext } from "./tenancy";
import { logActivity } from "./activity";
import { requirePlatformAccess } from "../platform-access";
import { normalizeRecipient } from "../review-suppression";
import { logError } from "../ops/log";

type GetUser = (req: any, res: any) => any;
type Customer = typeof crmCustomers.$inferSelect;
type Estimate = typeof crmEstimates.$inferSelect;

/** Project statuses that mean the work is done: the best moment to ask. */
const DONE = new Set(["complete", "invoiced", "paid"]);

export type PipelineJob = { estimateId: string; number: string | null; title: string; wonAt: string | null; totalCents: number };
export type PipelineItem = {
  customer: { id: string; name: string; email: string | null; phone: string | null; address: string | null; photoCount: number };
  jobs: PipelineJob[];
  wonAt: string | null;
  /** A finished won job's project stage, else the latest won job's, when there is a project. */
  projectStatus: string | null;
  jobFinished: boolean;
  finishedPhotoCount: number;
  /** "Siding replacement · Window install" — the prefilled project description. */
  description: string;
  needsEmail: boolean;
  unsubscribed: boolean;
  dismissedAt: string | null;
};

const addressOf = (c: Customer) => [c.addressLine1, c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

/** The prefilled description: the won jobs' titles, generic ones ("Estimate") left out (pure). */
export function describeJobs(jobs: Pick<PipelineJob, "title">[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const j of jobs) {
    const t = j.title.trim();
    if (!t || /^estimate( #?\d+)?$/i.test(t) || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 3).join(" · ");
}

export async function buildReviewPipeline(ctx: OrgContext, userId: number): Promise<{
  ready: PipelineItem[]; dismissed: PipelineItem[]; hidden: PipelineItem[]; askedCount: number;
}> {
  const orgId = ctx.org.id;
  const policy = objectPolicy(ctx);
  // Each won estimate passes the estimate policy itself (division, assignment), not only its client.
  const won = await policy.filter("estimates", await db.select().from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.status, "approved")))) as Estimate[];
  if (!won.length) return { ready: [], dismissed: [], hidden: [], askedCount: 0 };

  const ids = [...new Set(won.map((e) => e.customerId))];
  const customers = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, ids), isNull(crmCustomers.archivedAt)));
  const visible = await policy.filter("customers", customers) as Customer[];
  if (!visible.length) return { ready: [], dismissed: [], hidden: [], askedCount: 0 };
  const visibleIds = visible.map((c) => c.id);

  const [projects, photos, asked, dismissals, suppressed] = await Promise.all([
    db.select({ id: crmProjects.id, status: crmProjects.status }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.customerId, visibleIds))),
    pool.query<{ ref_id: string; n: string; finished: string }>(
      `select ref_id, count(*) n, count(*) filter (where file_name like 'finished--%') finished
         from crm_attachments where org_id = $1 and kind = 'photo' and ref_id = any($2) group by ref_id`, [orgId, visibleIds]),
    // Asked: a live request linked to the client, or sent to their email by anyone on the team.
    pool.query<{ id: string }>(
      `select c.id from crm_customers c
        where c.org_id = $1 and c.id = any($2) and exists (
          select 1 from review_requests r where r.deleted_at is null and (
            (r.crm_org_id = c.org_id and r.crm_customer_id = c.id)
            or (c.email is not null and c.email <> '' and lower(trim(r.client_email)) = lower(trim(c.email))
                and r.user_id in (select m.user_id from crm_members m where m.org_id = c.org_id and m.user_id is not null))))`,
      [orgId, visibleIds]),
    db.select().from(crmReviewPipeline).where(and(eq(crmReviewPipeline.orgId, orgId), inArray(crmReviewPipeline.customerId, visibleIds))),
    pool.query<{ email: string }>("select email from review_recipient_preferences where user_id = $1 and unsubscribed = true", [userId]),
  ]);
  const projectStatus = new Map(projects.map((p) => [p.id, p.status]));
  const photoCount = new Map(photos.rows.map((r) => [r.ref_id, { n: Number(r.n), finished: Number(r.finished) }]));
  const askedIds = new Set(asked.rows.map((r) => r.id));
  const dismissedAt = new Map(dismissals.map((d) => [d.customerId, d.dismissedAt]));
  const hiddenIds = new Set(dismissals.filter((d) => d.kind === "hidden").map((d) => d.customerId));
  const unsub = new Set(suppressed.rows.map((r) => r.email));

  const jobsBy = new Map<string, typeof won>();
  for (const e of won) jobsBy.set(e.customerId, [...(jobsBy.get(e.customerId) ?? []), e]);

  const ready: PipelineItem[] = [];
  const dismissed: PipelineItem[] = [];
  const hidden: PipelineItem[] = [];
  for (const c of visible) {
    if (askedIds.has(c.id) && !hiddenIds.has(c.id)) continue;
    // A won estimate whose job was then cancelled is not a job to ask about.
    const list = (jobsBy.get(c.id) ?? [])
      .filter((e) => !e.projectId || projectStatus.get(e.projectId) !== "cancelled")
      .sort((a, b) => (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0));
    if (!list.length) continue;
    const stages = list.map((e) => e.projectId ? projectStatus.get(e.projectId) ?? null : null).filter((x): x is string => !!x);
    const status = stages.find((x) => DONE.has(x)) ?? stages[0] ?? null;
    const jobs: PipelineJob[] = list.map((e) => ({
      estimateId: e.id, number: e.number, title: e.title, wonAt: e.approvedAt?.toISOString() ?? null,
      // Price-blind seats (field crews) get no contract values.
      totalCents: ctx.permissions.seePrices ? e.approvedTotalCents ?? e.totalCents ?? 0 : 0,
    }));
    const pc = photoCount.get(c.id);
    const email = c.email?.trim() || null;
    const item: PipelineItem = {
      customer: { id: c.id, name: c.displayName, email, phone: c.phone || null, address: addressOf(c), photoCount: pc?.n ?? 0 },
      jobs,
      wonAt: jobs[0]?.wonAt ?? null,
      projectStatus: status,
      jobFinished: !!status && DONE.has(status),
      finishedPhotoCount: pc?.finished ?? 0,
      description: describeJobs(jobs),
      needsEmail: !email,
      unsubscribed: !!email && unsub.has(normalizeRecipient(email)),
      dismissedAt: dismissedAt.get(c.id)?.toISOString() ?? null,
    };
    (hiddenIds.has(c.id) ? hidden : item.dismissedAt ? dismissed : ready).push(item);
  }
  // Finished jobs first (the moment to ask), then the most recently won.
  const order = (a: PipelineItem, b: PipelineItem) =>
    Number(b.jobFinished) - Number(a.jobFinished) || (b.wonAt ?? "").localeCompare(a.wonAt ?? "");
  ready.sort(order);
  dismissed.sort((a, b) => (b.dismissedAt ?? "").localeCompare(a.dismissedAt ?? ""));
  hidden.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  return { ready, dismissed, hidden, askedCount: [...askedIds].filter((id) => !hiddenIds.has(id)).length };
}

/**
 * True when the send route must refuse: the linked CRM client is hidden, or the email belongs to a hidden client of
 * a CRM team this user is on (a request typed by hand to a hidden client's address is refused too).
 */
export async function hiddenFromReviews(userId: number, crmOrgId: string | null | undefined, crmCustomerId: string | null | undefined, email: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from crm_review_pipeline p join crm_customers c on c.id = p.customer_id and c.org_id = p.org_id
      where p.kind = 'hidden' and (
        (p.org_id = $2 and p.customer_id = $3)
        or (coalesce(c.email, '') <> '' and lower(trim(c.email)) = lower(trim($4))
            and p.org_id in (select m.org_id from crm_members m where m.user_id = $1 and m.status = 'active')))
      limit 1`, [userId, crmOrgId ?? null, crmCustomerId ?? null, email]);
  return rows.length > 0;
}

/** Asking won clients for reviews is client/job work: the same rights as sending their photos (EXPORT_PERMS). */
function mayAsk(res: any, ctx: OrgContext): boolean {
  if (EXPORT_PERMS.some((p) => ctx.permissions[p])) return true;
  res.status(403).json({ message: "Requires permission: manageJobs or manageCustomers" });
  return false;
}

export function registerReviewPipelineRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/reviews/pipeline", requirePlatformAccess, async (req: any, res) => {
    try {
      const ctx = await photoCtx(req, res, getUser);
      if (!ctx || !mayAsk(res, ctx)) return;
      res.json(await buildReviewPipeline(ctx, getUser(req, res).id));
    } catch (err) {
      logError("review pipeline", err);
      res.status(500).json({ message: "Could not load the review pipeline." });
    }
  });

  /** Not now / Put back ("dismissed") and Hide / Unhide ("hidden"); one row per client, the latest choice wins. */
  const setState = (kind: "dismissed" | "hidden", on: boolean) => async (req: any, res: any) => {
    try {
      const ctx = await photoCtx(req, res, getUser);
      if (!ctx || !mayAsk(res, ctx)) return;
      const customerId = String(req.params.customerId).slice(0, 64);
      if (!await objectPolicy(ctx).visible("customers", customerId)) return res.status(404).json({ message: "Client not found" });
      if (on) {
        await db.insert(crmReviewPipeline).values({ orgId: ctx.org.id, customerId, dismissedByMemberId: ctx.member.id, kind })
          .onConflictDoUpdate({
            target: [crmReviewPipeline.orgId, crmReviewPipeline.customerId],
            set: { dismissedAt: sql`now()`, dismissedByMemberId: ctx.member.id, kind },
          });
      } else {
        await db.delete(crmReviewPipeline).where(and(eq(crmReviewPipeline.orgId, ctx.org.id), eq(crmReviewPipeline.customerId, customerId), eq(crmReviewPipeline.kind, kind)));
      }
      const action = kind === "hidden" ? (on ? "review_pipeline.hidden" : "review_pipeline.unhidden") : (on ? "review_pipeline.dismissed" : "review_pipeline.restored");
      logActivity(ctx, action, { entityType: "customer", entityId: customerId, customerId });
      res.json({ ok: true });
    } catch (err) {
      logError("review pipeline dismiss", err);
      res.status(500).json({ message: "Could not update the review pipeline." });
    }
  };
  app.post("/api/reviews/pipeline/:customerId/dismiss", requirePlatformAccess, setState("dismissed", true));
  app.delete("/api/reviews/pipeline/:customerId/dismiss", requirePlatformAccess, setState("dismissed", false));
  app.post("/api/reviews/pipeline/:customerId/hide", requirePlatformAccess, setState("hidden", true));
  app.delete("/api/reviews/pipeline/:customerId/hide", requirePlatformAccess, setState("hidden", false));
}
