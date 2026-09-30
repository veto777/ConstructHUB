import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// Every `timestamp` (WITHOUT time zone) column holds UTC wall-clock time.
// Drizzle already reads and writes those columns as UTC, but `defaultNow()`
// runs now() in the SESSION time zone — on a server whose Postgres default is
// America/New_York that stored local time, and the rows came back 4h early
// ("4h ago" on a reply sent a minute ago). Pin every pooled session to UTC so
// now(), drizzle and the raw pg paths below all agree on one clock.
//   - parseInputDatesAsUTC: a JS Date bound as a raw query parameter is sent
//     as UTC, not the Node process's local time.
//   - the TIMESTAMP parser: raw pool.query() reads (drizzle overrides this
//     for its own queries) parse the stored UTC wall time as UTC. A value
//     with no offset gets "+00"; "infinity" and friends pass straight through.
pg.defaults.parseInputDatesAsUTC = true;
const parseTimestamptz = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v: string) =>
  parseTimestamptz(/^\d/.test(v) ? `${v}+00` : v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c TimeZone=UTC",
});

export const db = drizzle(pool, { schema });
