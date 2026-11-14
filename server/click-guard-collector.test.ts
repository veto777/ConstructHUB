import { describe, expect, it } from "vitest";
import { allowClickTrack, CLICK_TRACK_IP_LIMIT, trackField } from "./click-guard-collector";

describe("Click Guard collector bounds", () => {
  it("keeps the tracking script's values as they are", () => {
    expect(trackField("1920x1080", "screenResolution")).toBe("1920x1080");
    expect(trackField("America/New_York", "timezone")).toBe("America/New_York");
    expect(trackField("https://example.com/roofing?gclid=abc", "landingPage")).toBe("https://example.com/roofing?gclid=abc");
    expect(trackField("", "referrer")).toBeNull();
    expect(trackField(undefined, "browser")).toBeNull();
  });

  it("cuts oversized fields and drops values that are not text", () => {
    expect(trackField("x".repeat(5_000_000), "landingPage")).toHaveLength(2000);
    expect(trackField("u".repeat(9000), "userAgent")).toHaveLength(512);
    expect(trackField("f".repeat(500), "fingerprint")).toHaveLength(100);
    expect(trackField({ $ne: 1 }, "trackingId")).toBeNull();
    expect(trackField(["a"], "fingerprint")).toBeNull();
    expect(trackField(12345, "fingerprint")).toBe("12345");
  });

  it("allows a window of beacons per IP, then refuses until the window ends", () => {
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < CLICK_TRACK_IP_LIMIT; i++) expect(allowClickTrack("203.0.113.5", t0 + i)).toBe(true);
    expect(allowClickTrack("203.0.113.5", t0 + 1000)).toBe(false);
    expect(allowClickTrack("203.0.113.6", t0 + 1000)).toBe(true);
    expect(allowClickTrack("203.0.113.5", t0 + 10 * 60 * 1000)).toBe(true);
  });
});
