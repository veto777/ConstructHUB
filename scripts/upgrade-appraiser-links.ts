/**
 * Property records (server/data/appraisers.json): re-check the links that are "unconfirmed" (shown as "not
 * auto-verified") or "dead", with the real-browser fallback, and upgrade only. Every office and its link come from
 * NETR Online (sourceUrl); this pass never invents a URL — it re-tests the office's own NETR-listed candidateUrl.
 *   - becomes "verified" when the page loads (plain fetch, or headless Chromium past a bot wall), reads as an
 *     assessor / appraisal / property-records page, and names the county;
 *   - otherwise the entry is left exactly as it was (no downgrades in this pass).
 * Run: GOV_FETCH_BROWSER=1 npx tsx scripts/upgrade-appraiser-links.ts [concurrency]
 */
import { readFileSync, writeFileSync } from "fs";
import * as cheerio from "cheerio";
import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";

const FILE = "server/data/appraisers.json";
const CONCURRENCY = Math.max(1, Math.min(24, Number(process.argv[2]) || 8));
const apps: any[] = JSON.parse(readFileSync(FILE, "utf8"));
const loose = (s: string) => s.toLowerCase().replace(/\bsaint\b/g, "st").replace(/[^a-z0-9]/g, "");

async function main() {
  const todo = apps.map((a, i) => ({ a, i })).filter(({ a }) => ["unconfirmed", "dead"].includes(a.linkStatus) && (a.candidateUrl || a.portalUrl));
  let next = 0, upgraded = 0, checked = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const { a } = todo[next++];
      const url = a.candidateUrl || a.portalUrl;
      const page = await Promise.race([
        fetchGovernmentPage(url).catch((e: any) => ({ httpStatus: null, html: "", finalUrl: null, error: String(e?.message ?? e) })),
        new Promise<any>((r) => setTimeout(() => r({ httpStatus: null, html: "", finalUrl: null, error: "timed out (90 s)" }), 90_000)),
      ]);
      const verdict = classifyGovernmentPage(page, "appraiser");
      const $ = cheerio.load(page.html || ""); $("script,style").remove();
      const names = loose($("title").text() + " " + $("body").text()).includes(loose(String(a.county)));
      checked++;
      if (verdict.status === "live" && names) {
        a.portalUrl = page.finalUrl || url; a.linkStatus = "verified"; a.lastVerifiedAt = new Date().toISOString(); upgraded++;
      }
      if (checked % 100 === 0) console.log(`${checked}/${todo.length} checked, ${upgraded} upgraded`);
    }
  }));
  writeFileSync(FILE, JSON.stringify(apps, null, 2) + "\n");
  console.log(`done: ${checked} re-checked, ${upgraded} upgraded to verified; the rest unchanged`);
}
main().catch((e) => { console.error(e); process.exit(1); });
