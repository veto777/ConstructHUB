/**
 * End-to-end check of search-by-identifier and the cross-reference pass (server/research/xref.ts) on real data in a
 * scratch database. Never the live database.
 *
 *   DATABASE_URL=<scratch db> npx tsx script/research-xref-e2e.ts [--load] [--keyed-copy] --name "Sonitrol of Tallahassee"
 *     [--kind company|person] [--license EF0000804] [--phone …] [--address "1136 Thomasville Rd Tallahassee FL 32303"]
 *     [--state FL] [--use-loaded ia-contractors:IA]
 *
 *   --load        downloads and loads FL DBPR electrical licenses (fl-eclb) and FL DBPR complaints into the scratch db.
 *   --keyed-copy  until FL's own loader fills address and keys (Account B's retrofit), also loads a copy of the same
 *                 official ECLB file that indexes each row's license number and street address, so identifier search
 *                 has something to find. It reads only the publisher's own columns and is never shipped to reports.
 *
 *   --use-loaded  searches a file another branch already loaded into the scratch db (read only, by its source id), e.g.
 *                 a state pack that indexes phones.
 *
 * Permit portals are skipped (they are a separate, slow sweep): the report's licenses, identifier searches, related
 * licenses and enforcement are printed.
 */
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { loadSource, clean, csvRows, download, usDate, type BulkHit, type BulkSource } from "../server/research/bulk";
import { BULK_SOURCES } from "../server/research/bulk-sources";
import { ALL_BULK_SOURCES } from "../server/research/registry";
import { runResearch } from "../server/research/runner";
import { researchOrderSchema } from "@shared/research-reports";
import { promises as fs } from "node:fs";

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (/constructhub-live|5433/.test(process.env.DATABASE_URL ?? "")) { console.error("refusing to run against a live-looking database"); process.exit(2); }

const ECLB_URL = "https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv";
const ECLB_PAGE = "https://www2.myfloridalicense.com/electrical-contractors/public-records/";
const flip = (v: string | null) => { const m = v?.match(/^([^,]+),\s*(.+)$/); return m ? clean(`${m[2]} ${m[1]}`) : clean(v); };

/** The official ECLB extract with each row's license number, address and licensee indexed (columns as bulk-sources.ts reads them). */
const keyedCopy: BulkSource = {
  id: "e2e-fl-eclb-keyed", state: "FL", label: "Florida DBPR electrical licenses (ECLB), keyed copy for this check", pageUrl: ECLB_PAGE,
  everyHours: 24 * 365, minRows: 15_000,
  load: async function* (): AsyncIterable<BulkHit> {
    const path = await download(ECLB_URL);
    try {
      for await (const r of csvRows(path)) {
        if (r.length < 21 || /^(PVDR|CRS\d*)$/.test(r[1].trim())) continue;
        const name = clean(r[2]), dba = /^INDIVIDUAL$/i.test(r[3].trim()) ? null : clean(r[3]);
        const isBusiness = r[1].trim() === "QB";
        const address = clean([r[5], r[8], r[9], r[10]].map((x) => x.replace(/\s{2,}.*$/, "")).join(" "));
        const person = isBusiness ? null : flip(name);
        const licenseNumber = clean(r[20]) ?? clean(r[12]);
        yield {
          kind: "license",
          hit: {
            state: "FL", source: "Florida DBPR electrical licenses (ECLB)", sourceUrl: ECLB_PAGE, businessName: isBusiness ? name : dba, licenseNumber,
            licenseType: r[1].trim(), specialty: clean(r[4]), status: [r[13], r[14]].map((x) => x.trim()).filter(Boolean).join("/") || null,
            principal: person, city: clean(r[8]), expires: usDate(r[17]), matchedOn: isBusiness ? "business" : "principal",
            address, people: person ? [{ name: person, role: "Licensee" }] : [],
          },
          business: isBusiness ? name : dba, person: isBusiness ? null : name,
          keys: { licenses: [licenseNumber], addresses: [address] },
        };
      }
    } finally { await fs.rm(path, { force: true }); }
  },
};

async function main() {
  if (args.includes("--load")) {
    for (const id of ["fl-eclb", "fl-dbpr-complaints"]) {
      const src = BULK_SOURCES.find((s) => s.id === id)!;
      const t0 = Date.now();
      console.log(`loading ${id}: ${await loadSource(src)} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
  if (args.includes("--keyed-copy")) {
    if (args.includes("--load")) { const t0 = Date.now(); console.log(`loading ${keyedCopy.id}: ${await loadSource(keyedCopy)} rows in ${Math.round((Date.now() - t0) / 1000)}s`); }
    ALL_BULK_SOURCES.push(keyedCopy);
  }
  for (const spec of args.flatMap((a, i) => (a === "--use-loaded" ? [args[i + 1]] : []))) {
    const [id, state] = spec.split(":");
    ALL_BULK_SOURCES.push({ id, state, label: `${id} (loaded by another branch)`, pageUrl: "", everyHours: 24, minRows: 0, load: () => { throw new Error("read only here"); } });
  }
  // No permit-portal sweep here.
  (storage as any).getDatabases = async () => [];
  const input = researchOrderSchema.parse({
    subjects: [{
      name: opt("--name") ?? "Sonitrol of Tallahassee", kind: opt("--kind") ?? "company",
      licenseNumbers: opt("--license") ? [opt("--license")] : undefined, phones: opt("--phone") ? [opt("--phone")] : undefined,
      addresses: opt("--address") ? [opt("--address")] : undefined,
    }],
    states: [opt("--state") ?? "FL"], agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true,
  });
  const t0 = Date.now();
  const report = await runResearch({ id: 0, user_id: 0, input } as any, (m) => console.log(`  [runner] ${m}`));
  const s = report.subjects[0];
  const line = (h: any) => `${h.licenseNumber ?? h.id ?? "-"} | ${h.businessName ?? h.name ?? "-"} | ${h.principal ?? (h.people ?? []).map((p: any) => p.name).join(", ") ?? ""} | ${h.address ?? h.city ?? ""} | ${h.source}`;
  console.log(`\n=== ${s.name} (${s.kind}) in ${report.states.join(", ")}: ${Math.round((Date.now() - t0) / 1000)}s ===`);
  console.log(`identifier searches: ${JSON.stringify(s.identifierSearches)}`);
  console.log(`\nown licenses (${s.licenses.length}):`);
  for (const h of s.licenses) console.log(`  [${h.matchedOn}] ${line(h)}`);
  console.log(`\nrelated licenses (${s.relatedLicenses?.length ?? 0}):`);
  for (const h of s.relatedLicenses ?? []) console.log(`  [${h.relatedTie}] ${line(h)}\n      why: ${h.relatedVia}`);
  console.log(`\nrelated enforcement (${s.relatedEnforcement?.length ?? 0}):`);
  for (const h of s.relatedEnforcement ?? []) console.log(`  [${h.relatedTie}] ${h.category} ${h.date ?? ""} ${h.name} | ${h.status} | ${h.source}\n      why: ${h.relatedVia}`);
  console.log(`\nown enforcement: ${s.enforcement?.length ?? 0}`);
  console.log(`notes:\n  ${(s.relatedNotes ?? []).join("\n  ")}`);
  console.log(`\ntotals: ${JSON.stringify(report.totals)}`);
  if (args.includes("--json")) await fs.writeFile(opt("--json")!, JSON.stringify(report, null, 2));
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(async () => { await pool.end().catch(() => undefined); process.exit(process.exitCode ?? 0); });
