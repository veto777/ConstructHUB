import type { Pool, PoolClient } from 'pg';
import { importedProfile, mergeImport, profileFields, jsonFields } from './profile';
import { checkListing, type NapProfile } from './nap';
export type Scope = { userId: number; actorId: number; admin: boolean };
export class ListingError extends Error { constructor(public status: number, message: string) { super(message); } }
export function domainAllows(domain: string, raw: string) {
  const h = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
  return h === domain || h.endsWith(`.${domain}`);
}
// All ownership predicates use the authenticated account scope, never body/query user_id.
export class ListingStore {
 constructor(private db: Pool, private checker = checkListing) {}
 async location(scope: Scope, id: number, db: Pick<PoolClient, 'query'> = this.db) {
  const {rows:[row]} = await db.query('SELECT * FROM business_locations WHERE id=$1 AND (user_id=$2 OR $3::boolean)', [id,scope.userId,scope.admin]);
  if (!row) throw new ListingError(404, 'Location not found');
  return row;
 }
 async profile(scope: Scope, locationId: number) {
  await this.location(scope,locationId);
  const {rows:[row]} = await this.db.query('SELECT * FROM listing_profiles WHERE location_id=$1 AND (user_id=$2 OR $3::boolean)',[locationId,scope.userId,scope.admin]);
  return row ?? null;
 }
 private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await this.db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
 }
 private async event(c: PoolClient, scope: Scope, profileId: number, listingId: number | null, type: string, detail: unknown) {
  await c.query('INSERT INTO listing_events(profile_id,listing_id,actor_user_id,type,detail) VALUES($1,$2,$3,$4,$5)',[profileId,listingId,scope.actorId,type,JSON.stringify(detail)]);
 }
 async saveProfile(scope: Scope, locationId: number, edits: Record<string, any> | null, google?: Record<string, any>) {
  return this.tx(async c => {
   const location = await this.location(scope,locationId,c);
   // Serializes initial imports too, before a profile row exists.
   await c.query('SELECT pg_advisory_xact_lock(7821,$1)',[locationId]);
   const {rows:[current]} = await c.query('SELECT * FROM listing_profiles WHERE location_id=$1 FOR UPDATE',[locationId]);
   const incoming = importedProfile(location,google);
   const values = edits ? {...(current ?? incoming),...edits} : mergeImport(current,incoming);
   const ownerFields = [...new Set<string>([...(current?.owner_edited_fields ?? []),...Object.keys(edits ?? {})])];
   const fields = profileFields.map(k => jsonFields.has(k) && values[k] != null ? JSON.stringify(values[k]) : values[k] ?? null);
   const source = edits || ownerFields.length ? 'manual' : google ? 'gbp' : 'manual';
   const params = [location.user_id,locationId,...fields,source,ownerFields];
   const names = ['user_id','location_id',...profileFields,'source','owner_edited_fields'];
   const {rows:[saved]} = await c.query(`INSERT INTO listing_profiles(${names.join(',')}) VALUES(${params.map((_,i)=>`$${i+1}`).join(',')})
    ON CONFLICT(location_id) DO UPDATE SET ${names.filter(k=>k!=='location_id').map(k=>`${k}=EXCLUDED.${k}`).join(',')},revision=listing_profiles.revision+1,updated_at=now() RETURNING *`,params);
   // Canonical edits invalidate crawl verdicts, while retaining original evidence in the event log.
   await c.query(`UPDATE listings SET status=CASE WHEN status IN ('live','mismatch') THEN 'queued' ELSE status END,
    billable=false,nap_result=NULL,evidence=NULL,last_checked_at=NULL,updated_at=now() WHERE profile_id=$1`,[saved.id]);
   await this.event(c,scope,saved.id,null,edits ? 'profile_edited' : 'profile_imported', {source,fields:edits ? Object.keys(edits) : profileFields.filter(k=>!ownerFields.includes(k)), preservedFields:ownerFields,revision:saved.revision});
   return saved;
  });
 }
 async directories(filters: Record<string, any>) {
  const predicates: string[] = [], values: any[] = [];
  for (const key of ['kind','tier','category','active']) if(filters[key] !== undefined) { values.push(filters[key]); predicates.push(`${key}=$${values.length}`); }
  for (const [key,column] of [['trade','trades'],['state','states']]) if(filters[key]) { values.push(filters[key]); predicates.push(`$${values.length}=ANY(${column})`); }
  return (await this.db.query(`SELECT * FROM listing_directories ${predicates.length ? 'WHERE '+predicates.join(' AND ') : ''} ORDER BY tier,name`,values)).rows;
 }
 async list(scope: Scope, filters: {location_id?: number; status?: string; limit: number; offset: number}) {
  return (await this.db.query(`SELECT l.*,p.location_id,p.user_id,d.name AS directory_name,d.tier,d.category FROM listings l
   JOIN listing_profiles p ON p.id=l.profile_id JOIN listing_directories d ON d.id=l.directory_id
   WHERE (p.user_id=$1 OR $2::boolean) AND ($3::integer IS NULL OR p.location_id=$3) AND ($4::text IS NULL OR l.status=$4)
   ORDER BY l.id DESC LIMIT $5 OFFSET $6`,[scope.userId,scope.admin,filters.location_id ?? null,filters.status ?? null,filters.limit,filters.offset])).rows;
 }
 async add(scope: Scope, profileId: number, directoryId: number, url: string) {
  return this.tx(async c=> {
   const {rows:[p]} = await c.query('SELECT * FROM listing_profiles WHERE id=$1 AND (user_id=$2 OR $3::boolean) FOR UPDATE',[profileId,scope.userId,scope.admin]);
   if(!p) throw new ListingError(404,'Profile not found');
   const {rows:[d]} = await c.query('SELECT * FROM listing_directories WHERE id=$1 AND active=true',[directoryId]);
   if(!d) throw new ListingError(404,'Active directory not found');
   if(!d.domain || !domainAllows(d.domain,url)) throw new ListingError(400,'Listing URL must belong to the selected directory');
   const {rows:[l]} = await c.query(`INSERT INTO listings(profile_id,directory_id,listing_url) VALUES($1,$2,$3)
    ON CONFLICT(profile_id,directory_id) DO NOTHING RETURNING *`,[p.id,d.id,url]);
   if(!l) throw new ListingError(409,'A listing already exists for this profile and directory');
   await this.event(c,scope,p.id,l.id,'listing_added',{url});
   return l;
  });
 }
 async recheck(scope: Scope, id: number) {
  // Read snapshot without holding a DB transaction during network I/O.
  const {rows:[row]} = await this.db.query(`SELECT l.*,l.xmin::text AS row_version,to_jsonb(p) AS profile,d.domain FROM listings l JOIN listing_profiles p ON p.id=l.profile_id
   JOIN listing_directories d ON d.id=l.directory_id WHERE l.id=$1 AND (p.user_id=$2 OR $3::boolean)`,[id,scope.userId,scope.admin]);
  if(!row) throw new ListingError(404,'Listing not found');
  if(!row.listing_url || !row.domain) throw new ListingError(400,'No checkable listing URL');
  const result = await this.checker(row.listing_url,row.profile as NapProfile,row.status,undefined,url=>domainAllows(row.domain,url));
  return this.tx(async c=> {
   const {rows:[p]} = await c.query('SELECT * FROM listing_profiles WHERE id=$1 AND (user_id=$2 OR $3::boolean) FOR UPDATE',[row.profile_id,scope.userId,scope.admin]);
   if(!p) throw new ListingError(404,'Profile not found');
   const {rows:[fresh]} = await c.query('SELECT *,xmin::text AS row_version FROM listings WHERE id=$1 FOR UPDATE',[id]);
   if(!fresh) throw new ListingError(404,'Listing not found');
   if(p.revision !== row.profile.revision || fresh.row_version !== row.row_version) throw new ListingError(409,'Profile or listing changed during crawl; recheck again');
   const {rows:[saved]} = await c.query(`UPDATE listings SET status=$2,nap_result=$3,evidence=$4,billable=$5,last_checked_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
    [id,result.status,JSON.stringify(result.nap),JSON.stringify(result.evidence),result.billable]);
   await this.event(c,scope,p.id,id,'listing_checked',result);
   return saved;
  });
 }
 async events(scope: Scope, locationId: number, limit: number, after: number) {
  await this.location(scope,locationId);
  return (await this.db.query(`SELECT e.* FROM listing_events e JOIN listing_profiles p ON p.id=e.profile_id
   WHERE p.location_id=$1 AND (p.user_id=$2 OR $3::boolean) AND e.id>$4 ORDER BY e.id ASC LIMIT $5`,[locationId,scope.userId,scope.admin,after,limit])).rows;
 }
 async summary(scope: Scope, locationId?: number) {
  const {rows} = await this.db.query(`SELECT d.tier,d.category,count(*)::int AS total,
   count(*) FILTER(WHERE l.status='live')::int AS live,count(*) FILTER(WHERE l.status='mismatch')::int AS mismatch,
   count(*) FILTER(WHERE l.billable)::int AS billable FROM listings l JOIN listing_profiles p ON p.id=l.profile_id
   JOIN listing_directories d ON d.id=l.directory_id WHERE (p.user_id=$1 OR $2::boolean) AND ($3::integer IS NULL OR p.location_id=$3)
   GROUP BY d.tier,d.category ORDER BY d.tier,d.category`,[scope.userId,scope.admin,locationId ?? null]);
  const empty = () => ({total:0,live:0,mismatch:0,billable:0});
  const total=empty(), by_tier: Record<string,ReturnType<typeof empty>>={}, by_category: typeof by_tier={};
  for(const r of rows) for(const target of [total,by_tier[r.tier] ??= empty(),by_category[r.category] ??= empty()]) for(const k of ['total','live','mismatch','billable'] as const) target[k]+=r[k];
  return {...total,by_tier,by_category};
 }
}
