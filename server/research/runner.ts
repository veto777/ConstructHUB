/**
 * The research bot: turns a paid research order into a report with no one at the keyboard.
 *
 *   1. State contractor-license records (./licenses) for every name in every state that publishes them.
 *   2. Every live-searchable permit portal in the chosen states (the same portals and adapters as the Search page,
 *      server/scraper.ts startLiveSearch), by name for a person and by company for a business, falling back to the
 *      other where a portal offers only one; a slow portal is retried, one missing that field gets its next search type.
 *      Matches are read back from the stored results, so each one links to its source record.
 *   3. For companies: state AG consumer complaints, federal court dockets and federal OSHA inspections (./records).
 *   4. Search by anything and cross-reference (./xref): every license source is searched by the license numbers,
 *      phones and addresses the customer gave, then one hop out from the subject's own records (their license
 *      numbers, phones, addresses, people and businesses) to the related licenses and businesses, each marked with
 *      its tie, plus state enforcement records for the most closely tied businesses.
 *   5. Trades flag matching permits (listed first); a since-year drops older permits (undated ones are kept, marked).
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
  RESEARCH_TRADES, RESEARCH_PATH, RESEARCH_NO_GUARANTEE, reportSummary,
  type ResearchOrderInput, type ResearchReport, type ResearchSubjectReport, type PermitHit, type PortalCoverage,
  type ResearchPreview, type ResearchTrade, type LicenseHit, type EnforcementHit,
} from "@shared/research-reports";
import { SITE_ORIGIN as SITE } from "@shared/seo";
import { nameSearchable, searchLicenses, searchLicensesBy, type LicenseSource } from "./licenses";
import { BULK_ID_LIMIT, BULK_LIMIT, refreshDueSources, searchBulk, searchBulkBy, sourceStatus, purgeLegacyKeys, dropRetiredSources, type BulkSource, type StoredHit } from "./bulk";
import { SAM_SOURCE_ID } from "./sam";
import { setKnowledgeFact } from "../hub/knowledge";
import type { LiveLicenseSearch } from "./states/types";
import { crossReference, enforcementKey, LicenseSet, nameMatches, searchCustomerIds, subjectIds, type FinderResult, type LicenseFinder } from "./xref";
import { companyNamed, onePersonField, personMatches } from "./licenses";
import { ALL_BULK_SOURCES, nationwideBulkSources, allBulkSourcesFor as bulkSourcesFor, allLicenseSourcesFor as licenseSourcesFor, hasLicenseSources, liveLicenseSearchesFor, noStatewideGcLicense } from "./registry";
import { capNote, failureNote, noteOf } from "./notes";
import { disciplineRecord, privateHit, reportHit } from "./privacy";
import { guard, guardBrowser, noteResponse, politeFetch, refuseChallengeBody, releaseHost, withRun, type Turn } from "./http";
import { researchTransport, type ResearchTransport } from "../scrapers/research-transport";
import type { IdQuery } from "./identifiers";
import { previewCompanyRecords, searchCompanyRecords, searchEnforcement } from "./records";
import { claimNext, failOrder, finishOrder, requeueInterrupted, type ResearchOrderRow } from "./store";
import { registerWorker, workerInterval } from "../workers";
import { logError } from "../ops/log";

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

/** The free preview shown before payment: license matches (by name and by identifier) and the portal count. */
export async function buildPreview(input: Pick<ResearchOrderInput, "subjects" | "states">): Promise<ResearchPreview> {
  let licenseMatches = 0, identifierMatches = 0;
  const licenseSourceStates = input.states.filter(hasLicenseSources);
  // Where a license search really ran (round 5, decision 10): a source that throws or isn't available doesn't count.
  const searchedStates = new Set<string>();
  for (const s of input.subjects) {
    const finders = [...input.states.flatMap((st) => findersFor(st)), ...nationwideFinders()];
    const found = new LicenseSet();
    for (const f of finders) {
      if (!f.byName || f.companiesOnly) continue;
      try {
        const r = await f.byName(s.name, s.kind);
        for (const h of r.hits) found.add(h);
        if (r.searched) searchedStates.add(f.state);
      } catch { /* the preview is a hint, not the report */ }
    }
    const before = found.list.length;
    const ids = await searchCustomerIds(finders, subjectIds(s), s).catch(() => null);
    for (const h of ids?.licenses ?? []) found.add(h);
    licenseMatches += found.list.length;
    // Records the customer's identifiers found under the subject's name, plus those under another name (shown as matched by the identifier).
    identifierMatches += found.list.length - before + (ids?.matched.length ?? 0);
  }
  const portals = await portalsInStates(input.states);
  let records: ResearchPreview["records"];
  for (const s of input.subjects.filter((x) => x.kind === "company")) {
    const r = await previewCompanyRecords(s.name, input.states);
    records = records
      ? { complaints: records.complaints + r.complaints, courtCases: records.courtCases + r.courtCases, osha: records.osha + r.osha, enforcement: (records.enforcement ?? 0) + (r.enforcement ?? 0), searched: Array.from(new Set([...records.searched, ...r.searched])),
          ran: { complaints: !!(records.ran?.complaints || r.ran?.complaints), courtCases: !!(records.ran?.courtCases || r.ran?.courtCases), osha: !!(records.ran?.osha || r.ran?.osha), enforcement: !!(records.ran?.enforcement || r.ran?.enforcement) } }
      : r;
  }
  return { licenseMatches, identifierMatches, licenseSourceStates, licenseSearchedStates: input.states.filter((st) => searchedStates.has(st)), portalsByState: Object.fromEntries(Array.from(portals, ([s, l]) => [s, l.length])), ...(records ? { records } : {}) };
}

