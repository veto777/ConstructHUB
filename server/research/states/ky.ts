/**
 * Kentucky. Every source here was opened and searched live on 2026-10-15; license types, statuses and dates are the
 * department's own (CLAUDE.md: never fabricate government data).
 *
 *   Department of Housing, Buildings and Construction licensee search (dhbc.ky.gov/Search/HBC_List_Licensees.aspx),
 *     live per report: electrical (contractor business and individual, master, electrician, inspectors), plumbing
 *     (master, journeyman), HVAC (master contractor, journeyman, apprentice), fire protection (sprinkler, chemical,
 *     rangehood contractors and certificates of competency), LP gas, underground storage tanks, manufactured-home
 *     installers and building inspectors. The search matches the licensee's name and the DBA (business) name; it
 *     shows at most 50 rows, so a capped search is repeated per division and, if still capped, for active
 *     licenses only.
 */
import type { LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { personMatches, tokens } from "../licenses";
import { normLicense, type IdQuery } from "../identifiers";
import { usDate } from "../bulk";
import { aspxFields, cookiesOf, flipName, htmlPerson, isPersonName, text } from "./lib/g4-html";
import type { StatePack } from "./types";
import { withNote } from "../notes";

const PAGE = "https://dhbc.ky.gov/Search/HBC_List_Licensees.aspx";
const CAP = 50;
// The search page's own division list (drpProfTrade): electrical, plumbing, HVAC, fire prevention,
// manufactured home/RV and certified installer, building code enforcement.
const DIVISIONS = ["49", "52", "53", "55", "57", "58"];

export type KyRow = { id: string | null; name: string | null; person?: string | null; type: string | null; dba: string | null; number: string | null; status: string | null; issued: string | null; expires: string | null };

/** The rows of the licensee grid (MainContent_grdData). */
export function parseKyGrid(html: string): KyRow[] {
  const grid = html.match(/<table[^>]*id="MainContent_grdData"[\s\S]*?<\/table>/)?.[0] ?? "";
  const out: KyRow[] = [];
  for (const m of Array.from(grid.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 7) continue;
    out.push({
      id: cells[0].match(/HBC_Lic_Details\.aspx\?id=(\d+)/)?.[1] ?? null,
      // `person`: the name cell with a <br> kept as a list separator (round 6, decision 3).
      name: text(cells[0]), person: htmlPerson(cells[0]), type: text(cells[1]), dba: text(cells[2]), number: text(cells[3]), status: text(cells[4]),
      issued: usDate(text(cells[5])), expires: usDate(text(cells[6])),
    });
  }
  return out;
}

async function kySearch(name: string, division = "0", status = "", licNum = ""): Promise<KyRow[]> {
  const page = await politeFetch(PAGE, {}, { minDelayMs: 1100 });
  if (!page.ok) throw new Error(`HBC search page returned HTTP ${page.status}`);
  const form = aspxFields(await page.text());
  if (!form.has("ctl00$MainContent$txtLicName")) throw new Error("HBC search page changed (no name field)");
  form.set("ctl00$MainContent$txtLicName", name);
  form.set("ctl00$MainContent$txtLicNum", licNum);
  form.set("ctl00$MainContent$drpProfTrade", division);
  form.set("ctl00$MainContent$drpStatus", status);
  form.set("ctl00$MainContent$btnContinue", "Search");
  const cookie = cookiesOf(page);
  const res = await politeFetch(PAGE, {
    method: "POST", body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer: PAGE, ...(cookie ? { cookie } : {}) },
  }, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`HBC search returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/MainContent_txtLicName/.test(html)) throw new Error("HBC search returned an unexpected page");
  return parseKyGrid(html);
}

/**
 * Every row for the name, working around the 50-row cap by division, then by active status. A division still at the
 * cap means rows are missing (inactive ones first, or even active ones): the result carries a note saying so.
 */
export async function kyRows(name: string, search = kySearch): Promise<{ rows: KyRow[]; note: string | null }> {
  const first = await search(name);
  if (first.length < CAP) return { rows: first, note: null };
  const seen = new Map<string, KyRow>();
  const add = (rows: KyRow[]) => { for (const r of rows) seen.set(`${r.id}|${r.number}|${r.type}`, r); };
  add(first);
  const capped: string[] = [];
  for (const d of DIVISIONS) {
    const rows = await search(name, d);
    add(rows);
    if (rows.length < CAP) continue;
    const active = await search(name, d, "Active");
    add(active);
    capped.push(active.length >= CAP ? `division ${d}: even its active licenses reach the site's ${CAP}-row limit` : `division ${d}: its inactive licenses past the site's ${CAP}-row limit are not shown`);
  }
  return { rows: Array.from(seen.values()), note: capped.length ? `some matches may be missing (${capped.join("; ")})` : null };
}

/**
 * Who holds the license, from its type as the department lists it (round 2, decision 2): a contractor or business
 * license is a business's (unless the type says individual); a master, journeyman, apprentice, electrician,
 * inspector, installer or certificate of competency is the person's own; anything else isn't stated (null).
 */
export function kyHolder(type: string | null): "business" | "individual" | null {
  const t = type ?? "";
  if (/individual|master|journeyman|apprentice|electrician|inspector|installer|certificate|competency/i.test(t)) return "individual";
  if (/contractor|business/i.test(t)) return "business";
  return null;
}

const toHit = (r: KyRow, matchedOn: LicenseHit["matchedOn"]): LicenseHit => {
  const person = isPersonName(r.name) ? flipName(r.person ?? r.name) : null;
  return {
    state: "KY", source: "Kentucky Department of Housing, Buildings and Construction", sourceUrl: r.id ? `https://dhbc.ky.gov/Search/HBC_Lic_Details.aspx?id=${r.id}` : PAGE,
    businessName: r.dba ?? (person ? null : r.name), licenseNumber: r.number, licenseType: r.type, specialty: null, status: r.status,
    principal: person, city: null, expires: r.expires, matchedOn, people: person ? [{ name: person, role: "Licensee" }] : [],
    holder: kyHolder(r.type),
  };
};

