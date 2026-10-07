import { describe, expect, it } from "vitest";
import { matchesSearch, matchesTagFilter, normalizeTagFilter, normalizeTags } from "./filters";

describe("jobcam tag + search filters (pure)", () => {
  it("normalises tags: trims, collapses spaces, dedupes case-insensitively, keeps the first spelling", () => {
    expect(normalizeTags([" Roof ", "roof", "Before  and   after", "", null, undefined, "ROOF"])).toEqual(["Roof", "Before and after"]);
    expect(normalizeTags(["x".repeat(60)])[0]).toHaveLength(40);
  });

  it("AND needs every filter tag, OR needs any — case-insensitively", () => {
    const media = ["Roof", "Before"];
    expect(matchesTagFilter(media, ["roof"], "and")).toBe(true);
    expect(matchesTagFilter(media, ["roof", "before"], "and")).toBe(true);
    expect(matchesTagFilter(media, ["roof", "after"], "and")).toBe(false);
    expect(matchesTagFilter(media, ["roof", "after"], "or")).toBe(true);
    expect(matchesTagFilter(media, ["after", "gutter"], "or")).toBe(false);
    expect(matchesTagFilter(null, ["roof"], "or")).toBe(false);
    expect(matchesTagFilter(null, [], "and")).toBe(true);        // no filter = everything
    expect(matchesTagFilter(media, [" ", ""], "and")).toBe(true); // blanks are not a filter
  });

  it("defaults the mode to AND", () => {
    expect(normalizeTagFilter("or")).toBe("or");
    expect(normalizeTagFilter("OR")).toBe("or");
    expect(normalizeTagFilter("and")).toBe("and");
    expect(normalizeTagFilter(undefined)).toBe("and");
    expect(normalizeTagFilter("anything")).toBe("and");
  });

  it("search: every term must appear somewhere across project, address, tags, uploader", () => {
    const hay = ["Smith re-roof", "1200 Bay St · Tampa, FL", "Roof Before", "Dave"];
    expect(matchesSearch("tampa", hay)).toBe(true);
    expect(matchesSearch("tampa dave", hay)).toBe(true);
    expect(matchesSearch("tampa orlando", hay)).toBe(false);
    expect(matchesSearch("", hay)).toBe(true);
    expect(matchesSearch(null, hay)).toBe(true);
  });
});

import { publicUploaderName, textArray, parseFeedParams } from "./routes";

describe("jobcam presentation rules", () => {
  it("guests on a share link never see a crew member's email", () => {
    expect(publicUploaderName("Sam Ortiz", "sam@example.com", true)).toBe("Sam Ortiz");
    expect(publicUploaderName(null, "sam@example.com", true)).toBeNull();
    expect(publicUploaderName("sam@example.com", "sam@example.com", true)).toBeNull();
    expect(publicUploaderName(null, "sam@example.com", false)).toBe("sam@example.com");
    expect(publicUploaderName("", "", false)).toBeNull();
  });

  it("builds a tag filter as one text[] value, not a spread row", () => {
    const q: any = textArray(["roof", "before"]);
    const flat = JSON.stringify(q.queryChunks ?? q);
    expect(flat).toContain("ARRAY[");
    expect(flat).toContain("]::text[]");
    expect(JSON.stringify((textArray([]) as any).queryChunks)).toContain("'{}'::text[]");
  });

  it("parses feed params defensively", () => {
    const p = parseFeedParams({ tags: " Roof , roof ,, Before", mode: "OR", starred: "1", kind: "audio", limit: "9999", q: "  gable  ", from: "nope", before: "2026-10-07T12:00:00.000Z|abc" });
    expect(p.tags).toEqual(["Roof", "Before"]);
    expect(p.tagMode).toBe("or");
    expect(p.starred).toBe(true);
    expect(p.kind).toBeNull();
    expect(p.limit).toBe(200);
    expect(p.q).toBe("gable");
    expect(p.from).toBeNull();
    expect(p.before).toEqual({ at: new Date("2026-10-07T12:00:00.000Z"), id: "abc" });
    expect(parseFeedParams({ before: "garbage" }).before).toBeNull();
  });
});
