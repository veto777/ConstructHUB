import { afterEach, describe, expect, it, vi } from "vitest";
import { edoplDay, edoplForm, edoplHit, edoplNameHits, edoplQuery, edoplTable, idSosHit, idSosResults, pack } from "./id";
import { noteOf } from "../notes";

describe("Idaho Secretary of State", () => {
  it("reads a search row; forfeited is adverse", () => {
    // Rows from a live sosbiz.idaho.gov businesssearch answer, 2026-10-15.
    const row = { TITLE: ["BOISE ROOFING LLC (556603)", "Limited Liability Company (D)"], RECORD_NUM: "0000556603", FILING_DATE: "05/31/2017", STATUS: "Active-Existing", STANDING: "Good Standing" };
    expect(idSosHit(row)).toMatchObject({ name: "BOISE ROOFING LLC", id: "0000556603", date: "2017-05-31", status: "Secretary of State status: Active-Existing, standing: Good Standing", detail: "Limited Liability Company (D)", adverse: null });
    expect(idSosHit({ ...row, STATUS: "Inactive-Forfeited" }).adverse).toBe(true);
  });
  it("an answer without rows is an error, not zero matches; a full page says so (audit 2026-10-15)", () => {
    expect(() => idSosResults("Boise Roofing", { message: "An error has occurred." })).toThrow(/unexpected payload/);
    expect(() => idSosResults("Boise Roofing", null)).toThrow(/unexpected payload/);
    expect(idSosResults("Boise Roofing", { template: [], rows: {} })).toEqual([]);
    const row = { TITLE: ["BOISE ROOFING LLC (556603)"], RECORD_NUM: "0000556603", STATUS: "Active-Existing" };
    const full = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [String(i), row]));
    expect(noteOf(idSosResults("Boise Roofing", { rows: full }))).toMatch(/first 500/);
    expect(noteOf(idSosResults("Boise Roofing", { rows: { a: row } }))).toBeNull();
  });
});

// Trimmed from live eDOPL answers (edopl.idaho.gov/OnlineServices, Public License Individual Search), 2026-10-15:
// the form the Load answer draws (field tags and the two captions), and the results tables of a name search for
// "BOISE ROOFING", a name search for "JOHN SMITH" (3 of its 32 rows) and a license-number search for "RCE-41390".
const FORM = `<label id="lb_Dd-r" for="Dd-r"><span id="caption2_Dd-r" >License Number</span>
<label id="lb_Dd-11" for="Dd-11"><span id="caption2_Dd-11" >Name (individual, business, DBA)</span>
<input type="text" name="Dd-h"  id="Dd-h" value=""  >
<input type="text" name="Dd-i"  id="Dd-i" value=""  >
<input type="text" name="Dd-r"  id="Dd-r" value=""    maxlength="25">
<select name="Dd-s"  id="Dd-s"  >
<select name="Dd-t"  id="Dd-t" disabled="disabled"  >
<select name="Dd-u"  id="Dd-u" disabled="disabled"  >
<select name="Dd-v"  id="Dd-v"  >
<input type="text" name="Dd-w"  id="Dd-w" data-fi='["datepicker"]' value=""  >
<input type="text" name="Dd-x"  id="Dd-x" data-fi='["datepicker"]' value=""  >
<input type="text" name="Dd-11"  id="Dd-11" value=""    maxlength="128">
<button type="button" id="Dc-d" data-name="Dc-d" tabindex="0" data-linkid="Dc-d" data-event="LinkClick"><span id="caption2_Dc-d" >Search</span></button>
<button type="button" id="Dc-e" data-name="Dc-e" tabindex="0" data-linkid="Dc-e" disabled="disabled" data-event="LinkClick"><span id="caption2_Dc-e" >Back</span></button>`;
const ROOFING = `<table id="Df-g" class="DocTable DocTableNormal" data-fast-rowcount="2"><colgroup><col data-cap="License Number"><col data-cap="Type"><col data-cap="Name"><col data-cap="DBA"><col data-cap="Status"><col data-cap="Expiration"><col data-cap="Discipline"></colgroup><tbody><tr data-row="1"><td><span><a>RCE-60381</a></span></td><td>General Contractor Registration</td><td>BOISE ROOF REPAIR &amp; MAINTENANCE LLC</td><td>BOISE ROOF REPAIR &amp; MAINTENANCE LLC</td><td>Active</td><td>29-Nov-2027</td><td>No</td></tr><tr data-row="2"><td><span><a>RCE-41390</a></span></td><td>General Contractor Registration</td><td>BOISES BEST ROOFING &amp; CONSTRUCTION LLC</td><td>BOISES BEST ROOFING &amp; CONSTRUCTION LLC</td><td>Revoked</td><td>01-Mar-2018</td><td>Yes</td></tr></tbody></table>`;
const SMITH = `<table id="Df-g" class="DocTable DocTableNormal" data-fast-rowcount="32"><colgroup><col data-cap="License Number"><col data-cap="Type"><col data-cap="Name"><col data-cap="DBA"><col data-cap="Status"><col data-cap="Expiration"><col data-cap="Discipline"></colgroup><tbody><tr data-row="1"><td><span><a>034342</a></span></td><td>Electrical Apprentice Registration</td><td> JASON JOHN SMITH</td><td></td><td>Expired</td><td>30-Apr-2023</td><td>No</td></tr><tr data-row="2"><td><span><a>6871264</a></span></td><td>Barber License</td><td>ABINADI JOHN SMITH</td><td></td><td>Active</td><td>26-Sep-2027</td><td>No</td></tr><tr data-row="10"><td><span><a>6081620</a></span></td><td>Plumbing Apprentice Registration</td><td>PRESTON JOHN SMITH</td><td></td><td>Active</td><td>31-Jul-2031</td><td>No</td></tr></tbody></table>`;
const BY_LICENSE = `<table id="Df-g" class="DocTable DocTableNormal" data-fast-rowcount="4"><colgroup><col data-cap="License Number"><col data-cap="Type"><col data-cap="Name"><col data-cap="DBA"><col data-cap="Status"><col data-cap="Expiration"><col data-cap="Discipline"></colgroup><tbody><tr data-row="1"><td><span><a>RCE-41390</a></span></td><td>General Contractor Registration</td><td>BOISES BEST ROOFING &amp; CONSTRUCTION LLC</td><td>BOISES BEST ROOFING &amp; CONSTRUCTION LLC</td><td>Revoked</td><td>01-Mar-2018</td><td>Yes</td></tr><tr data-row="2"><td><span><a>41390</a></span></td><td>Registered Nurse License</td><td>CAVANAGH, DANIEL P</td><td></td><td>Lapsed</td><td>31-Aug-2021</td><td>No</td></tr></tbody></table>`;

