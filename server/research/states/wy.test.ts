import { describe, expect, it } from "vitest";
import { lookupAll } from "./wy";

describe("Wyoming licensing portal paging", () => {
  it("reads pages of 50 until a short page", async () => {
    const offsets: number[] = [];
    const r = await lookupAll(async (o) => { offsets.push(o); return Array.from({ length: o === 0 ? 50 : 3 }, (_, i) => ({ id: o + i })); });
    expect(offsets).toEqual([0, 50]);
    expect(r).toMatchObject({ more: false });
    expect(r.rows).toHaveLength(53);
  });
  it("says when it stopped before the end instead of returning a silent first page", async () => {
    const r = await lookupAll(async (o) => Array.from({ length: 50 }, (_, i) => ({ id: o + i })));
    expect(r.more).toBe(true);
    expect(r.rows).toHaveLength(300);
  });
  it("throws on an unexpected payload", async () => {
    await expect(lookupAll(async () => ({ error: "x" }))).rejects.toThrow(/unexpected payload/);
  });
});
