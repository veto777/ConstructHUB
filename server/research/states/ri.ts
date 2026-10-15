/**
 * Rhode Island. Every source was opened and searched live on 2026-10-15 (CLAUDE.md: never fabricate government
 * data); field names and status words are the publishers' own.
 *
 *   RI  DLT Division of Professional Regulation trade licenses (dltweb.dlt.ri.gov/profregsonline/LicenseSearch):
 *       live search, one search per trade (the form requires a trade): electricians, plumbers, mechanical
 *       (pipefitters, refrigeration, sheet metal), sprinkler fitters, hoisting engineers, irrigators, water
 *       filtration, telecommunications, alarm agents and companies, and the electrical and telecommunications
 *       corporation licenses. A company is searched by the company/corporation name the licenses carry, a person by
 *       last and first name. Each license's detail panel gives the company, address, telephone and expiration date.
 *   RI  DLT Professional Regulation violations (…/profregsonline/Violations): current violations and violation
 *       history, by company name (companies only): violation number, status code, description, violation date,
 *       cease-and-desist date and hearing result.
 *   RI  Department of Business Regulation online rosters (ridbrprod.state-reg-eastern.tylerapp.com "Online Rosters"):
 *       active architects, professional engineers, land surveyors, landscape architects (individuals and firm
 *       certificates of authorization) and solar retailers, as CSV, bulk.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { clean, csvRows, download, usDate, type BulkHit } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { tokens, wholeWordMatch } from "../licenses";
import { FormSession, formFields, tableRows, textOf, splitName } from "./lib/g2-aspnet";
import { promises as fs } from "node:fs";
import type { StatePack } from "./types";

// ── DLT trade licenses ───────────────────────────────────────────────────────────────────────────────────────
const DLT_LICENSES = "https://dltweb.dlt.ri.gov/profregsonline/LicenseSearch";
const DLT_VIOLATIONS = "https://dltweb.dlt.ri.gov/profregsonline/Violations";
const M = "ctl00$MainContent$";

/** Trades whose licenses are held by people (the grid shows first and last name). */
const PERSON_TRADES = ["Electrician", "Plumber", "Mechanical", "Sprinkler", "Hoisting", "Hoisting Restricted", "Irrigator", "Water Filtration", "Telecommunications", "Alarm Agent"];
/** Trades whose licenses are held by businesses (the grid shows the corporation name). */
const BUSINESS_TRADES = ["Corporations (Electrical)", "Corporations (Telecommunications)", "Alarm Company"];
/** Person trades also searched by company name for a company (the license carries the employer's name). */
const COMPANY_PERSON_TRADES = ["Electrician", "Plumber", "Mechanical", "Sprinkler"];
const MAX_DETAILS = 10;

type GridRow = { license: string | null; target: string | null; cells: Record<string, string | null> };

/** The results grid: header cells name the columns; the first cell's link opens the detail panel. */
export function parseDltGrid(html: string, gridId: string): GridRow[] {
  const rows = tableRows(html, gridId);
  if (!rows.length) return [];
  const header = rows[0].map((c) => textOf(c) ?? "");
  const out: GridRow[] = [];
  for (const r of rows.slice(1)) {
    if (r.length !== header.length || !/__doPostBack/.test(r[0])) continue;
    const target = r[0].match(/__doPostBack\(&#39;([^&]+)&#39;/)?.[1] ?? null;
    const cells: Record<string, string | null> = {};
    header.forEach((h, i) => { cells[h] = textOf(r[i]); });
    out.push({ license: textOf(r[0]), target, cells });
  }
  return out;
}

/** The label → value pairs of a detail panel (lblFieldNHdr / lblFieldN). */
export function parseDltDetail(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/id="MainContent_lblField(\d+)Hdr"[^>]*>([^<]*)<\/label>[\s\S]*?id="MainContent_lblField\1">([\s\S]*?)<\/span>/g))) {
    const label = textOf(m[2]);
    if (label) out[label] = clean(textOf(m[3].replace(/<br\s*\/?>/gi, ", ")));
  }
  return out;
}

