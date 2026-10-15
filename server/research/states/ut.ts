/**
 * Utah. Checked live 2026-10-15.
 *
 *   UT DOPL Construction Business Registry: DOPL's free contractor directory (services.commerce.utah.gov/cbr), the
 *     advanced search over every profession it covers (contractors, electricians, plumbers, elevator mechanics,
 *     burglar alarm, handyman), by name or license number, with each hit's license number, license type, expiration
 *     date, phone and qualifier from its details (the address there is self-provided, usually "City ST ZIP"). It lists only ACTIVE licensees who opted in, so a miss here is not "unlicensed"; the label says so.
 *   UT DOPL agency and disciplinary actions: DOPL's public "Agency & Disciplinary Actions" search
 *     (services.commerce.utah.gov/dopl-disciplinary-actions): each case with its order documents and their dates,
 *     and each citation with its violation, issue date, status and amount. Companies only.
 *
 * Both are plain PHP forms with no CAPTCHA (the reCAPTCHA script on commerce.utah.gov belongs to the site's contact
 * form, not to these searches). DOPL's own license verification (secure.utah.gov/llv) needs a reCAPTCHA: blocked.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { tokens } from "../licenses";
import { clean } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { FormSession, cellText } from "./lib/g7-aspnet";
import { adverseFrom } from "../adverse";
import { capNote, withNote } from "../notes";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";

const CBR = "https://services.commerce.utah.gov/cbr/";
const CBR_AJAX = `${CBR}assets/js/cbr-ajax.php`;
const DOPL_DA = "https://services.commerce.utah.gov/dopl-disciplinary-actions/";
const DOPL_DA_FORM = `${DOPL_DA}index.php`;
const DOPL_DA_PAGE = "https://commerce.utah.gov/dopl/agency-and-disciplinary-actions/";

const MAX_DETAILS = 10;
const hasAll = (name: string, v: string | null | undefined) => { const have = new Set(tokens(v ?? "")); const want = tokens(name); return want.length > 0 && want.every((w) => have.has(w)); };

// ── Construction Business Registry ───────────────────────────────────────────────────────────────────────────

export type CbrRow = { name: string; dba: string | null; city: string | null; phone: string | null; eid: string; pid: string };

/** Result rows: NAME (with "DBA: a | b"), PHONE, EMAIL, CITY/STATE, and the Details button's entity + profession ids. */
export function parseCbrRows(html: string): CbrRow[] {
  const out: CbrRow[] = [];
  for (const m of Array.from(html.matchAll(/<tr><td class="text-left">([\s\S]*?)<\/tr>/g))) {
    const row = m[1];
    const nameCell = row.split(/<td/)[0];
    const [name, dbaLine] = nameCell.split(/<br\s*\/?>/i).map((p) => cellText(p));
    const cells = Array.from(row.matchAll(/<td class="text-left d-none d-sm-table-cell">([\s\S]*?)(?=<td|<\/td>|$)/g)).map((c) => cellText(c[1]));
    const ids = row.match(/data-eid="(\d+)" data-pid="([^"]+)"/);
    if (!name || !ids) continue;
    out.push({ name, dba: clean(dbaLine?.replace(/^DBA:\s*/i, "").replace(/\s*\|\s*/g, " / ")) ?? null, city: cells[2] ?? null, phone: cells[0] ?? null, eid: ids[1], pid: ids[2] });
  }
  return out;
}

/** The details modal: Profession, License Type, License Number, Expiration Date, and the qualifier (contractors). */
export function parseCbrDetails(html: string): { profession: string | null; type: string | null; number: string | null; expires: string | null; qualifier: string | null; qualifierType: string | null; phone: string | null; address: string | null } {
  const val = (label: string, from = html) => clean(cellText(from.match(new RegExp(`${label}:\\s*<i>([^<]*)</i>`))?.[1] ?? "") ?? null);
  const q = html.split(/Qualifier Information/i)[1] ?? "";
  const us = val("Expiration Date")?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return {
    profession: val("Profession"), type: val("License Type", html.split(/Qualifier Information/i)[0]), number: val("License Number"),
    expires: us ? `${us[3]}-${us[1]}-${us[2]}` : null,
    qualifier: q ? clean(cellText(q.match(/Name:\s*(?:<[^>]+>\s*)*([^<]+)/)?.[1] ?? "")) : null,
    qualifierType: q ? clean(cellText(q.match(/License Type:\s*(?:<[^>]+>\s*)*([^<]+)/)?.[1] ?? "")) : null,
    phone: clean(cellText(html.match(/Phone:\s*<i>([\s\S]*?)<\/i>/)?.[1] ?? "")),
    address: clean(cellText(html.match(/Address:\s*<i>([^<]*)<\/i>/)?.[1] ?? "")),
  };
}

