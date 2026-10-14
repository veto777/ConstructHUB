/**
 * The research bot: turns a paid research order into a report with no one at the keyboard.
 *
 *   1. State contractor-license records (./licenses) for every name in every state that publishes them.
 *   2. Every live-searchable permit portal in the chosen states (the same portals and adapters as the Search page,
 *      server/scraper.ts startLiveSearch), by name for a person and by company for a business, falling back to the
 *      other where a portal offers only one; a slow portal is retried, one missing that field gets its next search type.
 *      Matches are read back from the stored results, so each one links to its source record.
 *   3. For companies: state AG consumer complaints, federal court dockets and federal OSHA inspections (./records).
 *   4. Trades flag matching permits (listed first); a since-year drops older permits (undated ones are kept, marked).
 *
 * Every portal is reported with what happened (searched, not searched, error), so the report says what was covered
 * and never turns "we could not search it" into "nothing found". One order runs at a time; a restart re-queues it.
 */
import { storage } from "../storage";
import { db } from "../db";
import { searchQueries, type PermitDatabase } from "@shared/schema";
import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { startLiveSearch, getLiveSearchJob } from "../scraper";
import { getAdapterFor, isLegacyAdapter } from "../scrapers/registry";
import { sendWithFallback } from "../email";
import { escapeHtml } from "../route-guards";
import {
  RESEARCH_TRADES, RESEARCH_PATH, RESEARCH_NO_GUARANTEE,
  type ResearchOrderInput, type ResearchReport, type ResearchSubjectReport, type PermitHit, type PortalCoverage,
  type ResearchPreview, type ResearchTrade, type LicenseHit,
} from "@shared/research-reports";
import { SITE_ORIGIN as SITE } from "@shared/seo";
import { licenseSourcesFor, searchLicenses } from "./licenses";
import { previewCompanyRecords, searchCompanyRecords } from "./records";
import { claimNext, failOrder, finishOrder, requeueInterrupted, type ResearchOrderRow } from "./store";

const MAX_PERMITS_PER_SUBJECT = 1000;
const POLL_MS = 5_000;
/** A whole state sweep for one name must end: past this, unfinished portals are reported as not searched. */
const SWEEP_BUDGET_MS = 90 * 60_000;

type Db = PermitDatabase;

/** Live-searchable portals in the given states, grouped by state. */
export async function portalsInStates(states: string[]): Promise<Map<string, Db[]>> {
  const counties = await storage.getCounties();
  const stateOf = new Map(counties.map((c) => [c.id, c.stateCode]));
  const out = new Map<string, Db[]>(states.map((s) => [s, []]));
  for (const d of await storage.getDatabases()) {
    const st = stateOf.get(d.countyId);
    if (!st || !out.has(st) || !d.isActive) continue;
    if (governmentLinksAvailable(d) && canScrapeGovernmentPortal(d)) out.get(st)!.push(d);
  }
  return out;
}

/** The free preview shown before payment: license matches now, and the portal count the report will sweep. */
export async function buildPreview(input: Pick<ResearchOrderInput, "subjects" | "states">): Promise<ResearchPreview> {
  let licenseMatches = 0;
  const licenseSourceStates: string[] = [];
  for (const state of input.states) {
    const sources = licenseSourcesFor(state);
    if (sources.length) licenseSourceStates.push(state);
    for (const src of sources) for (const s of input.subjects) {
      try { licenseMatches += (await searchLicenses(src, s.name, s.kind)).length; } catch { /* the preview is a hint, not the report */ }
    }
  }
  const portals = await portalsInStates(input.states);
  let records: ResearchPreview["records"];
  for (const s of input.subjects.filter((x) => x.kind === "company")) {
    const r = await previewCompanyRecords(s.name, input.states);
    records = records
      ? { complaints: records.complaints + r.complaints, courtCases: records.courtCases + r.courtCases, osha: records.osha + r.osha, searched: Array.from(new Set([...records.searched, ...r.searched])) }
      : r;
  }
  return { licenseMatches, licenseSourceStates, portalsByState: Object.fromEntries(Array.from(portals, ([s, l]) => [s, l.length])), ...(records ? { records } : {}) };
}

function tradesFor(text: string, trades: ResearchTrade[]): string[] {
  const t = ` ${text.toLowerCase()} `;
  return trades.filter((k) => RESEARCH_TRADES[k].words.some((w) => t.includes(w))).map((k) => RESEARCH_TRADES[k].label);
}

const yearOf = (d: string | null): number | null => {
  const m = d?.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
};

