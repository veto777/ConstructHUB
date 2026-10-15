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
