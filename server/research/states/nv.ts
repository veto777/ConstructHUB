/**
 * Nevada. Checked live 2026-10-15.
 *
 *   NV NSCB contractor licenses: the Nevada State Contractors Board's public License Search
 *     (app.nvcontractorsboard.com, ContractorLicenseSearch.aspx), by company name or by principal / qualified
 *     individual, or by license number. Every status the board lists (active, suspended, revoked, cancelled,
 *     surrendered), with the classification(s), DBA name and NV business id; each hit's License Details page (up to
 *     10 per search) adds the physical and mailing address, phone, expiration, monetary limit, principals (with
 *     relation) and qualified individuals.
 *   NV NSCB disciplinary and board actions: the board's Public Disciplinary and Board Actions search, one date-range
 *     search from 2001-01-01 to today (about 6,800 actions): date, licensee, license number and action type
 *     (Administrative Citation, Disciplinary Hearing, and their pending forms). Companies only.
 *   NV Labor Commissioner disqualified contractors: the list of contractors that may not be awarded a public works
 *     contract (NRS 338.017), with the suspension period. Companies only; the corporate officers it names are left out.
 */
import { flipPerson, personText } from "../person-name";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch, rethrowIfBlocked } from "../http";
import { tokens, wholeWordMatch } from "../licenses";
import { clean } from "../bulk";
import type { BulkHit, BulkSource } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { FormSession, cellText, tableRows } from "./lib/g7-aspnet";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { withNote } from "../notes";
import { hasEnded } from "../adverse";
import { looksLikeBusiness } from "./lib/business-name";

const NSCB_APP = "https://app.nvcontractorsboard.com/Clients/NVSCB/Public";
const NSCB_LICENSE_SEARCH = `${NSCB_APP}/ContractorLicenseSearch/ContractorLicenseSearch.aspx`;
const NSCB_DISCIPLINE_SEARCH = `${NSCB_APP}/DisciplineSearch/DisciplineSearchPage.aspx`;
const NSCB_DISCIPLINE_PAGE = "https://www.nvcontractorsboard.com/investigations/disciplinary-and-board-actions/";
const NV_LABOR_DISQUALIFIED = "https://labor.nv.gov/PrevailingWage/Disqualified_Contractors/";
const P = "ctl00$ContentPlaceHolder1$";

// ── License search ───────────────────────────────────────────────────────────────────────────────────────────

/** Rows of the NSCB results table: Principal Name, Legal Business Name, DBA Name, License Number, NV Business ID, Classification, Status, City, State. */
export type NscbHit = LicenseHit & { detailsTarget?: string };

