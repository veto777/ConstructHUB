import { describe, expect, it } from "vitest";
import { idSosHit, idSosResults } from "./id";
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
