/**
 * West Virginia. Checked live 2026-10-15.
 *
 *   Live license searches (no CAPTCHA):
 *     WV State Fire Marshal licenses: the public Licensee Search's own JSON read endpoint
 *       (sfm-permit-public.wvoasis.gov/publicdata/LicenseeSearch, linked from firemarshal.wv.gov's Regulatory and
 *       Licensing Division page; robots.txt 404), by first and last name or license number. Its rows are mostly
 *       electricians (journeyman, master, low voltage) but also fire protection workers, home inspectors, building code
 *       officials, blasters and pyrotechnicians (license types as published, e.g. "JOURNEYMAN,ELECTRICIAN").
 *   Bulk:
 *     wv-oic-evs  WV Offices of the Insurance Commissioner Employer Violator System: employers in default on workers'
 *                 compensation money owed (barred from state licenses and permits until paid), every business by
 *                 first letter (www.wvinsurance.gov/EVS; robots.txt absent). Companies only; owner names are not kept.
 *     wv-purchasing-debarred  NOT REGISTERED since 2026-10-15 (see `blocked`: the Division's current host disallows
 *                 every robot, and the legacy host would be a side door). Was: WV Purchasing Division debarred vendors: "vendors who are currently debarred from doing
 *                 business with the State of West Virginia" under W. Va. Code §5A-3-33c and 33d (one HTML table:
 *                 Vendor Name, Vendor Address, Debarment Date, Debarment Period, Debarment Scope), linked from the
 *                 Purchasing Division's site www.state.wv.us/admin/purchase (robots.txt there disallows only /scripts,
 *                 /admin/purchase/awards/ and a pharmacy-council folder). Companies only: named people and rows
 *                 "… Individually and as …" are left out.
 *
 * None of these publish a street address or phone for a person; electricians give city and state only.
 *
 * Not searched any more (2026-10-15): the Division of Labor "Current Certified Plumbers / HVAC Technicians" lists
 * (www.wvlabor.com/new_searches, linked from labor.wv.gov/database-search). www.wvlabor.com answers robots.txt with
 * HTTP 500 ("The page cannot be displayed because an internal server error has occurred."), which RFC 9309 and
 * ../http.ts read as a refusal of the whole host, so it is listed under `blocked`.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch, politeText, rethrowIfBlocked, sleep } from "../http";
import { looksLikeBusiness } from "./lib/business-name";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import { normLicense } from "../identifiers";
import { tokens } from "../licenses";
import type { LiveLicenseSearch, StatePack } from "./types";
import { dmyDate, hasAllWords, htmlText } from "./lib/g3-common";

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
      address: null, phone: null, people: [{ name: who, role: "Licensee" }], holder: "individual",
    };
    const prev = best.get(no);
    if (!prev || (expires ?? "") > (prev.expires ?? "")) best.set(no, hit);
  }
  return Array.from(best.values());
}

// Only the honest UA, the form's content type and Accept are sent: no X-Requested-With or Referer posing as the site's
// own page (audit 2026-10-15, decision 12; the endpoint answered the same without them on 2026-10-15).
async function sfmRead(fields: { FirstName?: string; LastName?: string; LicenseNumber?: string }): Promise<SfmRow[]> {
  const body = new URLSearchParams({ sort: "", group: "", filter: "", FirstName: fields.FirstName ?? "", LastName: fields.LastName ?? "", City: "", LicenseNumber: fields.LicenseNumber ?? "" });
  const res = await politeFetch(SFM_READ, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "application/json" } }, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`WV Fire Marshal search returned HTTP ${res.status}`);
  const j = await res.json() as { Data?: SfmRow[]; Errors?: unknown };
  if (!Array.isArray(j.Data)) throw new Error("WV Fire Marshal search returned an unexpected payload");
  return j.Data;
}

const SFM: LiveLicenseSearch = {
  source: "WV State Fire Marshal electrician licenses", sourceUrl: SFM_PAGE,
  // Electrician licenses are people's: a company name is not searched here (round 2, decision 8).
  kinds: ["person"],
  search: async (name, kind) => {
    const w = tokens(name);
    if (kind !== "person" || w.length < 2) return []; // individual licenses only
    return sfmHits(await sfmRead({ FirstName: w[0], LastName: w[w.length - 1] }), "principal").filter((h) => hasAllWords(name, h.principal));
  },
  searchBy: async (q: IdQuery) => {
    if (q.type !== "license" || !normLicense(q.value)) return null; // only license numbers are searchable
    return sfmHits(await sfmRead({ LicenseNumber: q.value.trim() }), "license").filter((h) => normLicense(h.licenseNumber) === normLicense(q.value));
  },
};

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

/**
 * The rows that name a business. A sole proprietor's "Business Name" is often the owner's own ("MACKEY VANESSA J"):
 * such a row is a person and is left out (companies only, FCRA; audit 2026-10-15, decision 5).
 */
