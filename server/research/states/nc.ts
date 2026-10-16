/**
 * North Carolina. Checked live 2026-10-15. Three licensing boards share one public portal product (./lib/g3-arls.ts),
 * each searched live per report (no CAPTCHA; robots.txt absent):
 *
 *   NC Licensing Board for General Contractors (portal.nclbgc.org): licenses and qualifiers, with each license's
 *     "Disciplinary Action (2022-present)" list (case number, date, the order as a document) as enforcement
 *   NC Board of Examiners of Electrical Contractors (arls-public.ncbeec.org): licenses and their qualifiers
 *   NC State Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors (public.nclicensing.org): licenses
 *     and their classification holders (this board shows no license status)
 *
 * Two smaller boards publish their disciplinary actions as web pages (bulk, weekly; robots.txt disallows only
 * /wp-admin/; each site states only a copyright line, no reuse terms; checked 2026-10-15). Companies only: the
 * people they name are never kept.
 *   nc-iclb-discipline  NC Irrigation Contractors' Licensing Board "Disciplinary Summary" tables, licensed and
 *                       unlicensed contractors (Case #, Company Name, Status, Alleged Violation).
 *   nc-lclb-enforcement NC Landscape Contractors' Licensing Board "Complaint Resolutions and Enforcement Actions"
 *                       (case number, then the action and the parties: "Consent Judgment – <person> – <business>").
 *
 * Each board is also searched by license number, phone and street address (the portal's own form fields). Every hit
 * carries the published address, phone and people (qualifiers, classification holders, contact) with their roles.
 */
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import type { EnforcementHit } from "@shared/research-reports";
import { clean, type BulkHit, type BulkSource } from "../bulk";
import { politeText } from "../http";
import { decodeEntities } from "../bulk-sources";
import { adverseFrom } from "../adverse";
import { looksLikeBusiness, personNameForm } from "./lib/business-name";
import { searchArlsBy, searchArlsLicenses, searchArlsMatters, type ArlsBoard } from "./lib/g3-arls";

const NCLBGC: ArlsBoard = {
  state: "NC", source: "NC Licensing Board for General Contractors", base: "https://portal.nclbgc.org",
  classField: "ClassificationDefinitionIdnt", licenseLabel: "General Contractor License", qualifierField: true, mattersPath: "/Public/_ShowNCLBGCPublicMatters/",
};
const NCBEEC: ArlsBoard = {
  state: "NC", source: "NC Board of Examiners of Electrical Contractors", base: "https://arls-public.ncbeec.org",
  classField: "AccountDefinitionIdnt", licenseLabel: "Electrical Contractor License",
};
const NCPHFS: ArlsBoard = {
  state: "NC", source: "NC Board of Examiners of Plumbing, Heating & Fire Sprinkler Contractors", base: "https://public.nclicensing.org",
  classField: "ClassificationDefinitionIdnt", licenseLabel: "Plumbing, Heating or Fire Sprinkler Contractor License", noQualifiers: true,
};

const live = (b: ArlsBoard): LiveLicenseSearch => ({ source: b.source, sourceUrl: `${b.base}/Public/Search`, search: (name, kind) => searchArlsLicenses(b, name, kind), searchBy: (q) => searchArlsBy(b, q) });

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "NC Licensing Board for General Contractors: disciplinary actions", scope: "Disciplinary actions on general contractor licenses, 2022 to today", category: "discipline", search: (name) => searchArlsMatters(NCLBGC, name) },
];

// ── Irrigation and landscape contractor boards ────────────────────────────────────────────────────────────────

const ICLB_PAGES = ["https://www.nciclb.org/laws-enforcement/disciplinary-summary/", "https://www.nciclb.org/laws-enforcement/disciplinary-summary-page2/"];
const ICLB_SOURCE = "NC Irrigation Contractors' Licensing Board disciplinary actions";
const LCLB_PAGES = [
  "https://nclclb.com/statutes-and-rules/enforcement-actions/",
  "https://nclclb.com/statutes-and-rules/enforcement-actions/enforcements-continued-page-2/",
  "https://nclclb.com/enforcements-continued/",
];
const LCLB_SOURCE = "NC Landscape Contractors' Licensing Board enforcement actions";

