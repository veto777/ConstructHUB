import { describe, expect, it } from "vitest";
import { isConstruction, mdcPhone, phlAddress } from "./local";

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
