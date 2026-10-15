/**
 * Complaints, lawsuits and safety records for research reports, on companies only (a person's lawsuits and
 * complaints would make the report a background check; shared/research-reports.ts RESEARCH_NOT_FCRA):
 *
 *   - State attorney general consumer complaints, from official open data (WA statewide and current; OR 2017–2019).
 *   - Federal court dockets naming the company, nationwide (CourtListener's RECAP archive, free API): NOT SEARCHED since
 *     2026-10-15. courtlistener.com's robots.txt says "User-agent: *  Disallow: /" (only named search engines get other
 *     rules), so under HARD RULE 2 the search is off (COURTLISTENER_ALLOWED). The code stays for when that changes.
 *   - Federal OSHA inspections of the company's establishments, nationwide (U.S. DOL API v4, needs DOL_API_KEY; the key
 *     goes in the query string, `like` is case-sensitive, no match is HTTP 204).
 *
 * Every dataset here was checked live (CLAUDE.md: never fabricate government data). A source that could not be
 * searched is reported as not searched, never as "nothing found".
 */
import { politeFetch, rethrowIfBlocked } from "./http";
import type { ComplaintHit, CourtCaseHit, EnforcementHit, OshaHit, RecordCategory, RecordSource, ResearchPreview } from "@shared/research-reports";
import { nameClause, sodaRows, tokens } from "./licenses";
import { BULK_LIMIT, searchBulk } from "./bulk";
import { allBulkSourcesFor as bulkSourcesFor, hasStateCourtSearch, nationwideBulkSources, packComplaintSourcesFor, searchPackEnforcement } from "./registry";
import { searchStateEnforcement } from "./state-records";
import { capNote, failureNote, noteOf, type Noted, withNote } from "./notes";

const MAX_COMPLAINTS = 1000;
const MAX_CASE_PAGES = 10; // 20 dockets a page
const MAX_OSHA = 500;