describe("Idaho DOPL eDOPL license search", () => {
  it("reads the search form: its fields, the name and license-number fields and the Search button", () => {
    expect(edoplForm(FORM)).toEqual({ fields: ["Dd-h", "Dd-i", "Dd-r", "Dd-s", "Dd-t", "Dd-u", "Dd-v", "Dd-w", "Dd-x", "Dd-11"], nameField: "Dd-11", licenseField: "Dd-r", searchEvent: "Dc-d" });
    expect(() => edoplForm("<div>Service unavailable</div>")).toThrow(/unexpected search form/);
  });
  it("reads the results table by its own captions; \"No results returned\" is zero rows, any other page an error", () => {
    const t = edoplTable(ROOFING);
    expect(t.tableId).toBe("Df-g");
    expect(t.total).toBe(2);
    expect(t.rows[1]).toEqual({ license: "RCE-41390", type: "General Contractor Registration", name: "BOISES BEST ROOFING & CONSTRUCTION LLC", dba: "BOISES BEST ROOFING & CONSTRUCTION LLC", status: "Revoked", expires: "2018-03-01", discipline: "Yes" });
    expect(edoplTable('<div class="DocText">No results returned</div>')).toEqual({ tableId: "", total: 0, rows: [] });
    expect(() => edoplTable("<html>An error has occurred.</html>")).toThrow(/unexpected page/);
    expect(edoplDay("29-Nov-2027")).toBe("2027-11-29");
    expect(edoplDay("31-Feb-2027")).toBeNull();
  });
  it("a contractor registration under a business name is the business's; its Discipline: Yes is kept for the runner", () => {
    const [ok, revoked] = edoplTable(ROOFING).rows.map((r) => edoplHit(r, "business")!);
    expect(ok).toMatchObject({ state: "ID", businessName: "BOISE ROOF REPAIR & MAINTENANCE LLC", licenseNumber: "RCE-60381", licenseType: "General Contractor Registration", status: "Active", expires: "2027-11-29", principal: null, holder: "business", discipline: null, city: null });
    expect(revoked).toMatchObject({ status: "Revoked", holder: "business" });
    expect(revoked.discipline).toMatch(/Discipline: Yes/);
  });
  it("keeps the construction boards' licenses only; an apprentice card is the person's own", () => {
    const rows = edoplTable(SMITH).rows;
    expect(rows.map((r) => edoplHit(r, "principal")?.licenseType ?? null)).toEqual(["Electrical Apprentice Registration", null, "Plumbing Apprentice Registration"]);
    expect(edoplHit(rows[0], "principal")).toMatchObject({ principal: "JASON JOHN SMITH", businessName: null, holder: "individual", people: [{ name: "JASON JOHN SMITH", role: "Electrical Apprentice Registration" }] });
    // A contractor registration in a person's own name: a sole proprietor, holder unknown.
    expect(edoplHit({ ...rows[0], type: "General Contractor Registration", dba: "SMITH HOMES" }, "principal")).toMatchObject({ principal: "JASON JOHN SMITH", businessName: "SMITH HOMES", holder: null });
  });
  it("keeps the rows the searched name names, and says when DOPL had more rows than were read", () => {
    const { rows, total } = edoplTable(SMITH);
    const hits = edoplNameHits("John Smith", "person", rows, total);
    expect(hits.map((h) => h.licenseNumber)).toEqual(["034342", "6081620"]);
    expect(noteOf(hits)).toMatch(/first 3 of 32/);
    const roof = edoplTable(ROOFING);
    expect(edoplNameHits("Boise Roofing", "company", roof.rows, roof.total)).toEqual([]);
    expect(edoplNameHits("Boise Roof Repair & Maintenance, LLC", "company", roof.rows, roof.total).map((h) => h.licenseNumber)).toEqual(["RCE-60381"]);
    expect(noteOf(edoplNameHits("Boise Roof Repair & Maintenance", "company", roof.rows, roof.total))).toBeNull();
    expect(edoplQuery("Boise Roof Repair & Maintenance, L.L.C.")).toBe("BOISE ROOF REPAIR & MAINTENANCE");
  });

  describe("the live flow (mocked)", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("opens the session, chains FAST's version token, searches by license number and keeps exact numbers only", async () => {
      const { resetHostState } = await import("../http");
      resetHostState();
      const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
      vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit = {}) => {
        const url = String(u);
        calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: String(init.body ?? "") });
        if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
        if (url.endsWith("?link=PubSearch")) return new Response("", { status: 302, headers: { location: ".?link=PubSearch&Check=1", "set-cookie": "wlb-tap-token=abc; path=/OnlineServices/" } });
        if (url.endsWith("&Check=1")) return new Response("", { status: 302, headers: { location: "_/" } });
        if (url.endsWith("/_/")) return new Response("<script>FWDC.setVerLast('1.AAA', 'HTML: _');</script>", { status: 200, headers: { "fast-ver-last": "1.AAA" } });
        if (url.includes("Load=1")) return new Response(JSON.stringify({ contents: [{ pagetitle: "Online Services" }, { manager: FORM }] }), { status: 200, headers: { "fast-ver-last": "2.BBB" } });
        if (url.endsWith("/_/EventOccurred")) return new Response(JSON.stringify({ result: 0, html: BY_LICENSE }), { status: 200, headers: { "fast-ver-last": "3.CCC" } });
        // Page 2 of the 4 rows (the fixture keeps 2): an empty page ends the reading.
        if (url.endsWith("/_/SelectTablePage")) return new Response(JSON.stringify({ result: 0, html: BY_LICENSE.replace(/<tbody>[\s\S]*<\/tbody>/, "<tbody></tbody>") }), { status: 200, headers: { "fast-ver-last": "4.DDD" } });
        return new Response("not found", { status: 404 });
      }));
      try {
        const live = pack.liveLicenses!.find((s) => /eDOPL/.test(s.source))!;
        expect(await live.searchBy!({ type: "phone", value: "208 555 0100" })).toBeNull();
        const hits = await live.searchBy!({ type: "license", value: "RCE-41390" });
        // The nurse's license 41390 (another board, another number) is not the searched license.
        expect(hits!.map((h) => [h.licenseNumber, h.businessName, h.matchedOn])).toEqual([["RCE-41390", "BOISES BEST ROOFING & CONSTRUCTION LLC", "license"]]);
        const load = calls.find((c) => c.url.includes("Load=1"))!;
        expect(new URL(load.url).searchParams.get("FAST_VERLAST__")).toBe("1.AAA");
        expect(load.headers.get("cookie")).toContain("wlb-tap-token=abc");
        const post = calls.find((c) => c.url.endsWith("/_/EventOccurred"))!;
        const body = new URLSearchParams(post.body);
        expect(body.get("Dd-r")).toBe("RCE-41390");
        expect(body.get("Dd-11")).toBe("");
        expect(body.get("EVENT__")).toBe("Dc-d");
        expect(body.get("FAST_VERLAST__")).toBe("2.BBB");
        for (const c of calls.filter((c) => !c.url.endsWith("/robots.txt"))) {
          expect(c.headers.get("user-agent")).toMatch(/ConstructHUB-PermitBot/);
          expect(c.headers.has("x-requested-with")).toBe(false);
          expect(c.headers.has("fast-xhr")).toBe(false);
        }
        expect(post.headers.has("referer")).toBe(false);
        const page = new URLSearchParams(calls.find((c) => c.url.endsWith("/_/SelectTablePage"))!.body);
        expect([page.get("TABLE_VIEW__"), page.get("TABLE_PAGE__"), page.get("FAST_VERLAST__")]).toEqual(["Df-g", "2", "3.CCC"]);
      } finally { vi.unstubAllGlobals(); resetHostState(); }
    });
  });
});
