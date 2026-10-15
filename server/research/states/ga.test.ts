import { describe, expect, it } from "vitest";
import { epdDate, epdHit, parseEpdDetails, parseEpdSearch } from "./ga";

// Saved from enfo.gaepd.org on 2026-10-15: the search for "construction" (first row) and order EPD-WP-9566.
const SEARCH = "ination-count\">\n    Total results: 300\n        <br />\n<tbody>\n                    <tr>\n                        <th scope=\"row\" data-label=\"Facility\">\n                            MRJ Construction, Inc <br />\n                            <em>Pike County</em>\n                        </th>\n                        <td data-label=\"Order\">\n                            EPD-WP-9566<br />\n                            <em>Erosion and Sedimentation Act</em>\n                        </td>\n                        <td data-label=\"Status/Date\">\n                                <strong>Executed&nbsp;On</strong>\n                                <br />\n12&#x2011;Aug&#x2011;2024                        </td>\n                        <td class=\"gaepd-tablecell-nolabel\">\n                            <a href=\"/Details/74923\">View</a>\n                        </td>\n                    </tr>\n</tbody>";
const DETAILS = "<table class=\"gaepd-table-compact gaepd-table-rowheadings gaepd-table-autowidth\" aria-label=\"Enforcement order details\">\n    <tbody>\n    <tr>\n        <th scope=\"row\">Facility</th>\n        <td>MRJ Construction, Inc</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">County</th>\n        <td>Pike County</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Cause of Order</th>\n        <td>Failed to obtain coverage for the Site under the Permit</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Requirements of Order</th>\n        <td>Immediately stop work on Site with the exception of installation and maintenance of erosion and sediment controls; submit an ESPCP created by a certified Design Professional for EPD; fully implement and properly maintain all BMPs outlined in ESPCP</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Settlement Amount</th>\n        <td>$5,000.00</td>\n    </tr>\n    <tr>\n        <th scope=\"row\">Legal Authority</th>\n        <td>Erosion and Sedimentation Act</td>\n    </tr>\n        <tr>\n            <th scope=\"row\">Date Executed</th>\n            <td>12&#x2011;Aug&#x2011;2024</td>\n        </tr>\n        <tr>\n            <th scope=\"row\">Publication Date For Executed Order</th>\n            <td>2&#x2011;Sep&#x2011;2024</td>\n        </tr>\n    <tr>\n        <th scope=\"row\">File Attachments</th>\n        <td>\n                <em>None</em>\n        </td>\n    </tr>\n    </tbody>\n</table>";

describe("Georgia EPD enforcement orders", () => {
  it("reads search rows and order details", () => {
    const { total, rows } = parseEpdSearch(SEARCH);
    expect(total).toBe(300);
    expect(rows[0]).toEqual({ facility: "MRJ Construction, Inc", county: "Pike County", order: "EPD-WP-9566", authority: "Erosion and Sedimentation Act", status: "Executed", date: "2024-08-12", details: "/Details/74923" });
    const hit = epdHit(rows[0], parseEpdDetails(DETAILS), "https://enfo.gaepd.org/Details/74923");
    expect(hit).toMatchObject({ name: "MRJ Construction, Inc", id: "EPD-WP-9566", date: "2024-08-12", amount: 5000, adverse: true, status: "Executed order", city: "Pike County" });
    expect(hit.detail).toContain("Cause: Failed to obtain coverage for the Site under the Permit");
  });

  it("reads EPD dates", () => {
    expect(epdDate("4\u2011Jun\u20112024")).toBe("2024-06-04");
    expect(epdDate("pending")).toBeNull();
  });
});
