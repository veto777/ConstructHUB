import { describe, expect, it } from "vitest";
import { queryAll } from "./ak";
import { noteOf } from "../notes";

const page = (from: number, n: number, more: boolean) => ({ features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: from + i, BusinessName: "ACME" } })), exceededTransferLimit: more });

describe("AK business licenses paging", () => {
  it("pages by resultOffset until a short page", async () => {
    const urls: string[] = [];
    const rows = await queryAll("x", async (u) => { urls.push(u); return urls.length === 1 ? page(1, 2000, true) : page(2001, 5, false); });
    expect(rows).toHaveLength(2005);
    expect(urls[1]).toContain("resultOffset=2000");
    expect(noteOf(rows)).toBeNull();
  });
  it("throws when the server ignores resultOffset (the same page again)", async () => {
    await expect(queryAll("x", async () => page(1, 2000, true))).rejects.toThrow(/repeated a page/);
  });
  it("says so when it stops at the page cap", async () => {
    let n = 0;
    const rows = await queryAll("x", async () => page(1 + 2000 * n++, 2000, true));
    expect(rows).toHaveLength(20000);
    expect(noteOf(rows)).toMatch(/showing the first 20000/);
  });
});
