import { describe, expect, it } from "vitest";
import { ndContractorHit, sebRows } from "./nd";

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
