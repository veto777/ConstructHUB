/**
 * The app stores `timestamp` (WITHOUT time zone) columns as UTC wall time.
 * server/db.ts pins every pooled session to UTC so defaultNow()/now() agree
 * with drizzle's UTC mapping — without it a Postgres whose default zone is
 * America/New_York stored local time and fresh rows read back 4h old.
 * Read-only: no rows are written.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";

const near = (d: Date, ms = 60_000) => Math.abs(d.getTime() - Date.now()) < ms;

describe.skipIf(!process.env.DATABASE_URL)("db session clock", () => {
  afterAll(async () => { await pool.end(); });

  it("pins every pooled session to UTC", async () => {
    const { rows } = await pool.query("select current_setting('TimeZone') as tz");
    expect(rows[0].tz).toBe("UTC");
  });

  it("a now()-filled timestamp column reads back as the current instant (raw pg)", async () => {
    const { rows } = await pool.query("select now()::timestamp as t");
    expect(rows[0].t).toBeInstanceOf(Date);
    expect(near(rows[0].t)).toBe(true);
  });

  it("drizzle raw SQL returns the zone-less UTC wall time", async () => {
    const r: any = await db.execute(sql`select now()::timestamp as t`);
    const t = String((r.rows ?? r)[0].t);
    expect(near(new Date(`${t.replace(" ", "T").replace(/(\.\d{3})\d+$/, "$1")}Z`))).toBe(true);
  });

  it("a JS Date bound as a raw parameter round-trips through timestamp", async () => {
    const now = new Date();
    const { rows } = await pool.query("select $1::timestamp as t", [now]);
    expect((rows[0].t as Date).getTime()).toBe(now.getTime());
  });

  it("infinity passes through the timestamp parser", async () => {
    const { rows } = await pool.query("select 'infinity'::timestamp as t");
    expect(rows[0].t).toBe(Infinity);
  });
});
