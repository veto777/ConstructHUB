/**
 * Delaware. Checked live 2026-10-15. Delaware licenses no general contractor: a contractor needs a Division of Revenue
 * business license (resident or non-resident contractor), which is searched here. The Division of Professional
 * Regulation's electrical and plumbing/HVACR licensees are already in ../licenses.ts.
 *
 * Licenses (open data, data.delaware.gov):
 *   Delaware Division of Revenue business licenses, contractor categories       5zy2-grhr
 *   Delaware DPR licensees: architects, landscape architects, land surveyors,
 *     geologists, home inspectors                                              pjnv-eaih (profession filter)
 *   DNREC water well and pump installer contractors                            2dnk-irgr
 *   DNREC on-site wastewater (septic) licensees: designers, site evaluators,
 *     system contractors, inspectors, liquid waste haulers                     56uc-mvju
 *   DNREC certified asbestos firms (abatement contractors, professional services) f677-ahd9
 *
 * Enforcement (bulk, weekly; the Department of Labor Division of Industrial Affairs' Construction Enforcement page,
 * industrialaffairs.delaware.gov, whose robots.txt disallows only HubSpot preview paths; delaware.gov states no reuse
 * terms beyond its privacy policy, checked 2026-10-15). Companies only:
 *   de-dol-wpfa-violators  Workplace Fraud Act violators (19 Del. C. ch. 35): employers with a final determination,
 *                          kept on the list for 3 years (the posting PDF).
 *   de-dol-pw-debarment    Prevailing wage debarment list (29 Del. C. §6960): contractors barred from public
 *                          construction contracts (the PDF; the people debarred "individually" are left out).
 */
import type { EnforcementHit } from "@shared/research-reports";
import type { LicenseSource } from "../licenses";
import type { BulkHit, BulkSource } from "../bulk";
import { clean } from "../bulk";
import { politeFetch, politeText } from "../http";
import { pdfText, textLines } from "./lib/a3-pdf";
import { looksLikeBusiness, personNameForm } from "./lib/business-name";
import type { StatePack } from "./types";

const soda = (id: string) => ({ datasetUrl: `https://data.delaware.gov/d/${id}`, url: `https://data.delaware.gov/resource/${id}.json` });

const LICENSES: LicenseSource[] = [
  { state: "DE", source: "Delaware Division of Revenue contractor business licenses", ...soda("5zy2-grhr"),
    fields: { businessName: "business_name", licenseNumber: "license_number", licenseType: "category", specialty: "trade_name", status: null, principal: null, city: "city", expires: "current_license_valid_to" },
    personField: null, address: "address_1", zip: "zip",
    // A Division of Revenue business license: the business holds it.
    holder: () => "business",
    filter: "category in ('RESIDENT CONTRACTOR','NON-RESIDENT CONTRACTOR','CONSTRUCTION MANAGER','CONSTRUCTION TRANSPORTATION CONTRACTOR','NON-RESIDENT CONST TRANSPORT CONTRACTOR')" },
  { state: "DE", source: "Delaware Division of Professional Regulation (architects, surveyors, geologists, home inspectors)", ...soda("pjnv-eaih"),
    fields: { businessName: null, licenseNumber: "license_no", licenseType: "license_type", specialty: "profession_id", status: "license_status", principal: null, city: "city", expires: "expiration_date" },
    personField: ["first_name", "last_name"],
    // A person's own professional license.
    holder: () => "individual",
    filter: "profession_id in ('Architecture','Landscape Architecture','Land Surveyors','Geologists','Home Inspectors')" },
  { state: "DE", source: "Delaware DNREC water well and pump installer contractors", ...soda("2dnk-irgr"),
    fields: { businessName: "orgname", licenseNumber: "licensenumber", licenseType: "licensesubtype", specialty: null, status: "licstatus", principal: null, city: null, expires: "licenseexpires" },
    personField: null, address: "workaddress", phone: "workphone",
    // licensesubtype, checked 2026-10-16: "Water Well Contractor" or "Pump Installer Contractor", a contractor's license.
    holder: (r) => (/contractor/i.test(String(r.licensesubtype ?? "")) ? "business" : null) },
  { state: "DE", source: "Delaware DNREC on-site wastewater system licensees", ...soda("56uc-mvju"),
    fields: { businessName: "companyname", licenseNumber: "licensenumber", licenseType: "licensesubtype", specialty: null, status: "licstatus", principal: "displayname", city: null, expires: null },
    personField: "displayname", address: "companyaddress", phone: "companyphone",
    // licensesubtype, checked 2026-10-16: Class E (System Contractor) and Class F (Liquid Waste) are a contractor's or
    // hauler's license; Classes A-D, H and I (testers, designers, evaluators, inspectors) are the named person's own.
    holder: (r) => (/^Class [EF]\b/.test(String(r.licensesubtype ?? "")) ? "business" : r.licensesubtype ? "individual" : null) },
  { state: "DE", source: "Delaware DNREC certified asbestos firms", ...soda("f677-ahd9"),
    fields: { businessName: "name", licenseNumber: "certno", licenseType: "certtype", specialty: null, status: null, principal: null, city: "city", expires: "expdate" },
    personField: null, address: "address1", zip: "zipcode", phone: "phone1",
    // Certified firms (Class A/B contractors, professional service firms).
    holder: () => "business" },
];

