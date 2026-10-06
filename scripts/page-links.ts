/**
 * Read a page the way the portal gate does (plain fetch, then a real headless browser when the site blocks bots —
 * GOV_FETCH_BROWSER) and print its final URL, status and every link, optionally filtered:
 *   npx tsx scripts/page-links.ts <url> [filter-regex]
 */
import { fetchGovernmentPage } from "../server/government-url-check";
import * as cheerio from "cheerio";
process.env.GOV_FETCH_BROWSER = "1";
const [url, filter] = process.argv.slice(2);
(async () => {
  const r = await fetchGovernmentPage(url);
  console.log(`STATUS ${r.httpStatus ?? r.error} VIA ${r.via ?? "fetch"} FINAL ${r.finalUrl}`);
  if (!r.html) return;
  const $ = cheerio.load(r.html); const rx = filter ? new RegExp(filter, "i") : null;
  console.log(`TITLE ${$("title").text().trim()}`);
  const seen = new Set<string>();
  $("a[href]").each((_, a) => {
    let h = $(a).attr("href")!; try { h = new URL(h, r.finalUrl).href; } catch { return; }
    const t = $(a).text().replace(/\s+/g, " ").trim().slice(0, 80);
    if (seen.has(h) || (rx && !rx.test(h + " " + t))) return; seen.add(h); console.log(`${h}\t${t}`);
  });
})();
