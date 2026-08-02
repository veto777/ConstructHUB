/**
 * Trigger the HOVER backfill for an org directly (the same work the
 * POST /api/crm/integrations/hover/sync route does, without needing the
 * owner's browser session): refresh token -> list jobs -> ingest completed
 * (customer match email/phone/address + measurements + PDF + 3D link).
 * Run: npx tsx --env-file=.env scripts/hover-sync.ts --org=<id>
 */
const argVal = (f: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ORG_ID = argVal("--org");
if (!ORG_ID) throw new Error("--org required");

const { getHoverAccessToken, ingestHoverJob } = await import("../server/crm/hover");

async function main() {
  const token = await getHoverAccessToken(ORG_ID!);
  console.log("access token ok");
  const jobs: any[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(`https://hover.to/api/v3/jobs?page=${page}&page_size=100`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`jobs list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j: any = await res.json();
    const rows = j?.results ?? j?.data ?? j?.jobs ?? [];
    if (!Array.isArray(rows) || !rows.length) break;
    jobs.push(...rows);
    const totalPages = j?.pagination?.total_pages;
    // v3 caps page_size at 25: stop on a short page, otherwise keep going.
    if (totalPages ? page >= totalPages : rows.length < 25) break;
    page++;
    if (page > 40) break;
  }
  console.log(`jobs on account: ${jobs.length}`);
  const completed = jobs.filter((j) => (j.reconstruction_state ?? j.state) === "completed");
  console.log(`completed: ${completed.length}`);
  const stats = { ingested: 0, skipped: 0, errors: 0 };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (const job of completed) {
    // HOVER rate-limits aggressively; throttle and back off on 429.
    let attempt = 0;
    for (;;) {
      try {
        // ingestHoverJob resolves the org's access token itself — pass no fetcher.
        const r: any = await ingestHoverJob(ORG_ID!, job.id);
        if (r?.alreadyIngested) stats.skipped++;
        else stats.ingested++;
        if (stats.ingested % 10 === 0 && stats.ingested) console.log(`  … ${stats.ingested} ingested`);
        break;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes("429") && attempt < 5) {
          attempt++;
          const wait = 15000 * attempt;
          console.log(`  429 on job ${job.id} — backing off ${wait / 1000}s (attempt ${attempt})`);
          await sleep(wait);
          continue;
        }
        stats.errors++;
        console.log(`  ⚠ job ${job.id}: ${msg}`);
        break;
      }
    }
    await sleep(2500); // steady-state throttle
  }
  console.log(`done: ${JSON.stringify(stats)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
