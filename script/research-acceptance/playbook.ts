/**
 * --playbook: regenerates the source tables of docs/RESEARCH-DATA-PLAYBOOK.md from the code (for
 * ../research-acceptance.ts). Only the text between the GENERATED markers is replaced; everything around it is
 * written by hand and kept.
 *
 * Per state, every source the registry has (the coverage manifest, so the same list the public coverage page shows):
 * publisher host, official URL, access method, what it holds and is searched by, refresh and row floor, the keys it
 * needs (env names only), and robots.txt for its URLs, read live today through the research code's own robots
 * reader (server/research/http.ts robotsFor, about one request per host). Then the pack's `blocked` notes (sources
 * looked at and not used, with the reason), and the nationwide sources.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { robotsAllows, robotsFor } from "../../server/research/http";
import { ALL_BULK_SOURCES, allLicenseSourcesFor, liveLicenseSearchesFor } from "../../server/research/registry";
import { STATE_PACKS } from "../../server/research/states";
import { LOCAL_BLOCKED } from "../../server/research/states/local";
import { complaintSourcesFor } from "../../server/research/records";
import { KEY_VERSION, MIN_SHARE_OF_PREVIOUS } from "../../server/research/bulk";
import { STATE_CODES } from "@shared/research-reports";
import type { CoverageManifest, CoverageSource } from "@shared/research-coverage";

const ROOT = join(import.meta.dirname, "..", "..");
const DOC = join(ROOT, "docs", "RESEARCH-DATA-PLAYBOOK.md");
const START = "<!-- GENERATED: script/research-acceptance.ts --playbook (do not edit by hand between these markers) -->";
const END = "<!-- END GENERATED -->";

const md = (s: string | null | undefined) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const hostOf = (u: string | null | undefined) => { try { return u ? new URL(u).hostname : ""; } catch { return ""; } };
const SOCRATA = /\/(?:d|resource)\/[a-z0-9]{4}-[a-z0-9]{4}/i;

/** robots.txt for a URL, read live: "allowed", "disallowed", or why it couldn't be read. */
const robotsCache = new Map<string, string>();
async function robots(url: string | null | undefined): Promise<string> {
  if (!url || !/^https?:/.test(url)) return "checked at run time (its URL lives in the search code, not the registry)";
  const u = new URL(url);
  const key = u.origin + u.pathname;
  if (robotsCache.has(key)) return robotsCache.get(key)!;
  let out: string;
  try {
    const r = await robotsFor(u.origin);
    out = r.denied ? `unreadable: ${r.denied}` : robotsAllows(r.rules, u.pathname + u.search) ? "allowed" : `DISALLOWED (${u.pathname})`;
  } catch (err: any) { out = `unreadable: ${String(err?.message ?? err).slice(0, 80)}`; }
  robotsCache.set(key, out);
  return out;
}