/** Every word of the searched name is a whole word of one of the fields ("Bella" is not "DaBella"). */
export function namedIn(name: string, ...fields: (string | null | undefined)[]): boolean {
  // Single letters count here ("D & S Electric" is not every "… Electric"), though the search index drops them.
  const words = (v: string) => v.toUpperCase().split(/[^A-Z0-9']+/).filter((w) => w.length >= 1);
  const want = words(name);
  return tokens(name).length > 0 && fields.some((f) => { const have = new Set(words(f ?? "")); return want.every((w) => have.has(w)); });
}

const s = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());
const day = (v: unknown): string | null => s(v)?.slice(0, 10) ?? null;
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

// ── State AG consumer complaints (checked live 2026-10-14) ─────────────────────────────────────────────────────────
export type ComplaintSource = {
  state: string; source: string; scope: string; datasetUrl: string; url: string; nameField: string; dateField: string;
  toHit: (row: Record<string, unknown>) => Omit<ComplaintHit, "state" | "source" | "sourceUrl">;
};

/** The street lines plus city, state and ZIP (null when the row has no street; both datasets checked 2026-10-15). */
const street = (r: Record<string, unknown>, lines: string[], rest: string[]): string | null => {
  const st = lines.map((f) => s(r[f])).filter(Boolean).join(" ");
  return st ? [st, ...rest.map((f) => s(r[f]))].filter(Boolean).join(" ") : null;
};

const COMPLAINT_SOURCES: ComplaintSource[] = [
  {
    state: "WA", source: "Washington Attorney General consumer complaints", scope: "2013 to today, updated daily",
    datasetUrl: "https://data.wa.gov/d/gpri-47xz", url: "https://data.wa.gov/resource/gpri-47xz.json",
    nameField: "business", dateField: "openeddate",
    toHit: (r) => ({
      id: s(r.id), opened: day(r.openeddate), closed: null, status: s(r.status), business: s(r.business), city: s(r.businesscity),
      category: s(r.businesscategory), description: null, resolution: null, savings: num(r.actualsavings),
      address: street(r, ["businessstreetline1", "businessstreetline2"], ["businesscity", "businessstate", "businesszip"]),
    }),
  },
  {
    state: "OR", source: "Oregon DOJ consumer complaints", scope: "2017 to 2019 only (the state stopped publishing after 2019)",
    datasetUrl: "https://data.oregon.gov/d/2ix7-8hwk", url: "https://data.oregon.gov/resource/2ix7-8hwk.json",
    nameField: "respondent", dateField: "date_open",
    toHit: (r) => ({
      id: s(r.reference_no_), opened: day(r.date_open), closed: day(r.date_closed), status: s(r.status), business: s(r.respondent), city: s(r.city),
      category: s(r.business_type), description: s(r.complaint_description), resolution: s(r.closing_description), savings: null,
      address: street(r, ["address_1", "address_2"], ["city", "state", "zip"]),
    }),
  },
];

export function complaintSourcesFor(state: string): ComplaintSource[] {
  return [...COMPLAINT_SOURCES.filter((c) => c.state === state), ...packComplaintSourcesFor(state)];
}

export async function searchComplaints(src: ComplaintSource, name: string): Promise<Noted<ComplaintHit>> {
  const rows = await sodaRows(src.url, nameClause(src.nameField, name), MAX_COMPLAINTS, "Complaint data", `${src.dateField} DESC`);
  return withNote(rows
    .map((r) => ({ state: src.state, source: src.source, sourceUrl: src.datasetUrl, ...src.toHit(r) }))
    .filter((h) => namedIn(name, h.business)), noteOf(rows) ? `the newest ${MAX_COMPLAINTS} word matches were checked; there are more` : null);
}

/**
 * CourtListener's robots.txt disallows every path for unnamed agents ("Be conservative; Block everything", read
 * 2026-10-15), so its search is not run (HARD RULE 2: never get around a robots.txt Disallow). Flip only when its
 * robots.txt allows our agent; http.ts would refuse the requests anyway.
 */
export const COURTLISTENER_ALLOWED = false;
export const COURTLISTENER_BLOCKED_NOTE = "Not searched by ConstructHUB: courtlistener.com's robots.txt disallows automated access for all but named search engines (checked 2026-10-15)";

// ── Federal court dockets (CourtListener) ────────────────────────────────────────────────────────────────────────
const COURTLISTENER = "https://www.courtlistener.com";

/** "wawd" → WA, "txwd" → TX, "dcd" → DC, "orb" → OR; appellate ids ("ca9", "cafc") have no state. */
export function courtState(courtId: string | null): string | null {
  const m = courtId?.match(/^([a-z]{2})(?:n|s|e|w|m|c)?(?:d|b)$/);
  return m ? m[1].toUpperCase() : null;
}

export async function searchCourtCases(name: string, maxPages = MAX_CASE_PAGES): Promise<{ cases: CourtCaseHit[]; total: number }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.COURTLISTENER_TOKEN) headers.Authorization = `Token ${process.env.COURTLISTENER_TOKEN}`;
  let url: string | null = `${COURTLISTENER}/api/rest/v4/search/?${new URLSearchParams({ q: `"${name.replace(/"/g, "")}"`, type: "r", order_by: "dateFiled desc" })}`;
  const cases: CourtCaseHit[] = [];
  let total = 0;
  for (let page = 0; url && page < maxPages; page++) {
    // Without a token CourtListener allows 5 searches a minute; with one, thousands an hour.
    const res = await politeFetch(url, { headers }, { minDelayMs: process.env.COURTLISTENER_TOKEN ? 800 : 13_000, retries: 3 });
    if (!res.ok) throw new Error(`CourtListener returned HTTP ${res.status}`);
    const body = await res.json() as { count?: number; next?: string | null; results?: any[] };
    if (!Array.isArray(body.results)) throw new Error("CourtListener returned an unexpected payload");
    total = body.count ?? total;
    for (const r of body.results) {
      const parties = Array.isArray(r.party) ? r.party.map(String) : [];
      if (!namedIn(name, r.caseName, r.case_name_full, ...parties)) continue;
      if (typeof r.docket_absolute_url !== "string") continue;
      cases.push({
        caseName: s(r.caseName) ?? "Unnamed case", court: s(r.court), courtId: s(r.court_id), state: courtState(s(r.court_id)),
        docketNumber: s(r.docketNumber), filed: day(r.dateFiled), terminated: day(r.dateTerminated),
        nature: s(r.suitNature) ?? s(r.cause), url: `${COURTLISTENER}${r.docket_absolute_url}`,
      });
    }
    url = typeof body.next === "string" && body.next.startsWith(`${COURTLISTENER}/`) ? body.next : null;
  }
  return { cases, total };
}

