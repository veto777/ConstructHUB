/**
 * West Virginia. Checked live 2026-10-15.
 *
 *   Live license searches (no CAPTCHA):
 *     WV State Fire Marshal electrician licenses: the public Licensee Search's own JSON read endpoint
 *       (sfm-permit-public.wvoasis.gov; robots.txt absent), by first and last name or license number
 *     WV Division of Labor certified plumbers and HVAC technicians: the "Current Certified …" searches linked from
 *       labor.wv.gov/database-search (www.wvlabor.com/new_searches; the server answers 500 for every missing file,
 *       robots.txt included, so it publishes no robots rules), by name or certificate number
 *   Bulk:
 *     wv-oic-evs  WV Offices of the Insurance Commissioner Employer Violator System: employers in default on workers'
 *                 compensation money owed (barred from state licenses and permits until paid), every business by
 *                 first letter (www.wvinsurance.gov/EVS; robots.txt absent). Companies only; owner names are not kept.
 *
 * None of these publish a street address or phone; electricians and plumbers/HVAC give city and state only.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch, sleep } from "../../scrapers/polite-fetch";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import { normLicense } from "../identifiers";
import { tokens } from "../licenses";
import type { LiveLicenseSearch, StatePack } from "./types";
import { anyDate, dmyDate, hasAllWords, htmlText } from "./lib/g3-common";

// ── State Fire Marshal electricians ──────────────────────────────────────────────────────────────────────────
const SFM_PAGE = "https://sfm-permit-public.wvoasis.gov/publicdata/LicenseeSearch";
const SFM_READ = "https://sfm-permit-public.wvoasis.gov/publicdata/LicenseeSearch/LicenseeSearch_Read";
type SfmRow = { FirstName?: string | null; LastName?: string | null; Suffix?: string | null; State?: string | null; City?: string | null; LicenseNumber?: string | null; LicenseType?: string | null; CertificationExpirationDate?: string | null };

/** The API returns one row per certification period; the latest period of each license is kept. */
export function sfmHits(rows: SfmRow[], matchedOn: LicenseHit["matchedOn"]): LicenseHit[] {
  const best = new Map<string, LicenseHit>();
  for (const r of rows) {
    const who = clean([r.FirstName, r.LastName, r.Suffix].filter(Boolean).join(" "));
    const no = clean(r.LicenseNumber);
    if (!who || !no) continue;
    const expires = dmyDate(r.CertificationExpirationDate);
    const hit: LicenseHit = {
      state: "WV", source: "WV State Fire Marshal electrician licenses", sourceUrl: SFM_PAGE, businessName: null, licenseNumber: no,
      licenseType: clean(r.LicenseType?.replace(/,/g, " ")), specialty: null, status: null, principal: who,
      city: [clean(r.City), clean(r.State)].filter(Boolean).join(", ") || null, expires, matchedOn,
      address: null, phone: null, people: [{ name: who, role: "Licensee" }],
    };
    const prev = best.get(no);
    if (!prev || (expires ?? "") > (prev.expires ?? "")) best.set(no, hit);
  }
  return Array.from(best.values());
}

