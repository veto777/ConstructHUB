/** Public, read-only endpoint discovery. Run only after classification finishes. */
import { writeFileSync } from 'node:fs';
import { load } from 'cheerio';
import { politeFetch, CHROMIUM_ARGS, USER_AGENT, rateLimitHost } from '../../polite-fetch';
import { chromium } from 'playwright-core';
const [name,url,mode] = process.argv.slice(2);
const dir='server/scrapers/fixtures/city-built';
if (!name || !url) throw new Error('probe.ts name url [browser]');
let html='';
if(mode==='browser') {
 const browser=await chromium.launch({headless:true,args:CHROMIUM_ARGS});
 const ctx=await browser.newContext({userAgent:USER_AGENT});
 let chain=Promise.resolve();
 try {
 await ctx.route('**/*',async route=>{const req=route.request();if(!['document','script','xhr','fetch'].includes(req.resourceType())||/google-analytics|googletagmanager|recaptcha|captcha|cloudflareinsights/.test(req.url()))return route.abort();chain=chain.then(async()=>{await rateLimitHost(req.url(),1000);try{const res=await route.fetch({timeout:15000});console.log('NETWORK',res.status(),req.method(),req.url(),req.postData()?.slice(0,500));if(['xhr','fetch'].includes(req.resourceType()))writeFileSync(`${dir}/${name}-${Date.now()}.json`,await res.body());await route.fulfill({response:res});}catch(e){console.log(String(e));await route.abort().catch(()=>{});}});await chain;});
 const page=await ctx.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForTimeout(8000);html=await page.content();console.log('URL',page.url());
 }finally{await ctx.close();await browser.close();}
}else{const res=await politeFetch(url,{}, {minDelayMs:1000,retries:0,timeoutMs:15000});console.log('HTTP',res.status,res.url);html=await res.text();}
writeFileSync(`${dir}/${name}.html`,html);
const $=load(html);console.log('SCRIPTS',$('script[src]').map((i,e)=>$(e).attr('src')).get());
console.log('FORMS',$('form').map((i,e)=>({action:$(e).attr('action'),method:$(e).attr('method')})).get());
console.log('INPUTS',$('input:not([type=hidden]),select,button').map((i,e)=>({name:$(e).attr('name'),id:$(e).attr('id'),type:$(e).attr('type'),value:$(e).attr('value'),text:$(e).text().replace(/\s+/g,' ').slice(0,200)})).get());
$('script,style').remove();console.log('TEXT',$('body').text().replace(/\s+/g,' ').slice(0,15000));console.log('LINKS',$('a[href]').map((i,e)=>({text:$(e).text().replace(/\s+/g,' ').trim(),href:$(e).attr('href')})).get().filter(x=>/search|permit|record|detail/i.test(x.text+' '+x.href)).slice(0,80));
