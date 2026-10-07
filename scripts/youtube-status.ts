/**
 * Print the company YouTube channel connection of the current environment's
 * database. Read-only; prints no token (the query never selects one).
 *
 *   npx tsx --env-file=.env scripts/youtube-status.ts
 *
 * Exit code: 0 connected and usable, 1 not connected or needs a reconnect, 2 could not read.
 */
import pg from "pg";
import { youtubeStatus } from "../server/youtube/store";
import { expectedChannelId } from "../server/youtube/client";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, options: "-c TimeZone=UTC", max: 1 });
  try {
    const { rows: [t] } = await pool.query(`SELECT to_regclass('public.youtube_connection') AS t`);
    if (!t?.t) {
      console.log("YouTube: not connected (the youtube_connection table does not exist yet — the app creates it at boot)");
      return 1;
    }
    const s = await youtubeStatus(pool);
    console.log(`YouTube: ${s.connected ? (s.needsReconnect ? "NEEDS RECONNECT" : "connected") : "not connected"}`);
    console.log(`  expected channel: ${expectedChannelId()}`);
    if (s.connected) {
      console.log(`  channel:          ${s.channelTitle ?? "(no title)"} (${s.channelId})`);
      console.log(`  connected at:     ${s.connectedAt}`);
      console.log(`  connected by:     ${s.connectedBy ?? "unknown"}`);
      console.log(`  scopes granted:   ${s.scopes.join(", ") || "none recorded"}`);
    }
    if (s.lastError) console.log(`  last error:       [${s.lastError.code ?? "?"}] ${s.lastError.message}${s.lastError.at ? ` (${s.lastError.at})` : ""}`);
    return s.connected && !s.needsReconnect ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().then((code) => process.exit(code), (e) => { console.error("youtube-status failed:", e?.message ?? e); process.exit(2); });
