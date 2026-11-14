import { describe, expect, it } from "vitest";
import { createSlotQueue, liveSearchOutcome, scrapeFailureReason } from "./live-search-outcome";

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

// Audit 08 #3: every live search opened its own four browser contexts with no server-wide ceiling.
describe("createSlotQueue", () => {
  it("never runs more than max at once, runs everything, and keeps arrival order", async () => {
    const q = createSlotQueue(2);
    const started: number[] = [];
    const release: (() => void)[] = [];
    let peak = 0;
    const jobs = [0, 1, 2, 3, 4].map((i) => q.run(async () => {
      started.push(i);
      peak = Math.max(peak, q.active);
      await new Promise<void>((r) => release.push(r));
      return i * 10;
    }));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(q.waiting).toBe(3);
    for (let i = 0; i < 5; i++) { release[i](); await new Promise((r) => setTimeout(r, 0)); }
    expect(await Promise.all(jobs)).toEqual([0, 10, 20, 30, 40]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect([q.active, q.waiting]).toEqual([0, 0]);
  });

  it("frees the slot when the work fails", async () => {
    const q = createSlotQueue(1);
    await expect(q.run(async () => { throw new Error("portal down"); })).rejects.toThrow("portal down");
    expect(q.active).toBe(0);
    expect(await q.run(async () => "ok")).toBe("ok");
  });
});
