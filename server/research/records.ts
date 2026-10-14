/**
 * Complaints, lawsuits and safety records for research reports, on companies only (a person's lawsuits and
 * complaints would make the report a background check; shared/research-reports.ts RESEARCH_NOT_FCRA):
 *
 *   - State attorney general consumer complaints, from official open data (WA statewide and current; OR 2017–2019).
 *   - Federal court dockets naming the company, nationwide (CourtListener's RECAP archive, free API).
 *   - Federal OSHA inspections of the company's establishments in the chosen states (U.S. DOL API, needs DOL_API_KEY).
 *
 * Every dataset here was checked live (CLAUDE.md: never fabricate government data). A source that could not be
 * searched is reported as not searched, never as "nothing found".
 */
import { politeFetch } from "../scrapers/polite-fetch";
import type { ComplaintHit, CourtCaseHit, OshaHit, RecordSource } from "@shared/research-reports";
import { nameClause, sodaRows, tokens } from "./licenses";

const MAX_COMPLAINTS = 1000;
const MAX_CASE_PAGES = 10; // 20 dockets a page
const MAX_OSHA = 500;

/** Every word of the searched name is a whole word of one of the fields ("Bella" is not "DaBella"). */
export function namedIn(name: string, ...fields: (string | null | undefined)[]): boolean {
  const want = tokens(name);
  return want.length > 0 && fields.some((f) => { const have = new Set(tokens(f ?? "")); return want.every((w) => have.has(w)); });
}

const s = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());
const day = (v: unknown): string | null => s(v)?.slice(0, 10) ?? null;
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

// ── State AG consumer complaints (checked live 2026-10-14) ─────────────────────────────────────────────────────────
type ComplaintSource = {
  state: string; source: string; scope: string; datasetUrl: string; url: string; nameField: string; dateField: string;
  toHit: (row: Record<string, unknown>) => Omit<ComplaintHit, "state" | "source" | "sourceUrl">;
};

const COMPLAINT_SOURCES: ComplaintSource[] = [
  {
    state: "WA", source: "Washington Attorney General consumer complaints", scope: "2013 to today, updated daily",
    datasetUrl: "https://data.wa.gov/d/gpri-47xz", url: "https://data.wa.gov/resource/gpri-47xz.json",
    nameField: "business", dateField: "openeddate",
    toHit: (r) => ({
      id: s(r.id), opened: day(r.openeddate), closed: null, status: s(r.status), business: s(r.business), city: s(r.businesscity),
      category: s(r.businesscategory), description: null, resolution: null, savings: num(r.actualsavings),
    }),
  },
  {
    state: "OR", source: "Oregon DOJ consumer complaints", scope: "2017 to 2019 only (the state stopped publishing after 2019)",
    datasetUrl: "https://data.oregon.gov/d/2ix7-8hwk", url: "https://data.oregon.gov/resource/2ix7-8hwk.json",
    nameField: "respondent", dateField: "date_open",
    toHit: (r) => ({
      id: s(r.reference_no_), opened: day(r.date_open), closed: day(r.date_closed), status: s(r.status), business: s(r.respondent), city: s(r.city),
      category: s(r.business_type), description: s(r.complaint_description), resolution: s(r.closing_description), savings: null,
    }),
  },
];

export function complaintSourcesFor(state: string): ComplaintSource[] {
  return COMPLAINT_SOURCES.filter((c) => c.state === state);
}

export async function searchComplaints(src: ComplaintSource, name: string): Promise<ComplaintHit[]> {
  const rows = await sodaRows(src.url, nameClause(src.nameField, name), MAX_COMPLAINTS, "Complaint data", `${src.dateField} DESC`);
  return rows
    .map((r) => ({ state: src.state, source: src.source, sourceUrl: src.datasetUrl, ...src.toHit(r) }))
    .filter((h) => namedIn(name, h.business));
}

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

