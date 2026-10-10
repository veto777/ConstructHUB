import { writeFileSync } from 'node:fs';
import { load } from 'cheerio';
import { PublicSession, assertPublicPage } from '../../city-built/http';
import type { AdapterCtx } from '../../types';
const url='https://www.palmcoast.gov/building/search';
const session=new PublicSession({searchUrl:url,politeness:{minDelayMs:1000}} as AdapterCtx, new URL(url).origin,(html,u)=>{const $=load(html);if($('#form-permit').length)$('#feedbackForm').remove();$('script').remove();assertPublicPage($.html(),u);});
const html=await session.request(url);const $=load(html);
const fields=new URLSearchParams({ActiveTab:'permit',__RequestVerificationToken:$('input[name=__RequestVerificationToken]').first().attr('value')!,...JSON.parse(process.argv[3])});
const result=await session.request(url,fields);writeFileSync(`server/scrapers/fixtures/city-built/${process.argv[2]}.html`,result);console.log(result.slice(0,10000));
