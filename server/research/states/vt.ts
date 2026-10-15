/**
 * Vermont. The Division of Fire Safety trade licenses (data.vermont.gov cy8e-89cz: electricians, plumbers, gas and
 * oil installers, elevator, sprinkler) are already searched from ../licenses.ts. This pack adds, checked live on
 * 2026-10-15 (CLAUDE.md: never fabricate government data; column names and status words are the publisher's own):
 *
 *   VT  Office of Professional Regulation (Secretary of State) profession rosters, bulk: the OPR "Find a
 *       Professional" guest page's "Profession Roster Download" (an .xlsx per profession type, statuses Active,
 *       Inactive per Request, Expired and Disciplined), for residential contractors (businesses and individuals),
 *       architects, professional engineers, land surveyors,
 *       landscape architects, well drillers and wastewater/water system designers.
 *       The page is a Pega application with no plain download URL, so the roster is fetched with the headless
 *       browser the permit search already uses (playwright-core), one roster at a time.
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LicenseHit } from "@shared/research-reports";
import { CHROMIUM_ARGS, USER_AGENT } from "../../scrapers/polite-fetch";
import { guardBrowser } from "../http";
import { clean, usDate, type BulkHit } from "../bulk";
import { xlsxRecords } from "./lib/g2-xlsx";
import { personText } from "../person-name";
import type { StatePack } from "./types";

const OPR_LOOKUP = "https://secure.professionals.vermont.gov/prweb/PRServletCustom/V9csDxL3sXkkjMC_FR2HrA%5B%5B*/!STANDARD?UserIdentifier=LicenseLookupGuestUser";
const OPR_PAGE = "https://sos.vermont.gov/opr/find-a-professional/";
/** Profession and profession type, as the roster form's own option labels. */
const ROSTERS: { profession: string; type: string; business?: boolean }[] = [
  { profession: "Residential Contractors", type: "Residential Contractor - Business", business: true },
  { profession: "Residential Contractors", type: "Residential Contractor - Individual" },
  { profession: "Architects", type: "Architect" },
  { profession: "Engineering", type: "Professional Engineer" },
  { profession: "Land Surveyors", type: "Land Surveyor" },
  { profession: "Landscape Architects", type: "Landscape Architect" },
  { profession: "Well Drillers", type: "Well Driller" },
  { profession: "Wastewater / Water System Designers", type: "Wastewater/Water System Designers" },
];
const STATUSES = ["Active", "Inactive per Request", "Expired", "Disciplined"];

