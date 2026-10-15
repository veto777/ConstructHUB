/**
 * Check one state's sources live, the way a report would use it: every source the registry has for the state (the
 * original tables in ../server/research, the state pack in server/research/states/<st>.ts and the city/county
 * sources). --use-loaded searches bulk files already loaded in DATABASE_URL without downloading them again.
 *
 *   DATABASE_URL=<a scratch db> npx tsx script/research-state-check.ts OH --company "Acme Roofing" [--person "John Smith"]
 *     [--license "EC123"] [--phone "614 555 0100"] [--address "100 Main St 43215"] [--bulk] [--only <bulk id>]
 *
 * Runs every license, enforcement and complaint search of the pack for the names given and prints the counts and
 * the first hits. With --bulk it also downloads and loads each bulk file into DATABASE_URL (never the live
 * database) and searches it. Exit code 1 if any source failed or a bulk file came in under its row floor.
 */
import { loadSource, searchBulk, searchBulkBy } from "../server/research/bulk";
import type { IdQuery } from "../server/research/identifiers";
import { searchLicenses, searchLicensesBy } from "../server/research/licenses";
import { complaintSourcesFor, namedIn, searchComplaints } from "../server/research/records";
import { allBulkSourcesFor, allLicenseSourcesFor, liveLicenseSearchesFor, searchPackEnforcement } from "../server/research/registry";
import { searchStateEnforcement } from "../server/research/state-records";
import { sourceStatus } from "../server/research/bulk";
import { STATE_PACKS } from "../server/research/states";
import { pool } from "../server/db";

const args = process.argv.slice(2);
const state = (args[0] ?? "").toUpperCase();
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const company = opt("--company");
const person = opt("--person");
const only = opt("--only");
const ids: IdQuery[] = (["license", "phone", "address"] as const).flatMap((t) => { const v = opt(`--${t}`); return v ? [{ type: t, value: v }] : []; });
const useLoaded = args.includes("--use-loaded");
const withBulk = args.includes("--bulk") || !!only || useLoaded;

const pack = STATE_PACKS.find((p) => p.state === state);
if (!/^[A-Z]{2}$/.test(state)) { console.error("usage: research-state-check.ts <ST> …"); process.exit(2); }
if (withBulk && /constructhub-live|5433/.test(process.env.DATABASE_URL ?? "")) { console.error("refusing to load bulk files into a live-looking database"); process.exit(2); }

let failed = 0;
const show = (label: string, n: number | undefined, sample: unknown[] | null) => {
  // A searchBy that can't search this kind of identifier returns null: "not searched", not 0.
  if (sample == null) { console.log(`  ${label}: not searched (this source can't search by it)`); return; }
  const note = (sample as { note?: string }).note;
  console.log(`  ${label}: ${n}${note ? ` (${note})` : ""}`);
  for (const h of sample.slice(0, 2)) console.log(`    ${JSON.stringify(h).slice(0, 400)}`);
};
const attempt = async (label: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (err: any) { failed++; console.log(`  ${label}: FAILED ${String(err?.message ?? err).slice(0, 300)}`); }
};
const subjects: { name: string; kind: "company" | "person" }[] = [
  ...(company ? [{ name: company, kind: "company" as const }] : []),
  ...(person ? [{ name: person, kind: "person" as const }] : []),
];

async function main() {
  console.log(`${state}: pack checked ${pack?.checked || "(no pack)"}`);
  for (const src of allLicenseSourcesFor(state)) {
    console.log(`license dataset: ${src.source} (${src.datasetUrl})`);
    for (const s of subjects) await attempt(`${s.kind} "${s.name}"`, async () => { const h = await searchLicenses(src, s.name, s.kind); show(`${s.kind} "${s.name}"`, h.length, h); });
    for (const q of ids) await attempt(`${q.type} "${q.value}"`, async () => { const h = await searchLicensesBy(src, q); show(`${q.type} "${q.value}"`, h?.length, h); });
  }
  for (const src of liveLicenseSearchesFor(state)) {
    console.log(`live license search: ${src.source} (${src.sourceUrl})`);
    for (const s of subjects) await attempt(`${s.kind} "${s.name}"`, async () => { const h = await src.search(s.name, s.kind); show(`${s.kind} "${s.name}"`, h.length, h); });
    if (src.searchBy) for (const q of ids) await attempt(`${q.type} "${q.value}"`, async () => { const h = await src.searchBy!(q); show(`${q.type} "${q.value}"`, h?.length, h); });
  }
  if (company) {
    console.log(`live enforcement (company "${company}")`);
    const matches = (n: string | null) => namedIn(company, ...(n ?? "").split(" / "));
    for (const r of [await searchStateEnforcement(company, state, matches), await searchPackEnforcement(company, state, matches)]) {
      for (const src of r.sources) { console.log(`  ${src.source}: ${src.searched ? "searched" : "NOT SEARCHED"}, ${src.note}`); if (!src.searched) failed++; }
      for (const h of r.hits.slice(0, 3)) console.log(`    ${JSON.stringify(h).slice(0, 400)}`);
    }
  }
  for (const src of complaintSourcesFor(state)) {
    console.log(`complaints: ${src.source}`);
    if (company) await attempt(`company "${company}"`, async () => { const h = await searchComplaints(src, company); show(`company "${company}"`, h.length, h); });
  }
  if (withBulk) {
    for (const src of allBulkSourcesFor(state).filter((b) => !only || b.id === only)) {
      console.log(`bulk: ${src.id} — ${src.label} (${src.pageUrl})`);
      const t0 = Date.now();
      await attempt("load", async () => {
        if (useLoaded) {
          const st = await sourceStatus(src.id);
          if (!st.loaded) { console.log("  not loaded in this database (skipped)"); return; }
          console.log(`  using the load of ${st.loadedAt} (${st.rows} rows, floor ${src.minRows})`);
        } else {
          const n = await loadSource(src);
          console.log(`  loaded ${n} rows in ${Math.round((Date.now() - t0) / 1000)}s (floor ${src.minRows})`);
        }
        for (const s of subjects) {
          if (src.companiesOnly && s.kind === "person") continue;
          const { hits } = await searchBulk(src, s.name, s.kind, 50);
          show(`${s.kind} "${s.name}"`, hits.length, hits);
        }
        for (const q of ids) { const { hits } = await searchBulkBy(src, q, 50); show(`${q.type} "${q.value}"`, hits.length, hits); }
      });
    }
  } else if (allBulkSourcesFor(state).length) {
    console.log(`(${allBulkSourcesFor(state).length} bulk source(s) not searched; pass --bulk, --only <id> or --use-loaded)`);
  }
  console.log(failed ? `${failed} FAILURE(S)` : "OK");
}

main().catch((err) => { console.error(err); failed++; }).finally(async () => { await pool.end().catch(() => undefined); process.exit(failed ? 1 : 0); });
