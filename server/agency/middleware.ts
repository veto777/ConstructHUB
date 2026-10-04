import { grantStatus } from '../gbp/grants';
import type { Express } from 'express';
import { pool } from '../db';
import { z } from 'zod';
import { GoogleError } from '../gbp/client';
import { requestAccess } from './routes';
import { camel, clientAccess, filters, listLocations, locationAccess, locationFilter, locationJoin, missing, requireWrite } from './access';
import { firstZodMessage, locationUpdateInput } from '../route-guards';
const sitescanList=z.object({
  status:z.enum(['','queued','running','completed','failed']).default(''),
  locationId:z.coerce.number().int().positive().max(2147483647).optional(),
  locationQ:z.string().trim().max(200).default(''),
  locationOffset:z.coerce.number().int().min(0).max(1000000).default(0),
  // 50 keeps the agency list contract; the Site Scan page pages by 25.
  limit:z.coerce.number().int().min(1).max(100).default(50),
});
// What an agency member may edit on a location: the owner's rules for these fields (blank social links,
// null notification email = account-level settings), never provider links or ownership.
const memberLocationUpdate=locationUpdateInput.pick({businessName:true,notificationEmail:true,gbpManagementEnabled:true,socialProfiles:true});
/** Closed allowlist: delegated identity is supplied ONLY after an object check. Unknown routes never
 * inherit the owner's authority. Personal account/security/CRM routes retain the real actor. */
