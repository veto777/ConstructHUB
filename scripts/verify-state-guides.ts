/**
 * GET-only checker for the Master Class state-guide agency links
 * (server/data/state-guides.json: Secretary of State, licensing board,
 * workers' comp and tax agency URLs). Same link policy as the permit/appraiser
 * pipelines (CLAUDE.md, audit a4 round 2):
 *   verified    — page is live, names the state and is on-topic for the agency
 *   unconfirmed — the check was blocked or inconclusive; the link stays visible
 *   dead        — 404/410, soft 404, parked, DNS/refused, invalid TLS → null
 *   none        — no source URL (never guessed)
 *
 * Report only:   npx tsx scripts/verify-state-guides.ts --report out.json
 * Apply:         npx tsx scripts/verify-state-guides.ts --apply [--replacements r.json]
 * A replacement ({ state, field, url, source }) is only written after it passes the
 * same check as verified or unconfirmed; otherwise the dead link becomes null.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { fetchGovernmentPage, governmentFailureIsDead } from "../server/government-url-check";

type Field = "sos_url" | "licensing_board_url" | "workers_comp_url" | "tax_board_url";
type Tier = "verified" | "unconfirmed" | "dead" | "none";
const FIELDS: Field[] = ["sos_url", "licensing_board_url", "workers_comp_url", "tax_board_url"];
const TOPIC: Record<Field, RegExp> = {
  sos_url: /business|corporat|entit(y|ies)|llc|limited liability|filing|registration/i,
  licensing_board_url: /licens|contractor|board|registration|certif/i,
  workers_comp_url: /workers'? ?comp|workers['’]? compensation|work comp|injur|employer/i,
  tax_board_url: /tax|revenue/i,
};
const DATA = join(import.meta.dirname, "..", "server", "data", "state-guides.json");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

export async function checkAgencyUrl(url: string, field: Field, stateName: string) {
  const r = await fetchGovernmentPage(url);
  const $ = cheerio.load(r.html || ""); $("script,style,noscript").remove();
  const title = $("title").text().replace(/\s+/g, " ").trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const base = { url, finalUrl: r.finalUrl, httpStatus: r.httpStatus, title: title.slice(0, 160) };
  if ([404, 410].includes(r.httpStatus)) return { ...base, tier: "dead" as Tier, reason: `HTTP ${r.httpStatus}` };
  if (!r.httpStatus && governmentFailureIsDead(r.error || "")) return { ...base, tier: "dead" as Tier, reason: r.error };
  // A 403 that renders a "not found" page is a missing page, not a bot block.
  if (r.httpStatus >= 400 && r.httpStatus < 500 && /not found|cannot be found/i.test(title)) return { ...base, tier: "dead" as Tier, reason: `HTTP ${r.httpStatus} not-found page` };
  if (!r.httpStatus || r.httpStatus >= 400) return { ...base, tier: "unconfirmed" as Tier, reason: r.error || `HTTP ${r.httpStatus} (blocked or transient)` };
  if (/domain (is )?(for sale|parked)|buy this domain|website is for sale/i.test(title + text)) return { ...base, tier: "dead" as Tier, reason: "parked/for-sale domain" };
  if (/^(404|page not found|not found|error)\b|page (you requested |was )?not found|page cannot be found/i.test(title) ||
      (text.length < 1800 && /page (you requested |was )?not found|404 -|site not found|page cannot be found/i.test(text))) return { ...base, tier: "dead" as Tier, reason: "soft 404" };
  if (/just a moment|access denied|verify you are human|attention required|request rejected/i.test(title + text.slice(0, 200))) return { ...base, tier: "unconfirmed" as Tier, reason: "bot challenge" };
  const names = stateName === "Washington" ? /Washington State|WA State|\bWashington\b/ : new RegExp(`\\b${stateName}\\b`, "i");
  const host = new URL(r.finalUrl || url).hostname;
  const stateHost = /\.(gov|us)$/.test(host) || names.test(host.replace(/[.-]/g, " "));
  if (!(names.test(title + " " + text) || stateHost)) return { ...base, tier: "unconfirmed" as Tier, reason: "page does not name the state" };
  if (!TOPIC[field].test(title + " " + text)) return { ...base, tier: "unconfirmed" as Tier, reason: "no on-topic content" };
  return { ...base, tier: "verified" as Tier, reason: "GET succeeded; names the state and is on-topic" };
}

async function mapPool<T>(items: T[], fn: (item: T) => Promise<void>, conc = 4) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

async function main() {
  const guides: any[] = JSON.parse(readFileSync(DATA, "utf8"));
  const replacements: { state: string; field: Field; url: string; source: string }[] = arg("--replacements") ? JSON.parse(readFileSync(arg("--replacements")!, "utf8")) : [];
  const jobs: { g: any; field: Field }[] = guides.flatMap(g => FIELDS.map(field => ({ g, field })));
  const results: any[] = [];
  await mapPool(jobs, async ({ g, field }) => {
    const url: string | null = g[field] ?? null;
    if (!url) { results.push({ state: g.state_code, field, url: null, tier: "none" }); return; }
    let result: any = { state: g.state_code, field, ...(await checkAgencyUrl(url, field, g.state_name)) };
    if (result.tier === "dead") {
      const replacement = replacements.find(r => r.state === g.state_code && r.field === field);
      if (replacement) {
        const check = await checkAgencyUrl(replacement.url, field, g.state_name);
        result = { ...result, replacement: { ...check, source: replacement.source } };
      }
    }
    results.push(result);
    process.stdout.write(`${g.state_code} ${field} ${result.tier}${result.replacement ? ` -> ${result.replacement.tier}` : ""}\n`);
  });
  results.sort((a, b) => a.state.localeCompare(b.state) || FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field));
  const counts = results.reduce((acc: any, r) => { acc[r.tier] = (acc[r.tier] || 0) + 1; return acc; }, {});
  console.log(counts);
  if (arg("--report")) writeFileSync(arg("--report")!, JSON.stringify(results, null, 2));
  if (!args.includes("--apply")) return;
  const checkedAt = new Date().toISOString().slice(0, 10);
  for (const g of guides) {
    for (const field of FIELDS) {
      const r = results.find(x => x.state === g.state_code && x.field === field)!;
      let tier: Tier = r.tier;
      if (tier === "dead") {
        const ok = r.replacement && r.replacement.tier !== "dead";
        g[field] = ok ? r.replacement.url : null;
        // A nulled link keeps its "dead" status so the provenance stays honest.
        if (ok) {
          tier = r.replacement.tier;
          // Audit trail: what was replaced, why, and where the new URL came from.
          g.link_replacements = [...(g.link_replacements || []).filter((x: any) => x.field !== field),
            { field, previous: r.url, previous_reason: r.reason, source: r.replacement.source, checked_at: checkedAt }];
        }
      }
      g[`${field}_status`] = tier;
    }
    g.links_checked_at = checkedAt;
  }
  writeFileSync(DATA, JSON.stringify(guides, null, 2) + "\n");
  console.log(`Applied link statuses to ${guides.length} state guides (${checkedAt}).`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) await main();