/** The search types a portal can run for this subject, best first (empty: it has no name, company or keyword search). */
function searchTypesFor(d: Db, kind: "person" | "company"): string[] {
  const adapter = getAdapterFor({ platform: d.platform, jurisdiction: d.jurisdiction });
  // Legacy adapters (server/scraper.ts) take any type; they are routed by platform there.
  if (!adapter || isLegacyAdapter(adapter)) return [kind === "company" ? "company" : "name"];
  const supported = adapter.capabilities.search as string[];
  const order = kind === "company" ? ["company", "name", "keyword"] : ["name", "company", "keyword"];
  return order.filter((t) => supported.includes(t));
}

/** A failure worth one more try: the portal was slow (same search again) or lacks that search field (the next type). */
export function retryPlan(message: string): "same" | "next" | null {
  if (/aborted|timed out|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(message)) return "same";
  if (/field unavailable|does not expose|requested search field/i.test(message)) return "next";
  return null;
}

/** One live search of a set of portals with one search type, read back as coverage per portal. */
async function runSweep(userId: number, name: string, type: string, group: Db[], log: (m: string) => void): Promise<Map<number, PortalCoverage>> {
  const [query] = await db.insert(searchQueries).values({ userId, searchType: type, searchValue: name, countyId: null }).returning();
  const searchId = `research-${query.id}-${Date.now()}`;
  log(`sweeping ${group.length} portal(s) by ${type} for "${name}"`);
  await startLiveSearch(searchId, query.id, type, name, group.map((d) => ({
    id: d.id, name: d.name, jurisdiction: d.jurisdiction, countyId: d.countyId, platform: d.platform,
    searchUrl: d.searchUrl, portalUrl: d.portalUrl, isActive: d.isActive,
  })));
  const started = Date.now();
  let job = getLiveSearchJob(searchId);
  while (job && job.status === "running" && Date.now() - started < SWEEP_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    job = getLiveSearchJob(searchId) ?? job;
  }
  const out = new Map<number, PortalCoverage>();
  for (const e of job?.databases ?? []) {
    const outcome = e.status === "completed" ? "searched" : e.status === "error" ? "error" : "not_searched";
    out.set(e.id, { jurisdiction: e.jurisdiction ?? e.name, outcome, found: e.resultsFound, message: outcome === "not_searched" ? "Did not finish in time" : e.message });
  }
  // startLiveSearch leaves out portals it cannot scrape; say so rather than drop them.
  for (const d of group) if (!out.has(d.id)) out.set(d.id, { jurisdiction: d.jurisdiction, outcome: "not_searched", message: "Portal unavailable for live search today", found: 0 });
  return out;
}

const SWEEP_ROUNDS = 4;

/**
 * Every portal, best search type first. A portal that timed out is tried once more; one that lacks the field gets
 * its next search type (a SmartGov tenant without a contractor field still has keyword search). Coverage keeps the
 * last attempt for each portal; matches are read back for every type that ran.
 */
async function sweepPortals(userId: number, name: string, kind: "person" | "company", dbs: Db[], log: (m: string) => void): Promise<{ coverage: PortalCoverage[]; rows: any[] }> {
  type Pending = { d: Db; types: string[]; i: number; retriedSame: boolean };
  const final = new Map<number, PortalCoverage>();
  const ran: { type: string; ids: number[] }[] = [];
  let pending: Pending[] = [];
  for (const d of dbs) {
    const types = searchTypesFor(d, kind);
    if (!types.length) final.set(d.id, { jurisdiction: d.jurisdiction, outcome: "not_searched", message: "This portal has no name or company search", found: 0 });
    else pending.push({ d, types, i: 0, retriedSame: false });
  }
  for (let round = 0; round < SWEEP_ROUNDS && pending.length; round++) {
    const byType = new Map<string, Pending[]>();
    for (const p of pending) byType.set(p.types[p.i], [...(byType.get(p.types[p.i]) ?? []), p]);
    const next: Pending[] = [];
    for (const [type, group] of Array.from(byType)) {
      const result = await runSweep(userId, name, type, group.map((p) => p.d), log);
      ran.push({ type, ids: group.map((p) => p.d.id) });
      for (const p of group) {
        const c = result.get(p.d.id)!;
        final.set(p.d.id, round > 0 && c.outcome === "searched" ? { ...c, message: `${c.message} (by ${type}, on retry)` } : c);
        if (c.outcome === "searched") continue;
        const plan = retryPlan(c.message);
        if (plan === "same" && !p.retriedSame) next.push({ ...p, retriedSame: true });
        else if (plan === "next" && p.i + 1 < p.types.length) next.push({ ...p, i: p.i + 1 });
      }
    }
    if (next.length) log(`retrying ${next.length} portal(s)`);
    pending = next;
  }
  const rows: any[] = [];
  for (const r of ran) {
    const page = await storage.searchLocalResults(r.type, name, { databaseIds: r.ids, limit: MAX_PERMITS_PER_SUBJECT });
    rows.push(...page.results);
  }
  return { coverage: Array.from(final.values()), rows };
}

