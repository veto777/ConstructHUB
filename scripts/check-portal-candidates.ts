/**
 * Dry-run the permit-portal gate (scripts/build-permit-portals.ts) on a candidates file, without writing anything.
 * For discovery work: a candidate only ships if (1) its sourceUrl — an official page — links to the exact url,
 * (2) the url is live and permit-specific, (3) the page names the jurisdiction. This prints the status the real build
 * would give each one, so researchers keep only what will pass.
 *
 * Run: npx tsx scripts/check-portal-candidates.ts <candidates.json>   ([{ jurisdiction, url, platform, sourceUrl }])
 */
import { readFileSync } from "fs";
import * as cheerio from "cheerio";
import { classifySourceListedLink } from "../server/government-link-policy";
import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";

type Candidate = { jurisdiction: string; url: string; platform?: string; sourceUrl?: string };

async function check(c: Candidate) {
  if (!c.sourceUrl) return { status: "none", why: "no sourceUrl" };
  const source = await fetchGovernmentPage(c.sourceUrl);
  const $s = cheerio.load(source.html);
  const linked = source.httpStatus >= 200 && source.httpStatus < 300 && $s("a[href]").toArray().some((el) => {
    try { return new URL($s(el).attr("href")!, source.finalUrl).href === c.url; } catch { return false; }
  });
  if (!linked) return { status: "none", why: `source page (${source.httpStatus}) has no <a href> exactly equal to the url` };
  const response = await fetchGovernmentPage(c.url);
  const page = classifyGovernmentPage(response, "permit");
  const $ = cheerio.load(response.html); $("script,style").remove();
  const norm = (s: string) => s.toLowerCase().replace(/\bsaint\b/g, "st").replace(/[^a-z0-9]/g, "");
  const name = c.jurisdiction.split(",")[0].replace(/\b(county|parish|borough)\b/gi, "").trim();
  const identity = norm($("body").text() + $("title").text()).includes(norm(name));
  const status = classifySourceListedLink(c.url, { ...page, httpStatus: response.httpStatus, finalUrl: response.finalUrl, jurisdictionMatched: identity },
    { state: c.jurisdiction.slice(-2), jurisdiction: name, sourceListed: true });
  return { status, why: `http ${response.httpStatus}, final ${response.finalUrl}, names jurisdiction: ${identity}, page: ${JSON.stringify(page).slice(0, 160)}` };
}

async function main() {
  const list: Candidate[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
  for (const c of list) {
    const r = await check(c).catch((e) => ({ status: "error", why: String(e?.message ?? e) }));
    console.log(`${r.status.padEnd(11)} ${c.jurisdiction} — ${c.url} — ${r.why}`);
  }
}
main();
