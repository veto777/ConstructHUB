import { describe, expect, it } from "vitest";
import { buildRankResult, ownedFeatures } from "./dataforseo";

describe("results-page features the site itself is in", () => {
  const items = [
    { type: "ai_overview", items: [{ type: "ai_overview_element", references: [{ domain: "www.alpine.example", url: "https://www.alpine.example/roofing" }, { domain: "other.example" }] }] },
    { type: "featured_snippet", domain: "blog.alpine.example", url: "https://blog.alpine.example/answer" },
    { type: "people_also_ask", items: [{ type: "people_also_ask_element", expanded_element: [{ domain: "someone.example" }] }, { type: "people_also_ask_element", expanded_element: [{ domain: "alpine.example" }] }] },
    { type: "local_pack", title: "Alpine Exteriors", domain: "alpine.example" },
    { type: "organic", domain: "alpine.example", url: "https://alpine.example/", rank_group: 3 },
  ];
  it("marks the AI overview that cites it, the featured snippet that is its page and a question answered from it", () => {
    expect(ownedFeatures(items, "alpine.example").sort()).toEqual(["own:ai_overview", "own:checked", "own:featured_snippet", "own:people_also_ask"]);
  });
  it("another site's features are not ours, and a look-alike domain is not the site", () => {
    // "own:checked" alone = looked, and the site is in none of them (which is different from never having looked).
    expect(ownedFeatures(items, "pine.example")).toEqual(["own:checked"]);
    expect(ownedFeatures([{ type: "featured_snippet", domain: "notalpine.example" }, { type: "ai_overview", references: [{ domain: "alpine.example.evil.test" }] }], "alpine.example")).toEqual(["own:checked"]);
    expect(ownedFeatures([null, { type: 5 }, { type: "ai_overview" }, { type: "people_also_ask", items: "x" }], "alpine.example")).toEqual(["own:checked"]);
  });
  it("travels with the check: what is on the page, then what is ours", () => {
    const r = buildRankResult({ keywordId: 1, keyword: "roof repair", targetDomain: "alpine.example" }, items);
    expect(r.serpFeatures.filter((f) => f.startsWith("own:")).sort()).toEqual(["own:ai_overview", "own:checked", "own:featured_snippet", "own:people_also_ask"]);
    expect(r.serpFeatures.slice(0, 5)).toEqual(["ai_overview", "featured_snippet", "people_also_ask", "local_pack", "organic"]);
  });
});