const INDIVIDUAL_PROFESSIONS = /^(Electrician|Plumber|Elevator Mechanic)$/i;

function cbrHit(name: string, dba: string | null, city: string | null, d: ReturnType<typeof parseCbrDetails>, kind: "person" | "company" | "license", phone: string | null = null): LicenseHit {
  const individual = INDIVIDUAL_PROFESSIONS.test(d.profession ?? "");
  // The registry's address is self-provided and is usually only "City ST ZIP"; it is kept as the address only when it has a street.
  const street = d.address && /^\d/.test(d.address) ? d.address : null;
  return {
    state: "UT", source: "Utah DOPL Construction Business Registry (active, opted-in licensees only)", sourceUrl: CBR,
    businessName: individual ? dba : [name, dba ? `dba ${dba}` : null].filter(Boolean).join(" "),
    licenseNumber: d.number, licenseType: [d.profession, d.type && d.type !== d.profession ? d.type : null].filter(Boolean).join(": ") || null,
    specialty: d.qualifierType, status: "Active (listed in the registry)", principal: individual ? name : d.qualifier,
    city: city ?? (d.address && !street ? clean(d.address.replace(/\s+\d{5}(-\d{4})?$/, "")) : null), expires: d.expires,
    matchedOn: kind === "company" ? "business" : kind === "license" ? "license" : "principal",
    phone: d.phone ?? phone, ...(street ? { address: street } : {}),
    people: individual ? [{ name, role: d.type }] : d.qualifier ? [{ name: d.qualifier, role: d.qualifierType ? `Qualifier (${d.qualifierType})` : "Qualifier" }] : [],
  };
}

async function searchCbr(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const words = name.replace(/\s+/g, " ").trim().split(" ");
  if (!words.join("").length) return [];
  // A person's name is listed in full ("Dennis Sheridan Johnson"); the registry matches the text as typed, so a person is searched by last name.
  const co = kind === "person" ? words[words.length - 1] : words.join(" ");
  const s = new FormSession(1200);
  const post = (body: Record<string, string>) => s.request(CBR_AJAX, { method: "POST", body: new URLSearchParams(body).toString(), headers: {} });
  const res = await post({ f: "as", p: "ALL", q: "ALL", co, ln: "", ct: "", st: "SEL", zp: "" });
  if (res.status !== 200) throw new Error(`Utah CBR returned HTTP ${res.status}`);
  // One match comes back as its details window instead of a list.
  if (!/tblEntities/.test(res.html) && /detailsModalLabel/.test(res.html)) {
    const one = cellText(res.html.match(/id="detailsModalLabel">([^<]*)</)?.[1] ?? "");
    const city = clean(cellText(res.html.match(/Address:\s*<i>([^<]*)<\/i>/)?.[1] ?? "")?.replace(/\s+\d{5}(-\d{4})?$/, ""));
    if (!one || !hasAll(name, one)) return [];
    return [cbrHit(one, null, city, parseCbrDetails(res.html), kind)];
  }
  if (!/tblEntities|No Results Found/.test(res.html)) throw new Error("Utah CBR returned an unexpected page");
  const rows = parseCbrRows(res.html).filter((r) => kind === "company" ? hasAll(name, `${r.name} ${r.dba ?? ""}`) : hasAll(name, r.name));
  const out: LicenseHit[] = [];
  for (const r of rows.slice(0, MAX_DETAILS)) out.push(cbrHit(r.name, r.dba, r.city, parseCbrDetails((await post({ f: "d", v: r.eid, p: r.pid })).html), kind, r.phone));
  return rows.length > MAX_DETAILS ? withNote(out, capNote(MAX_DETAILS, rows.length, "matching registrations")) : out;
}

