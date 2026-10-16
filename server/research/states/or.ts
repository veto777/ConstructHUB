/**
 * Oregon, beyond the original CCB and BCD license datasets (../licenses.ts) and the DOJ complaints (../records.ts).
 * Every source below was opened and searched live on 2026-10-15; field names and code meanings are the publishers'.
 *
 *   Bulk (companies only):
 *     BOLI prevailing-wage List of Ineligibles (debarred from public works, ORS 279C.860) and BOLI Prevailing Wage
 *       Case Closure Letters ("contractors named in cases where an investigation substantiated violations", the last
 *       two years). Both are SharePoint lists behind oregon.gov/boli/employers/Pages/pwr-ineligible-contractors.aspx,
 *       read through the site's own list API (the page's data-table web part reads the same lists).
 *   Live enforcement (companies only):
 *     CCB contractor search (search.ccb.state.or.us/search/): every license a business name matches, active or not,
 *       with the license's complaint (claims) history, disciplinary history (civil penalties, suspensions,
 *       revocations, refusals and the other sanction categories the CCB lists), administrative bond/insurance
 *       suspension counts and unpaid debt, past 10 years. The page has no CAPTCHA (its reCAPTCHA script is commented
 *       out) and no login; its robots.txt disallows every path, which the research fetcher treats as advisory
 *       (owner order 2026-10-15). A license held by a person is never reported.
 *     Secretary of State business registry, active businesses (data.oregon.gov tckn-sxa6; principal-place rows)
 *     DCBS active workers' compensation employers (data.oregon.gov q9zj-c8r2; monthly), with the insurer and the
 *       published insured-status codes
 */
import type { EnforcementHit } from "@shared/research-reports";
import { clean } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { BulkHit, BulkSource } from "../bulk";
import { nameClause, sodaRows } from "../licenses";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { hasEnded } from "../adverse";
import { capNote, noteOf, withNote } from "../notes";
import { rethrowIfBlocked } from "../http";
import { Session, hiddenInputs } from "./lib/g6-common";
import { anyDay, businessParts, fetchJson, money, nameMatches } from "./lib/g8-common";

// ── BOLI prevailing wage: List of Ineligibles + Case Closure Letters ─────────────────────────────────────────
const BOLI_PAGE = "https://www.oregon.gov/boli/employers/Pages/pwr-ineligible-contractors.aspx";
const BOLI_API = "https://www.oregon.gov/boli/employers/_api/web/GetList";
const listItems = (list: string, query: string) =>
  `${BOLI_API}('${encodeURIComponent(list)}')/items?${query}`;

type Item = Record<string, any>;
/** Every item of a list: SharePoint returns at most $top items a page and an "odata.nextLink" while more remain. */
export async function spItems(url: string, get = (u: string) => fetchJson<{ value?: Item[]; "odata.nextLink"?: string }>(u, { headers: { accept: "application/json;odata=nometadata" } }, "BOLI list", 1500)): Promise<Item[]> {
  const out: Item[] = [];
  const seen = new Set<string>();
  for (let next: string | undefined = url, page = 0; next; page++) {
    if (seen.has(next) || page >= 50) throw new Error("BOLI list paging did not end");
    seen.add(next);
    const body = await get(next);
    if (!Array.isArray(body.value)) throw new Error("BOLI list returned an unexpected payload");
    out.push(...body.value);
    const link = body["odata.nextLink"];
    next = typeof link === "string" && link.startsWith("https://www.oregon.gov/") ? link : undefined;
  }
  return out;
}

const enf = (h: EnforcementHit, business: string, addresses: string[] = []): BulkHit =>
  ({ kind: "enforcement", hit: { ...h, address: addresses[0] ?? null }, business, person: null, keys: { addresses } });

