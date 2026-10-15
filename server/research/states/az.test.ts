import { describe, expect, it } from "vitest";
import { contactName, rocComplaintHit, rocHolder, rocLicenseHits, samePersonName, withDetails, type RocAccount } from "./az";
import { privateHit, reportHit } from "../privacy";

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
    expect(person[0].people).toEqual([{ name: "Douglas Guy Mack", role: "President; Qualifying Party" }]);
    expect(rocLicenseHits(ROWS, "Mack", "person")).toHaveLength(1); // "Mackey" is another word
    expect(rocLicenseHits(ROWS, "United Mechanical", "company")[0]).toMatchObject({ businessName: "United Mechanical Services LLC", city: "Surprise, AZ, 85379" });
  });
  it("reads a disciplined complaint without the complainant", () => {
    const hit = rocComplaintHit({
      Name: "2025-02504", Closed_Date__c: "2025-07-29", Jobsite_City__c: "Phoenix", Status__c: "Closed", Complaint_Type__c: "Disciplined",
      Allegations__c: "Failure to Comply with Directive;Violation of any ROC Rule - Poor Work", Complaint_Outcome_Multi__c: "Legal - Revoked",
      License_Number_Respondent__r: { Name: "ROC 341825", Primary_Licensee__r: { Name: "TOUGH TURTLE TURF LLC" } },
    }, null, "ROC 341825", "a0o8y000000RplBAAS");
    expect(hit).toMatchObject({ category: "discipline", name: "TOUGH TURTLE TURF LLC", id: "2025-02504", endDate: "2025-07-29", adverse: true, status: "Closed (Disciplined)", licenseNumber: "ROC 341825" });
    expect(hit.detail).toContain("Outcome: Legal - Revoked");
    expect(JSON.stringify(hit)).not.toMatch(/Complainant/);
  });
  it("keeps middle initials and single letters in the identity check (audit 2026-10-15)", () => {
    expect(samePersonName("Douglas G Mack", "Douglas Guy Mack")).toBe(true);
    expect(samePersonName("Douglas R Mack", "Douglas Guy Mack")).toBe(false);
    expect(samePersonName("Douglas R Mack", "Douglas Mack")).toBe(true); // no middle on the record: still a candidate
    expect(rocLicenseHits(ROWS, "Douglas R Mack", "person")).toHaveLength(0);
    const ds: RocAccount[] = [{ ...ROWS[1], accountName: "A & B Mechanical Services LLC" }];
    expect(rocLicenseHits(ds, "D & S Mechanical Services", "company")).toHaveLength(0);
    expect(rocLicenseHits(ds, "A & B Mechanical Services", "company")).toHaveLength(1);
  });
  it("adverse comes from the ROC's own case type and outcome", () => {
    const c = { Name: "2025-1", Complaint_Type__c: "Disciplined", Complaint_Outcome_Multi__c: "Legal - Revoked" };
    expect(rocComplaintHit(c, "X LLC", null, "id").adverse).toBe(true);
    expect(rocComplaintHit({ Name: "2025-2", Status__c: "Open", Complaint_Type__c: "Pending" }, "X LLC", null, "id").adverse).toBeNull();
  });
});

describe("Arizona round-2 audit (2026-10-16)", () => {
  it("a ROC search row's holder is unknown until its license page says (A13); its people are listed apart (decision 2)", () => {
    expect(rocLicenseHits(ROWS, "Sun Valley Remodeling", "company").every((h) => h.holder === null)).toBe(true);
  });
  it("a disciplined case: the outcome's clean answer; mixed or negated wording is unknown (decision 4)", async () => {
    const { disciplinedAdverse } = await import("./az");
    expect(disciplinedAdverse(null)).toBe(true);
    expect(disciplinedAdverse("Corrective work completed")).toBe(true);
    expect(disciplinedAdverse("License revoked")).toBe(true);
    expect(disciplinedAdverse("Dismissed")).toBe(false);
    expect(disciplinedAdverse("License revoked; hearing waived")).toBeNull();
    expect(disciplinedAdverse("License not revoked")).toBeNull();
  });
  it("an access denial on a license page stops the search instead of moving on (decision 6)", async () => {
    const { vi } = await import("vitest");
    const { PortalBlockedError, resetHostState } = await import("../http");
    resetHostState();
    const page = `<script>var x = ${encodeURIComponent('"fwuid":"FW1","APPLICATION@markup://siteforce:communityApp":"APP1"')};</script>`;
    const ok = (v: unknown) => new Response(JSON.stringify({ actions: [{ state: "SUCCESS", returnValue: v }] }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (/robots\.txt$/.test(u)) return new Response("", { status: 404 });
      if (!init?.body) return new Response(page, { status: 200 });
      return /getLicenseDetail/.test(String(init.body)) ? new Response("denied", { status: 403 }) : ok(ROWS);
    }));
    try {
      const { pack } = await import("./az");
      await expect(pack.liveLicenses![0].search("Sun Valley Remodeling", "company")).rejects.toBeInstanceOf(PortalBlockedError);
    } finally { vi.unstubAllGlobals(); resetHostState(); }
  }, 20_000);
});

