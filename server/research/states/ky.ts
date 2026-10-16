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
 *
 *   Bulk (companies only):
 *     ky-koshrc-decisions  Kentucky Occupational Safety and Health Review Commission decisions
 *                          (koshrc.ky.gov/Pages/Decisions.aspx): the page's seven "KOSHRC DECISIONS" list views (case #,
 *                          case name, date issued, a PDF link per decision; 305 decisions, 1974 to 2024, on 2026-10-15),
 *                          each PDF read with ./lib/a3-pdf.ts, weekly. The page marks no industry, so every employer the
 *                          decisions name is kept when it is a business (customers research many trades): a business by
 *                          the respondent as captioned in the decision ("BAILEY'S MASONRY INC.", "BUTCH KAUFMAN CARPET
 *                          CLEANING") or by the list's case name, by ./lib/business-name.ts; an individual respondent
 *                          ("RICHARD LEWIS") and a public body without an entity word ("KENTON COUNTY JAIL", "University
 *                          of Louisville") are left out. The outcome is read only from the Review Commission's own order
 *                          (koshrcOutcome): a citation, item, violation or penalty it affirms, sustains or reinstates is
 *                          adverse; a citation, item or violation it vacates or dismisses (and none affirmed) is not;
 *                          anything else (the hearing officer's order affirmed without saying what it held, a remand, a
 *                          settlement, OCR too broken to read) is null. A penalty amount only when the order states one
 *                          figure. A PDF without a text layer is skipped and counted (no OCR); so is the one decision whose
 *                          link points at koshrc-edit.ky.gov (robots.txt answers HTTP 401 there: a login, not read).
 *                          Only the decisions page and /KOSHRC%20DECISIONS/*.pdf are requested.
 *     Access, checked 2026-10-15 before the first request to each host:
 *       koshrc.ky.gov/robots.txt (HTTP 200): "User-Agent: *", "Disallow: /_Layouts/", "Disallow: /SiteAssets/",
 *         "Disallow: /Lists/", "Disallow: /_catalogs/", "Disallow: /WorkflowTasks/", "Sitemap: sitemap.xml"; no
 *         Crawl-delay. /Pages/Decisions.aspx and /KOSHRC%20DECISIONS/ are allowed. One request a second or slower.
 *       koshrc-edit.ky.gov/robots.txt: HTTP 401 ("401 UNAUTHORIZED"): refused, nothing else requested there.
 *       kentucky.gov/robots.txt: 301 to www.kentucky.gov/robots.txt, HTTP 404 (a plain SharePoint "File Not Found"): no
 *         rules. Its policy pages (the decisions page footer's Policies, Security, Disclaimer links) have no clause on
 *         automated or commercial use. Disclaimer: "No endorsement is intended or made of any hypertext link, product,
 *         service, or information either by its inclusion or exclusion from this page or site. … All critical
 *         information should be independently verified." Policies: "State law restricts the use of personally
 *         identifiable information for commercial purposes" (about the personal information a visitor gives the site;
 *         we keep businesses only). Its DMCA "Notices and Procedures" point to www.tylertech.com/terms, which that
 *         host's robots.txt disallows ("Disallow: /terms/"): not read.
 *       The decisions page itself: "The following decisions have been issued by the Kentucky Occupational Safety and
 *         Health Review Commission (KOSHRC) and are presented here for informational purposes only. The official
 *         decisions are on file with the Review Commission. … the description and summary information appearing on
 *         this page are for the convenience of the reader and are not part of the decision." No terms of use.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { decodeEntities, politeFetch, rethrowIfBlocked } from "../http";
import { personMatches, tokens } from "../licenses";
import { normLicense, type IdQuery } from "../identifiers";
import { clean, usDate, type BulkHit, type BulkSource } from "../bulk";
import { pdfText } from "./lib/a3-pdf";
import { looksLikeBusiness } from "./lib/business-name";
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

// ── KOSHRC decisions (bulk, companies only) ────────────────────────────────────────────────────────────────────────
const KOSHRC_PAGE = "https://koshrc.ky.gov/Pages/Decisions.aspx";
const KOSHRC_SOURCE = "Kentucky Occupational Safety and Health Review Commission decisions";
/** The only place decisions are read from: the list's own links on this host (one points at koshrc-edit.ky.gov: a login). */
const KOSHRC_DOCS = "https://koshrc.ky.gov/KOSHRC%20DECISIONS/";

export type KoshrcRow = { caseNo: string; url: string; title: string; date: string | null };

/** The rows of the page's "KOSHRC DECISIONS" list views: Case #, Case Name (linked to the decision PDF), Date Issued. */
export function parseKoshrcList(html: string): KoshrcRow[] {
  const all: KoshrcRow[] = [];
  const re = /<tr[^>]*>\s*<td class="ms-vb2">([^<]*)<\/td>\s*<td class="ms-vb2"><a href="([^"]+)"[^>]*>([^<]*)<\/a><\/td>\s*<td class="ms-vb2">(?:<nobr>)?([^<]*)(?:<\/nobr>)?<\/td>\s*<\/tr>/g;
  for (const m of Array.from(html.matchAll(re))) {
    const caseNo = clean(decodeEntities(m[1])), title = clean(decodeEntities(m[3]));
    if (!caseNo || !title) continue;
    all.push({ caseNo, url: new URL(decodeEntities(m[2]), KOSHRC_PAGE).toString(), title, date: usDate(clean(m[4])) });
  }
  // Two cases' links go to another case's PDF (on 2026-10-15: #0851 and #0854 both to "854 American Saw and Tool.pdf",
  // #1123 and #1168 to "1168 Bristol Steel and Iron Works.pdf"). A PDF shared by several rows belongs to the row whose
  // case number its file name starts with; the others are left out (their own decision isn't linked). No such row:
  // all are left out.
  const byUrl = new Map<string, KoshrcRow[]>();
  for (const r of all) byUrl.set(r.url, [...(byUrl.get(r.url) ?? []), r]);
  const fileNo = (u: string) => decodeURIComponent(u.split("/").pop() ?? "").match(/^(\d+)/)?.[1];
  const caseNum = (c: string) => c.match(/^(\d+)/)?.[1];
  return all.filter((r) => {
    const rows = byUrl.get(r.url)!;
    if (rows.length === 1) return true;
    const n = fileNo(r.url);
    return !!n && Number(caseNum(r.caseNo)) === Number(n) && rows.filter((o) => Number(caseNum(o.caseNo)) === Number(n)).length === 1;
  });
}

