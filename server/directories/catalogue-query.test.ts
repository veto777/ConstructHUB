import { describe, expect, it } from "vitest";
import { catalogueQuery } from "./catalogue-query";

describe("strict catalogue query", () => {
  it("defaults paging and sorting and parses multi-value filters", () => {
    expect(catalogueQuery.parse({})).toEqual({
      limit: 25,
      offset: 0,
      sort: "tier",
      dir: "asc",
    });
    expect(
      catalogueQuery.parse({
        limit: "250",
        offset: "10",
        category: "general,contractor",
        tier: "1,4",
        kind: "api,submission",
        grade: "A,ungraded",
        active: "false",
        dr_min: "0",
        dr_max: "100",
      }),
    ).toMatchObject({
      limit: 250,
      offset: 10,
      category: ["general", "contractor"],
      tier: ["1", "4"],
      kind: ["api", "submission"],
      grade: ["A", "ungraded"],
      active: false,
      dr_min: 0,
      dr_max: 100,
    });
  });
  it.each([
    { limit: "11" },
    { limit: "25.0" },
    { offset: "-1" },
    { offset: "2147483648" },
    { offset: "1e3" },
    { q: ["a", "b"] },
    { active: "1" },
    { category: "bogus" },
    { category: "general," },
    { tier: "0" },
    { kind: "direct" },
    { grade: "D" },
    { paid: "yes" },
    { link: "unknown" },
    { dr_min: "-1" },
    { dr_max: "101" },
    { dr_min: "80", dr_max: "20" },
    { state: "NYC" },
    { state: "ny" },
    { sort: "name; DROP TABLE users" },
    { dir: "sideways" },
    { unknown: "1" },
  ])("rejects invalid query %j", (query) => {
    expect(catalogueQuery.safeParse(query).success).toBe(false);
  });
});
