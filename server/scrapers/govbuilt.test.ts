import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adapter, { govbuiltBase, govbuiltRequest, parseGovbuiltPage, parseGovbuiltRecord } from "./govbuilt";
import { politeJson, politeText, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeJson: vi.fn(), politeText: vi.fn() }));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/govbuilt/${name}`, import.meta.url), "utf8");
const response = JSON.parse(fixture("milan-permit.json"));
const ctx: AdapterCtx = { databaseId: 12, databaseName: "Milan", jurisdiction: "Milan, IL", searchUrl: "https://milanil.govbuilt.com/AdvancedForms", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(politeText).mockResolvedValue(fixture("westwood-search.html")); vi.mocked(politeJson).mockResolvedValue(response); });
describe("GovBuilt recorded public responses", () => {
  it("derives tenant hosts and rejects unrelated URLs", () => {
    expect(govbuiltBase(ctx.searchUrl)).toBe("https://milanil.govbuilt.com");
    expect(() => govbuiltBase("https://govbuilt.com.evil.test")).toThrow();
    expect(() => govbuiltBase("https://user:secret@milanil.govbuilt.com")).toThrow();
  });
  it("builds encoded filters and one-based server pagination without a date cutoff", () => {
    const u = new URL(govbuiltRequest(govbuiltBase(ctx.searchUrl), { type: "address", value: "205 1st & Main" }, 2));
    expect(u.searchParams.get("searchText")).toBe("205 1st & Main");
    expect(u.searchParams.get("filter")).toBe("Address");
    expect(u.searchParams.get("Start")).toBe("2");
    expect(u.searchParams.get("days")).toBe("0");
    expect(u.searchParams.get("contentType")).toBe("case");
    expect(() => govbuiltRequest(u.origin, { type: "company", value: "ABC" })).toThrow();
  });
  it("keeps ambiguous names and creation dates out of contractor and issue fields", () => {
    const row = parseGovbuiltPage(response).rows[0];
    const r = parseGovbuiltRecord(row, ctx)!;
    expect(r).toMatchObject({ permitNumber: "BP-2026-0119", address: "205 1st Ave W, Milan, IL 61264", status: "Permit Issued", lat: 41.453419351696, contractorName: null, applicantName: null, issuedAt: null, appliedAt: null, sourceUrl: null, databaseId: 12 });
    expect(r.raw).toBe(row);
  });
  it("does not accept error objects as empty searches", () => {
    expect(() => parseGovbuiltPage({ error: "login" })).toThrow();
    expect(() => parseGovbuiltPage({ data: [], recordsFiltered: "unknown" })).toThrow();
  });
  it("performs public page check followed by the recorded JSON search", async () => {
    const records = await adapter.search(ctx, { type: "permit", value: "BP-2026-0119" });
    expect(records).toHaveLength(1);
    expect(politeJson).toHaveBeenCalledWith(expect.stringContaining("filter=ReferenceNumber"), undefined, { minDelayMs: 1000 });
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("propagates blocks and refuses unsupported tenant pages", async () => {
    vi.mocked(politeJson).mockRejectedValue(new PortalBlockedError(ctx.searchUrl, 403));
    await expect(adapter.search(ctx, { type: "address", value: "205" })).rejects.toBeInstanceOf(PortalBlockedError);
    vi.mocked(politeText).mockResolvedValue("<html>Unavailable</html>");
    await expect(adapter.search(ctx, { type: "address", value: "205" })).rejects.toThrow("no supported public");
  });
  it("refuses truncated and repeated pagination instead of partial success", async () => {
    vi.mocked(politeJson).mockResolvedValue({ ...response, recordsFiltered: 2 });
    await expect(adapter.search(ctx, { type: "address", value: "205" })).rejects.toThrow("repeated");
    vi.mocked(politeJson).mockResolvedValue({ ...response, data: [], recordsFiltered: 1 });
    await expect(adapter.search(ctx, { type: "address", value: "205" })).rejects.toThrow("before the reported total");
  });
  it("does not emulate issued/applied-date listing with a creation-date query", async () => {
    expect(adapter.capabilities.listRecent).toBe(false);
    expect(await adapter.listRecent(ctx, "2026-10-03")).toEqual([]);
    expect(politeJson).not.toHaveBeenCalled();
  });
});
