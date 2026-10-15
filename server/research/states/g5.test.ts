import { describe, expect, it } from "vitest";
import { excelDate, formInputs, rosterGroups } from "./lib/g5-aspnet";
import { ocilbRow, sfmRows } from "./oh";
import { idfprDisciplineHit, parseIdolDebarred } from "./il";
import { dhsRows, dnrRows, isPersonName } from "./wi";
import { indyAddress, indyRow } from "./in";
import { miRow } from "./mi";

// Every row below is copied from the publisher's own file or page as downloaded on 2026-10-15.
async function* each<T>(rows: T[]) { yield* rows; }
const collect = async <T>(it: AsyncIterable<T>) => { const out: T[] = []; for await (const x of it) out.push(x); return out; };

describe("g5 helpers", () => {
  it("reads ASP.NET inputs, roster groups and Excel dates", () => {
    const f = formInputs('<input type="hidden" name="__VIEWSTATE" value="a&amp;b" /><input name="txt" value="x" /><input type="submit" name="go" value="Go" />');
    expect(Array.from(f.entries())).toEqual([["__VIEWSTATE", "a&b"], ["txt", "x"]]);
    const g = rosterGroups('<input id="a" type="checkbox" name="ctl00$MainContentPlaceHolder$ckbRoster0" /><label>50 / 52 / 53 Fire Protection Companies</label> <input id="b" type="checkbox" name="ctl00$MainContentPlaceHolder$ckbRoster1" /> 54 Fire Protection Individual <input type="submit" name="ctl00$MainContentPlaceHolder$btnRosterContinue" />');
    expect(g).toEqual([{ index: 0, label: "50 / 52 / 53 Fire Protection Companies" }, { index: 1, label: "54 Fire Protection Individual" }]);
    expect(excelDate("46600")).toBe("2027-08-01");
    expect(excelDate("46633.344050925924")).toBe("2027-09-03");
    expect(excelDate("Updated")).toBeNull();
  });
});

describe("Ohio", () => {
  it("maps an OCILB roster row with the qualifier, address and phone", () => {
    const h = ocilbRow({ FormattedCredential: "EL.10710", Name: "ERIC MEDICI", LastName: "MEDICI", Type: "EL", Status: "ACTIVE", State: "OH", County: "Union",
      "Effective Date": "07/01/2024", "Expiration Date": "06/30/2027", Company: "BAERENBURG LTD", "Company Address": "125 W Main St", "Company Address 2": "",
      "Company City": "Plain City", "Company State": "OH", "Company Zip": "43064-1144", "Company Phone": "(614) 336-2838" })!;
    expect(h.hit).toMatchObject({ businessName: "BAERENBURG LTD", licenseNumber: "EL.10710", licenseType: "Electrical Contractor", status: "Active",
      principal: "ERIC MEDICI", city: "Plain City", expires: "2027-06-30", address: "125 W Main St, Plain City, OH 43064-1144", phone: "(614) 336-2838",
      people: [{ name: "ERIC MEDICI", role: "Qualifying individual" }] });
    expect(h.keys).toEqual({ licenses: ["EL.10710"], phones: ["(614) 336-2838"], addresses: ["125 W Main St, Plain City, OH 43064-1144"] });
  });

  it("merges a fire protection individual's category rows into one license", async () => {
    const base = { Name: "BUDDY LEWIS NIECE", City: "WEST UNION", State: "OH", "Zip Code": "45693-9783", Credential: "54.01.1007", "Licensee Type": "Fire Protection Individual",
      "Expiration Date": "07/01/2027", "License Status": "Active", "Category Status": "Active", "Supervisor Name": "BUDDY NIECE DBA FIRE SAFE LLC", "Supervision Type": "Individual to Company" };
    const hits = await collect(sfmRows([
      { name: "54 Fire Protection Individual", rows: each([{ ...base, Category: "Portable Fire Extinguishers" }, { ...base, Category: "Pre-Engineered Extinguishers (OTW)" }]) },
      { name: "50 / 52 / 53 Fire Protection Companies", rows: each([{ Name: "VECTOR SECURITY INC", "Address 1": "50 E. MAIN ST.", City: "GENEVA", State: "OH", "Zip Code": "44041",
        Phone: "(440)466-7233", Credential: "50.04.0004", "Licensee Type": "Fire Protection Organization - Branch Office", "Expiration Date": "07/01/2027", "License Status": "Active" }]) },
    ]));
    expect(hits).toHaveLength(2);
    expect(hits[0].hit).toMatchObject({ principal: "BUDDY LEWIS NIECE", businessName: "BUDDY NIECE DBA FIRE SAFE LLC", specialty: "Portable Fire Extinguishers, Pre-Engineered Extinguishers (OTW)" });
    expect(hits[1].hit).toMatchObject({ businessName: "VECTOR SECURITY INC", address: "50 E. MAIN ST., GENEVA, OH 44041", phone: "(440)466-7233" });
  });
});

