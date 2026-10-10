/** Fleet coverage stats: how many catalog portals resolve to an adapter, per adapter, and alert capability. */
import { readFileSync } from "fs";
import { getAdapterFor, listAdapters, isLegacyAdapter } from "../server/scrapers/registry";

const rows: { jurisdiction: string; url: string | null; platform: string | null; linkStatus?: string }[] = JSON.parse(readFileSync("server/data/permit-portals.json", "utf8"));
const live = rows.filter(r => r.url && ["verified", "unconfirmed"].includes(r.linkStatus || ""));
const BEFORE = new Set(["smartgov", "tyler energov", "tyler technologies", "accela", "click2gov", "ftg portal"]);
const before = live.filter(r => r.platform && (BEFORE.has(r.platform.toLowerCase()) || (r.platform === "eTRAKiT" && /permits\.cob\.org/.test(r.url!)) || (["Skagit County", "Custom / GovPlatform"].includes(r.platform) && /skagitcounty\.net/.test(r.url!))));
const per = new Map<string, { adapter: string; search: string; listRecent: boolean; detail: boolean; legacy: boolean; count: number; labels: Set<string> }>();
let after = 0, alerts = 0;
for (const r of live) {
  const a = getAdapterFor({ platform: r.platform, jurisdiction: r.jurisdiction });
  if (!a) continue;
  if (a.capabilities.search.length) after++;
  if (a.capabilities.listRecent) alerts++;
  const e = per.get(a.platform) ?? { adapter: a.platform, search: a.capabilities.search.join("/"), listRecent: a.capabilities.listRecent, detail: a.capabilities.detail, legacy: isLegacyAdapter(a), count: 0, labels: new Set<string>() };
  e.count++; e.labels.add(r.platform!); per.set(a.platform, e);
}
console.log(`catalog rows: ${rows.length}; with live portal URL: ${live.length}`);
console.log(`searchable BEFORE (6 legacy labels + Bellingham eTRAKiT + Skagit): ${before.length}`);
console.log(`searchable AFTER (adapter with >=1 working search type): ${after}; alert-capable (listRecent): ${alerts}`);
const blocked = [...per.values()].filter(e => !e.search);
console.log(`registered but NOT searchable (blocked by anti-bot / login on every tenant tried): ${blocked.map(e => `${e.adapter} (${e.count} rows)`).join(", ") || "none"}`);
console.log(`adapters registered: ${listAdapters().length}`);
console.log("\n| adapter | catalog rows | labels | search | listRecent | detail |\n|---|---:|---:|---|---|---|");
for (const e of [...per.values()].sort((a, b) => b.count - a.count)) console.log(`| ${e.adapter}${e.legacy ? " (legacy)" : ""} | ${e.count} | ${e.labels.size} | ${e.search || "BLOCKED (none)"} | ${e.listRecent ? "yes" : "no"} | ${e.detail ? "yes" : "no"} |`);