/** Visible text: inline tags (span, strong, em, a, b, i) vanish without a space, since the boards split words with them ("Ac<span>evedo</span>"); other tags are a space. */
const txt = (v: string | undefined) => clean(decodeEntities((v ?? "").replace(/<\/?(?:span|strong|em|a|b|i|u|font)\b[^>]*>/gi, "").replace(/<[^>]+>/g, " ")).replace(/\u00a0/g, " ").replace(/\s+([.,])/g, "$1"));
/** A cell or list of names split on commas and dashes, an entity word ("LLC", "Inc.") staying with the name before it. */
function businessNames(v: string): string[] {
  const parts: string[] = [];
  for (const piece of v.split(/\s*[–-]\s+|\s*–\s*|,/).map((p) => p.replace(/\([^)]*\)/g, "").trim()).filter(Boolean)) {
    if (/^(?:L\.?L\.?[CP]|Inc|Corp|Co|Ltd|P\.?C|L\.?P)\.?$/i.test(piece) && parts.length) parts[parts.length - 1] += `, ${piece}`;
    else parts.push(piece);
  }
  return Array.from(new Set(parts)).filter((n) => personNameForm(n) === null && looksLikeBusiness(n));
}

export type IclbRow = { caseNo: string; company: string | null; status: string | null; violation: string | null; licensed: boolean };

/** Both disciplinary-summary tables; the last column (the licensee or the unlicensed person) is never read. */
export function parseIclb(html: string): IclbRow[] {
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  const licensed = /Licensee<\/t[hd]>/.test(table) && !/Unlicensed Contractor<\/t[hd]>/.test(table);
  return Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)).map((m) => Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => txt(c[1])))
    .filter((c) => c.length >= 4 && /^[LU]\d{2}-\d+/.test(c[0] ?? ""))
    .map((c) => ({ caseNo: c[0]!.replace(/\s+/g, ""), company: c[1], status: c[2], violation: c[3], licensed }));
}

/** One case naming a business: the board's own outcome words decide adverse (a dismissal or no probable cause is not). */
export function iclbHits(r: IclbRow, sourceUrl: string): EnforcementHit[] {
  if (!r.company || !/^closed/i.test(r.status ?? "")) return [];
  return businessNames(r.company).map((name) => ({
    state: "NC", source: ICLB_SOURCE, sourceUrl, category: "discipline" as const, name, id: r.caseNo, date: null, endDate: null,
    status: `${r.licensed ? "Licensed" : "Unlicensed"} contractor case ${r.status}${r.violation ? `: ${r.violation}` : ""}`,
    city: null, detail: `Case ${r.caseNo} (${r.licensed ? "against a licensed irrigation contractor" : "unlicensed irrigation work"})`,
    amount: null, adverse: adverseFrom(r.violation),
  }));
}

export type LclbEntry = { caseNo: string; text: string; file: string | null };

/** "26.308.U Consent Judgment – Baldwin, Eric Scott – Yardie, LLC": one entry per line (a <br> or a paragraph). */
export function parseLclb(html: string, base: string): LclbEntry[] {
  const body = html.slice(html.indexOf("entry-content"), html.indexOf("Important Links") > 0 ? html.indexOf("Important Links") : undefined);
  const out: LclbEntry[] = [];
  for (const line of body.split(/<br\s*\/?>|<\/p>/i)) {
    const t = txt(line);
    const m = t?.match(/^(\d{2}\.\d{3}\.[US])\*?\s+(.+)$/);
    if (!m) continue;
    const href = line.match(/href="([^"]+\.pdf)"/i)?.[1];
    out.push({ caseNo: m[1], text: m[2], file: href ? new URL(href, base).toString() : null });
  }
  return out;
}

