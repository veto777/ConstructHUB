import { describe, expect, it } from "vitest";
import { sfmRows } from "./oh";

async function* each<T>(rows: T[]) { yield* rows; }
const collect = async <T>(it: AsyncIterable<T>) => { const out: T[] = []; for await (const x of it) out.push(x); return out; };
// The fire-protection individual row of g5.test.ts (State Fire Marshal roster, 2026-10-15).
const base = { Name: "BUDDY LEWIS NIECE", City: "WEST UNION", State: "OH", "Zip Code": "45693-9783", Credential: "54.01.1007", "Licensee Type": "Fire Protection Individual",
  "Expiration Date": "07/01/2027", "License Status": "Active", "Category Status": "Active", Category: "Portable Fire Extinguishers", "Work Phone": "(937)544-0000" };

describe("OH State Fire Marshal rosters (audit 2026-10-15)", () => {
  it("an empty roster stops the load instead of passing under the combined floor", async () => {
    await expect(collect(sfmRows([{ name: "54 Fire Protection Individual", rows: each([]) }]))).rejects.toThrow(/came back empty/);
  });
  it("an individual with no employer on record carries no phone or phone key", async () => {
    const [h] = await collect(sfmRows([{ name: "54 Fire Protection Individual", rows: each([base]) }]));
    expect(h.hit).toMatchObject({ businessName: null, principal: "BUDDY LEWIS NIECE", phone: null });
    expect(h.keys?.phones).toEqual([null]);
  });
});

describe("OH holders and components (audit round 2)", () => {
  it("an individual named with an employer is still the license holder; the companies roster is businesses; each roster is a component", async () => {
    const withEmployer = { ...base, "Supervision Type": "Individual to Company", "Supervisor Name": "ACME FIRE PROTECTION LLC" };
    const [ind] = await collect(sfmRows([{ name: "54 Fire Protection Individual", rows: each([withEmployer]) }]));
    expect(ind.hit).toMatchObject({ businessName: "ACME FIRE PROTECTION LLC", holder: "individual" });
    expect(ind.component).toBe("54 Fire Protection Individual");
    const [co] = await collect(sfmRows([{ name: "53 Fire Protection Companies", rows: each([{ Name: "ACME FIRE PROTECTION LLC", Credential: "53.1", City: "DAYTON" }]) }]));
    expect(co.hit).toMatchObject({ holder: "business" });
    expect(co.component).toBe("53 Fire Protection Companies");
  });
  it("OCILB: the qualifying individual holds the license; a company-only row is the company's", async () => {
    const { ocilbRow } = await import("./oh");
    expect(ocilbRow({ Name: "JOHN Q SMITH", Company: "SMITH ELECTRIC LLC", FormattedCredential: "EL.12345", Type: "EL" })!.hit).toMatchObject({ holder: "individual" });
    // Round 3, decision 3: a company name alone (no individual) leaves the holder unknown.
    expect(ocilbRow({ Name: "", Company: "SMITH ELECTRIC LLC", FormattedCredential: "EL.12346", Type: "EL" })!.hit).toMatchObject({ holder: null });
  });
});
