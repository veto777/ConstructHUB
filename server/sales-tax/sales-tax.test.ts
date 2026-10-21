/**
 * Official sales-tax rate tables — the pure pieces: city-name matching, the
 * WA DOR file parser (offline fixture in the DOR's own format), row picking,
 * the bundled file, and the construction-treatment table's integrity.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cityKey } from "./city-key";
import { parseCsv, toPct, titleCase } from "./fetch-util";
import { parseWaCsv, parseWaPeriod } from "./sources/wa";
import { pickCityRow, contentHash, packResult, unpackResult, type BundledSalesTaxFile } from "./store";
import { pctToBps, quarterLabel } from "./types";
import { parseWaAddressXml } from "./wa-address";
import { CONSTRUCTION_TAX_TREATMENT, constructionTaxTreatment } from "@shared/construction-tax-treatment";

// Lines exactly as WA DOR publishes them in lsu-quarterly-tax-rates.csv (Q4 2026).
const WA_CSV = `"Rate change",County,"Location name","Location code","Local rate","State rate","Combined sales tax"
No,Whatcom,Bellingham,"""3701""",""".0270""",""".0650""",""".0920"""
No,Whatcom,Ferndale,"""3704""",""".0260""",""".0650""",""".0910"""
No,Whatcom,"Lummi Nation - Bellingham","""3713""",""".0270""",""".0650""",""".0920"""
No,Whatcom,"Whatcom County Unincorp. Areas","""3700""",""".0180""",""".0650""",""".0830"""
No,Whatcom,"Whatcom County Unincorp. PTBA","""3737""",""".0240""",""".0650""",""".0890"""
No,King,Seattle,"""1726""",""".0385""",""".0650""",""".1035"""
`;

describe("cityKey", () => {
  it("matches the spellings an address uses against the state's names", () => {
    expect(cityKey("Bellingham")).toBe("bellingham");
    expect(cityKey("  BELLINGHAM ")).toBe("bellingham");
    expect(cityKey("St. Louis")).toBe(cityKey("Saint Louis"));
    expect(cityKey("Mount Vernon")).toBe(cityKey("Mt. Vernon"));
    expect(cityKey("Sedro-Woolley")).toBe(cityKey("Sedro Woolley"));
    expect(cityKey("City of Ferndale")).toBe("ferndale");
    expect(cityKey("Coeur d'Alene")).toBe(cityKey("Coeur dAlene"));
  });
});

describe("WA DOR quarterly file", () => {
  it("reads the effective quarter from the rate table page", () => {
    const html = `<div class="view-header"><p><strong>Quarter 4 - Effective October 1 through December 31, 2026</strong></p></div>`;
    expect(parseWaPeriod(html)).toEqual({ effectiveDate: "2026-10-01", periodLabel: "Q4 2026" });
    expect(parseWaPeriod("<p>no period here</p>")).toBeNull();
  });

  it("parses every location with its combined rate and kind", () => {
    const rows = parseWaCsv(WA_CSV, "2026-10-01");
    expect(rows).toHaveLength(6);
    const by = (n: string) => rows.find((r) => r.city === n || r.locationCode === n)!;
    expect(by("Bellingham")).toMatchObject({ state: "WA", county: "Whatcom", locationCode: "3701", kind: "city", ratePct: 9.2 });
    expect(by("Ferndale")).toMatchObject({ locationCode: "3704", kind: "city", ratePct: 9.1 });
    expect(by("Seattle").ratePct).toBe(10.35);
    expect(by("3700")).toMatchObject({ city: null, county: "Whatcom", kind: "unincorporated", ratePct: 8.3 });
    expect(by("3737").kind).toBe("special");
    expect(by("3713").kind).toBe("special");
  });

  it("refuses a file whose columns moved", () => {
    expect(() => parseWaCsv(`County,Name,Rate\nWhatcom,Bellingham,.092\n`, "2026-10-01")).toThrow(/column/);
  });
});

describe("WA DOR address lookup answer", () => {
  // WA DOR's answer for 4783 Bayshore Dr, Blaine 98230 (Forrest Hild's address), 2026-10-21.
  const FORREST = `<?xml version="1.0" encoding="utf-8"?><response loccode="3737" localrate=".024" rate=".089" code="2" xmlns=""><addressline code="3737" street="BAYSHORE DR" househigh="4783" houselow="4783" evenodd="O" state="WA" zip="98230" plus4="6501" period="Q42026" rta="N" ptba="Whatcom PTBA" cez="" /><rate name="WHATCOM PTBA" code="3737" staterate=".065" localrate=".024" /></response>`;
  it("a Blaine mailing address in unincorporated Whatcom PTBA → location 3737 at 8.9%", () => {
    expect(parseWaAddressXml(FORREST)).toEqual({ locationCode: "3737", ratePct: 8.9, periodLabel: "Q4 2026", resultCode: 2 });
  });
  it("ZIP-only, not-found and error answers are not used (a ZIP spans jurisdictions)", () => {
    expect(parseWaAddressXml(FORREST.replace('code="2"', 'code="5"'))).toBeNull();
    expect(parseWaAddressXml(`<response loccode="-1" localrate="-1" rate="-1" code="6" />`)).toBeNull();
    expect(parseWaAddressXml("<html>error</html>")).toBeNull();
  });
});

describe("helpers", () => {
  it("parse CSV quotes, percent text and basis points", () => {
    expect(parseCsv(`a,"b ""q""",c\r\n1,2,3\n`)).toEqual([["a", 'b "q"', "c"], ["1", "2", "3"]]);
    expect(toPct(".0920", true)).toBe(9.2);
    expect(toPct("8.875%", false)).toBe(8.875);
    expect(pctToBps(9.2)).toBe(920);
    expect(pctToBps(8.875)).toBe(888);
    expect(quarterLabel("2026-10-01")).toBe("Q4 2026");
    expect(titleCase("SEDRO-WOOLLEY")).toBe("Sedro-Woolley");
  });
});

describe("pickCityRow", () => {
  const row = (rate_bps: number, extra: Partial<{ zip: string | null; kind: string; county: string | null }> = {}) =>
    ({ zip: null, kind: "city", county: null, rate_bps, ...extra });

  it("one rate → that row, not flagged", () => {
    expect(pickCityRow([row(920)])).toEqual({ row: row(920), varies: false });
    expect(pickCityRow([])).toBeNull();
  });
  it("a ZIP or county match narrows a multi-rate city", () => {
    const rows = [row(825, { zip: "75001", county: "Dallas" }), row(800, { zip: "75002", county: "Collin" })];
    expect(pickCityRow(rows, "75002-1234")).toEqual({ row: rows[1], varies: false });
    expect(pickCityRow(rows, null, "Dallas County")).toEqual({ row: rows[0], varies: false });
  });
  it("prefers the plain city row over a district with the same name", () => {
    expect(pickCityRow([row(900, { kind: "special" }), row(920)])).toEqual({ row: row(920), varies: false });
  });
  it("still several rates → the most common (ties: higher), flagged", () => {
    expect(pickCityRow([row(800), row(825), row(800)])).toMatchObject({ row: { rate_bps: 800 }, varies: true });
    expect(pickCityRow([row(800), row(825)])).toMatchObject({ row: { rate_bps: 825 }, varies: true });
  });
});

describe("bundled server/data/sales-tax-rates.json", () => {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data", "sales-tax-rates.json"), "utf8")) as BundledSalesTaxFile;

  it("holds every WA DOR location, Bellingham and Ferndale included", () => {
    const wa = unpackResult(file.states.find((s) => s.state === "WA")!);
    expect(wa.sourceName).toBe("WA DOR");
    expect(wa.sourceUrl).toMatch(/^https:\/\/dor\.wa\.gov\//);
    expect(wa.rows.length).toBeGreaterThan(350);
    expect(new Set(wa.rows.filter((r) => r.kind === "unincorporated").map((r) => r.county)).size).toBe(39); // every WA county
    for (const r of wa.rows) {
      expect(r.ratePct).toBeGreaterThanOrEqual(6.5); // WA state rate is the floor
      expect(r.ratePct).toBeLessThan(11.5);
      expect(r.effectiveDate).toBe(wa.effectiveDate);
    }
    expect(wa.rows.find((r) => r.city === "Bellingham")).toBeTruthy();
    expect(wa.rows.find((r) => r.city === "Ferndale")).toBeTruthy();
  });

  it("every state entry is well-formed and round-trips", () => {
    for (const s of file.states) {
      expect(s.state).toMatch(/^[A-Z]{2}$/);
      expect(s.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.sourceUrl).toMatch(/^https?:\/\//);
      const r = unpackResult(s);
      expect(contentHash(unpackResult(packResult(r)))).toBe(contentHash(r));
    }
  });
});

describe("construction tax treatment", () => {
  it("covers all 50 states + DC, each with an official citation and a checked date", () => {
    const codes = CONSTRUCTION_TAX_TREATMENT.map((t) => t.state);
    expect(new Set(codes).size).toBe(51);
    expect(codes).toContain("DC");
    for (const t of CONSTRUCTION_TAX_TREATMENT) {
      expect(["taxable", "not_taxable", "depends"]).toContain(t.treatment);
      expect(t.dependsOn.length > 0).toBe(t.treatment === "depends");
      expect(t.citation.url).toMatch(/^https:\/\//);
      expect(t.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.shortRule.length).toBeGreaterThan(5);
    }
  });
  it("owner's examples: WA taxable, FL not, TX depends on the job", () => {
    expect(constructionTaxTreatment("wa")?.treatment).toBe("taxable");
    expect(constructionTaxTreatment("FL")?.treatment).toBe("not_taxable");
    expect(constructionTaxTreatment("TX")).toMatchObject({ treatment: "depends" });
    expect(constructionTaxTreatment("TX")!.dependsOn).toContain("residential_vs_commercial");
    for (const s of ["OR", "NH", "MT", "DE"]) expect(constructionTaxTreatment(s)?.treatment).toBe("not_taxable");
    expect(constructionTaxTreatment("ZZ")).toBeNull();
  });
});
