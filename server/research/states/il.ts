/**
 * Illinois, checked live 2026-10-15. (IDFPR roofing contractors are already searched from ../licenses.ts.)
 *
 *   IDFPR design professionals and home inspectors (live)   data.illinois.gov pzzh-kp68 (the IDFPR licensing file, updated
 *        daily): architects, professional and structural engineers, land surveyors, landscape architects, design firms
 *        and home inspectors (courses and education providers left out).
 *   IDPH asbestos abatement contractors, professionals and workers   data.illinois.gov kt5u-9dcu, duif-eqac, 437c-unzu.
 *   IDFPR discipline (live)   the same IDFPR file: its case_number, action, discipline_start_date and discipline_reason
 *        columns, for business licenses (roofing contractors, design firms, home-inspector entities and the other
 *        construction professions above) that IDFPR marks ever_disciplined = Y. Companies only.
 *   IDOL public-works debarments (live)   the Department of Labor's Prevailing Wage Act debarred-contractor notice.
 *
 * Illinois licenses no general contractors statewide: IDFPR's license types (pzzh-kp68, every license_type) include
 * roofing contractors but no general contractor, and plumbers are licensed by IDPH.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { nameClause, sodaRows, wholeWordMatch, type LicenseSource } from "../licenses";
import { addressKeys, addressMatches, normLicense, normPhone, type IdQuery } from "../identifiers";
import { decodeEntities } from "../bulk-sources";
import { clean, usDate } from "../bulk";
import type { StatePack } from "./types";
import { ADVERSE, NOT_ADVERSE, adverseFrom, hasEnded } from "../adverse";
import { noteOf, withNote } from "../notes";
import { looksLikeBusiness } from "./lib/business-name";
import { personText } from "../person-name";

/** The license number as typed and with its punctuation stripped, quoted for SoQL ("062-012345" and "062012345"). */
export const licenseForms = (v: string): string[] =>
  Array.from(new Set([v.trim().toUpperCase(), normLicense(v)].filter((x): x is string => !!x))).map((x) => `'${x.replace(/'/g, "''")}'`);

const soda = (domain: string, id: string) => ({ datasetUrl: `https://${domain}/d/${id}`, url: `https://${domain}/resource/${id}.json` });
const IDFPR = soda("data.illinois.gov", "pzzh-kp68");

const IDFPR_DESIGN = "license_type in ('ARCHITECT','DESIGN FIRM','PROF. ENGINEER','STRUCTURAL ENGINEER','LAND SURVEYOR BOARD','LANDSCAPE ARCHITECT','HOME INSPECTOR') AND description not like '%COURSE%' AND description not like '%PROVIDER%'";
/** The construction professions whose business licenses are searched for discipline (roofing included). */
const IDFPR_DISCIPLINE_TYPES = "license_type in ('ROOFING CONTRACTOR','ARCHITECT','DESIGN FIRM','PROF. ENGINEER','STRUCTURAL ENGINEER','LAND SURVEYOR BOARD','LANDSCAPE ARCHITECT','HOME INSPECTOR')";

const LICENSES: LicenseSource[] = [
  { state: "IL", source: "Illinois IDPH licensed asbestos workers", ...soda("data.illinois.gov", "437c-unzu"),
    fields: { businessName: null, licenseNumber: "id", licenseType: null, specialty: null, status: null, principal: null, city: "city", expires: null },
    personField: ["first_name", "last_name"],
    // An asbestos worker license is the worker's own.
    holder: () => "individual" },
];

