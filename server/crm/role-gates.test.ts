/**
 * CRM role gates — what the SERVER allows each seat, walked route by route.
 *
 * The Team page promises: a field tech "sees only their own assigned jobs" and
 * is "price-blind by default"; every switch (See prices, See costs and
 * margins, Manage clients, …) is a real boundary. This file pins that promise
 * to the API, not to the menus:
 *
 *   1. ROUTES — the table below names the permission every staff route needs.
 *      An inventory test reads the route declarations out of server/crm and
 *      server/jobcam and fails when a route is neither in the table nor in the
 *      explicit EXEMPT list — so a new route cannot ship unclassified.
 *   2. MATRIX — for each role's DEFAULT permissions and a few per-person
 *      override combinations, every route answers 403 exactly when the seat
 *      lacks the permission (expectations are computed from
 *      crmEffectivePermissions, the same function the server uses).
 *   3. SCOPING — a seat without "See all jobs" gets 404 on every by-id route
 *      for another member's client / project / job / estimate / invoice /
 *      payment / visit / photo, and never sees them in a list.
 *   4. MONEY — every fixture amount is a recognisable number (7111xxx = a
 *      price, 9111xxx = a cost). A price-blind seat's responses contain no
 *      price number, a cost-blind seat's no cost number; the owner's contain
 *      them all (so the absence checks are not vacuous).
 *
 * Runs against a dev server like its neighbours (CRM_TEST_BASE_URL), as the
 * dev-bypass user, inside its OWN throwaway org: the seat's role and overrides
 * are flipped with SQL on that org's membership row only, so other suites and
 * sessions sharing the dev DB are untouched. Everything is deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import {
  CRM_PERMISSIONS, CRM_ROLES, crmEffectivePermissions, type CrmPermission, type CrmRole,
} from "@shared/schema";

const base = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8131";
const pool = new pg.Pool({ connectionString: process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL });

// ── Fixture ─────────────────────────────────────────────────────────────────

const org = randomUUID();
const me = randomUUID();      // the seat under test (the dev-bypass user)
const other = randomUUID();   // a colleague with their own work
const tag = `rg${org.slice(0, 8)}`;

/** One client's whole tree. `mine` is assigned to the seat under test, `theirs` to the colleague. */
const tree = () => ({
  customer: randomUUID(), project: randomUUID(), job: randomUUID(), estimate: randomUUID(),
  item: randomUUID(), option: randomUUID(), discount: randomUUID(), invoice: randomUUID(),
  payment: randomUUID(), appointment: randomUUID(), changeOrder: randomUUID(), selection: randomUUID(),
  punch: randomUUID(), dailyLog: randomUUID(), measurement: randomUUID(), phase: randomUUID(),
  budgetLine: randomUUID(), attachment: randomUUID(), comment: randomUUID(), media: randomUUID(),
  share: randomUUID(), note: randomUUID(),
});
type Tree = ReturnType<typeof tree>;
const mine = tree();
const theirs = tree();
const pb = { item: randomUUID(), material: randomUUID(), labor: randomUUID(), pkg: randomUUID(), category: randomUUID(), costCode: randomUUID() };

// Recognisable money. Prices start 7111, costs start 9111 — see the header.
const PRICE = /7111\d{3}|71,11\d\.\d\d/;
const COST = /9111\d{3}|91,11\d\.\d\d/;
let priceSeq = 7111100, costSeq = 9111100;
const price = () => ++priceSeq;
const cost = () => ++costSeq;

let cookie = "";
async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { cookie, "content-type": "application/json" } };
  if (method !== "GET" && method !== "HEAD") init.body = JSON.stringify(body ?? {});
  const r = await fetch(base + path, init);
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv / empty */ }
  return { status: r.status, text, json };
}

/** Put the seat under test into a role, with optional per-person overrides (the Team page switches). */
async function seat(role: CrmRole, overrides: Partial<Record<CrmPermission, boolean>> | null = null) {
  await pool.query("update crm_members set role=$1, permissions=$2 where id=$3", [role, overrides ? JSON.stringify(overrides) : null, me]);
  return crmEffectivePermissions(role, overrides);
}

async function seedTree(t: Tree, label: string, assignee: string) {
  const q = (text: string, params: unknown[]) => pool.query(text, params);
  await q(`insert into crm_customers(id,org_id,display_name,portal_token,owner_member_id,address_line1,follow_up_cadence_days,last_follow_up_at,created_at)
           values ($1,$2,$3,gen_random_uuid(),$4,$5,7,now() - interval '30 days',now() - interval '40 days')`,
    [t.customer, org, `${tag} ${label} client`, assignee, `${tag} ${label} street`]);
  await q(`insert into crm_projects(id,org_id,customer_id,name,status,contract_value_cents,budget_cents)
           values ($1,$2,$3,$4,'lead',$5,$6)`, [t.project, org, t.customer, `${tag} ${label} project`, price(), cost()]);
  await q(`insert into crm_jobs(id,org_id,project_id,name,assigned_member_ids) values ($1,$2,$3,$4,$5)`,
    [t.job, org, t.project, `${tag} ${label} job`, [assignee]]);
  await q(`insert into crm_estimates(id,org_id,customer_id,project_id,public_token,number,title,status,subtotal_cents,total_cents,deposit_cents,created_by_member_id,sent_at)
           values ($1,$2,$3,$4,gen_random_uuid(),$5,$6,'sent',$7,$8,$9,$10,now())`,
    [t.estimate, org, t.customer, t.project, `E-${label}`, `${tag} ${label} estimate`, price(), price(), price(), other]);
  await q(`insert into crm_estimate_items(id,org_id,estimate_id,name,unit_price_cents,unit_cost_cents) values ($1,$2,$3,'Tear-off',$4,$5)`,
    [t.item, org, t.estimate, price(), cost()]);
  await q(`insert into crm_estimate_options(id,org_id,estimate_id,name,subtotal_cents,total_cents,items) values ($1,$2,$3,'Better',$4,$5,$6)`,
    [t.option, org, t.estimate, price(), price(), JSON.stringify([{ kind: "labor", name: "Upgrade", quantityMilli: 1000, unitPriceCents: price(), unitCostCents: cost(), taxable: true }])]);
  await q(`insert into crm_estimate_discounts(id,org_id,estimate_id,code,label,percent_bps) values ($1,$2,$3,'custom','Neighbour',$4)`,
    [t.discount, org, t.estimate, price()]);
  await q(`insert into crm_estimate_events(org_id,estimate_id,type,actor,meta) values ($1,$2,'approved','client',$3)`,
    [org, t.estimate, JSON.stringify({ totalCents: price() })]);
  await q(`insert into crm_invoices(id,org_id,customer_id,project_id,estimate_id,public_token,number,status,total_cents)
           values ($1,$2,$3,$4,$5,gen_random_uuid(),$6,'sent',$7)`, [t.invoice, org, t.customer, t.project, t.estimate, `INV-${label}`, price()]);
  await q(`insert into crm_payments(id,org_id,customer_id,invoice_id,project_id,provider,amount_cents,method,status,paid_at)
           values ($1,$2,$3,$4,$5,'manual',$6,'check','succeeded',now())`, [t.payment, org, t.customer, t.invoice, t.project, price()]);
  await q(`insert into crm_appointments(id,org_id,project_id,customer_id,title,starts_at,ends_at,dispatched_member_ids)
           values ($1,$2,$3,$4,$5,now() + interval '2 hours',now() + interval '3 hours',$6)`,
    [t.appointment, org, t.project, t.customer, `${tag} ${label} visit`, [assignee]]);
  await q(`insert into crm_change_orders(id,org_id,project_id,customer_id,title,public_token,amount_cents,cost_cents) values ($1,$2,$3,$4,$5,gen_random_uuid(),$6,$7)`,
    [t.changeOrder, org, t.project, t.customer, `${tag} ${label} CO`, price(), cost()]);
  await q(`insert into crm_selections(id,org_id,project_id,name,allowance_cents,actual_cents) values ($1,$2,$3,$4,$5,$6)`,
    [t.selection, org, t.project, `${tag} ${label} selection`, price(), price()]);
  await q(`insert into crm_punch_items(id,org_id,project_id,title) values ($1,$2,$3,$4)`, [t.punch, org, t.project, `${tag} ${label} punch`]);
  await q(`insert into crm_daily_logs(id,org_id,project_id,log_date,author_member_id,work_completed) values ($1,$2,$3,now(),$4,$5)`,
    [t.dailyLog, org, t.project, assignee, `${tag} ${label} log`]);
  await q(`insert into crm_measurements(id,org_id,customer_id,project_id,provider,status,address_line1,raw_payload) values ($1,$2,$3,$4,'other','ready',$5,$6)`,
    [t.measurement, org, t.customer, t.project, `${tag} ${label} street`, JSON.stringify({ importSource: "test", sourceText: `${tag} ${label} report` })]);
  await q(`insert into crm_phases(id,org_id,project_id,name) values ($1,$2,$3,'Rough-in')`, [t.phase, org, t.project]);
  await q(`insert into crm_budget_lines(id,org_id,project_id,cost_code_id,budget_cents) values ($1,$2,$3,$4,$5)`, [t.budgetLine, org, t.project, pb.costCode, cost()]);
  await q(`insert into crm_cost_entries(org_id,project_id,cost_code_id,amount_cents,description) values ($1,$2,$3,$4,'Dump fee')`, [org, t.project, pb.costCode, cost()]);
  await q(`insert into crm_commitments(org_id,project_id,cost_code_id,amount_cents,vendor_name) values ($1,$2,$3,$4,'Supplier')`, [org, t.project, pb.costCode, cost()]);
  await q(`insert into crm_attachments(id,org_id,kind,ref_id,file_name,mime,size_bytes,storage_path) values ($1,$2,'photo',$3,$4,'image/jpeg',10,$5)`,
    [t.attachment, org, t.customer, `${tag}-${label}.jpg`, `${org}/missing-${label}.jpg`]);
  await q(`insert into crm_client_comments(id,org_id,customer_id,body) values ($1,$2,$3,$4)`, [t.comment, org, t.customer, `${tag} ${label} comment`]);
  await q(`insert into crm_customer_notes(id,org_id,customer_id,author_member_id,body) values ($1,$2,$3,$4,$5)`,
    [t.note, org, t.customer, other, `A $${(price() / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} payment (Check, recorded 1/1/2026) on invoice INV-${label} was reversed by the account owner. Reason: typo`]);
  await q(`insert into crm_activity_log(org_id,actor_member_id,actor_label,action,entity_type,entity_id,customer_id,meta) values ($1,$2,'Colleague','payment.recorded','payment',$3,$4,$5)`,
    [org, other, t.payment, t.customer, JSON.stringify({ amountCents: price(), method: "check", number: `INV-${label}` })]);
  await q(`insert into jobcam_media(id,org_id,project_id,customer_id,uploader_member_id,kind,status,file_name,mime,r2_key_original) values ($1,$2,$3,$4,$5,'photo','ready',$6,'image/jpeg',$7)`,
    [t.media, org, t.project, t.customer, assignee, `${tag}-${label}.jpg`, `test/${org}/${label}`]);
  await q(`insert into jobcam_share_links(id,org_id,project_id,kind,token,title) values ($1,$2,$3,'timeline',$4,$5)`,
    [t.share, org, t.project, randomUUID().replace(/-/g, ""), `${tag} ${label} share`]);
}

