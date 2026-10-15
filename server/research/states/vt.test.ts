import { describe, expect, it } from "vitest";
import { vtRosterHit } from "./vt";

// Column names of the OPR roster .xlsx (2026-10-15); values below are placeholders for the layout, not records.
describe("VT OPR rosters (audit 2026-10-15)", () => {
  const row = { LicenseNumber: "0001", "First Name": "A", "Last Name": "B", "AddressLine 1": "1 X St", City: "Montpelier", State: "VT", ZipCode: "05602", Status: "Active" };
  it("an individual keeps city, state and ZIP only, with no address key", () => {
    const h = vtRosterHit(row, { type: "Residential Contractor - Individual" })!;
    expect(h.hit.address).toBe("Montpelier, VT, 05602");
    expect(h.keys).toEqual({ licenses: ["0001"] });
  });
  it("a business keeps its street address and key", () => {
    const h = vtRosterHit({ ...row, BusinessName: "B Builders LLC" }, { type: "Residential Contractor - Business", business: true })!;
    expect(h.hit.address).toBe("1 X St, Montpelier, VT, 05602");
    expect(h.keys?.addresses).toEqual(["1 X St, Montpelier, VT, 05602"]);
  });
});