// ── IDPH asbestos contractors and professionals (live: "NA" stands for a withheld address or phone) ──────────
const IDPH_CONTRACTORS = soda("data.illinois.gov", "kt5u-9dcu");
const IDPH_PROFESSIONALS = soda("data.illinois.gov", "duif-eqac");
const ASB_CONTRACTORS = "Illinois IDPH licensed asbestos abatement contractors";
const ASB_PROFESSIONALS = "Illinois IDPH licensed asbestos professionals (supervisors, inspectors, project designers)";
const na = (v: unknown) => { const t = str(v); return t && !/^N\/?A$/i.test(t) ? t : null; };
const joinAddr = (street: unknown, city: unknown, st: unknown, zip: unknown) => {
  const s0 = na(street);
  return s0 ? clean([s0, na(city), [na(st), na(zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : null;
};

export function asbContractorHit(r: Record<string, unknown>, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const contact = na(r.contact_person) ? personText(String(r.contact_person)) : null; // as published: a list stays a list
  return {
    state: "IL", source: ASB_CONTRACTORS, sourceUrl: IDPH_CONTRACTORS.datasetUrl, businessName: na(r.contractor_name),
    licenseNumber: na(r.contractor_id_numb), licenseType: "Asbestos abatement contractor", specialty: null, status: null, principal: contact,
    city: [na(r.city), na(r.state) !== "IL" ? na(r.state) : null].filter(Boolean).join(", ") || null,
    expires: str(r.cert_expiration_date)?.slice(0, 10) ?? null, matchedOn,
    address: joinAddr(r.address, r.city, r.state, r.zip), phone: na(r.phone), ...(contact ? { people: [{ name: contact, role: "Contact person" }] } : {}),
    // A licensed abatement contractor (the firm holds the license).
    holder: "business",
  };
}

const ASB_ROLES = ["supervisor", "inspector", "manager_position", "project_director", "project_manager", "air_sampling_professional"];
export function asbProfessionalHit(r: Record<string, unknown>, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const who = clean([na(r.first_name), na(r.last_name)].filter(Boolean).join(" "));
  const roles = ASB_ROLES.map((k) => na(r[k])).filter(Boolean).join(", ") || null;
  return {
    state: "IL", source: ASB_PROFESSIONALS, sourceUrl: IDPH_PROFESSIONALS.datasetUrl, businessName: na(r.company_name),
    licenseNumber: na(r.id), licenseType: roles ? `Asbestos professional (${roles.toLowerCase()})` : "Asbestos professional", specialty: null, status: null,
    principal: who, city: na(r.company_city), expires: null, matchedOn,
    address: joinAddr(r.company_address, r.company_city, r.company_state, r.company_zip), phone: na(r.company_phone),
    ...(who ? { people: [{ name: who, role: roles }] } : {}),
    // The professional's own license: the company is their employer, which doesn't make the contact a business's.
    holder: "individual",
  };
}

/** A small live dataset searched by name (company or person fields) or by license number, phone or address. */
function idphSearch(url: string, label: string, toHit: (r: Record<string, unknown>, m: LicenseHit["matchedOn"]) => LicenseHit, f: { company: string; person: string[]; license: string; numericLicense?: boolean; phone: string; address: string }) {
  return {
    search: async (name: string, kind: "person" | "company"): Promise<LicenseHit[]> => {
      const where = kind === "company" ? nameClause(f.company, name) : nameClause(f.person, name);
      const rows = await sodaRows(url, where, 200, label);
      // The page's cap note travels with the hits (round 2, decision 9).
      return withNote(rows.map((r) => toHit(r, kind === "company" ? "business" : "principal")).filter((h) => wholeWordMatch(name, h)), noteOf(rows));
    },
    searchBy: async (q: IdQuery): Promise<LicenseHit[] | null> => {
      let where: string | null = null;
      if (q.type === "license") {
        const n = normLicense(q.value);
        if (n && f.numericLicense) where = /^\d+$/.test(n) ? `${f.license} = ${Number(n)}` : null;
        else if (n) where = `upper(${f.license}) in (${licenseForms(q.value).join(",")})`;
      }
      if (q.type === "phone") { const n = normPhone(q.value); if (n) where = `${f.phone} like '%${n.slice(0, 3)}%${n.slice(3, 6)}%${n.slice(6)}%'`; }
      if (q.type === "address") {
        const key = addressKeys(q.value).find((k) => k.startsWith("a:") && !k.startsWith("a:POBOX"));
        if (key) { const [num, word] = key.slice(2).split(" "); where = `upper(${f.address}) like '${num} %${word.replace(/'/g, "''")}%'`; }
      }
      if (!where) return null; // not an identifier this dataset can take
      const rows = await sodaRows(url, where, 200, label);
      return withNote(rows.map((r) => toHit(r, q.type)).filter((h) =>
        q.type === "license" ? normLicense(h.licenseNumber) === normLicense(q.value)
          : q.type === "phone" ? normPhone(h.phone) === normPhone(q.value) : addressMatches(q.value, h.address)), noteOf(rows));
    },
  };
}

// ── IDFPR design professionals and home inspectors (live: dates are MM/DD/YYYY, and a license repeats once per discipline row) ──
const IDFPR_DESIGN_SOURCE = "Illinois IDFPR design professionals and home inspectors";

export function idfprLicenseHit(r: Record<string, unknown>, kind: "person" | "company"): LicenseHit {
  const isBusiness = str(r.business) === "Y";
  const person = isBusiness ? null : clean([str(r.first_name), str(r.middle), str(r.last_name), str(r.suffix)].filter(Boolean).join(" "));
  return {
    state: "IL", source: IDFPR_DESIGN_SOURCE, sourceUrl: IDFPR.datasetUrl,
    businessName: isBusiness ? [str(r.business_name), str(r.businessdba)].filter(Boolean).join(" dba ") || null : str(r.businessdba),
    licenseNumber: str(r.license_number), licenseType: str(r.description) ?? str(r.license_type), specialty: str(r.specialty_qualifier),
    status: str(r.license_status), principal: person, city: [str(r.city), str(r.state) && str(r.state) !== "IL" ? str(r.state) : null].filter(Boolean).join(", ") || null,
    expires: usDate(str(r.expiration_date)), matchedOn: kind === "company" ? "business" : "principal",
    ...(person ? { people: [{ name: person, role: str(r.description) }] } : {}),
    // IDFPR's own business flag: Y a business's license, N an individual's.
    holder: str(r.business) === "Y" ? "business" : str(r.business) === "N" ? "individual" : null,
  };
}

async function searchIdfprDesign(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const where = kind === "company"
    ? `${nameClause(["business_name", "businessdba"], name)} AND business='Y'`
    : `${nameClause(["first_name", "middle", "last_name"], name)} AND business='N'`;
  const seen = new Set<string>();
  const out: LicenseHit[] = [];
  const rows = await sodaRows(IDFPR.url, `${where} AND (${IDFPR_DESIGN})`, 500, IDFPR_DESIGN_SOURCE);
  for (const r of rows) {
    const h = idfprLicenseHit(r, kind);
    const key = `${h.licenseNumber}|${h.licenseType}`;
    if (seen.has(key) || !wholeWordMatch(name, h)) continue;
    seen.add(key);
    out.push(h);
  }
  return withNote(out, noteOf(rows));
}

async function searchIdfprDesignBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null; // the file publishes no street address or phone
  const n = normLicense(q.value);
  if (!n) return null;
  const seen = new Set<string>();
  const rows = await sodaRows(IDFPR.url, `upper(license_number) in (${licenseForms(q.value).join(",")}) AND (${IDFPR_DESIGN})`, 50, IDFPR_DESIGN_SOURCE);
  return withNote(rows.map((r) => ({ ...idfprLicenseHit(r, "company"), matchedOn: "license" as const }))
    .filter((h) => { const k = `${h.licenseNumber}|${h.licenseType}`; if (seen.has(k)) return false; seen.add(k); return true; }), noteOf(rows));
}

// ── IDFPR discipline ─────────────────────────────────────────────────────────────────────────────────────────
const str = (v: unknown) => clean(v == null ? null : String(v));

/**
 * A record the publisher itself flags as disciplined: the action's clean answer when it gives one; null when its
 * words are mixed or negated ("revoked; hearing waived", "no fine"); true when it has no outcome words at all.
 */
export function flaggedAdverse(action: string | null): boolean | null {
  const a = adverseFrom(action);
  if (a !== null || !action) return a ?? true;
  return ADVERSE.test(action) || NOT_ADVERSE.test(action) ? null : true;
}

export function idfprDisciplineHit(r: Record<string, unknown>): EnforcementHit {
  const action = str(r.action), reason = str(r.discipline_reason)?.replace(/\.+\s*$/, "") ?? null;
  const fine = action && /fine/i.test(action) ? reason?.match(/\$\s?([\d,]+(?:\.\d{2})?)/g) : null;
  // IDFPR marks some sole proprietors business = Y under their own name ("JOHN R KING"): only business names are kept (FCRA).
  const names = [str(r.business_name), str(r.businessdba)].filter((n): n is string => !!n && looksLikeBusiness(n));
  return {
    state: "IL", source: "Illinois IDFPR discipline (roofing contractors, design firms, home inspectors)", sourceUrl: IDFPR.datasetUrl,
    category: "discipline", name: names.join(" / ") || null, id: str(r.case_number), date: usDate(str(r.discipline_start_date)), endDate: null,
    status: action ?? "IDFPR marks this license as disciplined", city: str(r.city),
    detail: [reason, `${str(r.description) ?? str(r.license_type) ?? "License"} ${str(r.license_number) ?? ""}, status ${str(r.license_status) ?? "not given"}`.trim()].filter(Boolean).join(". "),
    // IDFPR marks the license disciplined (ever_disciplined = Y): adverse when the action says nothing either way; an
    // action that clears it is not; mixed or negated wording is unknown (round 2, decision 4).
    amount: fine && fine.length === 1 ? Number(fine[0].replace(/[$,\s]/g, "")) : null, adverse: flaggedAdverse(action),
    licenseNumber: str(r.license_number),
  };
}

async function searchIdfprDiscipline(name: string): Promise<EnforcementHit[]> {
  const where = `${nameClause(["business_name", "businessdba"], name)} AND business='Y' AND ever_disciplined='Y' AND ${IDFPR_DISCIPLINE_TYPES}`;
  return (await sodaRows(IDFPR.url, where, 500, "IDFPR discipline")).map(idfprDisciplineHit);
}

// ── IDOL Prevailing Wage Act debarments ──────────────────────────────────────────────────────────────────────
const IDOL_DEBAR = "https://labor.illinois.gov/laws-rules/conmed/debarred-contractors.html";

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Each "<Contractor> has been debarred from any public works project for a period of <N years> effective <date>"
 * sentence. The detail is that sentence only; the page's general statement about the Act is the source's scope, not a
 * finding about each row. The end date is the effective date plus the period when the period is in whole years.
 */
export function parseIdolDebarred(html: string, today?: string): EnforcementHit[] {
  const text = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
  const out: EnforcementHit[] = [];
  for (const m of Array.from(text.matchAll(/([A-Z0-9][^:;]{1,150}?)\s+(?:has|have) been debarred from any public works project for a period of ([^.]{1,40}?) effective ([A-Z][a-z]+ \d{1,2}, \d{4})/g))) {
    const name = clean(m[1]);
    if (!looksLikeBusiness(name)) continue; // companies only (FCRA)
    const d = new Date(`${m[3]} UTC`);
    const start = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    const yrs = m[2].trim().toLowerCase().match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten) years?$/)?.[1];
    const years = yrs ? NUMBERS[yrs] ?? Number(yrs) : null;
    const end = start && years ? `${Number(start.slice(0, 4)) + years}${start.slice(4)}` : null;
    const over = hasEnded(end, today);
    out.push({
      state: "IL", source: "Illinois Department of Labor public-works debarments (Prevailing Wage Act)", sourceUrl: IDOL_DEBAR,
      category: "debarment", name, id: null, date: start, endDate: end,
      status: over ? `Debarment period over (${end})` : `Debarred from public works for ${clean(m[2])}`, city: null,
      detail: clean(m[0]), amount: null, adverse: !over,
    });
  }
  return out;
}

async function searchIdolDebarred(): Promise<EnforcementHit[]> {
  const res = await politeFetch(IDOL_DEBAR, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`IDOL returned HTTP ${res.status}`);
  const html = await res.text();
  if (!/LIST OF CONTRACTORS PROHIBITED/i.test(html)) throw new Error("IDOL debarment page has changed");
  return parseIdolDebarred(html);
}

export const pack: StatePack = {
  state: "IL",
  checked: "2026-10-15",
  licenses: LICENSES,
  liveLicenses: [
    { source: IDFPR_DESIGN_SOURCE, sourceUrl: IDFPR.datasetUrl, search: searchIdfprDesign, searchBy: searchIdfprDesignBy },
    { source: ASB_CONTRACTORS, sourceUrl: IDPH_CONTRACTORS.datasetUrl,
      ...idphSearch(IDPH_CONTRACTORS.url, ASB_CONTRACTORS, asbContractorHit, { company: "contractor_name", person: ["contact_person"], license: "contractor_id_numb", numericLicense: true, phone: "phone", address: "address" }) },
    { source: ASB_PROFESSIONALS, sourceUrl: IDPH_PROFESSIONALS.datasetUrl,
      ...idphSearch(IDPH_PROFESSIONALS.url, ASB_PROFESSIONALS, asbProfessionalHit, { company: "company_name", person: ["first_name", "last_name"], license: "id", phone: "company_phone", address: "company_address" }) },
  ],
  liveEnforcement: [
    { source: "Illinois IDFPR discipline (roofing contractors, design firms, home inspectors)", scope: "Business licenses IDFPR marks as disciplined, with case, action and reason",
      category: "discipline", search: searchIdfprDiscipline },
    { source: "Illinois Department of Labor public-works debarments (Prevailing Wage Act)", scope: "The contractors IDOL currently lists as debarred under section 11a of the Prevailing Wage Act",
      category: "debarment", search: () => searchIdolDebarred() },
  ],
  noStatewideGcLicense:
    "Illinois does not license general contractors statewide; roofing contractors are licensed by IDFPR and plumbers by IDPH, and general contractors are licensed, where at all, by their city or county",
  blocked: [
    "IDPH plumber and plumbing-contractor lookup (plumblicv5pub.dph.illinois.gov, linked from dph.illinois.gov/envhealth/plumbing.htm): the host does not resolve in public DNS; no plumber download exists",
    "IDPH lead contractor registration (data.illinois.gov vpwp-h7xr) and lead inspectors (4dci-czfi): last updated 2025-07, expiration dates already past; left out as stale",
    "IDPH manufactured-home installers (yjck-9suj): last updated 2024-02; left out as stale",
    "City of Chicago Home Repair licenses (data.cityofchicago.org r5kz-chrr): the license ended in 2016; chicago.gov's building-department pages answer 403",
    "Illinois Workers' Compensation Commission stop-work orders: no published list found",
  ],
};
