import { describe, expect, it } from "vitest";
import { vtRosterHit } from "./vt";

// Column names of the OPR roster .xlsx (2026-10-15); values below are placeholders for the layout, not records.
describe("VT OPR rosters (audit 2026-10-15)", () => {
  const row = { LicenseNumber: "0001", "First Name": "A", "Last Name": "B", "AddressLine 1": "1 X St", City: "Montpelier", State: "VT", ZipCode: "05602", Status: "Active" };
  it("an individual keeps city, state and ZIP only, with no address key", () => {
    const h = vtRosterHit(row, { type: "Residential Contractor - Individual" })!;
    expect(h.hit.address).toBe("Montpelier, VT, 05602");
    expect(h.keys).toEqual({ licenses: ["0001"] });
  });
  it("a business keeps its street address and key", () => {
    const h = vtRosterHit({ ...row, BusinessName: "B Builders LLC" }, { type: "Residential Contractor - Business", business: true })!;
    expect(h.hit.address).toBe("1 X St, Montpelier, VT, 05602");
    expect(h.keys?.addresses).toEqual(["1 X St, Montpelier, VT, 05602"]);
  });
});

describe("VT OPR rosters (audit round 2)", () => {
  const row = { LicenseNumber: "0001", "First Name": "A", "Last Name": "B", City: "Montpelier", State: "VT", ZipCode: "05602", Status: "Disciplined" };
  it("a 'Disciplined' status leaves the license; the holder follows the roster type; each roster is a component (decisions 1, 2, 10)", () => {
    const ind = vtRosterHit(row, { type: "Residential Contractor - Individual" })!;
    expect(ind.hit).toMatchObject({ status: null, holder: "individual", discipline: "OPR roster status: Disciplined" });
    expect(ind.component).toBe("Residential Contractor - Individual");
    const biz = vtRosterHit({ ...row, Status: "Active", BusinessName: "B Builders LLC" }, { type: "Residential Contractor - Business", business: true })!;
    expect(biz.hit).toMatchObject({ status: "Active", holder: "business" });
    expect(biz.hit.discipline).toBeUndefined();
  });
  it("the browser page goes through the guard: robots.txt-disallowed requests are aborted, a 403 stops the load (decision 6)", async () => {
    const { vi } = await import("vitest");
    const { guardPage } = await import("./vt");
    const { resetHostState, hostBlocked, PortalBlockedError } = await import("../http");
    resetHostState();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("User-agent: *\nDisallow: /private/\n", { status: 200 }));
    try {
      let handler: any, onResponse: any;
      const page = { route: async (_p: string, h: any) => { handler = h; }, on: (_e: string, h: any) => { onResponse = h; } };
      const check = await guardPage(page);
      const route = (url: string) => { const r = { request: () => ({ url: () => url }), abort: vi.fn(), continue: vi.fn() }; return r; };
      const ok = route("https://vt.example.test/public/page"), no = route("https://vt.example.test/private/file.xlsx");
      await handler(ok); await handler(no);
      expect(ok.continue).toHaveBeenCalled();
      expect(no.abort).toHaveBeenCalled();
      expect(() => check()).not.toThrow();
      onResponse({ url: () => "https://vt.example.test/public/x", status: () => 403, headers: () => ({}) });
      expect(() => check()).toThrow(PortalBlockedError);
      expect(hostBlocked("https://vt.example.test/anything")).not.toBeNull();
      const after = route("https://vt.example.test/public/page2");
      await handler(after);
      expect(after.abort).toHaveBeenCalled();
    } finally { spy.mockRestore(); resetHostState(); }
  });
});
