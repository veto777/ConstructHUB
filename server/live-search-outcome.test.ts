import { describe, expect, it } from "vitest";
import { liveSearchOutcome, scrapeFailureReason } from "./live-search-outcome";

describe("live search portal outcome", () => {
  it("reports a portal as searched only when its scrape job completed", () => {
    expect(liveSearchOutcome(0, { status: "completed", message: "Completed: found 0 results (0 new)" }))
      .toEqual({ status: "completed", message: "Found 0 results" });
    expect(liveSearchOutcome(7, { status: "completed", message: "" }))
      .toEqual({ status: "completed", message: "Found 7 results" });
  });

  it("never turns a failed scrape into 'Found 0 results'", () => {
    // The adapters catch their own errors and return [] (Kimi QA: every Florida portal showed ✓ 0 results).
    const launch = "Error: browserType.launch: Failed to launch chromium because executable doesn't exist at /nix/store/x/bin/chromium\nCall log: ...";
    expect(liveSearchOutcome(0, { status: "error", message: launch }))
      .toEqual({ status: "error", message: "Not searched: the live-search browser could not start on the server" });
    expect(liveSearchOutcome(0, { status: "error", message: "eTRAKiT requires login to search permits. Please visit the site directly." }))
      .toEqual({ status: "error", message: "Not searched: eTRAKiT requires login to search permits. Please visit the site directly." });
  });

  it("keeps partial rows but still marks the portal as failed", () => {
    expect(liveSearchOutcome(12, { status: "error", message: "Error: page.goto: Timeout 45000ms exceeded." }))
      .toEqual({ status: "error", message: "Stopped after 12 results: the portal did not respond in time" });
  });

  it("treats a missing or unfinished scrape job as not searched", () => {
    expect(liveSearchOutcome(0, undefined).status).toBe("error");
    expect(liveSearchOutcome(0, { status: "running", message: "Searching..." }))
      .toEqual({ status: "error", message: "Not searched: the portal search did not finish" });
  });

  it("keeps browser internals out of the user-facing reason", () => {
    expect(scrapeFailureReason("Error: page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.invalid")).toBe("the portal could not be reached");
    expect(scrapeFailureReason("x".repeat(300))).toHaveLength(140);
    expect(scrapeFailureReason(undefined)).toBe("the portal search did not finish");
  });
});
