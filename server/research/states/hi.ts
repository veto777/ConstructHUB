/**
 * Hawaii. Every source below was opened and read live on 2026-10-15; layouts, statuses and outcome meanings are the
 * Department of Commerce and Consumer Affairs' (DCCA) own.
 *
 *   Bulk (licenses):
 *     PVL "Current Licenses" reports linked from cca.hawaii.gov/pvl/hire-a-licensed-contractor/ (Excel; the page
 *       links the newest one, 2026-04-06 today): contractors by classification, electricians and plumbers, and
 *       engineers/architects/surveyors/landscape architects (EASLA). Current licenses only, as of the report date.
 *   Bulk (companies only):
 *     DCCA disciplinary actions (monthly OAH news releases on cca.hawaii.gov/oah, 2019 to today, read through the
 *       site's WordPress REST API): board orders and
 *       settlements of the Contractors License Board, the Board of Electricians and Plumbers, the Elevator Mechanics
 *       Licensing Board and the engineers/architects board, with case number, sanction, effective date and RICO's
 *       allegation. Only business respondents are indexed.
 *   Live enforcement (companies only):
 *     RICO Complaints History Search (web2.dcca.hawaii.gov/rico): every complaint RICO publishes on the business, with
 *       its outcome, fines and action, through the search page's own JSON API.
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { clean, download } from "../bulk";
import type { BulkHit, BulkSource } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import { politeFetch } from "../http";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { anyDay, businessParts, fetchJson, money, nameMatches, usd } from "./lib/g8-common";
import { looksLikeBusiness } from "./lib/business-name";
import { adverseFrom } from "../adverse";
import { capNote, escapeRegExp, withNote } from "../notes";
import { xlsxRows } from "./lib/g8-xlsx";

// ── PVL current-license reports (Excel) ──────────────────────────────────────────────────────────────────────
const PVL_PAGE = "https://cca.hawaii.gov/pvl/hire-a-licensed-contractor/";
const PVL_REPORTS: { match: RegExp; label: string; layout: "contractors" | "byType" }[] = [
  { match: /PVL_Report_Contractors_Current_Licenses[^"']*\.xlsx/i, label: "Hawaii Contractors License Board licenses", layout: "contractors" },
  { match: /PVL_Report_Electricians_Plumbers_Current_Licenses[^"']*\.xlsx/i, label: "Hawaii Board of Electricians and Plumbers licenses", layout: "byType" },
  { match: /PVL_Report_EASLA_Current_Licenses[^"']*\.xlsx/i, label: "Hawaii engineers, architects, surveyors and landscape architects licenses", layout: "byType" },
];

async function text(url: string): Promise<string> {
  const res = await politeFetch(url, {}, { minDelayMs: 1500, retries: 3 });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** The "As of YYYY-MM-DD" line of a report. */
const asOfDate = (rows: string[][]) => { for (const r of rows.slice(0, 6)) for (const c of r) { const m = c.match(/As of (\d{4}-\d{2}-\d{2})/); if (m) return m[1]; } return null; };

