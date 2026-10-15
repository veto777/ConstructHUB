/**
 * Check one state pack (server/research/states/<st>.ts) live, the way a report would use it.
 *
 *   DATABASE_URL=<a scratch db> npx tsx script/research-state-check.ts OH --company "Acme Roofing" [--person "John Smith"] [--bulk] [--only <bulk id>]
 *
 * Runs every license, enforcement and complaint search of the pack for the names given and prints the counts and
 * the first hits. With --bulk it also downloads and loads each bulk file into DATABASE_URL (never the live
 * database) and searches it. Exit code 1 if any source failed or a bulk file came in under its row floor.
 */
import { loadSource, searchBulk } from "../server/research/bulk";
import { searchLicenses } from "../server/research/licenses";
import { namedIn, searchComplaints } from "../server/research/records";
import { searchPackEnforcement } from "../server/research/registry";
import { STATE_PACKS } from "../server/research/states";
import { pool } from "../server/db";

const args = process.argv.slice(2);
const state = (args[0] ?? "").toUpperCase();
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const company = opt("--company");
const person = opt("--person");
const only = opt("--only");
const withBulk = args.includes("--bulk") || !!only;

const pack = STATE_PACKS.find((p) => p.state === state);
if (!pack) { console.error(`no pack for ${state}`); process.exit(2); }
if (withBulk && /constructhub-live|5433/.test(process.env.DATABASE_URL ?? "")) { console.error("refusing to load bulk files into a live-looking database"); process.exit(2); }

let failed = 0;
const show = (label: string, n: number, sample: unknown[]) => {
  console.log(`  ${label}: ${n}`);
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
  console.log(`${state}: checked ${pack!.checked || "(empty pack)"}`);
  for (const src of pack!.licenses ?? []) {
    console.log(`license dataset: ${src.source} (${src.datasetUrl})`);
    for (const s of subjects) await attempt(`${s.kind} "${s.name}"`, async () => { const h = await searchLicenses(src, s.name, s.kind); show(`${s.kind} "${s.name}"`, h.length, h); });
  }
  for (const src of pack!.liveLicenses ?? []) {
    console.log(`live license search: ${src.source} (${src.sourceUrl})`);
    for (const s of subjects) await attempt(`${s.kind} "${s.name}"`, async () => { const h = await src.search(s.name, s.kind); show(`${s.kind} "${s.name}"`, h.length, h); });
  }
  if (company && (pack!.enforcement?.length || pack!.liveEnforcement?.length)) {
    console.log(`enforcement (company "${company}")`);
    const r = await searchPackEnforcement(company, state, (n) => namedIn(company, ...(n ?? "").split(" / ")));
    for (const src of r.sources) { console.log(`  ${src.source}: ${src.searched ? "searched" : "NOT SEARCHED"}, ${src.note}`); if (!src.searched) failed++; }
    for (const h of r.hits.slice(0, 3)) console.log(`    ${JSON.stringify(h).slice(0, 400)}`);
  }
  for (const src of pack!.complaints ?? []) {
    console.log(`complaints: ${src.source}`);
    if (company) await attempt(`company "${company}"`, async () => { const h = await searchComplaints(src, company); show(`company "${company}"`, h.length, h); });
  }
  if (withBulk) {
    for (const src of (pack!.bulk ?? []).filter((b) => !only || b.id === only)) {
      console.log(`bulk: ${src.id} — ${src.label} (${src.pageUrl})`);
      const t0 = Date.now();
      await attempt("load", async () => {
        const n = await loadSource(src);
        console.log(`  loaded ${n} rows in ${Math.round((Date.now() - t0) / 1000)}s (floor ${src.minRows})`);
        for (const s of subjects) {
          if (src.companiesOnly && s.kind === "person") continue;
          const { hits } = await searchBulk(src, s.name, s.kind, 50);
          show(`${s.kind} "${s.name}"`, hits.length, hits);
        }
      });
    }
  } else if (pack!.bulk?.length) {
    console.log(`(${pack!.bulk.length} bulk source(s) not loaded; pass --bulk)`);
  }
  console.log(failed ? `${failed} FAILURE(S)` : "OK");
}

main().catch((err) => { console.error(err); failed++; }).finally(async () => { await pool.end().catch(() => undefined); process.exit(failed ? 1 : 0); });
