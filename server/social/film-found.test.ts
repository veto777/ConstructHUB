import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { characterCount, destinationLabel, latestPostsFirst } from "../../client/src/components/social-drafts";
import { destinationSchema, publicMediaUrl } from "../../shared/social";
import { libraryMedia } from "./library-media";

describe("Social filming regressions", () => {
  it("uses the page name once and otherwise the account name", () => {
    const destination = destinationSchema.parse({ accountId: "fb", platform: "facebook", pageId: "denver" });
    const accounts = [{ id: "fb", name: "Summit Roofing Co.", pages: [{ id: "denver", name: "Summit Roofing Co. (Denver)" }] }];
    expect(destinationLabel(destination, accounts)).toBe("Summit Roofing Co. (Denver) · Facebook");
    expect(destinationLabel({ ...destination, pageId: undefined }, accounts)).toBe("Summit Roofing Co. · Facebook");
  });
  it("places an accepted draft or schedule above a full page and refreshes without duplicates", () => {
    const page = Array.from({ length: 25 }, (_, i) => ({ id: String(i), state: "queued" }));
    for (const state of ["draft", "queued"]) {
      const latest = { id: "new", state };
      expect(latestPostsFirst(page, [latest])[0]).toEqual(latest);
      const refreshed = { ...latest, state: "published" };
      const result = latestPostsFirst([...page, refreshed], [latest]);
      expect(result[0]).toEqual(refreshed);
      expect(result.filter(p => p.id === "new")).toHaveLength(1);
    }
  });
  it("hides only Facebook's distant cap, counting Unicode characters", () => {
    expect(characterCount("facebook", "x".repeat(38))).toBe("38 characters");
    expect(characterCount("facebook", "😀")).toBe("1 characters");
    expect(characterCount("facebook", "x".repeat(56885))).toBe("56885 characters");
    expect(characterCount("facebook", "x".repeat(56886))).toBe("56886/63206 characters");
    expect(characterCount("facebook", "x".repeat(63207))).toBe("63207/63206 characters");
    expect(characterCount("twitter", "hello")).toBe("5/280 characters");
    expect(characterCount("linkedin", "hello")).toBe("5/3000 characters");
  });
  it("lists the actual four seeded raster photos for upload without relaxing publishing URLs", () => {
    const seed = fs.readFileSync(new URL("../../script/feature-shots/seed/20-reviews.sql", import.meta.url), "utf8");
    const urls = [...seed.matchAll(/\(9200[1-4],1,[^\n]*?'(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)'/g)].map(match => ({ url: match[1] }));
    expect(urls).toHaveLength(4);
    expect(libraryMedia(urls)).toHaveLength(4);
    for (const photo of libraryMedia(urls)) {
      expect(photo.requiresUpload).toBe(true);
      expect(publicMediaUrl.safeParse(photo.url).success).toBe(false);
      expect(Buffer.from(photo.url.split(",")[1], "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
    }
  });
  it("rejects unsafe library URLs and preserves synced HTTPS photos", () => {
    expect(libraryMedia([
      { url: "data:text/html;base64,PHNjcmlwdD4=" },
      { url: "data:image/svg+xml;base64,PHN2Zz4=" },
      { url: "http://example.com/a.jpg" },
      { url: "https://127.0.0.1/a.jpg" },
      { url: "https://example.com/synced.jpg" },
    ])).toEqual([{ url: "https://example.com/synced.jpg" }]);
  });
});