const stored = (hits: StoredHit[]): FinderResult => ({
  licenses: hits.filter((h): h is { kind: "license"; hit: LicenseHit } => h.kind === "license").map((h) => h.hit),
  enforcement: hits.filter((h): h is { kind: "enforcement"; hit: EnforcementHit } => h.kind === "enforcement").map((h) => h.hit),
});

/** "3 match(es)", plus the source's own note when it stopped at a cap ("showing the first 10 of 34 matches"). */
const matchNote = (n: number, capped: string | null, suffix = "") => `${n} match(es)${suffix}${capped ? ` (${capped})` : ""}`;
const idName = (q: IdQuery) => (q.type === "license" ? "license number" : q.type);

/** An indexed state file. License files are searched by name (re-checked: the index can join words of two people) and identifier; enforcement files by identifier. */
export function bulkFinder(src: BulkSource): LicenseFinder {
  return {
    state: src.state, label: src.label, companiesOnly: !!src.companiesOnly,
    byName: src.companiesOnly ? undefined : async (name, kind) => {
      const { hits, status } = await searchBulk(src, name, kind);
      if (!status.loaded) return { hits: [], searched: false, note: "Not loaded yet (the state's file is downloaded daily)" };
      const found = stored(hits).licenses.map((h) => privateHit({ ...h, matchedOn: kind === "company" ? "business" as const : "principal" as const })).filter((h) => nameMatches(name, kind, h));
      const capped = hits.length >= BULK_LIMIT ? capNote(BULK_LIMIT, null, "index matches") : null;
      return { hits: found, searched: true, capped, note: matchNote(found.length, capped, ` in the file of ${status.loadedAt?.slice(0, 10)}`) };
    },
    byId: async (q) => {
      const { hits, status, note, stale } = await searchBulkBy(src, q);
      // Not loaded yet: not searched (decision 8), never "0 found".
      if (!status.loaded) return { licenses: [], enforcement: [], searched: false, note: "not loaded yet; the state's file is downloaded daily" };
      // Loaded under the old key format: its phone and address keys may be an individual's (round 2, decision 2).
      if (stale) return { licenses: [], enforcement: [], searched: false, note: `being re-indexed; not searched by ${idName(q)} until the next load` };
      const r = stored(hits);
      return { ...r, licenses: r.licenses.map(privateHit), note };
    },
  };
}

