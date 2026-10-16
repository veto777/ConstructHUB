/**
 * West Virginia. Checked live 2026-10-15.
 *
 *   Live license searches (no CAPTCHA):
 *     WV Contractor Licensing Board Contractor Search (wvclboard.wv.gov/verify, linked as "Contractor License Search"
 *       from labor.wv.gov/database-search): the page's own JSON calls (POST /verify/ajax/ action=verifySearch with
 *       licNo/busiClas/busiName/busiDba/city/cnty answers a count and keeps the result in the session; action=verifyPage
 *       reads it back), by company name, DBA (a phrase matched anywhere in the field) or license number ("WV001838").
 *       Columns as published: License #, Company, DBA, Address, County, Phone, Classification, Expires; no status and
 *       no ownership type. A sole proprietor's license is under the person's own name. The page's script carries an
 *       unused reCAPTCHA hook (off; no CAPTCHA was shown); its robots.txt disallows every robot, searched by OWNER
 *       ORDER 2026-10-15 (../http.ts).
 *     WV State Fire Marshal licenses: the public Licensee Search's own JSON read endpoint
 *       (sfm-permit-public.wvoasis.gov/publicdata/LicenseeSearch, linked from firemarshal.wv.gov's Regulatory and
 *       Licensing Division page; robots.txt 404), by first and last name or license number. Its rows are mostly
 *       electricians (journeyman, master, low voltage) but also fire protection workers, home inspectors, building code
 *       officials, blasters and pyrotechnicians (license types as published, e.g. "JOURNEYMAN,ELECTRICIAN").
 *   Bulk:
 *     wv-clb-actions  WV Contractor Licensing Board "Disciplinary Action" table (wvclboard.wv.gov/about/actions.asp:
 *                 Date of Board Decision, License #, Licensee, a link to the Final Order PDF). Companies only: a person
 *                 is never kept ("X DBA Y" keeps the trade name). The orders' terms are in the PDFs and are not read.
 *     wv-oic-evs  WV Offices of the Insurance Commissioner Employer Violator System: employers in default on workers'
 *                 compensation money owed (barred from state licenses and permits until paid), every business by
 *                 first letter (www.wvinsurance.gov/EVS; robots.txt absent). Companies only; owner names are not kept.
 *     wv-purchasing-debarred  Back on by OWNER ORDER 2026-10-15 (the Division's robots.txt Disallow no longer stops a
 *                 search; ../http.ts). WV Purchasing Division debarred vendors: "vendors who are currently debarred from doing
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
import { Session } from "./lib/g6-common";
import { anyDay, businessParts } from "./lib/g8-common";
import { capNote, noteOf, withNote } from "../notes";

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

// ── Contractor Licensing Board ───────────────────────────────────────────────────────────────────────────────
const CLB_PAGE = "https://wvclboard.wv.gov/verify/";
const CLB_AJAX = "https://wvclboard.wv.gov/verify/ajax/";
const CLB_ACTIONS = "https://wvclboard.wv.gov/about/actions.asp";
/** One page of the search: the page's own script asks for 20; 100 answered the same on 2026-10-15. */
const CLB_PER_PAGE = 100;
const CLB_MAX_PAGES = 3;
export type ClbRow = { license?: string | null; company?: string | null; dba?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; county?: string | null; phone?: string | null; class?: string | null; expires?: string | null };

/**
 * One row of the Board's Contractor Search as a license hit, in the search's own columns (License #, Company, DBA,
 * Address, County, Phone, Classification, Expires). The search shows no status and no ownership type, so `status`
 * and `holder` are null (a holder the publisher doesn't name keeps city, state and ZIP only). A "Company" that reads
 * as a person's name (a sole proprietor's license, "RANDALL A MARCHESI") is the licensee, not a business name.
 */
export function clbHit(r: ClbRow, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  const no = clean(r.license), company = clean(r.company), dba = clean(r.dba);
  if (!no || !company) return null;
  const isBusiness = looksLikeBusiness(company);
  return {
    state: "WV", source: "WV Contractor Licensing Board contractor licenses", sourceUrl: CLB_PAGE,
    businessName: isBusiness ? [company, dba ? `dba ${dba}` : null].filter(Boolean).join(" ") : dba,
    licenseNumber: no, licenseType: clean(r.class), specialty: null, status: null, principal: isBusiness ? null : company,
    city: [clean(r.city), clean(r.state)].filter(Boolean).join(", ") || null,
    expires: anyDay(r.expires), matchedOn,
    address: clean(r.address), phone: clean(r.phone),
    ...(isBusiness ? {} : { people: [{ name: company, role: dba ? "Licensee, doing business as the name above" : "Licensee" }] }),
    holder: null, // the search publishes no ownership type
  };
}

