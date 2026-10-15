import { describe, expect, it } from "vitest";
import { roofingHit } from "./ok";

// One record of verify.cib.hbesystems.com/api/roofing/search, saved 2026-10-15 (insurance fields left out).
const REG = {
  id: 47591, tradeName: "Roofing Contractor Registration", statusName: "In Good Standing", licenseNumber: 80000002,
  renewalDate: "2027-12-01T05:59:59.000Z", commercialEndorsement: true, company_name: "S & CM, LLC", company_trade: "MCROOF.US",
  company_telephone: "405-877-7663", company_address1: "722 ENTERPRISE DR #150", company_address2: "", company_city: "EDMOND",
  company_state: "OK", company_zipcode: "73013", person_firstName: "SCOTT", person_lastName: "MCCOLLUM,SR", person_middleName: "A",
};

describe("Oklahoma CIB roofing registrations", () => {
  it("maps a registration", () => {
    const h = roofingHit(REG)!;
    expect(h.hit).toMatchObject({ businessName: "S & CM, LLC DBA MCROOF.US", licenseNumber: "80000002", status: "In Good Standing", expires: "2027-12-01", specialty: "Commercial endorsement", principal: "SCOTT A MCCOLLUM,SR", address: "722 ENTERPRISE DR #150, EDMOND, OK 73013" });
    expect(h.keys).toEqual({ licenses: ["80000002"], phones: ["405-877-7663"], addresses: ["722 ENTERPRISE DR #150, EDMOND, OK 73013"] });
  });
});