/** A Socrata license dataset. */
export function sodaFinder(src: LicenseSource): LicenseFinder {
  return {
    state: src.state, label: src.source,
    byName: async (name, kind) => {
      // A dataset with no field for this kind of name is not searched (round 3, decision 9): no request, no "0 found".
      if (!nameSearchable(src, kind)) return { hits: [], searched: false, note: `Not searched: this dataset has no ${kind === "company" ? "business" : "person"} name field` };
      const hits = await searchLicenses(src, name, kind);
      return { hits: hits.map(privateHit), searched: true, capped: noteOf(hits), note: matchNote(hits.length, noteOf(hits)) };
    },
    byId: async (q) => {
      const hits = await searchLicensesBy(src, q);
      return hits ? { licenses: hits.map(privateHit), enforcement: [], note: noteOf(hits) ?? undefined } : { licenses: [], enforcement: [], searched: false, note: `this dataset has no ${idName(q)} field` };
    },
  };
}

/** A state's own lookup (a pack's live search). */
export function liveFinder(state: string, src: LiveLicenseSearch): LicenseFinder {
  return {
    state, label: src.source,
    byName: async (name, kind) => {
      // A lookup that can't search this kind of name (an individual-only roster asked for a company) did not search.
      if (src.kinds && !src.kinds.includes(kind)) return { hits: [], searched: false, note: `Not searched: this lookup has no ${kind === "company" ? "business" : "person"} name search` };
      const raw = await src.search(name, kind);
      const hits = raw.filter((h) => nameMatches(name, kind, h)).map(privateHit);
      return { hits, searched: true, capped: noteOf(raw), note: matchNote(hits.length, noteOf(raw)) };
    },
    byId: src.searchBy ? async (q) => {
      const hits = await src.searchBy!(q);
      return hits ? { licenses: hits.map(privateHit), enforcement: [], note: noteOf(hits) ?? undefined } : { licenses: [], enforcement: [], searched: false, note: `this lookup can't search by ${idName(q)}` };
    } : undefined,
  };
}

/** The enforcement files that cover every state (SAM.gov exclusions), searched by identifier for a company. */
export const nationwideFinders = (): LicenseFinder[] => nationwideBulkSources().map(bulkFinder);

/** Every searchable source in one state, in the order the report lists them. */
export function findersFor(state: string): LicenseFinder[] {
  return [
    ...bulkSourcesFor(state).filter((s) => !s.companiesOnly).map(bulkFinder),
    ...licenseSourcesFor(state).map(sodaFinder),
    ...liveLicenseSearchesFor(state).map((s) => liveFinder(state, s)),
    ...bulkSourcesFor(state).filter((s) => s.companiesOnly).map(bulkFinder),
  ];
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
  // "fetch failed" is a dropped connection; BS&A's "Object reference not set" is its own server fault (it hit most
  // FL tenants for two minutes on 2026-10-15 and passed on the next try).
  if (/aborted|timed out|timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed|Object reference not set to an instance/i.test(message)) return "same";
  if (/field unavailable|does not expose|requested search field/i.test(message)) return "next";
  return null;
}

/**
 * The portal itself offers no public name, company or keyword search: the tenant hides the field (SmartGov
 * tenants that publish no contact names, eTRAKiT tenants without a contractor/keyword box, a Click2Gov site with
 * only permit/address/parcel forms) or publishes no searchable records at all (GovWell with no public dashboard).
 * Reported like a platform without name search, not as a failure, once every search type has been tried.
 */
export function lacksNameSearch(message: string): boolean {
  return /field unavailable|does not expose|requested search field|(?:company|name|keyword) search form unavailable|has no published public record dashboards/i.test(message);
}