export const evsBusinesses = (html: string) => parseEvs(html).filter((r) => looksLikeBusiness(r.name));

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
        // An access denial (401/403, robots.txt, a long Retry-After) is final: never retried around, and it keeps its
        // type so the load stops as blocked (round 2, decision 6).
        rethrowIfBlocked(err);
        if (attempt >= 2) throw new Error(`EVS letter ${letter}: ${String((err as Error)?.message ?? err)}`);
        await sleep(30_000);
      }
    }
    if (!/Showing results for: Business\/DBA Name starts with/.test(html)) throw new Error(`EVS letter ${letter}: unexpected page`);
    for (const r of evsBusinesses(html)) {
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

// ── Purchasing Division debarred vendors ─────────────────────────────────────────────────────────────────────
const DEBAR = "https://www.state.wv.us/admin/purchase/debar.html";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "June 10, 2022" / "April 20,2021" → YYYY-MM-DD (every date of a cell, in order); anything else is skipped. */
export function longDates(v: string | null | undefined): string[] {
  return Array.from((v ?? "").matchAll(/\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/g)).flatMap((m) => {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    return mo >= 0 && Number(m[3]) >= 1900 ? [`${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`] : [];
  });
}

export type WvDebarRow = { name: string; city: string | null; dates: string | null; period: string | null; scope: string | null };

/** The table rows (header row skipped). A page without the table's header is an error, not "no debarments". */
export function parseWvDebar(html: string): WvDebarRow[] {
  if (!/Vendor Name[\s\S]{0,200}Vendor Address[\s\S]{0,200}Debarment Date/i.test(html)) throw new Error("WV Purchasing debarred vendors: unexpected page");
  const out: WvDebarRow[] = [];
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const raw = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (raw.length < 5) continue;
    const name = htmlText(raw[0]);
    if (!name || /^vendor name$/i.test(name)) continue;
    // The first "City, ST 12345" line of the address cell (some rows list two addresses).
    const lines = raw[1].split(/<br\s*\/?>|<\/p>/i).map((l) => htmlText(l) ?? "");
    const at = lines.map((l) => l.match(/^(.+?),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?$/)).find(Boolean);
    out.push({ name, city: at ? `${at[1]}, ${at[2]}` : null, dates: htmlText(raw[2]), period: htmlText(raw[3]), scope: htmlText(raw[4]) });
  }
  return out;
}

/**
 * The rows about a business. The list names people too ("Andrew P. Nichols", "May Baqai Individually and as Notice
 * of Process Recipient for Planet Cellular Inc."): a row is kept only when its name reads as a business and does not
 * name someone "Individually" (companies only, FCRA).
 */
export const wvDebarBusinesses = (rows: WvDebarRow[]) => rows.filter((r) => !/\bindividually\b/i.test(r.name) && looksLikeBusiness(r.name));

/** One row as a report hit. Every row is current: the page lists "vendors who are currently debarred". */
export function wvDebarHit(r: WvDebarRow): EnforcementHit {
  const [first, ...later] = longDates(r.dates);
  return {
    state: "WV", source: "WV Purchasing Division debarred vendors", sourceUrl: DEBAR, category: "debarment",
    name: r.name, id: null, date: first ?? null, endDate: null,
    status: `Debarred from doing business with the State of West Virginia${r.period ? ` (debarment period: ${r.period})` : ""}`,
    city: r.city,
    detail: [r.scope ? `Scope: ${r.scope}` : null, later.length ? `updated ${later.join(", ")}` : null].filter(Boolean).join("; ") || null,
    amount: null, adverse: true,
  };
}

async function* wvDebarLoader(): AsyncIterable<BulkHit> {
  const html = await politeText(DEBAR, {}, { minDelayMs: 1500 });
  if (!/currently debarred/i.test(html)) throw new Error("WV Purchasing debarred vendors: unexpected page");
  for (const r of wvDebarBusinesses(parseWvDebar(html))) yield { kind: "enforcement", hit: wvDebarHit(r), business: r.name, person: null };
}

const BULK: BulkSource[] = [
  // 2,647 rows (business, city, masked FEIN) on 2026-10-15.
  { id: "wv-oic-evs", state: "WV", label: "WV Employer Violator System (workers' comp default)", pageUrl: EVS, everyHours: 24 * 7, minRows: 1_500, load: evsLoader, companiesOnly: true, category: "debarment",
    // Row shape 1: individuals are left out since 2026-10-15 (2,646 → 1,721 rows), so a shape-0 load is not a baseline.
    rowShape: 1 },
  // wv-purchasing-debarred is not registered (coordinator, 2026-10-15; see `blocked`). wvDebarLoader is kept, unused;
  // its stored rows are deleted at boot (bulk.ts RETIRED_BULK_SOURCES).
];
/** Kept for its tests and a possible return (not registered): the Division's debarred-vendor list as bulk rows. */
export const wvDebarredLoader = wvDebarLoader;

export const pack: StatePack = {
  state: "WV",
  checked: "2026-10-15",
  liveLicenses: [SFM],
  bulk: BULK,
  blocked: [
    "WV Contractor Licensing Board license search and board actions (wvclboard.wv.gov/verify, linked as \"Contractor License Search\" from labor.wv.gov/database-search; /about/actions.asp): robots.txt \"User-agent: * / Disallow: /\" (re-checked 2026-10-15; http:// and www. redirect to the same file)",
    "WV Division of Labor certified plumbers, HVAC technicians, manufactured-housing licensees, elevator and amusement-ride inspectors and registered service companies (www.wvlabor.com/new_searches/*.cfm, linked from labor.wv.gov/database-search): robots.txt answers HTTP 500 (2026-10-15), read as a refusal of the host (RFC 9309); https:// does not connect",
    "WV Purchasing Division debarred vendors (purchasing.wv.gov, and the same list on the Division's legacy host www.state.wv.us/admin/purchase/debar.html; was wv-purchasing-debarred): purchasing.wv.gov's robots.txt is \"User-Agent: * / Disallow: /\", and reading the same list from the legacy host would be a side door around that refusal (coordinator's decision, 2026-10-15)",
    "WV Secretary of State business search (apps.sos.wv.gov/business/corporations): the form carries bot-trap fields, treated as an anti-bot measure; bulk data is a paid subscription",
  ],
};
