import { describe, expect, it } from "vitest";
import { dnrRows, isPersonName } from "./wi";

// Rows copied from the DNR well-driller directory as downloaded on 2026-10-15 (see g5.test.ts).
const ROWS = [
  ["Updated 10/02/2026", "-", "-"], ["County Name", "License No.", "Full Name", "Phone", "Mobile Phone", "Mailing Address", "Second Mailing Adress", "City", "State", "Zip", "Email"],
  ["-", "7213", "JOHNSON, JOSHUA L", "(608)253-2751", "(608)253-2741", "MARSHALL WELL DRILLING CORP", "3774 HWY 13", "WISCONSIN DELLS", "WI", "53965-", "x"],
  ["-", "6946", "MARSHALL WELL DRILLING CORP", "(608)253-2751", "(877)553-7855", "3774 ST RD 13", "-", "WISCONSIN DELLS", "WI", "53965-8906", "x"],
];

describe("WI audit fixes (2026-10-15)", () => {
  it("a person's row keeps the city only: no street, no phone, no phone or address key", () => {
    const [p] = dnrRows(ROWS, "Well drilling (DNR directory)");
    expect(p.hit).toMatchObject({ principal: "JOSHUA L JOHNSON", businessName: null, address: null, phone: null, city: "WISCONSIN DELLS" });
    expect(p.keys).toEqual({ licenses: ["7213"] });
  });
  // Round 3, decision 3: the directory publishes no entity type, so an entity's name leaves the holder unknown and
  // its mailing address and phones out (they may be a home's).
  it("an entity-named row's holder is unknown: no street, no phone, license key only", () => {
    const [, b] = dnrRows(ROWS, "Well drilling (DNR directory)");
    expect(b.hit).toMatchObject({ businessName: "MARSHALL WELL DRILLING CORP", holder: null, phone: null, address: null });
    expect(b.keys).toEqual({ licenses: ["6946"] });
  });
  it("a surname that is also a trade word stays a person", () => {
    expect(isPersonName("WELLS, JOHN")).toBe(true);
    expect(isPersonName("MARSHALL WELL DRILLING CORP")).toBe(false);
  });
});

describe("WI holders (audit round 2, decision 2)", () => {
  it("a person is the holder; any other name (an entity form or a trade-sounding name) is unknown", () => {
    const [p, b] = dnrRows(ROWS, "Well drilling (DNR directory)");
    expect(p.hit.holder).toBe("individual");
    expect(b.hit.holder).toBeNull();
    const rows = [...ROWS.slice(0, 2), ["-", "7000", "QUINNELL'S SEPTIC & WELL SERVICE", "(608)555-0101", "-", "1 MAIN ST", "-", "MADISON", "WI", "53703", "x"]];
    expect(dnrRows(rows, "Well drilling (DNR directory)")[0].hit.holder).toBeNull();
  });
});
