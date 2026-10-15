/**
 * Georgia. Checked live 2026-10-15.
 *
 *   Live license search:
 *     Georgia Soil and Water Conservation Commission erosion and sedimentation control certifications
 *     (www.gaswcc.org/esc-search.php, linked from gaswcc.georgia.gov; robots.txt 404; no CAPTCHA, no login): the public
 *     "Certification Verification" form by first, middle initial and last name, or by certification ID. Each row: Cert.
 *     ID, Trainer ID, first name, MI, last name, city, state, and the expiration of each level the person holds (Level
 *     AW, 1A, 1B, II, Trainer 1, Trainer 2) plus the Level II certificate kind ("Design Pro", "Plan Reviewer"). People
 *     only. The "PW Rcvd" column has no published meaning and is not used.
 *
 *   Bulk license file:
 *     ga-epd-asbestos-firms  Georgia EPD "Licensed Asbestos Abatement Contractors" (epd.georgia.gov, Asbestos Contractors
 *                            and Training Providers page; the PDF "Georgia Licensed Asbestos Abatement Firms as of
 *                            August 2026"): company name, address, city, state, ZIP, phone and expiration date. No
 *                            license number is published. EPD's disclaimer speaks of "listed firms and/or individuals",
 *                            so the holder is left unknown (city, state and ZIP only).
 *
 *   Live enforcement search:
 *     Georgia EPD enforcement orders (enfo.gaepd.org; robots.txt absent; no CAPTCHA): the public "Search Enforcement
 *     Orders" form by facility name (proposed and executed orders, 1998 to today), then each matching order's details
 *     page for the cause, the requirements, the settlement amount and the legal authority.
 *
 * Georgia's licensing boards (residential and general contractors, the Construction Industry Licensing Board's
 * electrical, plumbing, conditioned air, low voltage and utility contractors, engineers) all sit on sos.ga.gov and
 * verify.sos.ga.gov behind a Cloudflare challenge (rechecked 2026-10-15), so none of them is searched (see `blocked`).
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { clean, download, type BulkHit } from "../bulk";
import { tokens } from "../licenses";
import type { IdQuery } from "../identifiers";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { capNote, withNote } from "../notes";
import { hasAllWords, htmlText } from "./lib/g3-common";
import { splitName } from "./lib/g2-aspnet";
import { anyDay } from "./lib/g8-common";
import { pdfText, textLines } from "./lib/a3-pdf";

const ENFO = "https://enfo.gaepd.org";
const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "12‑Aug‑2024" (non-breaking hyphens) → 2024-08-12. */
export function epdDate(v: string | null | undefined): string | null {
  const m = (v ?? "").replace(/[‐-―]/g, "-").match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  const mon = m ? MONTHS[m[2].toUpperCase()] : undefined;
  return m && mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : null;
}

export type EpdRow = { facility: string | null; county: string | null; order: string | null; authority: string | null; status: string | null; date: string | null; details: string | null };

