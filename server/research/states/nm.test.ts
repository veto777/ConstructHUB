import { describe, expect, it } from "vitest";
import { nmSosHit, parseNmSos, rldLicenseHit } from "./nm";

describe("New Mexico sources", () => {
  it("reads an RLD license; an individual's address of record is kept to city, state and ZIP", () => {
    // Trimmed from a live RLDLicenseSearchController.onSearch answer, 2026-10-15.
    const hit = rldLicenseHit({ Name: "HI0136", Status: "Active", License_Holder_Name__c: "Joshua A. Reed-Smith", License_Holder_City__c: "Corrales", License_Holder_State__c: "NM", periodEnd__c: "2029-02-28", Regulatory_Authorization_Type_Name__c: "Home Inspector", Regulatory_Authority__c: "Board of Home Inspector", License_Holder_Street__c: "723 W Meadowlark Ln", License_Holder_Postal_Code__c: "87048" });
    expect(hit).toMatchObject({ licenseNumber: "HI0136", licenseType: "Home Inspector", status: "Active", principal: "Joshua A. Reed-Smith", city: "Corrales, NM", expires: "2029-02-28" });
    expect(hit.address).toBe("Corrales, NM 87048"); // the street (a home address) is left out
  });
  it("reads a Secretary of State row; revoked is adverse", () => {
    const row = { RECORD_NUM: "4092813", TITLE: ["BRADBURY STAMM BUILDERS, INC.", ""], RegistrationDate: "10/10/2008", BusinessStatusId: "Revoked Final", BusinessRecordTypeId: "Domestic Profit Corporation", FormationLocale: "New Mexico" };
    expect(nmSosHit(row)).toMatchObject({ name: "BRADBURY STAMM BUILDERS, INC.", id: "4092813", date: "2008-10-10", status: "Secretary of State status: Revoked Final", adverse: true });
    expect(nmSosHit({ ...row, BusinessStatusId: "Active" }).adverse).toBeNull();
  });
});

describe("NM Secretary of State answers (audit 2026-10-15)", () => {
  it("no match is rows: {}; an answer without rows is an error, not zero results", () => {
    expect(parseNmSos({ template: [], rows: {} })).toEqual([]);
    expect(() => parseNmSos({ message: "An error has occurred." })).toThrow(/unexpected payload/);
    expect(() => parseNmSos(null)).toThrow();
  });
});