export function parseNscbLicenses(html: string, kind: "person" | "company" | "license"): NscbHit[] {
  const table = html.match(/<table[^>]*id="ContentPlaceHolder1_dtgResults"[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const out: NscbHit[] = [];
  for (const cells of tableRows(table)) {
    const detailsTarget = cells[1]?.match(/__doPostBack\(&#39;([^&]+)&#39;|__doPostBack\('([^']+)'/)?.slice(1).find(Boolean);
    if (cells.length < 9) continue;
    const [principal, legal, dba, number, bizId, classes, status, city, st] = cells.map(cellText);
    if (!number || /^License Number$/i.test(number)) continue;
    const classLines = (classes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const named = classLines.filter((l) => /^(A|B|AB|[A-C]-\d+[A-Z]?)\s/.test(l));
    const limits = classLines.filter((l) => !named.includes(l));
    out.push({
      state: "NV", source: "Nevada State Contractors Board licenses", sourceUrl: NSCB_LICENSE_SEARCH,
      businessName: [legal, dba && dba !== legal ? `dba ${dba}` : null].filter(Boolean).join(" ") || null,
      licenseNumber: number, licenseType: named.join("; ") || classLines.join("; ") || null,
      specialty: [limits.join(" ") || null, bizId ? `NV business id ${bizId}` : null].filter(Boolean).join(". ") || null,
      status, principal: personText(principal), city: [city, st].filter(Boolean).join(", ") || null, expires: null,
      matchedOn: kind === "company" ? "business" : kind === "license" ? "license" : "principal",
      // Every NSCB license is a contractor's license (classes A, B, C-…), issued to the contracting business named
      // in its legal-name column, its principal listed apart (publisher's definition; kept in round 3, decision 3).
      holder: "business",
      ...(detailsTarget ? { detailsTarget } : {}),
    });
  }
  return out;
}

/** "RADMALL, BRANDON  VAL" → "BRANDON VAL RADMALL". */
/** "LAST, FIRST" → "FIRST LAST" for one person; a published list stays a list (../person-name.ts). */
const flip = (v: string | null) => flipPerson(v);

/** The License Details page: addresses, phones, expiration, principals (with relation) and qualified individuals (with type). */
export function parseNscbDetails(html: string): { address: string | null; mailing: string | null; phone: string | null; mailPhone: string | null; expires: string | null; limit: string | null; people: { name: string; role: string | null }[] } {
  const span = (id: string) => cellText(html.match(new RegExp(`id="ContentPlaceHolder1_${id}"[^>]*>([\\s\\S]*?)</span>`))?.[1] ?? "");
  const addr = (st1: string, st2: string, city: string, state: string, zip: string) => {
    const street = [span(st1), span(st2)].filter(Boolean).join(" ");
    const tail = [span(city), [span(state), span(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return street ? clean(`${street}, ${tail}`) : null;
  };
  const people: { name: string; role: string | null }[] = [];
  for (const m of Array.from(html.matchAll(/lblPrincipalName_(\d+)">([^<]*)<[\s\S]*?lblPrincipalRelation_\1">([^<]*)</g))) { const n = flip(m[2]); if (n) people.push({ name: n, role: clean(m[3]) }); }
  for (const m of Array.from(html.matchAll(/lblQualIndName_(\d+)">([^<]*)<[\s\S]*?lblQaulType_\1">([^<]*)</g))) { const n = flip(m[2]); if (n) people.push({ name: n, role: clean(m[3]) ? `Qualified individual (${clean(m[3])})` : "Qualified individual" }); }
  const exp = span("lblExpireDate")?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return {
    address: addr("lblStrt1", "lblStrt2", "lblCityOne", "lblStateOne", "lblZipOne"),
    mailing: addr("lblMailStrt1", "lblMailStrt2", "lblMailCityOne", "lblMailStateOne", "lblMailZipOne"),
    phone: span("lblPhoneOne"), mailPhone: span("lblMailPhoneOne"),
    expires: exp ? `${exp[3]}-${exp[1]}-${exp[2]}` : null, limit: span("lblMonetaryLimit1"), people,
  };
}

const MAX_DETAILS = 10;

/** Open each hit's License Details page (a postback from the results page) for its addresses, phone, expiration and people. */
export async function withNscbDetails(s: Pick<FormSession, "postBack">, results: { url: string; html: string }, hits: NscbHit[]): Promise<LicenseHit[]> {
  let failed = 0;
  for (const h of hits.slice(0, MAX_DETAILS)) {
    if (!h.detailsTarget) continue;
    // A denied detail request stops the search (round 2, decision 6); any other failure skips that one license.
    const page = await s.postBack(results.url, results.html, { __EVENTTARGET: h.detailsTarget, __EVENTARGUMENT: "" }).catch((err) => { rethrowIfBlocked(err); return null; });
    if (!page || page.status !== 200 || !/lblLicNum/.test(page.html)) { failed++; continue; }
    const d = parseNscbDetails(page.html);
    h.address = d.address ?? d.mailing;
    h.phone = d.phone ?? d.mailPhone;
    h.expires = d.expires;
    if (d.limit) h.specialty = [h.specialty, `Monetary limit ${d.limit}`].filter(Boolean).join(". ");
    if (d.people.length) h.people = d.people;
    if (d.mailing && d.address && d.mailing !== d.address) h.specialty = [h.specialty, `Mailing address ${d.mailing}`].filter(Boolean).join(". ");
  }
  return withNote(hits.map(({ detailsTarget: _t, ...h }) => h), [
    hits.length > MAX_DETAILS ? `address, phone, expiration and people read for the first ${MAX_DETAILS} of ${hits.length} licenses` : null,
    failed ? `the License Details page could not be read for ${failed} license(s)` : null,
  ].filter(Boolean).join("; "));
}

async function nscbSearch(by: "1" | "2" | "12", fields: Record<string, string>, kind: "person" | "company" | "license", keep: (h: NscbHit) => boolean): Promise<LicenseHit[]> {
  const s = new FormSession(1500);
  const first = await s.request(NSCB_LICENSE_SEARCH);
  if (first.status !== 200) throw new Error(`NSCB returned HTTP ${first.status}`);
  const picked = by === "1" ? first : await s.postBack(NSCB_LICENSE_SEARCH, first.html, { __EVENTTARGET: `${P}DdlSearchBy`, [`${P}DdlSearchBy`]: by });
  const res = await s.postBack(NSCB_LICENSE_SEARCH, picked.html, { [`${P}DdlSearchBy`]: by, ...fields, [`${P}btnSearch`]: "Submit" });
  if (res.status !== 200) throw new Error(`NSCB returned HTTP ${res.status}`);
  if (!/LicenseSearchResults|dtgResults|No (records|results)/i.test(res.url + res.html)) throw new Error("NSCB returned an unexpected page");
  return withNscbDetails(s, res, parseNscbLicenses(res.html, kind).filter(keep));
}

async function searchNscbLicenses(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const words = name.replace(/[^A-Za-z0-9&' -]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.join(" ").length < 2) return [];
  // Details are opened only for rows that really name the subject.
  const fields: Record<string, string> = kind === "company"
    ? { [`${P}inputCompany`]: words.join(" ").slice(0, 60) }
    : { [`${P}inputLastName`]: words[words.length - 1], [`${P}inputFirstName`]: words.length > 1 ? words[0] : "", [`${P}inputPrincipalCompanyName`]: "" };
  return nscbSearch(kind === "company" ? "2" : "12", fields, kind, (h) => wholeWordMatch(name, kind === "company" ? { businessName: h.businessName, principal: null } : { businessName: null, principal: h.principal }));
}

/** The NSCB search also takes a license number (it has no phone or address search). */
async function searchNscbBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null;
  const want = normLicense(q.value);
  if (!want) return null;
  return nscbSearch("1", { [`${P}inputLicenseNumber`]: q.value.trim() }, "license", (h) => normLicense(h.licenseNumber)?.replace(/^0+/, "") === want.replace(/^0+/, ""));
}

// ── Disciplinary and board actions (bulk) ────────────────────────────────────────────────────────────────────

const usDay = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

/** Rows of the discipline results: Date (ISO), Licensee(s), License Number, Type. Undated (1900-01-01) rows with no type follow a dated action and list its other licenses. */
export function parseNscbDiscipline(html: string): EnforcementHit[] {
  const table = html.match(/<table[^>]*id="ContentPlaceHolder1_dtgSearchResults"[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const out: EnforcementHit[] = [];
  for (const cells of tableRows(table)) {
    if (cells.length < 4) continue;
    const [date, who, lic, type] = cells.map(cellText);
    const day = date?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    if (!who || !day) continue;
    if (day.startsWith("1900")) {
      const prev = out[out.length - 1];
      if (prev && prev.name === who && lic && !prev.detail?.includes(lic)) prev.detail = `${prev.detail}; also lists license ${lic}`;
      continue;
    }
    const pending = /^pending/i.test(type ?? "");
    out.push({
      state: "NV", source: "Nevada State Contractors Board disciplinary and board actions", sourceUrl: NSCB_DISCIPLINE_PAGE,
      category: "discipline", name: who, id: null, date: day, endDate: null,
      status: type ?? "Board action (type not given)", city: null,
      detail: lic ? `License ${lic}` : null, amount: null,
      adverse: pending ? null : /citation/i.test(type ?? "") ? true : null,
      licenseNumber: lic,
    });
  }
  return out;
}

async function* nscbDisciplineLoader(): AsyncIterable<BulkHit> {
  const s = new FormSession(2000, 10 * 60_000);
  const first = await s.request(NSCB_DISCIPLINE_SEARCH);
  if (first.status !== 200) throw new Error(`NSCB returned HTTP ${first.status}`);
  const res = await s.postBack(NSCB_DISCIPLINE_SEARCH, first.html, {
    [`${P}ddlMonth`]: "0", [`${P}ddlYear`]: "0", [`${P}ddlType`]: "1", [`${P}ddlSortBy`]: "1",
    [`${P}txtStartDate`]: "01/01/2001", [`${P}tbEndDate`]: usDay(new Date()), [`${P}ddlType1`]: "1", [`${P}ddlSortValue1`]: "1",
    [`${P}btnDateRange`]: "Search Date Range",
  });
  if (res.status !== 200) throw new Error(`NSCB returned HTTP ${res.status}`);
  for (const h of parseNscbDiscipline(res.html)) {
    // The board disciplines individuals too ("SMITH, JOHN"): only businesses are loaded (companies only, FCRA).
    if (!looksLikeBusiness(h.name)) continue;
    const others = Array.from(h.detail?.matchAll(/also lists license (\S+)/g) ?? []).map((m) => m[1]);
    yield { kind: "enforcement", hit: h, business: h.name, person: null, keys: { licenses: [h.licenseNumber, ...others] } };
  }
}

// ── Labor Commissioner disqualified contractors (live, one page) ─────────────────────────────────────────────

/**
 * The list is one HTML table in blocks: the contractor's name line(s) and address lines in the first column, the
 * corporate officers in the second, the suspension period in the third; blank rows separate the blocks.
 */
const longDay = (v: string): string | null => { const d = new Date(`${v} 12:00 UTC`); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };

export function parseNvDisqualified(html: string, today?: string): EnforcementHit[] {
  const table = html.match(/<table[\s\S]*?Suspension[\s\S]*?<\/table>/i)?.[0];
  if (!table) return [];
  const blocks: string[][][] = [];
  let cur: string[][] = [];
  for (const cells of tableRows(table)) {
    const vals = cells.map((c) => cellText(c) ?? "");
    if (vals.every((v) => !v.trim())) { if (cur.length) blocks.push(cur); cur = []; continue; }
    if (/^Contractor$/i.test(vals[0]?.trim() ?? "")) continue;
    cur.push(vals);
  }
  if (cur.length) blocks.push(cur);
  const out: EnforcementHit[] = [];
  for (const b of blocks) {
    const col0 = b.map((r) => r[0]?.trim()).filter(Boolean) as string[];
    // The first line is always a name (some start with a digit: "360 Pro Carpentry LLC"); the address starts at the next street or PO box line.
    const firstAddress = col0.findIndex((l, i) => i > 0 && /^\d|^P\.?\s?O\.?\s?Box/i.test(l));
    const lines = (firstAddress < 0 ? col0.slice(0, 1) : col0.slice(0, firstAddress)).map((n) => n.replace(/^DBA\s+/i, "dba "));
    const periodText = clean(b.map((r) => r[2] ?? "").join(" "));
    if (!lines.length || !periodText) continue; // a note row ("Updated October 13, 2026"), not a contractor
    // Companies only: a name line that is a person's ("Stuart Spear", "John Ray Phenix") is left out; a "dba" line is a trade name.
    const names = lines.filter((n) => /^dba\s/i.test(n) || looksLikeBusiness(n)).map((n) => n.replace(/^dba\s+/i, ""));
    if (!names.length) continue;
    const cityLine = firstAddress >= 0 ? col0.slice(firstAddress).map((l) => l.match(/^([A-Za-z .'-]+?),?\s+([A-Z]{2})\s+\d{5}/)).find(Boolean) : null;
    const period = periodText;
    // "July 18, 2025 to July 18, 2028": the period's own dates; "Until the suspension is lifted" has none.
    const [from, to] = Array.from(period.matchAll(/([A-Z][a-z]+ \d{1,2}, \d{4})/g), (m) => longDay(m[1]));
    const over = hasEnded(to, today);
    out.push({
      state: "NV", source: "Nevada Labor Commissioner disqualified contractors", sourceUrl: NV_LABOR_DISQUALIFIED,
      category: "debarment", name: names.join(" / "), id: null, date: from ?? null, endDate: to ?? null,
      status: over ? `Disqualification period over: ${period}` : `Disqualified from public works: ${period}`,
      city: cityLine ? `${cityLine[1].trim()}, ${cityLine[2]}` : null,
      detail: "On the Labor Commissioner's list of contractors disqualified under NRS 338.017", amount: null, adverse: !over,
      address: firstAddress >= 0 ? clean(col0.slice(firstAddress).join(", ")) : null,
    });
  }
  return out;
}

let disqualified: { at: number; hits: EnforcementHit[] } | null = null;
async function searchNvDisqualified(name: string): Promise<EnforcementHit[]> {
  if (!disqualified || Date.now() - disqualified.at > 6 * 3600_000) {
    const res = await politeFetch(NV_LABOR_DISQUALIFIED, {}, { minDelayMs: 1500 });
    if (!res.ok) throw new Error(`Labor Commissioner returned HTTP ${res.status}`);
    const hits = parseNvDisqualified(await res.text());
    if (hits.length < 20) throw new Error("the disqualified-contractor list changed layout");
    disqualified = { at: Date.now(), hits };
  }
  const want = tokens(name);
  return disqualified.hits.filter((h) => h.name?.split(" / ").some((n) => { const have = new Set(tokens(n)); return want.every((w) => have.has(w)); }));
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: "Nevada State Contractors Board licenses", sourceUrl: NSCB_LICENSE_SEARCH, search: searchNscbLicenses, searchBy: searchNscbBy },
];

const bulk: BulkSource[] = [
  {
    id: "nv-nscb-discipline", state: "NV", label: "Nevada State Contractors Board disciplinary and board actions (2001 to today)",
    pageUrl: NSCB_DISCIPLINE_PAGE, everyHours: 24 * 7, minRows: 4700, companiesOnly: true, category: "discipline", load: nscbDisciplineLoader,
  },
];

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Nevada Labor Commissioner disqualified contractors", scope: "Contractors barred from public works contracts (NRS 338.017), current list", category: "debarment", search: searchNvDisqualified },
];

export const pack: StatePack = {
  state: "NV",
  checked: "2026-10-15",
  liveLicenses,
  bulk,
  liveEnforcement,
  blocked: [
    "NSCB contractor listing (ListingSearch.aspx, active licensees with expiry and monetary limit): usable, but it repeats the live license search for active licenses only and has no principals, so it is not loaded",
    "Nevada Secretary of State business search (esos.nv.gov): every page answers an Incapsula bot challenge",
  ],
};
