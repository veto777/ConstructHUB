import { describe, expect, it } from "vitest";
import { nmSosHit, rldLicenseHit } from "./nm";

describe("New Mexico sources", () => {
  it("reads an RLD license without the street address", () => {
    // Trimmed from a live RLDLicenseSearchController.onSearch answer, 2026-10-15.
    const hit = rldLicenseHit({ Name: "HI0136", Status: "Active", License_Holder_Name__c: "Joshua A. Reed-Smith", License_Holder_City__c: "Corrales", License_Holder_State__c: "NM", periodEnd__c: "2029-02-28", Regulatory_Authorization_Type_Name__c: "Home Inspector", Regulatory_Authority__c: "Board of Home Inspector", License_Holder_Street__c: "723 W Meadowlark Ln" } as any);
    expect(hit).toMatchObject({ licenseNumber: "HI0136", licenseType: "Home Inspector", status: "Active", principal: "Joshua A. Reed-Smith", city: "Corrales, NM", expires: "2029-02-28" });
    expect(JSON.stringify(hit)).not.toContain("Meadowlark");
  });
  it("reads a Secretary of State row; revoked is adverse", () => {
    const row = { RECORD_NUM: "4092813", TITLE: ["BRADBURY STAMM BUILDERS, INC.", ""], RegistrationDate: "10/10/2008", BusinessStatusId: "Revoked Final", BusinessRecordTypeId: "Domestic Profit Corporation", FormationLocale: "New Mexico" };
    expect(nmSosHit(row)).toMatchObject({ name: "BRADBURY STAMM BUILDERS, INC.", id: "4092813", date: "2008-10-10", status: "Secretary of State status: Revoked Final", adverse: true });
    expect(nmSosHit({ ...row, BusinessStatusId: "Active" }).adverse).toBeNull();
  });
});
