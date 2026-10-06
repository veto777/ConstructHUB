// Manual integration harness: reads the local directory and persists only to
// the designated dev database. Run with `npx tsx server/adapter-live-test.ts`.
// ADAPTER_IDS (comma-separated), ADAPTER_TERM, ADAPTER_TYPE and ADAPTER_OUTPUT
// can narrow a run. Unit tests never execute this file or use live network.
import { writeFileSync } from 'node:fs';
import { scrapeByPlatform, closeBrowser, getScrapeProgress } from './scraper';
import { pool } from './db';

const database = new URL(process.env.DATABASE_URL || 'https://missing.invalid');
if (database.hostname !== '127.0.0.1' || database.port !== '5432' ||
    database.pathname !== '/constructhub_dev_a6') {
  throw new Error('Live harness requires the designated local dev database');
}

const samples: Record<number, string> = {
  // Distinct jurisdictions; numbers come from records observed in their portals.
  118: '7937 Ritchie', 32967: '14500 Central', 4863: '1187 University',
  4701: '2377 Arizona', 17: '20th', 28073: 'Elizabeth',
  29844: '1421 Battlefield', 5709: '555 Broadway', 11403: 'Andover', 49: 'Arapahoe',
  2871: 'Main', 7335: '1012 SR 436', 6146: '649 Broadway', 78: '7402 1st',
  26662: '534 King', 27712: 'Madison', 5001: '275 Clovis', 5475: '1835 Newport',
  7373: '1382 Coronet', 79: '3380 Grand',
  33112: 'Fowler', 33251: 'Main', 18224: 'Main',
};
const queue = process.env.ADAPTER_IDS?.split(',').map(Number) || Object.keys(samples).map(Number);
const all: any[] = await (await fetch('http://127.0.0.1:8199/api/databases?scrapable=true')).json();
const output: any[] = [];

try {
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let id; (id = queue.shift()) !== undefined;) {
      const portal = all.find(d => d.id === id);
      if (!portal) throw new Error(`Unknown portal ${id}`);
      const term = process.env.ADAPTER_TERM || samples[id] || 'Main';
      const type = process.env.ADAPTER_TYPE || 'address';
      const { rows: [query] } = await pool.query(
        'INSERT INTO search_queries (search_type, search_value, county_id) VALUES ($1, $2, $3) RETURNING id',
        [type, term, portal.countyId],
      );
      const jobId = `adapter-validation-${id}-${Date.now()}`;
      const start = Date.now();
      let results: any[] = [];
      let error: string | undefined;
      try {
        results = await scrapeByPlatform(
          portal.platform, portal.searchUrl || portal.portalUrl, term, type,
          id, portal.name, query.id, jobId,
        );
      } catch (caught: any) {
        error = caught.message;
      }
      const row = {
        id, platform: portal.platform, jurisdiction: portal.jurisdiction,
        url: portal.searchUrl || portal.portalUrl, type, term, count: results.length,
        seconds: Math.round((Date.now() - start) / 1000),
        progress: getScrapeProgress(jobId), error, samples: results.slice(0, 3),
      };
      output.push(row);
      console.log('RESULT', JSON.stringify(row));
      writeFileSync(process.env.ADAPTER_OUTPUT || '/tmp/adapter-live-results.json', JSON.stringify(output, null, 2));
    }
  }));
} finally {
  await closeBrowser();
  await pool.end();
}
process.exit(output.some(row => row.error || row.progress?.status === 'error') ? 1 : 0);
