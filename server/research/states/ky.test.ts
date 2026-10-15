import { describe, expect, it } from "vitest";
import { parseKyGrid } from "./ky";

// A snippet of the dhbc.ky.gov licensee grid saved 2026-10-15.
const GRID = `<table class="Grid" id="MainContent_grdData"><tr><th scope="col">&nbsp;</th><th scope="col">License Type</th></tr><tr>
<td style="width:150px;"><a href="HBC_Lic_Details.aspx?id=576689">Smith, Louis C </a></td><td>Master Plumber</td><td>L C Smith Plumbing &amp; Heating Co Inc</td><td>M5846</td><td>Active</td><td>3/23/2011</td><td>3/31/2027</td></tr></table>`;

describe("Kentucky HBC grid", () => {
  it("reads a licensee row", () => {
    expect(parseKyGrid(GRID)).toEqual([{ id: "576689", name: "Smith, Louis C", person: "Smith, Louis C", type: "Master Plumber", dba: "L C Smith Plumbing & Heating Co Inc", number: "M5846", status: "Active", issued: "2011-03-23", expires: "2027-03-31" }]);
  });
});

describe("KY capped searches (audit 2026-10-15)", () => {
  it("a division still at the 50-row cap after the active-only search is reported, not silently dropped", async () => {
    const { kyRows } = await import("./ky");
    const row = (i: number) => ({ id: String(i), name: `ROW ${i}`, type: "T", dba: null, number: String(i), status: "Active", issued: null, expires: null });
    const fifty = (o: number) => Array.from({ length: 50 }, (_, i) => row(o + i));
    const r = await kyRows("SMITH", async (_n, d = "0", status = "") => (d === "0" ? fifty(0) : d === "49" ? fifty(status ? 2000 : 1000) : []));
    expect(r.note).toMatch(/division 49: even its active licenses reach/);
    const ok = await kyRows("SMITH", async () => [row(1)]);
    expect(ok.note).toBeNull();
  });
  it("searchBy is null for a phone or address", async () => {
    const { searchKyHbcBy } = await import("./ky");
    expect(await searchKyHbcBy({ type: "phone", value: "(502) 573-0365" })).toBeNull();
  });
});

describe("Kentucky round-2 audit (2026-10-16)", () => {
  it("the license type decides the holder (decision 2)", async () => {
    const { kyHolder } = await import("./ky");
    expect(kyHolder("Master Plumber")).toBe("individual");
    expect(kyHolder("Electrical Contractor - Business")).toBe("business");
    expect(kyHolder("HVAC Master Contractor")).toBe("individual");
    expect(kyHolder("Fire Sprinkler Contractor")).toBe("business");
    expect(kyHolder(null)).toBeNull();
  });
});