/**
 * The transport a research permit search runs under (round 3, decision 5): the adapters' politeFetch, their browser
 * contexts and the scraper's own API requests all pass the research guard (robots.txt, the shared host block and
 * cooldown, the per-host queue). The Search page and the permit sweeps are unchanged.
 */
const PERMIT_TRANSPORT: ResearchTransport = {
  fetch: (url, init, opts) => politeFetch(url, init, opts),
  guardContext: async (context) => { await guardBrowser(context as Parameters<typeof guardBrowser>[0]); },
  before: (url, holdMs) => guard(url, 1000, holdMs),
  // The request's own turn is released (round 4, finding 12): a late answer never ends another request's turn.
  after: (url, status, retryAfter, turn) => { releaseHost(url, turn as Turn); noteResponse(url, status, retryAfter); },
  // A 2xx challenge page on an EnerGov API post blocks the host that answered (round 5, decision 6).
  checkBody: refuseChallengeBody,
};

/** A portal refused by robots.txt or an access denial reads as that, not as a failed search. */
export function deniedMessage(message: string | undefined): string | null {
  if (!message) return null;
  if (/robots\.txt/i.test(message)) return "Not searched: the portal's robots.txt does not allow automated searches";
  if (/denied access earlier|ERR_BLOCKED_BY_CLIENT|HTTP 40[13]\b|asked us to wait/i.test(message)) return "Not searched: the portal refused automated access";
  return null;
}