/** The registry's advanced search also takes a license number (no phone or street search). */
async function searchCbrBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license" || !normLicense(q.value)) return null;
  const s = new FormSession(1200);
  const post = (body: Record<string, string>) => s.request(CBR_AJAX, { method: "POST", body: new URLSearchParams(body).toString(), headers: {} });
  const res = await post({ f: "as", p: "ALL", q: "ALL", co: "", ln: q.value.trim(), ct: "", st: "SEL", zp: "" });
  if (res.status !== 200) throw new Error(`Utah CBR returned HTTP ${res.status}`);
  const same = (h: LicenseHit) => normLicense(h.licenseNumber)?.startsWith(normLicense(q.value)!) ?? false;
  if (!/tblEntities/.test(res.html) && /detailsModalLabel/.test(res.html)) {
    const one = cellText(res.html.match(/id="detailsModalLabel">([^<]*)</)?.[1] ?? "");
    return one ? [cbrHit(one, null, null, parseCbrDetails(res.html), "license")].filter(same) : [];
  }
  const out: LicenseHit[] = [];
  const rows = parseCbrRows(res.html);
  for (const r of rows.slice(0, MAX_DETAILS)) out.push(cbrHit(r.name, r.dba, r.city, parseCbrDetails((await post({ f: "d", v: r.eid, p: r.pid })).html), "license", r.phone));
  return rows.length > MAX_DETAILS ? withNote(out.filter(same), capNote(MAX_DETAILS, rows.length, "registrations starting with that number")) : out.filter(same);
}

// ── Agency and disciplinary actions ──────────────────────────────────────────────────────────────────────────

const ADVERSE_DOC = /order|stipulat|revo|suspen|probation|surrender|reprimand|fine|penalt|denial|cease/i;
/**
 * A case's outcome from its document titles (DOPL's own): a dismissal, withdrawal, … among them → not adverse (tested
 * first, decision 2); else an order, stipulation, revocation, … → adverse; no documents → unknown.
 */
export const caseAdverse = (titles: string[]): boolean | null => adverseFrom(titles.join("; "), { adverse: ADVERSE_DOC });
/** A citation is DOPL's own finding unless its status says it was dismissed or withdrawn. */
export const citationAdverse = (status: string | null | undefined): boolean => adverseFrom(`Citation issued; ${status ?? ""}`, { adverse: /citation issued/i }) ?? true;
const isoOf = (v: string | null | undefined) => {
  const m = v?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : v?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
};

