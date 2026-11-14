import { describe, expect, it } from "vitest";
import { cleanReviewPhotos } from "./review-photos";

describe("review request photos", () => {
  it("keeps uploaded and Media Library photos", () => {
    expect(cleanReviewPhotos([
      { url: "/api/files/photos/reviews/5b0c1c1e-0a55-4c1e-9d5e-1d2b3c4d5e6f.jpg", originalName: "deck.jpg", size: 12 },
      { url: "/api/files/media/5b0c1c1e-0a55-4c1e-9d5e-1d2b3c4d5e6f/Acme-Seattle-1.jpg", originalName: "x".repeat(900) },
    ])).toEqual([
      { url: "/api/files/photos/reviews/5b0c1c1e-0a55-4c1e-9d5e-1d2b3c4d5e6f.jpg", originalName: "deck.jpg" },
      { url: "/api/files/media/5b0c1c1e-0a55-4c1e-9d5e-1d2b3c4d5e6f/Acme-Seattle-1.jpg", originalName: "x".repeat(200) },
    ]);
    expect(cleanReviewPhotos(undefined)).toEqual([]);
    expect(cleanReviewPhotos([])).toEqual([]);
  });

  it("refuses anything that is not one of the platform's stored files", () => {
    for (const url of [
      "data:text/html,<script>alert(1)</script>", "javascript:alert(1)", "https://evil.example/pixel.png", "//evil.example/x.png",
      "/api/files/../admin", "/api/files//evil.example/x", "/api/files/media/x.jpg?download=1", "/api/other/x.jpg", "", 42, null,
    ]) {
      expect(cleanReviewPhotos([{ url, originalName: "estimate.html" }])).toBeNull();
    }
    expect(cleanReviewPhotos("nope")).toBeNull();
    expect(cleanReviewPhotos(["/api/files/media/x.jpg"])).toBeNull();
  });
});