/** One live search of a set of portals with one search type, read back as coverage per portal. */
async function runSweep(userId: number, name: string, type: string, group: Db[], log: (m: string) => void): Promise<Map<number, PortalCoverage>> {
  const [query] = await db.insert(searchQueries).values({ userId, searchType: type, searchValue: name, countyId: null }).returning();
  const searchId = `research-${query.id}-${Date.now()}`;
  log(`sweeping ${group.length} portal(s) by ${type} for "${name}"`);
  await researchTransport.run(PERMIT_TRANSPORT, () => startLiveSearch(searchId, query.id, type, name, group.map((d) => ({
    id: d.id, name: d.name, jurisdiction: d.jurisdiction, countyId: d.countyId, platform: d.platform,
    searchUrl: d.searchUrl, portalUrl: d.portalUrl, isActive: d.isActive,
  }))));
  const started = Date.now();
  let job = getLiveSearchJob(searchId);
  while (job && job.status === "running" && Date.now() - started < SWEEP_BUDGET_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    job = getLiveSearchJob(searchId) ?? job;
  }
  const out = new Map<number, PortalCoverage>();
  for (const e of job?.databases ?? []) {
    const outcome = e.status === "completed" ? "searched" : e.status === "error" ? "error" : "not_searched";
    const denied = outcome === "error" ? deniedMessage(e.message) : null;
    out.set(e.id, denied ? { jurisdiction: e.jurisdiction ?? e.name, outcome: "not_searched", found: 0, message: denied }
      : { jurisdiction: e.jurisdiction ?? e.name, outcome, found: e.resultsFound, message: outcome === "not_searched" ? "Did not finish in time" : e.message });
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
export async function sweepPortals(userId: number, name: string, kind: "person" | "company", dbs: Db[], log: (m: string) => void): Promise<{ coverage: PortalCoverage[]; rows: any[] }> {
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
        else if (lacksNameSearch(c.message)) {
          final.set(p.d.id, { ...c, outcome: "not_searched", message: `This portal has no public name or company search (${c.message.replace(/^Not searched:\s*/i, "")})` });
        }
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

/**
 * True when one of the permit's NAME fields names the subject (audit round 2, decision 12): the contractor, applicant
 * and owner, each contact's name and company, and the names a results list shows without a role (`listedNames`).
 * Each is one name, checked like a license: a company's every word (single letters kept) in a business name, a
 * person's full words in ONE person's name with middle initials agreeing. Descriptions and saved HTML are never
 * read for names: words of two people in a sentence ("Jane Smith and John Doe") are not "John Smith".
 */
export function namesMatch(name: string, row: any, kind: "person" | "company" = "person"): boolean {
  const contacts = Array.isArray(row.contacts) ? row.contacts.flatMap((c: any) => [c?.name, c?.company]) : [];
  const record = row.rawData?.record ?? {};
  const fields = [row.contractorName, row.applicantName, record.ownerName, record.applicantName, record.contractorName, ...contacts, ...listedNamesOf(row)]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return kind === "company" ? fields.some((f) => companyNamed(name, f)) : fields.flatMap(personParts).some((f) => personMatches(name, f));
}

/**
 * The person a permit name field holds, through the one shared single-person check (round 5, decision 4): a field
 * that lists several people ("Jane Smith and John Doe", "Jane Smith / John Doe", "J Smith, John Doe") gives no
 * person match at all, rather than one read from pooled or split words.
 */
export function personParts(field: string): string[] {
  // The separators are read on the field as published (a line break is one), before spaces are tidied.
  const p = field.replace(/\s+/g, " ").trim();
  return p && onePersonField(field) ? [p] : [];
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
    const own = new LicenseSet();
    const licenseSources: ResearchSubjectReport["licenseSources"] = [];
    const finders: LicenseFinder[] = [];
    for (const state of input.states) {
      if (!hasLicenseSources(state)) licenseSources.push({ state, source: "State license records", searched: false, note: "Not searched by ConstructHUB: we have no license source for this state yet" });
      const list = findersFor(state);
      finders.push(...list);
      const searchByName = async (f: LicenseFinder) => {
        if (!f.byName) return;
        try {
          const r = await f.byName(subject.name, subject.kind);
          for (const h of r.hits) own.add(h);
          licenseSources.push({ state, source: f.label, searched: r.searched, note: r.note });
        } catch (err: any) {
          licenseSources.push({ state, source: f.label, searched: false, note: failureNote(err) });
        }
      };
      // The bulk files first, then the "no statewide GC license" note, then the live sources (the report's order).
      const isBulk = (f: LicenseFinder) => bulkSourcesFor(state).some((b) => b.label === f.label);
      for (const f of list.filter(isBulk)) await searchByName(f);
      const noGc = noStatewideGcLicense(state);
      if (noGc) licenseSources.push({ state, source: "Statewide general contractor license", searched: false, note: noGc });
      for (const f of list.filter((f) => !isBulk(f))) await searchByName(f);
    }
    // Files that cover every state (SAM.gov exclusions, by UEI or CAGE as a license number), once per subject.
    finders.push(...nationwideFinders());
    // The customer's license numbers, phones and addresses: the subject's own records, found another way.
    const ids = await searchCustomerIds(finders, subjectIds(subject), subject);
    for (const h of ids.licenses) own.add(h);
    if (ids.searches.length) log(`identifiers for "${subject.name}": ${ids.searches.map((x) => `${x.query}: ${x.found}`).join(", ")}`);
    const dbs = input.states.flatMap((s) => portals.get(s) ?? []);
    const { coverage, rows } = await sweepPortals(order.user_id, subject.name, subject.kind, dbs, log);
    const dedup = new Map<string, PermitHit>();
    for (const row of rows) {
      if (!namesMatch(subject.name, row, subject.kind)) continue;
      const hit = toPermitHit(row, input.trades);
      const y = yearOf(hit.issuedDate);
      if (input.sinceYear && y && y < input.sinceYear) continue;
      dedup.set(`${hit.jurisdiction}|${hit.permitNumber ?? row.id}`, hit);
    }
    const permits = Array.from(dedup.values()).sort((a, b) =>
      (b.tradeMatch.length > 0 ? 1 : 0) - (a.tradeMatch.length > 0 ? 1 : 0) || String(b.issuedDate ?? "").localeCompare(String(a.issuedDate ?? "")));
    const records = subject.kind === "company"
      ? await searchCompanyRecords(subject.name, input.states)
      : { complaints: [], courtCases: [], osha: [], enforcement: [], sources: [{ source: "Complaints, lawsuits, enforcement and OSHA records", scope: "", searched: false, note: "Searched for companies only, not for individual people" }] };
    log(`records for "${subject.name}": ${records.complaints.length} complaint(s), ${records.courtCases.length} federal case(s), ${records.osha.length} OSHA inspection(s), ${records.enforcement.length} enforcement record(s)`);
    const xref = await crossReference({
      subject, own, finders, searchedIds: ids.searchedIds, idSearchesUsed: ids.used, ownEnforcement: records.enforcement,
      enforcementSearch: (name) => searchEnforcement(name, input.states), log,
    });
    // A person never gets enforcement records, not even related ones (FCRA; checked again here after the cross-reference).
    const relatedEnforcement = subject.kind === "company" ? [...ids.enforcement, ...xref.relatedEnforcement] : [];
    // A record the cross-reference ties through one of the subject's own records keeps that tie; one found only by
    // the customer's identifier is listed as matched by it.
    const rel = new LicenseSet();
    for (const h of xref.related) rel.add(h);
    for (const h of ids.matched) {
      // A copy of an own record merges into it (its discipline included) rather than being dropped (round 4, finding 8).
      if (own.find(h)) { own.add(h); continue; }
      const dup = rel.find(h);
      if (!dup) rel.add(h);
      else if (h.relatedVia && !dup.relatedVia?.includes(h.relatedVia)) dup.relatedVia = `${dup.relatedVia}; also ${h.relatedVia}`;
    }
    // Disciplinary text on a license never shows on the license (round 2, decision 1): a business's becomes an
    // enforcement record for a company subject; for a person it is dropped.
    const enforcement = [...records.enforcement];
    const seenEnf = new Set(enforcement.map(enforcementKey));
    if (subject.kind === "company") {
      for (const h of own.list) { const e = disciplineRecord(h); if (e && !seenEnf.has(enforcementKey(e))) { seenEnf.add(enforcementKey(e)); enforcement.push(e); } }
      for (const h of rel.list) { const e = disciplineRecord(h); if (e && !seenEnf.has(enforcementKey(e))) { seenEnf.add(enforcementKey(e)); relatedEnforcement.push(e); } }
    }
    const relatedLicenses = rel.list.map((h) => reportHit(h, subject.kind));
    log(`cross-reference for "${subject.name}": ${relatedLicenses.length} related license(s), ${relatedEnforcement.length} related enforcement record(s), ${xref.idSearches} identifier search(es)${xref.notes.length ? `; ${xref.notes.join(" | ")}` : ""}`);
    subjects.push({
      name: subject.name, kind: subject.kind, licenses: own.list.map((h) => reportHit(h, subject.kind)), permits, licenseSources, portals: coverage.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction)),
      complaints: records.complaints, courtCases: records.courtCases, osha: records.osha, enforcement, recordSources: records.sources,
      identifierSearches: ids.searches, relatedLicenses, relatedEnforcement, relatedNotes: [...ids.notes, ...xref.notes],
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
      enforcement: subjects.reduce((n, s) => n + (s.enforcement?.length ?? 0), 0),
      related: subjects.reduce((n, s) => n + (s.relatedLicenses?.length ?? 0) + (s.relatedEnforcement?.length ?? 0), 0),
    },
  };
}

async function sendReportEmails(order: ResearchOrderRow, report: ResearchReport) {
  const link = `${SITE}${RESEARCH_PATH}/orders/${order.id}`;
  const names = order.input.subjects.map((s) => s.name).join(", ");
  const t = report.totals;
  // Each count backed by a source of its own kind that ran; the rest named as not searched (round 3, decision 9).
  const related = t.related ? ` Also ${t.related} related record(s) of other licenses and businesses tied to the same license numbers, phones, addresses or people.` : "";
  const summary = `${reportSummary(report)}${t.portalsSearched ? ` ${t.portalsSearched} permit portal search(es) ran.` : ""}${related}`;
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to: order.email,
    subject: `Your ConstructHUB research report is ready (#${order.id})`,
    html: `<p>Your research report for <strong>${escapeHtml(names)}</strong> is ready. ${escapeHtml(summary)}</p>
      <p><a href="${link}">Open your report</a> (sign in to ConstructHUB to view it; you can print it or save it as a PDF).</p>
      <p style="color:#666;font-size:12px">${escapeHtml(RESEARCH_NO_GUARANTEE)}</p>`,
  }).catch((err: unknown) => logError(`[research] order ${order.id}: customer email failed`, err));
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`,
    to: process.env.SMTP_EMAIL,
    subject: `Research report delivered #${order.id} (${order.tier})`,
    html: `<p>Delivered to ${escapeHtml(order.email)}: ${escapeHtml(names)} in ${escapeHtml(order.input.states.join(", "))}. ${escapeHtml(summary)}</p><p><a href="${link}">View</a></p>`,
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
        // One run: a host that denies access during it gets no further request until it ends (round 2, decision 6).
        const report = await withRun(() => runResearch(order));
        await finishOrder(order.id, report);
        console.log(`[research] order ${order.id}: complete (${report.totals.licenses} licenses, ${report.totals.permits} permits)`);
        await sendReportEmails(order, report);
      } catch (err: any) {
        logError(`[research] order ${order.id} failed:`, err);
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

/** Tells Hub whether the SAM.gov exclusions file has loaded, so it names that source only then (A9). */
async function noteResearchFacts(): Promise<void> {
  const sam = await sourceStatus(SAM_SOURCE_ID);
  setKnowledgeFact("samExclusions", sam.loaded);
}

/**
 * Once per purge version: unsafe legacy phone/address keys come off stored rows whether or not their source reloads
 * (round 5, decision 5). It is privacy, not refresh (round 6, decision 11): it runs whatever RESEARCH_WORKER and
 * RESEARCH_BULK say. Small page-range batches, no table copy; a database without the table only gets it created.
 */
export function startLegacyKeyPurge(delayMs = 60_000): void {
  // First the rows of retired sources (nothing reads them; acceptance run, 2026-10-15), then the key purge.
  const t = setTimeout(() => void dropRetiredSources(ALL_BULK_SOURCES).catch((err) => logError("[research-bulk] retired sources:", err))
    .then(() => purgeLegacyKeys(ALL_BULK_SOURCES)).then((r) => { if (r) console.log(`[research-bulk] legacy key purge: ${JSON.stringify(r)}`); })
    .catch((err) => logError("[research-bulk] legacy key purge:", err)), delayMs);
  t.unref?.();
  registerWorker("research legacy key purge", () => clearTimeout(t));
}

export function startResearchWorker(): void {
  startLegacyKeyPurge();
  workerInterval("research facts", () => noteResearchFacts().catch(() => undefined), 30 * 60_000, { firstAfterMs: 30_000 });
  if (process.env.RESEARCH_WORKER === "off") return;
  const boot = setTimeout(() => {
    requeueInterrupted()
      .then((n) => { if (n) console.log(`[research] re-queued ${n} interrupted order(s)`); })
      .then(() => drainResearchQueue())
      .catch((err) => logError("[research] worker start failed:", err));
  }, 20_000);
  boot.unref?.();
  registerWorker("research queue boot", () => clearTimeout(boot));
  workerInterval("research queue", () => drainResearchQueue().catch((err) => logError("[research] queue:", err)), 5 * 60_000);
  // The state bulk files (hundreds of MB a day): production only, unless a dev server asks with RESEARCH_BULK=on.
  if (process.env.RESEARCH_BULK === "on" || (process.env.NODE_ENV === "production" && process.env.RESEARCH_BULK !== "off")) {
    const refresh = () => refreshDueSources(ALL_BULK_SOURCES).catch((err) => logError("[research-bulk] refresh:", err));
    workerInterval("research bulk refresh", refresh, 60 * 60_000, { firstAfterMs: 3 * 60_000 });
  }
}
