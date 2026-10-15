import { describe, expect, it, vi } from "vitest";

// arcgisAll's requests, answered by the test (no network).
const answers: ((url: string, body: string) => unknown)[] = [];
vi.mock("../../http", () => ({
  sleep: async () => undefined,
  politeFetch: async (url: string, init: RequestInit = {}) => {
    const body = answers[0](url, String(init.body ?? ""));
    return { ok: true, status: 200, json: async () => body };
  },
}));
import { addressLine, arcgisAll, fullName, isoDay } from "./local-fetch";

describe("local-fetch helpers", () => {
  it("reads the date forms city portals publish", () => {
    expect(isoDay("2027-02-28T00:00:00.000")).toBe("2027-02-28");
    expect(isoDay("01/05/26")).toBeNull(); // two-digit year: no guessed century (audit 2026-10-15)
    expect(isoDay("13/40/2018")).toBeNull();
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

describe("arcgisAll (audit 2026-10-15)", () => {
  const meta = { objectIdField: "OBJECTID", maxRecordCount: 2 };
  const drain = async (it: AsyncIterable<unknown>) => { const out: unknown[] = []; for await (const x of it) out.push(x); return out; };
  it("stops with an error when a server ignores resultOffset and repeats the first page", async () => {
    answers[0] = (url) => (url.endsWith("?f=json") ? meta : { features: [{ attributes: { OBJECTID: 1 } }, { attributes: { OBJECTID: 2 } }], exceededTransferLimit: true });
    await expect(drain(arcgisAll("https://example.test/FeatureServer/0"))).rejects.toThrow(/repeated the page/);
  });
  it("stops with an error past the row cap instead of looping", async () => {
    let n = 0;
    answers[0] = (url) => (url.endsWith("?f=json") ? meta : { features: [{ attributes: { OBJECTID: ++n } }, { attributes: { OBJECTID: ++n } }], exceededTransferLimit: true });
    await expect(drain(arcgisAll("https://example.test/FeatureServer/0", "1=1", "*", 2000, { maxRows: 6 }))).rejects.toThrow(/more than 6 rows/);
  });
  it("reads every page and reports the real object-id field", async () => {
    let oid = "";
    answers[0] = (url, body) => url.endsWith("?f=json") ? { fields: [{ name: "ObjectId", type: "esriFieldTypeOID" }], maxRecordCount: 2 }
      : /resultOffset=0/.test(body) ? { features: [{ attributes: { ObjectId: 1 } }, { attributes: { ObjectId: 2 } }], exceededTransferLimit: true }
      : { features: [{ attributes: { ObjectId: 3 } }] };
    expect(await drain(arcgisAll("https://example.test/FeatureServer/0", "1=1", "*", 2000, { onMeta: (m) => { oid = m.oid; } }))).toHaveLength(3);
    expect(oid).toBe("ObjectId");
  });
  it("refuses a layer that names no object-id field", async () => {
    answers[0] = () => ({ fields: [{ name: "A", type: "esriFieldTypeString" }] });
    await expect(drain(arcgisAll("https://example.test/FeatureServer/0"))).rejects.toThrow(/no object-id field/);
  });
});
