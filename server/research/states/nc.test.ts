import { describe, expect, it } from "vitest";
import { arlsHolder, parseArlsDetails, parseArlsMatters, parseArlsQualifiers, parseArlsSearch } from "./lib/g3-arls";

// Fragments as the three NC ARLS portals returned them on 2026-10-15 (blank lines removed).
const SEARCH_PERSON = "                <tbody>\n                            <tr>\n                                <td>\n                                        <a onclick=\"ShowAccountDetails( 't%2br0smg2s8s9SguyDew3Gw%3d%3d' );\" title=\"View Account Details\" href=\"#void\">Q.00290</a>\n                                </td>\n                                <td style=\"\">Qualifier</td>\n                                <td>\n                                    Shannon K. Douglas\n                                </td>\n                            </tr>\n                            <tr>\n                                <td>\n                                        <a onclick=\"ShowAccountDetails( '7DH9N5bBtJYe8mCKu7IxDQ%3d%3d' );\" title=\"View Account Details\" href=\"#void\">Q.24503</a>\n                                                <span style=\"color: red; font-weight: bold\">&nbsp; - &nbsp; License Not Active</span>\n                                </td>\n                                <td style=\"\">Qualifier</td>\n                                <td>\n                                    Shannon W. Douglas\n                                </td>\n                            </tr>\n                </tbody>\n"; // portal.nclbgc.org _Search, FirstName=Shannon LastName=Douglas
const GC_DETAILS = "\n<fieldset>\n    <legend>Contact</legend>\n    <div class=\"display-label\">Name</div>\n    <div class=\"display-field\">Story Homes Construction, LLC</div>\n    <br />\n        <div class=\"display-label\">Address</div>\n        <div class=\"display-field\">4700 Millenia Blvd, Suite 175\n<br />Orlando, FL  32829</div>\n        <br />\n        <div class=\"display-label\">Phone</div>\n        <div class=\"display-field\">(407) 276-6663</div>\n        <br />\n</fieldset>\n<fieldset>\n    <legend>License</legend>\n        <div class=\"display-label\">License #</div>\n        <div class=\"display-field\">L.79671</div>\n        <br />\n        <div class=\"display-label\">Account Type</div>\n        <div class=\"display-field\">License</div>\n        <br />\n            <div class=\"display-label\">First Issued Date</div>\n            <div class=\"display-field\">03/13/2018</div>\n            <br />\n            <div class=\"display-label\">Expiration Date</div>\n            <div class=\"display-field\">12/31/2026</div>\n            <br />\n            <div class=\"display-label\">Status</div>\n            <div class=\"display-field\">\n                Active\n            </div>\n            <br />\n            <div class=\"display-label\">License Limitation</div>\n            <div class=\"display-field\">Limited</div>\n            <br />\n</fieldset>\n    <fieldset>\n        <legend>Active Classifications</legend>\n        <div class=\"display-field\">Building</div>\n        <br />\n    </fieldset>\n"; // portal.nclbgc.org _ShowAccountDetails, L.79671
const GC_QUALIFIER = "\n<fieldset>\n    <legend>Contact</legend>\n    <div class=\"display-label\">Name</div>\n    <div class=\"display-field\">Shannon K. Douglas</div>\n    <br />\n        <div class=\"display-label\">Address</div>\n        <div class=\"display-field\">P. O. Box 1529\n<br />Tarboro, NC  27886</div>\n        <br />\n        <div class=\"display-label\">Phone</div>\n        <div class=\"display-field\">9198231021</div>\n        <br />\n</fieldset>\n<fieldset>\n    <legend>Qualifier</legend>\n        <div class=\"display-label\">Qualifier #</div>\n        <div class=\"display-field\">Q.00290</div>\n        <br />\n        <div class=\"display-label\">Account Type</div>\n        <div class=\"display-field\">Qualifier</div>\n        <br />\n            <div class=\"display-label\">First Issued Date</div>\n            <div class=\"display-field\"></div>\n            <br />\n            <div class=\"display-label\">Expiration Date</div>\n            <div class=\"display-field\"></div>\n            <br />\n            <div class=\"display-label\">Status</div>\n            <div class=\"display-field\">\n                Active\n            </div>\n            <br />\n</fieldset>\n    <fieldset>\n        <legend>Active Classifications</legend>\n        <div class=\"display-field\">Highway</div>\n        <br />\n    </fieldset>\n    <fieldset>\n        <legend>Qualifier for</legend>\n        <table>\n            <thead>\n                <tr>\n                    <td style=\"color:blue;\">Licensee</td>\n                    <td style=\"color:blue;\">License #</td>\n                    <td style=\"color:blue;\">Status</td>\n                </tr>\n            </thead>\n            <tbody>\n                    <tr>\n                        <td>Barnhill Contracting Company</td>\n                        <td>L.03194</td>\n                        <td>Active</td>\n                    </tr>\n            </tbody>\n        </table>\n    </fieldset>\n"; // portal.nclbgc.org _ShowAccountDetails, Q.00290
const GC_MATTERS = "\n    <fieldset>\n        <legend>Disciplinary Action (2022-present)</legend>\n            <table>\n                <thead>\n                    <tr>\n                        <td style=\"color:blue;\">Case #</td>\n                        <td style=\"color:blue;\">Date</td>\n                        <td style=\"color:blue;\">Disposition</td>\n                    </tr>\n                </thead>\n                <tbody>\n                            <tr style=\"vertical-align:top\">\n                                <td style=\"white-space: nowrap\">24-C-270</td>\n                                <td style=\"white-space: nowrap\">06/14/2024</td>\n                                <td><a href=\"/Public/GetPublicDocument/?key=&#39;ZiJVb1VxN21MDwa%2fYVfJXw%3d%3d&#39;\" target=\"_docs\">View Document</a></td>\n                            </tr>\n                </tbody>\n            </table>\n    </fieldset>\n"; // portal.nclbgc.org _ShowNCLBGCPublicMatters, L.79671
const PLUMB_DETAILS = "\n<fieldset>\n    <legend>Contact</legend>\n    <div class=\"display-label\">Name</div>\n    <div class=\"display-field\">Jeffery Owen Jordan</div>\n    <br />\n        <div class=\"display-label\">Company</div>\n        <div class=\"display-field\">Jordan Plumbing & Maintenance, LLC</div>\n        <br />\n        <div class=\"display-label\">Address</div>\n        <div class=\"display-field\">2200-B Dominion St\n<br />Durham, NC  27704</div>\n        <br />\n        <div class=\"display-label\">Phone</div>\n        <div class=\"display-field\">(919) 220-6996</div>\n        <br />\n</fieldset>\n<fieldset>\n    <legend>License</legend>\n        <div class=\"display-label\">License #</div>\n        <div class=\"display-field\">L.18419</div>\n        <br />\n        <div class=\"display-label\">Account Type</div>\n        <div class=\"display-field\">License</div>\n        <br />\n            <div class=\"display-label\">Expiration Date</div>\n            <div class=\"display-field\">12/31/2027</div>\n            <br />\n</fieldset>\n    <fieldset>\n        <legend>Active Classifications</legend>\n        <div class=\"display-field\">Plumbing Class I Contractor<br /> Residential Fire Sprinkler Installation Contractor</div>\n        <br />\n    </fieldset>\n    <fieldset>\n        <legend>Classification Holders</legend>\n        <div class=\"display-field\" style=\"width: auto;\">Jeffery Owen Jordan: Plumbing Class I Contractor, Residential Fire Sprinkler Installation Contractor</div>\n        <br />\n    </fieldset>\n"; // public.nclicensing.org _ShowAccountDetails, L.18419
const ELEC_DETAILS = "\n<fieldset>\n    <legend>Contact</legend>\n    <div class=\"display-label\">Name</div>\n    <div class=\"display-field\">Adequate Capacity Electric Company                          </div>\n    <br />\n        <div class=\"display-label\">Address</div>\n        <div class=\"display-field\">William J. Jones Sr.\n<br />5018 Brenda Ct.\n<br />Durham, NC  27712</div>\n        <br />\n        <div class=\"display-label\">Phone</div>\n        <div class=\"display-field\">(919) 477-6933</div>\n        <br />\n</fieldset>\n<fieldset>\n    <legend>License</legend>\n        <div class=\"display-label\">License #</div>\n        <div class=\"display-field\">L.03237</div>\n        <br />\n        <div class=\"display-label\">Account Type</div>\n        <div class=\"display-field\">Limited Classification License</div>\n        <br />\n            <div class=\"display-label\">Expiration Date</div>\n            <div class=\"display-field\">06/30/1990</div>\n            <br />\n            <div class=\"display-label\">Status</div>\n            <div class=\"display-field\">\n                Terminated\n                    <span style=\"color: red; font-weight: bold\">&nbsp; - &nbsp; License Not Valid</span>\n            </div>\n            <br />\n</fieldset>\n"; // arls-public.ncbeec.org _ShowAccountDetails, L.03237
const ELEC_QUALIFIERS = "\n<fieldset>\n    <legend>Qualifiers</legend>\n    <table>\n        <thead>\n            <tr>\n                <td style=\"color:blue;\">Name</td>\n                <td style=\"color:blue;\">Qualifier #</td>\n                <td style=\"color:blue;\">Status</td>\n            </tr>\n        </thead>\n        <tbody>\n                    <tr>\n                        <td>Lonnie Erik Holloway Sr.</td>\n                        <td>QUAL.L.06670</td>\n                        <td>Active</td>\n                    </tr>\n        </tbody>\n    </table>\n</fieldset>\n"; // arls-public.ncbeec.org _ShowAccountQualifiers, L.20647

