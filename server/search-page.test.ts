import { describe, expect, it } from "vitest";
import { readSearchPage, resultPage, SEARCH_PAGE_MAX, searchPageInput } from "./search-page";

// Reviewers (2026-10-11): the search capped at the newest 1,000 matches nationwide before applying
// the area filter. Pages are now scoped in SQL and read by cursor; this is the page contract.
describe("permit search pages", () => {
  it("defaults to the old cap, and accepts a smaller page and a cursor from a body or a query string", () => {
    expect(readSearchPage({})).toEqual({ limit: SEARCH_PAGE_MAX });
    expect(readSearchPage(undefined)).toEqual({ limit: SEARCH_PAGE_MAX });
    expect(readSearchPage({ limit: 50, before: 9120 })).toEqual({ limit: 50, before: 9120 });
    expect(readSearchPage({ limit: "50", before: "9120" })).toEqual({ limit: 50, before: 9120 });
    expect(searchPageInput.parse({ limit: "1" })).toEqual({ limit: 1 });
  });

  it("refuses a page that is not a page", () => {
    for (const bad of [{ limit: 0 }, { limit: SEARCH_PAGE_MAX + 1 }, { limit: "fifty" }, { limit: 2.5 }, { before: 0 }, { before: -1 }, { before: "abc" }]) {
      expect(readSearchPage(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("turns the over-fetched row into a cursor, and ends with null", () => {
    const rows = [{ id: 30 }, { id: 20 }, { id: 10 }];
    expect(resultPage(rows, 2, 7)).toEqual({ results: [{ id: 30 }, { id: 20 }], totalResults: 7, nextCursor: 20 });
    expect(resultPage(rows, 3, 3)).toEqual({ results: rows, totalResults: 3, nextCursor: null });
    expect(resultPage([], 50, 0)).toEqual({ results: [], totalResults: 0, nextCursor: null });
  });
});
