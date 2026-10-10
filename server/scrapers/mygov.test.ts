import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
vi.mock("../storage", () => ({ storage: {} }));
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import adapter, { assertMyGovPage, myGovTenant, parseMyGovLocations, parseMyGovModules, parseMyGovProjects } from "./mygov";
const fixture = (file: string) => readFileSync(new URL(`./fixtures/mygov/${file}`, import.meta.url), "utf8");
const json = (file: string) => JSON.parse(fixture(file));
const ctx: AdapterCtx = { databaseId: 17, databaseName: "Crowley", jurisdiction: "Crowley, TX", searchUrl: "https://public.mygov.us/crowley_tx", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 5 } };
const fetchMock = vi.mocked(politeFetch);
function response(file: string, cookie?: string) { return new Response(fixture(file), { headers: cookie ? { "set-cookie": cookie } : {} }); }
function happyPath() {
  fetchMock.mockResolvedValueOnce(response("crowley-lookup.html", "PHPSESSID=test-session; Path=/; HttpOnly"))
    .mockResolvedValueOnce(response("crowley-412-locations.json"))
    .mockResolvedValueOnce(response("crowley-modules.json"))
    .mockResolvedValueOnce(response("crowley-projects.json"));
}
beforeEach(() => vi.resetAllMocks());
describe("MyGov recorded public lookup", () => {
  it("registers every target label with the correct vendor and disables alerts", async () => {
    const { getAdapter, supportsAlerts } = await import("./registry");
    for (const label of ["MyGov", "MyGov Permits & Licenses", "MyGov public portal", "MyGov permits"]) {
      expect(getAdapter(label.toUpperCase())).toBe(adapter);
      expect(supportsAlerts(label)).toBe(false);
    }
    for (const label of ["MGO Connect", "MyGovernmentOnline (MGO Connect)", "MyGovernmentOnline (MGO)"]) {
      expect(getAdapter(label)?.platform).toBe("MGO Connect");
      expect(supportsAlerts(label)).toBe(false);
    }
  });
  it("derives arbitrary tenant paths and refuses unrelated/legacy URLs", () => {
    expect(myGovTenant("http://public.mygov.us/wi_wisconsin_rapids/templates?module=pi")).toBe("https://public.mygov.us/wi_wisconsin_rapids");
    for (const url of ["https://public.mygov.us.evil.test/crowley_tx", "https://app.mygov.us/create_login_next.php?cityid=845", "https://public.mygov.us/", "https://user@public.mygov.us/crowley_tx"]) expect(() => myGovTenant(url)).toThrow();
  });
  it("preserves the real project JSON and does not reinterpret creation/completion as issue/application dates", () => {
    const data = json("crowley-projects.json");
    const rows = parseMyGovProjects(data, "412 E Main St, Crowley, TX 76036", ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ permitNumber: "24-000750", databaseId: 17, jurisdiction: "Crowley, TX", status: "Archived", issuedAt: null, appliedAt: null, sourceUrl: null, contractorName: null });
    expect(rows[0].raw).toBe(data.projects[0]);
    expect(parseMyGovProjects(json("russell-empty-projects.json"), "", ctx)).toEqual([]);
  });
  it("replays the public session and address/module/project requests", async () => {
    happyPath();
    expect(await adapter.search(ctx, { type: "address", value: "412 E Main" })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const calls = fetchMock.mock.calls;
    expect(calls[1][0]).toBe(`${ctx.searchUrl}/getLookupResults`);
    expect(String(calls[1][1]?.body)).toBe("address_search=412+E+Main");
    expect(new Headers(calls[1][1]?.headers).get("Cookie")).toBe("PHPSESSID=test-session");
    expect(String(calls[3][1]?.body)).toBe("location_id=8378&module=pi");
    expect(calls.every(call => call[2]?.minDelayMs === 1000)).toBe(true);
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("returns no permits for the recorded Barling location with zero public projects", async () => {
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html"))
      .mockResolvedValueOnce(response("barling-main-locations.json"))
      .mockResolvedValueOnce(response("barling-modules.json"));
    expect(await adapter.search(ctx, { type: "address", value: "Main" })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("refuses broad results instead of silently truncating or crawling the town", async () => {
    expect(parseMyGovLocations(json("crowley-main-locations.json")).length).toBeGreaterThan(50);
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html")).mockResolvedValueOnce(response("crowley-main-locations.json"));
    await expect(adapter.search(ctx, { type: "address", value: "Main" })).rejects.toThrow("more specific address");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("throws for malformed/error payloads and missing permit identifiers", () => {
    expect(() => parseMyGovLocations({ error: "unavailable" })).toThrow();
    expect(() => parseMyGovModules({})).toThrow();
    expect(() => parseMyGovProjects({}, "", ctx)).toThrow();
    const data = json("crowley-projects.json");
    delete data.projects[0].code_id;
    expect(() => parseMyGovProjects(data, "", ctx)).toThrow();
    expect(() => assertMyGovPage("<title>Verify you are human</title>", ctx.searchUrl)).toThrow(PortalBlockedError);
    expect(() => assertMyGovPage("<title>Login</title>", ctx.searchUrl)).toThrow();
  });
  it("propagates blocks and incomplete responses rather than returning zero results", async () => {
    fetchMock.mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 429));
    await expect(adapter.search(ctx, { type: "address", value: "412 E Main" })).rejects.toMatchObject({ status: 429 });
    fetchMock.mockResolvedValueOnce(response("crowley-lookup.html"))
      .mockResolvedValueOnce(response("crowley-412-locations.json"))
      .mockResolvedValueOnce(response("crowley-modules.json"))
      .mockResolvedValueOnce(response("russell-empty-projects.json"));
    await expect(adapter.search(ctx, { type: "address", value: "412 E Main" })).rejects.toThrow("incomplete");
  });
  it("does not search by unsupported fields or simulate recent permits", async () => {
    expect(adapter.capabilities).toEqual({ search: ["address"], listRecent: false, detail: false });
    await expect(adapter.search(ctx, { type: "permit", value: "24-000750" })).rejects.toThrow("does not support");
    await expect(adapter.search(ctx, { type: "company", value: "Smith" })).rejects.toThrow("does not support");
    expect(await adapter.listRecent(ctx, "2026-10-03")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