// ── The route table ─────────────────────────────────────────────────────────

type Need =
  | null                                   // any member of the org
  | CrmPermission                          // exactly this switch
  | { any: readonly CrmPermission[] }      // any one of these
  | { all: readonly CrmPermission[] }      // every one of these
  | "owner";                               // the owner ROLE (never a switch)

type RouteRow = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The route template exactly as declared (used by the inventory test). */
  route: string;
  need: Need;
  /** Concrete path for a tree's ids; defaults to substituting nothing. */
  path?: (t: Tree) => string;
  /** A harmless body: junk that an allowed seat gets a 4xx validation answer for. */
  body?: unknown;
  /**
   * The route does something real even with a junk body (sends mail, deletes,
   * mints a token). Denied seats are still checked for their 403; allowed
   * seats are not driven through it.
   */
  effect?: boolean;
  /** The path carries an assignable object's id: a seat without "See all jobs" must get 404 for a colleague's. */
  scoped?: boolean;
  /** A VALID body for the scoping check, where the handler validates before it looks the record up. */
  probe?: unknown;
};

const R = (method: RouteRow["method"], route: string, need: Need, extra: Omit<RouteRow, "method" | "route" | "need"> = {}): RouteRow =>
  ({ method, route, need, ...extra });
const none = randomUUID();
const jobcamManage = { any: ["manageJobs", "manageCustomers"] } as const;