const clbParse = (text: string): { records?: (ClbRow & { count?: unknown })[] } => {
  try { return JSON.parse(text); } catch { throw new Error("WV Contractor Licensing Board search returned an unexpected payload"); }
};

/**
 * One search as the page runs it: "verifySearch" answers the count and keeps the result in the session, "verifyPage"
 * reads it back a page at a time. Only the form's own fields go up (no Referer or X-Requested-With).
 */
export async function clbSearch(fields: { licNo?: string; busiName?: string; busiDba?: string }): Promise<ClbRow[]> {
  const s = new Session(2000);
  const post = (body: Record<string, string>) => s.text(CLB_AJAX, {
    method: "POST", body: new URLSearchParams(body).toString(), headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "application/json" },
  }, "WV Contractor Licensing Board search");
  const head = clbParse(await post({ action: "verifySearch", licNo: fields.licNo ?? "", busiClas: "", busiName: fields.busiName ?? "", busiDba: fields.busiDba ?? "", city: "", cnty: "" }));
  const total = Number(head.records?.[0]?.count);
  if (!Number.isFinite(total)) throw new Error("WV Contractor Licensing Board search returned an unexpected payload");
  const rows: ClbRow[] = [];
  for (let page = 1; rows.length < total && page <= CLB_MAX_PAGES; page++) {
    const got = clbParse(await post({ action: "verifyPage", pageNo: String(page), recsPage: String(CLB_PER_PAGE) })).records ?? [];
    if (!got.length) break;
    rows.push(...got);
  }
  return withNote(rows, rows.length < total ? capNote(rows.length, total, "licenses") : null);
}

const CLB_SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LC|L C|PLLC|LLP)\b\.?/gi;
/** The name as the search takes it: a whole phrase matched anywhere in the field, so suffixes and punctuation go. */
export const clbQuery = (name: string) => clean(name.replace(/[.,]/g, " ").replace(CLB_SUFFIX, " ").replace(/\s+/g, " ")) ?? name.trim();

function clbMerge(lists: ClbRow[][], matchedOn: LicenseHit["matchedOn"]): LicenseHit[] {
  const out = new Map<string, LicenseHit>();
  for (const rows of lists) for (const r of rows) { const h = clbHit(r, matchedOn); if (h && !out.has(h.licenseNumber!)) out.set(h.licenseNumber!, h); }
  return withNote(Array.from(out.values()), lists.map(noteOf).filter(Boolean).join("; ") || null);
}

const CLB: LiveLicenseSearch = {
  source: "WV Contractor Licensing Board contractor licenses", sourceUrl: CLB_PAGE,
  search: async (name, kind) => {
    if (kind === "person") {
      // A sole proprietor's license is under the person's own name in the Company column: searched by the last name,
      // the runner keeps the whole-name matches.
      const w = tokens(name);
      if (w.length < 2) return [];
      return clbMerge([await clbSearch({ busiName: w[w.length - 1] })], "principal");
    }
    const q = clbQuery(name);
    if (q.length < 2) return [];
    let lists = [await clbSearch({ busiName: q }), await clbSearch({ busiDba: q })];
    if (!lists.some((l) => l.length)) {
      // The search matches the whole phrase ("March Westin" misses "MARCH-WESTIN"); fall back to its longest word.
      const word = q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
      if (word && word.length >= 4 && word !== q) lists = [await clbSearch({ busiName: word }), await clbSearch({ busiDba: word })];
    }
    return clbMerge(lists, "business");
  },
  searchBy: async (q: IdQuery) => {
    if (q.type !== "license" || !normLicense(q.value)) return null; // only license numbers are searchable
    const v = q.value.trim().toUpperCase();
    if (v.length < 4) return null; // the form needs at least 4 characters
    const hits = clbMerge([await clbSearch({ licNo: v })], "license");
    return withNote(hits.filter((h) => normLicense(h.licenseNumber) === normLicense(q.value)), noteOf(hits));
  },
};

/** One row of the Board's "Disciplinary Action" table (Date of Board Decision, License #, Licensee, Final Order). */
export type ClbAction = { decided: string | null; licenses: string[]; licensee: string; orderDate: string | null; orderUrl: string | null };

