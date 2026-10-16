/**
 * The all-states acceptance run for the research reports: proves, state by state, that a paid report finds what it
 * should, says what it could not search, and keeps the privacy rules. Re-runnable by anyone.
 *
 *   . ~/research-briefs/allstates.env   # a scratch database, never the live one
 *   npx tsx script/research-acceptance.ts [--state OH,WA …] [--only-failed] [--use-loaded] [--portals] [--repick]
 *                                         [--concurrency 3] [--add-subject ST:role:<bulk id or source label>[:query]]
 *   npx tsx script/research-acceptance.ts --prod-health      # read-only checks of production over ssh vb11
 *   npx tsx script/research-acceptance.ts --playbook         # regenerates docs/RESEARCH-DATA-PLAYBOOK.md tables
 *
 * 1. Golden subjects (script/research-acceptance/subjects.json): per state, a company with an active license, a
 *    company with a real enforcement or discipline record, and an individual license holder, taken from the state's
 *    own published data (./research-acceptance/pick.ts), never invented. Picked once and kept; --repick picks again
 *    for the states given. A state with nothing usable gets an explicit null with the reason.
 * 2. Each subject runs as its own order through the same code path as a paid order: withRun(() => runResearch(order))
 *    (server/research/runner.ts, what drainResearchQueue runs for POST /orders/:id/run). Permit portals are left out
 *    unless --portals (a full portal sweep is the Search feature's own job and takes hours per state); the report
 *    then says "Not searched: permit portals", which the checks below expect.
 * 3. Checks per state, ranked: missed record > privacy > silent failure > source error > slow.
 *      - recall: the golden record is in the report, in the right section (own licenses for a license, enforcement
 *        with the right category for an enforcement record, complaints for a complaint);
 *      - every source the registry lists for the state (the coverage manifest, script/research-coverage.ts) is in
 *        the report as searched or as not searched with a reason; "Could not search" is a source error;
 *      - privacy on the final report: no street or phone for an individual's or unknown holder's license, no
 *        disciplinary text on any license, standing words only in a person report and on individuals' licenses, no
 *        enforcement, complaint, court or OSHA record in a person report;
 *      - "not searched" never reads as 0 (source notes and the report summary);
 *      - every URL in the report is on a host the source code names (no made-up links);
 *      - run time per report (slow above SLOW_MS).
 * 4. Output: script/research-acceptance/results/acceptance-<date>.json and .md (a state × source matrix). Exit 1 on
 *    any failure.
 *
 * Bulk files: the run searches what DATABASE_URL already holds. Without --use-loaded a file the database lacks is
 * downloaded and loaded first (within the publisher's download hours, if it sets any); with it, nothing is downloaded.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { runResearch } from "../server/research/runner";
import { withRun } from "../server/research/http";
import { loadSource, sourceStatus, type BulkSource } from "../server/research/bulk";
import { allBulkSourcesFor, nationwideBulkSources } from "../server/research/registry";
import { standingStatus } from "../server/research/privacy";
import { personNamed } from "../server/research/xref";
import { researchOrderSchema, reportSummary, STATE_CODES, type LicenseHit, type ResearchReport, type ResearchSubjectReport } from "@shared/research-reports";
import type { CoverageManifest, CoverageSource } from "@shared/research-coverage";
import { isGolden, pickFromSource, pickState, type Golden, type GoldenSlot, type StateSubjects } from "./research-acceptance/pick";

const DIR = join(import.meta.dirname, "research-acceptance");
const RESULTS = join(DIR, "results");
const SUBJECTS = join(DIR, "subjects.json");
const SLOW_MS = 5 * 60_000;

const args = process.argv.slice(2);
const has = (k: string) => args.includes(k);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const stateArgs = args.flatMap((a, i) => (args[i - 1] === "--state" ? a.split(",") : [])).map((s) => s.trim().toUpperCase()).filter(Boolean);
const today = () => new Date().toISOString().slice(0, 10);
const log = (m: string) => console.log(`[acceptance ${new Date().toISOString().slice(11, 19)}] ${m}`);

// ── Types of the results file ────────────────────────────────────────────────────────────────────────────────────

type Severity = "missed" | "privacy" | "silent" | "error" | "slow";
const RANK: Severity[] = ["missed", "privacy", "silent", "error", "slow"];
type Issue = { severity: Severity; state: string; source: string; subject: string; detail: string };
type Cell = { source: string; section: "licenses" | "records"; cell: string };
type SubjectResult = { role: string; name: string; kind: string; golden: Golden; ms: number; found: boolean; where: string | null; cells: Cell[]; issues: Issue[]; summary: string;
  /** Links on a host the code never names: taken from the publisher's own rows (a URL field), listed to look over. */
  publisherLinks: string[] };