function manifest(): CoverageManifest {
  const out = join(ROOT, "script", "research-acceptance", "results", ".manifest.json");
  mkdirSync(join(ROOT, "script", "research-acceptance", "results"), { recursive: true });
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = spawnSync("npx", ["tsx", "script/research-coverage.ts", out], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"], timeout: 10 * 60_000 });
  if (r.status !== 0) throw new Error(`coverage manifest failed: ${String(r.stderr).slice(-400)}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

/** The machine URL a source is read from, when the code holds it apart from the page a reader opens. */
function apiUrlOf(state: string, s: CoverageSource): string | null {
  const lic = allLicenseSourcesFor(state).find((x) => x.source === s.label);
  if (lic) return lic.url;
  const pack = STATE_PACKS.find((p) => p.state === state);
  const enf = pack?.enforcement?.find((x) => x.source === s.label);
  if (enf) return enf.url;
  const c = complaintSourcesFor(state).find((x) => x.source === s.label);
  return c ? c.url : null;
}

function accessOf(state: string, s: CoverageSource): string {
  if (s.mode === "file") {
    const b = ALL_BULK_SOURCES.find((x) => x.id === s.fileId);
    const hours = b?.utcHours?.length ? `, downloads only at UTC ${b.utcHours[0]}–${b.utcHours[b.utcHours.length - 1]}` : "";
    return `bulk file \`${s.fileId}\` (official download, indexed${hours})`;
  }
  const api = apiUrlOf(state, s) ?? s.url ?? "";
  if (SOCRATA.test(api)) return "Socrata SODA API, live per report";
  if (liveLicenseSearchesFor(state).some((x) => x.source === s.label)) return "the agency's own lookup (page or API), live per report";
  return "live search per report";
}

function keysOf(state: string, s: CoverageSource): string {
  const k: string[] = [];
  if (SOCRATA.test(apiUrlOf(state, s) ?? s.url ?? "")) k.push("SOCRATA_APP_TOKEN (optional)");
  if (s.needs === "osha") k.push("DOL_API_KEY");
  if (state === "VT" && /fire safety/i.test(s.label)) k.push("CHROMIUM_PATH (headless browser)");
  return k.join(", ") || "none";
}

const KIND = (s: CoverageSource) => `${s.kinds.join(", ")}${s.companiesOnly ? " (companies only)" : ""}`;

export async function playbook(_resultsDir: string): Promise<number> {
  const m = manifest();
  const lines: string[] = [START, "", `Generated ${new Date().toISOString().slice(0, 10)} from the registry (${m.states.reduce((n, s) => n + s.sources.length, 0)} state sources, ${m.nationwide.length} nationwide). robots.txt was read live on that date for each source's page and API URL (fails closed: an unreadable robots.txt counts as no). Bulk-file floors: a new load needs more than ${MIN_SHARE_OF_PREVIOUS * 100}% of the last good load and at least the row floor; key format version ${KEY_VERSION}.`, ""];

  lines.push("### Nationwide (every report)", "", "| Source | Access | Holds | Searched by | Needs | robots.txt |", "|---|---|---|---|---|---|");
  for (const n of m.nationwide) {
    const b = n.fileId ? ALL_BULK_SOURCES.find((x) => x.id === n.fileId) : null;
    lines.push(`| ${md(n.label)}${n.url ? ` ([page](${n.url}))` : ""} | ${n.mode === "file" ? `bulk file \`${n.fileId}\`, every ${b?.everyHours ?? "?"}h, floor ${b?.minRows ?? "?"}` : "live API per report"} | ${md(KIND(n))} | ${n.ids.join(", ")} | ${n.needs === "osha" ? "DOL_API_KEY" : n.needs === "samExclusions" ? "the file loaded" : "none"} | ${await robots(n.url)} |`);
  }
  lines.push("");

  for (const code of STATE_CODES) {
    const st = m.states.find((s) => s.state === code)!;
    const pack = STATE_PACKS.find((p) => p.state === code);
    lines.push(`### ${code}`, "");
    lines.push(`Checked live: ${st.checked ?? "never (no pack)"}. ${st.noStatewideGcLicense ? `No statewide GC license: ${md(st.noStatewideGcLicense)}` : ""}`.trim(), "");
    if (st.sources.length) {
      lines.push("| Source | Publisher | Access | Holds | Searched by | Refresh / floor | Keys | robots.txt (page; API) |", "|---|---|---|---|---|---|---|---|");
      for (const s of st.sources) {
        const b = s.fileId ? ALL_BULK_SOURCES.find((x) => x.id === s.fileId) : null;
        const api = apiUrlOf(code, s);
        const rob = [await robots(s.url), ...(api && api !== s.url ? [await robots(api)] : [])].join("; ");
        lines.push(`| ${md(s.label)}${s.local ? " (city/county)" : ""}${s.url ? ` ([page](${s.url}))` : ""} | ${md(hostOf(s.url) || hostOf(api) || "-")} | ${md(accessOf(code, s))} | ${md(KIND(s))} | ${s.ids.join(", ") || "-"} | ${b ? `every ${b.everyHours}h, floor ${b.minRows}${b.rowShape ? `, row_shape ${b.rowShape}` : ""}` : "live"} | ${md(keysOf(code, s))} | ${md(rob)} |`);
      }
    } else lines.push("No source is searched for this state yet.");
    const blocked = pack?.blocked ?? [];
    if (blocked.length) { lines.push("", "Looked at and not used (from the pack's `blocked` notes):", ""); for (const b of blocked) lines.push(`- ${md(b)}`); }
    lines.push("");
  }
  lines.push("### City and county sources looked at and not used", "");
  for (const b of LOCAL_BLOCKED) lines.push(`- ${md(b)}`);
  lines.push("", END);

  const body = lines.join("\n");
  const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : `# Research data playbook\n\n${START}\n${END}\n`;
  const a = doc.indexOf(START), z = doc.indexOf(END);
  if (a < 0 || z < 0) throw new Error(`${DOC}: the GENERATED markers are missing`);
  writeFileSync(DOC, doc.slice(0, a) + body + doc.slice(z + END.length));
  console.log(`wrote ${DOC} (${robotsCache.size} robots.txt checks)`);
  return 0;
}