// ── Federal OSHA inspections (U.S. DOL enforcement data API v4) ─────────────────────────────────────────────────
const DOL_API = "https://apiprod.dol.gov/v4/get/OSHA";
const oshaUrl = (activityNr: string) => `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${encodeURIComponent(activityNr)}`;

async function dol(dataset: string, filter: unknown, limit: number): Promise<any[]> {
  const key = process.env.DOL_API_KEY;
  if (!key) throw new Error("not configured");
  const q = new URLSearchParams({ limit: String(limit), filter_object: JSON.stringify(filter), "X-API-KEY": key });
  const res = await politeFetch(`${DOL_API}/${dataset}/json?${q}`, { headers: { Accept: "application/json" } }, { minDelayMs: 500, retries: 1 });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`DOL API returned HTTP ${res.status}`);
  const body = await res.json() as { data?: any[] } | any[];
  const rows = Array.isArray(body) ? body : body.data;
  if (!Array.isArray(rows)) throw new Error("DOL API returned an unexpected payload");
  return rows;
}

/** Every federal OSHA inspection of an establishment with this name, nationwide, with its violations and penalties. */
export async function searchOsha(name: string): Promise<Noted<OshaHit>> {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  // `like` is case-sensitive and names are stored uppercase. The longest word narrows the search on the server;
  // whole-word matching on every word happens here.
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const rows = await dol("inspection", { field: "estab_name", operator: "like", value: `%${longest}%` }, MAX_OSHA);
  // The API answers MAX_OSHA rows at most: with a full page, inspections past it were not checked, and the report says so.
  const capped = rows.length >= MAX_OSHA ? `only the first ${MAX_OSHA} establishments whose name contains "${longest}" were checked; there are more` : null;
  const out: OshaHit[] = [];
  for (const r of rows) {
    const activityNr = s(r.activity_nr);
    if (!activityNr || !namedIn(name, r.estab_name)) continue;
    out.push({
      activityNr, establishment: s(r.estab_name), city: s(r.site_city), state: s(r.site_state), opened: day(r.open_date),
      closed: day(r.close_case_date), inspectionType: s(r.insp_type), violations: null, seriousViolations: null, penalty: null,
      url: oshaUrl(activityNr),
    });
  }
  // Violations for all of them in a few calls (the key is rate-limited hard); deleted citations don't count.
  for (let i = 0; i < out.length; i += 50) {
    const chunk = out.slice(i, i + 50);
    try {
      const v = (await dol("violation", { field: "activity_nr", operator: "in", value: chunk.map((h) => h.activityNr) }, 5000))
        .filter((x) => !s(x.delete_flag));
      for (const hit of chunk) {
        const mine = v.filter((x) => String(x.activity_nr) === hit.activityNr);
        hit.violations = mine.length;
        hit.seriousViolations = mine.filter((x) => ["S", "W", "R"].includes(String(x.viol_type ?? "").toUpperCase())).length;
        hit.penalty = mine.reduce((sum, x) => sum + (num(x.current_penalty) ?? num(x.initial_penalty) ?? 0), 0);
      }
    } catch (err) { rethrowIfBlocked(err); /* the inspections stand without their violation detail */ }
  }
  return withNote(out.sort((a, b) => String(b.opened ?? "").localeCompare(String(a.opened ?? ""))), capped);
}

