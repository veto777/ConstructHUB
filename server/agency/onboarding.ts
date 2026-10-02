import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import { sendWithFallback } from '../email';
import { logActivity, notifyUser } from '../account-events';
import { takeBudget } from '../growth-limits';
import { encryptToken, decryptToken } from '../gbp/token-crypto';
import { clientFor } from '../gbp/service';
import { GBP_SCOPE, GoogleError, resource } from '../gbp/client';
import { locationCount } from '../entitlements';
import { agencyPlanPaused, clientAccess, locationLimitRefusal, positiveId, requireWrite, workspaceEntitled, type AgencyAccess } from './access';
import { refreshDiscovery, queueSync } from './jobs';
export const googleHelp='https://support.google.com/business/answer/3403100';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const normalize=(s:unknown)=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** Names alone are insufficient for chains. Conflicting place IDs never fall back to name matching. */
export function matchesRequest(r:any,t:any) {
  if(r.place_id&&t.placeId) return r.place_id===t.placeId;
  return !!normalize(r.address)&&normalize(r.business_name)===normalize(t.locationName)&&normalize(r.address)===normalize(t.address);
}
export const onboardingInput=z.object({clientId:positiveId,subject:z.string().min(1).max(255),businessName:z.string().trim().min(1).max(300),address:z.string().trim().max(500).optional(),placeId:z.string().trim().max(300).optional()}).strict().refine(v=>!!v.address||!!v.placeId,'Provide an address or Place ID');
export function instructions(email:string,business:string) {
  return `To give your agency manager access to ${business}:\n1. Sign in to Google with the account that owns this Business Profile.\n2. Open your Business Profile, then More → Business Profile settings → People and access.\n3. Select Add, paste this exact email: ${email}\n4. Choose Manager, then Invite. Keep ownership of your profile.\nConstructHUB will detect the matching invitation, accept it for the agency, and link the listing. You do not need to connect Google to ConstructHUB.\nGoogle's instructions: ${googleHelp}`;
}
export function onboardingLink(r:any) {
  return `${(process.env.APP_URL||'http://localhost:8129').replace(/\/$/,'')}/api/agency-onboarding/${decryptToken(r.token_enc)}`;
}
export async function createOnboarding(a:AgencyAccess,raw:unknown) {
  requireWrite(a);const b=onboardingInput.parse(raw),client=await clientAccess(a,b.clientId);
  if(!client.contact_email) throw new GoogleError('invalid','Add the client contact email first',400);
  const {rows:[g]}=await pool.query('SELECT email FROM gbp_grants WHERE user_id=$1 AND google_subject=$2 AND NOT reconnect_required AND $3=ANY(scopes)',[a.owner,b.subject,GBP_SCOPE]);
  if(!g)throw new GoogleError('invalid','Connect the agency Google account first',409);
  if(!await takeBudget(`agency-invite:${a.owner}`,100,1,86400000))throw new GoogleError('quota','Daily onboarding email limit reached',429);
  const token=randomBytes(32).toString('hex'),id=randomUUID();
  await pool.query(`INSERT INTO agency_onboarding(id,user_id,client_id,subject,agency_email,contact_email,business_name,address,place_id,token_hash,token_enc)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,a.owner,b.clientId,b.subject,g.email,client.contact_email,b.businessName,b.address??null,b.placeId??null,hash(token),encryptToken(token)]);
  await logActivity(null,a.owner,'agency.onboarding_created',{actorId:a.actor,requestId:id,clientId:b.clientId});
  return {id,queued:true};
}
export async function sendOnboarding(r:any,send=sendWithFallback) {
  await send({to:r.contact_email,subject:`ConstructHUB: Google Business Profile access for ${r.business_name}`,
    text:`${instructions(r.agency_email,r.business_name)}\n\nYour instructions link: ${onboardingLink(r)}\nThis link expires ${new Date(r.expires_at).toISOString().slice(0,10)}.`});
  await pool.query('UPDATE agency_onboarding SET sent_at=COALESCE(sent_at,now()),reminder_at=now(),reminders=reminders+CASE WHEN sent_at IS NULL THEN 0 ELSE 1 END,error=NULL WHERE id=$1',[r.id]);
}
export async function pollInvitations(user:number,subject:string,make=clientFor) {
  const client=make(user,subject);
  const {rows:[settings]}=await pool.query('SELECT auto_accept_all FROM agency_workspaces WHERE user_id=$1',[user]);
  const {rows:pending}=await pool.query("SELECT * FROM agency_onboarding WHERE user_id=$1 AND subject=$2 AND expires_at>now() AND status IN ('sent','opened','invitation received','accepted')",[user,subject]);
  const accounts=await client.pages('accounts','/v1/accounts','accounts');
  let accepted=false;
  for(const account of accounts) {
    const parent=resource(account.name,'accounts');
    // ListInvitations does NOT support pageSize/pageToken (max 1,000). Do not use GoogleClient.pages.
    const data=await client.request('accounts',`/v1/${parent}/invitations`);
    if(data.invitations!==undefined&&!Array.isArray(data.invitations)) throw new GoogleError('transient','Invalid invitation response',503);
    for(const invite of data.invitations||[]) {
      if(typeof invite.name!=='string'||!new RegExp(`^${parent}/invitations/[\\w-]+$`).test(invite.name)||!invite.targetLocation)continue;
      const target=invite.targetLocation;
      const matching=pending.filter(r=>r.status!=='accepted'&&matchesRequest(r,target));
      // Ambiguous requests must be resolved by the agency; never assign a listing to an arbitrary client.
      const r=matching.length===1?matching[0]:null;
      await pool.query(`INSERT INTO agency_google_invitations(user_id,subject,name,target) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,subject,name) DO UPDATE SET target=$4,updated_at=now()`,[user,subject,invite.name,JSON.stringify(target)]);
      if(!r&&!settings?.auto_accept_all)continue;
      const {rows:[prior]}=await pool.query('SELECT status FROM agency_google_invitations WHERE user_id=$1 AND subject=$2 AND name=$3',[user,subject,invite.name]);
      if(['accepting','uncertain','accepted'].includes(prior.status))continue;
      if(r)await pool.query("UPDATE agency_onboarding SET status='invitation received',invitation=$2 WHERE id=$1",[r.id,invite.name]);
      await pool.query("UPDATE agency_google_invitations SET status='accepting' WHERE user_id=$1 AND subject=$2 AND name=$3",[user,subject,invite.name]);
      try {
        await client.request('accounts',`/v1/${invite.name}:accept`,'POST',{});
        await pool.query("UPDATE agency_google_invitations SET status='accepted',error=NULL WHERE user_id=$1 AND subject=$2 AND name=$3",[user,subject,invite.name]);
        if(r){await pool.query("UPDATE agency_onboarding SET status='accepted',accepted_at=now() WHERE id=$1",[r.id]);r.status='accepted';}
        accepted=true;
        await logActivity(null,user,'agency.invitation_accepted',{requestId:r?.id??null,invitation:invite.name});
      }catch {
        await pool.query("UPDATE agency_google_invitations SET status='uncertain',error='Acceptance outcome unknown. Check Google before retrying.' WHERE user_id=$1 AND subject=$2 AND name=$3",[user,subject,invite.name]);
      }
    }
  }
  if(accepted||pending.some(r=>r.status==='accepted')) {
    const d=await refreshDiscovery(user,subject,make);
    for(const r of pending.filter(r=>r.status==='accepted')) {
      const matches=d.locations.filter(l=>matchesRequest(r,{placeId:l.placeId,locationName:l.businessName,address:[l.address,l.city,l.state,l.zipCode,l.country].filter(Boolean).join(', ')})||(!r.place_id&&normalize(r.business_name)===normalize(l.businessName)&&normalize(r.address)===normalize(l.address)));
      if(matches.length!==1)continue;
      const l=matches[0],c=await pool.connect();let id:number|undefined;
      try {
        await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(7162,$1)',[user]);
        const {rows:[existing]}=await c.query('SELECT id,agency_client_id FROM business_locations WHERE user_id=$1 AND (gbp_location_name=$2 OR ($3::text IS NOT NULL AND place_id=$3)) ORDER BY id LIMIT 1',[user,l.gbpName,l.placeId]);
        if(existing?.agency_client_id&&existing.agency_client_id!==r.client_id){await c.query('ROLLBACK');continue;}
        if(existing){id=existing.id;await c.query('UPDATE business_locations SET agency_client_id=$3,gbp_account_name=$4,gbp_location_name=$5,gbp_google_subject=$6,gbp_unlinked_by_user=false WHERE user_id=$1 AND id=$2',[user,id,r.client_id,l.accountResource,l.gbpName,subject]);}
        else {
          // A new row counts toward the plan's locations, under the same per-account lock as POST /api/locations.
          await c.query('SELECT pg_advisory_xact_lock(7170,$1)',[user]);
          const refused=await locationLimitRefusal(user,await locationCount(user,c));
          if(refused){
            await c.query('ROLLBACK');
            // Retried on every poll, so it links on its own once there is room; the owner hears about it once.
            const {rowCount:changed}=await pool.query('UPDATE agency_onboarding SET error=$2 WHERE id=$1 AND error IS DISTINCT FROM $2',[r.id,refused]);
            if(changed)await notifyUser(user,'gbp.profile_change',{title:'Client Google profile not linked',body:`${r.business_name}: ${refused}`,link:'/agency'});
            continue;
          }
          id=(await c.query(`INSERT INTO business_locations(user_id,agency_client_id,business_name,address,city,state,zip_code,place_id,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[user,r.client_id,l.businessName,l.address,l.city,l.state,l.zipCode,l.placeId,l.accountResource,l.gbpName,subject])).rows[0].id;
        }
        await c.query("UPDATE agency_onboarding SET status='linked',location_id=$2,error=NULL WHERE id=$1",[r.id,id]);await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
      await queueSync(user,id!);
      await notifyUser(user,'gbp.profile_change',{title:'Client Google profile linked',body:`${r.business_name} is linked. First sync is queued.`,link:'/agency'});
    }
  }
}
/** `onlyUser` narrows a run to one agency owner (tests on a shared database). */
export async function runOnboardingWorker(make=clientFor,send=sendWithFallback,onlyUser?:number) {
  const c=await pool.connect();let locked=false;const only=[onlyUser??null];
  try {
    locked=(await c.query('SELECT pg_try_advisory_lock(7163,1) locked')).rows[0].locked;if(!locked)return;
    await c.query("UPDATE agency_google_invitations SET status='uncertain',error='Acceptance interrupted. Check Google.' WHERE status='accepting' AND ($1::int IS NULL OR user_id=$1)",only);
    await c.query("UPDATE agency_onboarding SET status='expired' WHERE expires_at<=now() AND status NOT IN ('linked','expired') AND ($1::int IS NULL OR user_id=$1)",only);
    const {rows:mail}=await c.query(`SELECT * FROM agency_onboarding WHERE status IN ('sent','opened') AND expires_at>now() AND (sent_at IS NULL OR (reminders<2 AND reminder_at<now()-interval '3 days')) AND ($1::int IS NULL OR user_id=$1) ORDER BY reminder_at NULLS FIRST LIMIT 20`,only);
    // Onboarding email and invitation polling follow the agency owner's current plan; paused work resumes if it returns.
    const entitled=new Map<number,Promise<boolean>>(),allowed=(owner:number)=>{if(!entitled.has(owner))entitled.set(owner,workspaceEntitled(owner));return entitled.get(owner)!;};
    for(const r of mail){
      if(!await allowed(r.user_id)){await c.query('UPDATE agency_onboarding SET error=$2,reminder_at=now() WHERE id=$1',[r.id,agencyPlanPaused]);continue;}
      try{await sendOnboarding(r,send);}catch{await c.query("UPDATE agency_onboarding SET error='Email delivery failed; retry pending',reminder_at=now() WHERE id=$1",[r.id]);}
    }
    await c.query(`INSERT INTO agency_poll_grants(user_id,subject) SELECT g.user_id,g.google_subject FROM gbp_grants g WHERE NOT g.reconnect_required AND ($1::int IS NULL OR g.user_id=$1) AND (EXISTS(SELECT 1 FROM agency_onboarding r WHERE r.user_id=g.user_id AND r.subject=g.google_subject AND r.status NOT IN ('linked','expired')) OR EXISTS(SELECT 1 FROM agency_workspaces w WHERE w.user_id=g.user_id AND w.auto_accept_all)) ON CONFLICT DO NOTHING`,only);
    // One grant per tick; a grant whose owner's plan no longer includes the agency workspace is not polled and waits an hour.
    for(let i=0;i<10;i++){
      const {rows:[g]}=await c.query(`UPDATE agency_poll_grants SET next_at=now()+interval '5 minutes' WHERE (user_id,subject)=(SELECT p.user_id,p.subject FROM agency_poll_grants p JOIN gbp_grants g ON g.user_id=p.user_id AND g.google_subject=p.subject AND NOT g.reconnect_required WHERE next_at<=now() AND ($1::int IS NULL OR p.user_id=$1) ORDER BY next_at LIMIT 1) RETURNING *`,only);
      if(!g)break;
      // Discovering the account's OWN Business Profiles (what "Import from GBP" lists) is for every connected
      // account, not just the Agency workspace — it used to sit behind the plan check below, so a non-Agency
      // account's profiles were never listed (owner, 2026-10-02: "make sure the profile is accessible").
      if(g.refresh_requested){
        try{await refreshDiscovery(g.user_id,g.subject,make);await c.query('UPDATE agency_poll_grants SET refresh_requested=false WHERE user_id=$1 AND subject=$2',[g.user_id,g.subject]);}
        catch{console.error('GBP profile discovery failed; retrying next tick');}
      }
      if(!await allowed(g.user_id)){await c.query("UPDATE agency_poll_grants SET next_at=now()+interval '1 hour' WHERE user_id=$1 AND subject=$2",[g.user_id,g.subject]);continue;}
      await pollInvitations(g.user_id,g.subject,make);break;
    }
  }finally{if(locked)await c.query('SELECT pg_advisory_unlock(7163,1)');c.release();}
}
export function startOnboardingWorker(){if(process.env.GBP_SYNC_DISABLED==='true')return;const t=setInterval(()=>void runOnboardingWorker().catch(()=>console.error('Agency onboarding tick failed')),60000);t.unref();return t;}