const pageLinks = (html: string, gridId: string): string[] =>
  Array.from(new Set(Array.from(html.matchAll(new RegExp(`__doPostBack\\(&#39;(${gridId.replace(/\$/g, "\\$")})&#39;,&#39;(Page\\$\\d+)&#39;\\)`, "g"))).map((m) => m[2])));

class DltSession {
  private s = new FormSession(1200);
  private page: { html: string; url: string } | null = null;
  constructor(private readonly url: string) {}

  private async current() { return (this.page ??= await this.s.text(this.url)); }

  /** One search; returns every grid row (up to 3 pages). */
  async search(fields: Record<string, string>, gridName: string, gridId: string): Promise<GridRow[]> {
    const page = await this.current();
    const form = formFields(page.html);
    for (const k of ["txtLicenseNumber", "txtCompanyName", "txtLastName", "txtFirstName", "txtCity", "txtPhone", "TextBox1"]) form.set(M + k, "");
    form.delete(M + "cboStatus");
    for (const [k, v] of Object.entries(fields)) form.set(M + k, v);
    form.set("__EVENTTARGET", ""); form.set("__EVENTARGUMENT", "");
    form.set(M + "btnSearch", "Search");
    this.page = await this.s.text(this.url, form, this.url);
    if (/Please select a/i.test(this.page.html) && !this.page.html.includes(gridId)) throw new Error("the lookup rejected the search");
    const rows = parseDltGrid(this.page.html, gridId);
    for (const p of pageLinks(this.page.html, gridName).filter((p) => /^Page\$[23]$/.test(p))) {
      rows.push(...parseDltGrid((await this.postBack(gridName, p)).html, gridId));
    }
    return rows;
  }

  async postBack(target: string, argument = ""): Promise<{ html: string; url: string }> {
    const page = await this.current();
    const form = formFields(page.html);
    form.delete(M + "btnSearch");
    form.set("__EVENTTARGET", target); form.set("__EVENTARGUMENT", argument);
    this.page = await this.s.text(this.url, form, this.url);
    return this.page;
  }
}

const cityOf = (address: string | null) => address?.match(/,\s*([^,]+?)\s*,\s*[A-Z]{2}\s+\d{5}/)?.[1] ?? null;

function dltHit(trade: string, row: GridRow, d: Record<string, string | null>, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const person = [row.cells["First Name"], row.cells.MI, row.cells["Last Name"]].filter(Boolean).join(" ") || d.Name || null;
  const business = row.cells["Corporation Name"] ?? d["Corporation Name"] ?? d.Company ?? null;
  const isBusiness = BUSINESS_TRADES.includes(trade);
  const address = d.Address ?? null;
  return {
    state: "RI", source: "Rhode Island DLT trade licenses (Professional Regulation)", sourceUrl: DLT_LICENSES,
    businessName: business, licenseNumber: row.license, licenseType: trade, specialty: null, status: null,
    principal: isBusiness ? null : person, city: cityOf(address), expires: usDate(d["Expiration Date"]), matchedOn,
    address, phone: d.Telephone ?? null,
    people: isBusiness || !person ? [] : [{ name: person, role: business ? `Licensee (company: ${business})` : "Licensee" }],
  };
}