/** The list's Address field is rich text: one or more addresses, a line each, separated by blank lines. */
export function boliAddresses(html: string | null | undefined): string[] {
  if (!html) return [];
  // A blank line (<div><br></div>, or <p></p>) separates two addresses; any other tag only breaks a line.
  const marked = html.replace(/[\u200b]/g, "").replace(/<div>\s*<br\s*\/?>\s*<\/div>|<p>\s*<\/p>/gi, "\u0001");
  return marked.split("\u0001")
    .map((block) => decodeEntities(block.replace(/<[^>]+>/g, "\n")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}

async function* boliLoader(): AsyncIterable<BulkHit> {
  const today = new Date().toISOString().slice(0, 10);
  // List of Ineligibles: Title = contractor (a trailing "*" means "Not to be removed from debarment"),
  // tdlw = "Date placed", lhcs = "Removal date" (the list's own field titles), Aliases.
  for (const r of await spItems(listItems("/boli/employers/Lists/Debarments", "$top=5000&$select=Id,Title,tdlw,lhcs,Aliases,Address"))) {
    const title = clean(r.Title);
    if (!title) continue;
    const names = businessParts(title);
    const aliases = businessParts(clean(r.Aliases)?.replace(/^aka\s+/i, ""));
    if (!names.length) continue; // a person only: never indexed (companies only)
    const removal = anyDay(r.lhcs);
    const permanent = /\*/.test(title);
    const ended = !permanent && hasEnded(removal, today);
    yield enf({
      state: "OR", source: "Oregon BOLI prevailing-wage List of Ineligibles (debarred)", sourceUrl: BOLI_PAGE, category: "debarment",
      name: names.join(" / "), id: null, date: anyDay(r.tdlw), endDate: removal,
      status: permanent ? "Ineligible; not to be removed from debarment" : ended ? "Removal date passed" : "Ineligible for public works contracts",
      city: null, detail: ["Ineligible to receive public works contracts subject to the Prevailing Wage Rate Law (ORS 279C.860)",
        aliases.length ? `Also listed as ${aliases.join(", ")}` : null].filter(Boolean).join(". "),
      // Being on BOLI's list is the publisher's own finding; once its removal date has passed the debarment is over.
      amount: null, adverse: !ended,
    }, [...names, ...aliases].join(" "), boliAddresses(r.Address));
  }
  // Case Closure Letters: the PDF's file name is "<contractor> - <case number>.pdf"; "Date issued" is its own field.
  const letters = await spItems(listItems("/boli/employers/Documents",
    "$top=5000&$select=FileLeafRef,FileRef,Date_x0020_issued,DocType&$filter=" + encodeURIComponent("DocType eq 'PWR Case Closure Letters'")));
  for (const r of letters) {
    const file = clean(r.FileLeafRef)?.replace(/\.pdf$/i, "");
    const m = file?.match(/^(.*\S)\s+-\s+([\w-]+)$/);
    if (!m) continue;
    const names = businessParts(m[1].replace(/\s+-\s+DBA as\s+/i, " dba "));
    if (!names.length) continue;
    yield enf({
      state: "OR", source: "Oregon BOLI prevailing-wage case closure letters", sourceUrl: r.FileRef ? `https://www.oregon.gov${encodeURI(r.FileRef)}` : BOLI_PAGE,
      category: "wage", name: names.join(" / "), id: m[2], date: anyDay(r.Date_x0020_issued), endDate: null,
      status: "Case closed with violations substantiated", city: null,
      detail: "BOLI issues a Prevailing Wage Case Closure Letter to contractors named in cases where an investigation substantiated violations",
      amount: null, adverse: true,
    }, names.join(" "));
  }
}

// ── CCB contractor search: complaint (claims) and disciplinary history ────────────────────────────────────────
// search.ccb.state.or.us/search/ is an ASP.NET form: the search posts the page's view state with the name and lands
// on list_results.aspx (License #, Name, License Status, Address; 20 rows a page, every status, assumed business
// names listed as their own rows). Each license's pages then open by number without the form:
//   search_result.aspx?id=N                summary (status, first licensed, unpaid claims and civil penalties, and
//                                          Yes/No for complaints, sanctions and bond/insurance suspensions, past 10 years)
//   dispute_detail.asp?id=N                complaints (claims) history, one table per CCB dispute
//   disciplinary_detail.asp?id=N           enforcement civil penalties, license suspensions and revocations, refusals,
//                                          DOJ assurances, criminal convictions, public works debarment, injunctions,
//                                          UTPA violations, higher-bond requirements
//   administrative_license_actions.asp?id=N  counts of suspensions for lack of proof of insurance or bond
//   unpaid_debt.asp?id=N                   unpaid claims and civil penalties, per order
// The data.oregon.gov CCB dataset (../licenses.ts) has active licenses only and none of this history.
const CCB = "https://search.ccb.state.or.us/search/";
const CCB_SOURCE = "Oregon CCB contractor complaint and disciplinary history";
const ccbPage = (path: string, license: string) => `${CCB}${path}?id=${encodeURIComponent(license)}`;
const CCB_MAX_LICENSES = 5;

const ccbLines = (html: string): string[] =>
  decodeEntities(html.replace(/<[^>]+>/g, "\n")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
const ccbCell = (html: string | undefined): string | null => clean(decodeEntities((html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "));
/** "$162,443.75" → 162443.75; "$0.00", blank or text → null. */
export const ccbDollars = (v: string | null | undefined): number | null => money((v ?? "").replace(/[$,\s]/g, ""));

export type CcbRow = { license: string; name: string; status: string | null; address: string | null };

/** The results grid and its record count ("(6 Records)"); "No matches found" is an empty list. */
export function parseCcbList(html: string): { total: number | null; rows: CcbRow[] } {
  const count = html.match(/id="MainContent_basicCountLabel">\s*(\d+)\s*</);
  if (!count && !/No matches found/i.test(html)) throw new Error("Oregon CCB search returned an unexpected page");
  const rows: CcbRow[] = [];
  for (const m of Array.from(html.matchAll(/id="MainContent_GridView1_detailLink_\d+"[^>]*>\s*(\d+)\s*<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g))) {
    const name = ccbCell(m[2]);
    if (name) rows.push({ license: m[1], name, status: ccbCell(m[3]), address: ccbCell(m[4]) });
  }
  return { total: count ? Number(count[1]) : 0, rows };
}

export type CcbSummary = {
  name: string; license: string; status: string | null; firstLicensed: string | null;
  unpaidClaims: string | null; unpaidPenalties: string | null;
  complaints: boolean | null; sanctions: boolean | null; adminSuspensions: boolean | null;
};

/** The license summary page (search_result.aspx?id=N). */
export function parseCcbSummary(html: string): CcbSummary {
  const span = (id: string) => ccbCell(html.match(new RegExp(`id="MainContent_${id}"[^>]*>([\\s\\S]*?)</span>`))?.[1]);
  const yes = (v: string | null) => (v === "Yes" ? true : v === "No" ? false : null);
  const name = span("contractornamelabel"), license = span("licenseLabel");
  if (!name || !license) throw new Error("Oregon CCB license page returned an unexpected page");
  return {
    name, license, status: span("statuslabel"), firstLicensed: anyDay(span("datefirstlabel")),
    unpaidClaims: span("claimsamtlabel"), unpaidPenalties: span("penaltiesamtlabel"),
    complaints: yes(span("complaintlabel")), sanctions: yes(span("sanctionslabel")), adminSuspensions: yes(span("discbondinslabel")),
  };
}

/**
 * The complaints (claims) history: one table per dispute. A header row (CCB Dispute #, Type of Dispute, Open Date,
 * Close Date, Structure, Work Type; Orig Contract Amt, Order Amt, Contractor Paid Amt, Surety Paid Amt, Reason; Bond
 * Company, Bond Number, Bond Amount) names the cells of the row under it; "Dispute Status: …" and "Closure Details: …"
 * cells carry their own label. Every label is the CCB's own.
 */
export function parseCcbDisputes(html: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const block of html.split(/<table class="looptbl">/i).slice(1)) {
    const d: Record<string, string> = {};
    let header: string[] | null = null;
    // Innermost rows only: a row that wraps a sub-table is skipped in favour of the sub-table's own rows.
    for (const r of Array.from(block.split(/<!--end of loop/i)[0].matchAll(/<tr([^>]*)>((?:(?!<tr)[\s\S])*?)<\/tr>/gi))) {
      const cells = Array.from(r[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => ccbCell(c[1]) ?? "");
      if (/topHead|boldHead/.test(r[1])) { header = cells; continue; }
      if (header) {
        header.forEach((h, i) => { if (h && cells[i]) d[h] = cells[i]; });
        header = null;
        continue;
      }
      for (const c of cells) {
        const m = c.match(/^([^:]{2,40}):\s*(.*)$/);
        if (m && m[2]) d[m[1].trim()] = m[2].trim();
      }
    }
    if (d["CCB Dispute #"]) out.push(d);
  }
  return out;
}

export type CcbEntry = { section: string; fields: [string, string | null][] };

/**
 * The disciplinary-detail and unpaid-debt pages: sections headed in capitals (ENFORCEMENT CIVIL PENALTIES, LICENSE
 * SUSPENSIONS & REVOCATIONS, …, UNPAID CLAIMS, UNPAID CIVIL PENALTIES), each a list of "Label:" / value lines, one
 * entry per "__________" rule. "This contractor has never received a sanction of this category" and "No Records
 * Found" are no entries.
 */
export function parseCcbSections(html: string): CcbEntry[] {
  const body = html.match(/<!-- BEGIN BODY CONTENT -->([\s\S]*?)<!-- END BODY CONTENT -->/)?.[1] ?? html;
  const lines = ccbLines(body);
  const FIRST = /^(?:ENFORCEMENT CIVIL PENALTIES|UNPAID CLAIMS)$/;
  const HEADER = /^[A-Z][A-Z &/'(),.-]{9,}$/;
  const out: CcbEntry[] = [];
  let section: string | null = null;
  let fields: [string, string | null][] = [];
  const flush = () => { if (section && fields.length) out.push({ section, fields }); fields = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!section) { if (FIRST.test(l)) section = l; continue; }
    if (/^_{3,}$/.test(l)) { flush(); continue; }
    if (HEADER.test(l) && !l.endsWith(":")) { flush(); section = l; continue; }
    if (l.endsWith(":")) {
      const next = lines[i + 1];
      // The line after a label is its value (an all-capitals value is still a value, never a section heading).
      const hasValue = next != null && !next.endsWith(":") && !/^_{3,}$/.test(next);
      fields.push([l.slice(0, -1).replace(/\s+/g, " ").trim(), hasValue ? next : null]);
      if (hasValue) i++;
    }
  }
  flush();
  return out;
}

/** The administrative suspension counts ("Suspensions for lack of proof of surety bond:" "2"). */
export function parseCcbAdmin(html: string): [string, string][] {
  const lines = ccbLines(html);
  const out: [string, string][] = [];
  lines.forEach((l, i) => { if (/^Suspensions for .*:$/.test(l) && /^\d+$/.test(lines[i + 1] ?? "")) out.push([l.slice(0, -1).trim(), lines[i + 1]]); });
  return out;
}

const field = (e: CcbEntry, re: RegExp) => e.fields.find(([k]) => re.test(k))?.[1] ?? null;
const sentence = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();

export function ccbSummaryHit(s: CcbSummary, names: string[], address: string | null, admin: [string, string][]): EnforcementHit {
  const yn = (v: boolean | null) => (v == null ? "not shown" : v ? "Yes" : "No");
  return {
    state: "OR", source: CCB_SOURCE, sourceUrl: ccbPage("search_result.aspx", s.license), category: "business_status",
    name: [s.name, ...names.filter((n) => n.toUpperCase() !== s.name.toUpperCase())].join(" / "), id: s.license, licenseNumber: s.license,
    date: s.firstLicensed, endDate: null, status: s.status ? `CCB license: ${s.status}` : null, city: null, address,
    detail: [s.firstLicensed ? `First licensed ${s.firstLicensed}` : null,
      `Complaints (claims) filed, past 10 years: ${yn(s.complaints)}`,
      `Civil penalties or other sanctions, past 10 years: ${yn(s.sanctions)}`,
      `Suspended for lack of bond/insurance, past 10 years: ${yn(s.adminSuspensions)}${admin.length ? ` (${admin.map(([k, v]) => `${k}: ${v}`).join("; ")}; the CCB says these are administrative, not disciplinary, actions)` : ""}`,
      s.unpaidClaims ? `Unpaid claims: ${s.unpaidClaims}` : null, s.unpaidPenalties ? `Unpaid civil penalties: ${s.unpaidPenalties}` : null,
    ].filter(Boolean).join(". "),
    amount: null, adverse: null,
  };
}

/** One dispute; `unpaid` is its UNPAID CLAIMS entry from the unpaid-debt page, when it has one. */
export function ccbDisputeHit(d: Record<string, string>, s: CcbSummary, unpaid: CcbEntry | null): EnforcementHit {
  const close = d["Close Date"];
  const outstanding = unpaid ? ccbDollars(field(unpaid, /^Outstanding Amount$/)) : null;
  const used = new Set(["CCB Dispute #", "Open Date", "Close Date", "Dispute Status", "Closure Details"]);
  return {
    state: "OR", source: CCB_SOURCE, sourceUrl: ccbPage("dispute_detail.asp", s.license), category: "complaint",
    name: s.name, id: d["CCB Dispute #"], licenseNumber: s.license, date: anyDay(d["Open Date"]), endDate: anyDay(close),
    status: [d["Dispute Status"] ?? (close === "Pending" ? "Pending" : null), d["Closure Details"]].filter(Boolean).join("; ") || null,
    city: null,
    detail: [...Object.entries(d).filter(([k]) => !used.has(k)).map(([k, v]) => `${k}: ${v}`),
      unpaid ? `Unpaid claim: ${unpaid.fields.filter(([k, v]) => v && /Amount/.test(k)).map(([k, v]) => `${k} ${v}`).join(", ")}` : null,
    ].filter(Boolean).join(". ") || null,
    // A claim the CCB lists as unpaid debt is an order the contractor has not paid; any other dispute's outcome is
    // left to the reader (the CCB's own words are in status).
    amount: outstanding ?? ccbDollars(d["Order Amt"]), adverse: outstanding ? true : null,
  };
}

/** An unpaid claim on the unpaid-debt page that the complaints history doesn't list. */
export function ccbUnpaidClaimHit(e: CcbEntry, s: CcbSummary): EnforcementHit {
  return {
    state: "OR", source: CCB_SOURCE, sourceUrl: ccbPage("unpaid_debt.asp", s.license), category: "complaint",
    name: s.name, id: field(e, /^CCB Order #$/), licenseNumber: s.license, date: anyDay(field(e, /^Open Date$/)), endDate: anyDay(field(e, /^Close Date$/)),
    status: "Unpaid claim", city: null,
    detail: e.fields.filter(([k, v]) => v && !/^(?:CCB Order #|Open Date|Close Date)$/.test(k)).map(([k, v]) => `${k}: ${v}`).join(". ") || null,
    amount: ccbDollars(field(e, /^Outstanding Amount$/)), adverse: ccbDollars(field(e, /^Outstanding Amount$/)) ? true : null,
  };
}

/** One sanction from the disciplinary detail (or an unpaid civil penalty it doesn't list). */
export function ccbSanctionHit(e: CcbEntry, s: CcbSummary, page = "disciplinary_detail.asp"): EnforcementHit {
  const dated = e.fields.find(([k, v]) => /Date/.test(k) && anyDay(v)) ?? null;
  const dateKey = dated?.[0] ?? null;
  const sanction = field(e, /^Sanction$/);
  const used = new Set(["Investigation Number", "Sanction", dateKey]);
  return {
    state: "OR", source: CCB_SOURCE, sourceUrl: ccbPage(page, s.license), category: /DEBARMENT/.test(e.section) ? "debarment" : "discipline",
    name: s.name, id: field(e, /^Investigation Number$/), licenseNumber: s.license,
    date: anyDay(dated?.[1]), endDate: null,
    status: sanction ?? sentence(e.section), city: null,
    detail: [sanction ? sentence(e.section) : null, ...e.fields.filter(([k, v]) => v && !used.has(k)).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(". ") || null,
    // The CCB's own enforcement sanctions: "enforcement actions taken against a contractor for violating state laws".
    amount: ccbDollars(field(e, /^Penalty Amount$/)), adverse: true,
  };
}

/** A business that the search names (its own row) and whose license page names a business too (companies only). */
const ccbBusiness = (v: string) => businessParts(v).length > 0;

export async function searchCcb(name: string, session = new Session(1500)): Promise<EnforcementHit[]> {
  // The search matches any name containing the text as typed; punctuation is dropped ("Acme Roofing, L.L.C.").
  const term = clean(name.replace(/[.,]/g, " "));
  if (!term) return [];
  const form = await session.text(CCB, {}, "Oregon CCB search");
  const body = new URLSearchParams();
  for (const [k, v] of hiddenInputs(form)) body.set(k, v);
  body.set("ctl00$MainContent$activeToggle", "All");
  body.set("ctl00$MainContent$searchBox", term);
  body.set("ctl00$MainContent$submitbtn", "Search");
  const list = parseCcbList(await session.text(CCB, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: CCB } }, "Oregon CCB search"));
  const notes: string[] = [];
  if (list.total != null && list.total > list.rows.length) notes.push(capNote(list.rows.length, list.total, "names on the CCB's first results page"));
  const byLicense = new Map<string, CcbRow[]>();
  for (const r of list.rows) if (nameMatches(name, r.name) && ccbBusiness(r.name)) byLicense.set(r.license, [...(byLicense.get(r.license) ?? []), r]);
  const licenses = Array.from(byLicense.entries());
  if (licenses.length > CCB_MAX_LICENSES) notes.push(capNote(CCB_MAX_LICENSES, licenses.length, "licenses (each one's history pages are read)"));
  const out: EnforcementHit[] = [];
  let failed = 0;
  for (const [license, rows] of licenses.slice(0, CCB_MAX_LICENSES)) {
    try {
      const s = parseCcbSummary(await session.text(ccbPage("search_result.aspx", license), {}, "Oregon CCB license page"));
      if (!ccbBusiness(s.name)) continue; // the license holder is a person: never reported (companies only)
      const admin = s.adminSuspensions ? parseCcbAdmin(await session.text(ccbPage("administrative_license_actions.asp", license), {}, "Oregon CCB license page")) : [];
      out.push(ccbSummaryHit(s, rows.map((r) => r.name), rows.find((r) => r.address)?.address ?? null, admin));
      const debt = ccbDollars(s.unpaidClaims) || ccbDollars(s.unpaidPenalties)
        ? parseCcbSections(await session.text(ccbPage("unpaid_debt.asp", license), {}, "Oregon CCB license page")) : [];
      const unpaidClaims = debt.filter((e) => e.section === "UNPAID CLAIMS");
      const disputes = s.complaints ? parseCcbDisputes(await session.text(ccbPage("dispute_detail.asp", license), {}, "Oregon CCB license page")) : [];
      for (const d of disputes) out.push(ccbDisputeHit(d, s, unpaidClaims.find((e) => field(e, /^CCB Order #$/) === d["CCB Dispute #"]) ?? null));
      for (const e of unpaidClaims) if (!disputes.some((d) => d["CCB Dispute #"] === field(e, /^CCB Order #$/))) out.push(ccbUnpaidClaimHit(e, s));
      const sanctions = s.sanctions ? parseCcbSections(await session.text(ccbPage("disciplinary_detail.asp", license), {}, "Oregon CCB license page")) : [];
      for (const e of sanctions) out.push(ccbSanctionHit(e, s));
      const listed = new Set(sanctions.map((e) => field(e, /^Investigation Number$/)));
      for (const e of debt) if (e.section === "UNPAID CIVIL PENALTIES" && !listed.has(field(e, /^Investigation Number$/))) out.push(ccbSanctionHit(e, s, "unpaid_debt.asp"));
    } catch (err) {
      rethrowIfBlocked(err); // an access denial stops the search (round 2, decision 6)
      failed++;
    }
  }
  if (failed) notes.push(`the CCB's pages could not be read for ${failed} license(s)`);
  return withNote(out, notes.join("; ") || null);
}

// ── Secretary of State: active businesses ────────────────────────────────────────────────────────────────────
const SOS_DATASET = "https://data.oregon.gov/d/tckn-sxa6";
const SOS_URL = "https://data.oregon.gov/resource/tckn-sxa6.json";

export async function searchSos(name: string): Promise<EnforcementHit[]> {
  const rows = await sodaRows(SOS_URL, `${nameClause("business_name", name)} AND associated_name_type='PRINCIPAL PLACE OF BUSINESS'`, 200, "Oregon business registry");
  // The page's cap note travels with the results (round 2, decision 9).
  return withNote(rows.filter((r) => nameMatches(name, String(r.business_name ?? ""))).map((r) => ({
    state: "OR", source: "Oregon Secretary of State business registry (active businesses)",
    sourceUrl: typeof (r.business_details as any)?.url === "string" ? (r.business_details as any).url : SOS_DATASET,
    category: "business_status" as const, name: clean(String(r.business_name ?? "")), id: clean(String(r.registry_number ?? "")),
    date: anyDay(r.registry_date), endDate: null,
    status: `Active${clean(String(r.entity_type ?? "")) ? ` (${clean(String(r.entity_type))})` : ""}`,
    city: [clean(String(r.city ?? "")), clean(String(r.state ?? ""))].filter(Boolean).join(", ") || null,
    address: [r.address, r.address_continued, r.city, r.state, r.zip].map((v) => clean(v == null ? null : String(v))).filter(Boolean).join(" ") || null,
    detail: r.registry_date ? `Registered ${anyDay(r.registry_date)}` : null, amount: null, adverse: null,
  })), noteOf(rows));
}

// ── DCBS workers' compensation employer database ─────────────────────────────────────────────────────────────
const WC_DATASET = "https://data.oregon.gov/d/q9zj-c8r2";
const WC_URL = "https://data.oregon.gov/resource/q9zj-c8r2.json";
/** insurer_status, from the dataset's column description (DCBS, 2026-10-15). */
const WC_STATUS: Record<string, string> = { "1": "Active coverage", "01": "Active coverage", "3": "Double coverage", "03": "Double coverage", "4": "Pending coverage", "04": "Pending coverage", "12": "Pending investigation" };

/**
 * The insurer line. DCBS: "A missing value in [record_origin] means that the employer is self-insured" (column
 * description, 2026-10-15); self-insured rows name the employer itself as insurer. Without an insurer name nothing
 * is said: a missing value is never turned into "self-insured" (audit 2026-10-15, decision 3).
 */
export function wcInsurer(r: Record<string, unknown>): string | null {
  const insurer = clean(String(r.insurer_name ?? ""));
  if (!insurer) return null;
  return clean(String(r.record_origin ?? "")) ? `Insurer: ${insurer}` : `Insurer: ${insurer} (self-insured, per DCBS's record-origin code)`;
}

/**
 * entity_code, from the dataset's column description (checked 2026-10-15): 0 Other, 1 Individual, 2 Corporation,
 * 3 Political Subd, 4 Husband/Wife Partnership, 5 Partnership, 6 Joint Venture, 7 Association, 8 Labor Union,
 * 9 Limited Partner, A LLP, B LLC, C Trust, D Estate. Street address and phone are kept only for a documented business
 * entity (round 4, decision 5); an individual, a husband/wife partnership, an estate, "Other", a blank or an unlisted
 * code shows city, state and ZIP only.
 */
const WC_BUSINESS = new Set(["2", "3", "5", "6", "7", "8", "9", "A", "B", "C"]);
export const wcBusinessEntity = (r: Record<string, unknown>): boolean => WC_BUSINESS.has((clean(String(r.entity_code ?? "")) ?? "").toUpperCase());

export async function searchWorkersComp(name: string): Promise<EnforcementHit[]> {
  const rows = await sodaRows(WC_URL, `(${nameClause("legal_business_name", name)}) OR (${nameClause("dba_name", name)})`, 200, "Oregon workers' comp employers");
  // The page's cap note travels with the results (round 2, decision 9).
  return withNote(rows.filter((r) => nameMatches(name, String(r.legal_business_name ?? ""), String(r.dba_name ?? ""))).map((r) => {
    const code = clean(String(r.insurer_status ?? "")) ?? "";
    const dba = clean(String(r.dba_name ?? ""));
    const individual = !wcBusinessEntity(r);
    return {
      state: "OR", source: "Oregon DCBS workers' compensation coverage (active employers)", sourceUrl: WC_DATASET, category: "business_status" as const,
      name: [clean(String(r.legal_business_name ?? "")), dba].filter(Boolean).join(" / "), id: clean(String(r.employer_num ?? "")),
      // "liad_end_date" is the publisher's own spelling (column "Liability End Date" in the dataset's schema, checked
      // 2026-10-15 at /api/views/q9zj-c8r2.json); there is no "liab_end_date".
      date: anyDay(r.liab_begin_date), endDate: anyDay(r.liad_end_date),
      status: `Workers' comp: ${WC_STATUS[code] ?? (code ? `code ${code}` : "status not given")}`,
      city: [clean(String(r.ppb_city ?? "")), clean(String(r.ppb_state ?? ""))].filter(Boolean).join(", ") || null,
      address: [individual ? null : r.ppb_address2, r.ppb_city, r.ppb_state, r.ppb_zip].map((v) => clean(v == null ? null : String(v))).filter(Boolean).join(" ") || null,
      phone: r.phone && !individual ? clean(`${r.phone_area ?? ""}${r.phone}`) : null,
      detail: [wcInsurer(r),
        clean(String(r.naics_description ?? "")), clean(String(r.employees_range ?? "")) ? `${clean(String(r.employees_range))} employees` : null].filter(Boolean).join(". ") || null,
      amount: null, adverse: null,
    };
  }), noteOf(rows));
}

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: CCB_SOURCE, scope: "Every CCB license by business name (active and inactive): status, complaints (claims), sanctions and unpaid debt, past 10 years", search: searchCcb },
  { source: "Oregon Secretary of State business registry (active businesses)", scope: "Active businesses only (inactive ones are not published)", search: searchSos },
  { source: "Oregon DCBS workers' compensation coverage (active employers)", scope: "Employers with an active policy, updated monthly", search: searchWorkersComp },
];

const bulk: BulkSource[] = [
  { id: "or-boli-pwr", state: "OR", label: "Oregon BOLI prevailing wage: ineligible contractors and case closure letters", pageUrl: BOLI_PAGE,
    everyHours: 24, minRows: 30, load: boliLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "OR",
  checked: "2026-10-15",
  liveEnforcement,
  bulk,
  blocked: [
    "Building Codes Division enforcement actions: no published list (the enforcement page describes the process only)",
  ],
};
