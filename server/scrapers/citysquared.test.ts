import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adapter, { citysquaredTenant, citysquaredDate, citysquaredPublicFields, citysquaredRequest, parseCitysquaredPage, parseCitysquaredRecord, queryCitysquared, listRecentCitysquared } from "./citysquared";
import { politeText, PortalBlockedError } from "./polite-fetch";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeText: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
vi.mock("../storage", () => ({ storage: {} }));
import { getAdapter } from "./registry";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/citysquared/${name}`, import.meta.url), "utf8"));
const ctx: AdapterCtx = { databaseId: 12, databaseName: "Bethel", jurisdiction: "Bethel, CT", searchUrl: "https://www.citysquared.com/#/app/BethelTownCT/landing", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
const fields = citysquaredPublicFields(fixture("bethel-public-fields.json"));
describe("CitySquared recorded public permit responses", () => {
  it("resolves every registered CitySquared label without a database", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
  });
  it("derives tenants from landing and map URL shapes", () => {
    expect(citysquaredTenant(ctx.searchUrl).tenant).toBe("BethelTownCT");
    expect(citysquaredTenant("https://citysquared.com/#/app/map/SimsburyTownCT").tenant).toBe("SimsburyTownCT");
    expect(() => citysquaredTenant("https://citysquared.com.evil.test/#/app/BethelTownCT")).toThrow();
    expect(() => citysquaredTenant("https://citysquared.com/#/app/map")).toThrow();
    expect(() => citysquaredTenant("https://citysquared.com/")).toThrow();
  });
  it("respects tenant-specific public projection", () => {
    expect(fields.has("PermitDate")).toBe(true);
    expect(fields.has("ApplName")).toBe(false);
    expect(citysquaredPublicFields(fixture("charlestown-public-fields.json")).has("ApplName")).toBe(true);
    expect(() => citysquaredRequest(fields, { entity: "Permit", name: "ApplName", operator: "like", value: "Smith" })).toThrow("does not expose");
  });
  it("builds date-filtered keyset pagination and excludes deleted data", () => {
    const body = citysquaredRequest(fields, { entity: "Permit", name: "PermitDate", operator: "greaterthanorequals", value: "2026-10-03" }, 58479);
    expect(body).toMatchObject({ base: "Permit", sort: "Permit.Permit_ID", order: "asc", includeDeleted: false, limit: 100 });
    expect(body.filters).toEqual([{ entity: "Permit", name: "PermitDate", operator: "greaterthanorequals", value: "2026-10-03" }, { name: "Permit_ID", operator: "greaterthan", entity: "Permit", value: 58479 }]);
    expect(body.fields).toContainEqual({ Permit: "Permit_ID" });
    expect(body.fields).not.toContainEqual({ Permit: "ApplName" });
  });
  it("parses real dated permits without inventing contractor identity", () => {
    const page = parseCitysquaredPage(fixture("bethel-recent.json"));
    expect(page.total).toBe(31);
    const row = page.rows[0];
    expect(parseCitysquaredRecord(row, ctx)).toMatchObject({ permitNumber: "M-26-0594", address: "3 PARTRIDGE DRIVE", status: "Permit Issued", issuedAt: "2026-10-07", appliedAt: null, valuation: 3153.25, contractorName: null, permitType: null, raw: row, sourceUrl: "https://www.citysquared.com/#/app/BethelTownCT/entity/Permit/58469" });
  });
  it("verifies the recorded next page actually advances", () => {
    const first = parseCitysquaredPage(fixture("bethel-recent-page1.json"));
    const second = parseCitysquaredPage(fixture("bethel-recent-page2.json"));
    expect(first.rows).toHaveLength(10);
    expect(first.total).toBe(31);
    expect(second.total).toBe(21);
    expect(Number(second.rows[0].Permit_ID)).toBeGreaterThan(Number(first.rows.at(-1)!.Permit_ID));
  });
  it("rejects errors, malformed counts and out-of-order rows", () => {
    expect(() => parseCitysquaredPage({ Error: "Forbidden" })).toThrow();
    const real = fixture("bethel-recent-page1.json");
    expect(() => parseCitysquaredPage({ ...real, Count: 0 })).toThrow();
    expect(() => parseCitysquaredPage({ ...real, Data: [...real.Data].reverse() })).toThrow("not ordered");
  });
  it("executes a recorded paginated response through the HTTP query layer", async () => {
    vi.mocked(politeText).mockResolvedValue(JSON.stringify(fixture("bethel-recent.json")));
    const state = { endpoint: "https://services4.municity5.com/M5Services/M5Service.svc/Customer/BethelTownCT", headers: {}, fields };
    const results = await queryCitysquared(ctx, state, { entity: "Permit", name: "PermitDate", operator: "greaterthanorequals", value: "2026-10-03" });
    expect(results).toHaveLength(31);
    expect(politeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(politeText).mock.calls[0][1]?.body as string)).toMatchObject({ includeDeleted: false, base: "Permit" });
  });
  it("unions issued and applied listings without duplicate alerts and excludes future dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T18:00:00Z"));
    try {
      vi.mocked(politeText).mockResolvedValueOnce(JSON.stringify(fixture("charlestown-issued.json"))).mockResolvedValueOnce(JSON.stringify(fixture("charlestown-applied.json")));
      const state = { endpoint: "https://municity5.com/M5Services/M5Service.svc/Customer/CharlestownTownRI", headers: {}, fields: citysquaredPublicFields(fixture("charlestown-public-fields.json")) };
      const results = await listRecentCitysquared({ ...ctx, searchUrl: "https://citysquared.com/#/app/CharlestownTownRI/landing" }, state, "2026-10-03");
      expect(results).toHaveLength(50);
      expect(new Set(results.map(r => r.raw!.Permit_ID)).size).toBe(50);
      for (const call of vi.mocked(politeText).mock.calls) {
        expect(JSON.parse(call[1]?.body as string).filters).toContainEqual(expect.objectContaining({ operator: "lessthan", value: "2026-10-11" }));
      }
    } finally { vi.useRealTimers(); }
  });
  it("walks both recorded Fairfield pages without losing records", async () => {
    vi.mocked(politeText).mockResolvedValueOnce(JSON.stringify(fixture("fairfield-recent-page1.json"))).mockResolvedValueOnce(JSON.stringify(fixture("fairfield-recent-page2.json")));
    const state = { endpoint: "https://services6.municity5.com/M5Services/M5Service.svc/Customer/FairfieldTownCT", headers: {}, fields: citysquaredPublicFields(fixture("fairfield-public-fields.json")) };
    const results = await queryCitysquared(ctx, state, { entity: "Permit", name: "PermitDate", operator: "greaterthanorequals", value: "2026-10-03" });
    expect(results).toHaveLength(157);
    expect(results[0].address).toBe("LEE DRIVE");
    expect(politeText).toHaveBeenCalledTimes(2);
  });
  it("returns [] for a recorded genuine empty result", async () => {
    vi.mocked(politeText).mockResolvedValue(JSON.stringify(fixture("bethel-empty.json")));
    const state = { endpoint: "https://services4.municity5.com/M5Services/M5Service.svc/Customer/BethelTownCT", headers: {}, fields };
    expect(await queryCitysquared(ctx, state, { entity: "Permit", name: "PermitNo", operator: "like", value: "ConstructHUB-no-such-permit-20261010" })).toEqual([]);
  });
  it("propagates blocked responses and rejects nonadvancing pagination", async () => {
    const state = { endpoint: "https://services4.municity5.com/M5Services/M5Service.svc/Customer/BethelTownCT", headers: {}, fields };
    const filter = { entity: "Permit" as const, name: "PermitDate", operator: "greaterthanorequals", value: "2026-10-03" };
    vi.mocked(politeText).mockRejectedValue(new PortalBlockedError(state.endpoint, 429));
    await expect(queryCitysquared(ctx, state, filter)).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeText).mockResolvedValue('<html><div class="g-recaptcha"></div></html>');
    await expect(queryCitysquared(ctx, state, filter)).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeText).mockResolvedValue(JSON.stringify(fixture("bethel-recent-page1.json")));
    await expect(queryCitysquared(ctx, state, filter)).rejects.toThrow("did not advance");
  });
  it("normalizes local government calendar dates and rejects invalid/sentinel dates", () => {
    expect(citysquaredDate("2026-10-07T00:00:00")).toBe("2026-10-07");
    expect(citysquaredDate("2026-02-30")).toBeNull();
    expect(citysquaredDate("0001-01-01T00:00:00")).toBeNull();
    expect(citysquaredDate(null)).toBeNull();
  });
  it("rejects unsupported search and invalid date inputs before accessing a portal", async () => {
    await expect(adapter.search(ctx, { type: "company", value: "ABC" })).rejects.toThrow("Unsupported");
    await expect(adapter.listRecent(ctx, "not-a-date")).rejects.toThrow("valid ISO");
  });
});