/** True when every word of the name is a whole word of one of the record's name fields (a portal's fuzzy match is not proof). */
function namesMatch(name: string, row: any): boolean {
  const tok = (v: string) => v.toLowerCase().split(/[^a-z0-9&']+/).filter((w) => w.length >= 2);
  const want = tok(name);
  const contacts = Array.isArray(row.contacts) ? row.contacts.map((c: any) => [c?.name, c?.company].filter(Boolean).join(" ")) : [];
  const record = row.rawData?.record ?? {};
  const listed = listedNamesOf(row);
  // Rows saved before a parser learned a field still carry the result's own HTML; its text counts too.
  const html = typeof row.rawData?.raw?.html === "string" ? row.rawData.raw.html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&") : "";
  const fields = [row.contractorName, row.applicantName, record.ownerName, record.applicantName, record.contractorName, ...contacts, ...listed, row.description, html]
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  return fields.some((f) => { const have = new Set(tok(f)); return want.every((w) => have.has(w)); });
}

/** Names a results list shows without saying their role (SmartGov's party column). */
function listedNamesOf(row: any): string[] {
  const v = row.rawData?.raw?.listedNames;
  return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === "string" && x.length > 0) : [];
}

function toPermitHit(row: any, trades: ResearchTrade[]): PermitHit {
  const sourceUrl = (row.rawData?.detailUrl as string | undefined) ?? (row.rawData?.record?.sourceUrl as string | undefined) ?? null;
  const text = [row.permitType, row.description].filter(Boolean).join(" ");
  return {
    jurisdiction: row.jurisdiction ?? row.databaseName ?? "", permitNumber: row.permitNumber ?? null, permitType: row.permitType ?? null,
    status: row.status ?? null, address: row.address ?? null, issuedDate: row.issuedDate ?? null,
    contractorName: row.contractorName ?? null, applicantName: row.applicantName ?? null,
    description: row.description ? String(row.description).slice(0, 500)
      : listedNamesOf(row).length ? `Names listed on the permit: ${listedNamesOf(row).join(" / ")}`.slice(0, 500) : null,
    sourceUrl: sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl : null,
    tradeMatch: trades.length ? tradesFor(text, trades) : [], undated: !yearOf(row.issuedDate ?? null),
  };
}

export async function runResearch(order: Pick<ResearchOrderRow, "id" | "user_id" | "input">, log = (m: string) => console.log(`[research] order ${order.id}: ${m}`)): Promise<ResearchReport> {
  const input = order.input;
  const portals = await portalsInStates(input.states);
  const subjects: ResearchSubjectReport[] = [];
  for (const subject of input.subjects) {
    const licenses: LicenseHit[] = [];
    const licenseSources: ResearchSubjectReport["licenseSources"] = [];
    for (const state of input.states) {
      const sources = licenseSourcesFor(state);
      if (!sources.length) licenseSources.push({ state, source: "State license records", searched: false, note: "We don't search this state's license records yet" });
      for (const src of sources) {
        try {
          const hits = await searchLicenses(src, subject.name, subject.kind);
          licenses.push(...hits);
          licenseSources.push({ state, source: src.source, searched: true, note: `${hits.length} match(es)` });
        } catch (err: any) {
          licenseSources.push({ state, source: src.source, searched: false, note: `Could not search: ${String(err?.message ?? err).slice(0, 200)}` });
        }
      }
    }
    const dbs = input.states.flatMap((s) => portals.get(s) ?? []);
    const { coverage, rows } = await sweepPortals(order.user_id, subject.name, subject.kind, dbs, log);
    const dedup = new Map<string, PermitHit>();
    for (const row of rows) {
      if (!namesMatch(subject.name, row)) continue;
      const hit = toPermitHit(row, input.trades);
      const y = yearOf(hit.issuedDate);
      if (input.sinceYear && y && y < input.sinceYear) continue;
      dedup.set(`${hit.jurisdiction}|${hit.permitNumber ?? row.id}`, hit);
    }
    const permits = Array.from(dedup.values()).sort((a, b) =>
      (b.tradeMatch.length > 0 ? 1 : 0) - (a.tradeMatch.length > 0 ? 1 : 0) || String(b.issuedDate ?? "").localeCompare(String(a.issuedDate ?? "")));
    const records = subject.kind === "company"
      ? await searchCompanyRecords(subject.name, input.states)
      : { complaints: [], courtCases: [], osha: [], sources: [{ source: "Complaints, lawsuits and OSHA records", scope: "", searched: false, note: "Searched for companies only, not for individual people" }] };
    log(`records for "${subject.name}": ${records.complaints.length} complaint(s), ${records.courtCases.length} federal case(s), ${records.osha.length} OSHA inspection(s)`);
    subjects.push({
      name: subject.name, kind: subject.kind, licenses, permits, licenseSources, portals: coverage.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction)),
      complaints: records.complaints, courtCases: records.courtCases, osha: records.osha, recordSources: records.sources,
    });
  }
  const allCoverage = subjects.flatMap((s) => s.portals);
  return {
    generatedAt: new Date().toISOString(), states: input.states,
    trades: input.trades.map((t) => RESEARCH_TRADES[t].label), sinceYear: input.sinceYear ?? null, subjects,
    totals: {
      licenses: subjects.reduce((n, s) => n + s.licenses.length, 0),
      permits: subjects.reduce((n, s) => n + s.permits.length, 0),
      portalsSearched: allCoverage.filter((c) => c.outcome === "searched").length,
      portalsNotSearched: allCoverage.filter((c) => c.outcome !== "searched").length,
      complaints: subjects.reduce((n, s) => n + (s.complaints?.length ?? 0), 0),
      courtCases: subjects.reduce((n, s) => n + (s.courtCases?.length ?? 0), 0),
      osha: subjects.reduce((n, s) => n + (s.osha?.length ?? 0), 0),
    },
  };
}

