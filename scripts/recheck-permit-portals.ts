/**
 * Re-check every shipped permit portal right now, read-only (owner, 2026-10-05: "We have to test and make sure it
 * works."). Same liveness + on-topic test as the build (server/government-url-check.ts), but nothing is written: the
 * report lists each portal's status today so dead or drifted links can be fixed on purpose.
 *
 * Run: PERMIT_RECHECK_CONCURRENCY=24 npx tsx scripts/recheck-permit-portals.ts <out.json>
 */
import { readFileSync, writeFileSync } from "fs";
import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";

const out = process.argv[2] || "recheck.json";
const CONCURRENCY = Math.max(1, Math.min(48, Number(process.env.PERMIT_RECHECK_CONCURRENCY) || 16));
const portals = (JSON.parse(readFileSync("server/data/permit-portals.json", "utf8")) as any[]).filter((p) => p.url);

async function main() {
  const results: any[] = new Array(portals.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < portals.length) {
      const index = i++; const p = portals[index];
      // A hard cap per site (retries included) so one hanging server can't stall the run.
      const r: any = await Promise.race([
        fetchGovernmentPage(p.url).catch((e: any) => ({ httpStatus: null, html: "", finalUrl: null, error: String(e?.message ?? e) })),
        new Promise((resolve) => setTimeout(() => resolve({ httpStatus: null, html: "", finalUrl: null, error: "timed out (90 s)" }), 90_000)),
      ]);
      const c = classifyGovernmentPage(r, "permit");
      results[index] = { jurisdiction: p.jurisdiction, url: p.url, shipped: p.linkStatus, now: c.status, reason: c.reason, http: r.httpStatus, final: r.finalUrl };
      if (++done % 250 === 0) { console.log(`${done}/${portals.length}`); writeFileSync(out, JSON.stringify(results.filter(Boolean), null, 1)); }
    }
  }));
  writeFileSync(out, JSON.stringify(results, null, 1));
  const by: Record<string, number> = {};
  for (const r of results) by[r.now] = (by[r.now] ?? 0) + 1;
  console.log(`done: ${results.length} portals →`, JSON.stringify(by));
}
main().catch((e) => { console.error(e); process.exit(1); });
