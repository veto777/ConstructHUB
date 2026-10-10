import {load} from 'cheerio';
import type {AdapterCtx, PermitRecord, PortalAdapter} from '../types';
import {PublicSession,formFields,emptyRecord,isoDate,assertPublicPage} from './http';
const prefix='ctl00$cphBody$';
export function parseResults(html:string,ctx:AdapterCtx):PermitRecord[] {
 assertPublicPage(html,ctx.searchUrl);const $=load(html);const records:PermitRecord[]=[];
 if(/Permit #\s*\d+/.test($('#LabelPgTitle').text())) { const title=$('#LabelPgTitle').text().trim();const n=title.match(/Permit #\s*(\d+)/)![1];const val=(id:string)=>$('#cphBody_'+id).attr('value')?.trim()||null;const pages:Record<string,string>={'0':'BLPermit.aspx','1':'BLPermit.aspx','2':'APermitEL.aspx','3':'APermitPL.aspx','4':'APermitME.aspx','6':'APermitFR.aspx','7':'MHPermit.aspx','8':'APermitIG.aspx'};const valuation=val('txtValuation');return [{...emptyRecord(ctx,n),address:val('txtPrjAddr'),issuedAt:isoDate(val('txtIssueDt')),description:val('txtPropUse'),permitType:title.split(' Permit #')[0],contractorLicense:val('txtCLId'),status:$('#cphBody_LabelStatus').text().trim()||null,valuation:valuation!==null&&Number.isFinite(Number(valuation.replace(/[$,]/g,'')))?Number(valuation.replace(/[$,]/g,'')):null,sourceUrl:pages[n[0]]?new URL(pages[n[0]]+'?PermitNo='+n+'&PopUp=1',ctx.searchUrl).href:null,raw:{html}}];}
 const count=$('#InfoSpan').text().match(/Records Retrieved:\s*(\d+)/);
 if(!count)throw new Error('St. Johns: missing result count (portal failure or changed layout)');
 const colors:Record<string,string>={};$('span[style*="background-color"]').each((_,el)=>{const color=$(el).attr('style')?.match(/background-color:([^;]+)/i)?.[1].toLowerCase();if(color)colors[color]=$(el).text().trim();});
 $('#cphBody_gvSearch tr').each((_,el)=>{const cells=$(el).children('td');if(cells.length!==5)return;const values=cells.map((_,c)=>$(c).text().trim()).get();const permitNumber=values[0];if(!/^\d+$/.test(permitNumber))throw new Error('St. Johns: invalid permit number');const page:Record<string,string>={'0':'BLPermit.aspx','1':'BLPermit.aspx','2':'APermitEL.aspx','3':'APermitPL.aspx','4':'APermitME.aspx','6':'APermitFR.aspx','7':'MHPermit.aspx','8':'APermitIG.aspx'};
 const color=$(el).attr('style')?.match(/background-color:([^;]+)/i)?.[1].toLowerCase();
 records.push({...emptyRecord(ctx,permitNumber),address:values[1]||null,workClass:values[2]||null,issuedAt:isoDate(values[3]),contractorName:values[4]||null,status:color?colors[color]??null:null,sourceUrl:page[permitNumber[0]]?new URL(`${page[permitNumber[0]]}?PermitNo=${permitNumber}&PopUp=1`,ctx.searchUrl).href:null,raw:{html:$.html(el)}});});
 if(records.length!==Number(count[1]))throw new Error(`St. Johns: incomplete results, expected ${count[1]}, got ${records.length}`);
 return records;
}
async function query(ctx:AdapterCtx,values:Record<string,string>) {
 const url=new URL(ctx.searchUrl);if(url.host!=='webapp.sjcfl.us'||!/^\/watswebx\/Permit\/SearchPermit.aspx$/i.test(url.pathname))throw new Error('Not a St. Johns WATS permit search URL');
 const session=new PublicSession(ctx);const html=await session.request(url.href);const fields=formFields(html);
 for(const key of ['txtAddr','txtProjNm','txtPermitNo','txtClrsht','txtParcel','txtCLNm','txtCLId','txtSepticNo','TextBoxFromDt','TextBoxToDt','txtLgl1','txtLgl2','txtLgl3'])fields.set(prefix+key,'');
 fields.set(prefix+'ddPermitType','-1');fields.set(prefix+'btnSearch','Search');for(const[k,v]of Object.entries(values))fields.set(prefix+k,v);
 return parseResults(await session.request(url.href,fields),ctx);
}
const site:PortalAdapter={platform:'WATS (county-specific)',capabilities:{search:['address','permit','company','license','name'],listRecent:true,detail:false},async search(ctx,q){const fields:Record<string,string>={address:'txtAddr',permit:'txtPermitNo',company:'txtCLNm',license:'txtCLId',name:'txtCLNm'};const field=fields[q.type];if(!field)throw new Error(`St. Johns does not support ${q.type} search`);if(!q.value.trim())throw new Error('Search value required');return query(ctx,{[field]:q.value.trim()});},async listRecent(ctx,since){const day=isoDate(since);if(!day)throw new Error('Invalid since date');const d=new Date(day);d.setUTCDate(d.getUTCDate()-1);const us=(s:string)=>{const[y,m,d]=s.split('-');return `${m}/${d}/${y}`;};return(await query(ctx,{TextBoxFromDt:us(d.toISOString().slice(0,10)),TextBoxToDt:us(new Date(Date.now()+86400000).toISOString().slice(0,10))})).filter(r=>r.issuedAt!==null&&r.issuedAt!==undefined&&r.issuedAt>=day);}};
export default site;
