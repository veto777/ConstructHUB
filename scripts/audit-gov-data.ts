/** GET-only, bounded government reference audit. Run with npx tsx scripts/audit-gov-data.ts.
 * Checkpoints are resumable; --fresh discards previous checks. Never treats a bot block as live.
 * Apply reviewed results separately with scripts/apply-gov-data-audit.ts.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchGovernmentPage as get, classifyGovernmentPage as classify } from '../server/government-url-check';
const out = 'analysis/gov-data-audit.json';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const apps = JSON.parse(readFileSync('server/data/appraisers.json', 'utf8'));
const permits = JSON.parse(readFileSync('server/data/permit-portals.json', 'utf8'));
const report: any = !process.argv.includes('--fresh') && existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { startedAt: new Date().toISOString(), records: [] };
const inputHashes = Object.fromEntries(['appraisers', 'permit-portals'].map(name => [name, createHash('sha256').update(readFileSync(`server/data/${name}.json`)).digest('hex')]));
if (report.inputHashes && JSON.stringify(report.inputHashes) !== JSON.stringify(inputHashes)) throw Error('Input data changed: preserve prior audit and re-run with --fresh');
report.inputHashes = inputHashes;
function save() { writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
async function pool<T>(rows: T[], fn: (r: T) => Promise<void>, n = 8) {
  let i = 0; await Promise.all(Array.from({length: n}, async () => { while (i < rows.length) { await fn(rows[i++]); await sleep(200); } }));
}
async function main() {
  const rows = [...apps.map((r: any, i: number) => ({ kind: 'appraiser', index: i, state: r.stateCode, key: `${r.stateCode}/${r.county}`, oldUrl: r.portalUrl, checkedUrl: r.portalUrl || r.candidateUrl || null })), ...permits.map((r: any, i: number) => ({ kind: 'permit', index: i, state: r.jurisdiction.slice(-2), key: r.jurisdiction, oldUrl: r.url, checkedUrl: r.url || r.candidateUrl || null }))];
  const done = new Set(report.records.map((r: any) => `${r.kind}/${r.index}`));
  // Serialize requests to the same host; shared county/vendor sites must not be flooded.
  const hosts = new Map<string, Promise<any>>();
  // Identical state-wide/vendor URLs share one actual check, with per-record evidence.
  const checked = new Map<string, Promise<any>>();
  for (const r of report.records) if (r.checkedUrl || r.oldUrl) checked.set(`${r.kind}/${r.checkedUrl || r.oldUrl}`, Promise.resolve({ finalUrl:r.finalUrl,httpStatus:r.httpStatus,attempts:r.attempts,status:r.status,reason:r.reason,title:r.title,excerpt:r.excerpt,checkedAt:r.checkedAt }));
  await pool(rows.filter(r => !done.has(`${r.kind}/${r.index}`)), async row => {
    let result: any = { finalUrl: null, status: 'none', reason: 'no URL on file', attempts: 0 };
    if (row.checkedUrl) {
      const cacheKey = `${row.kind}/${row.checkedUrl}`;
      if (!checked.has(cacheKey)) {
        const host = new URL(row.checkedUrl).hostname;
        const prior = hosts.get(host) || Promise.resolve();
        const task = prior.then(async () => { const r = await get(row.checkedUrl); return { finalUrl: r.finalUrl, httpStatus: r.httpStatus, attempts: r.attempts, ...classify(r, row.kind), checkedAt: new Date().toISOString() }; });
        hosts.set(host, task.catch(() => {})); checked.set(cacheKey, task);
      }
      result = await checked.get(cacheKey);
    }
    report.records.push({ ...row, ...result, checkedAt: result.checkedAt || new Date().toISOString() });
    if (report.records.length % 25 === 0) { save(); console.log(`Checked ${report.records.length}/${rows.length}`); }
  });
  save();
  report.completedAt = new Date().toISOString(); save();
}
main().catch(e => { save(); console.error(e); process.exitCode = 1; });
