import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./polite-fetch", async () => ({ ...await vi.importActual<typeof import("./polite-fetch")>("./polite-fetch"), politeFetch: vi.fn(), politeJson: vi.fn() }));
vi.mock("../scraper", () => ({ scrapeByPlatform: vi.fn() }));
import adapter, { govpilotUrl, parseGovpilotConfig, govpilotSearchRequest, parseGovpilotResults } from "./govpilot";
import { politeFetch, politeJson, PortalBlockedError } from "./polite-fetch";
import { getAdapter } from "./registry";
import type { AdapterCtx } from "./types";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/govpilot/${name}`, import.meta.url), "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const url = "https://main.govpilot.com/web/public/23ab5fde-290_Construction-Permit-Township-of-Cranbury?uid=7199&ust=NJ&pu=1&id=0";
const ctx: AdapterCtx = { databaseId: 72, databaseName: "Cranbury", jurisdiction: "Cranbury, NJ", searchUrl: url, portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1500 } };
beforeEach(() => vi.resetAllMocks());

describe("GovPilot public lookup", () => {
  it("derives the agency and module from the real public form", () => {
    expect(parseGovpilotConfig(fixture("cranbury-form.html"), url)).toEqual({ uid: "7199", tid: "dcee8,1" });
    const request = govpilotSearchRequest({ uid: "7199", tid: "dcee8,1" }, "23 NORTH MAIN");
    expect(request.url).toBe("https://api-main.govpilot.com/api/v1/lookup/address/module-search");
    expect(JSON.parse(request.init.body as string)).toMatchObject({ uid: "7199", tid: "dcee8,1", q: "23 NORTH MAIN" });
  });
  it("parses 1,764 actual permits, omitting 23 historical control-only rows", () => {
    const p = json("cranbury-main.json"); const records = parseGovpilotResults(p, ctx);
    expect(p.data).toHaveLength(1787); expect(records).toHaveLength(1764);
    expect(records[0]).toMatchObject({ permitNumber: "24-015_1", address: "23 NORTH MAIN STREET", description: "(UPDATE) PHASE 1B, 1C, 1D ASBESTOS REMOVAL", issuedAt: null, status: null, contractorName: null, sourceUrl: null });
    expect(records[0].raw).toEqual(p.data[0]);
    expect(records.every(r => r.permitNumber !== (r.raw as any)?.ID)).toBe(true);
  });
  it("parses distinct tenant fixtures and a genuine empty response", () => {
    expect(parseGovpilotResults(json("maplewood-address-1.json"), ctx)).toHaveLength(8);
    expect(parseGovpilotResults(json("avalon-address-1.json"), ctx)).toHaveLength(22);
    expect(parseGovpilotResults(json("cranbury-empty-1.json"), ctx)).toEqual([]);
    const p = json("cranbury-main.json");
    p.data = p.data.filter((r: { FADDRESS: string }) => !r.FADDRESS.includes("PRMT NO:"));
    expect(() => parseGovpilotResults(p, ctx)).toThrow("only control-number rows");
  });
  it("calls only read-only lookup operations and retains requested politeness", async () => {
    vi.mocked(politeFetch).mockResolvedValue(new Response(fixture("cranbury-form.html")));
    vi.mocked(politeJson).mockResolvedValue(json("cranbury-main.json"));
    expect(await adapter.search(ctx, { type: "address", value: "Main" })).toHaveLength(1764);
    expect(politeJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(politeJson).mock.calls[0][2]).toEqual({ minDelayMs: 1500 });
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("rejects the actual Columbine application form before any lookup", async () => {
    vi.mocked(politeFetch).mockResolvedValue(new Response(fixture("columbine-application.html")));
    await expect(adapter.search(ctx, { type: "permit", value: "24-085" })).rejects.toThrow("no public existing-permit lookup");
    expect(politeJson).not.toHaveBeenCalled();
  });
  it("propagates blocked HTTP instead of returning empty results", async () => {
    vi.mocked(politeFetch).mockRejectedValue(new PortalBlockedError(url, 429));
    await expect(adapter.search(ctx, { type: "address", value: "Main" })).rejects.toMatchObject({ status: 429 });
  });
  it("rejects missing/error schemas and malformed record summaries", () => {
    expect(() => parseGovpilotResults({ success: false, data: [] }, ctx)).toThrow();
    expect(() => parseGovpilotResults({}, ctx)).toThrow();
    const p = json("cranbury-main.json"); delete p.data[0].FADDRESS;
    expect(() => parseGovpilotResults(p, ctx)).toThrow("no display address");
  });
  it("does not mistake application forms, maps or another host for a supported portal", () => {
    expect(() => govpilotUrl("https://map.govpilot.com/map/NJ/bradleybeach")).toThrow();
    expect(() => govpilotUrl("https://example.com/web/public/test?uid=7199")).toThrow();
    expect(() => govpilotUrl(url.replace("uid=7199", "uid="))).toThrow();
  });
  it("does not emulate hourly date listings or unsupported contractor queries", async () => {
    expect(await adapter.listRecent(ctx, "2026-10-03T00:00:00Z")).toEqual([]);
    expect(adapter.capabilities.listRecent).toBe(false);
    await expect(adapter.search(ctx, { type: "company", value: "contractor" })).rejects.toThrow("does not support");
    await expect(adapter.search(ctx, { type: "permit", value: "24" })).rejects.toThrow("four characters");
    expect(politeFetch).not.toHaveBeenCalled(); expect(politeJson).not.toHaveBeenCalled();
  });
  it("validates all 13 recorded tenant configurations and their aliases", () => {
    const forms = json("form-survey.json").filter((r: { fixture?: string }) => r.fixture);
    expect(forms).toHaveLength(13);
    for (const form of forms) {
      expect(parseGovpilotConfig(fixture(form.fixture), form.url).tid).toBe(form.lookup.replace("ADDSEL=", ""));
      expect(getAdapter(form.platform)).toBe(adapter);
    }
  });
  it("registers every label observed on the 13 supported public-lookup forms", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
    expect(getAdapter("GovPilot (Construction Permit Application)")).not.toBe(adapter);
  });
});