async function sendReportEmails(order: ResearchOrderRow, report: ResearchReport) {
  const link = `${SITE}${RESEARCH_PATH}/orders/${order.id}`;
  const names = order.input.subjects.map((s) => s.name).join(", ");
  const t = report.totals;
  const records = t.complaints || t.courtCases || t.osha ? `, ${t.complaints ?? 0} consumer complaint(s), ${t.courtCases ?? 0} federal court case(s) and ${t.osha ?? 0} OSHA inspection(s)` : "";
  const summary = `${t.licenses} license record(s) and ${t.permits} permit(s) across ${t.portalsSearched} searched portal(s)${records}`;
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to: order.email,
    subject: `Your ConstructHUB research report is ready (#${order.id})`,
    html: `<p>Your research report for <strong>${escapeHtml(names)}</strong> is ready: ${escapeHtml(summary)}.</p>
      <p><a href="${link}">Open your report</a> (sign in to ConstructHUB to view it; you can print it or save it as a PDF).</p>
      <p style="color:#666;font-size:12px">${escapeHtml(RESEARCH_NO_GUARANTEE)}</p>`,
  }).catch((err: unknown) => console.error(`[research] order ${order.id}: customer email failed`, err));
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to: process.env.SMTP_EMAIL,
    subject: `Research report delivered #${order.id} (${order.tier})`,
    html: `<p>Delivered to ${escapeHtml(order.email)}: ${escapeHtml(names)} in ${escapeHtml(order.input.states.join(", "))}. ${escapeHtml(summary)}.</p><p><a href="${link}">View</a></p>`,
  }).catch(() => undefined);
}

let running = false;
/** Work the queue until it is empty. Safe to call often (after a payment, at boot, on a timer). */
export async function drainResearchQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let order = await claimNext(); order; order = await claimNext()) {
      try {
        const report = await runResearch(order);
        await finishOrder(order.id, report);
        console.log(`[research] order ${order.id}: complete (${report.totals.licenses} licenses, ${report.totals.permits} permits)`);
        await sendReportEmails(order, report);
      } catch (err: any) {
        console.error(`[research] order ${order.id} failed:`, err);
        await failOrder(order.id, String(err?.message ?? err));
        await sendWithFallback({
          from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`, to: process.env.SMTP_EMAIL,
          subject: `Research report FAILED #${order.id}: retry from Admin`,
          html: `<p>${escapeHtml(String(err?.message ?? err))}</p>`,
        }).catch(() => undefined);
      }
    }
  } finally {
    running = false;
  }
}

export function startResearchWorker(): void {
  if (process.env.RESEARCH_WORKER === "off") return;
  setTimeout(() => {
    requeueInterrupted()
      .then((n) => { if (n) console.log(`[research] re-queued ${n} interrupted order(s)`); })
      .then(() => drainResearchQueue())
      .catch((err) => console.error("[research] worker start failed:", err));
  }, 20_000).unref?.();
  setInterval(() => { void drainResearchQueue().catch((err) => console.error("[research] queue:", err)); }, 5 * 60_000).unref?.();
}
