/**
 * Maryland. Checked live 2026-10-15. Maryland licenses no general contractor statewide. Home improvement contractors
 * (MHIC) and the electrical, plumbing and HVACR trades are licensed by Maryland Department of Labor boards, whose only
 * public search is behind a reCAPTCHA (see `blocked`). Montgomery County publishes its own licenses as open data:
 *
 * Licenses (data.montgomerycountymd.gov, Socrata):
 *   Montgomery County building contractor ("new home builder") licenses   c7hs-c9qq
 *   Montgomery County electrical business licenses                        ydri-y5u9
 *   Montgomery County limited electrical business licenses                rmjr-4zb9
 *   Montgomery County master and limited master electrician licenses      v8mn-6i2r, f637-ajic
 *   Montgomery County journeyman electrician licenses                     vajy-hwge
 *   Montgomery County fire system licenses                                yjd7-guhd
 *
 * Enforcement (companies only):
 *   md-bpw-debarments  Maryland Board of Public Works debarment lists (barred from doing business with a public body,
 *                      and with the State); only entries naming a company are kept (the lists also name individuals)
 *
 * Complaints:
 *   Montgomery County Office of Consumer Protection investigations          ey5a-vyri
 */
import type { EnforcementHit } from "@shared/research-reports";
import { politeText } from "../http";
import { hasEnded } from "../adverse";
import { looksLikeBusiness } from "./lib/business-name";
import { clean, usDate, type BulkHit } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { LicenseSource } from "../licenses";
import type { ComplaintSource } from "../records";
import type { StatePack } from "./types";

const MC = "data.montgomerycountymd.gov";
const soda = (id: string) => ({ datasetUrl: `https://${MC}/d/${id}`, url: `https://${MC}/resource/${id}.json` });

// Applicant is the licensee: a business on business licenses, a person on personal ones, and either on the
// builder and fire-system licenses (searched both ways there).
const LICENSES: LicenseSource[] = [
  { state: "MD", source: "Montgomery County building contractor licenses", ...soda("c7hs-c9qq"),
    fields: { businessName: "applicant", licenseNumber: "licenseno", licenseType: "licensetype", specialty: null, status: null, principal: "applicant", city: "city", expires: "expiredate" },
    personField: "applicant", address: "addr1", zip: "zip", phone: "telephone",
    // The county publishes no entity type, and builders are licensed under a company's or a person's own name: the
    // holder is unknown, whatever the name reads like (round 3, decision 3), so no street or phone is shown.
    holder: () => null },
  { state: "MD", source: "Montgomery County electrical business licenses", ...soda("ydri-y5u9"),
    fields: { businessName: "applicant", licenseNumber: "licenseno", licenseType: "licensetype", specialty: null, status: null, principal: null, city: "city", expires: "expiredate" },
    personField: null, address: "address1", zip: "zip", holder: () => "business" }, // a register of electrical businesses (the county's definition)
  { state: "MD", source: "Montgomery County limited electrical business licenses", ...soda("rmjr-4zb9"),
    fields: { businessName: "applicant", licenseNumber: "licenseno", licenseType: "licensetype", specialty: null, status: null, principal: null, city: "city", expires: "expiredate" },
    personField: null, address: "addr1", zip: "zip", holder: () => "business" }, // a register of limited electrical businesses (the county's definition)
  { state: "MD", source: "Montgomery County master electrician licenses", ...soda("v8mn-6i2r"),
    fields: { businessName: null, licenseNumber: "licenseno", licenseType: "licensetype", specialty: null, status: null, principal: "applicant", city: "city", expires: "expiredate" },
    personField: "applicant", address: "addr1", zip: "zip", holder: () => "individual" },
  { state: "MD", source: "Montgomery County limited master electrician licenses", ...soda("f637-ajic"),
    fields: { businessName: null, licenseNumber: "licenseno", licenseType: "licensetype", specialty: "scope_limitation", status: null, principal: "applicant", city: "city", expires: "expiredate" },
    personField: "applicant", address: "addr1", zip: "zip", holder: () => "individual" },
  { state: "MD", source: "Montgomery County journeyman electrician licenses", ...soda("vajy-hwge"),
    fields: { businessName: null, licenseNumber: "licenseno", licenseType: "licensetype", specialty: null, status: null, principal: "applicant", city: "city", expires: "expiredate" },
    personField: "applicant", address: "addr1", zip: "zip", holder: () => "individual" },
  { state: "MD", source: "Montgomery County fire system licenses", ...soda("yjd7-guhd"),
    fields: { businessName: "applicant", licenseNumber: "license_number", licenseType: "license_type", specialty: null, status: null, principal: "applicant", city: "city", expires: "expired_date" },
    personField: "applicant", address: "address1", zip: "zip_code",
    // A fire system license names its holder and then the company they work for ("Austin Moss Ace Fire Exstinguisher
    // Service Inc", live 2026-10-16): the person's own license; the employer doesn't make it a business's.
    holder: () => "individual" },
];