/** The table rows. A page without the table's header is an error, not "no actions". */
export function parseClbActions(html: string): ClbAction[] {
  if (!/Date of Board Decision[\s\S]{0,300}License #[\s\S]{0,300}Licensee[\s\S]{0,300}Final Order/i.test(html)) throw new Error("WV Contractor Licensing Board actions: unexpected page");
  const out: ClbAction[] = [];
  for (const m of Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const raw = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (raw.length < 4) continue;
    const licensee = htmlText(raw[2]);
    if (!licensee) continue;
    const href = raw[3].match(/href="([^"]+)"/i)?.[1];
    out.push({
      decided: longDates(htmlText(raw[0]))[0] ?? null,
      licenses: (htmlText(raw[1]) ?? "").split(/[\/,;\s]+/).filter((x) => /\d/.test(x)),
      licensee, orderDate: longDates(htmlText(raw[3]))[0] ?? null,
      orderUrl: href ? new URL(href.replace(/&amp;/g, "&"), CLB_ACTIONS).toString() : null,
    });
  }
  return out;
}

/**
 * The businesses an action names, each with its license number when the row pairs them ("PRIME EXTERIORS LLC &
 * IRONCLAD CONSTRUCTION LLC" with "WV062785/WV064411"). A person is never kept: "BRANDON BALLARD DBA WV CONCRETE"
 * keeps the trade name only, and a row naming a person alone is left out (companies only, FCRA).
 */
export function clbActionBusinesses(a: ClbAction): { name: string; license: string | null }[] {
  const halves = a.licensee.split(/\s+&\s+/);
  if (a.licenses.length > 1 && halves.length === a.licenses.length && halves.every((h) => looksLikeBusiness(h))) {
    return halves.map((h, i) => ({ name: h, license: a.licenses[i] }));
  }
  return businessParts(a.licensee).map((name) => ({ name, license: a.licenses.length === 1 ? a.licenses[0] : a.licenses.join(", ") || null }));
}

export function clbActionHit(a: ClbAction, b: { name: string; license: string | null }): EnforcementHit {
  return {
    state: "WV", source: "WV Contractor Licensing Board disciplinary actions", sourceUrl: CLB_ACTIONS, category: "discipline",
    name: b.name, id: b.license, date: a.decided, endDate: null,
    status: "Disciplinary action taken by the WV Contractor Licensing Board (final order)",
    city: null,
    detail: [a.orderDate ? `Final order ${a.orderDate}` : "Final order", a.orderUrl].filter(Boolean).join(": "),
    amount: null, adverse: true, licenseNumber: b.license,
  };
}

async function* clbActionsLoader(): AsyncIterable<BulkHit> {
  const html = await politeText(CLB_ACTIONS, {}, { minDelayMs: 2000 });
  for (const a of parseClbActions(html)) {
    for (const b of clbActionBusinesses(a)) {
      yield { kind: "enforcement", hit: clbActionHit(a, b), business: b.name, person: null, keys: { licenses: b.license ? b.license.split(", ") : [] } };
    }
  }
}

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
  // 57 actions (2021-06-30 to 2025-04-17) on 2026-10-15; companies only. Back on by OWNER ORDER 2026-10-15 (the host's
  // robots.txt "Disallow: /" no longer stops a search; http.ts).
  { id: "wv-clb-actions", state: "WV", label: "WV Contractor Licensing Board disciplinary actions", pageUrl: CLB_ACTIONS, everyHours: 24 * 7, minRows: 40,
    load: clbActionsLoader, companiesOnly: true, category: "discipline" },
  // Back on by OWNER ORDER 2026-10-15 (purchasing.wv.gov's robots.txt Disallow no longer stops a search; http.ts).
  { id: "wv-purchasing-debarred", state: "WV", label: "WV Purchasing Division debarred vendors", pageUrl: DEBAR, everyHours: 24 * 7, minRows: 9,
    load: wvDebarLoader, companiesOnly: true, category: "debarment" },
];
/** Kept for its tests and a possible return (not registered): the Division's debarred-vendor list as bulk rows. */
export const wvDebarredLoader = wvDebarLoader;

export const pack: StatePack = {
  state: "WV",
  checked: "2026-10-15",
  liveLicenses: [SFM, CLB],
  bulk: BULK,
  blocked: [
    "WV Division of Labor certified plumbers, HVAC technicians, manufactured-housing licensees, elevator and amusement-ride inspectors and registered service companies (www.wvlabor.com/new_searches/*.cfm, linked from labor.wv.gov/database-search): robots.txt answers HTTP 500 (2026-10-15), read as a refusal of the host (RFC 9309); https:// does not connect",
    "WV Secretary of State business search (apps.sos.wv.gov/business/corporations): the form carries bot-trap fields, treated as an anti-bot measure; bulk data is a paid subscription",
  ],
};
