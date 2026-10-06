// Read-only live validation against saved results in the designated dev DB.
// DATABASE_URL=... npx tsx server/permit-detail-live-test.ts
// DETAIL_IDS / DETAIL_OUTPUT optionally narrow the portals / select the JSON report.
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL || 'https://missing.invalid');
if (url.hostname !== '127.0.0.1' || url.port !== '5432' || url.pathname !== '/constructhub_dev_a6') {
  throw new Error('Detail live harness requires the designated local dev database');
}
const { scrapePermitDetail, closeBrowser } = await import('./scraper');
const pool = new pg.Pool({ connectionString: url.href, options: '-c default_transaction_read_only=on' });
const ids = (process.env.DETAIL_IDS || '118,4701,4863,32967,28073,5001,2871,5475,6146,79,78').split(',').map(Number);
const output: any[] = [];
try {
  const { rows } = await pool.query(`SELECT DISTINCT ON (d.id)
    d.id, d.name, d.platform, d.search_url, r.id AS result_id, r.permit_number, r.raw_data
    FROM search_results r JOIN permit_databases d ON d.id = r.database_id
    WHERE d.id = ANY($1::int[]) ORDER BY d.id, r.id DESC`, [ids]);
  const queue = [...rows];
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let row; (row = queue.shift());) {
      const start = Date.now();
      const details = await scrapePermitDetail(row.platform, row.search_url, row.permit_number, process.env.DETAIL_NO_CASE_ID ? null : row.raw_data);
      const result = { ...row, raw_data: undefined, seconds: Math.round((Date.now() - start) / 1000), details };
      output.push(result);
      console.log(JSON.stringify(result));
      writeFileSync(process.env.DETAIL_OUTPUT || 'server/permit-detail-live-results.json', JSON.stringify(output, null, 2) + '\n');
    }
  }));
} finally {
  await closeBrowser();
  await pool.end();
}