export function parsePvlReport(rows: string[][], label: string, layout: "contractors" | "byType"): BulkHit[] {
  const asOf = asOfDate(rows);
  const head = rows.findIndex((r) => r.some((c) => /^Licensee\b/.test(c.trim())) || r.some((c) => /^License Type Description/.test(c.trim())));
  if (head < 0) throw new Error(`${label}: header row not found`);
  const h = rows[head].map((c) => c.replace(/\s*↑\s*$/, "").trim());
  const col = (name: string) => h.findIndex((c) => c === name);
  const status = (v: string) => (clean(v) ? `${clean(v)}${asOf ? ` (current-license report of ${asOf})` : ""}` : null);
  const out: BulkHit[] = [];
  if (layout === "contractors") {
    const iName = col("Licensee"), iNo = col("License: License Number"), iClass = col("Classification: Classification Name"), iTrade = col("Trade/Professional Name"),
      iStatus = col("Status"), iExp = col("Effective Expire Date"), iStreet = col("Business Street"), iCity = col("Business City"), iSt = col("Business State"), iZip = col("Business Zip Code");
    if ([iName, iNo, iClass, iStatus, iExp].some((i) => i < 0)) throw new Error(`${label}: unexpected columns`);
    let cur: { name: string; no: string; trade: string | null; status: string | null; exp: string | null; city: string | null; address: string | null; locality: string | null; classes: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      // A sole proprietor's license is under the person's name (./lib/business-name.ts decides): the person is the
      // principal, the trade name (if any) is the business, and only the trade name is indexed as a business name.
      const isBiz = looksLikeBusiness(cur.name);
      const business = isBiz ? cur.name : cur.trade;
      // A person with no trade name: the "business" address is where they live, so city, state and ZIP only.
      const address = business ? cur.address : cur.locality;
      out.push({
        kind: "license",
        hit: {
          state: "HI", source: label, sourceUrl: PVL_PAGE, businessName: business, licenseNumber: cur.no, licenseType: "Contractor license",
          specialty: cur.classes.length ? `Classes: ${cur.classes.join(", ")}` : null, status: status(cur.status ?? ""), principal: isBiz ? null : cur.name,
          city: cur.city, expires: anyDay(cur.exp), matchedOn: isBiz ? "business" : "principal", address,
        },
        keys: business ? { licenses: [cur.no], addresses: [cur.address] } : { licenses: [cur.no] },
        business: isBiz ? [cur.name, cur.trade].filter(Boolean).join(" ") : cur.trade, person: isBiz ? null : cur.name,
      });
      cur = null;
    };
    for (const r of rows.slice(head + 1)) {
      const name = clean(r[iName]), no = clean(r[iNo]), cls = clean(r[iClass]);
      if (name && /^(subtotal|total)$/i.test(name)) continue;
      if (name && no) { flush(); cur = { name, no, trade: clean(r[iTrade]), status: clean(r[iStatus]), exp: clean(r[iExp]), city: clean(r[iCity]),
        address: [r[iStreet], r[iCity], r[iSt], r[iZip]].map((v) => clean(v)).filter(Boolean).join(" ") || null,
        locality: [r[iCity], r[iSt], r[iZip]].map((v) => clean(v)).filter(Boolean).join(" ") || null, classes: [] }; }
      if (cur && cls && !cur.classes.includes(cls)) cur.classes.push(cls);
    }
    flush();
  } else {
    const iType = col("License Type Description"), iNo = col("License: License Number"), iName = col("Licensee"), iStatus = col("Status"), iExp = col("Effective Expire Date");
    if ([iType, iNo, iName, iStatus, iExp].some((i) => i < 0)) throw new Error(`${label}: unexpected columns`);
    let type: string | null = null;
    for (const r of rows.slice(head + 1)) {
      const t = clean(r[iType]);
      if (t && /^(subtotal|total)$/i.test(t)) continue;
      if (t) type = t;
      const no = clean(r[iNo]), name = clean(r[iName]);
      if (!no || !name) continue;
      const isBiz = looksLikeBusiness(name);
      out.push({
        kind: "license",
        hit: {
          state: "HI", source: label, sourceUrl: PVL_PAGE, businessName: isBiz ? name : null, licenseNumber: no, licenseType: type, specialty: null,
          status: status(r[iStatus] ?? ""), principal: isBiz ? null : name, city: null, expires: anyDay(r[iExp]), matchedOn: isBiz ? "business" : "principal",
        },
        business: isBiz ? name : null, person: isBiz ? null : name, keys: { licenses: [no] },
      });
    }
  }
  return out;
}

