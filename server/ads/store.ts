import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { AdsError } from './client';
export async function withAgencyLock<T>(userId:number,fn:(db:PoolClient)=>Promise<T>) {
  const c=await pool.connect();
  try {
    const {rows:[r]}=await c.query('SELECT pg_try_advisory_lock(8249,$1) locked',[userId]);
    if(!r.locked) throw new AdsError('Agency operation in progress. Try again shortly.',409);
    try{return await fn(c);}finally{await c.query('SELECT pg_advisory_unlock(8249,$1)',[userId]);}
  }finally{c.release();}
}
export async function grant(userId:number,verified=true) {
  const {rows:[g]}=await pool.query('SELECT user_id,connection_id,manager_id,verified,reconnect_required FROM ads_grants WHERE user_id=$1',[userId]);
  if(!g || g.reconnect_required || (verified&&!g.verified)) throw new AdsError('Connect and verify the agency MCC first.',409);
  return g;
}
export async function enqueue(userId:number,connectionId:string,kind:string,payload:unknown,customer:string|null=null,batch:string=randomUUID(),dedupe:string=randomUUID(),db:Pick<PoolClient,'query'>=pool) {
  const {rows:[j]}=await db.query(`INSERT INTO ads_jobs(user_id,connection_id,kind,payload,customer_id,batch_id,dedupe) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,dedupe) DO UPDATE SET dedupe=EXCLUDED.dedupe RETURNING id,batch_id,status`,[userId,connectionId,kind,JSON.stringify(payload),customer,batch,dedupe]);
  return j;
}
export async function account(userId:number,cid:string) {
  const {rows:[a]}=await pool.query('SELECT * FROM ads_accounts WHERE user_id=$1 AND customer_id=$2',[userId,cid]);
  if(!a || a.manager || a.status!=='ENABLED') throw new AdsError('Active client account not found in this agency.',404);
  return a;
}
