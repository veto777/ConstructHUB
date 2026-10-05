/** App Review watch (server/ops/app-review-watch.ts): plain-words states, change detection, silent first reading. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { checkAppReview, describeState, ensureAppReviewWatchSchema, type AppReviewState } from "./app-review-watch";

const base: AppReviewState = { appId: `test-${Date.now()}`, name: "ConstructHUB CRM", version: "1.0", versionState: "PREPARE_FOR_SUBMISSION", submissionState: null };

describe("describeState", () => {
  it("never calls a rejection or an open question an approval", () => {
    for (const s of [{ versionState: "REJECTED" }, { versionState: "METADATA_REJECTED" }, { versionState: "IN_REVIEW", submissionState: "UNRESOLVED_ISSUES" }]) {
      const m = describeState({ ...base, ...s });
      expect(m.severity).toBe("critical");
      expect(m.body).toMatch(/NOT an approval|resubmit/);
    }
    expect(describeState({ ...base, versionState: "READY_FOR_DISTRIBUTION" }).title).toMatch(/approved and live/);
    expect(describeState({ ...base, versionState: "WAITING_FOR_REVIEW" }).title).toMatch(/waiting for review/);
  });
});

describe("checkAppReview", () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== "/constructhub_dev_a6") throw Error("Requires assigned development database");
    await ensureAppReviewWatchSchema();
  });
  afterAll(async () => { await pool.query("DELETE FROM ops_app_review_state WHERE app_id = $1", [base.appId]); await pool.end(); });

  it("records the first reading silently, then announces each change exactly once", async () => {
    const sent: string[] = [];
    const run = (s: Partial<AppReviewState>) => checkAppReview({ read: async () => [{ ...base, ...s }], notify: async (_s, m) => { sent.push(m.title); } });
    await run({});
    expect(sent).toEqual([]);
    await run({ versionState: "WAITING_FOR_REVIEW", submissionState: "WAITING_FOR_REVIEW" });
    await run({ versionState: "WAITING_FOR_REVIEW", submissionState: "WAITING_FOR_REVIEW" });
    await run({ versionState: "REJECTED", submissionState: "UNRESOLVED_ISSUES" });
    expect(sent).toEqual(["ConstructHUB CRM 1.0: submitted, waiting for review", "ConstructHUB CRM 1.0: Apple needs a reply"]);
  });
});