describe("NC ARLS portals", () => {
  it("reads search rows with the not-active flag", () => {
    const rows = parseArlsSearch(SEARCH_PERSON);
    expect(rows.map((r) => [r.account, r.type, r.owner, r.notActive])).toEqual([
      ["Q.00290", "Qualifier", "Shannon K. Douglas", false],
      ["Q.24503", "Qualifier", "Shannon W. Douglas", true],
    ]);
  });

  it("reads a general contractor license and its disciplinary action", () => {
    const d = parseArlsDetails(GC_DETAILS);
    expect(d.fields).toMatchObject({ Name: "Story Homes Construction, LLC", "License #": "L.79671", Status: "Active", "Expiration Date": "12/31/2026", "License Limitation": "Limited", Phone: "(407) 276-6663" });
    expect(d.classifications).toEqual(["Building"]);
    expect(parseArlsMatters(GC_MATTERS, "https://portal.nclbgc.org")).toEqual([{
      caseNo: "24-C-270", date: "2024-06-14", heading: "Disciplinary Action (2022-present)",
      doc: "https://portal.nclbgc.org/Public/GetPublicDocument/?key=%27ZiJVb1VxN21MDwa%2fYVfJXw%3d%3d%27",
    }]);
  });

  it("reads a qualifier and the license it qualifies", () => {
    const d = parseArlsDetails(GC_QUALIFIER);
    expect(d.fields).toMatchObject({ Name: "Shannon K. Douglas", "Qualifier #": "Q.00290", Status: "Active" });
    expect(d.qualifierFor).toEqual([{ licensee: "Barnhill Contracting Company", license: "L.03194", status: "Active" }]);
  });

  it("reads a plumbing license's company, classes and holders", () => {
    const d = parseArlsDetails(PLUMB_DETAILS);
    expect(d.fields).toMatchObject({ Name: "Jeffery Owen Jordan", Company: "Jordan Plumbing & Maintenance, LLC", "License #": "L.18419" });
    expect(d.fields.Status).toBeUndefined();
    expect(d.classifications).toEqual(["Plumbing Class I Contractor", "Residential Fire Sprinkler Installation Contractor"]);
    expect(d.holders).toEqual(["Jeffery Owen Jordan: Plumbing Class I Contractor, Residential Fire Sprinkler Installation Contractor"]);
  });

  it("reads an electrical license status and qualifiers", () => {
    expect(parseArlsDetails(ELEC_DETAILS).fields.Status).toBe("Terminated - License Not Valid");
    expect(parseArlsQualifiers(ELEC_QUALIFIERS)).toEqual([{ name: "Lonnie Erik Holloway Sr.", number: "QUAL.L.06670", status: "Active" }]);
  });
});

