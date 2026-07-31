/**
 * Housecall Pro → ConstructHub CRM importer.
 *
 * Reads the read-only HCP export in analysis/hcp-export/ (see MANIFEST.json and
 * MAPPING.md there) and upserts customers, projects, jobs, appointments,
 * estimates (+options +items), invoices (+items +payments), lead sources and
 * team reference data into a single target org.
 *
 * Idempotent: every entity is keyed on customFields->>'hcpId' (payments on
 * provider+externalId, lead sources on name, members on org+email). A second
 * run with unchanged data writes nothing and reports everything "skipped".
 *
 * Money: totals are recomputed from line items in integer cents, mirroring
 * recalcEstimate (server/crm/entities.ts) and recalcInvoice (server/crm/ops.ts)
 * arithmetic exactly. HCP totals the recomputation cannot reproduce are logged
 * as discrepancies and preserved in customFields.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/import-hcp.ts --org=<orgId>
 *   npx tsx scripts/import-hcp.ts --org=<orgId> --database-url=postgres://… \
 *       [--export-dir=analysis/hcp-export] [--summary=<path>]
 */
import { randomBytes, createHash } from "crypto";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const a = argv.find((v) => v.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
if (arg("database-url")) process.env.DATABASE_URL = arg("database-url")!;
if (!process.env.DATABASE_URL) {
  throw new Error("Provide --database-url=postgres://… or set DATABASE_URL");
}
const ORG_ID = arg("org");
if (!ORG_ID) throw new Error("--org=<orgId> is required (the target org for the import)");
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPORT_DIR = path.resolve(arg("export-dir") ?? path.join(SCRIPT_DIR, "..", "analysis", "hcp-export"));
const SUMMARY_PATH = path.resolve(arg("summary") ?? path.join(EXPORT_DIR, "import-summary.json"));

// DATABASE_URL must be set before these modules construct their pool.
const { db, pool } = await import("../server/db");
const s = await import("../shared/schema");
const { and, eq, sql } = await import("drizzle-orm");

const tok = () => randomBytes(24).toString("hex");
const dt = (v: any): Date | null => (v ? new Date(v) : null);
const cents = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// ── Export loading ──────────────────────────────────────────────────────────
function loadDir(dir: string): Map<string, any> {
  const abs = path.join(EXPORT_DIR, dir);
  const out = new Map<string, any>();
  for (const f of readdirSync(abs)) {
    if (!f.endsWith(".json")) continue;
    const d = JSON.parse(readFileSync(path.join(abs, f), "utf8"));
    out.set(d.id, d);
  }
  return out;
}
const loadJson = (f: string) => JSON.parse(readFileSync(path.join(EXPORT_DIR, f), "utf8"));

// ── Stats / logging ─────────────────────────────────────────────────────────
type Stat = { created: number; updated: number; skipped: number; errors: { hcpId: string; error: string }[] };
const stat = (): Stat => ({ created: 0, updated: 0, skipped: 0, errors: [] });
const ENTITY_NAMES = ["leadSources", "members", "customers", "projects", "jobs", "appointments", "estimates", "estimateOptions", "estimateItems", "invoices", "invoiceItems", "payments"] as const;
const stats: Record<string, Stat> = Object.fromEntries(ENTITY_NAMES.map((k) => [k, stat()]));
const discrepancies: { entity: string; hcpId: string; field: string; hcp: any; recomputed: any; note: string }[] = [];

function stable(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}
const importHash = (mapped: Record<string, any>) =>
  createHash("sha256").update(stable(mapped)).digest("hex").slice(0, 32);

// ── Money — mirrors recalcEstimate / recalcInvoice exactly ─────────────────
// line = round(unitPriceCents * quantityMilli / 1000); discount-kind lines are
// subtracted; tax = round(max(0, taxable - discount) * bps / 10000);
// total = max(0, subtotal - discount + tax).
type Line = { kind: string; unitPriceCents: number; quantityMilli: number; taxable: boolean };
function recompute(items: Line[], taxRateBps: number) {
  let subtotal = 0, taxable = 0, discount = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { discount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const taxBase = Math.max(0, taxable - discount);
  const tax = Math.round((taxBase * (taxRateBps || 0)) / 10000);
  const total = Math.max(0, subtotal - discount + tax);
  return { subtotal, discount, tax, total };
}

/**
 * Build synthetic line items + a tax rate that reproduce an HCP document whose
 * own line items were not exported. subTotalHcp/discountHcp/totalHcp are HCP's
 * document-level figures (integer cents). When HCP's total sits BELOW
 * subtotal - discount (an unitemised markdown), the gap is folded into the
 * discount line so the repo's rules still reproduce the HCP total exactly;
 * HCP's raw discount stays in customFields.
 */
function synthItems(subTotalHcp: number, discountHcp: number, totalHcp: number) {
  const items: Line[] = [{ kind: "labor", unitPriceCents: subTotalHcp, quantityMilli: 1000, taxable: true }];
  let discount = Math.min(Math.max(discountHcp, 0), subTotalHcp);
  const base = subTotalHcp - discount;
  const hcpTax = totalHcp - base;
  let taxRateBps = 0;
  if (hcpTax > 0 && base > 0) {
    taxRateBps = Math.round((hcpTax * 10000) / base);
  } else if (hcpTax < 0) {
    discount = subTotalHcp - totalHcp;
  }
  if (discount > 0) items.push({ kind: "discount", unitPriceCents: discount, quantityMilli: 1000, taxable: false });
  return { items, taxRateBps };
}

// ── Upsert helper ───────────────────────────────────────────────────────────
type Existing = { id: string; customFields: any };

async function loadHcpIndex(table: any): Promise<Map<string, Existing>> {
  const rows = await db.select({ id: table.id, customFields: table.customFields })
    .from(table).where(eq(table.orgId, ORG_ID));
  const map = new Map<string, Existing>();
  for (const r of rows as any[]) {
    const hcpId = r.customFields?.hcpId;
    if (typeof hcpId === "string" && hcpId) map.set(hcpId, { id: r.id, customFields: r.customFields });
  }
  return map;
}

/**
 * Insert or update one row keyed on customFields.hcpId. `mapped` is every
 * mapped column (its customFields get hcpId + hcpImportHash added).
 * `onCreate` adds create-only columns (portal/public tokens). No-op when the
 * hash is unchanged. onWrite(id, isCreate) runs after a write (children).
 */
async function upsert(
  table: any, existing: Map<string, Existing>, hcpId: string,
  mapped: Record<string, any>, st: Stat,
  opts: { onCreate?: Record<string, any>; onWrite?: (id: string, isCreate: boolean) => Promise<void> } = {},
): Promise<{ id: string; wrote: boolean } | null> {
  const hash = importHash(mapped);
  const customFields = { ...(mapped.customFields ?? {}), hcpId, hcpImportHash: hash };
  const prev = existing.get(hcpId);
  try {
    if (prev) {
      if (prev.customFields?.hcpImportHash === hash) { st.skipped++; return { id: prev.id, wrote: false }; }
      await db.update(table).set({ ...mapped, customFields, updatedAt: new Date() } as any).where(eq(table.id, prev.id));
      st.updated++;
      if (opts.onWrite) await opts.onWrite(prev.id, false);
      return { id: prev.id, wrote: true };
    }
    const [row] = await db.insert(table).values({ ...mapped, customFields, ...(opts.onCreate ?? {}) } as any).returning({ id: table.id });
    st.created++;
    existing.set(hcpId, { id: row.id, customFields });
    if (opts.onWrite) await opts.onWrite(row.id, true);
    return { id: row.id, wrote: true };
  } catch (e: any) {
    st.errors.push({ hcpId, error: e?.message || String(e) });
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`HCP import → org ${ORG_ID}`);
  console.log(`export dir: ${EXPORT_DIR}`);

  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, ORG_ID)).limit(1);
  if (!org) throw new Error(`Org ${ORG_ID} not found — pass an existing org id via --org`);

  const customers = loadDir("customers-details");
  const estimates = loadDir("estimates-details");
  const invoices = loadDir("invoices-details");
  const jobs = loadDir("jobs-details");
  const employees: any[] = loadJson("employees.json");
  const pros: any[] = loadJson("pros.json").data ?? [];
  const leadSources: any[] = loadJson("lead_sources.json");
  const manifest = loadJson("MANIFEST.json");
  console.log(`export: ${customers.size} customers, ${estimates.size} estimates, ${invoices.size} invoices, ${jobs.size} jobs`);

  // HCP people: employees + pros are the same roster from two endpoints.
  const people = new Map<string, any>();
  for (const e of employees) people.set(e.id, { ...e, archived: !!e.archived });
  for (const p of pros) {
    const prev = people.get(p.id) ?? {};
    people.set(p.id, { ...prev, ...p, archived: !!(prev.archived || p.is_archived) });
  }

  // Customer addresses by HCP address id (job rows reference address_id).
  const addrById = new Map<string, any>();
  for (const c of customers.values()) {
    for (const a of c.addresses?.data ?? []) addrById.set(a.id, a);
  }

  // Lead source names encountered in job/estimate data ("eLocal" is not one
  // of the 8 system sources). Collected before customers so customer rows
  // carry leadSourceId on first insert.
  const extraSourceNames = new Set<string>();
  const custLeadSource = new Map<string, string>();
  for (const j of jobs.values()) {
    if (typeof j.lead_source === "string" && j.lead_source) {
      extraSourceNames.add(j.lead_source);
      if (j.customer_id && !custLeadSource.has(j.customer_id)) custLeadSource.set(j.customer_id, j.lead_source);
    }
  }
  for (const e of estimates.values()) {
    for (const o of e.options ?? []) {
      if (typeof o.lead_source === "string" && o.lead_source) {
        extraSourceNames.add(o.lead_source);
        if (e.customer_uuid && !custLeadSource.has(e.customer_uuid)) custLeadSource.set(e.customer_uuid, o.lead_source);
      }
    }
  }

  // ── Lead sources → crm_lead_sources (+ raw list preserved on the org) ─────
  const leadSourceIdByName = new Map<string, string>();
  {
    const existing = await db.select().from(s.crmLeadSources).where(eq(s.crmLeadSources.orgId, ORG_ID));
    for (const r of existing) leadSourceIdByName.set(r.name.toLowerCase(), r.id);
    const names = new Map<string, { active: boolean }>();
    for (const l of leadSources) names.set(l.name, { active: !l.discarded_at && !l.hidden });
    for (const n of extraSourceNames) if (!names.has(n)) names.set(n, { active: true });
    for (const [name, { active }] of names) {
      const st = stats.leadSources;
      try {
        if (leadSourceIdByName.has(name.toLowerCase())) { st.skipped++; continue; }
        const [row] = await db.insert(s.crmLeadSources).values({ orgId: ORG_ID, name, active }).returning();
        leadSourceIdByName.set(name.toLowerCase(), row.id);
        st.created++;
      } catch (e: any) { st.errors.push({ hcpId: name, error: e?.message || String(e) }); }
    }
  }

  // ── Team → crm_members ONLY where the email already has a users row ──────
  // Everyone (matched or not) is preserved on the org as customFields.hcpTeam.
  // This script never creates user accounts. Runs before jobs so dispatched
  // pros can be linked to member ids.
  const allUsers = await db.select().from(s.users);
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  const HCP_ROLE: Record<string, string> = { admin: "admin", "office staff": "office", "field tech": "field" };
  const memberIdByProId = new Map<string, string>();
  const hcpTeam: any[] = [];
  for (const p of people.values()) {
    const email = String(p.email ?? "").toLowerCase();
    const user = email ? userByEmail.get(email) : undefined;
    const role = HCP_ROLE[String(p.role ?? "").toLowerCase()] ?? (p.is_admin ? "admin" : "field");
    let memberId: string | null = null;
    if (user) {
      const st = stats.members;
      const vals = {
        userId: user.id, role, status: "active",
        displayName: p.full_name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || email),
        phone: p.mobile_number ?? null,
        calendarColor: p.color_hex ? `#${String(p.color_hex).replace(/^#/, "")}` : null,
      };
      try {
        const [existing] = await db.select().from(s.crmMembers)
          .where(and(eq(s.crmMembers.orgId, ORG_ID), sql`lower(${s.crmMembers.email}) = ${email}`)).limit(1);
        if (existing) {
          const unchanged = existing.userId === vals.userId && existing.role === vals.role &&
            existing.status === vals.status && (existing.displayName ?? null) === vals.displayName &&
            (existing.phone ?? null) === vals.phone && (existing.calendarColor ?? null) === vals.calendarColor;
          if (unchanged) { st.skipped++; }
          else {
            await db.update(s.crmMembers).set({ ...vals, updatedAt: new Date() } as any).where(eq(s.crmMembers.id, existing.id));
            st.updated++;
          }
          memberId = existing.id;
        } else {
          const [row] = await db.insert(s.crmMembers).values({ orgId: ORG_ID, email, ...vals } as any).returning();
          st.created++;
          memberId = row.id;
        }
      } catch (e: any) { st.errors.push({ hcpId: p.id, error: e?.message || String(e) }); }
    } else {
      stats.members.skipped++;
    }
    hcpTeam.push({
      hcpId: p.id,
      name: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ") ?? null,
      email: p.email ?? null,
      mobileNumber: p.mobile_number ?? null,
      hcpRole: p.role ?? null,
      isAdmin: !!p.is_admin,
      archivedInHcp: !!p.archived,
      hcpPermissions: p.permissions ?? null,
      matchedUserId: user?.id ?? null,
      memberId,
    });
    if (memberId) memberIdByProId.set(p.id, memberId);
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  const custIdx = await loadHcpIndex(s.crmCustomers);
  const custIdByHcp = new Map<string, string>();

  // Reconstruct customers that estimates reference but the customer export
  // does not contain (deleted in HCP after the estimate was written).
  const reconstructedIds = new Set<string>();
  for (const e of estimates.values()) {
    const cid = e.customer_uuid;
    if (!cid || customers.has(cid)) continue;
    customers.set(cid, {
      id: cid,
      first_name: e.customer_first_name ?? null,
      last_name: e.customer_last_name ?? null,
      display_name: e.customer_name ?? null,
      email: e.customer_billable_email ?? null,
      mobile_number: e.customer_phone_number ?? null,
      created_at: e.created_at ?? null,
      updated_at: null,
      addresses: { data: [] },
    });
    reconstructedIds.add(cid);
    console.log(`  customer ${cid} not in export — reconstructing from estimate ${e.id}`);
  }

  for (const c of customers.values()) {
    const addrs: any[] = c.addresses?.data ?? [];
    const primary = addrs.find((a) => !a.billing) ?? null;
    const billing = addrs.find((a) => a.billing) ?? null;
    const phones = [c.mobile_number, c.home_number, c.work_number, c.billable_phone_number].filter(Boolean);
    const lsName = custLeadSource.get(c.id) ?? null;
    const mapped: Record<string, any> = {
      orgId: ORG_ID,
      displayName: c.display_name || [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.company || c.email || "Unknown",
      firstName: c.first_name ?? null,
      lastName: c.last_name ?? null,
      companyName: c.company ?? null,
      email: c.email ?? null,
      phone: phones[0] ?? null,
      altPhone: phones[1] ?? null,
      addressLine1: primary?.street || null,
      addressLine2: primary?.street_line_2 || null,
      city: primary?.city ?? null,
      state: primary?.state ?? null,
      postalCode: primary?.zip ?? null,
      billingSameAsService: !billing,
      billingLine1: billing?.street ?? null,
      billingCity: billing?.city ?? null,
      billingState: billing?.state ?? null,
      billingPostalCode: billing?.zip ?? null,
      leadSourceId: lsName ? leadSourceIdByName.get(lsName.toLowerCase()) ?? null : null,
      notes: c.notes ?? null,
      customFields: {
        doNotService: !!c.do_not_service,
        blockedCustomer: !!c.blocked_customer,
        hcpType: c.type ?? null,
        isContractor: !!c.is_contractor,
        notificationsEnabled: c.notifications_enabled ?? null,
        hasCardOnFile: !!c.has_improved_card_on_file,
        leadSource: lsName,
        hcpCreatedAt: c.created_at ?? null,
        hcpUrl: c.url ?? null,
        ...(reconstructedIds.has(c.id)
          ? { reconstructedFrom: "estimate", note: "referenced by an HCP estimate but absent from the customer export (deleted in HCP)" }
          : {}),
      },
      createdAt: dt(c.created_at) ?? new Date(),
      updatedAt: dt(c.updated_at) ?? new Date(),
    };
    const res = await upsert(s.crmCustomers, custIdx, c.id, mapped, stats.customers, { onCreate: { portalToken: tok() } });
    if (res) custIdByHcp.set(c.id, res.id);
  }

  // ── Jobs → one crm_project + one crm_job each; schedule → appointment ─────
  // HCP has no project layer (brain doc §3), so 1:1 job→project+job is the
  // honest mapping.
  const projIdx = await loadHcpIndex(s.crmProjects);
  const jobIdx = await loadHcpIndex(s.crmJobs);
  const jobNumberMap = new Map<string, { projectId: string; jobId: string }>();

  const JOB_STATUS: Record<string, string> = {
    "needs scheduling": "unscheduled",
    "scheduled": "scheduled",
    "in progress": "in_progress",
    "complete unrated": "complete",
    "complete": "complete",
    "canceled": "cancelled",
    "cancelled": "cancelled",
  };
  // A booked HCP job is sold work ⇒ at least "approved" on the project spine.
  const PROJECT_STATUS: Record<string, string> = {
    "needs scheduling": "approved",
    "scheduled": "scheduled",
    "in progress": "in_progress",
    "complete unrated": "complete",
    "complete": "complete",
    "canceled": "cancelled",
    "cancelled": "cancelled",
  };

  async function replaceAppointments(jobRowId: string, j: any, projectId: string, memberIds: string[], isCreate: boolean) {
    await db.delete(s.crmAppointments).where(and(eq(s.crmAppointments.orgId, ORG_ID), eq(s.crmAppointments.jobId, jobRowId)));
    const sched = j.schedule?.data ?? {};
    if (!sched.start_time) { stats.appointments.skipped++; return; }
    const name = j.description?.trim() || j.name || `Job #${j.invoice_number}`;
    await db.insert(s.crmAppointments).values({
      orgId: ORG_ID,
      projectId,
      jobId: jobRowId,
      customerId: custIdByHcp.get(j.customer_id) ?? null,
      title: name,
      status: JOB_STATUS[String(j.work_status ?? "")] === "complete" ? "complete" : "scheduled",
      startsAt: new Date(sched.start_time),
      endsAt: dt(sched.end_time),
      arrivalWindowMinutes: sched.arrival_window_minutes ?? j.arrival_window_minutes ?? null,
      dispatchedMemberIds: memberIds.length ? memberIds : null,
      completedAt: dt(j.work_status_timestamps?.finish),
    } as any);
    if (isCreate) stats.appointments.created++; else stats.appointments.updated++;
  }

  for (const j of jobs.values()) {
    const hcpId = j.id;
    const customerId = custIdByHcp.get(j.customer_id) ?? null;
    if (!customerId) {
      stats.projects.errors.push({ hcpId, error: `customer ${j.customer_id} not imported` });
      stats.jobs.errors.push({ hcpId, error: `customer ${j.customer_id} not imported` });
      continue;
    }
    const proIds: string[] = (j.pros?.data ?? []).filter((x: any) => typeof x === "string");
    const memberIds = proIds.map((p) => memberIdByProId.get(p)).filter(Boolean) as string[];
    const addr = j.address_id ? addrById.get(j.address_id) : null;
    const name = j.description?.trim() || j.name || `Job #${j.invoice_number}`;
    const ws = String(j.work_status ?? "");
    const sched = j.schedule?.data ?? {};

    const projMapped: Record<string, any> = {
      orgId: ORG_ID,
      customerId,
      number: j.invoice_number != null ? `HCP-${j.invoice_number}` : null,
      name,
      description: j.note ?? null,
      status: PROJECT_STATUS[ws] ?? "approved",
      addressLine1: addr?.street ?? null,
      city: addr?.city ?? null,
      state: addr?.state ?? null,
      postalCode: addr?.zip ?? null,
      contractValueCents: cents(j.total_amount),
      completedAt: JOB_STATUS[ws] === "complete" ? dt(j.work_status_timestamps?.finish) ?? dt(j.updated_at) : null,
      customFields: {
        source: "hcp_job",
        workStatus: ws || null,
        paymentStatus: j.payment_status ?? null,
        jobSource: j.job_source ?? null,
        paid: !!j.paid,
        outstandingBalanceCents: cents(j.outstanding_balance),
        paidAmountCents: cents(j.paid_amount),
        discountCents: cents(j.discount),
        tipAmountCents: cents(j.tip_amount),
        invoiceNumber: j.invoice_number ?? null,
        leadSource: j.lead_source ?? null,
        compositeServiceRequestUuid: j.composite_service_request_uuid ?? null,
        printableAddress: j.printable_address ?? null,
        attachmentsCount: j.attachments_count ?? null,
        isRecurring: !!j.is_recurring,
        locationName: j.location_name ?? null,
        hcpCreatedAt: j.created_at ?? null,
        hcpUpdatedAt: j.updated_at ?? null,
      },
      createdAt: dt(j.created_at) ?? new Date(),
      updatedAt: dt(j.updated_at) ?? new Date(),
    };
    const proj = await upsert(s.crmProjects, projIdx, hcpId, projMapped, stats.projects);
    if (!proj) continue;

    const jobMapped: Record<string, any> = {
      orgId: ORG_ID,
      projectId: proj.id,
      name,
      description: j.note ?? null,
      status: JOB_STATUS[ws] ?? "unscheduled",
      assignedMemberIds: memberIds.length ? memberIds : null,
      scheduledStart: dt(sched.start_time),
      scheduledEnd: dt(sched.end_time),
      startedAt: dt(j.work_status_timestamps?.start),
      completedAt: dt(j.work_status_timestamps?.finish) ?? (JOB_STATUS[ws] === "complete" ? dt(j.updated_at) : null),
      customFields: {
        workStatus: ws || null,
        arrivalWindowMinutes: j.arrival_window_minutes ?? null,
        timeZone: j.time_zone ?? null,
        segmentCount: j.segment_count ?? null,
        primaryProName: j.primary_pro_name ?? null,
        hcpProIds: proIds,
        hcpProNames: proIds.map((p) => people.get(p)?.full_name ?? p),
        invoiceNumber: j.invoice_number ?? null,
        paymentStatus: j.payment_status ?? null,
        hcpCreatedAt: j.created_at ?? null,
        hcpUpdatedAt: j.updated_at ?? null,
      },
      createdAt: dt(j.created_at) ?? new Date(),
      updatedAt: dt(j.updated_at) ?? new Date(),
    };
    const job = await upsert(s.crmJobs, jobIdx, hcpId, jobMapped, stats.jobs,
      { onWrite: async (jobRowId, isCreate) => { await replaceAppointments(jobRowId, j, proj.id, memberIds, isCreate); } });
    if (!job) continue;
    if (!job.wrote) stats.appointments.skipped++;
    if (j.invoice_number != null) jobNumberMap.set(String(j.invoice_number), { projectId: proj.id, jobId: job.id });
  }

  // ── Estimates (+ options + synthetic line items) ──────────────────────────
  const estIdx = await loadHcpIndex(s.crmEstimates);

  const estStatus = (e: any): string => {
    const oss = (e.options ?? []).map((o: any) => String(o.status ?? "").toLowerCase());
    if (e.outcome === "won" || oss.some((x: string) => x === "approved" || x === "pro approved")) return "approved";
    if (e.outcome === "lost") return oss.some((x: string) => x === "declined" || x === "pro declined") ? "declined" : "expired";
    return "sent"; // outcome "open" ⇒ with the customer ("Awaiting Approval")
  };

  async function replaceEstimateChildren(estRowId: string, e: any, opts: any[], items: Line[], isCreate: boolean) {
    await db.delete(s.crmEstimateOptions).where(and(eq(s.crmEstimateOptions.orgId, ORG_ID), eq(s.crmEstimateOptions.estimateId, estRowId)));
    await db.delete(s.crmEstimateItems).where(and(eq(s.crmEstimateItems.orgId, ORG_ID), eq(s.crmEstimateItems.estimateId, estRowId)));
    const bucket = (isCreate ? "created" : "updated") as "created" | "updated";
    if (opts.length) {
      await db.insert(s.crmEstimateOptions).values(opts.map((o, i) => ({
        orgId: ORG_ID,
        estimateId: estRowId,
        name: o.name || `Option ${i + 1}`,
        tier: i + 1,
        description: o.option_description ?? o.description ?? null,
        subtotalCents: cents(o.sub_total) ?? 0,
        totalCents: cents(o.total_amount) ?? 0,
        selectedAt: ["approved", "pro approved"].includes(String(o.status).toLowerCase()) ? dt(e.created_at) : null,
      })) as any);
      stats.estimateOptions[bucket] += opts.length;
    }
    if (items.length) {
      await db.insert(s.crmEstimateItems).values(items.map((it, i) => ({
        orgId: ORG_ID,
        estimateId: estRowId,
        sortOrder: i,
        kind: it.kind,
        name: it.kind === "discount"
          ? "Discount (imported from Housecall Pro)"
          : (e.description || "Scope of work (imported from Housecall Pro — HCP line items were not exported)"),
        quantityMilli: it.quantityMilli,
        unitPriceCents: it.unitPriceCents,
        taxable: it.taxable,
      })) as any);
      stats.estimateItems[bucket] += items.length;
    }
  }

  for (const e of estimates.values()) {
    const hcpId = e.id;
    const customerId = custIdByHcp.get(e.customer_uuid);
    if (!customerId) { stats.estimates.errors.push({ hcpId, error: `customer ${e.customer_uuid} not imported` }); continue; }
    const opts: any[] = e.options ?? [];
    // The option HCP calls the estimate's "value" is the operative one;
    // fall back to an approved option, then the first.
    const matchByValue = opts.find((o) => o.total_amount === e.value);
    const chosen = matchByValue
      ?? opts.find((o) => ["approved", "pro approved"].includes(String(o.status).toLowerCase()))
      ?? opts[0] ?? null;
    if (!matchByValue && chosen) {
      discrepancies.push({ entity: "estimate", hcpId, field: "value", hcp: e.value, recomputed: chosen.total_amount, note: "estimate.value matches no option total; used fallback option" });
    }
    const subTotal = cents(chosen?.sub_total) ?? 0;
    const discountHcp = cents(e.discount) ?? 0;
    const totalHcp = cents(chosen?.total_amount) ?? 0;
    const { items, taxRateBps } = synthItems(subTotal, discountHcp, totalHcp);
    const r = recompute(items, taxRateBps);
    if (r.total !== totalHcp) {
      discrepancies.push({ entity: "estimate", hcpId, field: "totalCents", hcp: totalHcp, recomputed: r.total, note: `subtotal ${subTotal}, hcp discount ${discountHcp}, implied bps ${taxRateBps}; stored recomputed totals per repo rules` });
    }
    const status = estStatus(e);
    const number = String(e.display_invoice_number ?? e.invoice_number ?? "");
    const mapped: Record<string, any> = {
      orgId: ORG_ID,
      customerId,
      projectId: jobNumberMap.get(number)?.projectId ?? null,
      number: number || null,
      title: e.description || chosen?.option_description || `Estimate ${number}`,
      status,
      introText: chosen?.message_from_pro ?? null,
      subtotalCents: r.subtotal,
      discountCents: r.discount,
      taxRateBps,
      taxCents: r.tax,
      totalCents: r.total,
      sentToEmail: e.customer_billable_email ?? null,
      // HCP's export carries no approve/decline timestamps; created_at /
      // completed_at are the only honest anchors (documented in MAPPING.md).
      approvedAt: status === "approved" ? dt(e.completed_at) ?? dt(e.created_at) : null,
      declinedAt: status === "declined" ? dt(e.completed_at) ?? dt(e.created_at) : null,
      customFields: {
        hcpOutcome: e.outcome ?? null,
        hcpValueCents: cents(e.value),
        hcpDiscountCents: discountHcp,
        hcpAddress: e.address ?? null,
        hcpNotes: e.notes ?? null,
        locationName: e.location_name ?? null,
        completedAt: e.completed_at ?? null,
        scheduledDate: e.scheduled_date ?? null,
        chosenOptionId: chosen?.id ?? null,
        taxImpliedBps: taxRateBps || null,
        ...(r.total !== totalHcp ? { hcpTotalCents: totalHcp } : {}),
        hcpOptions: opts.map((o) => ({
          id: o.id, name: o.name, status: o.status, customerStatus: o.customer_estimate_status,
          leadSource: o.lead_source ?? null, employees: o.employees ?? [],
          subTotalCents: cents(o.sub_total), totalCents: cents(o.total_amount),
          scheduledDate: o.scheduled_date ?? null,
        })),
        hcpCreatedAt: e.created_at ?? null,
      },
      createdAt: dt(e.created_at) ?? new Date(),
      updatedAt: dt(e.created_at) ?? new Date(),
    };
    await upsert(s.crmEstimates, estIdx, hcpId, mapped, stats.estimates, {
      onCreate: { publicToken: tok() },
      onWrite: async (estRowId, isCreate) => { await replaceEstimateChildren(estRowId, e, opts, items, isCreate); },
    });
  }

  // ── Invoices (+ synthetic line items + imported payments) ────────────────
  const invIdx = await loadHcpIndex(s.crmInvoices);

  async function replaceInvoiceChildren(invRowId: string, d: any, items: Line[], paidCents: number, total: number, isCreate: boolean) {
    await db.delete(s.crmInvoiceItems).where(and(eq(s.crmInvoiceItems.orgId, ORG_ID), eq(s.crmInvoiceItems.invoiceId, invRowId)));
    const bucket = (isCreate ? "created" : "updated") as "created" | "updated";
    if (items.length) {
      await db.insert(s.crmInvoiceItems).values(items.map((it, i) => ({
        orgId: ORG_ID,
        invoiceId: invRowId,
        sortOrder: i,
        kind: it.kind,
        name: it.kind === "discount"
          ? "Discount (imported from Housecall Pro)"
          : `Invoice #${d.invoice_number} (imported from Housecall Pro — line items were not exported)`,
        quantityMilli: it.quantityMilli,
        unitPriceCents: it.unitPriceCents,
        taxable: it.taxable,
      })) as any);
      stats.invoiceItems[bucket] += items.length;
    }
    // Imported payments are keyed provider='hcp_import' + externalId=HCP
    // invoice id; replace that row on every write.
    await db.delete(s.crmPayments).where(and(eq(s.crmPayments.orgId, ORG_ID), eq(s.crmPayments.invoiceId, invRowId), eq(s.crmPayments.provider, "hcp_import")));
    if (paidCents > 0) {
      await db.insert(s.crmPayments).values({
        orgId: ORG_ID,
        customerId: custIdByHcp.get(d.billable_customer_uuid) ?? custIdByHcp.get(d.service_customer_uuid),
        invoiceId: invRowId,
        projectId: jobNumberMap.get(String(d.external_reference))?.projectId ?? null,
        provider: "hcp_import",
        externalId: d.id,
        purpose: paidCents >= total ? "final" : "progress",
        amountCents: paidCents,
        method: null,
        status: "succeeded",
        note: "Imported from Housecall Pro (payment method not exported)",
        paidAt: dt(d.paid_at) ?? dt(d.invoice_date) ?? new Date(),
      } as any);
      stats.payments[bucket]++;
    } else {
      stats.payments.skipped++;
    }
  }

  for (const d of invoices.values()) {
    const hcpId = d.id;
    const customerId = custIdByHcp.get(d.billable_customer_uuid) ?? custIdByHcp.get(d.service_customer_uuid);
    if (!customerId) { stats.invoices.errors.push({ hcpId, error: `customer ${d.billable_customer_uuid} not imported` }); continue; }
    const subTotal = cents(d.subtotal) ?? 0;
    const totalHcp = cents(d.total) ?? 0;
    const dueAmount = cents(d.due_amount) ?? 0;
    const { items, taxRateBps } = synthItems(subTotal, 0, totalHcp);
    const r = recompute(items, taxRateBps);
    if (r.total !== totalHcp) {
      discrepancies.push({ entity: "invoice", hcpId, field: "totalCents", hcp: totalHcp, recomputed: r.total, note: `subtotal ${subTotal}, implied bps ${taxRateBps}; stored recomputed totals per repo rules` });
    }
    const paidCents = Math.max(0, totalHcp - dueAmount);
    const hs = String(d.status ?? "").toLowerCase();
    const status =
      hs === "paid" ? "paid"
      : hs === "voided" || hs === "canceled" ? "void"
      : paidCents > 0 ? "partial"
      : "sent"; // open / pending_payment with nothing collected yet
    const number = String(d.invoice_number ?? "");
    const mapped: Record<string, any> = {
      orgId: ORG_ID,
      customerId,
      projectId: jobNumberMap.get(String(d.external_reference))?.projectId ?? null,
      estimateId: null,
      number: number || null,
      title: `Invoice #${number}`,
      status,
      subtotalCents: r.subtotal,
      discountCents: r.discount,
      taxRateBps,
      taxCents: r.tax,
      totalCents: r.total,
      paidCents,
      dueAt: dt(d.due_at),
      sentAt: dt(d.last_communication_sent_at),
      sentToEmail: d.contact_email ?? null,
      paidAt: paidCents > 0 ? dt(d.paid_at) : null,
      customFields: {
        hcpStatus: d.status ?? null,
        hcpAmountCents: cents(d.amount),
        hcpSubtotalCents: subTotal,
        hcpTotalCents: totalHcp,
        hcpDueAmountCents: dueAmount,
        dueConcept: d.due_concept ? `${d.due_concept} ${d.due_concept_value ?? ""}`.trim() : null,
        fundingStatus: d.funding_status ?? null,
        externalReference: d.external_reference ? { name: d.external_reference_name, value: d.external_reference } : null,
        serviceDate: d.service_date ?? null,
        billingAddress: d.billing_address ?? null,
        serviceAddress: d.service_address ?? null,
        lastCommunication: d.last_communication_sent_at ? { at: d.last_communication_sent_at, method: d.last_communication_send_method } : null,
        template: d.template ?? null,
        taxImpliedBps: taxRateBps || null,
        hcpCreatedAt: d.invoice_date ?? null,
      },
      createdAt: dt(d.invoice_date) ?? new Date(),
      updatedAt: dt(d.invoice_date) ?? new Date(),
    };
    await upsert(s.crmInvoices, invIdx, hcpId, mapped, stats.invoices, {
      onCreate: { publicToken: tok() },
      onWrite: async (invRowId, isCreate) => { await replaceInvoiceChildren(invRowId, d, items, paidCents, r.total, isCreate); },
    });
  }

  // ── Org reference data (hcpTeam + hcpLeadSources) ─────────────────────────
  {
    const current = (org.customFields as any) ?? {};
    const next = {
      ...current,
      hcpTeam,
      hcpLeadSources: leadSources.map((l) => ({
        hcpId: l.uuid, name: l.name, isSystem: !!l.is_system,
        discardedAt: l.discarded_at ?? null, hidden: !!l.hidden,
      })),
      hcpImport: { source: "housecallpro", exportGeneratedAt: manifest.generated_at ?? null, account: manifest.account ?? null },
    };
    if (stable(current) !== stable(next)) {
      await db.update(s.crmOrgs).set({ customFields: next as any, updatedAt: new Date() }).where(eq(s.crmOrgs.id, ORG_ID));
      console.log("org customFields updated (hcpTeam, hcpLeadSources)");
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n── import summary ─────────────────────────────");
  for (const [k, st] of Object.entries(stats)) {
    console.log(`${k.padEnd(16)} created ${String(st.created).padStart(4)}  updated ${String(st.updated).padStart(4)}  skipped ${String(st.skipped).padStart(4)}  errors ${st.errors.length}`);
  }
  console.log(`discrepancies: ${discrepancies.length} (HCP figures repo-rule recomputation could not reproduce)`);
  const summary = {
    runAt: new Date().toISOString(),
    orgId: ORG_ID,
    exportDir: EXPORT_DIR,
    stats,
    discrepancies,
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(`summary written to ${SUMMARY_PATH}`);
}

main()
  .catch((e) => { console.error("IMPORT FAILED:", e); process.exitCode = 1; })
  .finally(() => pool.end());
