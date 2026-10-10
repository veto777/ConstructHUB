/** Re-run: npx tsx server/scrapers/fixtures/city-built/classify.ts. Bounded to two distinct hosts. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { chromium, type Browser } from 'playwright-core';
import { politeFetch, PortalBlockedError, USER_AGENT, CHROMIUM_ARGS, rateLimitHost } from '../../polite-fetch';
const dir = 'server/scrapers/fixtures/city-built';
const targets = JSON.parse(readFileSync('targets.json', 'utf8')) as {jurisdiction:string;url:string;platform:string|null}[];
const results: any[] = existsSync(`${dir}/classification.json`) ? JSON.parse(readFileSync(`${dir}/classification.json`, 'utf8')) : [];
let browser: Browser | undefined;
const vendors: [string, RegExp][] = [ ['Accela', /accela[.-]|accela citizen/i], ['EnerGov', /energov|tylerportico/i], ['iWorQ', /iworq|iworqsystems/i], ['OpenGov', /opengov\.com|viewpointcloud/i], ['Tyler eSuite', /esuite|htrhtm/i], ['SmartGov', /smartgovcommunity|smartgov/i], ['MyBuildingPermit', /mybuildingpermit\.com/i], ['PermitPro/Patriot', /patriotpermitpro|permitpro/i], ['Ascent', /ascentlandrecords|ascentpermit|\/\/ascent\./i], ['TEK Connect', /tekconnect|tek connect/i], ['FireInspection360', /FireInspection360\.com/i], ['Computronix POSSE', /PossePresentation|javascript\/posseglobal/i], ['Avenu LDO', /Avenu Insights.*Analytics/i], ['GovPilot', /govpilot\.com/i], ['CityView', /cityview.*\/Portal\/|CityView Portal/i], ['SAGE / Clear Village', /SAGE from Clear Village|clearvillageinc\.com/i], ['Cityworks', /cityworksonline|cityworks\.com/i], ['HeyGov', /heygov\.com/i], ['GovEasy', /gov-easy\.com/i], ['PermitMe', /permitme\.io/i], ['Avolve', /avolvecloud/i], ['Harris Govern', /onlinegovt\.com/i], ['eGovPlus', /egovplus/i], ['MyGov', /public\.mygov\.us|mygov\.us/i], ['eTRAKiT', /etrakit/i], ['Cloudpermit', /cloudpermit/i], ['Civic Review', /civicreview/i], ['CityGrows', /citygrows|cleargov/i], ['Citizenserve', /citizenserve/i], ['BS&A', /bsaonline/i], ['MGO', /mygovernmentonline|mgoconnect\.org/i] ];
function decide(html:string,url:string,status:number) {
 const $=load(html); if(/grecaptcha[\s\S]{0,50}\.execute/.test(html) && /validatePermitValues|validateAddressValues/.test(html))return {verdict:'blocked',evidence:'Permit search JavaScript requires a reCAPTCHA token before submitting'}; if(html.startsWith('%PDF-'))return {verdict:'info-page',evidence:'PDF document, not an interactive record search'}; $('script,style').remove(); const text=$('body').text().replace(/\s+/g,' ').trim();
 if ($('form .g-recaptcha,form .h-captcha,input[name*=txtSecretCode],input[name=recaptchaToken]').length) return {verdict:'blocked',evidence:'Search page requires a CAPTCHA/security code'};
 if (/captcha|verify you are human|access denied|incapsula incident|request unsuccessful|just a moment|checking your browser/i.test(text)) return {verdict:'blocked',evidence:text.slice(0,400)};
 if(status>=400) return {verdict:'dead',evidence:`HTTP ${status}`};
 const links=$('a[href]').toArray().map(e=>({href:$(e).attr('href')!,text:$(e).text().replace(/\s+/g,' ').trim()}));
 for(const [vendor,re] of vendors) { const match = re.exec(url) ?? (['FireInspection360','Computronix POSSE','Avenu LDO','SAGE / Clear Village','CityView','MGO'].includes(vendor)?re.exec(html):null); if(match) return {verdict:'vendor',vendor,evidence:match[0]}; }
 const embedded=$('iframe[src],script[src]').map((_,e)=>$(e).attr('src')).get().join(' ');
 for(const [vendor,re] of vendors){const match=re.exec(embedded);if(match)return {verdict:'vendor',vendor,evidence:match[0]};}
 const search=links.find(l=>! /\.pdf|revision|records request|onlinepayment|pay permit|available properties|occupancy search|recertification|permits a to z/i.test(l.text+' '+l.href) && /permit|building/i.test(l.text+' '+l.href)&&/search|lookup|look.?up/i.test(l.text+' '+l.href));
 const form = ($('input[name*=cmdAPNoSearch]').length>0) || (/Permit Search/i.test(text)&&$('select[name=SearchBy]').length>0) || $('form').toArray().some(e=>{const f=$(e);return /(?:permit|application) (?:number|#)/i.test(f.text()) && f.find('button,input[type=submit]').toArray().some(b=>/search|find/i.test($(b).text()+' '+$(b).attr('value'))) && !f.find('input[type=file]').length;});
 if(search)for(const [vendor,re] of vendors){if(re.test(search.href))return {verdict:'vendor',vendor,evidence:`${search.text} ${search.href}`};}
 if(search||form) return {verdict:'record-search',evidence:search?`${search.text} ${search.href}`:text.slice(0,1200)};
 for(const [vendor,re] of vendors) {const match=re.exec(html);if(match)return {verdict:'vendor',vendor,evidence:match[0]};}
 if($('input[type=password]').length)return {verdict:'application-only',evidence:'Login-only entry page; no anonymous record-search control found. '+text.slice(0,250),reviewRequired:true};
 if(/file applications|online application system|apply online|request an inspection/i.test(text)) return {verdict:'application-only',evidence:text.match(/.{0,80}(?:apply online|apply for a permit|submit.{0,30}application|request.{0,30}inspection).{0,120}/i)?.[0]??text.slice(0,400)};
 return {verdict:'info-page',evidence:text.slice(0,500)||'No readable text in fetched document; JS rendering inconclusive',reviewRequired:text.length<200||/enable javascript|loading|connection lost|css error/i.test(text)};
}
async function run(i:number) {
 const t=targets[i]; if(process.argv.includes('--offline')&&!results[i])return; if(results[i]) { const p=`${dir}/${i}${results[i].rendered?'.rendered':''}.html.gz`; if(existsSync(p)&&results[i].httpStatus===200) {const {vendor:previousVendor,reviewRequired:previousReview,...previous}=results[i]; results[i]={...previous,...decide(gunzipSync(readFileSync(p)).toString(),results[i].finalUrl??t.url,200)};} return;}
 let status:number|null=null; let finalUrl=t.url;
 try {
 const res=await politeFetch(t.url,{}, {minDelayMs:1000,retries:0,timeoutMs:7000});status=res.status;finalUrl=res.url;
 let html=await res.text(); writeFileSync(`${dir}/${i}.html.gz`,gzipSync(html));
 let rendered=false;
 const $=load(html); $('script,style').remove();
 if(res.ok && !/\.pdf(?:$|\?)/i.test(t.url) && ($('body').text().trim().length<200 || /<app-root|ng-app=|id="(?:root|app)"/.test(html)) && !/captcha|challenge-platform/i.test(html)) {
 try {
 browser??=await chromium.launch({headless:true,args:CHROMIUM_ARGS});
 const ctx=await browser.newContext({userAgent:USER_AGENT});
 try { let chain=Promise.resolve(); await ctx.route('**/*',async route=> {if(!['document','script','xhr','fetch'].includes(route.request().resourceType())||/google-analytics|googletagmanager/.test(route.request().url()))return route.abort();chain=chain.then(async()=>{await rateLimitHost(route.request().url(),1000);try{const response=await route.fetch({timeout:7000});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});await chain;});
 const page=await ctx.newPage();await page.goto(finalUrl,{waitUntil:'domcontentloaded',timeout:12000});await page.waitForTimeout(2000);html=await page.content();rendered=true;writeFileSync(`${dir}/${i}.rendered.html.gz`,gzipSync(html));
 }finally{await ctx.close();}
 } catch(e) {html+='<!-- Render failed: '+String(e)+' -->';}
 }
 results[i]={...t, ...decide(html,finalUrl,status),httpStatus:status,finalUrl,rendered,checkedAt:new Date().toISOString()};
 }catch(e){results[i]={...t,verdict:e instanceof PortalBlockedError?'blocked':'dead',evidence:String(e),httpStatus:e instanceof PortalBlockedError?e.status:status,checkedAt:new Date().toISOString()};}
 writeFileSync(`${dir}/classification.json`,JSON.stringify(results,null,2)+'\n');
 console.log(i,t.jurisdiction,results[i].verdict,results[i].evidence.slice(0,120));
}
// Pair only different hosts. Never more than two target requests in flight.
for(let i=0;i<targets.length;) {const a=i++;if(!process.argv.includes('--sequential')&&i<targets.length&&new URL(targets[a].url).host!==new URL(targets[i].url).host){const b=i++;await Promise.all([run(a),run(b)]);}else await run(a);}
// Secondary pages are observed links, with responses recorded by the discovery tools.
if(existsSync(`${dir}/supplemental-pages.json`)) for(const page of JSON.parse(readFileSync(`${dir}/supplemental-pages.json`,'utf8'))) {
 const r=results[page.targetIndex]; if(!r)continue;
 const decision = page.fixture ? decide(readFileSync(`${dir}/${page.fixture}`,'utf8'),page.url,page.httpStatus) : {verdict:[401,403,429].includes(page.httpStatus)?'blocked':'dead',evidence:page.error};
 if(['vendor','blocked','dead'].includes(decision.verdict)) {
  delete r.vendor; delete r.reviewRequired;
  Object.assign(r, decision, {evidence:`Linked search ${page.url}: ${decision.evidence}`,searchHttpStatus:page.httpStatus,searchUrl:page.url});
 }
}
writeFileSync(`${dir}/classification.json`,JSON.stringify(results,null,2)+'\n');
await browser?.close();
console.log('COUNTS', results.reduce((a,r)=>(a[r.verdict]=(a[r.verdict]??0)+1,a),{}));