describe("AZ account address (round 3)", () => {
  it("keeps city, state and ZIP only", async () => {
    const { rocCity } = await import("./az");
    expect(rocCity("EL MIRAGE, AZ, 85335")).toBe("EL MIRAGE, AZ, 85335");
    expect(rocCity("123 W Main St, Phoenix, AZ, 85001")).toBe("Phoenix, AZ, 85001");
    expect(rocCity(null)).toBeNull();
  });
});

// Trimmed from a live getRecords answer for "Gregory Smith", 2026-10-15; getLicenseDetail gave entityType
// "Sole Proprietorship" for ROC 213981. The phone is a 555 stand-in, not the published number (an individual's).
const SOLE: RocAccount[] = [{
  accountContactData: [{ contactName: "Gregory John Smith (Owner) " }, { contactName: "Gregory John Smith (Qualifying Party) " }],
  accountId: "001t000000MKxWcAAL", accountName: "Gregory John Smith", address: "Cornville, AZ, 86325", phone: "520-555-0100",
  licenseData: [{ licenseId: "a0ot0000000Ng4EAAS", licenseNo: "ROC 213981", qpName: "Gregory John Smith", status: "Suspended", subType: "B-2 General Small Commercial Contractor" }],
}];

describe("Arizona ROC person search and holders (2026-10-15)", () => {

  it("the license page's entity types: the ROC's values only", () => {
    expect(rocHolder("Sole Proprietorship")).toBe("individual");
    expect(rocHolder("LLC")).toBe("business");
    expect(rocHolder("Corporation")).toBe("business");
    expect(rocHolder("Partnership")).toBe("business");
    expect(rocHolder("Joint Venture")).toBeNull();
    expect(rocHolder(null)).toBeNull();
  });

  it("finds a person as the qualifying party, with everyone named and their roles", () => {
    const [h] = rocLicenseHits(ROWS, "Kenneth Mackey", "person");
    expect(h).toMatchObject({ licenseNumber: "ROC 325034", principal: "Kenneth Eugene Mackey", matchedOn: "principal", businessName: "United Mechanical Services LLC" });
    expect(h.people).toEqual([{ name: "Kenneth Eugene Mackey", role: "Qualifying Party" }]);
    expect(rocLicenseHits(ROWS, "Kenneth R Mackey", "person")).toEqual([]);
  });

  it("a sole proprietorship's license, once its page says so, is the owner's: no phone in the report", () => {
    const [h] = rocLicenseHits(SOLE, "Gregory Smith", "person");
    expect(h.matchedOn).toBe("principal");
    const owned = { ...h, holder: rocHolder("Sole Proprietorship") ?? h.holder };
    expect(owned.holder).toBe("individual");
    expect(reportHit(owned, "person").phone ?? null).toBeNull();
    expect(reportHit({ ...h, holder: rocHolder("LLC") ?? h.holder }, "company").phone).toBe("520-555-0100");
  });
});

describe("A13: the AZ holder comes only from a license page that was read", () => {
  it("past the 15 page reads, a hit is unknown: city only, no phone; an unlisted entity type is unknown too", async () => {
    const base = rocLicenseHits(SOLE, "Gregory Smith", "person")[0];
    const hits = Array.from({ length: 20 }, (_, i) => ({ ...base, licenseId: `id${i}`, licenseNumber: `ROC ${i}` }));
    const types: Record<string, string> = { id0: "LLC", id1: "Sole Proprietorship", id2: "Trust" };
    const out = await withDetails(hits, async (id) => ({ entityType: types[id] ?? "Corporation" }));
    expect(out[0].holder).toBe("business");
    expect(out[1].holder).toBe("individual");
    expect(out[2].holder).toBeNull();
    expect(out.slice(15).every((h) => h.holder === null)).toBe(true);
    expect(out.slice(15).every((h) => reportHit(privateHit(h), "company").phone == null)).toBe(true);
    expect(reportHit(out[0], "company").phone).toBe("520-555-0100");
  });
  it("a license page that fails leaves the holder unknown", async () => {
    const [h] = rocLicenseHits(SOLE, "Gregory Smith", "person");
    const [out] = await withDetails([h], async () => null);
    expect(out.holder).toBeNull();
    expect(privateHit(out).phone ?? null).toBeNull();
  });
});