async function* pvlLoader(): AsyncIterable<BulkHit> {
  const page = await text(PVL_PAGE);
  for (const rep of PVL_REPORTS) {
    const link = page.match(new RegExp(`https://cca\\.hawaii\\.gov/wp-content/uploads/[^"']*?${rep.match.source}`, "i"))?.[0];
    if (!link) throw new Error(`${rep.label}: no report linked from ${PVL_PAGE}`);
    const path = await download(link);
    try { yield* parsePvlReport(await xlsxRows(path), rep.label, rep.layout); }
    finally { await fs.rm(path, { force: true }); }
  }
}

// ── DCCA disciplinary actions (OAH monthly releases) ─────────────────────────────────────────────────────────
const OAH_INDEX = "https://cca.hawaii.gov/oah/disciplinary-actions/";
/** Case-number prefixes of the construction boards (RICO's "Major Prefixes" list). */
const BOARDS: Record<string, string> = {
  CLB: "Contractors License Board", ENP: "Board of Electricians and Plumbers", EVM: "Elevator Mechanics Licensing Board",
  ENG: "Board of Professional Engineers, Architects, Surveyors and Landscape Architects",
};

/** The text of a release, one line per paragraph or line break. */
function releaseLines(html: string): string[] {
  const main = html.slice(Math.max(0, html.indexOf("<main")));
  const body = main.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodeEntities(body).replace(/ /g, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function parseDisciplinaryRelease(html: string, url: string): EnforcementHit[] {
  const lines = releaseLines(html);
  const out: EnforcementHit[] = [];
  const end = lines.findIndex((l) => /^Copies of the decisions/i.test(l));
  const body = end > 0 ? lines.slice(0, end) : lines;
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^Respondents?\s*:\s*(.+)$/i);
    if (!m) continue;
    const get = (label: RegExp) => { for (let j = i + 1; j < Math.min(i + 6, body.length); j++) { const x = body[j].match(label); if (x) return clean(x[1]); if (/^Respondents?\s*:/i.test(body[j])) break; } return null; };
    const caseNo = get(/^Case Numbers?\s*:\s*(.+)$/i);
    const prefix = caseNo?.match(/^([A-Z]{3})\b/)?.[1];
    if (!caseNo || !prefix || !BOARDS[prefix]) continue;
    const sanction = get(/^Sanctions?\s*:\s*(.+)$/i);
    const effective = get(/^Effective Dates?\s*:\s*(.+)$/i);
    let allegation: string | null = null;
    for (let j = i + 1; j < Math.min(i + 8, body.length); j++) {
      if (/^Respondents?\s*:/i.test(body[j])) break;
      if (/^(RICO alleges|Respondent|The Board|On or about)/i.test(body[j]) && !/^(Case Number|Sanction|Effective Date)/i.test(body[j])) { allegation = body[j]; break; }
    }
    // businessParts drops "LAST, FIRST" people; ./lib/business-name.ts then drops bare names ("Kurt W. Williams").
    // A name written after "dba" is a trade name, a business even without a business word.
    const names = businessParts(m[1]).filter((n) => looksLikeBusiness(n) || new RegExp(`\\bd/?b/?a\\s+${escapeRegExp(n)}`, "i").test(m[1]));
    if (!names.length) continue; // people only: not indexed (companies only)
    const fine = sanction?.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
    out.push({
      state: "HI", source: "Hawaii DCCA disciplinary actions (construction boards)", sourceUrl: url, category: "discipline",
      name: names.join(" / "), id: caseNo, date: anyDay(effective?.match(/[\d/-]+/)?.[0]), endDate: null,
      status: sanction ? `${BOARDS[prefix]}: ${sanction}` : BOARDS[prefix], city: null,
      detail: allegation?.slice(0, 800) ?? null, amount: fine ? Number(fine.replace(/,/g, "")) : null, adverse: adverseFrom(sanction),
    });
  }
  return out;
}

/**
 * The releases are WordPress posts of the site's "oah" type: read through the site's REST API, 50 posts with their
 * full text a request (a few requests a load; fetching each release page instead trips the site's rate limit).
 */
