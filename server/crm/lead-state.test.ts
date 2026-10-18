/** server/crm/lead-state.ts — where a lead belongs (state + market), from what is on the row. */
import { describe, it, expect } from "vitest";
import { leadStateOf, leadPlaceOf, hostStem, UNKNOWN_STATE } from "./lead-state";
import { leadMarketsOf, UNKNOWN_MARKET } from "@shared/lead-markets";

const DIV = ["WA", "fl", "TX"]; // as stored on divisions (case varies)
const MARKETS = leadMarketsOf({ leadMarkets: [
  { name: "Tampa", state: "FL", aliases: ["tampa bay", "brandon", "riverview"], areaCodes: ["813"] },
  { name: "St Petersburg", state: "FL", aliases: ["st. petersburg", "saint petersburg", "stpete", "st pete", "clearwater", "largo", "pinellas", "indian rocks", "indian rocks beach"], areaCodes: ["727"] },
  { name: "Sarasota", state: "FL", aliases: ["bradenton", "venice", "lakewood ranch"], areaCodes: ["941"] },
  { name: "Orlando", state: "FL", aliases: ["kissimmee", "winter park"], areaCodes: ["407", "321", "689"] },
  { name: "Bellingham", state: "WA", aliases: ["ferndale", "blaine", "anacortes", "semiahmoo", "mount vernon", "burlington"], areaCodes: ["360"] },
  { name: "Lynden", state: "WA", aliases: ["everson", "sumas", "nooksack"], areaCodes: ["360"] },
  { name: "Dallas", state: "TX", aliases: ["irving", "garland", "richardson"], areaCodes: ["214", "469", "972"] },
  { name: "McKinney", state: "TX", aliases: ["frisco", "plano", "allen", "prosper"], areaCodes: ["214", "469", "972"] },
] });

describe("lead state", () => {
  it("the lead's own state wins, in any spelling", () => {
    expect(leadStateOf({ state: "Washington", sourceLabel: "alpineexteriorsfl.com (FL)" }, DIV)).toBe("WA");
    expect(leadStateOf({ state: "tx" }, DIV)).toBe("TX");
  });
  it("a (FL) tag on the source label; a host that ends in a division state", () => {
    expect(leadStateOf({ sourceLabel: "alpineexteriorsfl.com (FL)" }, DIV)).toBe("FL");
    expect(leadStateOf({ sourceLabel: "alpineexteriorswa.com (WAMainSite)" }, DIV)).toBe("WA");
    expect(leadStateOf({ pageUrl: "https://alpineexteriorsfl.com/contact" }, DIV)).toBe("FL");
    expect(leadStateOf({ sourceLabel: "sidingsemiahmoowa.com" }, DIV)).toBe("WA");
  });
  it("a host that names a real city of exactly one division state (reference data, not a hand list)", () => {
    expect(leadStateOf({ sourceLabel: "clearwaterwindowcompany.com" }, DIV)).toBe("FL");
    expect(leadStateOf({ sourceLabel: "anacortesexteriorco.com" }, DIV)).toBe("WA");
    // Short city names (Blaine, Largo, Alpine) are left to the market aliases — too easy to hit inside a brand.
    expect(leadStateOf({ sourceLabel: "blaineroofingco.com" }, DIV)).toBe(UNKNOWN_STATE);
  });
  it("otherwise unknown — never a guess", () => {
    expect(leadStateOf({ sourceLabel: "alpineexteriorsllc.com" }, DIV, [], { companyName: "Alpine Exteriors" })).toBe(UNKNOWN_STATE);
    expect(leadStateOf({ sourceLabel: "alpineexteriorsllc.com" }, DIV)).toBe(UNKNOWN_STATE);
    expect(leadStateOf({ sourceLabel: "Call Assistant" }, DIV)).toBe(UNKNOWN_STATE);
    expect(leadStateOf({}, DIV)).toBe(UNKNOWN_STATE);
    // A city that exists in two of the company's states (Ferndale: WA and FL) is not resolved without a market alias.
    expect(leadStateOf({ sourceLabel: "ferndalewindowco.com" }, DIV)).toBe(UNKNOWN_STATE);
    expect(leadStateOf({ sourceLabel: "anacortesexteriorco.com" }, ["FL"])).toBe(UNKNOWN_STATE);
  });
  it("host stems", () => {
    expect(hostStem({ pageUrl: "https://www.alpinecontractingllc.com/x" })).toBe("alpinecontractingllc");
    expect(hostStem({ sourceLabel: "alpinesidingpros-net-217460.hostingersite.com" })).toBe("hostingersite");
    expect(hostStem({ sourceLabel: "Import" })).toBeNull();
  });
});

