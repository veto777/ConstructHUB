/**
 * Wisconsin, checked live 2026-10-15.
 *
 * NO SOURCE IS REGISTERED (A13, 2026-10-15): the two files below sit under terms that limit their material to
 * "the noncommercial use of the general public" (DNR's Acceptable Use Policy; DHS pages link the Wisconsin.gov one),
 * so they are listed under `blocked`. The loaders are kept, unused.
 *
 *   wi-dnr-wells   DNR drilling and pump-installing service directories (dnr.wisconsin.gov/topic/Wells/Contacts.html,
 *                  .xlsx, "Updated <date>" on each): licensed well drillers, pump installers and heat-exchange drillers,
 *                  people and businesses, listed under every county they serve (one hit per license and directory).
 *   wi-dhs-abatement  DHS lists of certified lead companies and certified asbestos companies (.xlsx, updated monthly),
 *                  with each certification's expiration date.
 *
 * Wisconsin's main construction credentials (DSPS dwelling contractor, dwelling contractor qualifier, plumbing,
 * electrical, HVAC) are NOT searchable here: see `blocked`.
 */
import { flipPerson, personText } from "../person-name";
import { promises as fs } from "node:fs";
import { politeFetch } from "../http";
import { decodeEntities } from "../bulk-sources";
import { clean, download, type BulkHit } from "../bulk";
import type { StatePack } from "./types";
import { excelDate, xlsxRows } from "./lib/g5-aspnet";
import { looksLikeBusiness } from "./lib/business-name";

const DNR_PAGE = "https://dnr.wisconsin.gov/topic/Wells/Contacts.html";
const DNR_FILES: { file: string; type: string }[] = [
  { file: "WellDrillers.xlsx", type: "Well drilling (DNR directory)" },
  { file: "PumpInstallers.xlsx", type: "Pump installing (DNR directory)" },
  { file: "HeatDrillers.xlsx", type: "Heat exchange drilling (DNR directory)" },
];
const DHS_LEAD_PAGE = "https://www.dhs.wisconsin.gov/lead/hire-a-contractor.htm";
const DHS_ASBESTOS_PAGE = "https://www.dhs.wisconsin.gov/asbestos/contractors.htm";

/**
 * A directory name that is a person ("JOHNSON, JOSHUA L"), not a business ("QUINNELL'S SEPTIC & WELL SERVICE, INC").
 * "LAST, FIRST" is a person unless it carries a business word ("WELLS, JOHN" is a person: Wells is a surname, so only
 * the singular WELL counts); any other form is a person unless ./lib/business-name.ts reads it as a business.
 */
const BUSINESS = /\b(INC|LLC|L\.L\.C|CORP|CORPORATION|CO|COMPANY|LTD|LLP|SERVICES?|DRILLING|WELL|PUMPS?|PUMPING|ENTERPRI[SZ]ES?|PLUMBING|SEPTIC|SUPPLY|GEOTHERMAL|ELECTRIC|HEATING|SONS|BROTHERS|BROS)\b|&/i;
export const isPersonName = (n: string) => /^[A-Z][A-Z'.\- ]*,\s+[A-Z]/i.test(n) ? !BUSINESS.test(n) : !BUSINESS.test(n) && !looksLikeBusiness(n);
/** A legal entity's name: the registered form says it is a company. */
const dash = (v: string | undefined) => clean(v?.replace(/^-$/, ""));
/** Street lines (a line with no digit is a company name in the DNR files, not a street), city, state and ZIP. */
export function wiAddress(lines: (string | undefined)[], city?: string, st?: string, zip?: string): string | null {
  const street = clean(lines.map(dash).filter((l): l is string => !!l && /\d/.test(l)).join(" "));
  const z = dash(zip)?.replace(/-$/, "");
  return street ? clean([street, dash(city), [dash(st), z && z.length === 9 && /^\d+$/.test(z) ? `${z.slice(0, 5)}-${z.slice(5)}` : z].filter(Boolean).join(" ")].filter(Boolean).join(", ")) : null;
}
/** "LAST, FIRST" → "FIRST LAST" for one person; a published list stays a list (../person-name.ts). */
const flip = (n: string) => flipPerson(n);

/** Links on an agency page to a given file name (the DNR adds a ?version query that changes with each update). */
async function linkTo(page: string, file: string): Promise<string> {
  const res = await politeFetch(page, {}, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`${page} returned HTTP ${res.status}`);
  const html = await res.text();
  const href = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => decodeEntities(m[1])).find((h) => h.split("?")[0].toLowerCase().endsWith(`/${file.toLowerCase()}`));
  if (!href) throw new Error(`${file} is no longer linked from ${page}`);
  return new URL(href, page).toString();
}