describe("ARLS qualifiers and cache (audit 2026-10-15)", () => {
  it("keeps the board's own qualifier status: only the exact word Active reads as current", async () => {
    const { qualifierRole } = await import("./lib/g3-arls");
    // Seen on portal.nclbgc.org for license L.07639 (Blythe Construction, Inc.), 2026-10-15.
    expect(qualifierRole({ number: "Q.00841", status: "Active" })).toBe("Qualifier Q.00841");
    // "/active/i" used to match this one too.
    expect(qualifierRole({ number: "Q.00841", status: "Inactive" })).toBe("Qualifier Q.00841 (status: Inactive)");
    expect(qualifierRole({ number: null, status: null })).toBe("Qualifier (status: not given)");
  });

  it("drops expired searches from the cache", async () => {
    const { vi } = await import("vitest");
    const { arlsSearch, arlsCacheSize, pruneArlsCache } = await import("./lib/g3-arls");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/robots.txt")
      ? new Response("", { status: 404 })
      : new Response("<div>No results found for search criteria</div>", { status: 200 })));
    try {
      const board = { state: "NC", source: "NC Licensing Board for General Contractors", base: "https://portal.nclbgc.org", classField: "ClassificationDefinitionIdnt" as const, licenseLabel: "General Contractor License" };
      expect(await arlsSearch(board, "Blythe Construction", "company")).toEqual([]);
      expect(arlsCacheSize()).toBeGreaterThan(0);
      pruneArlsCache(Date.now() + 11 * 60_000);
      expect(arlsCacheSize()).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("ARLS holder (audit round 2, decision 2)", () => {
  it("a qualifier's own account is the person's, whatever licensees it qualifies for; a license account is the business's", () => {
    expect(arlsHolder(true, "Qualifier")).toBe("individual");
    expect(arlsHolder(true, null)).toBe("individual");
    expect(arlsHolder(false, "License")).toBe("business");
    expect(arlsHolder(false, null)).toBe("business");
    expect(arlsHolder(false, "Registration")).toBeNull();
  });
});
