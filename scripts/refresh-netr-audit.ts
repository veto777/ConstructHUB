/** Source refresh for every existing office, including missing phones/URLs.
 * Two workers, 300ms spacing. County URLs come exclusively from NETR state indexes.
 * Writes evidence only. Re-run resumes completed states; --fresh starts over.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { isAssessmentOffice } from '../server/netr-office';
import { fetchGovernmentPage, classifyGovernmentPage } from '../server/government-url-check';
const file = 'analysis/gov-netr-refresh.json';
const report: any = !process.argv.includes('--fresh') && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {startedAt: new Date().toISOString(), states:{}};
const apps = JSON.parse(readFileSync('server/data/appraisers.json', 'utf8'));
const retryMissing = process.argv.includes('--missing-offices');
if(retryMissing) delete report.completedAt;
const save = () => writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g,'');
for (const state of [...new Set(apps.map((r: any) => r.stateCode))]) {
  const prior=report.states[String(state)];
  if (prior?.complete && (!retryMissing || !prior.checks.some((c:any)=>!c.offices?.length))) continue;
  const source = `https://publicrecords.netronline.com/state/${state}`;
  const page = await fetchGovernmentPage(source); const $ = cheerio.load(page.html);
  const links = new Map<string,string>();
  $(`a[href*='/state/${state}/county/']`).each((_, el) => links.set(normalize($(el).text()), new URL($(el).attr('href')!, source).href));
  const good=new Set((prior?.checks||[]).filter((r:any)=>r.offices?.length).map((r:any)=>r.index));
  const rows = apps.map((r: any,index: number) => ({...r,index})).filter((r: any) => r.stateCode === state && (!retryMissing || !good.has(r.index)));
  const checks: any[] = retryMissing ? (prior?.checks||[]).filter((r:any)=>good.has(r.index)) : []; let i=0;
  await Promise.all(Array.from({length:2}, async () => {
    while (i < rows.length) {
      const r = rows[i++]; const url = links.get(normalize(r.county));
      if (!url) { checks.push({ index:r.index, county:r.county, source, reason:'county absent from fetched state index', httpStatus:page.httpStatus }); continue; }
      const p = await fetchGovernmentPage(url); const $ = cheerio.load(p.html); const offices: any[]=[];
      $('.div-table-row').each((_,el) => {
        const name=$(el).find('[col-name="Name"]').first().text().trim();
        if (!isAssessmentOffice(name)) return;
        const phoneRaw=$(el).find('[col-name="Phone"]').first().text().trim();
        const phone=/^(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?$/i.test(phoneRaw) ? phoneRaw : null;
        const href=$(el).find('[col-name="Online"] a').first().attr('href')?.trim();
        offices.push({name,phone,phoneRaw:phoneRaw || null,portalUrl:href && /^https?:/i.test(href) ? href : null});
      });
      // Only new source URLs need another network check. Existing URLs are checked by the URL audit.
      for (const office of offices) if (office.portalUrl && office.portalUrl !== r.portalUrl) {
        const p = await fetchGovernmentPage(office.portalUrl);
        office.verification={ finalUrl:p.finalUrl, httpStatus:p.httpStatus, attempts:p.attempts, ...classifyGovernmentPage(p,'appraiser'), checkedAt:new Date().toISOString() };
      }
      checks.push({index:r.index,county:r.county,source:url,httpStatus:p.httpStatus,offices,checkedAt:new Date().toISOString()});
      await new Promise(r=>setTimeout(r,300));
    }
  }));
  report.states[String(state)]={complete:true,checks};save();console.log(`${state}: ${checks.length} NETR offices checked`);
}
report.completedAt=new Date().toISOString();save();