async function dltLicenseSearch(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const sess = new DltSession(DLT_LICENSES);
  const hits: LicenseHit[] = [];
  const want = tokens(name);
  const nameOk = (v: string | null | undefined) => { const have = new Set(tokens(v ?? "")); return want.length > 0 && want.every((w) => have.has(w)); };
  const searches: { trade: string; fields: Record<string, string> }[] = [];
  if (kind === "company") {
    for (const t of [...BUSINESS_TRADES, ...COMPANY_PERSON_TRADES]) searches.push({ trade: t, fields: { cboTrade: t, txtCompanyName: name.slice(0, 30) } });
  } else {
    const parts = splitName(name);
    if (!parts) return [];
    for (const t of PERSON_TRADES) searches.push({ trade: t, fields: { cboTrade: t, txtLastName: parts.last.slice(0, 30), txtFirstName: parts.first.slice(0, 30) } });
  }
  for (const { trade, fields } of searches) {
    const rows = (await sess.search(fields, `${M}gvLicenseSearchResults`, "MainContent_gvLicenseSearchResults"))
      .filter((r) => kind === "person" ? nameOk([r.cells["First Name"], r.cells.MI, r.cells["Last Name"]].join(" ")) : BUSINESS_TRADES.includes(trade) ? nameOk(r.cells["Corporation Name"]) : true);
    for (const r of rows.slice(0, MAX_DETAILS)) {
      const d = r.target ? parseDltDetail((await sess.postBack(r.target)).html) : {};
      const hit = dltHit(trade, r, d, kind === "company" ? "business" : "principal");
      if (kind === "company" ? nameOk(hit.businessName) : wholeWordMatch(name, hit)) hits.push(hit);
    }
  }
  return hits;
}

async function dltSearchBy(q: IdQuery): Promise<LicenseHit[]> {
  if (q.type !== "license") return []; // the lookup's phone box takes one unexplained format; no street search
  const n = normLicense(q.value);
  if (!n) return [];
  const sess = new DltSession(DLT_LICENSES);
  for (const trade of [...PERSON_TRADES, ...BUSINESS_TRADES]) {
    const rows = (await sess.search({ cboTrade: trade, txtLicenseNumber: q.value.trim().slice(0, 12) }, `${M}gvLicenseSearchResults`, "MainContent_gvLicenseSearchResults"))
      .filter((r) => normLicense(r.license) === n);
    if (!rows.length) continue;
    const out: LicenseHit[] = [];
    for (const r of rows.slice(0, MAX_DETAILS)) out.push(dltHit(trade, r, r.target ? parseDltDetail((await sess.postBack(r.target)).html) : {}, "license"));
    return out;
  }
  return [];
}

/** DLT violations (current and history) whose company is the name: companies only. */
async function dltViolations(name: string): Promise<EnforcementHit[]> {
  const sess = new DltSession(DLT_VIOLATIONS);
  const want = tokens(name);
  const out: EnforcementHit[] = [];
  for (const type of ["Violations", "Violations History"]) {
    const rows = (await sess.search({ cboTrade: type, txtCompanyName: name.slice(0, 30) }, `${M}gvViolationSearchResults`, "MainContent_gvViolationSearchResults"))
      .filter((r) => { const have = new Set(tokens(r.cells.Company ?? "")); return want.every((w) => have.has(w)); });
    for (const r of rows.slice(0, 15)) {
      const d = r.target ? parseDltDetail((await sess.postBack(r.target)).html) : {};
      const code = d["Violation Status"];
      const cease = usDate(d["Cease & Desist Date"]);
      out.push({
        state: "RI", source: "Rhode Island DLT Professional Regulation violations", sourceUrl: DLT_VIOLATIONS, category: "discipline",
        name: d.Company ?? r.cells.Company ?? null, id: d["Violation #"] ?? r.license, date: usDate(d["Violation Date"]), endDate: null,
        status: [type === "Violations History" ? "Violation history" : "Violation", code ? `status code ${code}` : null].filter(Boolean).join(", "),
        city: cityOf(d.Address ?? null),
        detail: [d["Violation Description"]?.replace(/\.+$/, ""), cease ? `Cease and desist date ${cease}` : null, d["Hearing Result"] ? `Hearing result: ${d["Hearing Result"]}` : null].filter(Boolean).join(". ") || null,
        amount: null, adverse: true, address: d.Address ?? null, phone: d.Phone ?? null, licenseNumber: d["License #"] ?? (r.cells["License Number"] || null),
      });
    }
  }
  return out;
}

