import { describe, expect, it } from "vitest";
import { stateFromAddressText, stateFromZip, stateOfAddress } from "@shared/us-address-state";

describe("us-address-state", () => {
  it("reads ZIP prefixes", () => {
    expect(stateFromZip("98226")).toBe("WA");
    expect(stateFromZip("34690")).toBe("FL");
    expect(stateFromZip("33770-1234")).toBe("FL");
    expect(stateFromZip("99403")).toBe("WA");
    expect(stateFromZip("46037")).toBe("IN");
    expect(stateFromZip("34002")).toBeNull(); // military (AA)
    expect(stateFromZip("")).toBeNull();
    expect(stateFromZip("123")).toBeNull();
  });
  it("reads the state at the end of free text only", () => {
    expect(stateFromAddressText("5590 Starry Rd.\nBellingham, WA 98226")).toBe("WA");
    expect(stateFromAddressText("296 E Laurel Road  Bellingham WA 98226")).toBe("WA");
    expect(stateFromAddressText("CPM - James St job Bellingham WA")).toBe("WA");
    expect(stateFromAddressText("2137 Ranchita Trail Holiday FL 34690")).toBe("FL");
    expect(stateFromAddressText("12 Bay St, Largo, Florida")).toBe("FL");
    expect(stateFromAddressText("12 Bay St Largo FL")).toBe("FL");
    expect(stateFromAddressText("100 Main St, New York, NY 10001, USA")).toBe("NY");
    expect(stateFromAddressText("3737 Tree Farm lane")).toBeNull();
    expect(stateFromAddressText("Building 1 ONLY")).toBeNull();
    expect(stateFromAddressText("Washington St job")).toBeNull();
    expect(stateFromAddressText("Hillsborough Co")).toBeNull(); // "Co" is not Colorado
    expect(stateFromAddressText("Bellingham WA 34690")).toBeNull(); // state and ZIP disagree
    // Street suffixes that are also state codes need a ZIP or a comma.
    expect(stateFromAddressText("123 OAK CT")).toBeNull();
    expect(stateFromAddressText("123 Elm LA")).toBeNull();
    expect(stateFromAddressText("9 Birch WY")).toBeNull();
    expect(stateFromAddressText("1 Main St, Hartford, CT 06103")).toBe("CT");
    expect(stateFromAddressText("1 Main St, Hartford, CT")).toBe("CT");
    // A state name at the end is a street name unless a comma or ZIP marks it.
    expect(stateFromAddressText("500 N Washington")).toBeNull();
    expect(stateFromAddressText("500 Elm, Spokane, Washington")).toBe("WA");
    expect(stateFromAddressText("Tampa Florida 33602")).toBe("FL");
  });
  it("prefers the explicit field, then ZIP, then text", () => {
    expect(stateOfAddress({ state: "Washington" })).toBe("WA");
    expect(stateOfAddress({ postalCode: "34690" })).toBe("FL");
    expect(stateOfAddress({ addressLine1: "1 Elm St", city: "Bellingham WA" })).toBe("WA");
    expect(stateOfAddress({ text: "Largo FL 33770" })).toBe("FL");
    expect(stateOfAddress({})).toBeNull();
  });
});