/** One DNR directory: County Name | License No. | Full Name | Phone | Mobile Phone | Mailing Address | Second Mailing Adress | City | State | Zip | Email. */
export function dnrRows(rows: string[][], type: string): BulkHit[] {
  const head = rows.findIndex((r) => /License No/i.test(r[1] ?? "") && /Full Name/i.test(r[2] ?? ""));
  if (head < 0) throw new Error("DNR directory layout changed");
  const updated = rows.slice(0, head).map((r) => r[0]).find((v) => /Updated/i.test(v ?? "")) ?? null;
  const seen = new Set<string>();
  const out: BulkHit[] = [];
  for (const r of rows.slice(head + 1)) {
    const no = clean(r[1]?.replace(/^-$/, "")), raw = clean(r[2]?.replace(/^-$/, ""));
    if (!no || !raw || seen.has(no)) continue;
    seen.add(no);
    const person = isPersonName(raw);
    // The person from the cell as published, not the collapsed text: a list stays a list (round 6, decision 3).
    const cell = r[2]?.replace(/^-$/, "") ?? raw;
    const city = dash(r[7]), st = dash(r[8]);
    out.push({
      kind: "license",
      hit: {
        state: "WI", source: "Wisconsin DNR licensed well drillers and pump installers", sourceUrl: DNR_PAGE,
        businessName: person ? null : raw, licenseNumber: no, licenseType: type,
        specialty: updated ? `Listed in the DNR directory (${clean(updated)})` : "Listed in the DNR directory", status: null,
        principal: person ? flip(cell) : null, city: [city, st && st !== "WI" ? st : null].filter(Boolean).join(", ") || null, expires: null,
        matchedOn: person ? "principal" : "business",
        // The DNR files publish no entity type: a person's name is an individual's license; any other name, an entity
        // form in it (Inc, LLC) included, leaves the holder unknown (round 3, decision 3: a name never makes a holder
        // a business), and its contact details stay out of the report like an individual's.
        holder: person ? "individual" : null,
        // Without a business holder the mailing address and phones may be a home's: city only, never a key.
        address: null, phone: null,
        ...(person ? { people: [{ name: flip(cell)!, role: type.replace(/ \(DNR directory\)$/, " license holder") }] } : {}),
      },
      business: person ? null : raw, person: person ? personText(cell) : null,
      // Each phone is its own key ("608-555-0101, 608-555-0102" joined would match neither).
      keys: { licenses: [no] },
    });
  }
  return out;
}

async function* dnrLoader(): AsyncIterable<BulkHit> {
  for (const f of DNR_FILES) {
    const path = await download(await linkTo(DNR_PAGE, f.file));
    // Each directory is a component: the 70% rule applies to it on its own (round 2, decision 10).
    try { for (const h of dnrRows(await xlsxRows(path), f.type)) yield { ...h, component: f.file }; } finally { await fs.rm(path, { force: true }); }
  }
}

/** A DHS company list: Type of Company | Expiration Date (Excel serial) | Company Name | Mailing Address | City | State | Zip. */
export function dhsRows(rows: string[][], page: string, source: string): BulkHit[] {
  const head = rows.findIndex((r) => /Type of Company/i.test(r[0] ?? "") && /Company Name/i.test(r[2] ?? ""));
  if (head < 0) throw new Error("DHS company list layout changed");
  const out: BulkHit[] = [];
  for (const r of rows.slice(head + 1)) {
    const name = clean(r[2]);
    if (!name) continue;
    const st = clean(r[5]);
    const address = wiAddress([r[3]], r[4], r[5], r[6]);
    out.push({
      kind: "license",
      hit: {
        state: "WI", source, sourceUrl: page, businessName: name, licenseNumber: null, licenseType: clean(r[0]) ? `Certified ${clean(r[0])!.toLowerCase()}` : null,
        specialty: null, status: null, principal: null, city: [clean(r[4]), st && st !== "WI" ? st : null].filter(Boolean).join(", ") || null,
        expires: excelDate(r[1]), matchedOn: "business", address,
        // DHS certifies these as companies ("Type of Company"): the company holds the certification.
        holder: "business",
      },
      business: name, person: null, keys: { addresses: [address] },
    });
  }
  return out;
}