/** Result rows of the search page. */
export function parseEpdSearch(html: string): { total: number; rows: EpdRow[] } {
  const total = Number(htmlText(html.match(/Total results:\s*([\d,]+)/)?.[1])?.replace(/,/g, "") ?? 0);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows: EpdRow[] = [];
  for (const m of Array.from(body.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const fac = m[1].match(/data-label="Facility">([\s\S]*?)<\/th>/)?.[1] ?? "";
    const ord = m[1].match(/data-label="Order">([\s\S]*?)<\/td>/)?.[1] ?? "";
    const st = m[1].match(/data-label="Status\/Date">([\s\S]*?)<\/td>/)?.[1] ?? "";
    rows.push({
      facility: htmlText(fac.replace(/<em>[\s\S]*?<\/em>/, "")), county: htmlText(fac.match(/<em>([\s\S]*?)<\/em>/)?.[1]),
      order: htmlText(ord.replace(/<em>[\s\S]*?<\/em>/, "")), authority: htmlText(ord.match(/<em>([\s\S]*?)<\/em>/)?.[1]),
      status: htmlText(st.match(/<strong>([\s\S]*?)<\/strong>/)?.[1])?.replace(/\s*On$/i, "") ?? null,
      date: epdDate(htmlText(st.replace(/<strong>[\s\S]*?<\/strong>/, "").replace(/&#x2011;/g, "-"))),
      details: m[1].match(/href="(\/Details\/\d+)"/)?.[1] ?? null,
    });
  }
  return { total, rows };
}

/** The label/value table of an order's details page. */
export function parseEpdDetails(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/<th scope="row">([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g))) {
    const k = htmlText(m[1]);
    if (k) out[k] = htmlText(m[2].replace(/&#x2011;/g, "-"));
  }
  return out;
}

export function epdHit(row: EpdRow, d: Record<string, string | null>, url: string): EnforcementHit {
  const amount = d["Settlement Amount"]?.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
  const executed = epdDate(d["Date Executed"]);
  return {
    state: "GA", source: "Georgia EPD enforcement orders", sourceUrl: url, category: "environmental",
    name: d.Facility ?? row.facility, id: row.order, date: executed ?? row.date, endDate: null,
    status: row.status ? `${row.status} order` : null, city: d.County ?? row.county,
    detail: [d["Legal Authority"] ?? row.authority, d["Cause of Order"] ? `Cause: ${d["Cause of Order"]}` : null,
      d["Requirements of Order"] ? `Required: ${d["Requirements of Order"]}` : null].filter(Boolean).join(". ").slice(0, 900) || null,
    amount: amount ? Number(amount.replace(/,/g, "")) : null,
    // A proposed order is out for public comment and not yet in force.
    adverse: /executed/i.test(row.status ?? "") ? true : null,
  };
}

const MAX_PAGES = 4;
const MAX_DETAILS = 12;

async function epdText(url: string): Promise<string> {
  const res = await politeFetch(url, {}, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`Georgia EPD orders returned HTTP ${res.status}`);
  return res.text();
}

/** Orders whose facility name holds every word of the company's name. */
async function searchEpd(name: string): Promise<EnforcementHit[]> {
  if (!tokens(name).length || name.trim().length < 3) return [];
  const q = (p: number) => `${ENFO}/Search?${new URLSearchParams({ Facility: name.trim().slice(0, 100), Status: "All", ...(p > 1 ? { p: String(p) } : {}), handler: "search" })}`;
  const first = await epdText(q(1));
  if (!/Total results:|No orders found|No results/i.test(first)) throw new Error("Georgia EPD orders returned an unexpected page");
  const { total, rows } = parseEpdSearch(first);
  const pages = Math.min(MAX_PAGES, Math.ceil(total / 25));
  for (let p = 2; p <= pages; p++) rows.push(...parseEpdSearch(await epdText(q(p))).rows);
  const out: EnforcementHit[] = [];
  const notes: string[] = [];
  if (total > pages * 25) notes.push(`the EPD search found ${total} orders by facility name; the first ${pages * 25} were checked`);
  const named = rows.filter((r) => hasAllWords(name, r.facility));
  if (named.length > MAX_DETAILS) notes.push(capNote(MAX_DETAILS, named.length, "orders naming this business (each one's details page is read)"));
  for (const row of named.slice(0, MAX_DETAILS)) {
    const url = row.details ? `${ENFO}${row.details}` : `${ENFO}/Search`;
    const d = row.details ? parseEpdDetails(await epdText(url)) : {};
    out.push(epdHit(row, d, url));
  }
  return withNote(out.filter((h) => clean(h.name)), notes.join("; ") || null);
}

// ── GSWCC erosion and sedimentation control certifications ─────────────────────────────────────────────────────
const ESC = "https://www.gaswcc.org/esc-search.php";
const ESC_SOURCE = "Georgia Soil and Water Conservation Commission erosion and sedimentation control certifications";
/** The result table's columns, in the publisher's order (the header row of the verification page). */
const ESC_LEVELS: [number, string][] = [[8, "Level AW"], [9, "Level 1A"], [10, "Level 1B"], [11, "Level II"], [13, "Trainer 1"], [14, "Trainer 2"]];
const ESC_MAX = 200;

/** Every certification row of a verification result page. */
export function parseEscRows(html: string): LicenseHit[] {
  const out: LicenseHit[] = [];
  for (const m of Array.from(html.matchAll(/<tr>\s*(<td>\d{6,10}<\/td>[\s\S]*?)<\/tr>/g))) {
    const c = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((x) => htmlText(x[1]));
    if (c.length < 15) continue;
    const who = clean([c[2], c[3], c[4]].filter(Boolean).join(" "));
    if (!who || !c[0]) continue;
    const levels = ESC_LEVELS.flatMap(([i, label]) => {
      const d = anyDay(c[i]);
      if (!d && !c[i]) return [];
      const kind = i === 11 && c[12] ? ` (${c[12]})` : "";
      return [{ text: `${label}${kind} expires ${d ?? c[i]}`, date: d }];
    });
    const expires = levels.map((l) => l.date).filter((d): d is string => !!d).sort().pop() ?? null;
    out.push({
      state: "GA", source: ESC_SOURCE, sourceUrl: ESC, businessName: null, licenseNumber: c[0],
      licenseType: "Erosion and sedimentation control certification", specialty: levels.map((l) => l.text).join("; ") || null,
      status: null, principal: who, city: [c[5], c[6]].filter(Boolean).join(", ") || null, expires, matchedOn: "principal",
      address: null, phone: null, people: [{ name: who, role: c[1] ? `Trainer ID ${c[1]}` : null }], holder: "individual",
    });
  }
  return out;
}

async function escPost(query: string, form: Record<string, string>): Promise<string> {
  const res = await politeFetch(`${ESC}?search=${query}`, { method: "POST", body: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } }, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`GSWCC certification verification returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/Certification Verification/.test(html)) throw new Error("GSWCC certification verification returned an unexpected page");
  return html;
}

/** A person: the form takes first name and last name (min 3 letters) and matches part of the last name. */
async function searchEsc(name: string): Promise<LicenseHit[]> {
  const n = splitName(name);
  if (!n || n.last.length < 3) return [];
  const rows = parseEscRows(await escPost("name", { fname_value: n.first, midinit_value: "", lname_value: n.last }));
  const found = rows.filter((h) => hasAllWords(name, h.principal));
  return found.length > ESC_MAX ? withNote(found.slice(0, ESC_MAX), capNote(ESC_MAX, found.length, "certifications")) : found;
}

const normCert = (v: string) => v.replace(/\D/g, "").replace(/^0+/, "");

async function searchEscBy(q: IdQuery): Promise<LicenseHit[] | null> {
  // Only a certification ID (digits, up to 10) is searchable here.
  if (q.type !== "license" || !/^\s*\d{1,10}\s*$/.test(q.value) || !normCert(q.value)) return null;
  const rows = parseEscRows(await escPost("cert", { id_value: q.value.trim() }));
  return rows.filter((h) => normCert(h.licenseNumber ?? "") === normCert(q.value)).map((h) => ({ ...h, matchedOn: "license" as const }));
}

const LIVE_LICENSES: LiveLicenseSearch[] = [
  // Certifications are people's: a company name is not searched here (round 2, decision 8).
  { source: ESC_SOURCE, sourceUrl: ESC, kinds: ["person"], search: (name) => searchEsc(name), searchBy: searchEscBy },
];

// ── EPD licensed asbestos abatement firms ───────────────────────────────────────────────────────────────────────
const ASB_PAGE = "https://epd.georgia.gov/about-us/land-protection-branch/recovered-materials-and-abatement/asbestos/asbestos-contractors-and";
const ASB_PDF = "https://epd.georgia.gov/document/document/georgia-licensed-asbestos-abatement-firms/download";
const ASB_LABEL = "Georgia EPD licensed asbestos abatement firms";

export type AsbFirm = { name: string; city: string; state: string; zip: string; expires: string | null };

/** "… City   ST   ZIP   (phone)   M/D/YYYY" at a line's end; the phone may be missing. */
const ASB_TAIL = /^(.*?)\s{2,}([A-Za-z][A-Za-z .'-]*?)\s{2,}([A-Z]{2})\s{2,}(\d{5}(?:-?\d{4})?)\s{2,}(?:\(?\d{3,4}\)?\s?\d{3}-\d{4}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s*$/;
/** The same, where a long address runs into the city ("…Drive, Ste 7 Marietta"): the city follows the address's last numbered word. */
const ASB_TAIL_RUN = /^(.*?)\s{2,}\S.*\d\S*\s([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*)*)\s{2,}([A-Z]{2})\s{2,}(\d{5}(?:-?\d{4})?)\s{2,}(?:\(?\d{3,4}\)?\s?\d{3}-\d{4}\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\s*$/;
const ENDS_IN_DATE = /\d{1,2}\/\d{1,2}\/\d{4}\s*$/;
const ASB_NOISE = /^\s*(Georgia Licensed Asbestos Abatement Firms|Disclaimer:|any of the listed firms|or firm before hiring|Company Name\s+Full Company Address)/i;

/** The name part of a line: before its first wide gap, and before an address that runs into it ("…, Inc. 630 Industrial Avenue"). */
function namePart(line: string, addressWrapped = false): string {
  const first = line.split(/\s{2,}/)[0] ?? "";
  // A street number after the name's last word ("Southeast Environmental Solutions 1189 Brown Street", "…, Inc. 4035-C …").
  const cut = first.replace(/^(.*?[A-Za-z.,)])\s+\d+(?:-?[A-Za-z])?\s+[A-Za-z0-9].*$/, "$1").trim();
  // Under a wrapped address the address's last word can run into the name ("Environmental Construction, Inc. Boulevard").
  return addressWrapped ? cut.replace(/^(.*\b(?:Inc|LLC|L\.L\.C|Co|Corp|Ltd)\.?,?)\s+\S.*$/i, "$1") : cut;
}

/** Every firm in the list's text (pdftotext -layout). Wrapped names (the lines above a row) are joined to it. */
export function parseAsbestosFirms(text: string): AsbFirm[] {
  const out: AsbFirm[] = [];
  let pending: string[] = [];
  let addressWrapped = false;
  for (const raw of textLines(text)) {
    if (!raw.trim() || ASB_NOISE.test(raw)) { pending = []; addressWrapped = false; continue; }
    const m = raw.match(ASB_TAIL) ?? raw.match(ASB_TAIL_RUN);
    const indented = /^\s{10,}/.test(raw);
    if (!m && ENDS_IN_DATE.test(raw)) { pending = []; addressWrapped = false; continue; } // a row this reader can't split is skipped, never joined to the next
    if (!m) { if (indented) addressWrapped = true; else pending.push(namePart(raw)); continue; } // a wrapped name or a wrapped address
    const own = indented ? "" : namePart(m[1], addressWrapped);
    const name = clean([...pending, own].filter(Boolean).join(" ").replace(/\s+/g, " "));
    pending = [];
    addressWrapped = false;
    if (!name) continue;
    out.push({ name, city: m[2].trim(), state: m[3], zip: m[4].slice(0, 5), expires: anyDay(m[5]) });
  }
  return out;
}

export function asbestosHit(f: AsbFirm): LicenseHit {
  return {
    state: "GA", source: ASB_LABEL, sourceUrl: ASB_PAGE, businessName: f.name, licenseNumber: null,
    licenseType: "Licensed asbestos abatement firm", specialty: null, status: null, principal: null,
    city: `${f.city}, ${f.state} ${f.zip}`, expires: f.expires, matchedOn: "business",
    // EPD's list speaks of "firms and/or individuals" and publishes no entity type, so the holder is unknown.
    address: null, phone: null, people: [], holder: null,
  };
}

async function* asbestosFirms(): AsyncIterable<BulkHit> {
  const path = await download(ASB_PDF);
  let text: string;
  try { text = (await pdfText(await fs.readFile(path))).text; } finally { await fs.rm(path, { force: true }); }
  if (!/Georgia Licensed Asbestos Abatement Firms/i.test(text)) throw new Error(`${ASB_PDF} is not the licensed asbestos firms list`);
  const seen = new Set<string>();
  for (const f of parseAsbestosFirms(text)) {
    const key = `${f.name.toLowerCase()}|${f.zip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    yield { kind: "license", hit: asbestosHit(f), business: f.name, person: null };
  }
}

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "Georgia EPD enforcement orders", scope: "Proposed and executed EPD orders, 1998 to today (facility name)", category: "environmental", search: searchEpd },
];

export const pack: StatePack = {
  state: "GA",
  checked: "2026-10-15",
  liveLicenses: LIVE_LICENSES,
  bulk: [
    // 176 firms on 2026-10-15; the list is revised every few months.
    { id: "ga-epd-asbestos-firms", state: "GA", label: ASB_LABEL, pageUrl: ASB_PAGE, everyHours: 24 * 7, minRows: 120, load: asbestosFirms },
  ],
  liveEnforcement: LIVE_ENFORCEMENT,
  blocked: [
    "Georgia Secretary of State licensing boards (verify.sos.ga.gov/verification/Search.aspx: Residential and General Contractors, Construction Industry Licensing Board electrical, plumbing, conditioned air, low voltage, utility; engineers) and their board orders and roster request pages (sos.ga.gov): HTTP 403 with cf-mitigated: challenge (Cloudflare) on every page, robots.txt included (verify.sos.ga.gov/robots.txt redirects to Search.aspx, which is challenged); rechecked 2026-10-15",
    "Georgia Secretary of State license rosters (bulk): ordered with a paper Roster Request Form and payment by check or money order (sos.ga.gov/page/licensing-roster-requests, behind the Cloudflare challenge); the store link a 2023 records response gave (georgiasecretaryofstate.net/collections/license-roster) returns HTTP 404 on 2026-10-15; needs the owner",
    "Georgia DPH certified septic tank installer companies (dph.georgia.gov/media/92731/download, EnvHealthInstallers.pdf dated 10/9/2026): free and robots-allowed, but only a company name and phone in three columns per county, no license number or city; 'Companies and individuals are certified', so the holder is unknown. Not loaded",
    "Georgia Secretary of State corporations (ecorp.sos.ga.gov): Cloudflare challenge; bulk corporations data is sold ($1,000 one-time or $500/month)",
    "Georgia Insurance and Safety Fire Commissioner licensed professionals (sprinkler, elevator, boiler; Citizenserve portal): \"I am human\" check before results",
    "Georgia DOAS suspended and debarred suppliers (doas.ga.gov, purchasing law page): the current FY27 list (a .docx posted 2026-08) says NONE, as did FY23 and FY24; rechecked 2026-10-15",
    "GSFIC debarred, suspended or ineligible firms (gsfic.georgia.gov): still one PDF last updated 2020-01-10, with no firms listed; rechecked 2026-10-15",
  ],
};
