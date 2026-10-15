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
 * Not usable (see `blocked`): elicense.ohio.gov (the Salesforce lookup for other boards) has a CAPTCHA; the
 * Secretary of State's site answers 403; no published OCILB discipline list or debarment list was found.
 */
import { promises as fs } from "node:fs";
import { clean, csvRecords, usDate, type BulkHit } from "../bulk";
import type { StatePack } from "./types";
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
  const who = clean(r.Name), company = clean(r.Company);
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
      // individual is the company's own (round 2, decision 2: the company's address then stays).
      holder: who ? "individual" : "business",
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
      yield counted(sfmHit({ business: employer, person: clean(r.Name), no: cred, type: clean(r["Licensee Type"]),
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

export const pack: StatePack = {
  state: "OH",
  checked: "2026-10-15",
  bulk: [
    { id: "oh-ocilb", state: "OH", label: "Ohio Construction Industry Licensing Board contractor licenses", pageUrl: OCILB_PAGE,
      everyHours: 24, minRows: 8_600, load: ocilbLoader },
    { id: "oh-sfm", state: "OH", label: SFM_SOURCE, pageUrl: SFM_PAGE, everyHours: 24 * 7, minRows: 16_000, load: sfmLoader },
  ],
  noStatewideGcLicense:
    "Ohio does not license general or residential contractors statewide; the Construction Industry Licensing Board licenses commercial electrical, HVAC, plumbing, hydronics and refrigeration contractors (searched above), and local building departments regulate residential contractors",
  blocked: [
    "elicense.ohio.gov (Salesforce license lookup for the other Commerce boards and OCILB board actions): the page carries a CAPTCHA",
    "Ohio Secretary of State business reports (ohiosos.gov): HTTP 403 with a \"Website Maintenance\" page on 2026-10-15, and again on the retry at 06:52 UTC from tower1 and vb11 (robots.txt and businesssearch.ohiosos.gov too); recheck later",
    "OCILB disciplinary actions: no published list or download found on com.ohio.gov",
    "Ohio Facilities Construction Commission debarment list (R.C. 153.02): no published list found",
  ],
};
