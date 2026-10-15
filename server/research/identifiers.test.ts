import { describe, expect, it } from "vitest";
import { addressKeys, addressMatches, idWords, normLicense, normPhone, queryWords } from "./identifiers";
import { indexWords } from "./bulk";

describe("research identifiers", () => {
  it("normalizes phones", () => {
    expect(normPhone("(206) 555-0142")).toBe("2065550142");
    expect(normPhone("+1 206.555.0142")).toBe("2065550142");
    expect(normPhone("555-0142")).toBeNull();
    expect(normPhone("0000000000")).toBeNull();
  });
  it("normalizes license numbers", () => {
    expect(normLicense("cgc-1512345")).toBe("CGC1512345");
    expect(normLicense("ABC")).toBeNull();
  });
  it("keys addresses by house number, street word and ZIP", () => {
    expect(addressKeys("123 N. Main St., Ste 4, Seattle WA 98101")).toEqual(["a:123 MAIN", "z:98101"]);
    expect(addressKeys("12345 Elm Ave")).toEqual(["a:12345 ELM"]);
    expect(addressKeys("251-21 Jericho Tpke 11426")).toEqual(["a:251-21 JERICHO", "z:11426"]);
    expect(addressMatches("251-21 Jericho Tpke", "251-63 JERICHO TURNPIKE")).toBe(false);
    expect(addressKeys("PO Box 77, Austin TX 78701")).toEqual(["a:POBOX 77", "z:78701"]);
    expect(addressKeys("Seattle, WA")).toEqual([]);
    expect(addressMatches("123 Main Street 98101", "123 N MAIN ST SEATTLE WA 98101-2222")).toBe(true);
    expect(addressMatches("123 Main Street 98101", "123 MAIN ST TACOMA WA 98402")).toBe(false);
    expect(addressMatches("123 Main Street", "124 MAIN ST")).toBe(false);
  });
  it("indexes identifiers with the names", () => {
    const w = indexWords("Acme Roofing LLC", "Jane Doe", ["John Roe"], { licenses: ["RC-29027"], phones: ["206-555-0142"], addresses: ["1 Pine St 98101"] });
    expect(w).toEqual(expect.arrayContaining(["b:ACME", "p:JANE", "p:ROE", "l:RC29027", "t:2065550142", "a:1 PINE", "z:98101"]));
    expect(idWords(undefined)).toEqual([]);
    expect(queryWords({ type: "phone", value: "206 555 0142" })).toEqual(["t:2065550142"]);
  });
});
