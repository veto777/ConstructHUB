import { describe, expect, it } from "vitest";
import { contactName, rocComplaintHit, rocLicenseHits, type RocAccount } from "./az";

// Trimmed from a live ROC getRecords answer, 2026-10-15.
const ROWS: RocAccount[] = [
  {
    accountContactData: [{ contactName: "Douglas Guy Mack (President) " }, { contactName: "Douglas Guy Mack (Qualifying Party) " }],
    accountId: "0018y000002TNSuAAO", accountName: "Sun Valley Remodeling, Inc", address: "EL MIRAGE, AZ, 85335",
    licenseData: [{ licenseId: "a0ot0000000NqDxAAK", licenseNo: "ROC 128499", qpName: "Douglas Guy Mack", status: "Active", subType: "B-3 General Remodeling and Repair Contractor" }],
  },
  {
    accountContactData: [{ contactName: "Kenneth Eugene Mackey (Qualifying Party) " }],
    accountId: "0018y000002MjJRAA0", accountName: "United Mechanical Services LLC", address: "Surprise, AZ, 85379",
    licenseData: [{ licenseId: "a0ot0000000NWNFAA4", licenseNo: "ROC 325034", qpName: "Kenneth Eugene Mackey", status: "Inactive", subType: "CR-39 Air Conditioning and Refrigeration" }],
  },
];

describe("Arizona ROC", () => {
  it("strips the role from a contact name", () => {
    expect(contactName("Douglas Guy Mack (Qualifying Party) ")).toBe("Douglas Guy Mack");
  });
  it("keeps only rows that really name the person or the company", () => {
    const person = rocLicenseHits(ROWS, "Douglas Mack", "person");
    expect(person).toHaveLength(1);
    expect(person[0]).toMatchObject({ licenseNumber: "ROC 128499", principal: "Douglas Guy Mack", status: "Active", matchedOn: "principal" });
    expect(rocLicenseHits(ROWS, "Mack", "person")).toHaveLength(1); // "Mackey" is another word
    expect(rocLicenseHits(ROWS, "United Mechanical", "company")[0]).toMatchObject({ businessName: "United Mechanical Services LLC", city: "Surprise, AZ, 85379" });
  });
  it("reads a disciplined complaint without the complainant", () => {
    const hit = rocComplaintHit({
      Name: "2025-02504", Closed_Date__c: "2025-07-29", Jobsite_City__c: "Phoenix", Status__c: "Closed", Complaint_Type__c: "Disciplined",
      Allegations__c: "Failure to Comply with Directive;Violation of any ROC Rule - Poor Work", Complaint_Outcome_Multi__c: "Legal - Revoked",
      License_Number_Respondent__r: { Name: "ROC 341825", Primary_Licensee__r: { Name: "TOUGH TURTLE TURF LLC" } },
    }, null, "ROC 341825", "a0o8y000000RplBAAS");
    expect(hit).toMatchObject({ category: "discipline", name: "TOUGH TURTLE TURF LLC", id: "2025-02504", endDate: "2025-07-29", adverse: true, status: "Closed (Disciplined)" });
    expect(hit.detail).toContain("Outcome: Legal - Revoked");
    expect(JSON.stringify(hit)).not.toMatch(/Complainant/);
  });
});