const ROUTES: RouteRow[] = [
  // Authenticated caller previews their own subscription; no org-role permission.
  R("POST", "/api/crm/billing/change-preview", null),
  // identity, org, team
  R("GET", "/api/crm/me", null),
  R("PATCH", "/api/crm/profile", null, { body: { phone: 12 } }),
  R("POST", "/api/crm/me/sms-consent", null, { effect: true }),
  R("GET", "/api/crm/onboarding", null),
  R("POST", "/api/crm/onboarding/dismiss", "manageSettings", { effect: true }),
  R("GET", "/api/crm/org", null),
  R("PATCH", "/api/crm/org", "manageSettings", { body: { email: "not-an-email" } }),
  R("POST", "/api/crm/org/logo", "manageSettings", { effect: true }),
  R("PUT", "/api/crm/org/price-floor-lock", "owner", { body: {} }),
  R("GET", "/api/crm/members", null),
  R("PATCH", "/api/crm/members/:id", "manageTeam", { path: () => `/api/crm/members/${other}`, body: { role: "not-a-role" } }),
  R("DELETE", "/api/crm/members/:id", "manageTeam", { path: () => `/api/crm/members/${other}`, effect: true }),
  R("POST", "/api/crm/members/:id/send-password-reset", "manageTeam", { path: () => `/api/crm/members/${other}/send-password-reset`, effect: true }),
  R("GET", "/api/crm/members/:id/activity", "owner", { path: () => `/api/crm/members/${other}/activity` }),
  R("GET", "/api/crm/invitations", "manageTeam"),
  R("POST", "/api/crm/invitations", "manageTeam", { body: { email: "nope" } }),
  R("POST", "/api/crm/invitations/:id/resend", "manageTeam", { path: () => `/api/crm/invitations/${none}/resend` }),
  R("DELETE", "/api/crm/invitations/:id", "manageTeam", { path: () => `/api/crm/invitations/${none}` }),
  R("GET", "/api/crm/divisions", null),
  R("POST", "/api/crm/divisions", "manageSettings", { body: {} }),
  R("PATCH", "/api/crm/divisions/:id", "manageSettings", { path: () => `/api/crm/divisions/${none}`, body: {} }),
  R("DELETE", "/api/crm/divisions/:id", "manageSettings", { path: () => `/api/crm/divisions/${none}` }),
  R("GET", "/api/crm/lead-sources", null),
  R("POST", "/api/crm/lead-sources", "manageSettings", { body: {} }),
  R("GET", "/api/crm/backups/settings", "owner"),
  R("PUT", "/api/crm/backups/settings", "owner", { effect: true }),
  R("POST", "/api/crm/backups/send-now", "owner", { effect: true }),
  R("GET", "/api/crm/notifications", null),
  R("POST", "/api/crm/notifications/read-all", null),
  R("POST", "/api/crm/notifications/:id/read", null, { path: () => `/api/crm/notifications/${none}/read` }),

  // clients
  R("GET", "/api/crm/customers", null),
  R("POST", "/api/crm/customers", "manageCustomers", { body: {} }),
  R("GET", "/api/crm/customers/export.csv", "exportData"),
  R("GET", "/api/crm/customers/:id", null, { path: (t) => `/api/crm/customers/${t.customer}`, scoped: true }),
  R("PATCH", "/api/crm/customers/:id", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}`, body: { email: "not-an-email" }, scoped: true }),
  R("DELETE", "/api/crm/customers/:id", "owner", { path: (t) => `/api/crm/customers/${t.customer}`, effect: true, scoped: true }),
  R("PATCH", "/api/crm/customers/:id/follow-up", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}/follow-up`, body: {}, scoped: true }),
  R("GET", "/api/crm/customers/:id/activity", "manageJobs", { path: (t) => `/api/crm/customers/${t.customer}/activity`, scoped: true }),
  R("GET", "/api/crm/customers/:id/notes", null, { path: (t) => `/api/crm/customers/${t.customer}/notes`, scoped: true }),
  R("POST", "/api/crm/customers/:id/notes", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}/notes`, body: {}, scoped: true }),
  R("PATCH", "/api/crm/customers/:id/notes/:noteId", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}/notes/${none}`, body: {}, scoped: true }),
  R("DELETE", "/api/crm/customers/:id/notes/:noteId", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}/notes/${none}`, scoped: true }),
  R("GET", "/api/crm/customers/:id/timeline", null, { path: (t) => `/api/crm/customers/${t.customer}/timeline`, scoped: true }),
  R("POST", "/api/crm/customers/:id/portal-preview", "manageCustomers", { path: (t) => `/api/crm/customers/${t.customer}/portal-preview`, effect: true, scoped: true }),
  R("GET", "/api/crm/customers/:id/client-comments", null, { path: (t) => `/api/crm/customers/${t.customer}/client-comments`, scoped: true }),
  R("POST", "/api/crm/client-comments/:id/read", null, { path: (t) => `/api/crm/client-comments/${t.comment}/read`, scoped: true }),
  R("GET", "/api/crm/customers/:id/measurements", null, { path: (t) => `/api/crm/customers/${t.customer}/measurements`, scoped: true }),
  R("GET", "/api/crm/follow-ups", null),
  R("GET", "/api/crm/attention", null),
  R("GET", "/api/crm/inbox", "manageCustomers"),
  R("GET", "/api/crm/inbox/:customerId", "manageCustomers", { path: (t) => `/api/crm/inbox/${t.customer}`, scoped: true }),
  R("POST", "/api/crm/inbox/:customerId/read", "manageCustomers", { path: (t) => `/api/crm/inbox/${t.customer}/read`, effect: true, scoped: true }),
  R("POST", "/api/crm/inbox/:customerId/reply", "manageCustomers", { path: (t) => `/api/crm/inbox/${t.customer}/reply`, body: {}, scoped: true }),
  R("POST", "/api/crm/messages", "manageCustomers", { body: {} }),
  R("GET", "/api/crm/attachments", null, { path: (t) => `/api/crm/attachments?kind=photo&refId=${t.customer}`, scoped: true }),
  // Project photos: manageJobs or manageCustomers. Pamphlets and estimate files: manageCustomers (checked below).
  R("POST", "/api/crm/attachments", { any: ["manageCustomers", "manageJobs"] }, { body: { kind: "photo" }, effect: true }),
  R("DELETE", "/api/crm/attachments/:id", { any: ["manageCustomers", "manageJobs"] }, { path: (t) => `/api/crm/attachments/${t.attachment}`, effect: true, scoped: true }),
  R("GET", "/api/crm/attachments/:id/file", null, { path: (t) => `/api/crm/attachments/${t.attachment}/file`, scoped: true }),

  // projects, jobs, schedule
  R("GET", "/api/crm/projects", null),
  R("POST", "/api/crm/projects", "manageJobs", { body: {} }),
  R("GET", "/api/crm/projects/:id", null, { path: (t) => `/api/crm/projects/${t.project}`, scoped: true }),
  R("PATCH", "/api/crm/projects/:id", "manageJobs", { path: (t) => `/api/crm/projects/${t.project}`, body: { status: "not-a-stage" }, scoped: true }),
  R("GET", "/api/crm/jobs", null),
  R("POST", "/api/crm/jobs", "manageJobs", { body: {} }),
  R("PATCH", "/api/crm/jobs/:id", "manageJobs", { path: (t) => `/api/crm/jobs/${t.job}`, body: { status: "not-a-status" }, scoped: true }),
  R("GET", "/api/crm/schedule", null),
  R("GET", "/api/crm/appointments", null),
  R("POST", "/api/crm/appointments", "manageJobs", { body: {} }),
  // A dispatched tech may progress their own visit without manageJobs (schedule.ts) — checked separately below.
  R("PATCH", "/api/crm/appointments/:id", null, { path: (t) => `/api/crm/appointments/${t.appointment}`, body: { status: "not-a-status" }, scoped: true }),
  R("DELETE", "/api/crm/appointments/:id", "manageJobs", { path: (t) => `/api/crm/appointments/${t.appointment}`, effect: true, scoped: true }),
  R("GET", "/api/crm/activity", null),
  R("GET", "/api/crm/projects/:id/punch-items", null, { path: (t) => `/api/crm/projects/${t.project}/punch-items`, scoped: true }),
  R("POST", "/api/crm/projects/:id/punch-items", "manageJobs", { path: (t) => `/api/crm/projects/${t.project}/punch-items`, body: {}, scoped: true }),
  R("PATCH", "/api/crm/punch-items/:childId", "manageJobs", { path: (t) => `/api/crm/punch-items/${t.punch}`, body: { status: "not-a-status" }, scoped: true }),
  R("GET", "/api/crm/projects/:id/selections", null, { path: (t) => `/api/crm/projects/${t.project}/selections`, scoped: true }),
  R("POST", "/api/crm/projects/:id/selections", "manageJobs", { path: (t) => `/api/crm/projects/${t.project}/selections`, body: {}, scoped: true }),
  R("PATCH", "/api/crm/selections/:childId", "manageJobs", { path: (t) => `/api/crm/selections/${t.selection}`, body: { status: "not-a-status" }, scoped: true }),
  R("GET", "/api/crm/projects/:id/daily-logs", null, { path: (t) => `/api/crm/projects/${t.project}/daily-logs`, scoped: true }),
  R("POST", "/api/crm/projects/:id/daily-logs", null, { path: (t) => `/api/crm/projects/${t.project}/daily-logs`, body: { tempF: "hot" }, scoped: true }),
  R("PATCH", "/api/crm/daily-logs/:logId", null, { path: (t) => `/api/crm/daily-logs/${t.dailyLog}`, body: { tempF: "hot" }, probe: { weather: "sunny" }, scoped: true }),
  R("DELETE", "/api/crm/daily-logs/:logId", null, { path: (t) => `/api/crm/daily-logs/${t.dailyLog}`, effect: true, scoped: true }),
  R("GET", "/api/crm/projects/:id/phases", null, { path: (t) => `/api/crm/projects/${t.project}/phases`, scoped: true }),
  R("POST", "/api/crm/projects/:id/phases", "manageJobs", { path: (t) => `/api/crm/projects/${t.project}/phases`, body: {}, scoped: true }),
  R("DELETE", "/api/crm/phases/:phaseId", "manageJobs", { path: (t) => `/api/crm/phases/${t.phase}`, effect: true, scoped: true }),
  R("GET", "/api/crm/projects/:id/permits/suggest", null, { path: (t) => `/api/crm/projects/${t.project}/permits/suggest`, scoped: true }),
  R("PATCH", "/api/crm/projects/:id/permit", "manageJobs", { path: (t) => `/api/crm/projects/${t.project}/permit`, body: { permitPortalId: "x" }, scoped: true }),

  // job costing (cost side)
  R("GET", "/api/crm/cost-codes", null),
  R("POST", "/api/crm/cost-codes", "manageSettings", { body: {} }),
  R("POST", "/api/crm/cost-codes/seed", "manageSettings", { effect: true }),
  R("GET", "/api/crm/projects/:id/costing", "seeCosts", { path: (t) => `/api/crm/projects/${t.project}/costing`, scoped: true }),
  R("PUT", "/api/crm/projects/:id/budget", { all: ["manageJobs", "seeCosts"] }, { path: (t) => `/api/crm/projects/${t.project}/budget`, body: {}, scoped: true }),
  R("POST", "/api/crm/projects/:id/budget-lines", { all: ["manageJobs", "seeCosts"] }, { path: (t) => `/api/crm/projects/${t.project}/budget-lines`, body: {}, scoped: true }),
  R("PATCH", "/api/crm/budget-lines/:lineId", { all: ["manageJobs", "seeCosts"] }, { path: (t) => `/api/crm/budget-lines/${t.budgetLine}`, body: { budgetCents: "x" }, scoped: true }),
  R("DELETE", "/api/crm/budget-lines/:lineId", { all: ["manageJobs", "seeCosts"] }, { path: (t) => `/api/crm/budget-lines/${t.budgetLine}`, effect: true, scoped: true }),
  R("POST", "/api/crm/projects/:id/commitments", "seeCosts", { path: (t) => `/api/crm/projects/${t.project}/commitments`, body: {}, scoped: true }),
  R("POST", "/api/crm/projects/:id/costs", "seeCosts", { path: (t) => `/api/crm/projects/${t.project}/costs`, body: {}, scoped: true }),

  // change orders
  R("GET", "/api/crm/projects/:id/change-orders", null, { path: (t) => `/api/crm/projects/${t.project}/change-orders`, scoped: true }),
  R("POST", "/api/crm/projects/:id/change-orders", "approveChangeOrders", { path: (t) => `/api/crm/projects/${t.project}/change-orders`, body: {}, scoped: true }),
  R("POST", "/api/crm/change-orders/:id/send", "approveChangeOrders", { path: (t) => `/api/crm/change-orders/${t.changeOrder}/send`, effect: true, scoped: true }),

  // estimates
  R("GET", "/api/crm/estimates", null),
  R("POST", "/api/crm/estimates", "manageEstimates", { body: { taxRateBps: 0 } }),
  R("GET", "/api/crm/estimates/:id", null, { path: (t) => `/api/crm/estimates/${t.estimate}`, scoped: true }),
  R("PATCH", "/api/crm/estimates/:id", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}`, body: { taxRateBps: "x" }, scoped: true }),
  R("DELETE", "/api/crm/estimates/:id", "owner", { path: (t) => `/api/crm/estimates/${t.estimate}`, effect: true, scoped: true }),
  R("PUT", "/api/crm/estimates/:id/items", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/items`, body: { items: "x" }, scoped: true }),
  R("POST", "/api/crm/estimates/:id/add-item", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/add-item`, body: {}, scoped: true }),
  R("GET", "/api/crm/estimates/:id/options", null, { path: (t) => `/api/crm/estimates/${t.estimate}/options`, scoped: true }),
  R("POST", "/api/crm/estimates/:id/options", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/options`, body: {}, scoped: true }),
  R("DELETE", "/api/crm/estimates/:id/options/:optionId", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/options/${none}`, scoped: true }),
  R("POST", "/api/crm/estimates/:id/options/from-package", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/options/from-package`, body: {}, scoped: true }),
  R("GET", "/api/crm/estimates/:id/discounts", "seePrices", { path: (t) => `/api/crm/estimates/${t.estimate}/discounts`, scoped: true }),
  R("PUT", "/api/crm/estimates/:id/discounts", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/discounts`, body: { offers: "x" }, scoped: true }),
  R("GET", "/api/crm/estimates/:id/engagement", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/engagement`, scoped: true }),
  R("POST", "/api/crm/estimates/:id/send", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/send`, effect: true, scoped: true }),
  R("POST", "/api/crm/estimates/:id/preview-link", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/preview-link`, effect: true, scoped: true }),
  R("POST", "/api/crm/estimates/:id/extend", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/extend`, effect: true, scoped: true }),
  R("POST", "/api/crm/estimates/:id/remind", "manageEstimates", { path: (t) => `/api/crm/estimates/${t.estimate}/remind`, effect: true, scoped: true }),
  R("POST", "/api/crm/estimates/:id/invoice", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/estimates/${t.estimate}/invoice`, effect: true, scoped: true }),
  R("POST", "/api/crm/estimates/:id/payment-link", { all: ["takePayment", "seePrices"] }, { path: (t) => `/api/crm/estimates/${t.estimate}/payment-link`, effect: true, scoped: true }),
  R("POST", "/api/crm/quick-bid", "manageEstimates", { body: {} }),
  R("GET", "/api/crm/measurements", null),
  R("POST", "/api/crm/measurements", "manageEstimates", { body: { provider: 1 } }),
  R("GET", "/api/crm/measurements/:id/symbols", null, { path: (t) => `/api/crm/measurements/${t.measurement}/symbols`, scoped: true }),
  R("POST", "/api/crm/reports/upload", "manageCustomers", { body: {} }),
  R("POST", "/api/crm/reports/:id/confirm", "manageCustomers", { path: (t) => `/api/crm/reports/${t.measurement}/confirm`, effect: true, scoped: true }),
  R("GET", "/api/crm/reports", null),
  R("DELETE", "/api/crm/reports/:id", "manageCustomers", { path: (t) => `/api/crm/reports/${t.measurement}`, effect: true, scoped: true }),
  R("GET", "/api/crm/reports/:id/download", null, { path: (t) => `/api/crm/reports/${t.measurement}/download`, scoped: true }),

  // invoices and payments
  R("GET", "/api/crm/invoices", "seePrices"),
  R("POST", "/api/crm/invoices", { all: ["manageInvoices", "seePrices"] }, { body: {} }),
  R("POST", "/api/crm/invoices/:id/payments", { all: ["takePayment", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/payments`, body: {}, scoped: true }),
  R("POST", "/api/crm/invoices/:id/void", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/void`, effect: true, scoped: true }),
  R("DELETE", "/api/crm/invoices/:id", "owner", { path: (t) => `/api/crm/invoices/${t.invoice}`, effect: true, scoped: true }),
  R("POST", "/api/crm/invoices/:id/send", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/send`, effect: true, scoped: true }),
  R("POST", "/api/crm/invoices/:id/preview-link", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/preview-link`, effect: true, scoped: true }),
  R("POST", "/api/crm/invoices/:id/payment-link", { all: ["takePayment", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/payment-link`, effect: true, scoped: true }),
  R("GET", "/api/crm/invoices/:id/receipt", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/receipt`, scoped: true }),
  R("POST", "/api/crm/invoices/:id/receipt/send", { all: ["manageInvoices", "seePrices"] }, { path: (t) => `/api/crm/invoices/${t.invoice}/receipt/send`, effect: true, scoped: true }),
  R("GET", "/api/crm/payments", "seePrices"),
  R("POST", "/api/crm/payments/:id/reverse", "owner", { path: (t) => `/api/crm/payments/${t.payment}/reverse`, body: {}, scoped: true }),
  R("GET", "/api/crm/payments/status", null),
  R("GET", "/api/crm/payments/settings", "manageSettings"),
  R("PUT", "/api/crm/payments/settings", "manageSettings", { effect: true }),
  R("GET", "/api/crm/payments/connect/stripe", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/payments/refresh", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/payments/disconnect", "manageIntegrations", { effect: true }),

  // price book
  R("GET", "/api/crm/pricebook/meta", null),
  R("POST", "/api/crm/pricebook/formula/test", null, { body: {} }),
  R("GET", "/api/crm/pricebook/categories", "seePrices"),
  R("POST", "/api/crm/pricebook/categories", "managePriceBook", { body: {} }),
  R("GET", "/api/crm/pricebook/labor-rates", "seePrices"),
  R("POST", "/api/crm/pricebook/labor-rates", "managePriceBook", { body: { name: "" } }),
  R("PATCH", "/api/crm/pricebook/labor-rates/:id", "managePriceBook", { path: () => `/api/crm/pricebook/labor-rates/${pb.labor}`, body: { name: "" } }),
  R("DELETE", "/api/crm/pricebook/labor-rates/:id", "managePriceBook", { path: () => `/api/crm/pricebook/labor-rates/${none}` }),
  R("GET", "/api/crm/pricebook/materials", "seePrices"),
  R("POST", "/api/crm/pricebook/materials", "managePriceBook", { body: { name: "" } }),
  R("PATCH", "/api/crm/pricebook/materials/:id", "managePriceBook", { path: () => `/api/crm/pricebook/materials/${pb.material}`, body: { name: "" } }),
  R("DELETE", "/api/crm/pricebook/materials/:id", "managePriceBook", { path: () => `/api/crm/pricebook/materials/${none}` }),
  R("POST", "/api/crm/pricebook/materials/adjust", "managePriceBook", { body: { percentBps: "x" } }),
  R("GET", "/api/crm/pricebook/items", "seePrices"),
  R("POST", "/api/crm/pricebook/items", "managePriceBook", { body: { name: "" } }),
  R("GET", "/api/crm/pricebook/items/:id", "seePrices", { path: () => `/api/crm/pricebook/items/${pb.item}` }),
  R("PATCH", "/api/crm/pricebook/items/:id", "managePriceBook", { path: () => `/api/crm/pricebook/items/${pb.item}`, body: { name: "" } }),
  R("DELETE", "/api/crm/pricebook/items/:id", "managePriceBook", { path: () => `/api/crm/pricebook/items/${none}` }),
  R("POST", "/api/crm/pricebook/items/:id/accessories", "managePriceBook", { path: () => `/api/crm/pricebook/items/${pb.item}/accessories`, body: {} }),
  R("DELETE", "/api/crm/pricebook/items/:id/accessories/:accessoryId", "managePriceBook", { path: () => `/api/crm/pricebook/items/${pb.item}/accessories/${none}` }),
  R("POST", "/api/crm/pricebook/items/:id/preview", "seePrices", { path: () => `/api/crm/pricebook/items/${pb.item}/preview`, body: {} }),
  R("GET", "/api/crm/pricebook/packages", "seePrices"),
  R("POST", "/api/crm/pricebook/packages", "managePriceBook", { body: {} }),
  R("POST", "/api/crm/pricebook/seed", "managePriceBook", { effect: true }),

  // reporting, settings, integrations
  R("GET", "/api/crm/stats", "seeReporting"),
  R("GET", "/api/crm/team-activity", "seeReporting"),
  R("POST", "/api/crm/migrate/preview", { any: ["manageCustomers", "manageEstimates", "manageInvoices"] }, { body: {} }),
  R("POST", "/api/crm/migrate/import", "manageCustomers", { body: { entity: "customers" } }),
  R("POST", "/api/crm/migrate/assisted", "manageSettings", { body: {} }),
  R("GET", "/api/crm/calendar/feed-url", "manageSettings", { effect: true }),
  R("POST", "/api/crm/calendar/rotate-feed-token", "manageSettings", { effect: true }),
  R("GET", "/api/crm/calendar/google/status", null),
  // Connecting your OWN calendar (scope=me) is open to every member; the company calendar needs manageSettings.
  R("GET", "/api/crm/calendar/google/connect", "manageSettings", { effect: true }),
  R("POST", "/api/crm/calendar/google/sync", "manageSettings", { effect: true }),
  R("POST", "/api/crm/calendar/google/disconnect", "manageSettings", { effect: true }),
  R("GET", "/api/crm/api-keys", "manageIntegrations"),
  R("POST", "/api/crm/api-keys", "manageIntegrations", { effect: true }),
  R("DELETE", "/api/crm/api-keys/:id", "manageIntegrations", { path: () => `/api/crm/api-keys/${none}` }),
  R("GET", "/api/crm/webhooks", "manageIntegrations"),
  R("POST", "/api/crm/webhooks", "manageIntegrations", { body: {} }),
  R("DELETE", "/api/crm/webhooks/:id", "manageIntegrations", { path: () => `/api/crm/webhooks/${none}` }),
  R("GET", "/api/crm/integrations/lead-capture", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/integrations/lead-capture/rotate", "manageIntegrations", { effect: true }),
  R("GET", "/api/crm/integrations/hover/status", "manageIntegrations"),
  R("GET", "/api/crm/integrations/hover/connect", "manageIntegrations", { effect: true }),
  R("GET", "/api/crm/integrations/hover/oauth/callback", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/integrations/hover/register-webhook", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/integrations/hover/sync", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/integrations/hover/schedule", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/integrations/hover/disconnect", "manageIntegrations", { effect: true }),
  R("GET", "/api/crm/sms/status", null),
  R("PUT", "/api/crm/sms/sender", "manageIntegrations", { effect: true }),
  R("POST", "/api/crm/sms/test", "manageIntegrations", { effect: true }),

  // JobCam — every member shoots; visibility follows the project
  R("GET", "/api/crm/jobcam/tags", null),
  R("POST", "/api/crm/jobcam/tags", null, { body: {} }),
  R("DELETE", "/api/crm/jobcam/tags/:id", jobcamManage, { path: () => `/api/crm/jobcam/tags/${none}` }),
  R("GET", "/api/crm/jobcam/projects", null),
  R("POST", "/api/crm/jobcam/uploads", null, { body: {} }),
  R("GET", "/api/crm/jobcam/uploads/:id", null, { path: () => `/api/crm/jobcam/uploads/${none}` }),
  R("PUT", "/api/crm/jobcam/uploads/:id/parts/:n", null, { path: () => `/api/crm/jobcam/uploads/${none}/parts/1`, effect: true }),
  R("POST", "/api/crm/jobcam/uploads/:id/parts/:n", null, { path: () => `/api/crm/jobcam/uploads/${none}/parts/1` }),
  R("POST", "/api/crm/jobcam/uploads/:id/complete", null, { path: () => `/api/crm/jobcam/uploads/${none}/complete` }),
  R("DELETE", "/api/crm/jobcam/uploads/:id", null, { path: () => `/api/crm/jobcam/uploads/${none}` }),
  R("GET", "/api/crm/jobcam/media", null),
  R("GET", "/api/crm/jobcam/media/:id", null, { path: (t) => `/api/crm/jobcam/media/${t.media}`, scoped: true }),
  R("PATCH", "/api/crm/jobcam/media/:id", null, { path: (t) => `/api/crm/jobcam/media/${t.media}`, body: { starred: "x" }, scoped: true }),
  R("DELETE", "/api/crm/jobcam/media/:id", null, { path: (t) => `/api/crm/jobcam/media/${t.media}`, effect: true, scoped: true }),
  R("POST", "/api/crm/jobcam/media/:id/retry", null, { path: (t) => `/api/crm/jobcam/media/${t.media}/retry`, scoped: true }),
  R("POST", "/api/crm/jobcam/media/bulk", null, { body: {} }),
  R("GET", "/api/crm/jobcam/media/:id/file/:variant", null, { path: (t) => `/api/crm/jobcam/media/${t.media}/file/thumb`, effect: true, scoped: true }),
  R("GET", "/api/crm/jobcam/usage", null),
  R("POST", "/api/crm/jobcam/storage-request", null, { effect: true }),
  R("GET", "/api/crm/projects/:projectId/jobcam/shares", jobcamManage, { path: (t) => `/api/crm/projects/${t.project}/jobcam/shares`, scoped: true }),
  R("POST", "/api/crm/projects/:projectId/jobcam/shares", jobcamManage, { path: (t) => `/api/crm/projects/${t.project}/jobcam/shares`, body: {}, scoped: true }),
  R("POST", "/api/crm/jobcam/shares/:id/revoke", jobcamManage, { path: (t) => `/api/crm/jobcam/shares/${t.share}/revoke`, effect: true }),
  R("DELETE", "/api/crm/jobcam/shares/:id", jobcamManage, { path: (t) => `/api/crm/jobcam/shares/${t.share}`, effect: true }),
  R("POST", "/api/crm/jobcam/shares/:id/send", jobcamManage, { path: (t) => `/api/crm/jobcam/shares/${t.share}/send`, body: {} }),
];

/**
 * Routes under /api/crm that are NOT staff-permission routes, each with the
 * reason. Anything else declared in server/crm or server/jobcam must be in
 * ROUTES — the inventory test enforces it.
 */
const EXEMPT: Record<string, string> = {
  "POST /api/crm/org/switch": "picks one of the caller's own memberships (membership is verified)",
  "GET /api/crm/invitations/lookup/:token": "invitation token is the credential",
  "POST /api/crm/invitations/accept": "invitation token is the credential",
  "GET /api/crm/billing/plans": "public price list",
  "GET /api/crm/billing/subscription": "the caller's own subscription, never the org's",
  "POST /api/crm/billing/checkout": "the caller buys their own subscription",
  "POST /api/crm/billing/change": "the caller changes their own subscription (recent re-auth required)",
  "GET /api/crm/calendar/feed.ics": "feed token is the credential",
  "POST /api/crm/integrations/hover/webhook": "HMAC-verified provider webhook",
  "POST /api/crm/integrations/measurements/webhook": "org API key is the credential",
  "POST /api/crm/stripe/connect-webhook": "Stripe signature is the credential (raw body, fails closed)",
  "POST /api/crm/sms/inbound": "carrier webhook",
  "GET /api/crm/org-logos/:file": "public logo files (they render on client documents)",
  "GET /api/crm/calendar/google/callback": "OAuth return bound to the session's state nonce; the company-calendar branch re-checks manageSettings",
  "GET /api/crm/payments/connect/stripe/callback": "OAuth return; the state nonce binds it to the member who started it",
  "POST /api/crm/estimates [tax hook]": "pre-route hook in tax.ts; the entity route behind it enforces manageEstimates",
};

const key = (r: { method: string; route: string }) => `${r.method} ${r.route}`;

// ── Expectations ────────────────────────────────────────────────────────────

function allowed(need: Need, role: CrmRole, perms: Record<CrmPermission, boolean>): boolean {
  if (need === null) return true;
  if (need === "owner") return role === "owner";
  if (typeof need === "string") return perms[need];
  if ("any" in need) return need.any.some((p) => perms[p]);
  return need.all.every((p) => perms[p]);
}

const SEATS: { name: string; role: CrmRole; overrides: Partial<Record<CrmPermission, boolean>> | null }[] = [
  ...CRM_ROLES.map((role) => ({ name: `${role} (defaults)`, role, overrides: null })),
  { name: "field + See prices", role: "field", overrides: { seePrices: true } },
  { name: "pm with See costs explicitly off", role: "pm", overrides: { seeCosts: false } },
  { name: "pm + See costs", role: "pm", overrides: { seeCosts: true } },
  { name: "field lead: + Approve change orders, + Create and edit jobs", role: "field", overrides: { approveChangeOrders: true, manageJobs: true } },
  { name: "office without See prices", role: "office", overrides: { seePrices: false } },
];

// ── 1. Inventory ────────────────────────────────────────────────────────────

describe("route inventory", () => {
  it("every staff route declared in server/crm and server/jobcam is classified", () => {
    const declared = new Set<string>();
    for (const dir of ["../crm/", "../jobcam/"]) {
      const url = new URL(dir, import.meta.url);
      for (const file of readdirSync(url).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        const text = readFileSync(new URL(file, url), "utf8");
        for (const m of text.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'`](\/api\/crm\/[^"'`]+)["'`]/g)) {
          declared.add(`${m[1].toUpperCase()} ${m[2]}`);
        }
      }
    }
    // The punch-list / selections routes are declared once through a template.
    for (const child of ["punch-items", "selections"]) {
      declared.add(`GET /api/crm/projects/:id/${child}`);
      declared.add(`POST /api/crm/projects/:id/${child}`);
      declared.add(`PATCH /api/crm/${child}/:childId`);
    }
    for (const t of [...declared]) if (t.includes("${")) declared.delete(t);

    const classified = new Set([...ROUTES.map(key), ...Object.keys(EXEMPT)]);
    const unclassified = [...declared].filter((d) => !classified.has(d)).sort();
    expect(unclassified, "new /api/crm route: add it to ROUTES with the permission it enforces (or to EXEMPT with a reason)").toEqual([]);
    const stale = ROUTES.map(key).filter((k) => !declared.has(k)).sort();
    expect(stale, "ROUTES names a route that is no longer declared").toEqual([]);
    expect(new Set(ROUTES.map(key)).size).toBe(ROUTES.length);
  });
});