type StateResult = { state: string; subjects: SubjectResult[]; nulls: { role: string; reason: string }[]; loads: string[]; issues: Issue[] };
type Results = { generatedAt: string; commit: string; options: Record<string, unknown>; states: StateResult[]; issues: Issue[] };

// ── The registry's own list of sources per state (the coverage manifest, built under its network guard) ──────────

function coverageManifest(): CoverageManifest {
  const out = join(RESULTS, ".manifest.json");
  mkdirSync(RESULTS, { recursive: true });
  const env = { ...process.env };
  delete env.DATABASE_URL; // the generator needs no database; its guard refuses connections anyway
  const r = spawnSync("npx", ["tsx", "script/research-coverage.ts", out], { cwd: join(DIR, "..", ".."), env, stdio: ["ignore", "ignore", "pipe"], timeout: 10 * 60_000 });
  if (r.status !== 0) throw new Error(`coverage manifest failed: ${String(r.stderr).slice(-500)}`);
  return JSON.parse(readFileSync(out, "utf8"));
}

/** Every host a URL in the research code names: a report link must be on one of them. */
function knownHosts(): Set<string> {
  const hosts = new Set<string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1].toLowerCase());
        // A host the code joins into a URL (soda("data.texas.gov", id) → https://data.texas.gov/d/<id>).
        for (const m of text.matchAll(/["'`]((?:[a-z0-9-]+\.)+(?:gov|us|org|com|net|edu|io|info))["'`/]/gi)) hosts.add(m[1].toLowerCase());
      }
    }
  };
  walk(join(DIR, "..", "..", "server", "research"));
  walk(join(DIR, "..", "..", "shared"));
  return hosts;
}

// ── Subjects ─────────────────────────────────────────────────────────────────────────────────────────────────────

function readSubjects(): Record<string, StateSubjects> {
  if (!existsSync(SUBJECTS)) return {};
  return Object.fromEntries((JSON.parse(readFileSync(SUBJECTS, "utf8")).states as StateSubjects[]).map((s) => [s.state, s]));
}
function writeSubjects(all: Record<string, StateSubjects>) {
  const states = STATE_CODES.filter((s) => all[s]).map((s) => all[s]);
  writeFileSync(SUBJECTS, JSON.stringify({ note: "Golden subjects, taken from each state's published data by script/research-acceptance/pick.ts; picked once and kept (--repick to pick again).", states }, null, 1) + "\n");
}

// ── Bulk files the database lacks ─────────────────────────────────────────────────────────────────────────────────

