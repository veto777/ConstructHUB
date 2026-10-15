import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvRecords } from "../bulk";
import { checkDporColumns, sccHit, vaRegulantHit, vaSpecialties } from "./va";

// Rows as published in DPOR's regulant lists on 2026-10-15 (2701__crnt.txt, 2710__crnt.txt), e-mail column blanked.
const HEADER = "BOARD\tOCCUPATION\tCERTIFICATE #\tINDIVIDUAL NAME\tBUSINESS NAME\tFIRST LINE ADDRESS\tSECOND LINE ADDRESS\tP O BOX #\tCITY\tSTATE\tFIVE DIGIT ZIP CODE\tZIP CODE EXTENSION\tPROVINCE\tCOUNTRY\tPOSTAL CODE\tEXPIRATION DATE\tCERTIFICATION DATE\tLICENSE RANK\tLICENSE SPECIALTY\tEMAILADDRESS";
const FIRM = "27\t01\t006397\t\tLANTZ CONSTRUCTION COMPANY\t539 SOUTH MAIN ST\t\t\tBROADWAY\tVA\t22815\t0000\t\t\t\t01/31/2028\t04/26/1962\tA\tCBC RBC \t";
const TRADESMAN = "27\t10\t070965\tDERRICK S SHIFFLETT \t\t567 MILL LN\t\t\tELKTON\tVA\t22827\t0000\t\t\t\t03/31/2028\t03/28/2019\tTRAD\tMPLB \t";

async function records(text: string): Promise<Record<string, string>[]> {
  const p = join(tmpdir(), `va-test-${Date.now()}.txt`);
  await fs.writeFile(p, text);
  const out: Record<string, string>[] = [];
  for await (const r of csvRecords(p, "\t")) out.push(r);
  await fs.rm(p);
  return out;
}

describe("Virginia DPOR regulant lists", () => {
  it("accepts the regulant-list layout and rejects an error page served in its place", async () => {
    const [firm] = await records(`${HEADER}\n${FIRM}\n`);
    expect(() => checkDporColumns(firm, "2701")).not.toThrow();
    const [page] = await records("<!DOCTYPE html>\n<html><head><title>Page not found | DPOR</title></head></html>\n");
    expect(() => checkDporColumns(page, "2705b")).toThrow(/not the regulant-list layout/);
  });

  it("reads a contractor firm and a tradesman", async () => {
    const [firm, trad] = await records(`${HEADER}\n${FIRM}\n${TRADESMAN}\n`);
    const a = vaRegulantHit(firm, { file: "2701", type: "Class A Contractor", holder: "business" as const }, "src")!;
    expect(a.business).toBe("LANTZ CONSTRUCTION COMPANY");
    expect(a.hit).toMatchObject({ licenseNumber: "2701006397", licenseType: "Class A Contractor", expires: "2028-01-31", city: "BROADWAY, VA", principal: null,
      specialty: "CBC (Commercial building), RBC (Residential building)", matchedOn: "business" });
    const t = vaRegulantHit(trad, { file: "2710", type: "Tradesman", holder: "individual" as const }, "src")!;
    expect(t.person).toBe("DERRICK S SHIFFLETT");
    expect(t.hit).toMatchObject({ licenseNumber: "2710070965", businessName: null, specialty: "MPLB (Master Plumber)", matchedOn: "principal" });
    // Round 2, decision 2: the list's class decides who holds the license.
    expect(a.hit.holder).toBe("business");
    expect(t.hit.holder).toBe("individual");
    // A tradesman row with an employer named is still the tradesman's license.
    expect(vaRegulantHit({ ...trad, "BUSINESS NAME": "SHIFFLETT PLUMBING LLC" }, { file: "2710", type: "Tradesman", holder: "individual" }, "src")!.hit.holder).toBe("individual");
    // A contractor row naming only a person doesn't say whether it is a sole proprietor's.
    expect(vaRegulantHit({ ...firm, "BUSINESS NAME": "", "INDIVIDUAL NAME": "JOHN DOE" }, { file: "2701", type: "Class A Contractor", holder: "business" }, "src")!.hit.holder).toBeNull();
  });

  it("shows codes DPOR doesn't define as codes", () => {
    expect(vaSpecialties("EMC H/H", "27")).toBe("code EMC, H/H (Highway/heavy)");
    expect(vaSpecialties("ENG ARC", "04")).toBe("code ENG, code ARC");
    expect(vaSpecialties("", "27")).toBeNull();
  });
});

describe("Virginia SCC open data", () => {
  const ds = { resource: "x", page: "https://data.virginia.gov/dataset/corporation", kind: "Corporation", loaded: "2024-11-14" };
  it("marks an automatic revocation adverse and a voluntary termination neutral", () => {
    // KRUSE CONSTRUCTION CO., INC., as data.virginia.gov returned it on 2026-10-15.
    const revoked = sccHit({ EntityID: "\tF0279614  ", Name: "KRUSE CONSTRUCTION CO., INC.", Status: "INACTIVE  ", StatusReason: "Automatically Revoked - Annual Report and/or Fees - Can Reinstate", "Status Date": "2024-08-31 00:00:00", IncorpDate: "1974-04-16 00:00:00", IncorpState: "PA        ", City: "DOWNINGTOWN", State: "Pennsylvania" }, ds);
    expect(revoked).toMatchObject({ id: "F0279614", adverse: true, date: "1974-04-16", endDate: "2024-08-31", city: "DOWNINGTOWN, Pennsylvania", status: "Corporation: INACTIVE, Automatically Revoked - Annual Report and/or Fees - Can Reinstate" });
    const vol = sccHit({ EntityID: "\tS4551604  ", Name: "Covenant Roofing & Construction, LLC", Status: "INACTIVE  ", StatusReason: "Voluntarily Canceled - Cannot Reinstate", "Status Date": "6/1/2022", IncorpDate: "5/16/2013", IncorpState: "VA        ", City: "Woodbridge", State: "Virginia  " }, { ...ds, kind: "LLC" });
    expect(vol).toMatchObject({ adverse: null, date: "2013-05-16", endDate: "2022-06-01", status: "LLC: INACTIVE, Voluntarily Canceled - Cannot Reinstate" });
  });
});