export async function searchOsha(name: string, states: string[]): Promise<OshaHit[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  // The longest word narrows the search on the server; whole-word matching on every word happens here.
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const out: OshaHit[] = [];
  for (const state of states) {
    const rows = await dol("inspection", { and: [
      { field: "site_state", operator: "eq", value: state },
      { field: "estab_name", operator: "like", value: `%${longest}%` },
    ] }, MAX_OSHA);
    for (const r of rows) {
      if (!namedIn(name, r.estab_name)) continue;
      const activityNr = s(r.activity_nr);
      if (!activityNr) continue;
      out.push({
        activityNr, establishment: s(r.estab_name), city: s(r.site_city), state: s(r.site_state), opened: day(r.open_date),
        closed: day(r.close_case_date), inspectionType: s(r.insp_type), violations: null, seriousViolations: null, penalty: null,
        url: oshaUrl(activityNr),
      });
    }
  }
  // Violations and penalties for each inspection found.
  for (const hit of out.slice(0, 100)) {
    try {
      const v = await dol("violation", { field: "activity_nr", operator: "eq", value: hit.activityNr }, 200);
      hit.violations = v.length;
      hit.seriousViolations = v.filter((x) => ["S", "W", "R"].includes(String(x.viol_type ?? "").toUpperCase())).length;
      hit.penalty = v.reduce((sum, x) => sum + (num(x.current_penalty) ?? num(x.initial_penalty) ?? 0), 0);
    } catch { /* the inspection stands without its violation detail */ }
  }
  return out.sort((a, b) => String(b.opened ?? "").localeCompare(String(a.opened ?? "")));
}

// ── All of it, for one company ──────────────────────────────────────────────────────────────────────────────────
export type CompanyRecords = { complaints: ComplaintHit[]; courtCases: CourtCaseHit[]; osha: OshaHit[]; sources: RecordSource[] };

export async function searchCompanyRecords(name: string, states: string[]): Promise<CompanyRecords> {
  const sources: RecordSource[] = [];
  const complaints: ComplaintHit[] = [];
  for (const state of states) {
    const list = complaintSourcesFor(state);
    if (!list.length) sources.push({ source: `${state} attorney general complaints`, scope: state, searched: false, note: "This state doesn't publish its complaints as open data" });
    for (const src of list) {
      try {
        const hits = await searchComplaints(src, name);
        complaints.push(...hits);
        sources.push({ source: src.source, scope: src.scope, searched: true, note: `${hits.length} complaint(s)` });
      } catch (err: any) {
        sources.push({ source: src.source, scope: src.scope, searched: false, note: `Could not search: ${String(err?.message ?? err).slice(0, 200)}` });
      }
    }
  }
  for (const state of states) sources.push({ source: `${state} state court cases`, scope: state, searched: false, note: "State courts don't publish searchable case data" });
  let courtCases: CourtCaseHit[] = [];
  try {
    const r = await searchCourtCases(name);
    courtCases = r.cases;
    sources.push({ source: "Federal court dockets (CourtListener)", scope: "All U.S. federal courts", searched: true,
      note: r.total > MAX_CASE_PAGES * 20 ? `${courtCases.length} case(s): the newest ${MAX_CASE_PAGES * 20} of ${r.total} matches were checked` : `${courtCases.length} case(s)` });
  } catch (err: any) {
    sources.push({ source: "Federal court dockets (CourtListener)", scope: "All U.S. federal courts", searched: false, note: `Could not search: ${String(err?.message ?? err).slice(0, 200)}` });
  }
  let osha: OshaHit[] = [];
  try {
    osha = await searchOsha(name, states);
    sources.push({ source: "Federal OSHA inspections (U.S. Department of Labor)", scope: states.join(", "), searched: true, note: `${osha.length} inspection(s)` });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    sources.push({ source: "Federal OSHA inspections (U.S. Department of Labor)", scope: states.join(", "), searched: false,
      note: msg === "not configured" ? "Not searched yet" : `Could not search: ${msg.slice(0, 200)}` });
  }
  return { complaints, courtCases, osha, sources };
}

/** The free preview's counts: complaints and OSHA in full, federal cases from the first page's match count. */
export async function previewCompanyRecords(name: string, states: string[]): Promise<{ complaints: number; courtCases: number; osha: number; searched: string[] }> {
  const searched: string[] = [];
  let complaints = 0, courtCases = 0, osha = 0;
  for (const state of states) for (const src of complaintSourcesFor(state)) {
    try { complaints += (await searchComplaints(src, name)).length; searched.push(src.source); } catch { /* a hint, not the report */ }
  }
  try { courtCases = (await searchCourtCases(name, 1)).total; searched.push("Federal court dockets"); } catch { /* ditto */ }
  if (process.env.DOL_API_KEY) {
    try { osha = (await searchOsha(name, states)).length; searched.push("Federal OSHA inspections"); } catch { /* ditto */ }
  }
  return { complaints, courtCases, osha, searched };
}