/** One entity's page: each license (number, type, status), its cases (documents with dates) and its citations. */
export function parseDoplEntity(html: string): EnforcementHit[] {
  const area = html.split('id="areaResults"')[1] ?? "";
  const entity = cellText(area.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
  if (!entity) return [];
  const out: EnforcementHit[] = [];
  const blocks = area.split(/<div id="lic\d+" class=/).slice(1);
  for (const b of blocks) {
    const head = cellText(b.split(/<div id="lic\d+Data"/)[0].replace(/^[^>]*>/, "").replace(/expand_more/g, ""));
    const lic = head?.match(/(\d[\d-]+)\s*—\s*(.*?)\s*\(([^)]*)\)\s*$/);
    const licText = lic ? `License ${lic[1]} (${lic[2].trim()}, ${lic[3]})` : head ? `License ${head}` : null;
    const licenseNumber = lic?.[1] ?? null;
    for (const c of Array.from(b.matchAll(/<b>(Case [^<]+)<\/b><\/div><div id="lic\d+act\d+Data"[^>]*>([\s\S]*?)<\/ul>/g))) {
      const docs = Array.from(c[2].matchAll(/<a href="([^"]+)"[^>]*>(?:<img[^>]*>)?\s*([^<]+)<\/a>\s*(?:&#8212;|—)\s*([\d/]+)/g))
        .map((d) => ({ url: new URL(d[1], DOPL_DA).toString(), title: clean(d[2]) ?? "Document", date: isoOf(d[3]) }));
      const dates = docs.map((d) => d.date).filter((d): d is string => !!d).sort();
      out.push({
        state: "UT", source: "Utah DOPL agency and disciplinary actions", sourceUrl: docs[0]?.url ?? DOPL_DA_PAGE,
        category: "discipline", name: entity, id: clean(c[1]), date: dates[0] ?? null, endDate: dates.length > 1 ? dates[dates.length - 1] : null,
        status: docs.length ? docs.map((d) => `${d.title}${d.date ? ` (${d.date})` : ""}`).join("; ") : "Case listed",
        city: null, detail: licText, amount: null, adverse: caseAdverse(docs.map((d) => d.title)), licenseNumber,
      });
    }
    for (const c of Array.from(b.matchAll(/<b>(Citation [^<]+)<\/b><\/div><div id="lic\d+cit\d+Data"[^>]*>([\s\S]*?)<\/ul>/g))) {
      const items = Object.fromEntries(Array.from(c[2].matchAll(/<li>([^:<]+):\s*([^<]*)/g)).map((i) => [i[1].trim().toLowerCase(), clean(i[2])]));
      const amount = items.amount?.match(/\$?([\d,]+(?:\.\d{2})?)/)?.[1];
      out.push({
        state: "UT", source: "Utah DOPL agency and disciplinary actions", sourceUrl: DOPL_DA_PAGE,
        category: "discipline", name: entity, id: clean(c[1]), date: isoOf(items.issued), endDate: null,
        status: items.status ? `Citation: ${items.status}` : "Citation issued", city: null,
        detail: [items.violation ? `Violation: ${items.violation}` : null, licText].filter(Boolean).join(". ") || null,
        amount: amount ? Number(amount.replace(/,/g, "")) : null, adverse: citationAdverse(items.status), licenseNumber,
      });
    }
  }
  return out;
}

/** The list shown when several entities fit: each row's name and its View id. */
export function parseDoplList(html: string): { name: string; id: string }[] {
  return Array.from(html.matchAll(/name="v" value="(\d+)"[\s\S]*?<td class="text-left"><b>([\s\S]*?)<\/b>/g)).map((m) => ({ id: m[1], name: cellText(m[2]) ?? "" })).filter((r) => r.name);
}

async function searchDoplActions(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/\s+/g, " ").trim();
  if (q.length < 3) return [];
  const s = new FormSession(1200);
  const res = await s.request(DOPL_DA_FORM, { method: "POST", body: new URLSearchParams({ f: "S", SearchText: q.slice(0, 80), autoLoad: "0" }).toString() });
  if (res.status !== 200) throw new Error(`Utah DOPL returned HTTP ${res.status}`);
  if (!res.html.includes('id="areaResults"')) throw new Error("Utah DOPL returned an unexpected page");
  if (/id="tblEntities"/.test(res.html)) {
    const out: EnforcementHit[] = [];
    const list = parseDoplList(res.html).filter((r) => hasAll(name, r.name));
    for (const r of list.slice(0, MAX_DETAILS)) {
      const page = await s.request(DOPL_DA_FORM, { method: "POST", body: new URLSearchParams({ f: "V", v: r.id }).toString() });
      out.push(...parseDoplEntity(page.html));
    }
    return list.length > MAX_DETAILS ? withNote(out, capNote(MAX_DETAILS, list.length, "matching licensees (their records were read)")) : out;
  }
  return parseDoplEntity(res.html);
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: "Utah DOPL Construction Business Registry (active, opted-in licensees only)", sourceUrl: CBR, search: searchCbr, searchBy: searchCbrBy },
];

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Utah DOPL agency and disciplinary actions", scope: "Disciplinary cases (with their orders) and citations, every DOPL profession", category: "discipline", search: searchDoplActions },
];

export const pack: StatePack = {
  state: "UT",
  checked: "2026-10-15",
  liveLicenses,
  liveEnforcement,
  blocked: [
    "DOPL license verification (secure.utah.gov/llv): the search form requires a Google reCAPTCHA",
    "DOPL licensee lists (secure.utah.gov/datarequest): paid subscription service",
    "Utah Division of Corporations business search (businessregistration.utah.gov): Cloudflare JS challenge on every path",
  ],
};
