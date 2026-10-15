/**
 * Regression tests for the bulk-file fixes of the round-4 Codex audit (2026-10-15): decision 3 (legacy license
 * holders), decision 4 (FL respondents and DBAs) and decision 11 (a stored row-shape version).
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { baselineOf, nextBaseline, readRow, readStored, shortfall, HOLDER_VERSION, PAYLOAD_VERSION, type BulkHit } from "./bulk";
import { cslbHolder, flDbaOf, flDisciplineCases, flLegacyComplaint, flRespondent, flComplaintRows } from "./bulk-sources";
import { looksLikeBusiness, looksLikeBusinessTrailingSuffix } from "./states/lib/business-name";
import { vaLegacyHolder } from "./states/va";
import { ALL_BULK_SOURCES } from "./registry";

const bulkSources = () => ALL_BULK_SOURCES;

const lic = (o: Partial<LicenseHit>): LicenseHit => ({
  state: "CA", source: "Test board", sourceUrl: "https://example.test", businessName: "SMITH JOHN", licenseNumber: "1", licenseType: "Contractor license",
  specialty: null, status: null, principal: "JOHN SMITH", city: "FRESNO", expires: null, matchedOn: "business", ...o,
});
const enf = (o: Partial<EnforcementHit>): EnforcementHit => ({
  state: "FL", source: "Test complaints", sourceUrl: "https://example.test", category: "complaint", name: null, id: "1", date: null, endDate: null,
  status: null, city: "TAMPA", detail: null, amount: null, adverse: null, ...o,
});

describe("decision 3: a legacy license row doesn't keep the holder it was stored with", () => {
  const stale = lic({ holder: "business", address: "12 Home Ln, Fresno CA 93701", phone: "5595550100", status: "Disciplined", discipline: "Probation 2019" });
  it("a version-2 row with a stale business holder is read as unknown: city/ZIP only, no phone, standing words only, no discipline", () => {
    const r = readRow({}, { k: "license", h: stale, v: 2 })!;
    expect(r.hit).toMatchObject({ holder: null, address: "FRESNO CA 93701", phone: null, status: null });
    expect((r.hit as LicenseHit).discipline).toBeUndefined();
    // A row with no version at all (before round 3) is the same.
    expect(readRow({}, { k: "license", h: stale })!.hit).toMatchObject({ holder: null, phone: null });
    // A row stored under today's holder rules keeps its holder.
    expect(readRow({}, { k: "license", h: stale, v: HOLDER_VERSION })!.hit).toMatchObject({ holder: "business", phone: "5595550100" });
  });
  it("its phone and address keys no longer match unless today's rule makes it a business's", () => {
    expect(readStored({}, { k: "license", h: stale, v: 2 })!.keysSafe).toBe(false);
    expect(readStored({}, { k: "license", h: stale, v: PAYLOAD_VERSION })!.keysSafe).toBe(true);
    expect(readStored({}, { k: "license", h: { ...stale, holder: "individual" }, v: PAYLOAD_VERSION })!.keysSafe).toBe(false);
  });
  it("a source's legacyHolder recomputes from the stored publisher fields", () => {
    const cslb = bulkSources().find((s) => s.id === "ca-cslb")!;
    expect(cslb.legacyHolder!(lic({ licenseType: "Contractor license (Sole Owner)" }))).toBe("individual");
    expect(cslb.legacyHolder!(lic({ licenseType: "Contractor license (Corporation)" }))).toBe(cslbHolder("Corporation"));
    expect(cslb.legacyHolder!(lic({ licenseType: "Contractor license" }))).toBeNull();
    const soleOwner = readRow(cslb, { k: "license", h: { ...stale, licenseType: "Contractor license (Sole Owner)" }, v: 2 })!;
    expect(soleOwner.hit).toMatchObject({ holder: "individual", phone: null, address: "FRESNO CA 93701" });
    const corp = readRow(cslb, { k: "license", h: { ...stale, licenseType: "Contractor license (Corporation)", status: "Active" }, v: 2 })!;
    expect(corp.hit).toMatchObject({ holder: "business", phone: "5595550100", address: "12 Home Ln, Fresno CA 93701" });
    const va = vaLegacyHolder([{ file: "2701", type: "Class A Contractor", holder: "business" }, { file: "2710", type: "Tradesman", holder: "individual" }]);
    expect(va(lic({ licenseType: "Class A Contractor", businessName: "ACME LLC" }))).toBe("business");
    expect(va(lic({ licenseType: "Class A Contractor", businessName: null }))).toBeNull();
    expect(va(lic({ licenseType: "Tradesman" }))).toBe("individual");
    expect(va(lic({ licenseType: "Something else" }))).toBeNull();
  });
});

describe("decision 4: FL respondents need a DBA marker and a trailing entity form", () => {
  it("Codex's inputs: an unmarked address line isn't a DBA, and 'CO, JOHN' is a person", () => {
    expect(flRespondent("SMITH, JOHN", ["ATTN JANE DOE"])).toBeNull();
    expect(flRespondent("CO, JOHN", [])).toBeNull();
    expect(flRespondent("PA, MARY", ["SUITE B"])).toBeNull();
  });
  it("a marked DBA, in an address line or after the name, is the business", () => {
    for (const line of ["D/B/A LOYAL ROOFERS", "DBA: LOYAL ROOFERS", "T/A LOYAL ROOFERS", "A/K/A LOYAL ROOFERS INC", "- DBA LOYAL ROOFERS"])
      expect(flRespondent("SMITH, JOHN", [line]), line).toMatchObject({ name: expect.stringMatching(/^LOYAL ROOFERS/), dbaOnly: true });
    expect(flRespondent("SMITH, JOHN D/B/A LOYAL ROOFERS", [])).toEqual({ name: "LOYAL ROOFERS", business: "LOYAL ROOFERS", dbaOnly: true });
    expect(flRespondent("ACME ROOFING CO", ["ATTN JANE DOE"])).toEqual({ name: "ACME ROOFING CO", business: "ACME ROOFING CO", dbaOnly: false });
    expect(flRespondent("ACME LLC", ["DBA ACME ROOFS"])).toEqual({ name: "ACME LLC / ACME ROOFS", business: "ACME LLC ACME ROOFS", dbaOnly: false });
    expect(flDbaOf("ADAMS DBA CENTER")).toBeNull(); // the marker must lead the line
  });
  it("an A/K/A alias is a person's other name unless it reads as a business (DBPR rows seen live 2026-10-15)", () => {
    expect(flRespondent("HERZANO, SAGY SHALOM", ["4170 SW 49TH CT", "A/K/A SAGY S. HERZANO", "D/B/A IVOLT LLC A/K/A IVOLT"]))
      .toEqual({ name: "IVOLT LLC", business: "IVOLT LLC", dbaOnly: true });
    expect(flRespondent("DIAZ, ALBERTO RAFAEL SR", ["2603 NW 10 AVE #204", "D/B/A ALBERT MANAGER SERVICES INC.", "A/K/A ALBERTO RAFAEL DIAZ JIMENEZ"]))
      .toEqual({ name: "ALBERT MANAGER SERVICES INC.", business: "ALBERT MANAGER SERVICES INC.", dbaOnly: true });
    expect(flRespondent("PIERCE, ALEXANDER", ["740 LAKE BLVD", "A/K/A ALEXANDER KENNETH PIERCE"])).toBeNull();
    expect(flRespondent("GHERSI, AUGUSTIN ARNALDO", ["3560 N.36 AVE APT.75", "DBA:AKA ELECTRICAL HANDYMAN"])).toMatchObject({ name: "ELECTRICAL HANDYMAN", dbaOnly: true });
  });
  it("entity forms count only as the last word", () => {
    expect(looksLikeBusinessTrailingSuffix("CO, JOHN")).toBe(false);
    expect(looksLikeBusiness("CO, JOHN")).toBe(true); // the general rule is unchanged for other sources
    for (const n of ["ACME CO", "ACME CO.", "SMITH, JOHN INC", "DOE PLUMBING, LLC", "SMITH, JOHN P.A."]) expect(looksLikeBusinessTrailingSuffix(n), n).toBe(true);
    for (const n of ["INC, BOB", "LLC, JANE", "SMITH, JOHN"]) expect(looksLikeBusinessTrailingSuffix(n), n).toBe(false);
  });
  it("a complaint file row: 'ATTN JANE DOE' on a person's row is no record; a marked DBA is a locality-only DBA record", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "a4fl-"));
    const row = (name: string, a1: string, a2: string) => ["0601", name, "HILLSBOROUGH", a1, a2, "", "TAMPA", "FL", "33602", "Certified General Contractor", "2024001", "Legal", "01/02/2024", "Closed", "02/03/2024", ""];
    const path = join(dir, "c.csv");
    const csv = [row("SMITH, JOHN", "ATTN JANE DOE", "1 ELM ST"), row("CO, JOHN", "2 OAK ST", ""), row("DOE, JANE", "D/B/A LOYAL ROOFERS", "3 PINE ST"), row("ACME ROOFING LLC", "ATTN JANE DOE", "4 BAY ST")]
      .map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    await fs.writeFile(path, csv);
    try {
      const out: BulkHit[] = [];
      for await (const h of flComplaintRows([path], new Map(), new Map())) out.push(h);
      expect(out.map((h) => (h.hit as EnforcementHit).name)).toEqual(["LOYAL ROOFERS", "ACME ROOFING LLC"]);
      expect(out[0].hit).toMatchObject({ address: "TAMPA FL 33602" });
      expect(out[0].keys?.addresses ?? []).toEqual([]);
      expect(out[1].hit).toMatchObject({ address: expect.stringContaining("4 BAY ST") });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it("the discipline file keeps only marked DBA lines", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "a4fl-"));
    const path = join(dir, "d.csv");
    await fs.writeFile(path, [
      "Complaint Nbr,Respondent Name,License Type,License Nbr,Address Line 1,Address Line 2,Address Line 3,City,State,ZIP Code,County,Classification,Entered Date,Disposition,Disposition Date,Discipline Date - Description,Violation Code",
      "2024009,\"SMITH, JOHN\",CGC,1,ATTN JANE DOE,DBA: SUN ROOFS,5 ELM ST,TAMPA,FL,33602,HILLSBOROUGH,Legal,01/02/2024,Closed,02/03/2024,,",
    ].join("\n"));
    try {
      const c = (await flDisciplineCases([path])).get("2024009")!;
      expect(c.dbas).toEqual(["DBA: SUN ROOFS"]);
      expect(c.lines).toEqual(["ATTN JANE DOE", "5 ELM ST"]);
      expect(flRespondent(c.name, c.dbas)).toMatchObject({ name: "SUN ROOFS", dbaOnly: true });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it("an old complaint row: an individual's is dropped (its DBA lost the marker), a business's keeps its own name only", () => {
    const src = { legacyEnforcement: flLegacyComplaint };
    expect(readRow(src, { k: "enforcement", h: enf({ name: "SMITH, JOHN / ATTN JANE DOE" }), v: 3 })).toBeNull();
    expect(readRow(src, { k: "enforcement", h: enf({ name: "CO, JOHN", address: "2 Oak St, Tampa FL 33602" }), v: 3 })).toBeNull();
    const biz = readStored(src, { k: "enforcement", h: enf({ name: "ACME LLC / ATTN JANE DOE", address: "2 Oak St, Tampa FL 33602" }), v: 3 })!;
    expect(biz.stored.hit).toMatchObject({ name: "ACME LLC", address: "2 Oak St, Tampa FL 33602" });
    expect(biz.keysSafe).toBe(true);
  });
});

describe("decision 11: a stored row-shape version, exempted once", () => {
  it("Codex's scenario: the new-shape load passes once and becomes the baseline; a 185,000-row load after it is refused", () => {
    // The old shape: ~668k rows, one per person. The source now declares shape 1; the stored load is shape 0.
    const old = { rows: 668_000, loadedAt: "2026-10-14T10:00:00Z", facets: { baseline: { rows: 668_000 } }, rowShape: 0 };
    const first = baselineOf(old, 1);
    expect(first).toBeNull();
    expect(shortfall(264_352, {}, first)).toBeNull();
    const stored = { rows: 264_352, loadedAt: "2026-10-15T10:00:00Z", facets: { baseline: nextBaseline(264_352, {}, first) }, rowShape: 1 };
    expect(stored.facets.baseline).toEqual({ rows: 264_352 });
    // Same day, same shape: no second exemption.
    const second = baselineOf(stored, 1);
    expect(second).toEqual({ rows: 264_352 });
    expect(shortfall(185_000, {}, second)).toMatch(/185000 rows, baseline 264352/);
  });
  it("CSLB and WV EVS declare shape 1; no source keeps a date exemption", () => {
    const all = bulkSources();
    expect(all.find((s) => s.id === "ca-cslb")!.rowShape).toBe(1);
    expect(all.find((s) => s.id === "wv-oic-evs")!.rowShape).toBe(1);
    expect(all.some((s) => "rowShapeChangedAt" in s)).toBe(false);
  });
});
