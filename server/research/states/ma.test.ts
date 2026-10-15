import { describe, expect, it } from "vitest";
import { hicEnforcement, hicToHit, parseHicResponse } from "./ma";
import { pipeRecords } from "./lib/g2-mylicense";

// One registration from the Contractor Hub search response of 2026-10-15 (email and phone left out).
const HIC = { actions: [{ id: "1;a", state: "SUCCESS", returnValue: { returnValue: [{
  Id: "001cr00000NwSECAA3", Name: "99 NORTH RENOVATIONS & CONSTRUCTION LLC.", BillingStreet: "P.O. BOX 1052", BillingCity: "DERRY", BillingState: "New Hampshire",
  BillingPostalCode: "02038", HIC_Number__c: "158845", IsPersonAccount: false, Current_Registration_Status__c: "Revoked",
  Registration_Effective_Date__c: "2016-04-13", Registration_Expiration_Date__c: "2018-04-12",
  AccountContactRelations: [{ Contact_Full_Name__c: "JOSHUA N MEDUGNO" }],
  PublicComplaintAccount: [
    { Docket_Number__c: "2017-209", Hearing_Decision__c: "Reprimand", Hearing_Decision_Date__c: "2018-08-01", Total_Fine_Amount__c: 2400.0 },
    { Docket_Number__c: "2018-196", Hearing_Decision__c: "Revoke", Hearing_Decision_Date__c: "2018-11-13", Total_Fine_Amount__c: 0.0 },
  ],
  Guaranty_Fund_Applications__r: [{ Claim_Number__c: "GF-2025-36686", Actual_Guaranty_Fund_Payment__c: 10000.0 }],
  Cases2__r: [{ CaseNumber: "ARB-2025-25629", Award_Amount__c: 24233.0, Arbitration_Decision_in_Favor_of__c: "Homeowner" }],
}] } }] };

describe("MA Contractor Hub", () => {
  it("reads a registration and its enforcement history", () => {
    const [a] = parseHicResponse(JSON.stringify(HIC));
    const lic = hicToHit(a, "business");
    expect(lic).toMatchObject({ businessName: "99 NORTH RENOVATIONS & CONSTRUCTION LLC.", licenseNumber: "158845", status: "Revoked", expires: "2018-04-12", principal: "JOSHUA N MEDUGNO" });
    expect(lic.address).toBe("P.O. BOX 1052, DERRY, New Hampshire, 02038");
    const enf = hicEnforcement(a);
    expect(enf.map((e) => [e.category, e.id, e.amount, e.adverse])).toEqual([
      ["discipline", "2017-209", 2400, true], ["discipline", "2018-196", null, true],
      ["complaint", "GF-2025-36686", 10000, true], ["complaint", "ARB-2025-25629", 24233, true],
    ]);
    expect(enf[1].status).toBe("Hearing decision: Revoke");
    expect(enf.every((e) => e.licenseNumber === "158845")).toBe(true);
  });
  it("rejects a failed search instead of reporting no records", () => {
    expect(() => parseHicResponse(JSON.stringify({ actions: [{ state: "ERROR", error: [{ message: "x" }] }] }))).toThrow();
    expect(() => parseHicResponse("<html>")).toThrow();
  });
});

describe("MyLicense download", () => {
  it("reads the pipe-delimited file", () => {
    const text = "full_name|license_no|license_type_name|license_status_name|expiration_date|addr_line_1|addr_line_2|addr_line_4|addr_city|addr_county|addr_state|addr_zipcode|\n" +
      "AARON BABIKIAN|CSFA-106775|Construction Supervisor 1 & 2 Family|Active|7/17/2029 12:00:00 AM|9 HENRY DRIVE||LINCOLN RI  02865|LINCOLN|Providence|RI|02865|\n";
    expect(Array.from(pipeRecords(text))).toEqual([expect.objectContaining({ full_name: "AARON BABIKIAN", license_no: "CSFA-106775", addr_zipcode: "02865" })]);
    expect(() => Array.from(pipeRecords("<html>"))).toThrow();
  });
});