export function registerAgencyAccess(app:Express) {
  app.use(async(req,res,next)=>{
    const protectedPath=/^\/api\/(locations|gbp|google-profile-reviews|citations|sitescan|social)(\/|$)/.test(req.path);
    if(!protectedPath||!req.user)return next();
    try {
      const a=await requestAccess(req),member=a.owner!==a.actor;
      if(member&&req.method!=='GET')requireWrite(a);
      if(req.path==='/api/locations'&&req.method==='GET') {
        const data=await listLocations(a,filters.parse(req.query));
        // Preserve the legacy array contract; new consumers request an envelope explicitly.
        return void res.json(req.query.paged==='true'?data:data.items);
      }
      if(req.path==='/api/google-profile-reviews'&&req.method==='GET') {
        const f=filters.parse(req.query),w=locationFilter(a,f);
        const rating=req.query.rating?z.coerce.number().int().min(1).max(5).parse(req.query.rating):null;
        const location=req.query.locationId?z.coerce.number().int().positive().parse(String(req.query.locationId).replace(/^loc-/,'')):null;
        const response=z.enum(['answered','unanswered','all']).parse(req.query.response||'all');
        const search=z.string().max(200).parse(req.query.search||'');
        const params=[...w.values,location,rating,response,`%${search.replace(/[\\%_]/g,'\\$&')}%`];
        const where=`${w.sql} AND NOT r.google_deleted AND ($8::int IS NULL OR r.location_id=$8) AND ($9::int IS NULL OR r.rating=$9) AND ($10='all' OR ($10='answered' AND r.reply_comment IS NOT NULL) OR ($10='unanswered' AND r.reply_comment IS NULL)) AND concat_ws(' ',r.reviewer_name,r.comment,r.reply_comment) ILIKE $11`;
        // Legacy location-less personal reviews remain visible to their owner, never delegated users.
        const from=`google_profile_reviews r LEFT JOIN business_locations l ON l.id=r.location_id AND l.user_id=r.user_id LEFT JOIN agency_clients c ON c.id=l.agency_client_id AND c.user_id=l.user_id`;
        const effective=member||f.clientId||f.q||f.folder||f.tag||f.status!=='all'?where:where.replace(w.sql,'r.user_id=$1 AND $2::boolean AND $3::int IS NOT NULL AND $4::int IS NULL AND $5::text IS NOT NULL AND $6::text IS NULL AND $7::text IS NULL');
        const [{rows},{rows:[stats]}]=await Promise.all([pool.query(`SELECT r.*,l.business_name FROM ${from} WHERE ${effective} ORDER BY r.review_date DESC,r.id DESC LIMIT 50 OFFSET $12`,[...params,f.offset]),pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE r.reply_comment IS NULL)::int unanswered,avg(r.rating)::float average,ARRAY[${[5,4,3,2,1].map(n=>`count(*) FILTER(WHERE r.rating=${n})::int`).join(',')}] distribution FROM ${from} WHERE ${effective}`,params)]);
        return void res.json(req.query.paged==='true'?{items:rows.map(camel),...stats,offset:f.offset,pageSize:50}:rows.map(camel));
      }
      if(req.path==='/api/sitescan'&&req.method==='GET') {
        // Site Scan's own list params: status is a scan status (not the agency location status), locationId
        // narrows history to one business, locationQ/locationOffset page the business picker.
        const {status,locationId,locationQ,locationOffset,limit,...rest}=req.query as Record<string,unknown>;
        const s=sitescanList.parse({status,locationId,locationQ,locationOffset,limit});
        const f=filters.parse(rest),w=locationFilter(a,{...f,q:''});
        const like=(v:string)=>`%${v.replace(/[\\%_]/g,'\\$&')}%`;
        const params=[...w.values,like(f.q),f.offset,s.status,s.locationId??null,s.limit];
        const {rows:jobs}=await pool.query(`SELECT j.id,j.url,j.status,j.error,j.created_at,j.completed_at,j.report->'scores' scores,jsonb_array_length(j.state->'pages') pages,j.page_cap,j.profile->>'business_name' client,count(*) OVER()::int total FROM sitescan_jobs j LEFT JOIN business_locations l ON l.id=(j.profile->>'id')::int AND l.user_id=j.user_id LEFT JOIN agency_clients c ON c.id=l.agency_client_id AND c.user_id=l.user_id WHERE ((${w.sql}) OR ($2::boolean AND $4::int IS NULL AND j.user_id=$1 AND j.profile IS NULL)) AND concat_ws(' ',j.url,l.business_name) ILIKE $8 AND ($10='' OR j.status=$10) AND ($11::int IS NULL OR l.id=$11) ORDER BY j.created_at DESC,j.id LIMIT $12 OFFSET $9`,params);
        // Only Business Profile-linked locations can be compared (the scan reads their synced profile).
        const {rows:locations}=await pool.query(`SELECT l.id,l.business_name,l.website,count(*) OVER()::int total FROM ${locationJoin} WHERE ${w.sql} AND l.gbp_location_name IS NOT NULL AND concat_ws(' ',l.business_name,l.website) ILIKE $8 ORDER BY l.id LIMIT $9 OFFSET $10`,[...w.values,like(s.locationQ),s.limit,s.locationOffset]);
        // Count independently of the page: locations[0].total reads the window off the current page,
        // so paging past the end reported "no locations" even when locations exist.
        const {rows:[locationCount]}=await pool.query(`SELECT count(*)::int total FROM ${locationJoin} WHERE ${w.sql} AND l.gbp_location_name IS NOT NULL AND concat_ws(' ',l.business_name,l.website) ILIKE $8`,[...w.values,like(s.locationQ)]);
        // URL-only schedules (no location, or a deleted one) belong to the owner, like profile-less jobs above.
        const {rows:schedules}=await pool.query(`SELECT s.* FROM sitescan_schedules s LEFT JOIN business_locations l ON l.id=s.location_id AND l.user_id=s.user_id LEFT JOIN agency_clients c ON c.id=l.agency_client_id AND c.user_id=l.user_id WHERE ((${w.sql}) OR ($2::boolean AND $4::int IS NULL AND s.user_id=$1 AND l.id IS NULL)) ORDER BY s.url LIMIT 50`,w.values);
        return void res.json({jobs,locations:locations.map(({total,...l})=>l),locationTotal:locationCount?.total??0,schedules,total:jobs[0]?.total??0});
      }
      if(req.path==='/api/citations/campaigns'&&req.method==='GET') {
        const f=filters.parse(req.query),w=locationFilter(a,f),id=req.query.locationId?z.coerce.number().int().positive().parse(req.query.locationId):null;
        const {rows}=await pool.query(`SELECT p.*,count(*) OVER()::int total FROM citation_campaigns p JOIN business_locations l ON l.id=p.location_id AND l.user_id=p.user_id LEFT JOIN agency_clients c ON c.id=l.agency_client_id AND c.user_id=l.user_id WHERE ${w.sql} AND ($8::int IS NULL OR l.id=$8) ORDER BY p.id DESC LIMIT 50 OFFSET $9`,[...w.values,id,f.offset]);
        return void res.json(req.query.paged==='true'?{items:rows.map(camel),total:rows[0]?.total??0}:rows.map(camel));
      }
      // The agency social list is for delegated members (or an explicit agency client filter). The owner's own
      // per-business workbench (?businessId=) is served by server/social/routes.ts, never this owner-wide list.
      if(req.path==='/api/social'&&req.method==='GET'&&req.query.businessId===undefined&&(member||req.query.clientId!==undefined)) {
        const f=filters.parse(req.query);
        const {rows:posts}=await pool.query(`SELECT p.*,m.client_id,count(*) OVER()::int total FROM social_posts p LEFT JOIN agency_social_post_clients m ON m.post_id=p.id AND m.user_id=p.user_id WHERE p.user_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM agency_member_clients ac WHERE ac.user_id=p.user_id AND ac.member_id=$3 AND ac.client_id=m.client_id)) AND ($4::int IS NULL OR m.client_id=$4) AND p.payload::text ILIKE $5 ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET $6`,[a.owner,a.allClients,a.actor,f.clientId??null,`%${f.q.replace(/[\\%_]/g,'\\$&')}%`,f.offset]);
        const {rows:[connection]}=await pool.query('SELECT accounts FROM social_connections WHERE user_id=$1',[a.owner]);
        let accounts=connection?.accounts||[];
        if(member){
          const {rows:assigned}=await pool.query(`SELECT d.destinations FROM agency_social_destinations d WHERE d.user_id=$1 AND ($2::int IS NULL OR d.client_id=$2) AND ($3::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=d.user_id AND m.client_id=d.client_id AND m.member_id=$4))`,[a.owner,f.clientId??null,a.allClients,a.actor]);
          const allowed=assigned.flatMap(r=>r.destinations);
          accounts=accounts.filter((v:any)=>allowed.some((d:any)=>d.accountId===v.id)).map((v:any)=>({...v,pages:v.pages?.filter((p:any)=>allowed.some((d:any)=>d.accountId===v.id&&d.pageId===p.id)),boards:v.boards?.filter((p:any)=>allowed.some((d:any)=>d.accountId===v.id&&d.boardId===p.id))}));
        }
        const {rows:[settings]}=member||f.clientId?{rows:[]}:await pool.query('SELECT settings,next_at,last_error FROM social_settings WHERE user_id=$1',[a.owner]);
        return void res.json({connected:!!connection,accounts,settings:settings?.settings,nextAt:settings?.next_at,lastError:settings?.last_error,posts,total:posts[0]?.total??0});
      }
      if(req.method==='POST'&&['/api/citations/campaigns','/api/sitescan','/api/sitescan/schedule'].includes(req.path)&&(member||req.body.locationId)) {
        const id=z.coerce.number().int().positive().parse(req.body.locationId);await locationAccess(a,id,true);res.locals.agencyOwner=a.owner;return next();
      }
      if(!member||req.path==='/api/gbp/guard/reauth')return next();
      // No delegation for account-wide credentials, discovery, media libraries or automation settings.
      if(req.path==='/api/gbp/status'&&req.method==='GET')return void res.json({connected:(await grantStatus(a.owner)).connected,accounts:[],locations:[],delegated:true});
      if(req.path==='/api/gbp/linkage'&&req.method==='GET')return void res.json({accounts:[],locations:[],errors:[]});
      let id:number|undefined;
      const location=req.path.match(/^\/api\/(?:locations|gbp\/locations|gbp\/content)\/(\d+)(?:\/|$)/);
      if(location)id=Number(location[1]);
      const review=req.path.match(/^\/api\/google-profile-reviews\/(\d+)(?:\/|$)/);
      const report=req.path.match(/^\/api\/gbp\/reports\/(changes|reviews)\/(\d+)$/);
      const campaign=req.path.match(/^\/api\/citations\/campaigns\/(\d+)(?:\/|$)/);
      const citation=req.path.match(/^\/api\/citations\/(\d+)$/);
      const scan=req.path.match(/^\/api\/sitescan\/jobs\/([a-f0-9-]+)(?:\/|$)/);
      if(review||report||campaign||citation||scan) {
        let sql:string,params:unknown[];
        if(review){sql='SELECT location_id FROM google_profile_reviews WHERE user_id=$1 AND id=$2';params=[a.owner,review[1]];}
        else if(report){sql=`SELECT location_id FROM ${report[1]==='changes'?'gbp_guard_changes':'google_profile_reviews'} WHERE user_id=$1 AND id=$2`;params=[a.owner,report[2]];}
        else if(campaign){sql='SELECT location_id FROM citation_campaigns WHERE user_id=$1 AND id=$2';params=[a.owner,campaign[1]];}
        else if(citation){sql='SELECT c.location_id FROM citations r JOIN citation_campaigns c ON c.id=r.campaign_id WHERE c.user_id=$1 AND r.id=$2';params=[a.owner,citation[1]];}
        else{sql="SELECT (profile->>'id')::int location_id FROM sitescan_jobs WHERE user_id=$1 AND id=$2";params=[a.owner,scan![1]];}
        const {rows:[r]}=await pool.query(sql,params);if(!r?.location_id)throw missing();id=r.location_id;
      }
      if(id===undefined)throw missing();
      await locationAccess(a,id,req.method!=='GET');
      // Media assets are owner-wide; do not expose them through a location route.
      if(/^\/api\/gbp\/content\//.test(req.path)&&!/^\/api\/gbp\/content\/\d+$/.test(req.path))throw missing();
      // Guard reauth must be the actor's, and mode updates are available through the agency bulk endpoint.
      if(req.path.endsWith('/guard')&&req.method!=='GET')throw missing();
      // Block fields that could cross ownership or alter provider links through generic local editing.
      if(req.method==='PUT'&&/^\/api\/locations\/\d+$/.test(req.path)) {
        const parsed=memberLocationUpdate.safeParse(req.body??{});
        if(!parsed.success)return void res.status(400).json({message:firstZodMessage(parsed.error)});
        req.body=parsed.data;
      }
      res.locals.agencyOwner=a.owner;next();
    }catch(e){res.status(e instanceof z.ZodError?400:e instanceof GoogleError?e.status:500).json({message:e instanceof z.ZodError?'Invalid input':e instanceof GoogleError?e.message:'Access check failed'});}
  });
}
