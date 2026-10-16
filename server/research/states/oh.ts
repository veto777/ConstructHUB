/**
 * Ohio, checked live 2026-10-15.
 *
 *   oh-ocilb  Ohio Construction Industry Licensing Board contractor licenses: electrical, HVAC, hydronics, plumbing and
 *             refrigeration (the commercial trade contractors OCILB licenses). Free roster from the OCILB eLicense
 *             center (elicense4.com.ohio.gov, "Generate Roster(s)", no fee), current licenses (Active, Active in
 *             renewal), each with the qualifying individual and the company.
 *   oh-sfm    Ohio State Fire Marshal (Bureau of Testing and Registration) free rosters (elicense7.com.ohio.gov): fire
 *             protection companies, fire protection individuals (with their certified categories), and underground
 *             storage tank installers and inspectors.
 *
 * Ohio does not license general or residential contractors statewide: OCILB's own page says it licenses commercial
 * electrical, HVAC, plumbing, hydronics and refrigeration contractors and that local building departments regulate
 * residential contractors.
 *
 *   live      Ohio Attorney General Online Public Inspection File (opif.ohioattorneygeneral.gov; robots.txt answers 404,
 *             no rules): court decisions in consumer-law cases (mostly rulings that a supplier violated the Consumer
 *             Sales Practices Act; some for the supplier), searched by supplier name within the Furnaces, Home Buildings and Home Improvements subjects. The
 *             site states no terms of use beyond a copyright line; the file exists so the public can inspect these
 *             rulings (R.C. 1345.05). Companies only.
 *
 * Not usable (see `blocked`): elicense.ohio.gov (the Salesforce lookup for other boards) has a CAPTCHA; the
 * Secretary of State's site answers 403; no published OCILB discipline list or debarment list was found.
 */
