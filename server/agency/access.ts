import { z } from 'zod';
import type { Response } from 'express';
import { pool } from '../db';
import { GoogleError } from '../gbp/client';
import { getEntitlements, sendLocationLimit, sendPlanRequired } from '../entitlements';
import { MODULE_NAMES, PLANS, PLAN_KEYS, planForModule, fitsLimit } from '@shared/plans';
export const positiveId = z.coerce.number().int().positive().max(2147483647);
export type AgencyAccess = { owner: number; actor: number; role: 'owner'|'admin'|'manager'|'viewer'; allClients: boolean };
export const missing = () => new GoogleError('invalid','Record not found',404);
/** The agency workspace follows the workspace OWNER's plan: team seats come with the owner's plan, so a member
 * needs no plan of their own. A platform admin acting in someone's workspace keeps access. */
export async function workspaceEntitled(owner: number, actor = owner) {
  if ((await getEntitlements(owner)).modules.agencyWorkspace) return true;
  return actor !== owner && (await getEntitlements(actor)).isPlatformAdmin;
}
/** Team seats are independent of the Agency client-workspace module. */
export async function teamEntitled(owner: number, actor = owner) {
  const seats = (await getEntitlements(owner)).allowances?.agencySeats ?? 0;
  if (seats === -1 || seats > 1) return true;
  return actor !== owner && (await getEntitlements(actor)).isPlatformAdmin;
}
export const teamPlanRequired = (res: Response) => sendPlanRequired(res, 'team', 'Team management');
/**
 * Why one more location can't be added to the owner's account, in the words of the 403 that POST
 * /api/locations sends (sendLocationLimit: the Agency self-serve cap, then a sales quote), or null when it fits.
 * For work with no response to answer (onboarding links a listing from a background worker).
 */
export async function locationLimitRefusal(owner: number, used: number): Promise<string|null> {
  const ent = await getEntitlements(owner);
  if (!ent.allowances) return agencyPlanPaused;
  if (fitsLimit(ent.allowances.locations, used)) return null;
  let body: { message?: string } = {};
  const capture = { status() { return capture; }, json(b: { message?: string }) { body = b; return capture; } };
  sendLocationLimit(capture as unknown as Response, ent, used);
  return body.message ?? null;
}
export const agencyPlan = planForModule('agencyWorkspace');
export const agencyPlanRequired = (res: Response) => sendPlanRequired(res, agencyPlan, MODULE_NAMES.agencyWorkspace);
/** Recorded on queued agency work that was not run because the owner's plan no longer includes it. */
export const agencyPlanPaused = `Not run: ${MODULE_NAMES.agencyWorkspace} is included with the ${PLANS[agencyPlan].name} plan.`;
/** Recorded on a queued Google sync that was not run because the owner has no active plan. */
export const gbpSyncPaused = `Not run: Google Business Profile sync is included with the ${PLANS[PLAN_KEYS[0]].name} plan.`;
const planCache = new Map<number, { ok: boolean; at: number }>();
/**
 * Google Business Profile sync comes with every paid plan (a platform admin runs with the top plan). An owner
 * with no active plan or grant is not synced. Answers are cached for five minutes, so a new plan resumes
 * syncing within that; the scheduler asks once per owner, not once per location.
 */
