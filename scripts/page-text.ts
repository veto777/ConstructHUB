/**
 * Read a page the way the portal gate does (plain fetch, then a real headless browser when the site blocks bots —
 * GOV_FETCH_BROWSER) and print its status line and visible text. Used by evidence checkers that must confirm a quote
 * is on an official page that blocks plain HTTP clients:
 *   npx tsx scripts/page-text.ts <url>
 */
import { fetchGovernmentPage } from "../server/government-url-check";
import * as cheerio from "cheerio";
process.env.GOV_FETCH_BROWSER = "1";
(async () => {
  const r = await fetchGovernmentPage(process.argv[2]);
  console.log(`STATUS ${r.httpStatus ?? r.error} VIA ${r.via ?? "fetch"} FINAL ${r.finalUrl}`);
  if (r.html) {
    const $ = cheerio.load(r.html); $("script,style,noscript").remove();
    console.log(($("title").text() + "\n" + $("body").text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n"));
  }
  process.exit(0);
})();
