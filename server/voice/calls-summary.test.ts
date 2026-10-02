/**
 * The Call Assistant Results panel's numbers (server/voice/calls.ts callResultsSummary): counted from the call log,
 * so calls pushed in from another receptionist (engine 'external') count like our own. Needs a dev lane DB.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { pool } from "../db";
import { callResultsSummary, summaryTimezone } from "./calls";

const ORG = `test-results-${randomUUID().slice(0, 8)}`;
const OTHER = `test-results-other-${randomUUID().slice(0, 8)}`;
const RUN = randomUUID().slice(0, 8);

async function call(n: string, o: { org?: string; outcome: string; daysAgo: number; secs?: number; market?: string; to?: string; rec?: boolean }) {
  await pool.query(
    `INSERT INTO voice_calls (org_id, call_sid, engine, outcome, started_at, duration_seconds, to_number, recording_key, flags)
     VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'UTC') - make_interval(days => $5), $6, $7, $8, $9::jsonb)`,
    [o.org ?? ORG, `res-${RUN}-${n}`, o.market ? "external" : "constructhub", o.outcome, o.daysAgo, o.secs ?? 60, o.to ?? null,
     o.rec ? `voice/${ORG}/recordings/res-${RUN}-${n}.wav` : null, JSON.stringify(o.market ? { ingest: { market: o.market } } : {})]);
}

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  await call("a", { outcome: "lead_submitted", daysAgo: 1, market: "FL", rec: true, secs: 150 });
  await call("b", { outcome: "lead_submitted", daysAgo: 2, market: "WA", rec: true });
  await call("c", { outcome: "hangup", daysAgo: 3, market: "FL" });
  await call("d", { outcome: "spam", daysAgo: 4, market: "FL", rec: true });
  await call("e", { outcome: "info", daysAgo: 10, to: "+13605550142" });
  await call("f", { outcome: "declined", daysAgo: 45, market: "FL" });
  await call("g", { org: OTHER, outcome: "lead_submitted", daysAgo: 1, market: "FL" });
});

afterAll(async () => {
  await pool.query(`DELETE FROM voice_calls WHERE call_sid LIKE $1`, [`res-${RUN}-%`]);
});

describe("callResultsSummary", () => {
  it("counts the last 7 days by outcome, line and recording — one org only", async () => {
    const s = await callResultsSummary(ORG, "7d", "America/New_York");
    expect(s.total).toBe(4);
    expect(s.outcomes).toEqual({ lead_submitted: 2, hangup: 1, spam: 1 });
    expect(s.recordings).toBe(3);
    expect(s.minutes).toBe(6);   // 150 + 60 + 60 + 60 seconds
    expect(s.lines).toEqual([{ label: "FL line", calls: 3, leads: 1 }, { label: "WA line", calls: 1, leads: 1 }]);
  });

  it("widens with the range: 30 days adds the engine's own call (by number), all time adds the old one", async () => {
    const d30 = await callResultsSummary(ORG, "30d", "America/New_York");
    expect(d30.total).toBe(5);
    expect(d30.lines).toContainEqual({ label: "+13605550142", calls: 1, leads: 0 });
    const all = await callResultsSummary(ORG, "all", "America/New_York");
    expect(all.total).toBe(6);
    expect(all.outcomes.declined).toBe(1);
  });

  it("an empty org is all zeros, and a bad timezone falls back to the CRM default", async () => {
    expect(await callResultsSummary(`nobody-${RUN}`, "all", null)).toMatchObject({ total: 0, minutes: 0, recordings: 0, outcomes: {}, lines: [] });
    expect(summaryTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(summaryTimezone("'; drop table x; --")).toBe("America/New_York");
    expect(summaryTimezone("Not/AZone")).toBe("America/New_York");
    const m = await callResultsSummary(ORG, "month", "Mars/Olympus");
    expect(m.timezone).toBe("America/New_York");
  });
});
