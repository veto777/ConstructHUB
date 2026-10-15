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
  it("the browser page goes through the full guard: robots.txt, redirect targets, a 403 stops the load (round 3, decision 5)", async () => {
    const { vi } = await import("vitest");
    const { guardPage } = await import("./vt");
    const { resetHostState, hostBlocked, PortalBlockedError } = await import("../http");
    resetHostState();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("User-agent: *\nDisallow: /private/\n", { status: 200 }));
    try {
      let handler: any, onResponse: any;
      const page = { route: async (_p: string, h: any) => { handler = h; }, on: (_e: string, h: any) => { onResponse = h; } };
      const check = await guardPage(page);
      const answers: Record<string, { status: number; headers: Record<string, string> }> = {
        "https://vt.example.test/public/page": { status: 200, headers: {} },
        "https://vt.example.test/public/moved": { status: 302, headers: { location: "/private/file.xlsx" } },
      };
      const route = (url: string, type = "document") => ({
        request: () => ({ url: () => url, resourceType: () => type }),
        fetch: vi.fn(async () => { const a = answers[url] ?? { status: 200, headers: {} }; return { status: () => a.status, headers: () => a.headers }; }),
        fulfill: vi.fn(async () => undefined), abort: vi.fn(async () => undefined), continue: vi.fn(async () => undefined),
      });
      const ok = route("https://vt.example.test/public/page"), no = route("https://vt.example.test/private/file.xlsx");
      const moved = route("https://vt.example.test/public/moved"), img = route("https://vt.example.test/public/logo.png", "image");
      await handler(ok); await handler(no); await handler(moved); await handler(img);
      expect(ok.fetch).toHaveBeenCalled();
      expect(ok.fulfill).toHaveBeenCalled();
      expect(no.fetch).not.toHaveBeenCalled();
      expect(no.abort).toHaveBeenCalled();
      // A redirect to a disallowed path is stopped before the browser follows it.
      expect(moved.fulfill).not.toHaveBeenCalled();
      expect(moved.abort).toHaveBeenCalled();
      // A style, script or image is fetched here too (its redirects guarded hop by hop), not handed to the browser.
      expect(img.fetch).toHaveBeenCalled();
      expect(img.continue).not.toHaveBeenCalled();
      expect(() => check()).toThrow(PortalBlockedError); // robots.txt refusals of page loads stop the load too
      onResponse({ url: () => "https://vt.example.test/public/x", status: () => 403, headers: () => ({}) });
      expect(hostBlocked("https://vt.example.test/anything")).not.toBeNull();
      const after = route("https://vt.example.test/public/page2");
      await handler(after);
      expect(after.fetch).not.toHaveBeenCalled();
      expect(after.abort).toHaveBeenCalled();
    } finally { spy.mockRestore(); resetHostState(); }
  }, 20_000);
});
