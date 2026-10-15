import { describe, expect, it } from "vitest";
import { DC_BUSINESS_TYPES, DC_INDIVIDUAL_TYPES, PHL_BUSINESS_TYPES, PHL_INDIVIDUAL_TYPES, isConstruction, licenseHit, mdcPhone, phlAddress } from "./local";
import { entityHolder } from "../licenses";

describe("local sources' parsers", () => {
  it("reads a Philadelphia permit contractor's address block", () => {
    expect(phlAddress("UNITED STATES ROOFING CORP\r\n1000 MAIN ST\r\nNORRISTOWN, PA  19401\r\nUSA")).toBe("1000 MAIN ST, NORRISTOWN, PA 19401");
    expect(phlAddress("Settelen Costanzo Joint Venture, LLC\r\n230 S. Broad St.\r\nSuite 1100\r\nPhiladelphia , PA  19102\r\nUSA")).toBe("230 S. Broad St., Suite 1100, Philadelphia, PA 19102");
    expect(phlAddress("ACME LLC\r\nUSA")).toBeNull();
  });
  it("joins Miami-Dade's integer area code and number", () => {
    expect(mdcPhone(305, 6650239)).toBe("3056650239");
    expect(mdcPhone(305, 650239)).toBeNull();
    expect(mdcPhone(0, 0)).toBeNull();
  });
  it("keeps construction NAICS titles only", () => {
    expect(isConstruction("Electrical Contractors")).toBe(true);
    expect(isConstruction("Commercial and Institutional Building Construction")).toBe(true);
    expect(isConstruction("Food Service Contractors")).toBe(false);
    expect(isConstruction("Construction Material Wholesalers, Other")).toBe(false);
  });
});

describe("local license rows (audit 2026-10-15)", () => {
  const base = { state: "KY", source: "Louisville Metro contractor licenses", sourceUrl: "u", licenseNumber: "1", licenseType: null, specialty: null, status: null,
    city: "LOUISVILLE", expires: null, address: "1 X ST, LOUISVILLE, KY 40202", phone: "(502) 555-0100" };
  it("an individual's row keeps the city only: no street, no phone, no address or phone key", () => {
    const h = licenseHit({ ...base, businessName: null, holder: "individual", principal: "A B", people: [{ name: "A B", role: "Licensee" }] });
    expect(h.hit).toMatchObject({ address: null, phone: null, city: "LOUISVILLE" });
    expect(h.keys).toEqual({ licenses: ["1"] });
  });
  it("a business row keeps them", () => {
    const h = licenseHit({ ...base, businessName: "B Builders LLC", holder: "business", principal: null, people: [] });
    expect(h.hit).toMatchObject({ address: "1 X ST, LOUISVILLE, KY 40202", phone: "(502) 555-0100", holder: "business" });
    expect(h.keys?.phones).toEqual(["(502) 555-0100"]);
  });
  // Round 2, decision 2: privacy follows the holder, not the presence of a business name.
  it("an individual's or unknown holder's row with a trade name attached still keeps the city only", () => {
    for (const holder of ["individual", null] as const) {
      const h = licenseHit({ ...base, businessName: "JW ELECTRICAL CONTRACTORS INC", holder, principal: "JOHN WEITORT", people: [{ name: "JOHN WEITORT", role: "Licensee" }] });
      expect(h.hit).toMatchObject({ address: null, phone: null, businessName: "JW ELECTRICAL CONTRACTORS INC" });
      expect(h.keys).toEqual({ licenses: ["1"] });
    }
  });
  it("holders from the publisher's own entity type and license class", () => {
    const lb = { business: /^(?:CORP|LLC|LLP|PARTNER|NON-PROFIT)$/, individual: /^SOLE$/ };
    expect(entityHolder("SOLE", lb)).toBe("individual");
    expect(entityHolder("CORP", lb)).toBe("business");
    expect(entityHolder(null, lb)).toBeNull();
    // Round 3, decision 3: a value on neither list is unknown, never a business.
    expect(entityHolder("TRUSTEE", lb)).toBeNull();
    const dc = { business: DC_BUSINESS_TYPES, individual: DC_INDIVIDUAL_TYPES };
    expect(entityHolder("Domestic Limited Liability Company", dc)).toBe("business");
    expect(entityHolder("Corporation (For Profit)", dc)).toBe("business");
    expect(entityHolder("Domestic Sole Proprietor", dc)).toBe("individual");
    for (const v of ["Unknown", "Trade Name", "For Profit", "Name Registration"]) expect(entityHolder(v, dc)).toBeNull();
    const phl = { business: PHL_BUSINESS_TYPES, individual: PHL_INDIVIDUAL_TYPES };
    expect(entityHolder("FIRE SUPPRESSION WORKER-SPECIALTY", phl)).toBe("individual");
    expect(entityHolder("SOMETHING NEW", phl)).toBeNull();
    expect(PHL_BUSINESS_TYPES.test("ELECTRICAL CONTRACTOR")).toBe(true);
    expect(PHL_BUSINESS_TYPES.test("PLUMBER JOURNEYMAN")).toBe(false);
    expect(PHL_BUSINESS_TYPES.test("FIRE SUPPRESSION WORKER")).toBe(false);
  });
});