async function* disciplineLoader(): AsyncIterable<BulkHit> {
  const seen = new Set<string>();
  let posts = 0;
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({ search: "disciplinary actions", per_page: "50", page: String(page), _fields: "link,date,title,content" });
    const res = await politeFetch(`https://cca.hawaii.gov/wp-json/wp/v2/oah?${q}`, { headers: { accept: "application/json" } }, { minDelayMs: 5000, retries: 3 });
    if (res.status === 400) {
      // Past the last page WordPress answers 400 with code "rest_post_invalid_page_number"; any other 400 is an error.
      const err = await res.json().catch(() => null) as { code?: string } | null;
      if (err?.code === "rest_post_invalid_page_number") break;
      throw new Error(`DCCA releases returned HTTP 400${err?.code ? ` (${err.code})` : ""}`);
    }
    if (!res.ok) throw new Error(`DCCA releases returned HTTP ${res.status}`);
    const items = await res.json() as { link?: string; title?: { rendered?: string }; content?: { rendered?: string } }[];
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      if (typeof it.link !== "string" || !/disciplinary actions/i.test(decodeEntities(it.title?.rendered ?? "")) || !it.content?.rendered) continue;
      posts++;
      for (const hit of parseDisciplinaryRelease(it.content.rendered, it.link)) {
        const key = `${hit.id}|${hit.name}`;
        if (seen.has(key)) continue; // a case repeated in a later release
        seen.add(key);
        yield { kind: "enforcement", hit, business: hit.name!.replace(/ \/ /g, " "), person: null };
      }
    }
    if (items.length < 50) break;
  }
  if (!posts) throw new Error("no DCCA disciplinary-action releases found");
}

// ── RICO complaint history (live) ────────────────────────────────────────────────────────────────────────────
const RICO_PAGE = "https://web2.dcca.hawaii.gov/rico/";
const RICO_API = "https://web2.dcca.hawaii.gov/WebAPI/api/1.0/priorcomplaint";
/** Outcomes, from the search page's glossary. */
const RICO_ADVERSE: Record<string, boolean | null> = { "LEGAL ACTION IMPOSED": true, "NO LEGAL ACTION IMPOSED": false, "LEGAL ACTION PENDING": null, PENDING: null };
const RICO_PREFIX: Record<string, string> = {
  CLB: "Contractor", ENP: "Electrician and Plumber", EVM: "Elevator Mechanic", ENG: "Engineer, Architect, Surveyor and Landscape Architect", PCO: "Pest Control",
};

type RicoItem = { contactId: number; displayName?: string; otherNames?: string };

async function ricoSearch(q: string): Promise<RicoItem[]> {
  const u = `${RICO_API}?${new URLSearchParams({ name: q, includeTotal: "true", take: "50", skip: "0", division: "RICO" })}`;
  const body = await fetchJson<{ items?: RicoItem[]; success?: boolean }>(u, { headers: { accept: "application/json" } }, "RICO complaints history");
  if (!body.success || !Array.isArray(body.items)) throw new Error("RICO complaints history returned an unexpected payload");
  return body.items;
}

/** Associated names that are not a person written "LAST, FIRST" (those are never shown or matched). */
const businessAliases = (v: string | undefined) => (v ?? "").split(/\r?\n/).map((x) => clean(x)).filter((x): x is string => !!x && looksLikeBusiness(x));

const MAX_RICO_DETAILS = 10;