/**
 * An entry with an order names its parties after the action ("Default Judgment – <person> – <business>"): each
 * business named is a record, adverse from the board's action word (adverseFrom). Entries without parties (under
 * investigation, pending, dismissed without a name) give none.
 */
export function lclbHits(e: LclbEntry, page: string): EnforcementHit[] {
  const m = e.text.match(/^(.+?)\s*[–-]\s+(.+)$/) ?? e.text.match(/^((?:Default|Consent) Judge?ment|Consent Order|Injunction)\s+(.+)$/i);
  if (!m || /^(?:dismissed|resolved)\b/i.test(m[1]) || /under investigation|pending/i.test(e.text)) return [];
  const action = m[1].replace(/[–-]\s*$/, "").replace(/^\*\s*/, "").trim();
  return businessNames(m[2]).map((name) => ({
    state: "NC", source: LCLB_SOURCE, sourceUrl: e.file ?? page, category: "discipline" as const, name, id: e.caseNo, date: null, endDate: null,
    status: `Board action: ${action}`, city: null,
    detail: `Case ${e.caseNo} (filed in 20${e.caseNo.slice(0, 2)}; ${e.caseNo.endsWith("U") ? "unlicensed practice" : "minimum standards violation"})`,
    amount: null, adverse: adverseFrom(action),
  }));
}

const NC_BOARDS: BulkSource[] = [
  { id: "nc-iclb-discipline", state: "NC", label: ICLB_SOURCE, pageUrl: ICLB_PAGES[0], everyHours: 24 * 7, minRows: 60, companiesOnly: true, category: "discipline",
    load: async function* (): AsyncIterable<BulkHit> {
      let rows = 0;
      for (const url of ICLB_PAGES) {
        const parsed = parseIclb(await politeText(url, {}, { minDelayMs: 1500 }));
        rows += parsed.length;
        for (const r of parsed) for (const hit of iclbHits(r, url)) yield { kind: "enforcement", hit, business: hit.name!, person: null };
      }
      if (rows < 150) throw new Error(`the irrigation board's disciplinary tables changed (${rows} rows read)`);
    } },
  { id: "nc-lclb-enforcement", state: "NC", label: LCLB_SOURCE, pageUrl: LCLB_PAGES[0], everyHours: 24 * 7, minRows: 25, companiesOnly: true, category: "discipline",
    load: async function* (): AsyncIterable<BulkHit> {
      let entries = 0;
      for (const url of LCLB_PAGES) {
        const parsed = parseLclb(await politeText(url, {}, { minDelayMs: 1500 }), url);
        entries += parsed.length;
        for (const e of parsed) for (const hit of lclbHits(e, url)) yield { kind: "enforcement", hit, business: hit.name!, person: null };
      }
      if (entries < 100) throw new Error(`the landscape board's enforcement pages changed (${entries} entries read)`);
    } },
];

export const pack: StatePack = {
  state: "NC",
  checked: "2026-10-15",
  liveLicenses: [live(NCLBGC), live(NCBEEC), live(NCPHFS)],
  liveEnforcement: LIVE_ENFORCEMENT,
  bulk: NC_BOARDS,
  blocked: [
    "NC Division of Purchase and Contract debarred vendors (ncadmin.nc.gov/government-agencies/procurement/contracts/debarred-vendors, CSV and PDF, revised 6/1/2021): not used, because the page's terms (www.nc.gov/disclaimer-terms-use, read 2026-10-15) grant \"permission to copy and distribute non-image files, documents, and information for non-commercial use\" only (coordinator's decision, 2026-10-15)",
    "nclbgc.org (the board's main site, including its disciplinary news): Cloudflare challenge on every page; the portal.nclbgc.org search is used instead",
    "NCBEEC public matters (/Public/_ShowAccountPublicMatters/): endpoint exists but no populated example was found to verify its layout, so it isn't searched",
    "NC Secretary of State business registration: bulk data is a paid subscription and the SOS bars automated searching of its online tools",
    "NC Industrial Commission (workers' comp penalties, stop-work): no published list of penalized or noncompliant employers",
  ],
};
