import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterCtx } from "./types";
vi.mock("./polite-fetch", async importOriginal => ({ ...await importOriginal<typeof import("./polite-fetch")>(), politeJson: vi.fn() }));
import { politeJson, PortalBlockedError } from "./polite-fetch";
import adapter, { mgoJurisdiction, mgoSearchRequiresLogin } from "./mgo-connect";
const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/mgo-connect/${file}`, import.meta.url), "utf8"));
const ctx: AdapterCtx = { databaseId: 1, databaseName: "East Lyme", jurisdiction: "East Lyme, CT", searchUrl: "https://www.mgoconnect.org/cp?JID=489", portalUrl: null, browser: vi.fn(), log: vi.fn(), politeness: { minDelayMs: 1000 } };
beforeEach(() => vi.resetAllMocks());
describe("MGO Connect public-access diagnostics", () => {
  it("derives the JID without guessing a tenant from generic links", () => {
    expect(mgoJurisdiction(ctx.searchUrl)).toBe(489);
    expect(mgoJurisdiction("http://mgoconnect.org/cp/portal?jid=418")).toBe(418);
    for (const url of ["https://www.mgoconnect.org/cp/portal", "https://www.mgoconnect.org/auth/login", "https://www.mypermitnow.org/login.aspx", "https://mgoconnect.org.evil.test/cp?JID=489", "https://mgoconnect.org/cp?JID=489&jid=418"]) expect(() => mgoJurisdiction(url)).toThrow();
  });
  it.each(["east-lyme-menu.json", "live-oak-menu.json", "bay-saint-louis-menu.json"])("recognizes the recorded login requirement: %s", file => {
    expect(mgoSearchRequiresLogin(fixture(file))).toBe(true);
  });
  it("reports an explicit block without calling a login or protected record API", async () => {
    vi.mocked(politeJson).mockResolvedValueOnce(fixture("east-lyme-menu.json"));
    await expect(adapter.search(ctx, { type: "address", value: "100 Main St" })).rejects.toMatchObject({ name: "PortalBlockedError", status: 401 });
    expect(politeJson).toHaveBeenCalledExactlyOnceWith("https://api.mgoconnect.org/cp/GetJurisdictionMenu/489", {}, { minDelayMs: 1000 });
    expect(ctx.browser).not.toHaveBeenCalled();
  });
  it("rejects recorded authorization errors and malformed menus", () => {
    expect(() => mgoSearchRequiresLogin(fixture("unauthorized-search.json"))).toThrow();
    expect(() => mgoSearchRequiresLogin([])).toThrow("does not expose");
    expect(() => mgoSearchRequiresLogin([null])).toThrow();
  });
  it("propagates network blocks and advertises no unverified capabilities", async () => {
    vi.mocked(politeJson).mockRejectedValueOnce(new PortalBlockedError(ctx.searchUrl, 403));
    await expect(adapter.search(ctx, { type: "permit", value: "123" })).rejects.toMatchObject({ status: 403 });
    expect(adapter.capabilities).toEqual({ search: [], listRecent: false, detail: false });
    expect(await adapter.listRecent(ctx, "2026-10-03")).toEqual([]);
    expect(politeJson).toHaveBeenCalledTimes(1);
  });
});