/**
 * The name as the lookup takes it. For a person the search finds "Harrison Durham-Smith" but nothing for "Harrison E
 * Durham-Smith" (acceptance run, 2026-10-15): the site lists "Durham-Smith, Harrison E" and doesn't match a middle
 * initial typed between the names. So a person's query leaves out single-letter initials and a generational suffix
 * (JR, SR, II…); every result is still checked against the full name, initial included (personMatches).
 */
export function kyQuery(name: string, kind: "person" | "company"): string {
  const q = name.replace(/[^A-Za-z0-9&' .,-]/g, " ").replace(/\s+/g, " ").trim();
  if (kind === "company") return q.slice(0, 80);
  const words = q.replace(/[.,]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^(?:jr|sr|ii|iii|iv)$/i.test(w));
  return (words.length ? words.join(" ") : q).slice(0, 80);
}

export async function searchKyHbc(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const q = kyQuery(name, kind);
  if (q.length < 2) return [];
  const want = tokens(name);
  const words = (v: string | null) => { const have = new Set(tokens(v ?? "")); return want.every((w) => have.has(w)); };
  let { rows, note } = await kyRows(q);
  // A middle name the site doesn't hold ("John David Field" vs "Field, John D") finds nothing: try first and last only.
  const parts = q.split(" ");
  if (kind === "person" && !rows.length && parts.length > 2) ({ rows, note } = await kyRows(`${parts[0]} ${parts[parts.length - 1]}`));
  return withNote(rows.map((r) => toHit(r, kind === "company" ? "business" : "principal"))
    .filter((h) => (kind === "company" ? words(h.businessName) : personMatches(name, h.principal))), note);
}

/** By license number (the search's License Number field, 10 characters at most). No phone or address is published. */
export async function searchKyHbcBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null;
  const want = normLicense(q.value);
  if (!want || want.length > 10) return null;
  return (await kySearch("", "0", "", want)).filter((r) => normLicense(r.number) === want).map((r) => toHit(r, "license"));
}

export const pack: StatePack = {
  state: "KY",
  checked: "2026-10-15",
  liveLicenses: [{ source: "Kentucky Department of Housing, Buildings and Construction", sourceUrl: PAGE, search: searchKyHbc, searchBy: searchKyHbcBy }],
  noStatewideGcLicense:
    "Kentucky does not license general contractors statewide; the Department of Housing, Buildings and Construction licenses electrical, plumbing, HVAC, fire-protection and other trades, which are searched above",
};
