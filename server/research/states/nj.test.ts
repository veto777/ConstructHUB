import { describe, expect, it } from "vitest";
import { parseNjBusinessNames } from "./nj";
import { decodeDsr } from "./lib/g1-powerbi";
import { excelDate, sheetRows } from "./lib/g1-xlsx";

// Saved 2026-10-15 from njportal.com/DOR/BusinessNameSearch (search "ALL%AMERICAN%DRYWALL"), first two rows.
const BIZ = `<table class="table table-data js-data-table" style="padding-top:5px;">
    <thead><tr><th>Business Name</th><th style="width:60px;">Entity Id</th><th class="hidden-phone" style="width:160px;">City</th><th style="width:60px;">Type</th><th class="hidden-phone" style="width:160px;">Incorporated Date</th></tr></thead>
    <tbody>
                <tr>
                    <td>ALL AMERICAN DRYWALL LLC</td>
                    <td>0400742430</td>
                    <td class="hidden-phone">CAPE MAY COURT HOUSE</td>
                    <td>
                            <abbr title="Domestic Limited Liability Company">LLC</abbr>
                    </td>
                    
                    <td class="hidden-phone">4/22/2015</td>
                </tr>
                <tr>
                    <td>ALL AMERICAN DRYWALL, INC.</td>
                    <td>0100575049</td>
                    <td class="hidden-phone"></td>
                    <td>
                            <abbr title="Domestic Profit Corporation">DP</abbr>
                    </td>
                    
                    <td class="hidden-phone">1/10/1994</td>
                </tr>
    </tbody></table>`;

// The first three rows of NJDOL's debarment report query (Power BI DSR), saved 2026-10-15; value dictionaries cut to 4.
const DSR = {"DS": [{"PH": [{"DM0": [{"S": [{"N": "G0", "T": 1, "DN": "D0"}, {"N": "G1", "T": 4}, {"N": "G2", "T": 7}, {"N": "G3", "T": 1, "DN": "D1"}, {"N": "G4", "T": 1, "DN": "D2"}, {"N": "G5", "T": 1, "DN": "D3"}, {"N": "G6", "T": 1, "DN": "D4"}, {"N": "G7", "T": 1, "DN": "D5"}, {"N": "G8", "T": 1, "DN": "D6"}, {"N": "G9", "T": 1, "DN": "D7"}], "C": [0, 738612, 1802044800000, 0, 0, 0, 0, 0, 0], "Ø": 32}, {"C": [1, 668133, 1878249600000, 1, 1, 0, 1, 1], "R": 512, "Ø": 128}, {"C": [2, 738387, 1827100800000, 2, 1, 2, 2], "R": 648}]}], "ValueDicts": {"D0": ["155 Jefferson Street Urban Renewal, LLC.", "911 Septic Pumping and Repair Inc.911 Carting, Inc.", "A & J Flooring LLC.", "A-Class Construction CorporationA-CLASS CONSTRUCTION CORPORATION"], "D1": ["NY", "NJ", "CT", "PA"], "D2": ["10022", "08844", "07023", "07114"], "D3": ["Somerset", "Union", "Essex", "Camden"], "D4": ["New York", "Hillsborough", "Fanwood", "Newark"], "D5": ["Suite 3A", "Apt. 2", "1st Floor", "Apt B"], "D6": ["215 East 58th Street", "189 Homestead Road", "51 Poplar Place", "94 Wright Street"], "D7": ["Debarred", "Suspended"]}}]};

describe("NJ business name search parser", () => {
  it("reads entity rows", () => {
    const hits = parseNjBusinessNames(BIZ);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ name: "ALL AMERICAN DRYWALL LLC", id: "0400742430", city: "CAPE MAY COURT HOUSE", date: "2015-04-22", category: "business_status", adverse: null });
    expect(hits[0].detail).toMatch(/^Domestic Limited Liability Company/);
    expect(hits[1].city).toBeNull();
  });
});

describe("Power BI DSR decoding", () => {
  it("expands repeats, nulls and value dictionaries", () => {
    const rows = decodeDsr(DSR as any);
    expect(rows[0]).toEqual(["155 Jefferson Street Urban Renewal, LLC.", 738612, 1802044800000, "NY", "10022", null, "New York", "Suite 3A", "215 East 58th Street", "Debarred"]);
    // R=512 repeats the last column; Ø=128 nulls ADDRESS2.
    expect(rows[1]).toEqual(["911 Septic Pumping and Repair Inc.911 Carting, Inc.", 668133, 1878249600000, "NJ", "08844", "Somerset", "Hillsborough", null, "189 Homestead Road", "Debarred"]);
    // R=648 (8+128+512): STATE, ADDRESS2 and the category repeat.
    expect(rows[2]).toEqual(["A & J Flooring LLC.", 738387, 1827100800000, "NJ", "07023", "Union", "Fanwood", null, "51 Poplar Place", "Debarred"]);
  });
});

describe("xlsx cells", () => {
  it("reads shared strings, numbers and gaps", () => {
    const xml = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>113888.36</v></c><c r="C2" s="3"><v>45478</v></c></row></sheetData>`;
    expect(sheetRows(xml, ["Name", "Date", "Cabanaman Pools LLC &amp; Co"].map((s) => s))).toEqual([["Name", "", "Date"], ["Cabanaman Pools LLC &amp; Co", "113888.36", "45478"]]);
    expect(excelDate("45478")).toBe("2024-07-05");
    expect(excelDate("")).toBeNull();
  });
});

describe("NJ audit fixes (2026-10-15)", () => {
  it("an individual licensee keeps city, state and ZIP only; a business keeps its street", async () => {
    const { njRosterHit } = await import("./nj");
    // Column names of the DCA pipe-delimited roster; the values only exercise the layout.
    const row = { full_name: "A B", first_name: "A", last_name: "B", license_type_name: "Journeyman Electrician", license_no: "34EJ00000000",
      addr_line_1: "1 X St", addr_city: "Trenton", addr_state: "NJ", addr_zipcode: "086080000", license_status_name: "Active" };
    const p = njRosterHit(row, "NJ trades", false)!;
    expect(p.hit.address).toBe("Trenton NJ 08608-0000");
    expect(p.keys).toEqual({ licenses: ["34EJ00000000"] });
    const b = njRosterHit({ ...row, full_name: "B Electric LLC" }, "NJ trades", true)!;
    expect(b.hit.address).toBe("1 X St Trenton NJ 08608-0000");
  });
  it("follows a redirect only within the download site", async () => {
    const { njRedirect } = await import("./nj");
    expect(njRedirect("https://newjersey.mylicense.com/Verification_Bulk/Search.aspx", "SearchResults.aspx")).toBe("https://newjersey.mylicense.com/Verification_Bulk/SearchResults.aspx");
    expect(() => njRedirect("https://newjersey.mylicense.com/Verification_Bulk/Search.aspx", "https://elsewhere.example/x")).toThrow(/off the site/);
  });
  it("reads only the head of a file for the layout check", async () => {
    const { fileHead } = await import("./nj");
    const { promises: fs } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const path = join(tmpdir(), `nj-head-${Date.now()}`);
    await fs.writeFile(path, "full_name|first_name\n" + "x".repeat(5000));
    try { expect((await fileHead(path)).length).toBe(200); expect(await fileHead(path)).toMatch(/^full_name\|/); } finally { await fs.rm(path, { force: true }); }
  });
});