/** Download one roster through the guest page; returns the saved .xlsx path (the caller deletes it). */
async function fetchRoster(page: any, r: { profession: string; type: string }, check: () => void): Promise<string> {
  // The navigation passes the page's guard (guardPage) like every other request.
  await page.goto(OPR_LOOKUP, { waitUntil: "networkidle", timeout: 120_000 });
  check();
  await page.click("button:has-text('PROFESSION ROSTER DOWNLOAD')");
  await page.waitForTimeout(3000);
  const professions = await page.$$("select[name='$PpyDisplayHarness$pProductIds']");
  if (!professions.length) throw new Error("roster form did not open");
  await professions[professions.length - 1].selectOption({ label: r.profession });
  await page.waitForTimeout(4000);
  const type = await page.$("select[name='$PpyDisplayHarness$pSetProfessionType']");
  if (!type) throw new Error(`no profession types for ${r.profession}`);
  await type.selectOption({ label: r.type });
  await page.waitForTimeout(3000);
  for (const s of STATUSES) { await page.getByLabel(s, { exact: true }).check(); await page.waitForTimeout(1500); }
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.click("button[name^='NGLPRosterDownload']")]);
  check();
  const path = join(tmpdir(), `ch-vt-opr-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await dl.saveAs(path);
  return path;
}

/**
 * Puts a browser page behind the research HTTP guard (round 3, decision 5): every page load and XHR passes the full
 * guard (block, robots.txt, cooldown, rate limit), redirects included; every response tells the shared host state.
 * The returned check throws the first access denial seen, so the load stops instead of moving on.
 */
export const guardPage = (page: any): Promise<() => void> => guardBrowser(page, 2000);

/**
 * One roster row. An individual's roster address is where they live (audit 2026-10-15): city, state and ZIP only, no
 * street and no address key. A business row keeps its full address.
 */
export function vtRosterHit(x: Record<string, string>, r: { type: string; business?: boolean }): BulkHit | null {
  const no = clean(x.LicenseNumber);
  if (!no) return null;
  const business = r.business ? clean(x.BusinessName) : null;
  const who = r.business ? null : clean([x["First Name"], x["Middle Name"], x["Last Name"]].filter(Boolean).join(" "));
  if (!business && !who) return null;
  const locality = [x.City, x.State, x.ZipCode ?? x.Zip].map((v) => clean(v)).filter(Boolean);
  const street = [x["AddressLine 1"] ?? x.Address1, x["AddressLine 2"] ?? x.Address2].map((v) => clean(v)).filter(Boolean);
  const address = clean((business ? [...street, ...locality] : locality).join(", "));
  const supervisor = personText(x.Supervisor); // as published: a list stays a list (round 6, decision 3)
  // "Disciplined" is OPR's roster status for a disciplined licensee: disciplinary information, not a license status
  // (round 2, decision 1). It moves to `discipline` (dropped for an individual; a business's becomes an enforcement record).
  const status = clean(x.Status);
  const disciplined = !!status && /disciplin/i.test(status);
  const hit: LicenseHit = {
    state: "VT", source: "Vermont Office of Professional Regulation rosters (residential contractors, architects, engineers, surveyors, well drillers)",
    sourceUrl: OPR_PAGE, businessName: business, licenseNumber: no, licenseType: r.type, specialty: clean(x.Specialty),
    status: disciplined ? null : status, principal: who, city: clean(x.City), expires: usDate(x["License Expiration"]),
    matchedOn: business ? "business" : "principal", address,
    // The roster type says who holds the license: "Residential Contractor - Business" a business, every other roster a person.
    holder: r.business ? "business" : "individual",
    ...(disciplined ? { discipline: `OPR roster status: ${status}` } : {}),
    people: [...(who ? [{ name: who, role: null }] : []), ...(supervisor ? [{ name: supervisor, role: "Supervisor" }] : [])],
  };
  return { kind: "license", hit, business, person: who, people: supervisor ? [supervisor] : undefined, keys: business ? { licenses: [no], addresses: [address] } : { licenses: [no] }, component: r.type };
}

async function* vtOprLoader(): AsyncIterable<BulkHit> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: CHROMIUM_ARGS });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, acceptDownloads: true });
    const page = await context.newPage();
    const check = await guardPage(page);
    for (const r of ROSTERS) {
      const path = await fetchRoster(page, r, check);
      try {
        for (const x of await xlsxRecords(path)) {
          const h = vtRosterHit(x, r);
          if (h) yield h;
        }
      } finally {
        await fs.rm(path, { force: true });
      }
    }
  } finally {
    await browser.close();
  }
}

export const pack: StatePack = {
  state: "VT",
  checked: "2026-10-15",
  bulk: [
    { id: "vt-opr-rosters", state: "VT", label: "Vermont Office of Professional Regulation rosters (residential contractors, architects, engineers, surveyors, well drillers)",
      pageUrl: OPR_PAGE, everyHours: 24 * 7, minRows: 14_000, load: vtOprLoader },
  ],
  blocked: [
    "Secretary of State business search (bizfilings.vermont.gov): an Angular app over api.bizfilings.vermont.gov; not built yet (the path tried led to the account login)",
    "OPR conduct decisions (Zoho Creator search) and monthly discipline reports (PDF): almost all are against individual licensees, which reports don't search for enforcement (companies only)",
  ],
};
