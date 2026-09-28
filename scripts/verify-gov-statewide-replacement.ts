/** Tennessee's official announcement links the replacement for the retired portal.
 * Follow the actual source anchor; never construct a replacement from the old URL.
 */
import { writeFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { fetchGovernmentPage, classifyGovernmentPage } from '../server/government-url-check';
const sourceUrl='https://comptroller.tn.gov/news/2022/12/15/comptroller-s-office-launches-redesigned-property-assessment-data-webpage.html';
const source=await fetchGovernmentPage(sourceUrl);const $=cheerio.load(source.html);
const url=$('a[href]').toArray().map(el=>{try{return new URL($(el).attr('href')!,source.finalUrl).href;}catch{return '';}}).find(url=>new URL(url||'https://invalid.invalid').hostname==='assessment.cot.tn.gov');
if(!url || source.httpStatus!==200)throw Error('No replacement link on the official agency source');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
try{
 const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});await page.waitForTimeout(1500);
 const html=await page.content();const finalUrl=page.url();const text=await page.locator('body').innerText();
 const result={url,finalUrl,state:'TN',sourceUrl,sourceStatus:source.httpStatus,linkedFromSource:true,httpStatus:res?.status(),...classifyGovernmentPage({html,finalUrl,httpStatus:res?.status()},'appraiser'),text,checkedAt:new Date().toISOString(),method:'Official source link + Chromium without TLS bypass'};
 writeFileSync('scripts/data/gov-round2-statewide.json',JSON.stringify(result,null,2)+'\n');
 console.log({url,finalUrl,status:result.status,httpStatus:result.httpStatus});
}finally{await browser.close();}
