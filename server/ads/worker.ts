import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { logActivity } from '../account-events';
import { sendWithFallback } from '../email';
import { AdsError, type AdsApi, clientFor, searchAll } from './client';
import { account, enqueue, grant, withAgencyLock } from './store';
import { readState, buildPlan, protectionInput, fingerprint, appliedDocument, type PlanDocument } from './protections';
import { auditAccount } from './audit';
export const CLIENTS_QUERY=`SELECT customer_client.id,customer_client.descriptive_name,customer_client.manager,customer_client.status,customer_client.currency_code,customer_client.time_zone FROM customer_client WHERE customer_client.level > 0 ORDER BY customer_client.id`;
export const LINKS_QUERY=`SELECT customer_client_link.resource_name,customer_client_link.client_customer,customer_client_link.status FROM customer_client_link`;
export const linkStatus=(status:string)=>({PENDING:'pending',ACTIVE:'accepted',REFUSED:'rejected',CANCELED:'cancelled',INACTIVE:'cancelled'}[status]||'unknown');
export function invitationMail(manager:string,cid:string,email:string) {
  const text=`Your agency has requested Google Ads manager access to account ${cid} from manager ${manager}.\n\nSign in at https://ads.google.com/ as an administrator of the client account. Select account ${cid}, open Admin → Access and security → Managers, review the request from ${manager}, and accept only if this is your agency. Google's own invitation notification goes to administrators of that Google Ads account; check their inbox and spam folder. This ConstructHUB email does not itself grant access.\n\nIf you do not recognize this request, decline it in Google Ads.`;
  return {to:email,subject:`ConstructHUB: review Google Ads manager request for ${cid}`,text};
}
export interface WorkerDeps { onlyUser?:number; make?:(id:number)=>Promise<AdsApi>; mail?:typeof sendWithFallback }
async function saveSnapshot(user:number,cid:string,api:AdsApi) {
  const state=await readState(api,cid);
  await pool.query(`UPDATE ads_accounts SET snapshot=$3,synced_at=now(),lsa=$4,error=NULL WHERE user_id=$1 AND customer_id=$2`,[user,cid,JSON.stringify(state),state.campaign.some(c=>c.advertisingChannelType==='LOCAL_SERVICES')]);
  const ips=state.campaignCriterion.filter(c=>c.ipBlock).map(c=>c.resourceName);
  if(ips.length) await pool.query(`INSERT INTO ads_ip_age(user_id,customer_id,resource_name) SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,[user,cid,ips]);
  return state;
}
async function execute(job:any,api:AdsApi,g:any,deps:WorkerDeps) {
  const user=job.user_id,cid=job.customer_id,p=job.payload;
  if(job.kind==='discover') {
    const self=await api.search(g.manager_id,'SELECT customer.id,customer.manager FROM customer LIMIT 1');
    if(self.results[0]?.customer?.manager!==true || String(self.results[0]?.customer?.id)!==g.manager_id) throw new AdsError('The selected Google account is not an accessible manager account.',403);
    await pool.query('UPDATE ads_grants SET verified=true WHERE user_id=$1 AND connection_id=$2',[user,g.connection_id]);
    const r=await api.search(g.manager_id,CLIENTS_QUERY,p.pageToken);
    const seenAt=p.seenAt || new Date().toISOString();
    for(const row of r.results) {
      const cc=row.customerClient,id=String(cc?.id||'');
      if(!/^\d{10}$/.test(id)) throw new AdsError('Google returned an invalid client account.',502);
      await pool.query(`INSERT INTO ads_accounts(user_id,customer_id,name,manager,status,currency,timezone,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(user_id,customer_id) DO UPDATE SET name=$3,manager=$4,status=$5,currency=$6,timezone=$7,last_seen=$8`,[user,id,cc.descriptiveName||null,cc.manager===true,cc.status||'UNKNOWN',cc.currencyCode||null,cc.timeZone||null,seenAt]);
      if(!cc.manager && cc.status==='ENABLED') await enqueue(user,g.connection_id,'audit',{},id,job.batch_id,`${job.batch_id}:audit:${id}`);
    }
    if(r.nextPageToken) {
      if((p.seenTokens||[]).length>=100 || (p.seenTokens||[]).includes(r.nextPageToken)) throw new AdsError('Google repeated a discovery page.',502);
      await enqueue(user,g.connection_id,'discover',{pageToken:r.nextPageToken,seenAt,seenTokens:[...(p.seenTokens||[]),r.nextPageToken]},null,job.batch_id,`${job.batch_id}:discover:${r.nextPageToken}`);
    } else await pool.query("UPDATE ads_accounts SET status='UNLINKED' WHERE user_id=$1 AND (last_seen IS NULL OR last_seen<$2)",[user,seenAt]);
    return;
  }
  if(job.kind==='poll') {
    const r=await api.search(g.manager_id,LINKS_QUERY,p.pageToken);
    let accepted=false;
    for(const row of r.results) {
      const l=row.customerClientLink,status=linkStatus(l?.status);
      const updated=await pool.query(`UPDATE ads_invitations SET status=$3,resource_name=$4,updated_at=now() WHERE user_id=$1 AND customer_id=$2 AND (resource_name=$4 OR (resource_name IS NULL AND status IN ('unknown','queued') AND $3 IN ('pending','accepted'))) AND status<>$3 RETURNING id`,[user,String(l?.clientCustomer||'').split('/')[1],status,l?.resourceName]);
      if(updated.rowCount) {accepted ||= status==='accepted';await logActivity(null,user,'ads.invitation_status',{customerId:String(l.clientCustomer).split('/')[1],status});}
    }
    if(r.nextPageToken) {
      if((p.seenTokens||[]).length>=100 || (p.seenTokens||[]).includes(r.nextPageToken)) throw new AdsError('Google repeated a link page.',502);
      await enqueue(user,g.connection_id,'poll',{pageToken:r.nextPageToken,seenTokens:[...(p.seenTokens||[]),r.nextPageToken]},null,job.batch_id,`${job.batch_id}:poll:${r.nextPageToken}`);
    }
    if(accepted) await enqueue(user,g.connection_id,'discover',{},null,job.batch_id,`${job.batch_id}:accepted-discovery`);
    return;
  }
  if(job.kind==='invite' || job.kind==='cancel-invite') {
    const {rows:[inv]}=await pool.query('SELECT * FROM ads_invitations WHERE user_id=$1 AND id=$2',[user,p.invitationId]);
    if(!inv) throw new AdsError('Invitation not found',404);
    const operation=job.kind==='invite'?{create:{clientCustomer:`customers/${inv.customer_id}`,status:'PENDING'}}:{update:{resourceName:inv.resource_name,status:'CANCELED'},updateMask:'status'};
    if(job.kind==='cancel-invite' && (inv.status!=='pending'||!inv.resource_name)) throw new AdsError('Only a pending Google invitation can be cancelled.',409);
    if(job.kind==='invite' && inv.status!=='queued') return;
    await api.link(g.manager_id,operation,true);
    // Persist uncertainty BEFORE attempting an external mutation. Never automatically replay it.
    await pool.query("UPDATE ads_invitations SET status='unknown',updated_at=now() WHERE user_id=$1 AND id=$2",[user,inv.id]);
    const result=await api.link(g.manager_id,operation);
    const resource=result.result?.resourceName;
    if(typeof resource!=='string' || !new RegExp(`^customers/${g.manager_id}/customerClientLinks/${inv.customer_id}~\\d+$`).test(resource)) throw new AdsError('Invitation outcome unknown. Poll links before retrying.',502,true);
    await pool.query('UPDATE ads_invitations SET resource_name=$3,status=$4,updated_at=now() WHERE user_id=$1 AND id=$2',[user,inv.id,resource,job.kind==='invite'?'pending':'cancelled']);
    await logActivity(null,user,`ads.${job.kind}`,{customerId:inv.customer_id,invitationId:inv.id});
    if(job.kind==='invite') await enqueue(user,g.connection_id,'invitation-email',{invitationId:inv.id},inv.customer_id,job.batch_id,`email:${inv.id}`);
    return;
  }
  if(job.kind==='invitation-email') {
    const {rows:[inv]}=await pool.query('SELECT * FROM ads_invitations WHERE user_id=$1 AND id=$2',[user,p.invitationId]);
    if(!inv || inv.email_status!=='not_sent' || !['pending','accepted'].includes(inv.status)) return;
    await pool.query("UPDATE ads_invitations SET email_status='sending' WHERE user_id=$1 AND id=$2",[user,inv.id]);
    try {await (deps.mail||sendWithFallback)(invitationMail(g.manager_id,inv.customer_id,inv.email));await pool.query("UPDATE ads_invitations SET email_status='sent' WHERE user_id=$1 AND id=$2",[user,inv.id]);}
    catch {await pool.query("UPDATE ads_invitations SET email_status='unknown' WHERE user_id=$1 AND id=$2",[user,inv.id]);throw new AdsError('Invitation exists, but email delivery is unconfirmed. Contact the client manually.',502,true);}
    return;
  }
  const a=await account(user,cid);
  const state=await saveSnapshot(user,cid,api);
  if(job.kind==='audit') {
    const findings=await auditAccount(api,cid,state);
    const c=await pool.connect();
    try {await c.query('BEGIN');await c.query('DELETE FROM ads_findings WHERE user_id=$1 AND customer_id=$2',[user,cid]);
      for(const f of findings) await c.query('INSERT INTO ads_findings(user_id,customer_id,kind,severity,title,detail,fix) VALUES($1,$2,$3,$4,$5,$6,$7)',[user,cid,f.kind,f.severity,f.title,f.detail,f.fix||null]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    return;
  }
  if(job.kind==='preview') {
    const input=protectionInput.parse(p.action);
    let ips:string[]=[],ages:Record<string,string>={};
    if(input.kind==='ip') {
      if(!a.domain_id) throw new AdsError('Map this client to its own Click Guard domain before previewing IP exclusions.',422);
      ips=(await pool.query(`SELECT b.ip_address FROM blocked_ips b JOIN tracked_domains d ON d.id=b.domain_id WHERE d.user_id=$1 AND d.id=$2 AND b.is_active ORDER BY b.blocked_at DESC,b.id DESC LIMIT 500`,[user,a.domain_id])).rows.map(r=>r.ip_address);
      ages=Object.fromEntries((await pool.query('SELECT resource_name,first_seen FROM ads_ip_age WHERE user_id=$1 AND customer_id=$2',[user,cid])).rows.map(r=>[r.resource_name,new Date(r.first_seen).toISOString()]));
    }
    const document=buildPlan(cid,state,input,ips,ages);
    await pool.query(`INSERT INTO ads_plans(user_id,connection_id,customer_id,batch_id,kind,input,document) VALUES($1,$2,$3,$4,$5,$6,$7)`,[user,g.connection_id,cid,job.batch_id,input.kind,input,JSON.stringify(document)]);
    return;
  }
  if(job.kind==='undo-preview') {
    const {rows:[old]}=await pool.query("SELECT * FROM ads_plans WHERE user_id=$1 AND id=$2 AND customer_id=$3 AND status='applied' AND connection_id=$4",[user,p.planId,cid,g.connection_id]);
    if(!old?.after_document || !old.inverse || fingerprint(state)!==fingerprint(old.after_document)) throw new AdsError('Account changed since this write. Reversal stopped; review Google and prepare a new change.',409);
    const document:PlanDocument={before:state,operations:old.inverse,inverseTemplates:[],summary:[`Reverse protection ${old.kind} (${old.id}). Restore prior values; recreated criteria get new Google IDs.`],warnings:['Reversal is checked again before it runs.']};
    await pool.query(`INSERT INTO ads_plans(user_id,connection_id,customer_id,batch_id,kind,input,document,undo_of) VALUES($1,$2,$3,$4,'undo',$5,$6,$7)`,[user,g.connection_id,cid,job.batch_id,{planId:old.id},JSON.stringify(document),old.id]);
    return;
  }
  if(job.kind==='apply') {
    const {rows:[plan]}=await pool.query("SELECT * FROM ads_plans WHERE user_id=$1 AND id=$2 AND customer_id=$3 AND connection_id=$4 AND status='queued'",[user,p.planId,cid,g.connection_id]);
    if(!plan) throw new AdsError('Confirmed preview not found.',409);
    const doc=plan.document as PlanDocument;
    if(new Date(plan.expires_at).getTime()<Date.now()) throw new AdsError('Preview expired before execution; prepare a fresh preview.',409);
    if(fingerprint(doc.before)!==fingerprint(state)) throw new AdsError('Account changed after preview. Nothing written; prepare a fresh preview.',409);
    if(!doc.operations.length) {await pool.query("UPDATE ads_plans SET status='no_change',applied_at=now() WHERE user_id=$1 AND id=$2",[user,plan.id]);return;}
    await api.mutate(cid,doc.operations,true);
    await pool.query("UPDATE ads_plans SET status='applying' WHERE user_id=$1 AND id=$2",[user,plan.id]);
    await logActivity(null,user,'ads.write_started',{planId:plan.id,customerId:cid,operations:doc.operations.length});
    const result=await api.mutate(cid,doc.operations);
    const applied=appliedDocument(doc,result);
    await pool.query("UPDATE ads_plans SET status='applied',inverse=$3,after_document=$4,applied_at=now() WHERE user_id=$1 AND id=$2",[user,plan.id,JSON.stringify(applied.inverse),JSON.stringify(applied.after)]);
    if(plan.undo_of) await pool.query("UPDATE ads_plans SET status='reversed' WHERE user_id=$1 AND id=$2",[user,plan.undo_of]);
    await logActivity(null,user,'ads.write_applied',{planId:plan.id,customerId:cid,kind:plan.kind,operations:doc.operations.length});
    await enqueue(user,g.connection_id,'audit',{},cid,job.batch_id,`after:${plan.id}`);
  }
}
/** One worker across DB processes; crash recovery never replays possibly-sent writes. */
export async function runAdsWorker(deps:WorkerDeps={}) {
  const lock=await pool.connect();
  try {
    const {rows:[r]}=await lock.query('SELECT pg_try_advisory_lock(8249,0) locked');
    if(!r.locked) return false;
    try {
      await pool.query(`UPDATE ads_jobs SET status=CASE WHEN kind IN ('apply','invite','cancel-invite','invitation-email') THEN 'unknown' ELSE 'queued' END,
        error='Worker interrupted; uncertain writes are not retried.' WHERE status='running'`);
      await pool.query("UPDATE ads_plans SET status='unknown',error='Worker interrupted; reconcile the Google account before retrying.' WHERE status='applying'");
      await pool.query("UPDATE ads_invitations i SET email_status='unknown' FROM ads_jobs j WHERE j.user_id=i.user_id AND j.payload->>'invitationId'=i.id::text AND j.kind='invitation-email' AND j.status='unknown' AND i.email_status='sending'");
      await pool.query("UPDATE ads_plans p SET status='unknown',error='Worker interrupted; reconcile the Google account before retrying.' FROM ads_jobs j WHERE j.user_id=p.user_id AND j.payload->>'planId'=p.id::text AND j.status='unknown' AND p.status='queued'");
      const {rows:[job]}=await pool.query(`UPDATE ads_jobs SET status='running',started_at=now(),attempts=attempts+1 WHERE id=(SELECT id FROM ads_jobs WHERE status='queued' AND due_at<=now() AND ($1::integer IS NULL OR user_id=$1) ORDER BY CASE WHEN kind IN ('poll','invite','cancel-invite','invitation-email','apply') THEN 0 WHEN kind IN ('discover','preview','undo-preview') THEN 1 ELSE 2 END,due_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,[deps.onlyUser||null]);
      if(!job) return false;
      try {
        await withAgencyLock(job.user_id,async()=>{
          const g=await grant(job.user_id,job.kind!=='discover');
          if(g.connection_id!==job.connection_id) throw new AdsError('MCC connection changed; job cancelled.',409);
          await execute(job,await (deps.make||clientFor)(job.user_id),g,deps);
        });
        await pool.query("UPDATE ads_jobs SET status='done',finished_at=now(),error=NULL WHERE id=$1",[job.id]);
      } catch(e) {
        const message=e instanceof AdsError?e.message:'Ads operation failed. Review configuration and retry with a fresh preview.';
        const {rows:[plan]}=job.kind==='apply'?await pool.query('SELECT status FROM ads_plans WHERE user_id=$1 AND id=$2',[job.user_id,job.payload.planId]):{rows:[]};
        const uncertain=e instanceof AdsError?e.uncertain:plan?.status==='applying';
        if(e instanceof AdsError && e.status===401) await pool.query('UPDATE ads_grants SET reconnect_required=true,access_token=NULL WHERE user_id=$1 AND connection_id=$2',[job.user_id,job.connection_id]);
        const retry=!['apply','invite','cancel-invite','invitation-email'].includes(job.kind) && job.attempts<5 && e instanceof AdsError && [429,503].includes(e.status);
        await pool.query(`UPDATE ads_jobs SET status=$2,error=$3,finished_at=CASE WHEN $2='queued' THEN NULL ELSE now() END,due_at=now()+interval '1 minute'*$4 WHERE id=$1`,[job.id,retry?'queued':uncertain?'unknown':'failed',message,Math.min(60,2**job.attempts)]);
        if(job.kind==='apply' && plan?.status!=='applied') await pool.query('UPDATE ads_plans SET status=$3,error=$4 WHERE user_id=$1 AND id=$2',[job.user_id,job.payload.planId,uncertain?'unknown':'failed',message]);
        if(job.kind==='invite') await pool.query("UPDATE ads_invitations SET status=$3 WHERE user_id=$1 AND id=$2 AND status IN ('queued','unknown')",[job.user_id,job.payload.invitationId,uncertain?'unknown':'failed']);
        if(job.customer_id) await pool.query('UPDATE ads_accounts SET error=$3 WHERE user_id=$1 AND customer_id=$2',[job.user_id,job.customer_id,message]);
        await logActivity(null,job.user_id,'ads.job_failed',{jobId:job.id,kind:job.kind,status:uncertain?'unknown':'failed',message});
      }
      return true;
    }finally{await lock.query('SELECT pg_advisory_unlock(8249,0)');}
  }finally{lock.release();}
}
export async function scheduleLinkPolls() {
  const {rows}=await pool.query(`UPDATE ads_grants SET last_poll_at=now() WHERE user_id IN (SELECT user_id FROM ads_grants WHERE verified AND NOT reconnect_required AND (last_poll_at IS NULL OR last_poll_at<now()-interval '15 minutes') ORDER BY last_poll_at NULLS FIRST LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING user_id,connection_id`);
  for(const g of rows) await enqueue(g.user_id,g.connection_id,'poll',{});
}
export function startAdsWorker() {
  if(process.env.GOOGLE_ADS_WORKER_ENABLED!=='true') return;
  let busy=false;
  const timer=setInterval(async()=>{if(busy)return;busy=true;try{await scheduleLinkPolls();await runAdsWorker();}catch{console.error('[ads] worker tick failed');}finally{busy=false;}},1000);
  timer.unref();return timer;
}
