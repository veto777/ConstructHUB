import { describe, expect, it } from "vitest";
import { addressLine, fullName, isoDay } from "./local-fetch";

describe("local-fetch helpers", () => {
  it("reads the date forms city portals publish", () => {
    expect(isoDay("2027-02-28T00:00:00.000")).toBe("2027-02-28");
    expect(isoDay("01/05/26")).toBe("2026-01-05");
    expect(isoDay("9/29/2017-10/11/17")).toBe("2017-09-29");
    expect(isoDay(1767225600000)).toBe("2026-01-01");
    expect(isoDay("")).toBeNull();
    expect(isoDay("pending")).toBeNull();
  });
  it("joins an address only when there is a street", () => {
    expect(addressLine(["1656", "PARKER STREET"], "BRONX", "NY", "10462")).toBe("1656 PARKER STREET, BRONX, NY 10462");
    expect(addressLine([null, null], "BRONX", "NY", "10462")).toBeNull();
    expect(fullName("GEORGE", null, "SMITH")).toBe("GEORGE SMITH");
  });
});
