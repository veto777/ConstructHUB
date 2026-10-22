import { postSchema, destinationSchema } from '../../shared/social';
import { createPosts, changePost, validateDestinations } from '../social/service';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { GoogleError } from '../gbp/client';
import { grantStatus } from '../gbp/grants';
import { takeBudget, rateLimit, takeAccountBudget } from '../growth-limits';
import { logActivity } from '../account-events';
import { guardRecentAuthOk } from '../gbp/guard-routes';
import { accessFor, agencyPlan, agencyPlanRequired, clientAccess, dashboard, filters, forbidden, listLocations, locationAccess, locationFilter, locationJoin, missing, positiveId, requireAdmin, requireAllClients, requireOwner, requireWrite, workspaceEntitled, teamEntitled, teamPlanRequired, type AgencyAccess } from './access';
import { getEntitlements, inUse, plural, raiseHint, sendLimitReached } from '../entitlements';
import { PLANS } from '@shared/plans';
import { bulkInput, queueBulk } from './jobs';
import { createOnboarding, hash, instructions, onboardingLink } from './onboarding';
import { getOwnerSeatUsage, seatLimitBody, withSeatLock, type SeatUsage } from '../crm/tenancy';
declare module 'express-session' { interface SessionData { agencyOwner?:number } }
export async function requestAccess(req:Request):Promise<AgencyAccess> {
  if(!req.user)throw new GoogleError('auth','Not authenticated',401);
  const actor=req.user.id,owner=req.session?.agencyOwner;
  if(!owner||owner===actor)return accessFor(actor);
  // A delegation the owner can no longer grant (their plan no longer includes team access, or the
  // membership was removed) ends here: the member carries on as their own account instead of being locked out.
  const a=await accessFor(actor,owner).catch(e=>{if(e instanceof GoogleError&&e.status===404)return null;throw e;});
  if(a&&await teamEntitled(a.owner,a.actor))return a;
  if(req.session)delete req.session.agencyOwner;
  return accessFor(actor);
}
const clientInput=z.object({name:z.string().trim().min(1).max(200),contactEmail:z.string().trim().email().max(254).nullable().default(null),notes:z.string().max(10000).default(''),tags:z.array(z.string().trim().min(1).max(100)).max(30).default([]),folder:z.string().trim().max(100).nullable().default(null)}).strict();
// Curated, field-specific messages: raw Zod text is never echoed, and refinements written for people
// ("Provide an address or Place ID") pass through as-is.
const agencyFieldMessages:Record<string,string>={
  name:'Enter a name (1 to 200 characters).',
  contactEmail:'Enter a valid contact email, or leave it blank.',
  notes:'Notes must be 10,000 characters or fewer.',
  tags:'Each tag must be 1 to 100 characters, with up to 30 tags.',
  folder:'Folder must be 100 characters or fewer.',
  email:'Enter the email address of a registered ConstructHUB user.',
  role:'Choose a role: admin, manager or viewer.',
  clientIds:'Client IDs must be numbers from your client list.',
  clientId:'Choose a client.',
  subject:'Choose a connected agency Google account. If none is listed, connect the agency Google account first.',
  businessName:'Enter the exact business name on Google (one line, up to 300 characters).',
  address:'Address must be one line, 500 characters or fewer.',
  placeId:'Place ID must be one line, 300 characters or fewer.',
  destinations:'Choose up to 20 social destinations.',
  owner:'Choose a workspace.',
};
export function agencyInputMessage(e:z.ZodError):string {
  const issue=e.issues[0];
  if(!issue)return 'Invalid input';
  if(issue.code==='custom'&&issue.message&&issue.message!=='Invalid input')return issue.message;
  return agencyFieldMessages[String(issue.path[0]??'')]??'Invalid input';
}
/** LIKE/ILIKE pattern for a search box: the typed text is matched literally (no `%`/`_` wildcards). */
const like=(q:string)=>`%${q.replace(/[\\%_]/g,'\\$&')}%`;
export const csvCell=(value:unknown)=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
/** PUT /team answers 400 for an address with no account; this many such misses a day per workspace, then 429. */
export const TEAM_DAILY_MISSES=20;
export function registerAgencyRoutes(app:Express) {
  // Client-workspace routes need Agency access; team routes need platform team seats.
  // /me and /workspace let members find and open a team without a plan of their own.
  const route=(method:'get'|'post'|'put'|'delete',path:string,fn:(req:Request,res:Response,a:AgencyAccess)=>Promise<any>,planGate: boolean | 'team'=true)=>app[method]('/api/agency'+path,async(req,res)=>{
    try {const a=await requestAccess(req);res.setHeader('Cache-Control','no-store');
      if(planGate==='team'&&!await teamEntitled(a.owner,a.actor))return void teamPlanRequired(res);
      if(planGate===true&&!await workspaceEntitled(a.owner,a.actor))return void agencyPlanRequired(res);
      if(method!=='get'&&!await takeAccountBudget(a.actor, `agency-route:${a.actor}`,100))throw new GoogleError('quota','Request limit reached',429);
      await fn(req,res,a);
    }catch(e){res.status(e instanceof z.ZodError?400:e instanceof GoogleError?e.status:500).json({message:e instanceof z.ZodError?agencyInputMessage(e):e instanceof GoogleError?e.message:'Agency operation failed'});}
  });
  // Answers every signed-in user (pages use `entitled` to choose the agency or the personal view); workspaces
  // whose owner's plan no longer includes team access are not offered.
  route('get','/me',async(req,res,a)=>{
    const {rows}=await pool.query('SELECT w.user_id,w.name FROM agency_workspaces w WHERE w.user_id=$1 OR EXISTS(SELECT 1 FROM agency_members m WHERE m.user_id=w.user_id AND m.member_id=$1) ORDER BY w.user_id LIMIT 50',[a.actor]);
    const [entitled,open]=await Promise.all([workspaceEntitled(a.owner,a.actor),Promise.all(rows.map(w=>w.user_id===a.actor||teamEntitled(w.user_id,a.actor)))]);
    const {rows:[workspace]}=await pool.query('SELECT * FROM agency_workspaces WHERE user_id=$1',[a.owner]);
    res.json({...a,workspace,workspaces:rows.filter((_,i)=>open[i]),entitled,teamEntitled:await teamEntitled(a.owner,a.actor),...(entitled?{}:{requiredPlan:agencyPlan})});
  },false);
  // Workspace switcher: stores the chosen workspace owner in the session (membership and
  // its owner's plan verified). agency.tsx header select.
  route('post','/workspace',async(req,res,a)=>{
    const b=z.object({owner:positiveId}).strict().parse(req.body),t=await accessFor(a.actor,b.owner);
    // Returning to your own account is always allowed; opening someone else's workspace needs its owner's plan.
    if(t.owner!==t.actor&&!await teamEntitled(t.owner,t.actor))return void teamPlanRequired(res);
    req.session.agencyOwner=b.owner;res.json({ok:true});
  },false);
  // Settings tab (owner): upserts agency_workspaces (name, auto_accept_all — whether the
  // worker accepts any unmatched Google invitation). agency.tsx.
  route('put','/settings',async(req,res,a)=>{
    requireOwner(a);
    const b=z.object({name:z.string().trim().min(1).max(200),autoAcceptAll:z.boolean().default(false)}).strict().parse(req.body);
    await pool.query('INSERT INTO agency_workspaces(user_id,name,auto_accept_all) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET name=$2,auto_accept_all=$3,updated_at=now()',[a.owner,b.name,b.autoAcceptAll]);
    await logActivity(req,a.owner,'agency.settings',{actorId:a.actor,autoAcceptAll:b.autoAcceptAll});res.json({ok:true});
  });
  // Clients tab list: agency_clients of the workspace owner (?q name/email/folder/tags,
  // member client scoping, 50/page). agency.tsx.
  route('get','/clients',async(req,res,a)=>{
    const f=filters.parse(req.query),q=like(f.q);
    const where=`c.user_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=c.user_id AND m.client_id=c.id AND m.member_id=$3)) AND concat_ws(' ',c.name,c.contact_email,c.folder,array_to_string(c.tags,' ')) ILIKE $4`;
    const p=[a.owner,a.allClients,a.actor,q];
    // Each client carries its own numbers for the card: locations assigned to it and onboarding requests still
    // open (not linked or expired). The summary counts the whole visible set, whatever the search says; unassigned
    // locations are only countable with all-client access (a scoped member cannot see them).
    const [{rows},{rows:[n]},{rows:[summary]}]=await Promise.all([
      pool.query(`SELECT c.*,(SELECT count(*)::int FROM business_locations l WHERE l.user_id=c.user_id AND l.agency_client_id=c.id) location_count,(SELECT count(*)::int FROM agency_onboarding o WHERE o.user_id=c.user_id AND o.client_id=c.id AND o.status NOT IN ('linked','expired')) open_onboarding FROM agency_clients c WHERE ${where} ORDER BY c.id LIMIT 50 OFFSET $5`,[...p,f.offset]),
      pool.query(`SELECT count(*)::int total FROM agency_clients c WHERE ${where}`,p),
      pool.query(`SELECT (SELECT count(*)::int FROM agency_clients c WHERE c.user_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=c.user_id AND m.client_id=c.id AND m.member_id=$3))) clients,
        (SELECT count(*)::int FROM business_locations l WHERE l.user_id=$1 AND l.agency_client_id IS NOT NULL AND ($2::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=l.user_id AND m.client_id=l.agency_client_id AND m.member_id=$3))) locations_assigned,
        (SELECT CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM business_locations l WHERE l.user_id=$1 AND l.agency_client_id IS NULL) END) locations_unassigned`,[a.owner,a.allClients,a.actor]),
    ]);
    res.json({items:rows,total:n.total,offset:f.offset,pageSize:50,summary:{clients:summary.clients,locationsAssigned:summary.locations_assigned,locationsUnassigned:summary.locations_unassigned}});
  });
  // Client form create: INSERT agency_clients (admin + all-client access required).
  // Client workspaces are counted against the OWNER's plan (limits.clientWorkspaces,
  // -1 = unlimited): Agency includes 10, Unlimited has no cap. The count and insert
  // run under one advisory lock so racing creates can't pass a full count.
  // agency.tsx Clients tab.
  route('post','/clients',async(req,res,a)=>{
    requireAdmin(a);requireAllClients(a);const b=clientInput.parse(req.body);
    const ent=await getEntitlements(a.owner);
    const limit=ent.allowances?.clientWorkspaces ?? 0;
    const c=await pool.connect();
    let created;
    try{
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(7171,$1)',[a.owner]);
      const {rows:[n]}=await c.query('SELECT count(*)::int n FROM agency_clients WHERE user_id=$1',[a.owner]);
      if(limit!==-1&&n.n>=limit){
        await c.query('ROLLBACK');
        const raise=raiseHint(ent,'clientWorkspaces',['client workspace']);
        return void sendLimitReached(res,{feature:'clientWorkspaces',limit,used:n.n,upgradePlan:raise.upgradePlan,addon:raise.addon,
          message:`Your ${PLANS[ent.accessPlan!].name} plan includes ${plural(limit,'client workspace')}, and ${inUse(n.n)}. ${raise.text}`.trim()});
      }
      const {rows:[row]}=await c.query('INSERT INTO agency_clients(user_id,name,contact_email,notes,tags,folder) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[a.owner,b.name,b.contactEmail,b.notes,b.tags,b.folder]);
      await c.query('COMMIT');
      created=row;
    }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
    finally{c.release();}
    res.status(201).json(created);
  });
  // Client form update: UPDATE agency_clients (write role + client access required). The contact email is where the
  // onboarding steps are mailed, so changing it takes the owner or an admin; a manager keeps name, notes, tags and folder.
  // agency.tsx Clients tab "Save client".
  route('put','/clients/:id',async(req,res,a)=>{
    requireWrite(a);const id=positiveId.parse(req.params.id);const current=await clientAccess(a,id);const b=clientInput.parse(req.body);
    if((b.contactEmail??null)!==(current.contact_email??null)&&!['owner','admin'].includes(a.role))throw forbidden('Only the workspace owner or an admin can change a client\'s contact email; the onboarding steps are emailed to it.');
    await pool.query('UPDATE agency_clients SET name=$3,contact_email=$4,notes=$5,tags=$6,folder=$7 WHERE user_id=$1 AND id=$2',[a.owner,id,b.name,b.contactEmail,b.notes,b.tags,b.folder]);res.json({ok:true});
  });
  // Team tab list (admin+): agency_members joined with users, each with its
  // agency_member_clients id array (50/page). agency.tsx.
  route('get','/team',async(req,res,a)=>{
    requireAdmin(a);const f=filters.parse(req.query);
    // Each member row names its clients (not only their ids) for the Team cards; the seat count is the plan's
    // (owner + members + extra seats), the same figure PUT /team refuses on. A scoped admin sees only the clients
    // they can see on /clients in those arrays (the same visibility clause), never the whole customer list.
    const visible='EXISTS(SELECT 1 FROM agency_member_clients v WHERE v.user_id=mc.user_id AND v.client_id=mc.client_id AND v.member_id=$5)';
    const [{rows},seats]=await Promise.all([
      pool.query(`SELECT m.member_id,m.role,m.all_clients,u.email,u.display_name,ARRAY(SELECT client_id FROM agency_member_clients mc WHERE mc.user_id=m.user_id AND mc.member_id=m.member_id AND ($4::boolean OR ${visible}) ORDER BY client_id) client_ids,ARRAY(SELECT c.name FROM agency_member_clients mc JOIN agency_clients c ON c.user_id=mc.user_id AND c.id=mc.client_id WHERE mc.user_id=m.user_id AND mc.member_id=m.member_id AND ($4::boolean OR ${visible}) ORDER BY c.id) client_names,count(*) OVER()::int total FROM agency_members m JOIN users u ON u.id=m.member_id WHERE m.user_id=$1 AND u.email ILIKE $2 ORDER BY m.member_id LIMIT 50 OFFSET $3`,[a.owner,like(f.q),f.offset,a.allClients,a.actor]),
      getOwnerSeatUsage(a.owner,{product:'platform'}),
    ]);
    res.json({items:rows,total:rows[0]?.total??0,seats:{used:seats.used,limit:seats.limit}});
  },'team');
  // Adds/updates a team member: upserts agency_members + agency_member_clients under the
  // owner's seat lock (403 when plan seats are full). Member form — agency.tsx Team tab.
  route('put','/team',async(req,res,a)=>{
    // Only the owner can grant access; scoped admins cannot escalate themselves or other members.
    requireOwner(a);
    const b=z.object({email:z.string().email().max(254),role:z.enum(['admin','manager','viewer']),allClients:z.boolean().default(false),clientIds:z.array(positiveId).max(5000).default([])}).strict().parse(req.body);
    if(!await workspaceEntitled(a.owner,a.actor)){
      if(b.clientIds.length)return void agencyPlanRequired(res);
      b.allClients=true;
    }
    const {rows:[u]}=await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)',[b.email]);
    // An unknown address answers 400, which says the address has no account: a day's worth of misses is enough for
    // typos, not for walking an address list through the form.
    if(!u&&!await takeBudget(`agency-team-miss:${a.owner}`,TEAM_DAILY_MISSES,1,86400000))throw new GoogleError('quota','Too many unrecognised email addresses today. Check the address with the person and try again tomorrow.',429);
    if(!u||u.id===a.owner)throw new GoogleError('invalid','Choose another registered ConstructHUB user',400);
    const {rows:[n]}=await pool.query('SELECT count(*)::int n FROM agency_clients WHERE user_id=$1 AND id=ANY($2::int[])',[a.owner,[...new Set(b.clientIds)]]);
    if(n.n!==new Set(b.clientIds).size)throw missing();
    await pool.query('INSERT INTO agency_workspaces(user_id) VALUES($1) ON CONFLICT DO NOTHING',[a.owner]);
    // Platform seats count the owner, team members and Extra seat add-ons. The seat lock
    // makes concurrent additions count one after another, all on the connection holding it; changing an existing
    // member's role takes no seat.
    const full=await withSeatLock(a.owner,async({client:c,ent}):Promise<SeatUsage|null>=>{
      const seats=await getOwnerSeatUsage(a.owner,{adding:{userId:u.id},client:c,ent,product:"platform"});
      if(!seats.canAdd)return seats;
      await c.query('INSERT INTO agency_members(user_id,member_id,role,all_clients) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,member_id) DO UPDATE SET role=$3,all_clients=$4',[a.owner,u.id,b.role,b.allClients]);await c.query('DELETE FROM agency_member_clients WHERE user_id=$1 AND member_id=$2',[a.owner,u.id]);await c.query('INSERT INTO agency_member_clients(user_id,member_id,client_id) SELECT $1,$2,unnest($3::int[]) ON CONFLICT DO NOTHING',[a.owner,u.id,b.clientIds]);
      return null;
    });
    if(full)return void res.status(403).json(seatLimitBody(full));
    await logActivity(req,a.owner,'agency.member_updated',{memberId:u.id,role:b.role});res.json({ok:true});
  },'team');
  // Removes a team member (owner only): DELETE agency_members. agency.tsx Team tab.
  route('delete','/team/:id',async(req,res,a)=>{requireOwner(a);await pool.query('DELETE FROM agency_members WHERE user_id=$1 AND member_id=$2',[a.owner,positiveId.parse(req.params.id)]);res.json({ok:true});},'team');
  // Workspace location list (?q/?status/?clientId filters, member visibility, 50/page):
  // business_locations joined with agency_clients. agency.tsx Locations tab and the
  // AgencyWorkspace strip — site-scan.tsx.
  route('get','/locations',async(req,res,a)=>res.json(await listLocations(a,filters.parse(req.query))));
  // Status counts behind the location filters (total/synced/needs-reconnect/unlinked/guard/
  // unanswered-reviews/failed-posts), same filters as /locations. Filter-count select —
  // agency.tsx Locations tab, AgencyWorkspace strip — site-scan.tsx.
  route('get','/dashboard',async(req,res,a)=>res.json(await dashboard(a,filters.parse(req.query))));
  route('get','/locations/:id',async(req,res,a)=>res.json(await locationAccess(a,positiveId.parse(req.params.id))));
  route('post','/bulk',async(req,res,a)=>{
    const b=bulkInput.parse(req.body);
    if(b.action==='guard'&&!guardRecentAuthOk(req,a.actor))return res.status(403).json({reauth:true,message:'Verify your identity to change Profile Watch mode'});
    res.status(202).json(await queueBulk(a,b));
  });
  // CSV export of the workspace's locations (same filters as /locations; optional ?ids
  // re-checked per row), streamed 500 rows at a time. Export CSV buttons —
  // agency-workspace.tsx (agency.tsx + site-scan.tsx).
  route('get','/export',async(req,res,a)=>{
    const f=filters.parse(req.query),w=locationFilter(a,f);let cursor=0;
    const ids=req.query.ids?z.array(positiveId).min(1).max(50).parse(String(req.query.ids).split(',')):null;
    if(ids)for(const id of ids)await locationAccess(a,id);
    res.type('text/csv').setHeader('Content-Disposition','attachment; filename="agency-locations.csv"');
    res.write('ID,Client,Business,Address,City,State,Place ID,Google location\r\n');
    while(!res.destroyed){const {rows}=await pool.query(`SELECT l.id,c.name,l.business_name,l.address,l.city,l.state,l.place_id,l.gbp_location_name FROM ${locationJoin} WHERE ${w.sql} AND l.id>$8 AND ($9::int[] IS NULL OR l.id=ANY($9)) ORDER BY l.id LIMIT 500`,[...w.values,cursor,ids]);if(!rows.length)break;
      for(const r of rows){if(!res.write(Object.values(r).map(csvCell).join(',')+'\r\n'))await new Promise<void>(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}cursor=rows.at(-1)!.id;}
    res.end();
  });
  // Jobs tab: agency_jobs of the workspace (?q location text, 50/page, newest first).
  // agency.tsx.
  route('get','/jobs',async(req,res,a)=>{
    const f=filters.parse(req.query),w=locationFilter(a,f);
    // The rows carry the client's name for the card; `counts` is every matching job by status (not just this page).
    const from=`agency_jobs j JOIN business_locations l ON l.id=j.location_id AND l.user_id=j.user_id LEFT JOIN agency_clients c ON c.id=l.agency_client_id AND c.user_id=l.user_id WHERE ${w.sql}`;
    const [{rows},{rows:[counts]}]=await Promise.all([
      pool.query(`SELECT j.id,j.batch_id,j.action,j.location_id,j.status,j.error,j.attempts,j.due_at,j.created_at,j.started_at,j.finished_at,l.business_name,c.name client_name,count(*) OVER()::int total FROM ${from} ORDER BY j.created_at DESC,j.id LIMIT 50 OFFSET $8`,[...w.values,f.offset]),
      pool.query(`SELECT count(*) FILTER(WHERE j.status='queued')::int queued,count(*) FILTER(WHERE j.status='running')::int running,count(*) FILTER(WHERE j.status='done')::int done,count(*) FILTER(WHERE j.status='failed')::int failed FROM ${from}`,w.values),
    ]);
    res.json({items:rows,total:rows[0]?.total??0,counts});
  });
  route('put','/clients/:id/social-destinations',async(req,res,a)=>{
    requireOwner(a);const id=positiveId.parse(req.params.id);await clientAccess(a,id);
    const {destinations}=z.object({destinations:z.array(destinationSchema).max(20)}).strict().parse(req.body);
    await validateDestinations(a.owner,destinations);
    await pool.query('INSERT INTO agency_social_destinations(user_id,client_id,destinations) VALUES($1,$2,$3) ON CONFLICT(user_id,client_id) DO UPDATE SET destinations=$3',[a.owner,id,JSON.stringify(destinations)]);res.json({ok:true});
  });
  route('post','/social/posts',async(req,res,a)=>{
    requireWrite(a);const b=z.object({clientId:positiveId,post:postSchema}).strict().parse(req.body);await clientAccess(a,b.clientId);
    const {rows:[mapping]}=await pool.query('SELECT destinations FROM agency_social_destinations WHERE user_id=$1 AND client_id=$2',[a.owner,b.clientId]);
    const key=(d:any)=>[d.accountId,d.pageId||'',d.boardId||''].join(':');
    if(b.post.destinations.some(d=>!mapping?.destinations.some((v:any)=>key(v)===key(d))))throw new GoogleError('invalid','The owner must assign these social destinations to this client first',409);
    const prior=await pool.query('SELECT c.client_id FROM agency_social_post_clients c JOIN social_posts p ON p.id=c.post_id WHERE p.user_id=$1 AND p.request_id=$2',[a.owner,b.post.requestId]);
    if(prior.rows.some(r=>r.client_id!==b.clientId))throw missing();
    const posts=await createPosts(a.owner,b.post);
    await pool.query('INSERT INTO agency_social_post_clients(user_id,client_id,post_id) SELECT $1,$2,unnest($3::uuid[]) ON CONFLICT DO NOTHING',[a.owner,b.clientId,posts.map(p=>p.id)]);
    res.status(201).json({posts});
  });
  route('post','/social/posts/:id/action',async(req,res,a)=>{
    requireWrite(a);const id=z.string().uuid().parse(req.params.id),b=z.object({action:z.enum(['approve','cancel']),text:z.string().min(1).max(63206).optional()}).strict().parse(req.body);
    const {rows:[p]}=await pool.query('SELECT client_id FROM agency_social_post_clients WHERE user_id=$1 AND post_id=$2',[a.owner,id]);if(!p)throw missing();await clientAccess(a,p.client_id);
    res.json(await changePost(a.owner,id,b.action,b.text));
  });
  route('get','/google',async(_req,res,a)=>{res.json(await grantStatus(a.owner));});
  // Settings tab: queues a refresh of the connected accounts' GBP discovery by marking
  // agency_poll_grants refresh_requested (rate-limited 1/10min). "Refresh Google listings
  // in background" — agency.tsx.
  route('post','/google/refresh',async(_req,res,a)=>{
    requireAdmin(a);requireAllClients(a);
    // Nothing to refresh without a connected Google account: say so instead of answering "queued".
    const {rows:[g]}=await pool.query('SELECT count(*)::int n FROM gbp_grants WHERE user_id=$1 AND NOT reconnect_required',[a.owner]);
    if(!g.n)throw new GoogleError('invalid','Connect the agency Google account first; there is no connected account to refresh',409);
    if(!await takeAccountBudget(a.owner, `agency-discover:${a.owner}`,2,1,600000))throw new GoogleError('quota','Discovery is already queued or was recently requested',429);
    // Persist requests in the polling table; worker consumes discovery separately.
    await pool.query(`INSERT INTO agency_poll_grants(user_id,subject,next_at,refresh_requested) SELECT user_id,google_subject,now(),true FROM gbp_grants WHERE user_id=$1 AND NOT reconnect_required ON CONFLICT(user_id,subject) DO UPDATE SET next_at=now(),refresh_requested=true`,[a.owner]);
    res.status(202).json({queued:true});
  });
  // Onboarding form submit: validates client + agency Google grant, INSERT agency_onboarding
  // (30-day expiry, hashed/encrypted token) and queues the instructions email; the worker
  // sends it and later auto-accepts the matching Google invitation. agency.tsx Onboarding tab.
  route('post','/onboarding',async(req,res,a)=>res.status(202).json(await createOnboarding(a,req.body)));
  // Onboarding tab list: agency_onboarding joined with agency_clients (?q business name,
  // member client scoping, 50/page), each row with its client instructions link.
  // agency.tsx.
  route('get','/onboarding',async(req,res,a)=>{
    const f=filters.parse(req.query);
    const where=`r.user_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=r.user_id AND m.member_id=$3 AND m.client_id=r.client_id)) AND ($4::int IS NULL OR r.client_id=$4) AND r.business_name ILIKE $5`;
    const p=[a.owner,a.allClients,a.actor,f.clientId??null,like(f.q)];
    // `counts`: every matching request by stage (not just this page) — waiting on the client (sent/opened), moving
    // on Google's side (invitation received/accepted), linked, expired.
    const [{rows},{rows:[counts]}]=await Promise.all([
      // Named columns: the token (hash and ciphertext), the agency Google account's subject and the Google invitation
      // name never leave the server; the instructions link and the agency email go to roles that can send requests.
      pool.query(`SELECT r.id,r.client_id,r.contact_email,r.agency_email,r.business_name,r.address,r.place_id,r.status,r.sent_at,r.opened_at,r.accepted_at,r.location_id,r.expires_at,r.reminder_at,r.reminders,r.error,r.created_at,r.token_enc,c.name client_name,count(*) OVER()::int total FROM agency_onboarding r JOIN agency_clients c ON c.id=r.client_id AND c.user_id=r.user_id WHERE ${where} ORDER BY r.created_at DESC LIMIT 50 OFFSET $6`,[...p,f.offset]),
      pool.query(`SELECT count(*) FILTER(WHERE r.status IN ('sent','opened'))::int waiting,count(*) FILTER(WHERE r.status IN ('invitation received','accepted'))::int accepting,count(*) FILTER(WHERE r.status='linked')::int linked,count(*) FILTER(WHERE r.status='expired')::int expired,count(*) FILTER(WHERE r.error IS NOT NULL)::int with_error FROM agency_onboarding r JOIN agency_clients c ON c.id=r.client_id AND c.user_id=r.user_id WHERE ${where}`,p),
    ]);
    // A row whose token cannot be decrypted any more (the token key changed) keeps the list up: its link is null and
    // the page says to send a new request, instead of one row answering 500 for the whole list. A viewer can follow
    // each request's progress but holds no live link (it is a capability: opening it marks the request opened).
    const canSend=a.role!=='viewer';
    const link=(r:any)=>{if(!canSend)return null;try{return onboardingLink(r);}catch{return null;}};
    res.json({items:rows.map(({token_enc,total,...r})=>({...r,agency_email:canSend?r.agency_email:null,link:link({...r,token_enc})})),total:rows[0]?.total??0,counts:{waiting:counts.waiting,accepting:counts.accepting,linked:counts.linked,expired:counts.expired,withError:counts.with_error}});
  });
  // "Send reminder" on one onboarding request: rate-limited 1/day; nudges reminder_at so
  // the worker resends on its next tick. agency.tsx Onboarding tab.
  route('post','/onboarding/:id/remind',async(req,res,a)=>{requireWrite(a);const id=z.string().uuid().parse(req.params.id);const {rows:[r]}=await pool.query('SELECT client_id FROM agency_onboarding WHERE user_id=$1 AND id=$2',[a.owner,id]);if(!r)throw missing();await clientAccess(a,r.client_id);
    if(!await takeBudget(`agency-reminder:${id}`,1,1,86400000))throw new GoogleError('quota','One manual reminder per day',429);
    await pool.query("UPDATE agency_onboarding SET reminder_at=now()-interval '4 days',reminders=LEAST(reminders,1) WHERE user_id=$1 AND id=$2 AND status IN ('sent','opened')",[a.owner,id]);res.json({queued:true});});
  // Capability-authenticated instructions only: no session, Google OAuth, or mutation authority for the recipient.
  app.get('/api/agency-onboarding/:token',rateLimit('agency-onboarding-public',100,100),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const t=z.string().regex(/^[a-f0-9]{64}$/).safeParse(req.params.token);if(!t.success)return res.status(404).send('Instructions not found');
    const {rows:[r]}=await pool.query(`UPDATE agency_onboarding SET opened_at=COALESCE(opened_at,now()),status=CASE WHEN status='sent' THEN 'opened' ELSE status END WHERE token_hash=$1 AND expires_at>now() RETURNING agency_email,business_name`,[hash(t.data)]);
    if(!r)return res.status(404).send('These instructions have expired. Ask your agency for a new request.');
    res.type('text/plain').send(instructions(r.agency_email,r.business_name));
  });
}
