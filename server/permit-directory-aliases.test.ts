import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ db: {} }));
const { postalAliasRows, sourcedPlaceKeys } = await import("./permit-directory-aliases");

const places = sourcedPlaceKeys();

describe("postal aliases in the permit directory", () => {
  it("hides names that are not in the sourced place list", () => {
    const rows = ["88, KY", "AARP, CA", "ABAC, GA", "KC, MO", "Suburb Maryland Fac, MD"].map((jurisdiction) => ({ jurisdiction }));
    expect(postalAliasRows(rows, places).map((r) => r.jurisdiction)).toEqual(rows.map((r) => r.jurisdiction));
  });

  it("keeps real places, including the one-word all-caps ones the sourced list spells that way", () => {
    const rows = ["ARP, TX", "UNA, SC", "CID, NC", "DISH, TX", "IXL, OK", "Aaronsburg, PA", "Travis AFB, CA"].map((jurisdiction) => ({ jurisdiction }));
    expect(postalAliasRows(rows, places)).toEqual([]);
  });

  it("keeps spelling variants of sourced or linked places", () => {
    const rows = ["St. Paul, MN", "Winston-Salem, NC", "Coeur d'Alene, ID"].map((jurisdiction) => ({ jurisdiction }));
    expect(postalAliasRows(rows, places)).toEqual([]);
    expect(postalAliasRows([{ jurisdiction: "Saint George, UT" }], places, ["St. George, UT"])).toEqual([]);
  });

  it("hides nothing when the place list is missing", () => {
    expect(postalAliasRows([{ jurisdiction: "AARP, CA" }], null)).toEqual([]);
  });
});