async function sfmRead(fields: { FirstName?: string; LastName?: string; LicenseNumber?: string }): Promise<SfmRow[]> {
  const body = new URLSearchParams({ sort: "", group: "", filter: "", FirstName: fields.FirstName ?? "", LastName: fields.LastName ?? "", City: "", LicenseNumber: fields.LicenseNumber ?? "" });
  const res = await politeFetch(SFM_READ, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", accept: "application/json", referer: SFM_PAGE } }, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`WV Fire Marshal search returned HTTP ${res.status}`);
  const j = await res.json() as { Data?: SfmRow[]; Errors?: unknown };
  if (!Array.isArray(j.Data)) throw new Error("WV Fire Marshal search returned an unexpected payload");
  return j.Data;
}

const SFM: LiveLicenseSearch = {
  source: "WV State Fire Marshal electrician licenses", sourceUrl: SFM_PAGE,
  search: async (name, kind) => {
    const w = tokens(name);
    if (kind !== "person" || w.length < 2) return []; // individual licenses only
    return sfmHits(await sfmRead({ FirstName: w[0], LastName: w[w.length - 1] }), "principal").filter((h) => hasAllWords(name, h.principal));
  },
  searchBy: async (q: IdQuery) => {
    if (q.type !== "license" || !normLicense(q.value)) return [];
    return sfmHits(await sfmRead({ LicenseNumber: q.value.trim() }), "license").filter((h) => normLicense(h.licenseNumber) === normLicense(q.value));
  },
};

// ── Division of Labor plumbers and HVAC technicians ──────────────────────────────────────────────────────────
const WVDOL_PAGE = "https://labor.wv.gov/database-search";
const WVDOL = "http://www.wvlabor.com/new_searches";
type DolList = { results: string; label: string; type: (cls: string | null) => string };
const PLUMBERS: DolList = { results: "plumber_RESULTS.cfm", label: "WV Division of Labor certified plumbers", type: (c) => (c ? `${c} Plumber` : "Plumber") };
const HVAC: DolList = { results: "HVAC_RESULTS.cfm", label: "WV Division of Labor certified HVAC technicians", type: (c) => (c ? `HVAC ${c}` : "HVAC") };

/** Rows of one results page: number, name, city, state, county, classification, expiration. */
export function parseWvDol(html: string, list: DolList, matchedOn: LicenseHit["matchedOn"]): { total: number; hits: LicenseHit[] } {
  const total = Number(html.match(/Records \d+ to \d+ of (\d+) Records/)?.[1] ?? NaN);
  const hits: LicenseHit[] = [];
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => htmlText(c[1]));
    if (cells.length !== 7 || !/^(PL|HVAC)\d+/.test(cells[0] ?? "")) continue;
    const [no, who, city, st, county, cls, exp] = cells;
    hits.push({
      state: "WV", source: list.label, sourceUrl: WVDOL_PAGE, businessName: null, licenseNumber: no,
      licenseType: list.type(cls),
      specialty: null, status: null, principal: who,
      city: [city, st].filter(Boolean).join(", ") || (county ? `${county} County` : null), expires: anyDate(exp), matchedOn,
      address: null, phone: null, people: who ? [{ name: who, role: "Certificate holder" }] : [],
    });
  }
  if (!Number.isFinite(total)) throw new Error(`${list.label}: unexpected page`);
  return { total, hits };
}

async function dolPage(list: DolList, params: { wvnumber?: string; contractor_name?: string }, page: number): Promise<string> {
  const q = new URLSearchParams({ ...(page > 1 ? { PageNum_WVNUMBER: String(page) } : {}), wvnumber: params.wvnumber ?? "", contractor_name: params.contractor_name ?? "", city_name: "", County: "", Submit3: "Search" });
  const res = await politeFetch(`${WVDOL}/${list.results}?${q}`, {}, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`${list.label} returned HTTP ${res.status}`);
  return res.text();
}

const PER_PAGE = 24;
const MAX_PAGES = 10;

/** A person: the form matches part of the name, so the rarer of the first and last word is searched and every page read. */
async function searchDol(list: DolList, name: string): Promise<LicenseHit[]> {
  const w = tokens(name).filter((x) => x.length >= 2);
  if (w.length < 2) return [];
  const tries = Array.from(new Set([w[w.length - 1], w[0]]));
  let best: { word: string; first: ReturnType<typeof parseWvDol> } | null = null;
  for (const word of tries) {
    const first = parseWvDol(await dolPage(list, { contractor_name: word }, 1), list, "principal");
    if (!best || first.total < best.first.total) best = { word, first };
    if (best.first.total <= PER_PAGE * MAX_PAGES) break;
  }
  const hits = [...best!.first.hits];
  const pages = Math.min(MAX_PAGES, Math.ceil(best!.first.total / PER_PAGE));
  for (let p = 2; p <= pages; p++) hits.push(...parseWvDol(await dolPage(list, { contractor_name: best!.word }, p), list, "principal").hits);
  return hits.filter((h) => hasAllWords(name, h.principal));
}