// ── All of it, for one company ──────────────────────────────────────────────────────────────────────────────────
export type CompanyRecords = { complaints: ComplaintHit[]; courtCases: CourtCaseHit[]; osha: OshaHit[]; enforcement: EnforcementHit[]; sources: RecordSource[] };

/** State enforcement and standing records for a company: live searches plus the indexed bulk files. */
export async function searchEnforcement(name: string, states: string[]): Promise<{ hits: EnforcementHit[]; sources: RecordSource[] }> {
  const hits: EnforcementHit[] = [];
  const sources: RecordSource[] = [];
  const matches = (n: string | null) => namedIn(name, ...(n ?? "").split(" / "));
  for (const state of states) {
    for (const live of [await searchStateEnforcement(name, state, matches), await searchPackEnforcement(name, state, matches)]) {
      hits.push(...live.hits);
      // Every source carries its category (round 3, decision 9); a live search that names none is an enforcement source.
      sources.push(...live.sources.map((s) => ({ ...s, category: s.category ?? ("enforcement" as const) })));
    }
    for (const src of bulkSourcesFor(state)) {
      if (!src.companiesOnly) continue; // the license files are searched with the licenses
      const category: RecordCategory = src.category === "court_case" ? "state_court" : "enforcement";
      try {
        const { hits: found, status } = await searchBulk(src, name, "company");
        if (!status.loaded) { sources.push({ source: src.label, scope: state, searched: false, note: "Not loaded yet (the state's file is downloaded daily)", category }); continue; }
        const mine = found.filter((h): h is { kind: "enforcement"; hit: EnforcementHit } => h.kind === "enforcement").map((h) => h.hit).filter((h) => matches(h.name));
        hits.push(...mine);
        // The index read stops at BULK_LIMIT rows: a search that reached it says so (round 2, decision 9).
        const capped = found.length >= BULK_LIMIT ? ` (${capNote(BULK_LIMIT, null, "index matches")})` : "";
        sources.push({ source: src.label, scope: `${state}, file of ${status.loadedAt?.slice(0, 10)}`, searched: true, note: `${mine.length} record(s)${capped}`, category });
      } catch (err: any) {
        sources.push({ source: src.label, scope: state, searched: false, note: failureNote(err), category });
      }
    }
  }
  // Files that cover every state (SAM.gov federal exclusions), once per report whatever the states.
  for (const src of nationwideBulkSources()) {
    try {
      const { hits: found, status } = await searchBulk(src, name, "company");
      if (!status.loaded) { sources.push({ source: src.label, scope: "All states", searched: false, note: "Not loaded yet (the file is downloaded daily)", category: "enforcement" }); continue; }
      const mine = found.filter((h): h is { kind: "enforcement"; hit: EnforcementHit } => h.kind === "enforcement").map((h) => h.hit).filter((h) => matches(h.name));
      hits.push(...mine);
      const capped = found.length >= BULK_LIMIT ? ` (${capNote(BULK_LIMIT, null, "index matches")})` : "";
      sources.push({ source: src.label, scope: `All states, file of ${status.loadedAt?.slice(0, 10)}`, searched: true, note: `${mine.length} record(s)${capped}`, category: "enforcement" });
    } catch (err: any) {
      sources.push({ source: src.label, scope: "All states", searched: false, note: failureNote(err), category: "enforcement" });
    }
  }
  // Licensing-board enforcement on the license itself (CSLB suspensions, bonds) rides in the license files.
  for (const state of states) for (const src of bulkSourcesFor(state)) {
    if (src.companiesOnly) continue;
    try {
      const { hits: found, status } = await searchBulk(src, name, "company");
      if (!status.loaded) continue;
      hits.push(...found.filter((h): h is { kind: "enforcement"; hit: EnforcementHit } => h.kind === "enforcement").map((h) => h.hit).filter((h) => matches(h.name)));
    } catch { /* reported with the licenses */ }
  }
  hits.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { hits, sources };
}