describe("Illinois", () => {
  it("reads the IDOL debarment notice", () => {
    const h = parseIdolDebarred("<p>The below listed are included in this category (this is not an exhaustive list):</p><p>Seven Brothers Painting, Inc. has been debarred from any public works project for a period of four years effective May 5, 2025</p>");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ name: "Seven Brothers Painting, Inc.", date: "2025-05-05", status: "Debarred from public works for four years", category: "debarment" });
  });

  it("maps an IDFPR discipline row and reads a single fine", () => {
    const h = idfprDisciplineHit({ license_type: "ROOFING CONTRACTOR", description: "LICENSED ROOFING CONTRACTOR", license_number: "104016928", license_status: "ACTIVE",
      business_name: "CHICAGO ROOFING SERVICES COMPANY", city: "CHICAGO", case_number: "2024000755", action: "Fine", discipline_start_date: "01/29/2025",
      discipline_reason: "roofing contractor license reprimanded and fined $5,000 after exceeded the scope of limited license." });
    expect(h).toMatchObject({ name: "CHICAGO ROOFING SERVICES COMPANY", id: "2024000755", date: "2025-01-29", status: "Fine", amount: 5000, licenseNumber: "104016928" });
  });
});

describe("Wisconsin", () => {
  it("tells people from businesses in the DNR directories", () => {
    expect(isPersonName("JOHNSON, JOSHUA L")).toBe(true);
    expect(isPersonName("QUINNELL'S SEPTIC & WELL SERVICE, INC")).toBe(false);
    expect(isPersonName("MARSHALL WELL DRILLING CORP")).toBe(false);
  });

  it("reads a DNR directory (county rows skipped, one hit per license)", () => {
    const rows = [
      ["Updated 10/02/2026", "-", "-"], ["County Name", "License No.", "Full Name", "Phone", "Mobile Phone", "Mailing Address", "Second Mailing Adress", "City", "State", "Zip", "Email"],
      ["Adams", "-", "-"],
      ["-", "7213", "JOHNSON, JOSHUA L", "(608)253-2751", "(608)253-2741", "MARSHALL WELL DRILLING CORP", "3774 HWY 13", "WISCONSIN DELLS", "WI", "53965-", "x"],
      ["-", "6946", "MARSHALL WELL DRILLING CORP", "(608)253-2751", "(877)553-7855", "3774 ST RD 13", "-", "WISCONSIN DELLS", "WI", "53965-8906", "x"],
      ["Juneau", "-", "-"], ["-", "7213", "JOHNSON, JOSHUA L", "(608)253-2751", "-", "-", "-", "-", "-", "-", "-"],
    ];
    const h = dnrRows(rows, "Well drilling (DNR directory)");
    expect(h).toHaveLength(2);
    expect(h[0].hit).toMatchObject({ principal: "JOSHUA L JOHNSON", businessName: null, address: null, phone: null }); // a person: no home address or phone
    expect(h[1].hit).toMatchObject({ businessName: "MARSHALL WELL DRILLING CORP", address: "3774 ST RD 13, WISCONSIN DELLS, WI 53965-8906" });
  });

  it("reads a DHS company list with Excel dates", () => {
    const h = dhsRows([["Updated October 1, 2026"], ["Type of Company", "Expiration Date", "Company Name", "Mailing Address", "City", "State", "Zip"],
      ["Lead Company", "46905", "JAKEL PLUMBING HEATING AND ELECTRIC INC", "800 OLD HWY 29", "ABBOTSFORD", "WI", "544053400"]], "https://x", "Wisconsin DHS certified lead companies");
    expect(h[0].hit).toMatchObject({ businessName: "JAKEL PLUMBING HEATING AND ELECTRIC INC", licenseType: "Certified lead company", expires: "2028-06-01", address: "800 OLD HWY 29, ABBOTSFORD, WI 54405-3400" });
  });
});

describe("Indiana and Michigan Accela exports", () => {
  it("splits an Indianapolis address and keeps only rows with a business name", () => {
    expect(indyAddress("108 E EPLER  AV                INDIANAPOLIS IN 46227")).toEqual({ address: "108 E EPLER AV, INDIANAPOLIS IN 46227", city: "INDIANAPOLIS" });
    expect(indyRow({ "License Number": "C0015101", "License Type": "Gen. Contractor", "Business Name": "", "First Name": "FRANK", Address: "1082 E EPLER AVENUE                INDIANAPOLIS IN 46227" })).toBeNull();
    const h = indyRow({ "License Number": "GS2600009", "License Type": "Gen. Contractor", "Business Name": "EMILE DIXON", "First Name": "EMILE",
      Address: "4030 EVANSTON AVE                INDIANAPOLIS IN 46205", "License Expiration Date": "12/31/2026", "Insurance Expiration Date": "09/22/2027" })!;
    expect(h.hit).toMatchObject({ licenseNumber: "GS2600009", licenseType: "Indianapolis Gen. Contractor license", expires: "2026-12-31", specialty: "Insurance on file until 2027-09-22" });
  });

  it("maps a LARA row whose company license names a person", () => {
    const h = miRow({ "License Number": "2102000170", "License Type": "Residential Builder Company", "Business Name": "", "First Name": "David", "Middle Initial": "Paul",
      "Last Name": "Karam", "License Expiration Date": "05/31/2023", City: "Sterling Heights", State: "MI", Zip: "48314" })!;
    expect(h.hit).toMatchObject({ businessName: null, principal: "David Paul Karam", expires: "2023-05-31", city: "Sterling Heights", matchedOn: "principal" });
    expect(h.keys).toEqual({ licenses: ["2102000170"] });
  });
});