export async function ownerHasPlan(owner: number): Promise<boolean> {
  const hit = planCache.get(owner);
  if (hit && Date.now() - hit.at < 300_000) return hit.ok;
  const ok = (await getEntitlements(owner)).accessPlan !== null;
  planCache.set(owner, { ok, at: Date.now() });
  if (planCache.size > 50_000) planCache.clear();
  return ok;
}
/** A plan granted or ended outside Stripe (server/access-grants.ts): the next sync asks again. */
export function forgetOwnerPlan(owner: number): void {
  planCache.delete(owner);
}
export async function accessFor(actor: number, owner = actor): Promise<AgencyAccess> {
  if (owner === actor) return {owner,actor,role:'owner',allClients:true};
  const { rows:[m] } = await pool.query('SELECT role,all_clients FROM agency_members WHERE user_id=$1 AND member_id=$2',[owner,actor]);
  if (!m) throw missing();
  return {owner,actor,role:m.role,allClients:m.all_clients};
}
export function requireWrite(a: AgencyAccess) { if(a.role==='viewer') throw missing(); }
export function requireAdmin(a: AgencyAccess) { if(!['owner','admin'].includes(a.role)) throw missing(); }
/** Always used again for objects and jobs, independently of any list/filter supplied by the browser. */
export function visibility(a: AgencyAccess, alias='l', start=1) {
  return { sql:`${alias}.user_id=$${start} AND ($${start+1}::boolean OR EXISTS(SELECT 1 FROM agency_member_clients amc WHERE amc.user_id=${alias}.user_id AND amc.member_id=$${start+2} AND amc.client_id=${alias}.agency_client_id))`, values:[a.owner,a.allClients,a.actor] as unknown[] };
}
export async function clientAccess(a: AgencyAccess, id: number) {
  const { rows:[row] } = await pool.query(`SELECT * FROM agency_clients c WHERE c.user_id=$1 AND c.id=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM agency_member_clients m WHERE m.user_id=c.user_id AND m.client_id=c.id AND m.member_id=$4))`,[a.owner,id,a.allClients,a.actor]);
  if(!row) throw missing(); return row;
}
export async function locationAccess(a: AgencyAccess, id: number, write=false) {
  if(write) requireWrite(a);
  const v=visibility(a);
  const {rows:[row]}=await pool.query(`SELECT l.* FROM business_locations l WHERE ${v.sql} AND l.id=$4`,[...v.values,id]);
  if(!row) throw missing(); return row;
}
export const filters = z.object({q:z.string().trim().max(200).default(''),clientId:positiveId.optional(),folder:z.string().max(100).optional(),tag:z.string().max(100).optional(),status:z.enum(['all','synced','reconnect','unlinked','guard','unanswered','failed']).default('all'),offset:z.coerce.number().int().min(0).max(10000000).default(0)});
export type Filters = z.infer<typeof filters>;
const statusSql: Record<Filters['status'],string> = {
  all:'true',
  synced:`l.gbp_location_name IS NOT NULL AND EXISTS(SELECT 1 FROM gbp_grants g WHERE g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject AND NOT g.reconnect_required) AND EXISTS(SELECT 1 FROM gbp_sync_status s WHERE s.location_id=l.id AND s.last_success IS NOT NULL)`,
  reconnect:`l.gbp_location_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gbp_grants g WHERE g.user_id=l.user_id AND g.google_subject=l.gbp_google_subject AND NOT g.reconnect_required)`,
  unlinked:'l.gbp_location_name IS NULL',
  guard:`EXISTS(SELECT 1 FROM gbp_guard_changes g WHERE g.location_id=l.id AND g.user_id=l.user_id AND g.status='pending')`,
  unanswered:`EXISTS(SELECT 1 FROM google_profile_reviews r WHERE r.location_id=l.id AND r.user_id=l.user_id AND NOT r.google_deleted AND r.reply_comment IS NULL)`,
  failed:`EXISTS(SELECT 1 FROM gbp_content_jobs j WHERE j.location_id=l.id AND j.user_id=l.user_id AND j.status IN ('failed','uncertain','rejected'))`,
};
export function locationFilter(a: AgencyAccess, f: Filters) {
  const v=visibility(a), values=[...v.values,f.clientId??null,`%${f.q.replace(/[\\%_]/g,'\\$&')}%`,f.folder??null,f.tag??null];
  return {values,sql:`${v.sql} AND ($4::int IS NULL OR l.agency_client_id=$4) AND ($5='%%' OR concat_ws(' ',l.business_name,l.address,l.city,l.state,l.zip_code,l.place_id,c.name) ILIKE $5) AND ($6::text IS NULL OR c.folder=$6) AND ($7::text IS NULL OR $7=ANY(c.tags)) AND (${statusSql[f.status]})`};
}
export const locationJoin='business_locations l LEFT JOIN agency_clients c ON c.user_id=l.user_id AND c.id=l.agency_client_id';
export const camel = (r: Record<string,any>) => Object.fromEntries(Object.entries(r).map(([k,v])=>[k.replace(/_([a-z])/g,(_,s)=>s.toUpperCase()),v]));
export async function listLocations(a: AgencyAccess, f: Filters) {
  const w=locationFilter(a,f);
  const [{rows},{rows:[total]}]=await Promise.all([
    pool.query(`SELECT l.*,c.name AS client_name FROM ${locationJoin} WHERE ${w.sql} ORDER BY l.id LIMIT 50 OFFSET $8`,[...w.values,f.offset]),
    pool.query(`SELECT count(*)::int total FROM ${locationJoin} WHERE ${w.sql}`,w.values),
  ]);
  return {items:rows.map(camel),total:total.total,offset:f.offset,pageSize:50};
}
export async function dashboard(a:AgencyAccess,f:Filters) {
  const w=locationFilter(a,{...f,status:'all'});
  return (await pool.query(`SELECT count(*)::int total,${Object.entries(statusSql).filter(([k])=>k!=='all').map(([k,v])=>`count(*) FILTER(WHERE ${v})::int AS ${k}`).join(',')} FROM ${locationJoin} WHERE ${w.sql}`,w.values)).rows[0];
}