// ── DBR online rosters ───────────────────────────────────────────────────────────────────────────────────────
const DBR_ROSTERS_PAGE = "https://ridbrprod.state-reg-eastern.tylerapp.com/portal/public/online-reports";
const DBR_ROSTER = (page: string) => `https://ridbrprod.state-reg-eastern.tylerapp.com/licensing/page.request.do?page=page.${page}`;
const DBR_ROSTERS = [
  { page: "architectRoster", label: "architects" },
  { page: "engineerRoster", label: "professional engineers" },
  { page: "landSurveyorRoster", label: "land surveyors" },
  { page: "landscapeArchitectRoster", label: "landscape architects" },
  { page: "solarRetailerRoster", label: "solar retailers" },
];
const ENTITY = /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LLP|PLLC|PC|P\.C|LP|GROUP|ASSOCIATES|PARTNERS|ENGINEERING|ARCHITECTS|SERVICES|SOLAR|ENERGY|POWER|TRUST)\b\.?/i;

async function* riRostersLoader(): AsyncIterable<BulkHit> {
  for (const r of DBR_ROSTERS) {
    const path = await download(DBR_ROSTER(r.page));
    try {
      let header: string[] | null = null;
      for await (const row of csvRows(path)) {
        if (!header) { header = row.map((h) => h.trim()); continue; }
        const get = (h: string) => clean(row[header!.indexOf(h)]);
        const name = get("Name"), type = get("License Type"), no = get("License No.");
        if (!name || !no) continue;
        // The landscape-architect roster's header names the status and date columns in a different order than its
        // rows hold them, so the three are told apart by their values.
        const three = [header.indexOf("License Status"), header.indexOf("Effective Date"), header.indexOf("Expiration Date")].map((i) => clean(row[i]));
        const status = three.find((v) => v && !/\d/.test(v)) ?? null;
        const dates = three.filter((v) => v && /^\d{2}-\d{2}-\d{4}$/.test(v)).map((v) => usDate(v));
        const expires = dates.length ? dates[dates.length - 1] : null;
        const firm = /Certificate of Authorization/i.test(type ?? "") || (r.page === "solarRetailerRoster" && ENTITY.test(name));
        const address = clean([get("Address 1"), get("Address 2"), get("City"), get("State"), get("Zip Code")].filter(Boolean).join(", "));
        const hit: LicenseHit = {
          state: "RI", source: "Rhode Island DBR rosters (architects, engineers, land surveyors, landscape architects, solar retailers)",
          sourceUrl: DBR_ROSTERS_PAGE, businessName: firm ? name : null, licenseNumber: no, licenseType: type, specialty: null,
          status, principal: firm ? null : name, city: get("City"), expires, matchedOn: firm ? "business" : "principal",
          address, people: firm ? [] : [{ name, role: null }],
        };
        yield { kind: "license", hit, business: firm ? name : null, person: firm ? null : name, keys: { licenses: [no], addresses: [address] } };
      }
    } finally {
      await fs.rm(path, { force: true });
    }
  }
}

export const pack: StatePack = {
  state: "RI",
  checked: "2026-10-15",
  liveLicenses: [
    { source: "Rhode Island DLT trade licenses (Professional Regulation)", sourceUrl: DLT_LICENSES, search: dltLicenseSearch, searchBy: dltSearchBy },
  ],
  liveEnforcement: [
    { source: "Rhode Island DLT Professional Regulation violations", scope: "Current violations and violation history of the DLT trades", category: "discipline", search: dltViolations },
  ],
  bulk: [
    { id: "ri-dbr-rosters", state: "RI", label: "Rhode Island DBR rosters (architects, engineers, land surveyors, landscape architects, solar retailers)",
      pageUrl: DBR_ROSTERS_PAGE, everyHours: 24 * 7, minRows: 12_000, load: riRostersLoader },
  ],
  blocked: [
    "Contractors' Registration and Licensing Board (crb.ri.gov), the statewide residential and commercial contractor registry: Cloudflare challenge page (HTTP 403) to our bot",
    "data.ri.gov and dlt.ri.gov (including DLT's paid bulk licensee lists page): Cloudflare challenge (HTTP 403)",
    "Secretary of State business search (business.sos.ri.gov): Cloudflare Turnstile CAPTCHA on the search form",
    "DBR online rosters list active credentials only; the DBR lookup has no contractor boards",
  ],
};
