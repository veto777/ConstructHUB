/** Codex round-3 audit, decisions 8–11 (identifier identity, discipline on merge, notes that travel, Socrata kinds). */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { addressMatch, addressQueryKey, parseAddress, streetKey } from "./identifiers";
import { crossReference, idKey, LicenseSet, mergeDiscipline, searchCustomerIds, type LicenseFinder } from "./xref";

vi.mock("./http", async (orig) => ({ ...(await orig<typeof import("./http")>()), politeFetch: vi.fn() }));
import * as http from "./http";
import { nameSearchable, searchLicenses, withPeople, type LicenseSource } from "./licenses";

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "FL", source: "Board A", sourceUrl: "https://example.test/a", businessName: "ACME ELECTRIC LLC", licenseNumber: "EC100",
  licenseType: "Electrical Contractor", specialty: null, status: "Current", principal: null, city: null, expires: null, matchedOn: "business", ...o,
});

describe("decision 8: address query identity", () => {
  it("keeps units and states apart", () => {
    expect(idKey({ type: "address", value: "123 Main St Suite 1, Tampa FL 33602" })).not.toBe(idKey({ type: "address", value: "123 Main St Suite 2, Tampa FL 33602" }));
    expect(idKey({ type: "address", value: "123 Main St, Springfield IL" })).not.toBe(idKey({ type: "address", value: "123 Main St, Springfield MO" }));
    expect(idKey({ type: "address", value: "123 Main Street, Tampa, FL 33602" })).toBe(idKey({ type: "address", value: "123 MAIN ST, TAMPA FL 33602" }));
    expect(streetKey("123 Main St Ste 4, Tampa FL")).toBe("123 MAIN ST #4");
    expect(addressQueryKey("123 Main St, Springfield IL")).toBe("a:123 MAIN ST|SPRINGFIELD|IL|");
  });

  it("searches two units separately and says when two addresses are one search", async () => {
    const calls: string[] = [];
    const f: LicenseFinder = { state: "FL", label: "Fake", byId: async (q) => { calls.push(q.value); return { licenses: [], enforcement: [] }; } };
    const r = await searchCustomerIds([f], [
      { type: "address", value: "123 Main St Suite 1, Tampa FL 33602" },
      { type: "address", value: "123 Main St Suite 2, Tampa FL 33602" },
      { type: "address", value: "123 Main Street Suite 1, Tampa, FL 33602" },
    ], { name: "Acme", kind: "company" });
    expect(calls).toEqual(["123 Main St Suite 1, Tampa FL 33602", "123 Main St Suite 2, Tampa FL 33602"]);
    expect(r.notes.join(" ")).toMatch(/123 Main Street Suite 1.*same address as address 123 Main St Suite 1.*searched once/);
  });

  it("keeps the whole street name when there is no suffix", () => {
    expect(parseAddress("123 Lake View")?.name).toEqual(["LAKE", "VIEW"]);
    expect(parseAddress("123 Broadway Springfield IL 62701")?.name).toEqual(["BROADWAY", "SPRINGFIELD"]);
    expect(addressMatch("123 Lake View 89501", "123 Lake Forest Rd, Reno NV 89501")).toBeNull();
    expect(addressMatch("123 Lake View 89501", "123 Lake View, Reno NV 89501")).toBe("possible");
    expect(addressMatch("123 Broadway Springfield IL 62701", "123 Broadway, Springfield IL 62701")).toBe("possible");
  });
});

describe("decision 10: merge keeps discipline from both copies", () => {
  it("adds a later copy's discipline, labeled with its source, each text once", () => {
    const set = new LicenseSet();
    set.add(lic({}));
    set.add(lic({ source: "Board A", discipline: "Fined $500 on 2024-01-02" }));
    set.add(lic({ source: "Board A", discipline: "fined $500 on 2024-01-02" }));
    expect(set.list).toHaveLength(1);
    expect(set.list[0].discipline).toBe("Fined $500 on 2024-01-02");
    expect(mergeDiscipline({ source: "A", discipline: "Probation" }, { source: "B", discipline: "Probation\nRevoked 2020" })).toBe("Probation\n[B] Revoked 2020");
  });
});

describe("decision 11: notes travel on success", () => {
  it("a capped related-enforcement search keeps its note", async () => {
    const own = new LicenseSet();
    own.add(lic({ people: [{ name: "JANE DOE", role: "Qualifier" }] }));
    const f: LicenseFinder = {
      state: "FL", label: "Fake",
      byName: async (name) => ({ hits: name === "JANE DOE" ? [lic({ licenseNumber: "EC200", businessName: "BRIGHT SOLAR INC", people: [{ name: "JANE DOE", role: "Qualifier" }] })] : [], searched: true, note: "" }),
    };
    const r = await crossReference({
      subject: { name: "Acme Electric", kind: "company" }, own, finders: [f], searchedIds: new Set(), idSearchesUsed: 25,
      enforcementSearch: async () => ({ hits: [] as EnforcementHit[], sources: [{ source: "FL stop-work orders", scope: "FL", searched: true, note: "0 record(s) (showing the first 500 index matches; there are more)" }] }),
    });
    expect(r.notes.join(" ")).toMatch(/For BRIGHT SOLAR INC, incomplete: FL stop-work orders: .*showing the first 500/);
  });
});

const fetchMock = http.politeFetch as unknown as ReturnType<typeof vi.fn>;
const json = (rows: unknown[]) => new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
afterEach(() => fetchMock.mockReset());

const SRC: LicenseSource = {
  state: "WA", source: "Test", datasetUrl: "https://example.test/d/x", url: "https://example.test/resource/x.json",
  fields: { businessName: "biz", licenseNumber: "lic", licenseType: null, specialty: null, status: null, principal: null, city: null, expires: null },
  personField: null,
  peopleFrom: [
    { url: "https://example.test/resource/p.json", licenseField: "lic", nameField: "who", role: "Principal" },
    { url: "https://example.test/resource/s.json", licenseField: "lic", nameField: "who", role: "Authorized signer" },
  ],
} as LicenseSource;

describe("decision 11: withPeople says what it left out", () => {
  it("a failed people lookup and a capped one are noted", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/p.json")) return new Response("oops", { status: 500 });
      return json(Array.from({ length: 1000 }, (_, i) => ({ lic: "L1", who: `PERSON ${i}` })));
    });
    const out = await withPeople(SRC, [lic({ licenseNumber: "L1" })]);
    expect((out as { note?: string }).note).toMatch(/officers list incomplete: the principal list could not be read/);
    expect((out as { note?: string }).note).toMatch(/officers list incomplete: authorized signer list showing the first 1000/);
  });
});

describe("decision 9: a Socrata source without the field is not searched", () => {
  it("makes no request for a person search with no person field", async () => {
    expect(nameSearchable(SRC, "person")).toBe(false);
    expect(nameSearchable(SRC, "company")).toBe(true);
    expect(nameSearchable({ ...SRC, fields: { ...SRC.fields, businessName: null } } as LicenseSource, "company")).toBe(false);
    expect(await searchLicenses(SRC, "Jane Doe", "person")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