/**
 * The respondent as the decision's caption prints it: the lines after "v." / "vs." down to the one ending in
 * "RESPONDENT" (header words such as "DECISION AND ORDER OF" that share those lines are left out). Null when the
 * caption can't be found (OCR, layout).
 */
export function koshrcCaption(text: string): string | null {
  const lines = text.replace(/\f/g, "\n").split(/\r?\n/).slice(0, 120);
  const r = lines.findIndex((l) => /\bRESPONDENTS?\s*$/.test(l));
  if (r < 0) return null;
  let v = -1;
  for (let i = r; i >= Math.max(0, r - 8); i--) if (/^\s*v(?:s)?\.?(?:\s|$)/i.test(lines[i])) { v = i; break; }
  if (v < 0) return null;
  const parts = lines.slice(v, r + 1).map((l, i) => (i === 0 ? l.replace(/^\s*vs?\.?/i, "") : l)
    .replace(/\bRESPONDENTS?\s*$/, "")
    .replace(/\bDECISION\s*(?:AND|&)\s*ORDER(?:\s+OF)?\b|\b(?:OF\s+)?(?:THIS\s+|THE\s+)?REVIEW\s+COMMISSION\b/g, " ")
    .replace(/^[\s*"'.,:;-]+$/, "").trim()).filter(Boolean);
  // What a header line left before the name ("DECISION AND ORDER OF THE" over the caption): "OF THE", "OF THIS", "OF".
  return clean(parts.join(" ").replace(/[’‘]/g, "'").replace(/^OF(?:\s+(?:THE|THIS))?\s+/, ""));
}

/** A public employer (a county jail, a city, a university, a state department) with no entity word: not a business. */
const PUBLIC = /\b(?:county|city of|commonwealth|university|department|dept|jail|corrections|board of|board|schools?|district|authority|government|fiscal court|cabinet|metro|state of|town of|police|sheriff|hospital)\b/i;
const ENTITY = /\b(?:inc|incorporated|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|l\.?p|cooperative)\b\.?/i;
/** A plain personal name: two to four name words or initials, no business word (as ./lib/business-name.ts reads it). */
const personLike = (v: string) => !looksLikeBusiness(v) && /^(?:[A-Z][A-Za-z'’.-]*\.?\s+){1,3}[A-Z][A-Za-z'’.-]*\.?$/i.test(v.trim());

/**
 * Is the respondent a business? From the decision's caption and the list's case name only, as printed: a business
 * name by ./lib/business-name.ts (an entity word, a trade word, "d/b/a", …) in either, unless it is a public body
 * without an entity word, or the caption names a person while only the case name reads as a business.
 */
export function koshrcIsBusiness(title: string, caption: string | null): boolean {
  const names = [title, caption].filter((v): v is string => !!v);
  if (names.some((n) => PUBLIC.test(n) && !ENTITY.test(n))) return false;
  if (caption && looksLikeBusiness(caption)) return true;
  if (caption && personLike(caption)) return false;
  return looksLikeBusiness(title);
}

export type KoshrcOutcome = { status: string | null; adverse: boolean | null; amount: number | null; order: string | null };

const AFF = /\b(?:affirm(?:s|ed)?|sustain(?:s|ed)?|uphold(?:s)?|upheld|reinstat(?:e|es|ed))\b/gi;
const VAC = /\b(?:vacat(?:e|es|ed)|dismiss(?:es|ed)?)\b/gi;
const REV = /\brevers(?:e|es|ed)\b/gi;
/** Words of the Commission's own order (not a quoted precedent or the hearing officer's findings). */
const CUE = /\b(?:we|this (?:review )?commission|hereby|it is (?:hereby |further )?ordered|is the order|order of (?:this|the) commission)\b/i;
/** A clause that doesn't decide anything plainly: a negation, a condition, a modal, a precedent. */
const UNCLEAR = /\b(?:not|never|decline[sd]?|refuse[sd]?|cannot|unless|would|could|should|might|may|must|held|holds|holding|supra)\b|\sv\.\s|\bKOSHRC (?:No\.? ?)?\d{3,4}-\d\d\b/i;
const OBJECT = /\bcitations?\b|\bitems?\b|\bviolations?\b|\bpenalt(?:y|ies)\b/i;
const FINDING = /\bcitations?\b|\bitems?\b|\bviolations?\b/i;
const HO = /\bhearing officer|\brecommended (?:order|decision)|\bdecision\b|\bfindings\b/i;
/** Where the Commission's decision ends: its "so ordered", or the certificate of service that follows it. */
const END = /\bso\s+ordered\b|(?:has|have)\s+been\s+(?:served|seived|mailed)|certificate of service|cop(?:y|ies) of (?:the|this) foregoing|\bi hereby certify\b|\bthis is to certify\b/i;
const DOLLARS = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g;
const MANY = /\b(?:two|three|four|five|six|both|each|respectively)\b/i;

/**
 * The Review Commission's outcome, from its own order only: the file's first section (a decision PDF opens with the
 * Commission's decision; a hearing officer's recommended order, when attached, follows its certificate of service),
 * the last 2,000 characters before its "so ordered" or certificate of service. Each affirm/sustain/vacate/dismiss
 * verb is read with the clause around it (up to the next such verb); after "reverse" only what follows counts ("we
 * reverse our hearing officer and dismiss citation 1"). A citation, item, violation or penalty affirmed, sustained or
 * reinstated → adverse (also when other items are dismissed: "affirmed in part"); a citation, item or violation
 * vacated or dismissed and nothing affirmed → not adverse; anything else → null. The amount only when the order's
 * text holds one dollar figure, in an affirmed clause that names a single penalty.
 */
export function koshrcOutcome(text: string): KoshrcOutcome {
  const flat = text.replace(/\s+/g, " ").replace(/(\w)- ([a-z])/g, "$1$2");
  const end = END.exec(flat);
  // No "so ordered" and no certificate of service: the file is the order alone (a one-page decision).
  const section = end ? flat.slice(0, end.index + (/so\s+ordered/i.test(end[0]) ? end[0].length : 0)) : flat;
  let window = section.slice(-2000);
  if (section.length > 2000) window = window.replace(/^.*?[.;:]\s+/, "");
  const sentences = window.split(/(?<=[.;])\s+(?=[A-Z])|(?<=\bORDER)\s+(?=IT\b)/);
  let affirmed = false, vacated = false, penaltyVacated = false, hoAffirmed = false, settlement = false, remand = false;
  const decisive: string[] = [];
  const affirmedClauses: string[] = [];
  for (const s of sentences) {
    // A condition makes the whole sentence a "what if" ("unless … called for review, it is adopted and affirmed").
    if (!CUE.test(s) || /\b(?:unless|if)\b/i.test(s)) continue;
    if (/\bsettlement\b/i.test(s) && /\bapprov/i.test(s)) settlement = true;
    if (/\bremand/i.test(s)) remand = true;
    let from = 0;
    for (const m of Array.from(s.matchAll(REV))) from = m.index! + m[0].length;
    const verbs = [...Array.from(s.matchAll(AFF)).map((m) => ({ m, kind: "a" as const })), ...Array.from(s.matchAll(VAC)).map((m) => ({ m, kind: "v" as const }))]
      .filter((x) => x.m.index! >= from).sort((a, b) => a.m.index! - b.m.index!);
    let used = false;
    verbs.forEach((x, i) => {
      const start = i ? verbs[i - 1].m.index! + verbs[i - 1].m[0].length : from;
      const stop = i + 1 < verbs.length ? verbs[i + 1].m.index! : s.length;
      // "we affirm citation 1": the object follows the verb; "the citation … is hereby vacated": it comes before.
      const at = x.m.index!, passive = /\b(?:is|are|be|been|was|were)\s+(?:(?:hereby|likewise|also|and)\s+){0,3}$/i.test(s.slice(Math.max(start, at - 40), at));
      const clause = passive ? s.slice(start, at + x.m[0].length) : s.slice(at, stop);
      if (UNCLEAR.test(clause)) return;
      if (x.kind === "a") {
        if (OBJECT.test(clause)) { affirmed = true; used = true; affirmedClauses.push(clause); }
        else if (HO.test(clause)) { hoAffirmed = true; used = true; }
      } else {
        if (/\b(?:contest|petition|appeal|motion)\b/i.test(clause)) return;
        if (FINDING.test(clause)) { vacated = true; used = true; }
        else if (/\bpenalt(?:y|ies)\b/i.test(clause)) { penaltyVacated = true; used = true; }
      }
    });
    if (used) decisive.push(s.trim());
  }
  const status = affirmed && vacated ? "Affirmed in part, vacated or dismissed in part"
    : affirmed ? "Affirmed (citation, violation or penalty)"
    : vacated ? "Vacated or dismissed"
    : penaltyVacated ? "Penalty vacated"
    : hoAffirmed ? "Hearing officer's recommended order affirmed"
    : settlement ? "Settlement approved"
    : remand ? "Remanded"
    : null;
  const figures = Array.from(window.matchAll(DOLLARS));
  let amount: number | null = null;
  if (affirmed && figures.length === 1) {
    const inAffirmed = affirmedClauses.filter((c) => c.includes(figures[0][0]));
    if (inAffirmed.length === 1 && !MANY.test(inAffirmed[0])) amount = Number(figures[0][1].replace(/,/g, "")) + (figures[0][2] ? Number(figures[0][2]) / 100 : 0);
  }
  return {
    status: status ? `Review Commission: ${status}` : null,
    adverse: affirmed ? true : vacated ? false : null,
    amount: amount && amount > 0 ? amount : null,
    order: decisive.length ? (clean(decisive.join(" ")) ?? "").slice(0, 700) || null : null,
  };
}

/**
 * A respondent name without the individuals it also names (FCRA): an individual joined to a business ("Ross Brothers
 * Construction and Stephen K. Bentley") is left out, and for "<person> dba <business>" only the business is kept
 * ("D.W. Wilburn and Denzel Belcher dba Masonry Men" → "D.W. Wilburn and Masonry Men"). "… and Son(s)" is a firm's
 * name, not two parties. The first party is kept as listed (whether it is a business is decided by koshrcIsBusiness).
 */
export function koshrcBusinessName(name: string): string {
  // Parties and the separators between them, as printed ("…, Hayes Drilling, and D.W. Wilburn").
  const pieces = name.split(/(,?\s+and\s+(?!sons?\b))/i);
  let out = "";
  for (let i = 0; i < pieces.length; i += 2) {
    let p = pieces[i];
    const dba = p.match(/^(.*?)\s+(?:d\/?b\/?a|doing business as)\s+(.+)$/i);
    // A person doing business under a trade name is a sole proprietorship: an individual (FCRA), left out like any person
    // (the same rule as Virginia's revocations).
    if (dba && personLike(dba[1])) continue;
    // A later party that is a person, or a person acting for one ("Edith Darlene Sallee, Administratix of the Estate of …").
    else if (i > 0 && (personLike(p) || /\b(?:estate of|administrat\w*|executor|executrix|individually|personally)\b/i.test(p))) continue;
    out += (out ? pieces[i - 1] : "") + p;
  }
  // Nothing left (every party a person): no business to name; koshrcIsBusiness then drops the decision.
  return clean(out.replace(/[\s,]+$/, "")) ?? "";
}

/** One decision as a hit, or null when the respondent isn't shown to be a business. */
export function koshrcHit(listed: KoshrcRow, text: string): EnforcementHit | null {
  const row = { ...listed, title: koshrcBusinessName(listed.title) };
  const read = koshrcCaption(text);
  const caption = read ? koshrcBusinessName(read) : null;
  if (!koshrcIsBusiness(row.title, caption)) return null;
  // The list's case name when it reads as a business; else the caption (the decision's own name for the business), with
  // the case name kept when the caption's OCR doesn't hold its words ("DA VIS H. ELLIOT CO., INC." for "Davis H. Elliott").
  const words = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const captionWords = new Set(words(caption ?? ""));
  const name = looksLikeBusiness(row.title) || !caption ? row.title
    : words(row.title).every((w) => captionWords.has(w)) ? caption : `${caption} (listed as ${row.title})`;
  const o = koshrcOutcome(text);
  return {
    state: "KY", source: KOSHRC_SOURCE, sourceUrl: row.url, category: "discipline",
    name, id: row.caseNo, date: row.date, endDate: null, status: o.status, city: null,
    detail: [
      `KOSHRC decision ${row.caseNo} (Kentucky OSH citation contested before the Review Commission)`,
      caption && caption.toUpperCase() !== name.toUpperCase() ? `Respondent as captioned: ${caption.replace(/\.$/, "")}` : null,
      o.order ? `From the order (OCR text): ${o.order}` : "Outcome not read from the decision; see the document",
    ].filter(Boolean).join(". ").slice(0, 1000),
    amount: o.amount, adverse: o.adverse,
  };
}

export type KoshrcCounts = { listed: number; read: number; scanned: number; offSite: number; failed: number; notBusiness: number; kept: number };

async function* koshrcLoad(counts?: KoshrcCounts): AsyncIterable<BulkHit> {
  const res = await politeFetch(KOSHRC_PAGE, {}, { minDelayMs: 1100 });
  if (!res.ok) throw new Error(`${KOSHRC_PAGE} returned HTTP ${res.status}`);
  const rows = parseKoshrcList(await res.text());
  if (rows.length < 100) throw new Error(`the KOSHRC decisions page listed only ${rows.length} decisions (layout changed?)`);
  const c: KoshrcCounts = counts ?? { listed: 0, read: 0, scanned: 0, offSite: 0, failed: 0, notBusiness: 0, kept: 0 };
  c.listed = rows.length;
  for (const row of rows) {
    if (!row.url.startsWith(KOSHRC_DOCS)) { c.offSite++; continue; }
    let text: string;
    try {
      const pdf = await politeFetch(row.url, { headers: { accept: "application/pdf,*/*;q=0.5" } }, { minDelayMs: 1100, timeoutMs: 90_000 });
      if (!pdf.ok) { await pdf.body?.cancel().catch(() => undefined); c.failed++; continue; }
      text = (await pdfText(new Uint8Array(await pdf.arrayBuffer()))).text;
    } catch (err) {
      rethrowIfBlocked(err);
      c.failed++;
      continue;
    }
    if (text.replace(/\s+/g, "").length < 200) { c.scanned++; continue; } // an image without a text layer: no OCR
    c.read++;
    const hit = koshrcHit(row, text);
    if (!hit) { c.notBusiness++; continue; }
    c.kept++;
    yield { kind: "enforcement", hit, business: hit.name, person: null };
  }
  console.log(`[research-bulk] ky-koshrc-decisions: ${c.listed} listed, ${c.read} read, ${c.scanned} scanned PDF(s) without text skipped, ${c.offSite} linked off koshrc.ky.gov skipped, ${c.failed} failed, ${c.notBusiness} not a business, ${c.kept} kept`);
}

const BULK: BulkSource[] = [
  // 281 decisions kept on 2026-10-15 (305 listed, 303 after two shared links, 302 read, 0 scans, 1 off-site, 21 not a
  // business); the floor is about 70% of that.
  { id: "ky-koshrc-decisions", state: "KY", label: "KY Occupational Safety and Health Review Commission decisions (contested citations)", pageUrl: KOSHRC_PAGE, everyHours: 24 * 7, minRows: 197, load: () => koshrcLoad(), companiesOnly: true, category: "discipline" },
];

export const pack: StatePack = {
  state: "KY",
  checked: "2026-10-15",
  liveLicenses: [{ source: "Kentucky Department of Housing, Buildings and Construction", sourceUrl: PAGE, search: searchKyHbc, searchBy: searchKyHbcBy }],
  bulk: BULK,
  noStatewideGcLicense:
    "Kentucky does not license general contractors statewide; the Department of Housing, Buildings and Construction licenses electrical, plumbing, HVAC, fire-protection and other trades, which are searched above",
};