const dolSearch = (list: DolList): LiveLicenseSearch => ({
  source: list.label, sourceUrl: WVDOL_PAGE,
  search: async (name, kind) => (kind === "person" ? searchDol(list, name) : []), // certificates are held by people
  searchBy: async (q) => {
    if (q.type !== "license" || !normLicense(q.value)) return [];
    return parseWvDol(await dolPage(list, { wvnumber: q.value.trim().toUpperCase() }, 1), list, "license").hits.filter((h) => normLicense(h.licenseNumber) === normLicense(q.value));
  },
});

// ── Insurance Commissioner Employer Violator System ──────────────────────────────────────────────────────────
const EVS = "https://www.wvinsurance.gov/EVS";
const EVS_LETTERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Business rows of one EVS letter page (business, owner, city, state, masked FEIN); owners are dropped (FCRA). */
export function parseEvs(html: string): { name: string; city: string | null; state: string | null; fein: string | null }[] {
  const table = html.match(/<td>Business Name<\/td>[\s\S]*?<\/TABLE>/i)?.[0] ?? "";
  const out = new Map<string, { name: string; city: string | null; state: string | null; fein: string | null }>();
  for (const m of Array.from(table.matchAll(/<tr>\s*([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => htmlText(c[1]));
    if (cells.length < 5 || !cells[0] || cells[0] === "Business Name") continue;
    const row = { name: cells[0], city: cells[2], state: cells[3], fein: cells[4] };
    out.set(`${row.name}|${row.fein}|${row.city}`, row);
  }
  return Array.from(out.values());
}

async function* evsLoader(): AsyncIterable<BulkHit> {
  for (const letter of EVS_LETTERS) {
    let html = "";
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await politeFetch(`${EVS}?cri=${letter}&req=BUS`, {}, { minDelayMs: 2500, timeoutMs: 120_000 });
        if (!res.ok) throw new Error(`EVS letter ${letter} returned HTTP ${res.status}`);
        html = await res.text();
        break;
      } catch (err) {
        if (attempt >= 2) throw new Error(`EVS letter ${letter}: ${String((err as Error)?.message ?? err)}`);
        await sleep(30_000);
      }
    }
    if (!/Showing results for: Business\/DBA Name starts with/.test(html)) throw new Error(`EVS letter ${letter}: unexpected page`);
    for (const r of parseEvs(html)) {
      const hit: EnforcementHit = {
        state: "WV", source: "WV Insurance Commissioner Employer Violator System (workers' comp default)", sourceUrl: EVS, category: "debarment",
        name: r.name, id: null, date: null, endDate: null,
        status: "Listed on the Employer Violator System: in default on workers' compensation money owed; barred from state licenses, certificates and permits until paid or on a repayment agreement",
        city: [r.city, r.state].filter(Boolean).join(", ") || null, detail: r.fein ? `FEIN ${r.fein} (masked by the publisher)` : null,
        amount: null, adverse: true,
      };
      yield { kind: "enforcement", hit, business: r.name, person: null };
    }
  }
}

const BULK: BulkSource[] = [
  // 2,647 rows (business, city, masked FEIN) on 2026-10-15.
  { id: "wv-oic-evs", state: "WV", label: "WV Employer Violator System (workers' comp default)", pageUrl: EVS, everyHours: 24 * 7, minRows: 1_500, load: evsLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "WV",
  checked: "2026-10-15",
  liveLicenses: [SFM, dolSearch(PLUMBERS), dolSearch(HVAC)],
  bulk: BULK,
  blocked: [
    "WV Contractor Licensing Board license search and board actions (wvclboard.wv.gov/verify, /about/actions.asp): robots.txt Disallow: /",
    "WV Secretary of State business search (apps.sos.wv.gov/business/corporations): the form carries bot-trap fields, treated as an anti-bot measure; bulk data is a paid subscription",
    "WV Division of Labor manufactured-housing search (mfghsgRESULTS.cfm): returns no records for any name tried",
  ],
};