// ── Workplace Fraud Act violators (DOL Division of Industrial Affairs) ───────────────────────────────────────────

const DIA_PAGE = "https://industrialaffairs.delaware.gov/construction-enforcement";
const WPFA_SOURCE = "Delaware Department of Labor Workplace Fraud Act violators";
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const LONG_DATE = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),\\s*(\\d{4})\\b`);

export type WpfaRow = { name: string; city: string | null; date: string | null };

/** A line's text runs: words joined by single spaces, runs split by two or more (pdftotext -layout columns). */
const runs = (l: string) => Array.from(l.matchAll(/\S+(?: \S+)*/g)).map((m) => ({ at: m.index ?? 0, t: m[0] }));
/** "Galena, MD 21635", "Milford. DE 19963", "Newark, De 19702", "Glouster City, New Jersey": the city and state. */
const CITY_LINE = /^([A-Za-z][A-Za-z .'-]*?)[.,]\s*([A-Za-z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)?)(?:\s+\d{5}(?:-\d{4})?)?$/;

/**
 * The violators posting ("WPFA_Violators_Posting.pdf"): one row per employer, in three columns (Contractor,
 * Headquarters Address, Date of Final Determination/Decision), the name or address often wrapping onto other lines and
 * the columns shifting from page to page. Read by content: a block is the lines between blank lines; each line of it
 * belongs to the nearest line holding a date (the row's anchor); a run starting at or after the anchor's address
 * column is address, before it name. Only the city and state of the address are kept.
 */
export function parseWpfa(text: string): WpfaRow[] {
  const lines = textLines(text);
  const head = lines.findIndex((l) => /Contractor/.test(l) && /Headquarters/.test(l));
  if (head < 0) return [];
  const out: WpfaRow[] = [];
  let block: string[] = [];
  const flush = () => {
    const parsed = block.map(runs);
    const anchors = parsed.map((r, i) => (r.some((x) => LONG_DATE.test(x.t)) ? i : -1)).filter((i) => i >= 0);
    // The address column: the run before the date on the anchor line, else the leftmost run in the block that starts
    // with a house number or reads as a city line.
    const addressAt = (a: number) => {
      const r = parsed[a].filter((x) => !LONG_DATE.test(x.t));
      if (r.length >= 2) return r[r.length - 1].at;
      const cands = parsed.flat().filter((x) => /^\d/.test(x.t) || CITY_LINE.test(x.t)).map((x) => x.at);
      return cands.length ? Math.min(...cands) : Infinity;
    };
    const rows = anchors.map((a) => ({ at: addressAt(a), name: [] as string[], addr: [] as string[], date: null as string | null }));
    parsed.forEach((r, i) => {
      if (!anchors.length) return;
      const k = anchors.reduce((best, a, j) => (Math.abs(a - i) < Math.abs(anchors[best] - i) ? j : best), 0);
      const row = rows[k];
      for (const x of r) {
        const d = x.t.match(LONG_DATE);
        if (d) { row.date = `${d[3]}-${String(MONTHS.split("|").indexOf(d[1]) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`; continue; }
        (x.at >= row.at - 4 ? row.addr : row.name).push(x.t);
      }
    });
    // Each row has one city line. One on an anchor line is that row's; any other goes to the row before it when that row
    // has none yet (an address wraps downward), else to the row after (a street written above the name line).
    const cities: (RegExpMatchArray | null)[] = rows.map(() => null);
    parsed.forEach((r, i) => {
      for (const x of r) {
        const m = !/^\d/.test(x.t) && !LONG_DATE.test(x.t) ? x.t.match(CITY_LINE) : null;
        if (!m || !anchors.length) continue;
        const on = anchors.indexOf(i);
        const before = anchors.filter((a) => a < i).length - 1;
        const k = on >= 0 ? on : before >= 0 && !cities[before] ? before : Math.min(before + 1, anchors.length - 1);
        if (x.at >= rows[k].at - 4 && !cities[k]) cities[k] = m;
      }
    });
    rows.forEach((r, k) => {
      const name = clean(r.name.join(" "));
      const loc = cities[k];
      if (name) out.push({ name, city: loc ? `${loc[1].trim()}, ${loc[2].length === 2 ? loc[2].toUpperCase() : loc[2]}` : null, date: r.date });
    });
    block = [];
  };
  for (const l of lines.slice(head + 1)) {
    if (/^\s*\/*\s*Decision/i.test(l)) continue;
    if (!l.trim() || /\f/.test(l)) { flush(); if (!l.replace(/\f/g, "").trim()) continue; }
    block.push(l.replace(/\f/g, ""));
  }
  flush();
  return out;
}

/** One employer as an enforcement record: the Department's final determination that it violated the Act (adverse). */
export function wpfaHit(r: WpfaRow, sourceUrl: string): EnforcementHit {
  return {
    state: "DE", source: WPFA_SOURCE, sourceUrl, category: "wage", name: r.name, id: null, date: r.date, endDate: null,
    status: "Final determination: violated Delaware's Workplace Fraud Act (19 Del. C. ch. 35)",
    city: r.city, detail: "Listed by the Department of Labor for 3 years from the date of the final determination or decision", amount: null, adverse: true,
  };
}

// ── Prevailing wage debarment list (the same Division) ─────────────────────────────────────────────────────────

const DEBAR_SOURCE = "Delaware Department of Labor prevailing wage debarment list";

export type DeDebarRow = { name: string; company: string | null; city: string | null; terms: string | null };

/** "X, Inc. and Daniel Mullen, individually" → "X, Inc."; "X, LLC and Owner(s), individually" → "X, LLC". */
export const debarCompany = (name: string): string | null =>
  clean(name.replace(/,?\s+and\s+(?:(?:(?!\sand\s)[^,])+,\s*)?(?:owner\(s\)\s*)?,?\s*individually\.?$/i, "").replace(/,$/, ""));

/**
 * "PREVAILING WAGE DEBARMENT LIST" (29 Del. C. §6960): Contractor, Address and Date of Debarment columns, one row per
 * debarred contractor, each row starting on the line of its debarment terms ("Indefinite/ Civil Contempt") and its
 * name wrapping downward ("Mullen Brothers, Inc. / and / Daniel Mullen, individually"). Each line belongs to the row
 * above it; the anchor line's own column positions split name, address and terms. City and state only.
 */
export function parseDeDebar(text: string): { updated: string | null; rows: DeDebarRow[] } {
  const lines = textLines(text).map((l) => l.replace(/\f/g, ""));
  const head = lines.findIndex((l) => /Contractor/.test(l) && /Address/.test(l));
  const u = text.match(new RegExp(`Updated:\\s*(${MONTHS})\\s+(\\d{1,2}),\\s*(\\d{4})`));
  const updated = u ? `${u[3]}-${String(MONTHS.split("|").indexOf(u[1]) + 1).padStart(2, "0")}-${u[2].padStart(2, "0")}` : null;
  if (head < 0) return { updated, rows: [] };
  type Acc = { addrAt: number; termsAt: number; name: string[]; addr: string[]; terms: string[] };
  const acc: Acc[] = [];
  for (const l of lines.slice(head + 1)) {
    if (/^\s*Updated:/.test(l)) break;
    const r = runs(l);
    const t = r.find((x) => /^Indefinite\b/i.test(x.t) || LONG_DATE.test(x.t));
    if (t) {
      const before = r.filter((x) => x.at < t.at);
      acc.push({ addrAt: before.length >= 2 ? before[before.length - 1].at : Math.round(t.at * 0.55), termsAt: t.at, name: [], addr: [], terms: [] });
    }
    const cur = acc[acc.length - 1];
    if (!cur) continue;
    for (const x of r) (x.at >= cur.termsAt - 4 ? cur.terms : x.at >= cur.addrAt - 4 ? cur.addr : cur.name).push(x.t);
  }
  return {
    updated,
    rows: acc.map((a) => {
      const name = clean(a.name.join(" ")) ?? "";
      const loc = a.addr.map((x) => x.replace(/\s+and\/or$/i, "").match(CITY_LINE)).find((m) => m && !/^\d/.test(m[0]));
      return { name, company: debarCompany(name), city: loc ? `${loc[1].trim()}, ${loc[2].toUpperCase()}` : null, terms: clean(a.terms.join(" ").replace(/\/\s*/, ": ")) };
    }).filter((r) => r.name),
  };
}

const DE_DEBAR: BulkSource = {
  id: "de-dol-pw-debarment", state: "DE", label: DEBAR_SOURCE, pageUrl: DIA_PAGE, everyHours: 24 * 7, minRows: 4,
  companiesOnly: true, category: "debarment",
  load: async function* (): AsyncIterable<BulkHit> {
    const page = await politeText(DIA_PAGE, {}, { minDelayMs: 1500 });
    const href = page.match(/href="([^"]*Prevailing%20Wage%20Debarment%20List\.pdf[^"]*)"/)?.[1];
    if (!href) throw new Error("the Construction Enforcement page no longer links the prevailing wage debarment list");
    const url = new URL(href.replace(/&amp;/g, "&"), DIA_PAGE).toString();
    const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 90_000 });
    if (!res.ok) throw new Error(`Department of Labor returned HTTP ${res.status} for the debarment list`);
    const pdf = await pdfText(new Uint8Array(await res.arrayBuffer()));
    // The pure-JS reader runs this PDF's rows together (2026-10-15: two contractors and an individual in one "name"),
    // so the list is read only with pdftotext; without it the load fails and the previous load is kept.
    if (pdf.via !== "pdftotext") throw new Error("the debarment list needs pdftotext to be read reliably");
    const { updated, rows } = parseDeDebar(pdf.text);
    if (rows.length < 5) throw new Error(`the debarment list changed layout (${rows.length} rows read)`);
    for (const r of rows) {
      // Companies only (FCRA): the people debarred "individually" are never kept, and a name that still holds one (or a
      // street number: rows run together) is not published.
      if (!r.company || /individually|\b\d{3,}\b/i.test(r.company) || personNameForm(r.company) !== null || !looksLikeBusiness(r.company)) continue;
      const hit: EnforcementHit = {
        state: "DE", source: DEBAR_SOURCE, sourceUrl: url, category: "debarment", name: r.company, id: null, date: null, endDate: null,
        status: `Debarred from Delaware public construction contracts${r.terms ? ` (${r.terms})` : ""}`, city: r.city,
        detail: `29 Del. C. §6960 or other State statutes; the list says debarment runs three years from the judgment or as a court decides${updated ? `; list updated ${updated}` : ""}`,
        amount: null, adverse: true,
      };
      yield { kind: "enforcement", hit, business: r.company, person: null };
    }
  },
};

const DE_WPFA: BulkSource = {
  id: "de-dol-wpfa-violators", state: "DE", label: WPFA_SOURCE, pageUrl: DIA_PAGE, everyHours: 24 * 7, minRows: 20,
  companiesOnly: true, category: "wage",
  load: async function* (): AsyncIterable<BulkHit> {
    const page = await politeText(DIA_PAGE, {}, { minDelayMs: 1500 });
    const href = page.match(/href="([^"]*WPFA_Violators_Posting\.pdf[^"]*)"/)?.[1];
    if (!href) throw new Error("the Construction Enforcement page no longer links the Workplace Fraud Act violators posting");
    const url = new URL(href.replace(/&amp;/g, "&"), DIA_PAGE).toString();
    const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 90_000 });
    if (!res.ok) throw new Error(`Department of Labor returned HTTP ${res.status} for the violators posting`);
    const rows = parseWpfa((await pdfText(new Uint8Array(await res.arrayBuffer()))).text);
    if (rows.length < 20 || rows.some((r) => !r.date)) throw new Error(`the violators posting changed layout (${rows.length} rows read)`);
    // Companies only (FCRA): an employer listed under a person's name is left out.
    for (const r of rows) if (personNameForm(r.name) === null && looksLikeBusiness(r.name)) yield { kind: "enforcement", hit: wpfaHit(r, url), business: r.name, person: null };
  },
};

export const pack: StatePack = {
  state: "DE",
  checked: "2026-10-15",
  licenses: LICENSES,
  bulk: [DE_WPFA, DE_DEBAR],
  noStatewideGcLicense: "Delaware does not license general contractors; contractors hold a Division of Revenue contractor business license (searched above), and electricians, plumbers and HVACR contractors are licensed by the Division of Professional Regulation (searched above)",
  blocked: [
    "Delaware Division of Corporations entity search (icis.corp.delaware.gov): CAPTCHA on the search",
    "Delaware DPR disciplinary actions (data.delaware.gov dz6p-akeq): names individual licensees only (no business), so it can't be searched for companies",
    "Delaware court records: no court dataset on data.delaware.gov",
  ],
};
