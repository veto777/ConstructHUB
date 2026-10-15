/**
 * Louisiana. Every source here was opened and searched live on 2026-10-15; field labels, license types and statuses
 * are the board's own (CLAUDE.md: never fabricate government data).
 *
 *   LSLBC licenses (arlspublic.lslbc.louisiana.gov, the State Licensing Board for Contractors' public search), live
 *     per report: commercial, residential, home-improvement registration, mold-remediation and other LSLBC licenses,
 *     each with its status, effective and expiration dates, and the company's classifications with their
 *     qualifying parties. Companies by name (ByName), people by qualifying-party name (ByQP).
 *   LSLBC contractor violations (lslbc.gov/contractor-violations/, the board's published hearing results), bulk,
 *     weekly, companies only: hearing date, job number, allegation and action taken, 2019 to today.
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { tokens } from "../licenses";
import { normLicense, type IdQuery } from "../identifiers";
import { download, usDate, type BulkHit, type BulkSource } from "../bulk";
import { firstAmount, tableRows, text } from "./lib/g4-html";
import { adverseFrom } from "../adverse";
import { capNote, noteOf, withNote } from "../notes";
import type { StatePack } from "./types";

const ARLS = "https://arlspublic.lslbc.louisiana.gov";
const SEARCH_PAGE = `${ARLS}/Public/DetailedSearch/ByName`;
const QP_PAGE = `${ARLS}/Public/DetailedSearch/ByQP`;
const VIOLATIONS_PAGE = "https://lslbc.gov/contractor-violations/";
const MAX_DETAILS = 15;

/** The detail keys and names on a _DetailedSearch results table (one row per contractor, or per qualifier). */
export function parseLaResults(html: string): { key: string; name: string | null; qualifiers: string[] }[] {
  const out = new Map<string, { name: string | null; qualifiers: string[] }>();
  for (const row of Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const links = Array.from(row[1].matchAll(/ShowAccountDetails\('([^']+)'[^>]*>([\s\S]*?)<\/a>/g));
    if (!links.length) continue;
    // ByQP rows show the qualifier first and the company second; ByName rows show the company alone.
    const company = links[links.length - 1];
    const cur = out.get(company[1]) ?? { name: text(company[2]), qualifiers: [] };
    const qp = links.length > 1 ? text(links[0][2]) : null;
    if (qp && !cur.qualifiers.includes(qp)) cur.qualifiers.push(qp);
    out.set(company[1], cur);
  }
  return Array.from(out, ([key, v]) => ({ key, ...v }));
}

export type LaDetail = {
  name: string | null; city: string | null; address: string | null; phone: string | null;
  licenses: { number: string | null; type: string | null; status: string | null; expires: string | null }[];
  classes: { cls: string; qualifier: string | null }[];
};

export function parseLaDetail(html: string): LaDetail {
  const field = (block: string, label: string) =>
    text(block.match(new RegExp(`<div class="display-label">${label}</div>\\s*<div class="display-field">([\\s\\S]*?)</div>`))?.[1]);
  const info = html.split(/<legend>Licenses<\/legend>/)[0];
  const mail = info.match(/<div class="display-label">Mailing Address<\/div>\s*<div class="display-field">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const lines = mail.split(/<br\s*\/?>/i).map((l) => text(l)).filter((l): l is string => !!l);
  const cs = lines[lines.length - 1]?.match(/^(.*?),\s*([A-Z]{2})\b/);
  const licenses = html.split(/(?=<div class="display-label">License<\/div>)/).slice(1).map((b) => ({
    number: field(b, "License"), type: field(b, "Type"), status: field(b, "Status"), expires: usDate(field(b, "Expiration Date")),
  }));
  const classTable = html.match(/<table id="ClassificationListing"[\s\S]*?<\/table>/)?.[0] ?? "";
  const classes = tableRows(classTable).filter((r) => r.length >= 2 && r[0]).map((r) => ({ cls: r[0]!, qualifier: r[1] }));
  return { name: field(info, "Name"), city: cs ? `${cs[1].trim()}, ${cs[2]}` : null, address: lines.join(", ") || null, phone: field(info, "Phone Number"), licenses, classes };
}

/** "Paul H. Flower" or "LeGardeur, Armand": every word of the searched name is a word of the qualifier. */
const names = (want: string[], who: string | null) => { const have = new Set(tokens(who ?? "")); return want.every((w) => have.has(w)); };

/** Post one _DetailedSearch form and read each match's detail page. */
async function lslbcQuery(body: URLSearchParams, referer: string, matchedOn: LicenseHit["matchedOn"], name: string | null, keep: (r: { name: string | null; qualifiers: string[] }) => boolean): Promise<LicenseHit[]> {
  const res = await politeFetch(`${ARLS}/Public/_DetailedSearch/`, {
    method: "POST", body: body.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer }, // no X-Requested-With: the bot doesn't pose as the page's script (audit 2026-10-15)
  }, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`LSLBC search returned HTTP ${res.status}`);
  const html = await res.text();
  if (/No results found for search criteria/i.test(html)) return [];
  if (!/Search Results|Roster Entries Found/i.test(html)) throw new Error("LSLBC returned an unexpected page");
  const want = tokens(name ?? "");
  const hits: LicenseHit[] = [];
  const rows = parseLaResults(html).filter(keep);
  for (const row of rows.slice(0, MAX_DETAILS)) {
    const url = `${ARLS}/Public/_DisplayOnlineDetails/?key=${row.key}&Source=DetailedSearch`;
    const d = await politeFetch(url, { headers: { referer } }, { minDelayMs: 1100 });
    if (!d.ok) throw new Error(`LSLBC detail returned HTTP ${d.status}`);
    const det = parseLaDetail(await d.text());
    const quals = Array.from(new Set(det.classes.map((c) => c.qualifier).filter((v): v is string => !!v)));
    const principal = (matchedOn === "principal" ? quals.filter((v) => names(want, v)) : quals).join(" / ") || null;
    const specialty = Array.from(new Set(det.classes.map((c) => c.cls))).join(", ") || null;
    const people = quals.map((q) => ({ name: q, role: `Qualifying party (${det.classes.filter((c) => c.qualifier === q).map((c) => c.cls).join(", ")})` }));
    for (const l of det.licenses.length ? det.licenses : [{ number: null, type: null, status: null, expires: null }]) {
      hits.push({
        state: "LA", source: "Louisiana State Licensing Board for Contractors", sourceUrl: SEARCH_PAGE,
        businessName: det.name ?? row.name, licenseNumber: l.number, licenseType: l.type, specialty, status: l.status,
        principal, city: det.city, expires: l.expires, matchedOn, address: det.address, phone: det.phone, people,
        // A contractor license (its classes held through qualifying parties) is the business's (round 2, decision 2):
        // the LSLBC's register licenses the contracting business, with its qualifying parties listed apart
        // (publisher's definition; kept in round 3, decision 3).
        holder: "business",
      });
    }
  }
  return withNote(hits, rows.length > MAX_DETAILS ? capNote(MAX_DETAILS, rows.length, "contractors") : null);
}

export async function searchLslbc(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const q = name.replace(/[^A-Za-z0-9&' .,+-]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < 2) return [];
  const want = tokens(name);
  if (kind === "company") {
    return lslbcQuery(new URLSearchParams({ CompanyName: q.slice(0, 100), FirstName: "", LastName: "", SearchType: "ByName" }), SEARCH_PAGE, "business", name, (r) => names(want, r.name));
  }
  const parts = q.split(" ");
  if (parts.length < 2) return [];
  // Only companies whose listed qualifier is this person get a detail fetch (the search matches on the last name).
  return lslbcQuery(new URLSearchParams({ QualifierLastName: parts[parts.length - 1].slice(0, 50), QualifierFirstName: parts[0].slice(0, 50), SearchType: "ByQP" }), QP_PAGE, "principal", name,
    (r) => !r.qualifiers.length || r.qualifiers.some((qp) => names(want, qp)));
}

/** By license number (the board's ByNumber search takes the digits; "CL.00424", "00424" and "424" are one account). */
export async function searchLslbcBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null; // the board searches by name, qualifier or number only
  const digits = q.value.match(/\d+/g)?.join("");
  if (!digits || digits.length > 12) return null;
  const want = normLicense(q.value);
  const hits = await lslbcQuery(new URLSearchParams({ AccountNumber: String(Number(digits)), SearchType: "ByNumber" }), `${ARLS}/Public/DetailedSearch/ByNumber`, "license", null, () => true);
  const digitsOnly = /^\d+$/.test(q.value.trim());
  return withNote(hits.filter((h) => normLicense(h.licenseNumber) === want || (digitsOnly && Number(h.licenseNumber?.match(/\d+/g)?.join("") ?? NaN) === Number(digits))), noteOf(hits));
}

// ── Contractor violations (bulk) ──────────────────────────────────────────────────────────────────────────────
const LA_ADVERSE = /guilty|fine|revok|suspen|penalt|costs assessed|cease/i;
const LA_NOT_ADVERSE = /not guilty|dismiss|no violation|found not/i;

/** The board's violations table: contractor, location, hearing date, job number, allegation, action taken. */
export function parseLaViolations(html: string): EnforcementHit[] {
  const table = html.match(/<table id="tablepress-1"[\s\S]*?<\/table>/)?.[0] ?? "";
  const out: EnforcementHit[] = [];
  for (const r of tableRows(table)) {
    if (r.length < 6 || !r[0]) continue;
    const action = r[5];
    out.push({
      state: "LA", source: "Louisiana State Licensing Board for Contractors violations", sourceUrl: VIOLATIONS_PAGE,
      category: "discipline", name: r[0], id: r[3], date: usDate(r[2]), endDate: null,
      status: action ? `Board hearing: ${action}` : "Board hearing", city: r[1],
      detail: [r[4] ? `Allegation: ${r[4]}` : null, action ? `Action taken: ${action}` : null].filter(Boolean).join(". ").slice(0, 900) || null,
      amount: firstAmount(action),
      adverse: adverseFrom(action, { adverse: LA_ADVERSE, notAdverse: LA_NOT_ADVERSE }),
    });
  }
  return out;
}

async function* laViolations(): AsyncIterable<BulkHit> {
  const path = await download(VIOLATIONS_PAGE);
  try {
    for (const h of parseLaViolations(await fs.readFile(path, "utf8"))) yield { kind: "enforcement", hit: h, business: h.name, person: null };
  } finally {
    await fs.rm(path, { force: true });
  }
}

const BULK: BulkSource[] = [
  {
    id: "la-lslbc-violations", state: "LA", label: "Louisiana State Licensing Board for Contractors violations",
    pageUrl: VIOLATIONS_PAGE, everyHours: 24 * 7, minRows: 2800, companiesOnly: true, category: "discipline", load: laViolations,
  },
];

export const pack: StatePack = {
  state: "LA",
  checked: "2026-10-15",
  liveLicenses: [{ source: "Louisiana State Licensing Board for Contractors", sourceUrl: SEARCH_PAGE, search: searchLslbc, searchBy: searchLslbcBy }],
  bulk: BULK,
  blocked: [
    "LSLBC roster download (arlspublic _DetailedLookupRoster): a paid download (online fee per roster)",
    "Louisiana State Plumbing Board roster (public.spbla.com): robots.txt disallows every path",
    "LSLBC Act 204 civil action reports (lslbc.gov/act-204-civil-action-report/): quarterly PDF reports only, not a name search",
  ],
};