async function* dhsLoader(): AsyncIterable<BulkHit> {
  const lists = [
    { page: DHS_LEAD_PAGE, file: "certified-lead-companies.xlsx", source: "Wisconsin DHS certified lead companies" },
    { page: DHS_ASBESTOS_PAGE, file: "certified-asbestos-companies.xlsx", source: "Wisconsin DHS certified asbestos companies" },
  ];
  for (const l of lists) {
    const path = await download(await linkTo(l.page, l.file));
    try { for (const h of dhsRows(await xlsxRows(path), l.page, l.source)) yield { ...h, component: l.file }; } finally { await fs.rm(path, { force: true }); }
  }
}

export const pack: StatePack = {
  state: "WI",
  checked: "2026-10-15",
  // wi-dnr-wells and wi-dhs-abatement are not registered (A13, 2026-10-15): both sites' terms limit their material to
  // noncommercial use (see `blocked`). The loaders are kept, unused; stored rows are deleted at boot (RETIRED_BULK_SOURCES).
  bulk: [],
  blocked: [
    "Wisconsin DNR drilling and pump-installing service directories (dnr.wisconsin.gov/topic/Wells/Contacts.html, .xlsx; was wi-dnr-wells): not used, because DNR's Acceptable Use Policy (dnr.wisconsin.gov/legal/acceptableuse, read 2026-10-15) says \"The material is for the noncommercial use of the general public. The fair use guidelines of the U.S. copyright statutes apply to all material on the Department of Natural Resources webpages and linked agency webpages. ... For copy or use of information on the department website that is outside of the fair use provisions of copyright law, please seek permission from the individual listed as responsible for the page\"",
    "Wisconsin DHS certified lead and asbestos companies (www.dhs.wisconsin.gov/lead/hire-a-contractor.htm and /asbestos/contractors.htm, .xlsx; was wi-dhs-abatement): not used, because those pages' Policies link is the Wisconsin.gov Legal/Acceptable Use page (www.wisconsin.gov/Pages/Policies.aspx, read 2026-10-15), which says \"The material is for the noncommercial use of the general public. The fair use guidelines of the U.S. copyright statutes apply to all material on the Wisconsin.gov and linked agency Webpages. ... For copy or use of information on the State of Wisconsin website that is outside of the fair use provisions of copyright law, please seek permission from the individual listed as responsible for the page\"",
    "WisDOT debarred, suspended and ineligible contractors (wisconsindot.gov/hccidocs/debar.pdf) and the WI DOA debarment list: not used, because WisDOT's Acceptable Use Policy (wisconsindot.gov/Pages/global-footer/Acceptable-use-policy.aspx, read 2026-10-15) says \"This website, and the pages and material available on it, are for the noncommercial use of the general public\", and DOA's pages carry the Wisconsin.gov terms quoted above",
    "DSPS credential lookup (license.wi.gov, the LicensE platform): Cloudflare blocks our bot (\"Sorry, you have been blocked\"); dwelling contractors, qualifiers, plumbers, electricians and HVAC are not searchable",
    "DSPS old lookup and Reports of Decisions (online.drl.wi.gov): 403 with a CAPTCHA page",
    "DSPS Credential/License List Purchasing (dspslicenselist.wi.gov): a paid list service, and the host does not resolve from here",
    "Department of Revenue delinquent taxpayer list (www.revenue.wi.gov/Pages/Delqlist/DelqSearch.aspx, read through ww2.revenue.wi.gov/WebServicesPublicWeb/rest/delinquents/all; ~19,350 taxpayers on 2026-10-15): not used, because DOR's Legal Notices, Disclaimers and Terms of Use (www.revenue.wi.gov/Pages/HTML/disclaim.aspx, read 2026-10-15) say \"The material on the Department's website is for the noncommercial use of the general public. The fair use guidelines of the U.S. copyright statutes apply to all material on this website. ... For a copy or use of information on the Department website that is outside of the fair use provisions of copyright law, please seek permission from the individual listed as responsible for the page\" (the service itself answers without a CAPTCHA or login; its robots.txt Disallow no longer counts, OWNER ORDER 2026-10-15)",
    "DWD worker-misclassification stop-work orders: no published list found",
  ],
};
