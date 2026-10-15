import { describe, expect, it } from "vitest";
import { pack } from "./co";

describe("Colorado pack", () => {
  it("reads a Secretary of State row as published, adverse only when revoked", () => {
    const sos = pack.enforcement![0];
    // A row from data.colorado.gov 4ykn-tg5h, 2026-10-15.
    const row = { entityid: "20251527990", entityname: "ALPINE ROOFING LLC", entitystatus: "Delinquent", principalcity: "Alamosa", principalstate: "CO", entitytype: "DLLC", jurisdictonofformation: "CO", entityformdate: "2025-05-07T00:00:00.000", principaladdress1: "123 Main St", principalzipcode: "81101" };
    expect(sos.toHit(row)).toMatchObject({ category: "business_status", id: "20251527990", date: "2025-05-07", status: "Secretary of State status: Delinquent", city: "Alamosa, CO", adverse: null, address: "123 Main St, Alamosa, CO 81101" });
    expect(sos.toHit({ ...row, entitystatus: "Revoked" }).adverse).toBe(true);
  });
  it("keeps the DORA filter to construction credentials", () => {
    expect(pack.licenses![0].filter).toContain("'PE'");
    expect(pack.licenses![0].filter).not.toContain("'RN'");
  });
});
