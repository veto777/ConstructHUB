import { describe, expect, it } from "vitest";
import { boliAddresses, spItems, wcInsurer } from "./or";
import { businessParts } from "./lib/g8-common";

describe("OR BOLI", () => {
  it("splits the List of Ineligibles' rich-text address field into addresses", () => {
    // From the Debarments list item "A1 Dumptruck Services LLC" (2026-10-15).
    const html = '<div class="ExternalClass818EB121740C4F8CB969E30CCDE7627E">703 N Hayden Meadows Dr., #206<div>Portland, OR 97213</div><div><br></div><div>731 N Hayden Meadows Dr., #206</div><div>Portland, OR 97217</div><div><br></div><div>2408 NE ​​164th Avenue</div><div>Vancouver, WA 98684<br></div></div>';
    expect(boliAddresses(html)).toEqual(["703 N Hayden Meadows Dr., #206 Portland, OR 97213", "731 N Hayden Meadows Dr., #206 Portland, OR 97217", "2408 NE 164th Avenue Vancouver, WA 98684"]);
  });
});

describe("OR DCBS workers' comp insurer", () => {
  // Rows of q9zj-c8r2 read 2026-10-15. DCBS: a missing record_origin means the employer is self-insured.
  it("names the insurer, and says self-insured only where DCBS's code says so", () => {
    expect(wcInsurer({ legal_business_name: "TRINITY STAFFING GROUP", insurer_name: "CAROLINA CASUALTY INSURANCE COMPANY", record_origin: "PC1" }))
      .toBe("Insurer: CAROLINA CASUALTY INSURANCE COMPANY");
    expect(wcInsurer({ legal_business_name: "KNIGHT TRANSPORTATION INC", insurer_name: "KNIGHT TRANSPORTATION, INC." }))
      .toBe("Insurer: KNIGHT TRANSPORTATION, INC. (self-insured, per DCBS's record-origin code)");
  });
  it("never turns a missing insurer into \"Self-insured\"", () => {
    expect(wcInsurer({ legal_business_name: "TRINITY STAFFING GROUP" })).toBeNull();
    expect(wcInsurer({ legal_business_name: "TRINITY STAFFING GROUP", record_origin: "PC1" })).toBeNull();
  });
});

describe("OR BOLI SharePoint paging", () => {
  it("follows odata.nextLink to the end instead of stopping at $top", async () => {
    const first = "https://www.oregon.gov/boli/employers/_api/web/GetList('x')/items?$top=1";
    const second = "https://www.oregon.gov/boli/employers/_api/web/GetList('x')/items?%24skiptoken=Paged%3dTRUE%26p_ID%3d1&$top=1";
    const pages: Record<string, any> = { [first]: { value: [{ Id: 1 }], "odata.nextLink": second }, [second]: { value: [{ Id: 2 }] } };
    expect((await spItems(first, async (u) => pages[u])).map((r) => r.Id)).toEqual([1, 2]);
  });
  it("throws when a page repeats", async () => {
    const u = "https://www.oregon.gov/boli/employers/_api/web/GetList('x')/items?$top=1";
    await expect(spItems(u, async () => ({ value: [{ Id: 1 }], "odata.nextLink": u }))).rejects.toThrow(/did not end/);
  });
});

describe("g8 businessParts", () => {
  it("keeps \"& Sons\" and \"and Sons\" businesses whole", () => {
    expect(businessParts("Smith & Sons")).toEqual(["Smith & Sons"]);
    expect(businessParts("Smith and Sons")).toEqual(["Smith and Sons"]);
  });
  it("treats a surname that is also a trade word as a person (decision 5)", () => {
    expect(businessParts("David Power")).toEqual([]);
    expect(businessParts("Joe Mason")).toEqual([]);
    expect(businessParts("John and Mary Smith")).toEqual([]);
  });
});