import { promises as fs } from "node:fs";
import { clean, csvRecords, usDate, type BulkHit } from "../bulk";
import { personText } from "../person-name";
import type { LiveEnforcementSearch, StatePack } from "./types";
import type { EnforcementHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { decodeEntities } from "../bulk-sources";
import { companyNamed } from "../licenses";
import { withNote } from "../notes";
import { adverseFrom } from "../adverse";
import { looksLikeBusiness, personNameForm } from "./lib/business-name";
import { rosterGroups, tylerRosters } from "./lib/g5-aspnet";

const OCILB = "https://elicense4.com.ohio.gov";
const OCILB_PAGE = `${OCILB}/Lookup/LicenseLookup.aspx`;
const SFM = "https://elicense7.com.ohio.gov";
const SFM_PAGE = `${SFM}/Lookup/LicenseLookup.aspx`;

/** OCILB license type codes, as the roster form lists them ("ELECTRICAL CONTRACTOR (EL)" …). */
const OCILB_TYPES: Record<string, string> = {
  EL: "Electrical Contractor", HV: "HVAC Contractor", HY: "Hydronics Contractor", PL: "Plumbing Contractor", RE: "Refrigeration Contractor",
};

/** "street street2, City, ST ZIP"; null without a street line. */
export const joinAddress = (a1?: string, a2?: string, city?: string, st?: string, zip?: string): string | null => {
  const street = clean([clean(a1), clean(a2)].filter(Boolean).join(" "));
  return street ? clean([street, clean(city), [clean(st), clean(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : null;
};

const titleCase = (v: string | null) => v && v.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** One OCILB roster row: FormattedCredential, Name, LastName, Type, Status, State, County, Effective Date, Expiration Date, Company, Company City, … */
export function ocilbRow(r: Record<string, string>): BulkHit | null {
  const who = personText(r.Name), company = clean(r.Company); // the person as published: a list stays a list (round 6, decision 3)
  if (!who && !company) return null;
  const type = clean(r.Type);
  const address = joinAddress(r["Company Address"], r["Company Address 2"], r["Company City"], r["Company State"], r["Company Zip"]);
  const phone = clean(r["Company Phone"]);
  return {
    kind: "license",
    hit: {
      state: "OH", source: "Ohio Construction Industry Licensing Board contractor licenses", sourceUrl: OCILB_PAGE,
      businessName: company, licenseNumber: clean(r.FormattedCredential), licenseType: (type && OCILB_TYPES[type]) ?? type,
      specialty: who ? "Qualifying individual named on the license" : null, status: titleCase(clean(r.Status)), principal: who,
      city: [clean(r["Company City"]), clean(r["Company State"]) !== "OH" ? clean(r["Company State"]) : null].filter(Boolean).join(", ") || null,
      expires: usDate(r["Expiration Date"]), matchedOn: company ? "business" : "principal",
      // OCILB licenses the qualifying individual (Name, LastName); the company is the one they qualify. A row with no
      // individual says nothing more about who holds it: unknown (round 3, decision 3: a company name alone never
      // makes the holder a business), so the company address stays out.
      holder: who ? "individual" : null,
      address, phone, ...(who ? { people: [{ name: who, role: "Qualifying individual" }] } : {}),
    },
    business: company, person: who,
    keys: { licenses: [r.FormattedCredential], phones: [phone], addresses: [address] },
  };
}

async function* ocilbLoader(): AsyncIterable<BulkHit> {
  const files = await tylerRosters(OCILB, (page) => {
    const group = rosterGroups(page).find((g) => /OC[IL]{2}B/i.test(g.label));
    const select = page.match(/name="([^"]*lbMultipleCredentialTypePrefix)"[\s\S]*?<\/select>/);
    if (!group || !select) return { boxes: [] };
    const types = Array.from(select[0].matchAll(/<option value="(\d+)">[^<]*\((EL|HV|HY|PL|RE)\)/g)).map((m) => m[1]);
    if (types.length !== 5) throw new Error(`OCILB roster form lists ${types.length} of the 5 contractor types`);
    const prefix = select[1].replace(/lbMultipleCredentialTypePrefix$/, "");
    return { boxes: [group.index], extra: [...types.map((t): [string, string] => [select[1], t]), [`${prefix}ddStates`, ""], [`${prefix}ddCounty`, ""]] };
  });
  for (const f of files) {
    // Each roster file is a component: the 70% rule applies to it on its own (round 2, decision 10).
    try { for await (const r of csvRecords(f.path)) { const h = ocilbRow(r); if (h) yield { ...h, component: f.name }; } }
    finally { await fs.rm(f.path, { force: true }); }
  }
}

// ── State Fire Marshal rosters ───────────────────────────────────────────────────────────────────────────────
const SFM_GROUPS = [/Fire Protection Companies/i, /Fire Protection Individual/i, /UST Installer/i];
const SFM_SOURCE = "Ohio State Fire Marshal fire protection and UST licenses";

type SfmHit = { business: string | null; person: string | null; no: string | null; type: string | null; specialty: string | null; status: string | null; city: string | null; expires: string | null; address?: string | null; phone?: string | null; holder: "business" | "individual"; component: string };
const sfmHit = (h: SfmHit): BulkHit => ({
  kind: "license", component: h.component,
  hit: {
    state: "OH", source: SFM_SOURCE, sourceUrl: SFM_PAGE, businessName: h.business, licenseNumber: h.no, licenseType: h.type,
    specialty: h.specialty, status: h.status, principal: h.person, city: h.city, expires: h.expires, matchedOn: h.business ? "business" : "principal",
    // The companies roster lists businesses; the individuals and UST rosters list people (an employer named on
    // their row doesn't make the license the employer's).
    holder: h.holder,
    address: h.address ?? null, phone: h.phone ?? null, ...(h.person ? { people: [{ name: h.person, role: h.type }] } : {}),
  },
  business: h.business, person: h.person,
  keys: { licenses: [h.no], phones: [h.phone], addresses: [h.address] },
});

/** The three SFM rosters: companies (one row each), individuals and UST people (one row per category or CE course: merged). */
export async function* sfmRows(files: { name: string; rows: AsyncIterable<Record<string, string>> }[]): AsyncIterable<BulkHit> {
  for (const f of files) {
    // The floor covers the three rosters together; an empty roster means that download failed, so the load stops.
    let n = 0;
    const counted = (h: BulkHit) => { n++; return h; };
    if (/Companies/i.test(f.name)) {
      for await (const r of f.rows) {
        const name = clean(r.Name);
        if (!name) continue;
        yield counted(sfmHit({ business: name, person: null, no: clean(r.Credential), type: clean(r["Licensee Type"]), specialty: null,
          status: clean(r["License Status"]), city: clean(r.City), expires: usDate(r["Expiration Date"]),
          address: joinAddress(r["Address 1"], r["Address 2"], r.City, r.State, r["Zip Code"]), phone: clean(r.Phone), holder: "business", component: f.name }));
      }
      if (!n) throw new Error(`${f.name}: the roster came back empty`);
      continue;
    }
    // Individuals: one row per certified category (fire protection) or per CE course (UST); one hit per credential.
    const byCred = new Map<string, { r: Record<string, string>; cats: Set<string>; employer: string | null }>();
    for await (const r of f.rows) {
      const cred = clean(r.Credential);
      if (!cred || !clean(r.Name)) continue;
      const e = byCred.get(cred) ?? { r, cats: new Set<string>(), employer: null };
      if (clean(r.Category) && !/inactive|expired/i.test(r["Category Status"] ?? "")) e.cats.add(clean(r.Category)!);
      if (/Individual to Company/i.test(r["Supervision Type"] ?? "") && clean(r["Supervisor Name"])) e.employer = clean(r["Supervisor Name"]);
      byCred.set(cred, e);
    }
    for (const [cred, { r, cats, employer }] of byCred) {
      // A person with no employer on record: their phone may be their own (decision 4: no phone for an individual alone).
      yield counted(sfmHit({ business: employer, person: personText(r.Name), no: cred, type: clean(r["Licensee Type"]),
        specialty: cats.size ? Array.from(cats).join(", ") : null, status: clean(r["License Status"]) ?? clean(r.Status), city: clean(r.City),
        expires: usDate(r["Expiration Date"]), phone: employer ? clean(r["Work Phone"]) : null, holder: "individual", component: f.name }));
    }
    if (!n) throw new Error(`${f.name}: the roster came back empty`);
  }
}

async function* sfmLoader(): AsyncIterable<BulkHit> {
  const files = await tylerRosters(SFM, (page) => {
    const groups = rosterGroups(page);
    const boxes = SFM_GROUPS.map((re) => groups.find((g) => re.test(g.label))?.index);
    if (boxes.some((b) => b == null)) throw new Error("an SFM roster group is gone from the form");
    return { boxes: boxes as number[] };
  });
  try {
    yield* sfmRows(files.map((f) => ({ name: f.name, rows: csvRecords(f.path) })));
  } finally {
    for (const f of files) await fs.rm(f.path, { force: true });
  }
}

// ── Ohio Attorney General Online Public Inspection File (consumer-law court rulings) ─────────────────────────────

const OPIF = "https://opif.ohioattorneygeneral.gov";
const OPIF_SEARCH = `${OPIF}/Search/Pifs`;
const OPIF_SOURCE = "Ohio Attorney General Public Inspection File (consumer-law court rulings)";
/** The form's own Subject Matter values for construction work: Furnaces (12), Home Buildings (15), Home Improvements (17). */
const OPIF_SUBJECTS = ["12", "15", "17"];
/** Result pages (15 rows each) and case pages read per search. */
const OPIF_PAGES = 3;
const OPIF_DETAILS = 10;

export type OpifRow = { issueId: string; pif: string; caseName: string | null; supplier: string | null; caseNumber: string | null };

const cell = (v: string | undefined) => clean(decodeEntities((v ?? "").replace(/<[^>]+>/g, " ")));

/** The results table (PIF Number, Case Name, Supplier, Case Number) and the "N record(s) match" count. */
export function parseOpifResults(html: string): { rows: OpifRow[]; total: number | null } {
  const rows: OpifRow[] = [];
  for (const m of Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    const link = cells[1]?.match(/href="\/Case\/Detail\/(\d+)"[^>]*>\s*(\d+)\s*</);
    if (!link || cells.length < 5) continue;
    rows.push({ issueId: link[1], pif: link[2], caseName: cell(cells[2]), supplier: cell(cells[3]), caseNumber: cell(cells[4]) });
  }
  const total = html.match(/(\d[\d,]*)\s+record\(s\) match/)?.[1];
  return { rows, total: total ? Number(total.replace(/,/g, "")) : null };
}

/** A case page's labeled fields (<span class="form-label-display">Court:</span><div>…</div>: "Date in Pif", "Court", "County", "Subject Matter", "Issue Summary"…). */
export function parseOpifDetail(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const m of Array.from(html.matchAll(/<span class="form-label-display[^"]*">\s*([^<:]{2,40}):\s*<\/span>\s*<div[^>]*>([\s\S]*?)<\/div>/g))) out[m[1].trim()] = cell(m[2]);
  return out;
}

/** "1/24/1990" → "1990-01-24". */
const mdyDay = (v: string | null | undefined) => { const m = v?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };

/**
 * One business named as the supplier, as an enforcement record. The file's About page describes its cases as ones
 * "where the courts have ruled a specific act or practice violates" the Consumer Sales Practices Act, but it also holds
 * decisions for the supplier (PIF 10001192: "judgment for supplier ... No violation of CSPA"), so adverse comes only
 * from the court's own summary (adverseFrom), and is unknown when the case page wasn't read. The case name is not
 * shown (it names individual defendants); the supplier, court, county, subject and the court's summary are.
 */
export function opifHit(row: OpifRow, supplier: string, d: Record<string, string | null> | null): EnforcementHit {
  const summary = d?.["Issue Summary"] ?? null;
  return {
    state: "OH", source: OPIF_SOURCE, sourceUrl: `${OPIF}/Case/Detail/${row.issueId}`, category: "court_case",
    // One id per issue (the PIF number and the issue): two issues of one case never merge (round 8, finding 6).
    name: supplier, id: `${row.pif} (issue ${row.issueId})`, date: mdyDay(d?.["Date in Pif"]), endDate: null,
    status: "Consumer-law court decision in the Ohio Attorney General's Public Inspection File",
    city: d?.County ? `${d.County} County, OH` : null,
    detail: [row.caseNumber ? `Case ${row.caseNumber}` : null, d?.Court ? `court: ${d.Court}` : null, d?.["Subject Matter"] ? `subject: ${d["Subject Matter"]}` : null,
      d?.Keywords ? `issues: ${d.Keywords}` : null, summary ? `summary: ${summary}` : null].filter(Boolean).join("; ").slice(0, 1000) || null,
    amount: null, adverse: summary ? adverseFrom(summary) : null,
  };
}

/**
 * The rows to report: one per issue of a case (each issue has its own page and summary; round 8, finding 6: PIF
 * 10001171 has issues 1170 and 2328) and per business named as supplier that is the searched name.
 */
export function opifPicks(rows: OpifRow[], name: string): { row: OpifRow; supplier: string }[] {
  const picked: { row: OpifRow; supplier: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) for (const supplier of opifSuppliers(row.supplier)) {
    const k = `${row.issueId}|${supplier.toUpperCase()}`;
    if (!companyNamed(name, supplier) || seen.has(k)) continue;
    seen.add(k);
    picked.push({ row, supplier });
  }
  return picked;
}

/** The supplier cell's business names ("Jones Paving; Jones Construction"); a person's name is left out (companies only). */
export const opifSuppliers = (supplier: string | null): string[] =>
  (supplier ?? "").split(/\s*;\s*/).map((n) => n.replace(/,?\s+et al\.?$/i, "").trim()).filter((n) => n && personNameForm(n) === null && looksLikeBusiness(n));

const cookiesFrom = (res: Response, jar: Map<string, string>) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } };
const cookieHeader = (jar: Map<string, string>) => Array.from(jar, ([k, v]) => `${k}=${v}`).join("; ");

/**
 * The file's own search form: Case Name/Supplier = the business name, Subject Matter = the construction subjects. The
 * form posts with its anti-forgery token and session cookie and answers with a redirect to /Search/Results; the result
 * pages and the matching case pages are then read (OPIF_PAGES, OPIF_DETAILS; past them the note says so). The host
 * runs an F5 firewall, so every request waits its turn (2 s).
 */
export async function searchOpif(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/[^A-Za-z0-9&' .,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 2) return [];
  const jar = new Map<string, string>();
  const form = await politeFetch(OPIF_SEARCH, {}, { minDelayMs: 2000 });
  if (!form.ok) throw new Error(`OPIF search page returned HTTP ${form.status}`);
  cookiesFrom(form, jar);
  const token = (await form.text()).match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("OPIF search page changed (no form token)");
  const body = new URLSearchParams({ __RequestVerificationToken: token, PifNumber: "", CaseName: q, CourtId: "", CountyId: "", DateInPif: "", IssueSummary: "", Regulation: "", Statute: "" });
  for (const v of OPIF_SUBJECTS) body.append("SubjectMatterList", v);
  const post = await politeFetch(OPIF_SEARCH, { method: "POST", body: body.toString(), redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar), referer: OPIF_SEARCH } }, { minDelayMs: 2000 });
  cookiesFrom(post, jar);
  const where = post.headers.get("location");
  if (post.status !== 302 || !where) throw new Error(`OPIF search returned HTTP ${post.status}`);
  const rows: OpifRow[] = [];
  let total: number | null = null;
  for (let page = 0; page < OPIF_PAGES; page++) {
    const url = new URL(page ? `/Search/Results?page=${page}` : where, OPIF).toString();
    const res = await politeFetch(url, { headers: { cookie: cookieHeader(jar), referer: OPIF_SEARCH } }, { minDelayMs: 2000 });
    if (!res.ok) throw new Error(`OPIF results returned HTTP ${res.status}`);
    const html = await res.text();
    if (!/record\(s\) match/.test(html)) throw new Error("OPIF returned an unexpected page");
    const r = parseOpifResults(html);
    total ??= r.total;
    rows.push(...r.rows);
    if (!r.rows.length || rows.length >= (total ?? 0)) break;
  }
  const picked = opifPicks(rows, name);
  const out: EnforcementHit[] = [];
  const pages = new Map<string, Record<string, string | null> | null>();
  for (const [i, { row, supplier }] of picked.entries()) {
    if (i < OPIF_DETAILS && !pages.has(row.issueId)) {
      const res = await politeFetch(`${OPIF}/Case/Detail/${row.issueId}`, { headers: { cookie: cookieHeader(jar) } }, { minDelayMs: 2000 });
      pages.set(row.issueId, res.ok ? parseOpifDetail(await res.text()) : null);
    }
    out.push(opifHit(row, supplier, pages.get(row.issueId) ?? null));
  }
  return withNote(out, [
    total != null && rows.length < total ? `read the first ${rows.length} of ${total} cases matching the name` : null,
    picked.length > OPIF_DETAILS ? `court, date and summary read for the first ${OPIF_DETAILS} of ${picked.length} case issues; the others' outcomes are not known` : null,
  ].filter(Boolean).join("; ") || null);
}

const OPIF_SEARCHES: LiveEnforcementSearch[] = [
  { source: OPIF_SOURCE, scope: "Court decisions in Ohio consumer-law cases about furnaces, home building and home improvement (R.C. 1345.05)", search: searchOpif, category: "court_case" },
];

export const pack: StatePack = {
  state: "OH",
  checked: "2026-10-15",
  bulk: [
    { id: "oh-ocilb", state: "OH", label: "Ohio Construction Industry Licensing Board contractor licenses", pageUrl: OCILB_PAGE,
      everyHours: 24, minRows: 8_600, load: ocilbLoader },
    { id: "oh-sfm", state: "OH", label: SFM_SOURCE, pageUrl: SFM_PAGE, everyHours: 24 * 7, minRows: 16_000, load: sfmLoader },
  ],
  liveEnforcement: OPIF_SEARCHES,
  noStatewideGcLicense:
    "Ohio does not license general or residential contractors statewide; the Construction Industry Licensing Board licenses commercial electrical, HVAC, plumbing, hydronics and refrigeration contractors (searched above), and local building departments regulate residential contractors",
  blocked: [
    "elicense.ohio.gov (Salesforce license lookup for the other Commerce boards and OCILB board actions): the page carries a CAPTCHA",
    "Ohio Secretary of State business reports (ohiosos.gov): HTTP 403 with a \"Website Maintenance\" page on 2026-10-15, and again on the retry at 06:52 UTC from tower1 and vb11 (robots.txt and businesssearch.ohiosos.gov too); recheck later",
    "OCILB disciplinary actions: no published list or download found on com.ohio.gov",
    "Ohio Facilities Construction Commission debarment list (R.C. 153.02): no published list found",
  ],
};
