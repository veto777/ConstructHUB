import { describe, expect, it } from "vitest";
import { indyRow } from "./in";

describe("Indiana round-2 audit (2026-10-16)", () => {
  it("an Indianapolis contractor license is the business's (decision 2)", () => {
    const h = indyRow({ "Business Name": "ACME PLUMBING LLC", "License Number": "PC-1", "License Type": "Plumbing", Address: "108 E EPLER  AV                INDIANAPOLIS IN 46227" })!;
    expect(h.hit.holder).toBe("business");
  });
});