async function loadMissing(sources: BulkSource[]): Promise<string[]> {
  const notes: string[] = [];
  for (const src of sources) {
    const st = await sourceStatus(src.id);
    if (st.loaded) continue;
    if (has("--use-loaded")) { notes.push(`${src.id}: not loaded in this database (--use-loaded: not downloaded)`); continue; }
    if (src.utcHours && !src.utcHours.includes(new Date().getUTCHours())) { notes.push(`${src.id}: not loaded; the publisher allows downloads only at UTC hours ${src.utcHours.join(",")}`); continue; }
    const t0 = Date.now();
    try {
      const n = await loadSource(src);
      notes.push(`${src.id}: downloaded and loaded ${n} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (err: any) {
      notes.push(`${src.id}: load FAILED: ${String(err?.message ?? err).slice(0, 200)}`);
    }
  }
  return notes;
}

// ── Checks ───────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (v: string | null | undefined) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
};
/** A street left in an address once city, state and ZIP are taken off: a house number or a PO box. */
const hasStreet = (a: string) => /\b\d+[A-Z]?\s+[A-Z]/i.test(a.replace(/\b\d{5}(?:-\d{4})?\b/g, "")) || /\bP\.?\s?O\.?\s+BOX\b/i.test(a);
const leadingCount = (note: string): number | null => { const m = note.match(/^\s*(\d+)\s/); return m ? Number(m[1]) : null; };
const ZERO_WORDS = /^\s*0\b|\b0 (match|record|complaint|inspection|case|license|permit)|\bnone found\b|\bno (match|record)s? found\b/i;

function urlsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") { if (/^https?:\/\//i.test(v)) out.push(v); }
  else if (Array.isArray(v)) for (const x of v) urlsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) urlsIn(x, out);
  return out;
}

function recall(g: Golden, s: ResearchSubjectReport): { found: boolean; where: string | null; issue: string | null } {
  const e = g.expected;
  if (e.kind === "license") {
    // By license number; a record the publisher gives no number is matched by its source and name.
    const same = (h: LicenseHit) => e.licenseNumber ? norm(h.licenseNumber) === norm(e.licenseNumber)
      : h.source === e.source && (e.matchedOn === "business" ? sameName(h.businessName, e.businessName)
        : [h.principal, ...(h.people ?? []).map((p) => p.name)].some((n) => sameName(n, e.person) || personNamed(e.person ?? "", h)));
    const own = s.licenses.find(same);
    if (own) {
      if (own.matchedOn !== e.matchedOn) return { found: true, where: `licenses (matched on ${own.matchedOn})`, issue: `found, but matched on "${own.matchedOn}", expected "${e.matchedOn}"` };
      return { found: true, where: `licenses: ${own.source}`, issue: null };
    }
    const rel = (s.relatedLicenses ?? []).find(same);
    if (rel) return { found: false, where: `related licenses (${rel.relatedVia ?? "?"})`, issue: `license ${e.licenseNumber} listed only as a related record (${rel.relatedVia ?? "no tie"}), not as the subject's own` };
    return { found: false, where: null, issue: `license ${e.licenseNumber ?? `"${e.businessName ?? e.person}" (no number published)`} (${e.source}) not in the report` };
  }
  if (e.kind === "enforcement") {
    const match = (h: { source: string; id: string | null; name: string | null }) =>
      (e.id ? norm(h.id) === norm(e.id) : true) && (sameName(h.name, e.name) || sameName(h.name, g.name)) && (h.source === e.source || !!e.id);
    const own = (s.enforcement ?? []).find(match);
    if (own) {
      if (own.category !== e.category) return { found: true, where: `enforcement (${own.category})`, issue: `found under category "${own.category}", expected "${e.category}"` };
      return { found: true, where: `enforcement: ${own.source}`, issue: null };
    }
    const rel = (s.relatedEnforcement ?? []).find(match);
    if (rel) return { found: false, where: "related enforcement", issue: `record ${e.id ?? e.name} listed only as related (${rel.relatedVia ?? "no tie"})` };
    return { found: false, where: null, issue: `enforcement record ${e.id ?? ""} "${e.name}" (${e.source}, ${e.category}) not in the report` };
  }
  const own = (s.complaints ?? []).find((c) => (e.id && c.id === e.id) || sameName(c.business, e.business));
  return own ? { found: true, where: `complaints: ${own.source}`, issue: null } : { found: false, where: null, issue: `complaint ${e.id ?? ""} "${e.business}" (${e.source}) not in the report` };
}

function check(state: string, g: Golden, report: ResearchReport, ms: number, sources: CoverageSource[], nationwide: CoverageSource[], hosts: Set<string>): SubjectResult {
  const s = report.subjects[0];
  const subj = `${g.role} "${g.name}"`;
  const issues: Issue[] = [];
  const add = (severity: Severity, source: string, detail: string) => issues.push({ severity, state, source, subject: subj, detail });

  // Recall.
  const r = recall(g, s);
  if (r.issue) add(r.found ? "missed" : "missed", g.source, r.issue);

  // Every registered source: searched, or not searched with a reason.
  const lic = s.licenseSources ?? [], rec = s.recordSources ?? [];
  const cells: Cell[] = [];
  const cellOf = (e: { searched: boolean; note: string }) => {
    if (!e.searched) return /^could not search/i.test(e.note) ? `failed (${e.note.replace(/^could not search:\s*/i, "")})` : `not searched (${e.note})`;
    const n = leadingCount(e.note);
    return n == null ? `searched (${e.note})` : n > 0 ? `found ${n}` : "searched, 0";
  };
  const want = [...sources, ...(g.kind === "company" ? nationwide : [])];
  for (const src of want) {
    const inRecords = src.companiesOnly;
    if (inRecords && g.kind === "person") { cells.push({ source: src.label, section: "records", cell: "n/a (companies only)" }); continue; }
    const entries = (inRecords ? rec : lic).filter((e) => e.source === src.label);
    if (!entries.length) { add("silent", src.label, `registered source missing from the report's ${inRecords ? "record" : "license"} sources (no searched / not-searched line)`); cells.push({ source: src.label, section: inRecords ? "records" : "licenses", cell: "MISSING" }); continue; }
    for (const e of entries) {
      cells.push({ source: src.label, section: inRecords ? "records" : "licenses", cell: cellOf(e) });
      if (!e.searched && !e.note.trim()) add("silent", src.label, "not searched, with no reason");
      if (!e.searched && /^could not search/i.test(e.note)) add("error", src.label, e.note.slice(0, 300));
    }
  }
  if (g.kind === "person" && !rec.some((e) => !e.searched && /companies only/i.test(e.note))) add("silent", "records", "a person report should say records are searched for companies only");

  // "Not searched" never reads as 0.
  for (const e of [...lic, ...rec]) if (!e.searched && ZERO_WORDS.test(e.note)) add("silent", e.source, `not searched, but the note reads as a count: "${e.note}"`);
  const summary = reportSummary(report);
  const ranKinds = (cats: string[]) => rec.some((e) => e.searched && cats.includes(e.category ?? "enforcement"));
  for (const [cats, what] of [[["complaints"], "consumer complaint"], [["enforcement", "state_court"], "state enforcement"], [["federal_court"], "federal court case"], [["osha"], "OSHA inspection"]] as [string[], string][]) {
    if (!ranKinds(cats) && new RegExp(`\\b0 ${what}`).test(summary)) add("silent", what, `summary says "0 ${what}(s)" but no such source was searched: "${summary}"`);
  }
  if (!lic.some((e) => e.searched) && /\b0 license record/.test(summary)) add("silent", "licenses", `summary says 0 license records but none was searched`);

  // Privacy on the final report.
  for (const h of [...s.licenses, ...(s.relatedLicenses ?? [])]) {
    const id = `${h.source} ${h.licenseNumber ?? h.businessName ?? ""}`;
    if ("discipline" in h && (h as any).discipline != null) add("privacy", h.source, `disciplinary text on a license (${id})`);
    if (h.holder !== "business") {
      if (h.phone) add("privacy", h.source, `phone shown for an individual or unknown holder (${id})`);
      if (h.address && hasStreet(h.address)) add("privacy", h.source, `street shown for an individual or unknown holder (${id}): "${h.address}"`);
    }
    if ((g.kind === "person" || h.holder !== "business") && standingStatus(h.status).status !== (h.status ?? null)) add("privacy", h.source, `status with more than standing words (${id}): "${h.status}"`);
  }
  if (g.kind === "person") {
    const n = (s.complaints?.length ?? 0) + (s.courtCases?.length ?? 0) + (s.osha?.length ?? 0) + (s.enforcement?.length ?? 0) + (s.relatedEnforcement?.length ?? 0);
    if (n) add("privacy", "records", `${n} enforcement, complaint, court or OSHA record(s) in a person report`);
  }

  // Every URL on a host the code names; any other comes from a publisher's own URL field and is listed to look over.
  const publisherLinks: string[] = [];
  for (const u of new Set(urlsIn(s))) {
    let host = "";
    try { host = new URL(u).hostname.toLowerCase(); } catch { add("silent", "url", `not a URL: ${u}`); continue; }
    if (!hosts.has(host)) publisherLinks.push(u);
    if (/\/(undefined|null)(\/|$|\?)|=(undefined|null)(&|$)/.test(u)) add("silent", "url", `link built from a missing value: ${u}`);
  }

  if (ms > SLOW_MS) add("slow", "report", `report took ${Math.round(ms / 1000)}s (limit ${SLOW_MS / 1000}s)`);
  return { role: g.role, name: g.name, kind: g.kind, golden: g, ms, found: r.found, where: r.where, cells, issues, summary, publisherLinks };
}

// ── One state ────────────────────────────────────────────────────────────────────────────────────────────────────

async function runState(state: string, subjects: StateSubjects, manifest: CoverageManifest, hosts: Set<string>, userId: number, only: Set<string> | null): Promise<StateResult> {
  const loads = await loadMissing(allBulkSourcesFor(state));
  for (const l of loads) log(`${state} ${l}`);
  const ms = manifest.states.find((s) => s.state === state)!;
  // Nationwide sources the running code searches: SAM.gov once loaded, OSHA when the Labor Department key is set.
  const sam = await sourceStatus("us-sam-exclusions").catch(() => ({ loaded: false }));
  const nationwide = manifest.nationwide.filter((n) => !n.needs || (n.needs === "osha" ? !!process.env.DOL_API_KEY : n.needs === "samExclusions" ? sam.loaded : false));
  const out: StateResult = { state, subjects: [], nulls: [], loads, issues: [] };
  for (const slot of subjects.subjects) {
    if (!isGolden(slot)) { out.nulls.push({ role: slot.role, reason: slot.reason }); continue; }
    if (only && !only.has(`${state}|${slot.role}`)) continue;
    const input = researchOrderSchema.parse({ subjects: [{ name: slot.name, kind: slot.kind }], states: [state], trades: [], agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true });
    const t0 = Date.now();
    let res: SubjectResult;
    try {
      const report = await withRun(() => runResearch({ id: 0, user_id: userId, input } as any, () => undefined));
      res = check(state, slot, report, Date.now() - t0, ms.sources, nationwide, hosts);
    } catch (err: any) {
      const issue: Issue = { severity: "missed", state, source: "runner", subject: `${slot.role} "${slot.name}"`, detail: `the report failed: ${String(err?.message ?? err).slice(0, 300)}` };
      res = { role: slot.role, name: slot.name, kind: slot.kind, golden: slot, ms: Date.now() - t0, found: false, where: null, cells: [], issues: [issue], summary: "", publisherLinks: [] };
    }
    log(`${state} ${slot.role} "${slot.name}": ${res.found ? "found" : "NOT FOUND"} in ${Math.round(res.ms / 1000)}s, ${res.issues.length} issue(s)`);
    out.subjects.push(res);
    out.issues.push(...res.issues);
  }
  return out;
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────────────────────────

const ranked = (l: Issue[]) => [...l].sort((a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity) || a.state.localeCompare(b.state));
const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function markdown(r: Results): string {
  const lines: string[] = [];
  lines.push(`# Research acceptance run, ${r.generatedAt.slice(0, 10)}`, "", `Commit ${r.commit}. Options: ${md(JSON.stringify(r.options))}.`, "");
  const counts = Object.fromEntries(RANK.map((k) => [k, r.issues.filter((i) => i.severity === k).length]));
  lines.push(`**${r.issues.length ? `${r.issues.length} failure(s)` : "All checks passed"}**: ${RANK.map((k) => `${k} ${counts[k]}`).join(", ")}.`, "");
  lines.push("## Summary by state", "", "| State | Golden subjects | Found | Missed | Privacy | Silent | Source errors | Slow | Slowest report |", "|---|---|---|---|---|---|---|---|---|");
  for (const st of r.states) {
    const c = (k: Severity) => st.issues.filter((i) => i.severity === k).length;
    const slow = Math.max(0, ...st.subjects.map((s) => s.ms));
    lines.push(`| ${st.state} | ${st.subjects.length} (${st.nulls.length} null) | ${st.subjects.filter((s) => s.found).length}/${st.subjects.length} | ${c("missed")} | ${c("privacy")} | ${c("silent")} | ${c("error")} | ${c("slow")} | ${Math.round(slow / 1000)}s |`);
  }
  lines.push("", "## Failures, ranked (missed record > privacy > silent failure > source error > slow)", "");
  if (!r.issues.length) lines.push("None.");
  else { lines.push("| # | Severity | State | Source | Subject | Detail |", "|---|---|---|---|---|---|"); ranked(r.issues).forEach((i, n) => lines.push(`| ${n + 1} | ${i.severity} | ${i.state} | ${md(i.source)} | ${md(i.subject)} | ${md(i.detail)} |`)); }
  const links = r.states.flatMap((st) => st.subjects.flatMap((s) => (s.publisherLinks ?? []).map((u) => `${st.state} ${s.role}: ${u}`)));
  lines.push("", "## Links from publisher data (host not named in the code: check they are the publisher's own)", "", ...(links.length ? links.map((l) => `- ${md(l)}`) : ["None."]));
  lines.push("", "## Matrix: state × source", "", "Cells per golden subject: `found N`, `searched, 0`, `not searched (reason)`, `failed (error)`, `n/a (companies only)` or `MISSING` (a silent failure).", "");
  for (const st of r.states) {
    lines.push(`### ${st.state}`, "");
    for (const s of st.subjects) lines.push(`- **${s.role}**: "${md(s.name)}" (${md(s.golden.source)}, record ${md(s.golden.recordId ?? "-")}, ${md(s.golden.from)}): ${s.found ? `found in ${md(s.where ?? "")}` : "**not found**"}, ${Math.round(s.ms / 1000)}s. Summary: ${md(s.summary)}`);
    for (const n of st.nulls) lines.push(`- **${n.role}**: none (${md(n.reason)})`);
    for (const l of st.loads) lines.push(`- load: ${md(l)}`);
    const labels = Array.from(new Set(st.subjects.flatMap((s) => s.cells.map((c) => c.source))));
    if (labels.length) {
      lines.push("", `| Source | ${st.subjects.map((s) => s.role).join(" | ")} |`, `|---|${st.subjects.map(() => "---").join("|")}|`);
      for (const l of labels) lines.push(`| ${md(l)} | ${st.subjects.map((s) => md(s.cells.filter((c) => c.source === l).map((c) => c.cell).join("; ") || "-")).join(" | ")} |`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function latestResults(): Results | null {
  if (!existsSync(RESULTS)) return null;
  const f = readdirSync(RESULTS).filter((x) => /^acceptance-.*\.json$/.test(x)).sort().pop();
  return f ? JSON.parse(readFileSync(join(RESULTS, f), "utf8")) : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function acceptance(): Promise<number> {
  if (/constructhub-live|5433/.test(process.env.DATABASE_URL ?? "")) { console.error("refusing: DATABASE_URL looks like the live database"); return 2; }
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: DIR }).toString().trim();
  let states = stateArgs.length ? stateArgs : [...STATE_CODES];
  let only: Set<string> | null = null;
  const prev = latestResults();
  if (has("--only-failed")) {
    if (!prev) { console.error("--only-failed: no previous results"); return 2; }
    only = new Set(prev.issues.map((i) => `${i.state}|${i.subject.split(" ")[0]}`));
    states = states.filter((s) => prev.issues.some((i) => i.state === s));
    log(`re-running ${only.size} failed subject(s) in ${states.length} state(s)`);
  }
  if (!has("--portals")) (storage as any).getDatabases = async () => [];
  const { rows: [u] } = await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
  const userId = Number(u?.id ?? 1);

  log("building the coverage manifest (every registered source per state)");
  const manifest = coverageManifest();
  const hosts = knownHosts();
  await loadMissing(nationwideBulkSources()).then((n) => n.forEach((l) => log(l)));

  const all = readSubjects();
  for (const st of states) {
    if (all[st] && !has("--repick")) continue;
    log(`${st}: picking golden subjects`);
    all[st] = await pickState(st, (m) => log(m));
    writeSubjects(all);
  }
  // --add-subject ST:role:<bulk id or source label>[:query] adds an extra golden subject from that one source.
  for (const spec of args.flatMap((a, i) => (args[i - 1] === "--add-subject" ? [a] : []))) {
    const [st, role, source, query] = spec.split(":");
    const g = await pickFromSource(st.toUpperCase(), role as Golden["role"], source, query);
    if (!g) { log(`${st}: no usable ${role} record in "${source}"`); continue; }
    const cur = all[st.toUpperCase()] ?? { state: st.toUpperCase(), picked: today(), subjects: [] };
    cur.subjects = [...cur.subjects.filter((x) => !(isGolden(x) && x.source === g.source && x.role === g.role)), g];
    all[st.toUpperCase()] = cur;
    writeSubjects(all);
    log(`${st} ${role}: added "${g.name}" from ${g.source}`);
  }

  const results: StateResult[] = [];
  const queue = [...states];
  const workers = Array.from({ length: Math.max(1, Number(opt("--concurrency") ?? 3)) }, async () => {
    for (let st = queue.shift(); st; st = queue.shift()) results.push(await runState(st, all[st], manifest, hosts, userId, only));
  });
  await Promise.all(workers);
  results.sort((a, b) => STATE_CODES.indexOf(a.state as any) - STATE_CODES.indexOf(b.state as any));

  // --only-failed: carry the states not re-run over from the previous results.
  const merged = (only || stateArgs.length) && prev && prev.generatedAt.slice(0, 10) === today() ? [...prev.states.filter((s) => !results.some((r) => r.state === s.state)), ...results.map((r) => {
    const old = prev.states.find((s) => s.state === r.state);
    if (!old) return r;
    // --only-failed keeps the subjects it didn't re-run; a --state run replaces the state.
    const subjects = only ? [...old.subjects.filter((s) => !r.subjects.some((x) => x.role === s.role)), ...r.subjects] : r.subjects;
    return { ...r, subjects, issues: subjects.flatMap((s) => s.issues) };
  })].sort((a, b) => STATE_CODES.indexOf(a.state as any) - STATE_CODES.indexOf(b.state as any)) : results;

  const out: Results = {
    generatedAt: new Date().toISOString(), commit,
    options: { states: stateArgs.length ? stateArgs : "all", onlyFailed: has("--only-failed"), useLoaded: has("--use-loaded"), portals: has("--portals") },
    states: merged, issues: ranked(merged.flatMap((s) => s.issues)),
  };
  mkdirSync(RESULTS, { recursive: true });
  const base = join(RESULTS, `acceptance-${today()}`);
  writeFileSync(`${base}.json`, JSON.stringify(out, null, 1) + "\n");
  writeFileSync(`${base}.md`, markdown(out));
  log(`wrote ${base}.json and .md: ${out.issues.length} failure(s)`);
  return out.issues.length ? 1 : 0;
}

async function main() {
  let code = 0;
  try {
    if (has("--prod-health")) code = await (await import("./research-acceptance/prod-health")).prodHealth(RESULTS);
    else if (has("--playbook")) code = await (await import("./research-acceptance/playbook")).playbook(RESULTS);
    else code = await acceptance();
  } catch (err) {
    console.error(err);
    code = 1;
  }
  await pool.end().catch(() => undefined);
  process.exit(code);
}
main();
