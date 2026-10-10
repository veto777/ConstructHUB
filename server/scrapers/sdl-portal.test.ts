import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adapter, { parseSdlResults, sdlSearchUrl, sdlTenantUrl } from "./sdl-portal";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import { getAdapter } from "./registry";
vi.mock("../storage", () => ({ storage: {} }));
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeFetch: vi.fn() }));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/sdl-portal/${name}`, import.meta.url), "utf8");
const base = "https://www.sdlportal.com/towns/nj/monmouth/hazlettwp";
const ctx: AdapterCtx = { databaseId: 8, databaseName: "Hazlet", jurisdiction: "Hazlet, NJ", searchUrl: base + "/search?st=permit", portalUrl: null, browser: async () => { throw new Error("No browser"); }, log: () => {}, politeness: { minDelayMs: 1 } };
const mock = vi.mocked(politeFetch);
const response = (name: string) => new Response(fixture(name));
beforeEach(() => mock.mockReset());

describe("SDL public search", () => {
  it("derives towns from search, request, form, and encoded login URLs", () => {
    for (const path of ["", "/search?st=permit", "/requests/inspection", "/forms/abc?wf=1"]) expect(sdlTenantUrl(base + path)).toBe(base);
    expect(sdlTenantUrl("https://www.sdlportal.com/login?redirect=" + encodeURIComponent(base))).toBe(base);
    expect(sdlTenantUrl(base.replace("https:", "http:"))).toBe(base);
    for (const url of ["https://www.egovlink.com/newprovidence/action.asp", "https://sdl.town/Linwood", "https://www.sdlportal.com/login?redirect=https://evil.com/towns/nj/a/b", "https://www.sdlportal.com/", "https://www.sdlportal.com:8080/towns/nj/a/b"]) expect(() => sdlTenantUrl(url)).toThrow();
  });
  it("builds advanced address, permit, and keyword searches", () => {
    expect(new URL(sdlSearchUrl(base, { type: "address", value: "17 CROMAN COURT" })).searchParams.get("loc")).toBe("17 CROMAN COURT");
    expect(new URL(sdlSearchUrl(base, { type: "permit", value: "2026-0685" })).searchParams.get("pc")).toBe("2026-0685");
    expect(new URL(sdlSearchUrl(base, { type: "keyword", value: "solar" })).searchParams.get("kw")).toBe("solar");
    expect(() => sdlSearchUrl(base, { type: "company", value: "test" })).toThrow();
  });
  it("maps real rows and preserves their exact source HTML", () => {
    const html = fixture("hazlet-nj-search-address-1.txt");
    const result = parseSdlResults(html, ctx, base);
    expect(result.truncated).toBe(false); expect(result.records).toHaveLength(4);
    expect(result.records[0]).toMatchObject({ permitNumber: "2026-0685", address: "17 CROMAN COURT", status: "Open", issuedAt: "2026-10-05", contractorName: null, appliedAt: null });
    expect(result.records[0].sourceUrl).toBe(base + "/building/permits/C-26-00800");
    expect(html).toContain(result.records[0].raw?.html);
  });
  it("distinguishes genuine no results, truncated results, login walls, and server errors", () => {
    expect(parseSdlResults(fixture("hazlet-main.html"), ctx, base).records).toEqual([]);
    expect(parseSdlResults(fixture("hazlet-middle.html"), ctx, base).truncated).toBe(true);
    expect(() => parseSdlResults(fixture("raritan.html"), ctx, base)).toThrow(PortalBlockedError);
    expect(() => parseSdlResults(fixture("springlake.html"), ctx, base)).toThrow(PortalBlockedError);
    expect(() => parseSdlResults(fixture("hazlet-main.json"), ctx, base)).toThrow("no recognized");
  });
  it("never substitutes application control numbers for absent permit numbers", () => {
    const result = parseSdlResults(fixture("hazlet-middle.html"), ctx, base);
    expect(result.records.every(r => !r.permitNumber.startsWith("C-"))).toBe(true);
    expect(result.records.some(r => r.permitNumber === "2026-0623")).toBe(true);
  });
  it("parses another tenant without hardcoded jurisdiction data", () => {
    const c = { ...ctx, jurisdiction: "Monmouth Beach, NJ" };
    const records = parseSdlResults(fixture("monmouth-beach-nj-search-address-1.txt"), c, "https://www.sdlportal.com/towns/nj/monmouth/monmouthbeach").records;
    expect(records).toHaveLength(31); expect(records[0]).toMatchObject({ permitNumber: "260155", jurisdiction: "Monmouth Beach, NJ", address: "11 OCEAN AVENUE" });
  });
});

describe("SDL adapter offline HTTP", () => {
  it("registers supported SDL labels, excluding mislabeled and unresolved portals", () => {
    for (const label of [adapter.platform, ...adapter.aliases!]) expect(getAdapter(label.toUpperCase())).toBe(adapter);
    expect(getAdapter("SDL Portal (Building Department Online)")).toBeNull();
  });
  it("returns recorded permit search results", async () => {
    mock.mockResolvedValueOnce(response("hazlet-nj-search-permit-1.txt"));
    const records = await adapter.search(ctx, { type: "permit", value: "2026-0685" });
    expect(records).toHaveLength(1);
    expect(new URL(mock.mock.calls[0][0]).searchParams.get("pc")).toBe("2026-0685");
    expect(mock.mock.calls[0][2]?.minDelayMs).toBe(1000);
  });
  it("throws for capped searches and redirects to login", async () => {
    mock.mockResolvedValueOnce(response("hazlet-middle.html"));
    await expect(adapter.search(ctx, { type: "address", value: "Middle" })).rejects.toThrow("100-result");
    mock.mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "/login?redirect=" + encodeURIComponent(base) } }));
    await expect(adapter.search(ctx, { type: "permit", value: "2026" })).rejects.toBeInstanceOf(PortalBlockedError);
    mock.mockRejectedValueOnce(new PortalBlockedError(base, 403));
    await expect(adapter.search(ctx, { type: "permit", value: "2026" })).rejects.toBeInstanceOf(PortalBlockedError);
  });
  it("returns issue-date-filtered records and rejects ignored date filters", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));
    try {
      mock.mockResolvedValueOnce(response("hazlet-nj-recent-2026-10-03-1.txt"));
      expect(await adapter.listRecent(ctx, "2026-10-03")).toHaveLength(10);
      expect(new URL(mock.mock.calls[0][0]).searchParams.get("psd")).toBe(String(Date.parse("2026-10-03") / 1000 - 86400));
      mock.mockResolvedValueOnce(response("hazlet-nj-recent-2026-10-03-1.txt"));
      await expect(adapter.listRecent(ctx, "2026-10-09")).rejects.toThrow("did not honor");
    } finally { vi.useRealTimers(); }
  });
  it("includes all four real permits on a single day despite timestamp boundaries", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-05T20:00:00Z"));
    try {
      mock.mockResolvedValueOnce(response("hazlet-padded-day-2026-10-05.html"));
      const records = await adapter.listRecent(ctx, "2026-10-05");
      expect(records).toHaveLength(4);
      expect(records.every(r => r.issuedAt === "2026-10-05")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("partitions capped date listings and fails if one day is still capped", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T17:00:00Z"));
    try {
      mock.mockResolvedValueOnce(response("hazlet-middle.html")).mockResolvedValueOnce(response("hazlet-main.html")).mockResolvedValueOnce(response("hazlet-main.html"));
      expect(await adapter.listRecent(ctx, "2026-10-09")).toEqual([]);
      expect(mock).toHaveBeenCalledTimes(3);
      const first = new URL(mock.mock.calls[1][0]).searchParams, second = new URL(mock.mock.calls[2][0]).searchParams;
      expect(Number(first.get("ped")) - Number(first.get("psd"))).toBe(3 * 86400); expect(Number(second.get("ped")) - Number(second.get("psd"))).toBe(3 * 86400);
      expect(Number(second.get("psd")) - Number(first.get("psd"))).toBe(86400);
      mock.mockResolvedValueOnce(response("hazlet-middle.html"));
      await expect(adapter.listRecent(ctx, "2026-10-10")).rejects.toThrow("more than 100 results");
    } finally { vi.useRealTimers(); }
  });
  it("rejects invalid dates and unsupported searches without HTTP", async () => {
    await expect(adapter.listRecent(ctx, "yesterday")).rejects.toThrow("Invalid since");
    await expect(adapter.search(ctx, { type: "license", value: "123" })).rejects.toThrow("does not support");
    expect(mock).not.toHaveBeenCalled();
  });
});
