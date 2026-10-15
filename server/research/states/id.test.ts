import { describe, expect, it } from "vitest";
import { idSosHit } from "./id";

describe("Idaho Secretary of State", () => {
  it("reads a search row; forfeited is adverse", () => {
    // Rows from a live sosbiz.idaho.gov businesssearch answer, 2026-10-15.
    const row = { TITLE: ["BOISE ROOFING LLC (556603)", "Limited Liability Company (D)"], RECORD_NUM: "0000556603", FILING_DATE: "05/31/2017", STATUS: "Active-Existing", STANDING: "Good Standing" };
    expect(idSosHit(row)).toMatchObject({ name: "BOISE ROOFING LLC", id: "0000556603", date: "2017-05-31", status: "Secretary of State status: Active-Existing, standing: Good Standing", detail: "Limited Liability Company (D)", adverse: null });
    expect(idSosHit({ ...row, STATUS: "Inactive-Forfeited" }).adverse).toBe(true);
  });
});
