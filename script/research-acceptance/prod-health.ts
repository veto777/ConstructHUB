/**
 * --prod-health: read-only checks of production (vb11), for ../research-acceptance.ts.
 *
 *   - research_bulk_sources, read over ssh with psql in a read-only transaction: every registered bulk source has a
 *     load, its key_version is the code's KEY_VERSION, no error is stored, its row count is at or above its floor,
 *     and it loaded within its refresh window (everyHours plus a grace of a quarter of it, at least 6 hours);
 *   - GET https://constructhub.us/api/research-reports/coverage-runtime (what the running server says it searches).
 *
 * Writes nothing anywhere but results/prod-health-<date>.json and .md here. The database URL never leaves vb11 and is
 * never printed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KEY_VERSION } from "../../server/research/bulk";
import { ALL_BULK_SOURCES } from "../../server/research/registry";

const SQL = "SELECT id, row_count, loaded_at, attempted_at, coalesce(replace(left(error, 200), '|', '/'), ''), key_version, row_shape FROM research_bulk_sources ORDER BY id";
// The URL is read from the live .env on vb11 inside the remote shell; psql runs with every transaction read-only.
const REMOTE = `cd ~/ConstructHUB-live && U=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^["\\x27]//' -e 's/["\\x27]$//') && PGOPTIONS='-c default_transaction_read_only=on' psql "$U" -X -A -t -F '|' -c "${SQL}"`;

type Row = { id: string; rows: number; loadedAt: string | null; attemptedAt: string | null; error: string; keyVersion: number; rowShape: number };
type Finding = { id: string; state: string; problem: string };

export async function prodHealth(resultsDir: string): Promise<number> {
  const raw = execFileSync("ssh", ["vb11", REMOTE], { timeout: 120_000 }).toString();
  const rows: Row[] = raw.trim().split("\n").filter(Boolean).map((l) => {
    const [id, n, loaded, attempted, error, kv, shape] = l.split("|");
    return { id, rows: Number(n), loadedAt: loaded || null, attemptedAt: attempted || null, error, keyVersion: Number(kv), rowShape: Number(shape) };
  });
  const by = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();
  const findings: Finding[] = [];
  const ok: string[] = [];
  for (const src of ALL_BULK_SOURCES) {
    const r = by.get(src.id);
    const bad = (problem: string) => findings.push({ id: src.id, state: src.state, problem });
    if (!r) { bad("no row in research_bulk_sources (never attempted)"); continue; }
    if (!r.loadedAt) { bad(`never loaded${r.attemptedAt ? ` (last attempt ${r.attemptedAt.slice(0, 16)})` : ""}${r.error ? `: ${r.error}` : ""}`); continue; }
    const before = findings.length;
    if (r.keyVersion !== KEY_VERSION) bad(`key_version ${r.keyVersion}, the code is at ${KEY_VERSION} (phone/address keys not searched until it reloads)`);
    if (r.error) bad(`error stored: ${r.error}`);
    if (r.rows < src.minRows) bad(`${r.rows} rows, below its floor of ${src.minRows}`);
    const ageH = (now - new Date(r.loadedAt).getTime()) / 3600_000;
    const limit = src.everyHours + Math.max(6, src.everyHours / 4);
    if (ageH > limit) bad(`loaded ${Math.round(ageH)}h ago (${r.loadedAt.slice(0, 16)}), refresh every ${src.everyHours}h`);
    if (findings.length === before) ok.push(src.id);
  }
  const orphans = rows.filter((r) => !ALL_BULK_SOURCES.some((s) => s.id === r.id)).map((r) => r.id);

  let runtime: unknown = null, runtimeError: string | null = null;
  try {
    const res = await fetch("https://constructhub.us/api/research-reports/coverage-runtime", { headers: { Accept: "application/json" } });
    runtime = res.ok ? await res.json() : null;
    if (!res.ok) runtimeError = `HTTP ${res.status}`;
  } catch (err: any) { runtimeError = String(err?.message ?? err); }
  if (runtimeError) findings.push({ id: "coverage-runtime", state: "-", problem: `GET coverage-runtime failed: ${runtimeError}` });

  const date = new Date().toISOString();
  const out = { checkedAt: date, keyVersion: KEY_VERSION, registered: ALL_BULK_SOURCES.length, ok: ok.length, findings, orphans, runtime };
  mkdirSync(resultsDir, { recursive: true });
  const base = join(resultsDir, `prod-health-${date.slice(0, 10)}`);
  writeFileSync(`${base}.json`, JSON.stringify(out, null, 1) + "\n");
  const md = [
    `# Production research health, ${date.slice(0, 16)} UTC`, "",
    `${ALL_BULK_SOURCES.length} registered bulk sources: **${ok.length} healthy**, ${new Set(findings.map((f) => f.id)).size} with findings. Code KEY_VERSION ${KEY_VERSION}.`, "",
    `coverage-runtime: \`${JSON.stringify(runtime)}\`${runtimeError ? ` (failed: ${runtimeError})` : ""}`, "",
    "| Source | State | Problem |", "|---|---|---|",
    ...findings.map((f) => `| ${f.id} | ${f.state} | ${f.problem.replace(/\|/g, "\\|")} |`),
    "", orphans.length ? `Rows for ids the code no longer registers: ${orphans.join(", ")}` : "No rows for unregistered ids.", "",
  ].join("\n");
  writeFileSync(`${base}.md`, md);
  console.log(md);
  return findings.length ? 1 : 0;
}