describe("lead market", () => {
  it("the site names the market or one of its aliases — and the market carries the state", () => {
    expect(leadPlaceOf({ sourceLabel: "stpetesidingco.com" }, DIV, MARKETS)).toEqual({ state: "FL", market: "st-petersburg" });
    expect(leadPlaceOf({ sourceLabel: "clearwaterwindowcompany.com" }, DIV, MARKETS)).toEqual({ state: "FL", market: "st-petersburg" });
    expect(leadPlaceOf({ pageUrl: "https://www.alpineexteriorsbradenton.com/" }, DIV, MARKETS)).toEqual({ state: "FL", market: "sarasota" });
    expect(leadPlaceOf({ sourceLabel: "ferndalewindowco.com" }, DIV, MARKETS)).toEqual({ state: "WA", market: "bellingham" });
    expect(leadPlaceOf({ sourceLabel: "indianrocksroofingcompany.com" }, DIV, MARKETS)).toEqual({ state: "FL", market: "st-petersburg" });
  });
  it("a city written in the message or form fields", () => {
    expect(leadPlaceOf({ message: "Property Address: 1410 West North St, Tampa, FL 33602" }, DIV, MARKETS)).toEqual({ state: "FL", market: "tampa" });
    expect(leadPlaceOf({ fields: { city: "McKinney" } }, DIV, MARKETS)).toEqual({ state: "TX", market: "mckinney" });
    expect(leadPlaceOf({ city: "Lynden" }, DIV, MARKETS)).toEqual({ state: "WA", market: "lynden" });
  });
  it("a phone area code owned by exactly one market files the lead there; a shared code settles only the state", () => {
    expect(leadPlaceOf({ phone: "7277445969" }, DIV, MARKETS)).toEqual({ state: "FL", market: "st-petersburg" });
    expect(leadPlaceOf({ phone: "+1 (813) 555-0100" }, DIV, MARKETS)).toEqual({ state: "FL", market: "tampa" });
    expect(leadPlaceOf({ phone: "3609619373" }, DIV, MARKETS)).toEqual({ state: "WA", market: UNKNOWN_MARKET });
    expect(leadPlaceOf({ phone: "2145550100" }, DIV, MARKETS)).toEqual({ state: "TX", market: UNKNOWN_MARKET });
    expect(leadPlaceOf({ phone: "8649800168" }, DIV, MARKETS)).toEqual({ state: UNKNOWN_STATE, market: UNKNOWN_MARKET });
  });
  it("the row's own state beats a market from a weaker signal", () => {
    expect(leadPlaceOf({ state: "WA", phone: "8135550100" }, DIV, MARKETS)).toEqual({ state: "WA", market: UNKNOWN_MARKET });
  });
  it("the site's state and a market in the text agree or the text wins", () => {
    expect(leadPlaceOf({ sourceLabel: "alpineexteriorsfl.com (FL)", message: "Sarasota job" }, DIV, MARKETS)).toEqual({ state: "FL", market: "sarasota" });
  });
});

describe("market settings", () => {
  it("parses the stored list, slugs keys, lower-cases aliases, keeps 3-digit area codes, drops junk", () => {
    expect(MARKETS.map((m) => m.key)).toEqual(["tampa", "st-petersburg", "sarasota", "orlando", "bellingham", "lynden", "dallas", "mckinney"]);
    expect(MARKETS[1].aliases).toContain("st petersburg");
    expect(leadMarketsOf({ leadMarkets: [{ name: "Nowhere", state: "ZZ" }, { name: "" }, { name: "Austin", state: "Texas", areaCodes: ["512", "x"] }] }))
      .toEqual([{ key: "austin", name: "Austin", state: "TX", aliases: ["austin"], areaCodes: ["512"] }]);
    expect(leadMarketsOf(null)).toEqual([]);
  });
});