export async function searchCompanyRecords(name: string, states: string[]): Promise<CompanyRecords> {
  const sources: RecordSource[] = [];
  const complaints: ComplaintHit[] = [];
  for (const state of states) {
    const list = complaintSourcesFor(state);
    if (!list.length) sources.push({ source: `${state} attorney general complaints`, scope: state, searched: false, note: "Not searched by ConstructHUB: we have no complaint source for this state", category: "complaints" });
    for (const src of list) {
      try {
        const hits = await searchComplaints(src, name);
        complaints.push(...hits);
        sources.push({ source: src.source, scope: src.scope, searched: true, note: `${hits.length} complaint(s)${noteOf(hits) ? ` (${noteOf(hits)})` : ""}`, category: "complaints" });
      } catch (err: any) {
        sources.push({ source: src.source, scope: src.scope, searched: false, note: failureNote(err), category: "complaints" });
      }
    }
  }
  for (const state of states) if (!hasStateCourtSearch(state)) sources.push({ source: `${state} state court cases`, scope: state, searched: false, note: "Not searched by ConstructHUB: we don't search this state's court records", category: "state_court" });
  let courtCases: CourtCaseHit[] = [];
  if (!COURTLISTENER_ALLOWED) sources.push({ source: "Federal court dockets (CourtListener)", scope: "All U.S. federal courts", searched: false, note: COURTLISTENER_BLOCKED_NOTE, category: "federal_court" });
  else try {
    const r = await searchCourtCases(name);
    courtCases = r.cases;
    sources.push({ source: "Federal court dockets (CourtListener)", scope: "All U.S. federal courts", searched: true,
      note: r.total > MAX_CASE_PAGES * 20 ? `${courtCases.length} case(s): the newest ${MAX_CASE_PAGES * 20} of ${r.total} matches were checked` : `${courtCases.length} case(s)`, category: "federal_court" });
  } catch (err: any) {
    sources.push({ source: "Federal court dockets (CourtListener)", scope: "All U.S. federal courts", searched: false, note: failureNote(err), category: "federal_court" });
  }
  let osha: OshaHit[] = [];
  try {
    osha = await searchOsha(name);
    sources.push({ source: "Federal OSHA inspections (U.S. Department of Labor)", scope: "All states", searched: true, note: `${osha.length} inspection(s)${noteOf(osha) ? ` (${noteOf(osha)})` : ""}`, category: "osha" });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    sources.push({ source: "Federal OSHA inspections (U.S. Department of Labor)", scope: "All states", searched: false,
      note: msg === "not configured" ? "Not searched yet" : failureNote(err), category: "osha" });
  }
  const enforcement = await searchEnforcement(name, states);
  sources.push(...enforcement.sources);
  return { complaints, courtCases, osha, enforcement: enforcement.hits, sources };
}

/** The free preview's counts: complaints and OSHA in full, federal cases from the first page's match count. */
export async function previewCompanyRecords(name: string, states: string[]): Promise<NonNullable<ResearchPreview["records"]>> {
  const searched: string[] = [];
  const ran = { complaints: false, courtCases: false, osha: false, enforcement: false };
  let complaints = 0, courtCases = 0, osha = 0;
  for (const state of states) for (const src of complaintSourcesFor(state)) {
    try { complaints += (await searchComplaints(src, name)).length; searched.push(src.source); ran.complaints = true; } catch { /* a hint, not the report */ }
  }
  if (COURTLISTENER_ALLOWED) try { courtCases = (await searchCourtCases(name, 1)).total; searched.push("Federal court dockets"); ran.courtCases = true; } catch { /* ditto */ }
  if (process.env.DOL_API_KEY) {
    try { osha = (await searchOsha(name)).length; searched.push("Federal OSHA inspections"); ran.osha = true; } catch { /* ditto */ }
  }
  let enforcement = 0;
  try {
    const e = await searchEnforcement(name, states);
    enforcement = e.hits.length;
    const done = e.sources.filter((x) => x.searched);
    searched.push(...done.map((x) => x.source));
    ran.enforcement = done.length > 0;
  } catch { /* ditto */ }
  return { complaints, courtCases, osha, enforcement, searched, ran };
}