const COMPLAINTS: ComplaintSource[] = [
  {
    state: "MD", source: "Montgomery County Office of Consumer Protection investigations", scope: "Complaints the county's consumer protection office investigated",
    ...soda("ey5a-vyri"), nameField: "merchant_name", dateField: "complaint_received_string",
    toHit: (r) => ({
      id: clean(String(r.ocp_case ?? "")), opened: usDate(String(r.complaint_received_string ?? "")), closed: null, status: clean(String(r.case_status ?? "")),
      business: clean(String(r.merchant_name ?? "")), city: null, category: clean(String(r.complaint_industry ?? "")),
      description: null, resolution: null, savings: null,
    }),
  },
];

// ── Maryland Board of Public Works debarments ───────────────────────────────────────────────────────────────────
const BPW = "https://bpw.prod.maryland.gov/bpw-programs/procurement/debarments";

export function parseBpwDebarments(html: string): { list: string; name: string; term: string | null }[] {
  const out: { list: string; name: string; term: string | null }[] = [];
  const plain = (v: string) => clean(decodeEntities(v.replace(/<[^>]+>/g, " ")).replace(/[​‌‍﻿]/g, "").replace(/Indefi nitely/g, "Indefinitely"));
  for (const t of Array.from(html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>([\s\S]*?)(?=<h[2-4][^>]*>)/g))) {
    const heading = plain(t[1]) ?? "";
    if (!/^Barred from doing business/i.test(heading)) continue;
    for (const row of Array.from(t[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g))) {
      const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => plain(c[1]));
      const name = cells[0];
      if (!name || /^person\/company$/i.test(name) || /^none$/i.test(name)) continue;
      // "Michael Wilson, President, Classic Construction, Inc.": an officer's own entry, not the firm's.
      if (/,\s*(president|secretary|owner|treasurer|vice president|ceo)\b/i.test(name)) continue;
      // Entries that name a company only (the lists mix firms and individuals: companies only, FCRA).
      if (/\bM(r|s|rs)\.\s/.test(name)) continue; // a note naming a person ("… associated with Mr. X")
      // "Montgomery Mechanical Services and Richard Stewart": the person is left out, the firm kept. A firm name with
      // "and" in it ("Polar Bear Heating and Air Conditioning Co. Inc.") stays whole.
      const parts = name.split(/\s+and\s+/i);
      const firms = parts.every(looksLikeBusiness) ? [name] : parts.filter(looksLikeBusiness);
      for (const firm of firms) out.push({ list: heading, name: firm, term: cells[1] ?? null });
    }
  }
  return out;
}

/** One entry as a report hit: a debarment whose term has ended is not adverse. */
export function bpwHit(r: { list: string; name: string; term: string | null }, today?: string): EnforcementHit {
  const dates = Array.from((r.term ?? "").matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})/g)).map((m) => usDate(m[1]));
  const end = dates[1] ?? null;
  const over = hasEnded(end, today);
  return {
    state: "MD", source: "Maryland Board of Public Works debarments", sourceUrl: BPW, category: "debarment",
    name: r.name, id: null, date: dates[0] ?? null, endDate: end,
    status: over ? `Debarment period over (${r.term})` : r.term ? `Debarred: ${r.term}` : "Debarred", city: null,
    detail: /public body/i.test(r.list) ? "Barred from doing business with any public body in Maryland (State, units and local governments)" : "Barred from doing business with the State of Maryland",
    amount: null, adverse: !over,
  };
}

async function* bpwLoader(): AsyncIterable<BulkHit> {
  for (const r of parseBpwDebarments(await politeText(BPW, {}, { minDelayMs: 1500 }))) {
    yield { kind: "enforcement", hit: bpwHit(r), business: r.name, person: null };
  }
}

export const pack: StatePack = {
  state: "MD",
  checked: "2026-10-15",
  licenses: LICENSES,
  complaints: COMPLAINTS,
  bulk: [
    { id: "md-bpw-debarments", state: "MD", label: "Maryland Board of Public Works debarments", pageUrl: BPW, everyHours: 24 * 7, minRows: 13,
      load: bpwLoader, companiesOnly: true, category: "debarment" },
  ],
  noStatewideGcLicense: "Maryland does not license general contractors statewide; home improvement contractors and the electrical, plumbing and HVACR trades are licensed by Maryland Department of Labor boards (whose search we can't run automatically), and Montgomery County's contractor and electrical licenses are searched above",
  blocked: [
    "Maryland Department of Labor license search (MHIC home improvement, master electricians, plumbers, HVACR, engineers, architects; dllr.state.md.us OP_search): Google reCAPTCHA on every search form, no download",
    "Maryland SDAT Business Express entity search (egov.maryland.gov/BusinessExpress): Cloudflare Turnstile CAPTCHA",
    "Maryland Judiciary Case Search (casesearch.courts.state.md.us): HTTP 403 and a CAPTCHA",
    "Maryland Commissioner of Labor prevailing-wage violator list: filed with the Secretary of State, not published as a list or dataset that we found",
  ],
};
