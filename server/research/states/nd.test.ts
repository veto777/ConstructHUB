import { describe, expect, it } from "vitest";
import { ndContractorHit, ndContractorHolder, pack, sameElectricianNumber, sebRows } from "./nd";

describe("ND State Electrical Board results", () => {
  it("reads the table and drops the hidden separator", () => {
    const html = `<table cellpadding="2" cellspacing="0" class="searchlicensestable">
<tr><th>Name</th><th>Business</th><th>City</th></tr><tr><td>CHRISTOPHER BRISTOL</td><td>ELECTRIC SOLUTIONS INC <span class="hide">/ </span></td><td>BOTTINEAU</td></tr></table>`;
    expect(sebRows(html)).toEqual([["CHRISTOPHER BRISTOL", "ELECTRIC SOLUTIONS INC", "BOTTINEAU"]]);
  });
});

describe("ND Secretary of State contractor license", () => {
  it("joins the search row and its detail drawer", () => {
    const h = ndContractorHit(
      { ID: 52038, TITLE: ["ONE CALL CONSTRUCTION, LLC", "Class A  -  000055701"], RECORD_NUM: "0007585863", STATUS: "Active", STANDING: "Good Standing", FILING_DATE: "09/29/2026" },
      { "License Num": "000055701", "Renewal Date": "3/1/2027", "Mailing Address": "1728 25TH AVE E, DICKINSON, ND 58601-7704", "Standing - WSI": "Good", "Business Phone": "(701) 426-3649" },
      "business",
    );
    expect(h).toMatchObject({ businessName: "ONE CALL CONSTRUCTION, LLC", licenseNumber: "000055701", licenseType: "Contractor license, Class A", expires: "2027-03-01", city: "DICKINSON", phone: "(701) 426-3649" });
    expect(h.status).toBe("Active; Good Standing; WSI standing good");
  });
});

describe("North Dakota (audit 2026-10-15)", () => {
  // Rows of a live FirstStop contractorsearch for "Johnson", 2026-10-15.
  const row = (title: string, cls: string) => ({ ID: 1, TITLE: [title, cls], RECORD_NUM: null, STATUS: "Inactive - Expired", STANDING: null, FILING_DATE: null });
  it("a license under a person's own name is not a business name; a dba splits", () => {
    expect(ndContractorHit(row("BOB JOHNSON", "Class D  -  36220"), {}, "business")).toMatchObject({ businessName: null, principal: "BOB JOHNSON", licenseNumber: "36220" });
    expect(ndContractorHit(row("EUGENE JOHNSON DBA JOHNSON CONSTRUCTION", "Class A  -  4363"), {}, "business")).toMatchObject({ businessName: "JOHNSON CONSTRUCTION", principal: "EUGENE JOHNSON" });
    expect(ndContractorHit(row("BIG JOHNSON CONSTRUCTION, LLC", "Class A  -  000053217"), {}, "business")).toMatchObject({ businessName: "BIG JOHNSON CONSTRUCTION, LLC", principal: null });
  });
  it("an electrician number matches only with the same letters", () => {
    expect(sameElectricianNumber({ type: "license", value: "12345" }, "12345")).toBe(true);
    expect(sameElectricianNumber({ type: "license", value: "#12345" }, "12345")).toBe(true);
    expect(sameElectricianNumber({ type: "license", value: "ABC12345" }, "12345")).toBe(false);
  });
});

describe("ND holder and searched kinds (audit round 2, decisions 2 and 8)", () => {
  it("a license under '<person> DBA <name>' is the person's; a business name the business's; a bare personal name unknown", () => {
    expect(ndContractorHolder("EUGENE JOHNSON DBA JOHNSON CONSTRUCTION")).toBe("individual");
    expect(ndContractorHolder("JOHNSON CONSTRUCTION LLC")).toBeNull(); // round 3, decision 3: a name never makes a business
    expect(ndContractorHolder("BOB JOHNSON")).toBeNull();
  });
  it("lookups that can't search a kind of name say so", () => {
    const kinds = Object.fromEntries((pack.liveLicenses ?? []).map((l) => [l.source, l.kinds]));
    expect(kinds["North Dakota Secretary of State contractor licenses"]).toEqual(["company"]);
    expect(kinds["North Dakota State Plumbing Board licenses"]).toEqual(["person"]);
  });
});