// Keep database/server fixtures out of the standalone inventory checks.
describe("live CRM role gates", () => {
beforeAll(async () => {
  await pool.query("insert into crm_orgs(id,name,owner_user_id) values ($1,$2,1)", [org, `${tag} role gates`]);
  await pool.query("insert into crm_members(id,org_id,user_id,email,role,status,display_name) values ($1,$2,1,$3,'owner','active','Seat Under Test')", [me, org, `${tag}-me@example.invalid`]);
  await pool.query("insert into crm_members(id,org_id,email,role,status,display_name,hourly_cost_cents) values ($1,$2,$3,'pm','active','Colleague',$4)", [other, org, `${tag}-other@example.invalid`, cost()]);
  await pool.query("insert into crm_cost_codes(id,org_id,code,name) values ($1,$2,'07-300','Roofing')", [pb.costCode, org]);
  await pool.query("insert into crm_pb_categories(id,org_id,name) values ($1,$2,'Roofing')", [pb.category, org]);
  await pool.query(`insert into crm_pb_items(id,org_id,name,pricing_mode,flat_price_cents,flat_cost_cents,rate_cents_per_sqft,markup_bps,min_charge_cents) values ($1,$2,$3,'flat',$4,$5,$6,$7,$8)`,
    [pb.item, org, `${tag} SKU`, price(), cost(), price(), cost(), price()]);
  await pool.query("insert into crm_pb_materials(id,org_id,name,price_cents,cost_cents) values ($1,$2,$3,$4,$5)", [pb.material, org, `${tag} shingle`, price(), cost()]);
  await pool.query("insert into crm_pb_labor_rates(id,org_id,name,hourly_price_cents,hourly_cost_cents) values ($1,$2,$3,$4,$5)", [pb.labor, org, `${tag} crew`, price(), cost()]);
  await pool.query("insert into crm_pb_packages(id,org_id,name) values ($1,$2,$3)", [pb.pkg, org, `${tag} package`]);
  await seedTree(mine, "mine", me);
  await seedTree(theirs, "theirs", other);
  await call("GET", "/api/crm/me");
  expect((await call("POST", "/api/crm/org/switch", { orgId: org })).status).toBe(200);
  const who = await call("GET", "/api/crm/me");
  expect(who.json?.org?.id).toBe(org);
}, 60_000);

afterAll(async () => {
  const { rows } = await pool.query(
    "select table_name from information_schema.columns where column_name='org_id' and table_schema=current_schema() and table_name <> 'crm_orgs'");
  for (const { table_name } of rows) await pool.query(`delete from "${table_name}" where org_id = $1`, [org]).catch(() => {});
  await pool.query("delete from crm_orgs where id=$1", [org]);
  await pool.end();
}, 60_000);

// ── 2. The permission matrix ────────────────────────────────────────────────

describe.each(SEATS)("permission matrix — $name", ({ role, overrides }) => {
  it("answers 403 exactly where the seat lacks the permission", async () => {
    const perms = await seat(role, overrides);
    const wrong: string[] = [];
    for (const r of ROUTES) {
      const ok = allowed(r.need, role, perms);
      if (ok && r.effect) continue;               // real side effect: only the refusal is driven
      const path = r.path ? r.path(mine) : r.route;
      // A seat without "See all jobs" reaches its OWN tree; everything in `mine` is assigned to it.
      const res = await call(r.method, path, r.body);
      if (ok && (res.status === 403 || res.status === 401 || res.status >= 500)) wrong.push(`${key(r)} → ${res.status} (should be allowed) ${res.text.slice(0, 120)}`);
      if (!ok && res.status !== 403) wrong.push(`${key(r)} → ${res.status} (should be 403) ${res.text.slice(0, 120)}`);
    }
    expect(wrong).toEqual([]);
  }, 180_000);
});

// ── 3. Row scoping ──────────────────────────────────────────────────────────

describe.each([
  { name: "field (defaults)", role: "field" as CrmRole, overrides: null },
  { name: "subcontractor (defaults)", role: "subcontractor" as CrmRole, overrides: null },
  // Write permissions never widen what a seat can SEE: the object gate runs first.
  { name: "field with every write switch but not See all jobs", role: "field" as CrmRole, overrides: Object.fromEntries(CRM_PERMISSIONS.filter((p) => p !== "viewAllJobs").map((p) => [p, true])) },
])("own assigned jobs only — $name", ({ role, overrides }) => {
  it("every by-id route answers 404 for a colleague's record", async () => {
    await seat(role, overrides);
    const leaks: string[] = [];
    for (const r of ROUTES.filter((x) => x.scoped)) {
      const res = await call(r.method, r.path!(theirs), r.probe ?? r.body);
      if (res.status !== 404) leaks.push(`${key(r)} → ${res.status} ${res.text.slice(0, 120)}`);
    }
    // JobCam share links hang off the project too.
    for (const [m, p] of [["POST", `/api/crm/jobcam/shares/${theirs.share}/revoke`], ["DELETE", `/api/crm/jobcam/shares/${theirs.share}`], ["POST", `/api/crm/jobcam/shares/${theirs.share}/send`]] as const) {
      const res = await call(m, p, {});
      if (res.status !== 404 && res.status !== 403) leaks.push(`${m} ${p} → ${res.status}`);
    }
    // A filter or a body reference is not a second way in.
    for (const p of [
      `/api/crm/estimates?customerId=${theirs.customer}`, `/api/crm/projects?customerId=${theirs.customer}`,
      `/api/crm/jobs?projectId=${theirs.project}`, `/api/crm/appointments?projectId=${theirs.project}`,
      `/api/crm/measurements?projectId=${theirs.project}`, `/api/crm/jobcam/media?projectId=${theirs.project}`,
      `/api/crm/attachments?kind=photo&refId=${theirs.customer}`,
    ]) {
      const res = await call("GET", p);
      if (res.status !== 404) leaks.push(`GET ${p} → ${res.status} ${res.text.slice(0, 120)}`);
    }
    const viaBody = await call("POST", `/api/crm/projects/${mine.project}/daily-logs`, { projectId: theirs.project, workCompleted: "x" });
    if (viaBody.status !== 404) leaks.push(`body projectId → ${viaBody.status}`);
    expect(leaks).toEqual([]);
  }, 120_000);

  it("no list, feed, search or dashboard endpoint mentions a colleague's work", async () => {
    await seat(role, overrides);
    const theirWords = new RegExp(`${tag} theirs|${Object.values(theirs).join("|")}`);
    const leaks: string[] = [];
    const lists = [
      "/api/crm/customers", "/api/crm/customers?paged=1", `/api/crm/customers?q=${tag}`, "/api/crm/projects", "/api/crm/jobs",
      "/api/crm/estimates", "/api/crm/estimates?status=sent,viewed", "/api/crm/schedule", "/api/crm/appointments",
      "/api/crm/activity", "/api/crm/follow-ups", "/api/crm/attention", "/api/crm/measurements", "/api/crm/reports",
      "/api/crm/attachments", "/api/crm/jobcam/media", "/api/crm/jobcam/projects", `/api/crm/jobcam/media?q=${tag}`,
      "/api/crm/invoices", "/api/crm/payments", "/api/crm/inbox", "/api/crm/notifications",
      "/api/crm/customers/export.csv", "/api/crm/stats", "/api/crm/team-activity",
    ];
    let sawOwn = false;
    for (const p of lists) {
      const res = await call("GET", p);
      if (theirWords.test(res.text)) leaks.push(`GET ${p} (${res.status})`);
      if (res.text.includes(`${tag} mine`)) sawOwn = true;
    }
    expect(leaks).toEqual([]);
    expect(sawOwn, "the seat still sees its own assigned work").toBe(true);
  }, 60_000);

  it("its own assigned job stays usable: the job, its punch list, daily log, schedule and JobCam", async () => {
    await seat(role, overrides);
    for (const p of [
      `/api/crm/projects/${mine.project}`, `/api/crm/projects/${mine.project}/punch-items`, `/api/crm/projects/${mine.project}/daily-logs`,
      `/api/crm/projects/${mine.project}/phases`, `/api/crm/projects/${mine.project}/selections`, `/api/crm/projects/${mine.project}/change-orders`,
      `/api/crm/customers/${mine.customer}`, `/api/crm/estimates/${mine.estimate}`, `/api/crm/jobcam/media/${mine.media}`,
      `/api/crm/jobcam/media?projectId=${mine.project}`, "/api/crm/schedule",
    ]) {
      expect((await call("GET", p)).status, p).toBe(200);
    }
    // A crew member files a daily log and progresses a visit they are dispatched to.
    const log = await call("POST", `/api/crm/projects/${mine.project}/daily-logs`, { workCompleted: `${tag} mine crew log` });
    expect(log.status).toBe(201);
    expect((await call("PATCH", `/api/crm/appointments/${mine.appointment}`, { status: "on_my_way" })).status).toBe(200);
    await pool.query("update crm_appointments set status='scheduled', on_my_way_at=null where id=$1", [mine.appointment]);
    await pool.query("delete from crm_daily_logs where id=$1", [log.json.id]);
  }, 30_000);
});

describe("uploads", () => {
  it("a pamphlet or estimate file needs Manage clients; a project photo needs job or client rights", async () => {
    await seat("field", { manageJobs: true });
    expect((await call("POST", "/api/crm/attachments", { kind: "pamphlet" })).status).toBe(403);
    await seat("field");
    expect((await call("POST", "/api/crm/attachments", { kind: "photo" })).status).toBe(403);
  });
});

describe("\"See all jobs\" is what widens the view", () => {
  it("a field seat with See all jobs switched on can open a colleague's job (still price-blind)", async () => {
    await seat("field", { viewAllJobs: true });
    const res = await call("GET", `/api/crm/projects/${theirs.project}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(PRICE);
    expect(res.text).not.toMatch(COST);
  });
  it("a visit on a colleague's job cannot be progressed by a tech who is not dispatched to it", async () => {
    await seat("field", { viewAllJobs: true });
    expect((await call("PATCH", `/api/crm/appointments/${theirs.appointment}`, { status: "on_my_way" })).status).toBe(403);
  });
});

// ── 4. Money ────────────────────────────────────────────────────────────────

/** Every GET in the table, on the seat's own tree, plus the list filters a page would use. */
const moneyReads = (): string[] => [
  ...ROUTES.filter((r) => r.method === "GET" && !r.effect).map((r) => (r.path ? r.path(mine) : r.route)),
  `/api/crm/estimates?customerId=${mine.customer}`, "/api/crm/estimates?status=sent,viewed&sort=largest",
  `/api/crm/invoices?customerId=${mine.customer}`, `/api/crm/payments?customerId=${mine.customer}`,
  `/api/crm/projects?customerId=${mine.customer}`, "/api/crm/customers?paged=1",
];

async function everythingASeatCanRead() {
  let all = "";
  for (const p of moneyReads()) all += `\n${p}\n${(await call("GET", p)).text}`;
  // The price-book preview is a POST that returns prices and costs.
  all += (await call("POST", `/api/crm/pricebook/items/${pb.item}/preview`, { quantityMilli: 1000 })).text;
  return all;
}

describe("money never reaches a seat that is blind to it", () => {
  it("control: the owner's responses carry the fixture's prices and costs", async () => {
    await seat("owner");
    const all = await everythingASeatCanRead();
    const prices = new Set(all.match(/7111\d{3}/g) ?? []);
    const costs = new Set(all.match(/9111\d{3}/g) ?? []);
    // Most seeded amounts are reachable through some endpoint (the colleague's tree included).
    expect(prices.size).toBeGreaterThanOrEqual(20);
    expect(costs.size).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it.each([
    { name: "field (defaults)", role: "field" as CrmRole, overrides: null },
    { name: "subcontractor (defaults)", role: "subcontractor" as CrmRole, overrides: null },
    { name: "office without See prices", role: "office" as CrmRole, overrides: { seePrices: false } },
    { name: "field lead with job and change-order switches", role: "field" as CrmRole, overrides: { manageJobs: true, approveChangeOrders: true, manageCustomers: true } },
  ])("price-blind and cost-blind: $name sees no amount anywhere", async ({ role, overrides }) => {
    await seat(role, overrides);
    const all = await everythingASeatCanRead();
    const found = [...(all.match(new RegExp(PRICE.source, "g")) ?? []), ...(all.match(new RegExp(COST.source, "g")) ?? [])];
    expect(found, firstHit(all, PRICE) ?? firstHit(all, COST) ?? "").toEqual([]);
  }, 60_000);

  it.each([
    { name: "pm (defaults)", role: "pm" as CrmRole, overrides: null },
    { name: "office (defaults)", role: "office" as CrmRole, overrides: null },
    { name: "field + See prices", role: "field" as CrmRole, overrides: { seePrices: true } },
    { name: "pm with See costs explicitly off", role: "pm" as CrmRole, overrides: { seeCosts: false } },
  ])("cost-blind: $name sees prices but no cost, margin or cost rate", async ({ role, overrides }) => {
    await seat(role, overrides);
    const all = await everythingASeatCanRead();
    expect(all.match(new RegExp(COST.source, "g")) ?? [], firstHit(all, COST) ?? "").toEqual([]);
    expect(all).toMatch(PRICE);
  }, 60_000);

  it("See reporting without See prices is a count-only view: no totals, no payment amounts in the feed", async () => {
    await seat("office", { seePrices: false });
    const stats = await call("GET", "/api/crm/stats");
    expect(stats.status).toBe(200);
    expect(stats.json.openEstimates.count).toBeGreaterThan(0);
    expect(stats.text).not.toContain("totalCents");
    const feed = await call("GET", "/api/crm/team-activity");
    expect(feed.status).toBe(200);
    expect(feed.text).not.toMatch(/paid \$/);
    // With See prices back on, the same seat gets the totals again.
    await seat("office");
    expect((await call("GET", "/api/crm/stats")).json.openEstimates.totalCents).toBeGreaterThan(0);
    expect((await call("GET", "/api/crm/team-activity")).text).toMatch(/paid \$/);
  });

  it("the responses of the WRITE routes a cost-blind seat may use carry no cost either", async () => {
    // The pm writes estimates but is cost-blind: adding a tier from a package must not hand line costs back.
    await seat("pm");
    await pool.query("insert into crm_pb_package_items(org_id,package_id,item_id) values ($1,$2,$3)", [org, pb.pkg, pb.item]);
    await pool.query("update crm_estimates set status='draft', sent_at=null where id=$1", [mine.estimate]);
    const tier = await call("POST", `/api/crm/estimates/${mine.estimate}/options/from-package`, { packageId: pb.pkg });
    expect(tier.status).toBe(201);
    expect(tier.text).not.toMatch(COST);
    const manual = await call("POST", `/api/crm/estimates/${mine.estimate}/options`, {
      name: "Best", tier: 3, items: [{ name: "Ridge vent", unitPriceCents: 7111999, unitCostCents: 9111999 }],
    });
    expect(manual.status).toBe(201);
    expect(manual.text).not.toMatch(COST);
    // A lead carpenter who may approve change orders but sees neither prices nor costs.
    await seat("field", { approveChangeOrders: true });
    const sent = await call("POST", `/api/crm/change-orders/${mine.changeOrder}/send`, {});
    expect(sent.status).toBe(200);
    expect(sent.text).not.toMatch(PRICE);
    expect(sent.text).not.toMatch(COST);
  }, 30_000);
});

function firstHit(all: string, re: RegExp): string | null {
  const m = re.exec(all);
  if (!m) return null;
  const before = all.slice(0, m.index);
  const path = before.slice(before.lastIndexOf("\n/api/") + 1).split("\n")[0];
  return `${m[0]} leaked by GET ${path}: …${all.slice(Math.max(0, m.index - 80), m.index + 40)}…`;
}

// ── 5. Handing out access ───────────────────────────────────────────────────

describe("a delegate cannot hand out more than they hold", () => {
  const delegate = { manageTeam: true } as const;
  it("field + Manage team: cannot promote themselves or anyone, cannot switch on what they lack", async () => {
    await seat("field", delegate);
    // (The seat under test is the fixture org's owner ACCOUNT, whose role is locked anyway — so the
    // promotion is tried on the colleague; the self-grant is tried through the switches.)
    expect((await call("PATCH", `/api/crm/members/${other}`, { role: "admin" })).status).toBe(403);
    expect((await call("PATCH", `/api/crm/members/${other}`, { role: "field", permissions: { manageSettings: true } })).status).toBe(403);
    expect((await call("PATCH", `/api/crm/members/${me}`, { permissions: { ...delegate, seePrices: true } })).status).toBe(403);
    expect((await call("PATCH", `/api/crm/members/${other}`, { permissions: { exportData: true } })).status).toBe(403);
    expect((await call("POST", "/api/crm/invitations", { email: `${tag}-x@example.invalid`, role: "office" })).status).toBe(403);
    // Disabling or removing a seat above their own is refused too.
    expect((await call("PATCH", `/api/crm/members/${other}`, { status: "disabled" })).status).toBe(403);
    expect((await call("DELETE", `/api/crm/members/${other}`)).status).toBe(403);
    // The cost rate is cost data.
    expect((await call("PATCH", `/api/crm/members/${me}`, { hourlyCostCents: 100 })).status).toBe(403);
    const [{ role, permissions }] = (await pool.query("select role, permissions from crm_members where id=$1", [me])).rows;
    expect(role).toBe("field");
    expect(permissions).toEqual(delegate);
  });
  it("…but still manages what is within their own access", async () => {
    await seat("field", delegate);
    expect((await call("PATCH", `/api/crm/members/${me}`, { title: "Crew lead" })).status).toBe(200);
  });
  it("an admin still edits any seat below owner, as before", async () => {
    await seat("admin");
    const res = await call("PATCH", `/api/crm/members/${other}`, { permissions: { exportData: true } });
    expect(res.status).toBe(200);
    await pool.query("update crm_members set permissions=null where id=$1", [other]);
  });
});

// ── 6. The member activity log ──────────────────────────────────────────────

describe("member activity log", () => {
  it("records what a person did in words: permission changes by label, price-book edits, exports", async () => {
    await seat("owner");
    await call("PATCH", `/api/crm/members/${other}`, { permissions: { seeCosts: true, exportData: true }, hourlyCostCents: 4200 });
    await call("PATCH", `/api/crm/pricebook/materials/${pb.material}`, { description: "30-year architectural" });
    await call("GET", "/api/crm/customers/export.csv");
    let rows: any[] = [];
    for (let i = 0; i < 20; i++) {       // audit writes are fire-and-forget
      rows = (await call("GET", `/api/crm/members/${me}/activity`)).json ?? [];
      if (rows.some((r) => r.action === "member.updated") && rows.some((r) => r.action === "pricebook.updated") && rows.some((r) => r.action === "data.exported")) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const text = rows.map((r) => r.text).join("\n");
    expect(text).toContain("turned on “See costs and margins”, “Export client data (CSV)”");
    expect(text).toContain("cost rate");
    expect(text).toContain(`updated price book material ${tag} shingle`);
    expect(text).toContain("exported the client list");
    // Never a column name, never the amount of the cost rate.
    expect(text).not.toMatch(/hourlyCostCents|permissions\b(?!”)|4200|42\.00/);
    await pool.query("update crm_members set permissions=null, hourly_cost_cents=$2 where id=$1", [other, 9111100 + 1]);
  }, 30_000);
});

});