async function searchRico(name: string): Promise<EnforcementHit[]> {
  let items = await ricoSearch(name);
  if (!items.length) {
    const words = name.split(/\s+/).filter((w) => w.length >= 3);
    const longest = words.sort((a, b) => b.length - a.length)[0];
    if (longest && longest !== name) items = await ricoSearch(longest);
  }
  const out: EnforcementHit[] = [];
  const matched = items.filter((i) => nameMatches(name, i.displayName, ...businessAliases(i.otherNames)));
  for (const it of matched.slice(0, MAX_RICO_DETAILS)) {
    const d = await fetchJson<{ item?: any; success?: boolean }>(`${RICO_API}/${it.contactId}/Details?${new URLSearchParams({ contactId: String(it.contactId), division: "RICO" })}`,
      { headers: { accept: "application/json" } }, "RICO complaint details");
    if (!d.success || !d.item) throw new Error("RICO complaint details returned an unexpected payload");
    for (const g of d.item.complaintGroups ?? []) {
      // A complaint group under a person's own name (a sole proprietor) is a person's record (FCRA): left out.
      const proper = clean(g.properName);
      const names = [proper && looksLikeBusiness(proper) ? proper : null, ...businessAliases(g.otherNames)].filter((x): x is string => !!x);
      if (!names.length) continue;
      const who = names.join(" / ");
      for (const c of g.priorComplaints ?? []) {
        const outcome = clean(c.outcome);
        const prefix = clean(c.complaintNumber)?.match(/^([A-Z]{3})/)?.[1];
        const fine = money(c.fineAmount), restitution = money(c.restitutionAmount), cost = money(c.costAmount);
        out.push({
          state: "HI", source: "Hawaii RICO complaints history", sourceUrl: RICO_PAGE, category: "complaint",
          name: who, id: clean(c.complaintNumber), date: anyDay(c.actionDate), endDate: anyDay(c.outcomeDate),
          status: outcome ? `Outcome: ${outcome}` : "Complaint on record", city: null,
          detail: [prefix && RICO_PREFIX[prefix] ? `${RICO_PREFIX[prefix]} complaint` : null, clean(c.action?.description) ? `Latest action: ${clean(c.action.description)}` : null,
            Array.isArray(c.allegations) && c.allegations.length ? `Allegations: ${c.allegations.map((a: string) => clean(a)).filter(Boolean).join("; ")}` : null,
            fine ? `fine ${usd(fine)}` : null, restitution ? `restitution ${usd(restitution)}` : null, cost ? `costs ${usd(cost)}` : null,
            anyDay(c.complianceDate) ? `complied ${anyDay(c.complianceDate)}` : null].filter(Boolean).join(". ").slice(0, 800) || null,
          amount: fine, adverse: outcome ? RICO_ADVERSE[outcome.toUpperCase()] ?? null : null,
        });
      }
    }
  }
  return withNote(out, matched.length > MAX_RICO_DETAILS ? capNote(MAX_RICO_DETAILS, matched.length, "matching names") : null);
}

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Hawaii RICO complaints history", scope: "Complaints RICO publishes (all licensing areas; complaints with no legal action drop off after two to five years)", search: searchRico },
];

const bulk: BulkSource[] = [
  { id: "hi-pvl-licenses", state: "HI", label: "Hawaii PVL current licenses (contractors, electricians and plumbers, engineers and architects)", pageUrl: PVL_PAGE,
    everyHours: 24 * 7, minRows: 14_000, load: pvlLoader },
  { id: "hi-dcca-discipline", state: "HI", label: "Hawaii DCCA disciplinary actions (construction boards)", pageUrl: OAH_INDEX,
    everyHours: 24 * 7, minRows: 105, load: disciplineLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "HI",
  checked: "2026-10-15",
  bulk,
  liveEnforcement,
  blocked: [
    "PVL license search (mypvl.dcca.hawaii.gov): robots.txt disallows every path and Cloudflare answers 403",
    "PVL List Builder (full licensee lists with every status): paid ($5 plus $0.05 a record)",
    "Business Registration Division (hbe.dcca.hawaii.gov): robots.txt disallows every path",
    "BusinessCheck (businesscheck.hawaii.gov): Cloudflare error 1016, no response",
    "Office of Consumer Protection complaints history (same API, division OCP): returned no records for test names today; not used",
  ],
};
