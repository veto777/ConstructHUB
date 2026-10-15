/**
 * Mississippi. Every source here was opened and searched live on 2026-10-15; field labels and status words are the
 * board's own (CLAUDE.md: never fabricate government data).
 *
 *   MSBOC license search (search.msboc.us, the board's public "Consolidated Search"), live per report:
 *     commercial certificates of responsibility and residential licenses (builder, remodeler, residential
 *     electrical/HVAC/mechanical/plumbing/solar, roofing), searched by company name (Keyword) or by the person
 *     named as a qualifying party (QualName), with each match's detail page (status, expiration, classifications
 *     and their qualifying parties).
 *   MSBOC complaints and violations (search.msboc.us violations search, commercial and residential), live per
 *     report, companies only: statute violated, complaint and resolution dates, the resolution text (civil
 *     penalties, settlements).
 *   MSBOC revoked and suspended licenses, bulk: the board's own "View Results In Excel" export of its advanced
 *     search with status R (Revoked) and S (Suspended), daily, companies only.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { tokens } from "../licenses";
import { addressKeys, addressMatches, normLicense, type IdQuery } from "../identifiers";
import { download, usDate, type BulkHit, type BulkSource } from "../bulk";
import { promises as fs } from "node:fs";
import { firstAmount, tableRows, text } from "./lib/g4-html";
import { adverseFrom } from "../adverse";
import { capNote, noteOf, withNote } from "../notes";
import type { StatePack } from "./types";

const HOST = "http://search.msboc.us";
const SEARCH_PAGE = `${HOST}/ConsolidatedSearch.cfm`;
const RESULTS = `${HOST}/ConsolidatedResults.cfm?ContractorType=&VarDatasource=BOC`;
const VIOLATIONS_PAGE = "https://www.msboc.us/consumers/violators/";
const MAX_DETAILS = 15;

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (url: string, body: string, referer: string) =>
  politeFetch(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", referer } }, { minDelayMs: 1100 });

// ── License search ──────────────────────────────────────────────────────────────────────────────────────────

export type MsResultRow = { detail: string; type: string | null; name: string | null; address: string | null };

/** The rows of a Consolidated Search results page: detail link, licence type (Commercial/Residential), name, address. */
export function parseMsResults(html: string): MsResultRow[] {
  const out: MsResultRow[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<tr class="TR[^"]*">/).slice(1)) {
    const detail = block.match(/href="(Detail\.cfm\?[^"]+)"/)?.[1];
    if (!detail || seen.has(detail)) continue;
    seen.add(detail);
    const type = text(block.match(/<td style="background-color:[^"]*">([\s\S]*?)<\/td>/)?.[1]);
    const name = text(block.match(/<\/td>\s*<td nowrap>([\s\S]*?)<\/td>/)?.[1]);
    // After the license cell: street, city, state, zip, phone.
    const tail = block.split(/<\/table>\s*<\/td>/).pop() ?? "";
    const cells = Array.from(tail.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => text(c[1]));
    const address = cells.length >= 4 ? [cells[0], [cells[1], [cells[2], cells[3]].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null : null;
    out.push({ detail: `${HOST}/${detail.replace(/&amp;/g, "&")}`, type, name, address });
  }
  return out;
}

export type MsDetail = {
  name: string | null; licenseNumber: string | null; type: string | null; city: string | null; address: string | null; phone: string | null;
  expires: string | null; status: string | null; classes: { cls: string; qualifier: string | null }[]; officers: { name: string; title: string | null }[];
};

/** One license detail page (Detail.cfm). */
export function parseMsDetail(html: string): MsDetail {
  const field = (label: string) => text(html.match(new RegExp(`<td[^>]*class="TDHead"[^>]*>(?:<div[^>]*>)?\\s*${label}\\s*(?:</div>)?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i"))?.[1]);
  const head = html.match(/<h4>([\s\S]*?)<\/h4><\/td><td[^>]*>([^<]*)/);
  const addressCell = html.match(/Address<\/div><\/td>\s*<td[^>]*>([\s\S]*?)(?:<\/tr>|<\/td>)/i)?.[1] ?? "";
  const lines = addressCell.split(/<br\s*\/?>/i).map((l) => text(l)).filter((l): l is string => !!l && !/ County$/i.test(l));
  const cityState = lines[lines.length - 1]?.match(/^(.*?),\s*([A-Z]{2})\b/);
  const classTable = html.match(/<b>Class\(es\)<\/b>([\s\S]*?)(?:<\/table>|<b>Officers<\/b>)/i)?.[1] ?? "";
  const classes = tableRows(classTable).filter((r) => r.length >= 2 && r[0] && r[0] !== "Classification").map((r) => ({ cls: r[0]!, qualifier: r[1] }));
  const officerTable = html.match(/<b>Officers<\/b>([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const officers = tableRows(officerTable).filter((r) => r.length >= 2 && r[0] && r[0] !== "Name").map((r) => ({ name: r[0]!, title: r[1] }));
  return {
    name: text(head?.[1]), licenseNumber: text(head?.[2]), type: text(html.match(/<div id="contractorType"[^>]*>([^<]*)</)?.[1]),
    city: cityState ? `${cityState[1].trim()}, ${cityState[2]}` : null, address: lines.join(", ") || null, phone: field("Phone"),
    expires: usDate(field("Expiration")), status: field("Status"), classes, officers,
  };
}

async function msDetails(rows: MsResultRow[], matchedOn: LicenseHit["matchedOn"], name: string | null, page?: string): Promise<LicenseHit[]> {
  const hits: LicenseHit[] = withNote([], rows.length > MAX_DETAILS ? capNote(MAX_DETAILS, rows.length, "licenses (each one's detail page is read)") : null);
  for (const row of rows.slice(0, MAX_DETAILS)) {
    let html = page;
    if (!html) {
      const res = await politeFetch(row.detail, {}, { minDelayMs: 1100 });
      if (!res.ok) throw new Error(`MSBOC detail page returned HTTP ${res.status}`);
      html = await res.text();
    }
    const d = parseMsDetail(html);
    const want = tokens(name ?? "");
    const quals = Array.from(new Set(d.classes.map((c) => c.qualifier).filter((q): q is string => !!q)));
    // A person search names the qualifying party it matched; any other search lists the license's qualifiers.
    const principal = matchedOn === "principal" ? quals.filter((q) => { const have = new Set(tokens(q)); return want.every((w) => have.has(w)); }).join(" / ") || null : quals.join(" / ") || null;
    const people = [
      ...quals.map((q) => ({ name: q, role: `Qualifying party (${d.classes.filter((c) => c.qualifier === q).map((c) => c.cls).join(", ")})` })),
      ...d.officers.map((o) => ({ name: o.name, role: o.title })),
    ];
    hits.push({
      state: "MS", source: "Mississippi State Board of Contractors", sourceUrl: row.detail,
      businessName: d.name ?? row.name, licenseNumber: d.licenseNumber, licenseType: d.type ?? row.type,
      specialty: Array.from(new Set(d.classes.map((c) => c.cls))).join(", ") || null, status: d.status, principal,
      city: d.city, expires: d.expires, matchedOn, address: d.address ?? row.address, phone: d.phone, people,
      // A board contractor license (classes held through qualifying parties, with officers) is the business's (round 2, decision 2).
      holder: "business",
    });
  }
  return hits;
}

const BLANK = { Keyword: "", Co_Name: "", Dba_name: "", Lic: "", City: "", State: "", Zip: "", ClassCode: "", SearchStatus: "", searchType: "", QualName: "" };

/** Run one search; a single match opens its detail page directly, which is handled here too. */
async function msQuery(body: string, advanced: boolean, matchedOn: LicenseHit["matchedOn"], name: string | null, keep: (r: MsResultRow) => boolean): Promise<LicenseHit[]> {
  const res = await post(advanced ? `${RESULTS}&Advanced=1` : RESULTS, body, SEARCH_PAGE);
  if (!res.ok) throw new Error(`MSBOC search returned HTTP ${res.status}`);
  const html = await res.text();
  if (/No records were found matching your criteria/i.test(html)) return [];
  const id = html.match(/<div id="contractorID"[^>]*>(\d+)</)?.[1];
  if (id) {
    const type = html.match(/<div id="contractorType"[^>]*>([^<]*)</)?.[1]?.trim() ?? "Commercial";
    const d = parseMsDetail(html);
    const row = { detail: `${HOST}/Detail.cfm?ContractorID=${id}&ContractorType=${type}&varDataSource=${type === "Residential" ? "BOCRes" : "BOC"}`, type, name: d.name, address: d.address };
    return keep(row) ? msDetails([row], matchedOn, name, html) : [];
  }
  const count = html.match(/Records \d+ through (\d+) of (\d+)/i);
  if (!count) throw new Error("MSBOC returned an unexpected page");
  const hits = await msDetails(parseMsResults(html).filter(keep), matchedOn, name);
  // The board shows at most `maxrecords` rows; more than that are not on the page.
  return Number(count[2]) > Number(count[1]) ? withNote(hits, `the board's search listed ${count[1]} of ${count[2]} records; the rest were not read`) : hits;
}

/** Companies by name (the board's Keyword search), people by qualifying-party name (QualName); then each detail page. */
export async function searchMsboc(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const q = name.replace(/[^A-Za-z0-9&' .,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];
  const want = tokens(name);
  if (kind === "person") return msQuery(form({ ...BLANK, QualName: q, Advanced: "1", maxrecords: "100" }), true, "principal", name, () => true);
  return msQuery(form({ Keyword: q, Advanced: "0" }), false, "business", name, (r) => { const have = new Set(tokens(r.name ?? "")); return want.every((w) => have.has(w)); });
}

/**
 * By license number (the advanced search's Lic field, digits only as the board asks) or by street address (the Zip
 * field, then rows whose address is the query's). The board offers no phone search.
 */
export async function searchMsbocBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type === "license") {
    const digits = q.value.match(/\d+/)?.[0];
    if (!digits) return null;
    const want = normLicense(q.value);
    const hits = await msQuery(form({ ...BLANK, Lic: digits, Advanced: "1", maxrecords: "100" }), true, "license", null, () => true);
    return withNote(hits.filter((h) => normLicense(h.licenseNumber) === want), noteOf(hits));
  }
  if (q.type === "address") {
    const zip = addressKeys(q.value).find((k) => k.startsWith("z:"))?.slice(2);
    if (!zip) return null; // the board searches addresses by ZIP only: without one it can't be searched
    return msQuery(form({ ...BLANK, Zip: zip, Advanced: "1", maxrecords: "250" }), true, "address", null, (r) => addressMatches(q.value, r.address));
  }
  return null; // the board offers no phone search
}

// ── Complaints and violations ───────────────────────────────────────────────────────────────────────────────

/**
 * "04/02/24" → "2024-04-02" (the violations page prints two-digit years). The page lists recent complaints only (2023
 * to today on 2026-10-15), so a two-digit year is read as 20YY up to the current year; a later one could be 19YY or a
 * typo, so it is null rather than a guessed century (the raw text stays in the record's detail).
 */
export function msShortDate(v: string | null, now = new Date()): string | null {
  const m = v?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const yy = Number(m[3]);
  const year = m[3].length === 4 ? yy : yy <= now.getFullYear() % 100 ? 2000 + yy : null;
  const mo = Number(m[1]), d = Number(m[2]);
  if (year == null || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// The board's resolution words (checked 2026-10-15: "ASSESS CIVIL PENALTY …", "PUBLIC REPRIMAND", "SETTLED FOR $…",
// "SUSPEND LICENSE"). The not-adverse words are tested first ("Dismissed, no penalty imposed" contains "penalty").
const MS_ADVERSE = /PENALT|\bFINED?\b|REVOK|SUSPEN|CEASE AND DESIST|REPRIMAND|SETTLED FOR \$/i;
const MS_NOT_ADVERSE = /DISMISS|NO VIOLATION|UNFOUNDED|NO ACTION/i;

export function parseMsViolations(html: string, type: string, sourceUrl: string): EnforcementHit[] {
  const out: EnforcementHit[] = [];
  const re = /<tr>\s*<td><\/td>\s*<td><b>([\s\S]*?)<\/b><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr>[\s\S]*?Complaint:&nbsp;<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr>[\s\S]*?Resolution:&nbsp;<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  for (const m of Array.from(html.matchAll(re))) {
    const name = text(m[3]);
    if (!name) continue;
    const resolution = text(m[7]);
    out.push({
      state: "MS", source: "Mississippi State Board of Contractors complaints and violations", sourceUrl,
      category: "complaint", name, id: null, date: msShortDate(text(m[4])), endDate: msShortDate(text(m[5])),
      status: text(m[1]), city: null,
      detail: [`${type} contractor`, text(m[2]) ? `violation of ${text(m[2])}` : null, text(m[6]) ? `Complaint: ${text(m[6])}` : null, resolution ? `Resolution: ${resolution}` : null,
        text(m[4]) && !msShortDate(text(m[4])) ? `complaint date as printed: ${text(m[4])}` : null, text(m[5]) && !msShortDate(text(m[5])) ? `resolution date as printed: ${text(m[5])}` : null]
        .filter(Boolean).join(". ").slice(0, 900),
      amount: firstAmount(resolution),
      adverse: adverseFrom(resolution, { adverse: MS_ADVERSE, notAdverse: MS_NOT_ADVERSE }),
    });
  }
  return out;
}

export async function searchMsViolations(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/[^A-Za-z0-9&' .,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
  if (q.length < 3) return [];
  const hits: EnforcementHit[] = [];
  for (const type of ["Commercial", "Residential"]) {
    const page = `${HOST}/Search_violations2.cfm?contractorType=${type}`;
    const res = await post(`${HOST}/violations_results.cfm?ContractorType=${type}`,
      form({ Keyword: q, ViolationCodeID: "", OtherName: "", Complaint: "", ComplaintDate: "", Resolution: "", ResolutionDate: "", maxrecords: "250" }), page);
    if (!res.ok) throw new Error(`MSBOC violations search returned HTTP ${res.status}`);
    const html = await res.text();
    if (!/Records \d+ through|No Records|Complaints Search/i.test(html)) throw new Error("MSBOC violations search returned an unexpected page");
    hits.push(...parseMsViolations(html, type, page));
  }
  return hits;
}

// ── Revoked and suspended licenses (bulk) ───────────────────────────────────────────────────────────────────

/** The advanced search's own Excel export (an HTML table) for one status code. */
const exportUrl = (status: string) => `${HOST}/ConsolidatedResults.cfm?` + new URLSearchParams({
  ContractorType: "", maxrecords: "25", varDataSource: "BOC", Keyword: "", ClassCode: "", Co_Name: "", Lic: "", LicBegin: "", LicEnd: "",
  City: "", State: "", ZipCodes__county: "", Zip: "", Dba_name: "", Mnrty_cat: "", Expir_date_Begin: "", Expir_date_End: "", Expired: "",
  Print_cert: "", OrderBy: "v.Co_Name", GeneralLiabilityInsuranceActive: "", searchType: "", Advanced: "1", SearchStatus: status,
  issue_date_Begin: "", issue_date_End: "", enter_date_Begin: "", enter_date_end: "", qualName: "", lastmodified_begin: "", lastmodified_end: "", ViewExcel: "1",
}).toString();

const MS_STATUS: Record<string, string> = { R: "Revoked", S: "Suspended" };

/** Rows of the export: type, company name, "<license no> <status words>", address, city, state, zip, phone. */
export function parseMsExport(html: string, code: string): EnforcementHit[] {
  const out: EnforcementHit[] = [];
  for (const r of tableRows(html)) {
    if (r.length < 7 || !r[1] || /^Type$/i.test(r[0] ?? "")) continue;
    const lic = r[2]?.match(/^(\S+)\s*(.*)$/);
    // The row's own status words ("Revoked Expired", "Suspended"); the requested filter is only a cross-check.
    const words = lic?.[2]?.trim() || null;
    const own = words?.match(/revoked|suspended/i)?.[0].toLowerCase() ?? null;
    out.push({
      state: "MS", source: "Mississippi State Board of Contractors revoked and suspended licenses", sourceUrl: SEARCH_PAGE,
      category: "discipline", name: r[1], id: lic?.[1] ?? null, date: null, endDate: null,
      status: own ? `License ${own}${/expired/i.test(words ?? "") ? " (and expired)" : ""}` : words ? `License status: ${words}` : "License status not published",
      city: [r[4], r[5]].filter(Boolean).join(", ") || null,
      detail: `${r[0] ?? ""} license${lic?.[1] ? ` ${lic[1]}` : ""}, listed by the board in its ${MS_STATUS[code].toLowerCase()} search${words ? ` with status "${words}"` : ""}`.trim(),
      amount: null, adverse: own ? true : null,
      address: [r[3], r[4], [r[5], r[6]].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null, phone: r[7] ?? null, licenseNumber: lic?.[1] ?? null,
    });
  }
  return out;
}

async function* msRevokedSuspended(): AsyncIterable<BulkHit> {
  for (const code of ["R", "S"]) {
    const path = await download(exportUrl(code), { headers: { referer: SEARCH_PAGE } });
    try {
      for (const h of parseMsExport(await fs.readFile(path, "utf8"), code)) {
        yield { kind: "enforcement", hit: h, business: h.name, person: null, keys: { licenses: [h.licenseNumber], phones: [h.phone], addresses: [h.address] } };
      }
    } finally {
      await fs.rm(path, { force: true });
    }
  }
}

const BULK: BulkSource[] = [
  {
    id: "ms-msboc-revoked-suspended", state: "MS", label: "Mississippi State Board of Contractors revoked and suspended licenses",
    pageUrl: SEARCH_PAGE, everyHours: 24, minRows: 64, companiesOnly: true, category: "discipline", load: msRevokedSuspended,
  },
];

export const pack: StatePack = {
  state: "MS",
  checked: "2026-10-15",
  liveLicenses: [{ source: "Mississippi State Board of Contractors", sourceUrl: SEARCH_PAGE, search: searchMsboc, searchBy: searchMsbocBy }],
  liveEnforcement: [{ source: "Mississippi State Board of Contractors complaints and violations", scope: "Commercial and residential complaints the board publishes, with their resolutions", category: "complaint", search: searchMsViolations }],
  bulk: BULK,
  blocked: [
    "MSBOC Excel export of every license (search.msboc.us ViewExcel): works, but carries no classification, expiration or qualifying party, so the live search with detail pages is used instead",
  ],
};
