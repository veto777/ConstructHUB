import { describe, it, expect, vi } from 'vitest';
// Register real handlers but replace external dependencies: no app boot or database connection.
vi.mock('../db',()=>({pool:{query:vi.fn()}}));
vi.mock('../crm/admin',()=>({platformGatePassed:vi.fn(()=>true),ADMIN_REAUTH_BODY:{message:'re-authenticate'}}));
vi.mock('../growth-limits',()=>({takeBudget:vi.fn(async()=>true)}));
vi.mock('../gbp/listing-editor',()=>({loadListing:vi.fn()}));
import { registerListingsRoutes } from './routes';
import { pool } from '../db';
import { platformGatePassed } from '../crm/admin';
function harness(user:any={id:1},actor:any={id:1}) {
 const handlers=new Map<string,any>();
 const app:any=Object.fromEntries(['get','put','post'].map(method=>[method,(path:string,fn:any)=>handlers.set(`${method} ${path}`,fn)]));
 const store:any=Object.fromEntries(['profile','saveProfile','location','directories','summary','list','add','recheck','events'].map(k=>[k,vi.fn(async()=>[])]));
 registerListingsRoutes(app,(_req,res)=>{if(!user){res.status(401).json({message:'Not authenticated'});return null;}return user;},{store});
 const call=async(method:string,path:string,input:any={})=> {
  const res:any={locals:{},statusCode:200,status(code:number){this.statusCode=code;return this;},json(value:any){this.body=value;return this;}};
  await handlers.get(`${method} /api/listings${path}`)({user:actor,params:{locationId:'2',id:'4'},query:{},body:{},...input},res);
  return res;
 };
 return {store,call};
}
describe('signed-in API and trusted scope',()=> {
 it('requires authentication on every route',async()=> {
  const {call,store}=harness(null,null);
  for(const [method,path] of [['get',''],['post',''],['get','/profiles/:locationId'],['put','/profiles/:locationId'],['post','/profiles/:locationId/import-from-gbp'],['post','/:id/recheck'],['get','/summary'],['get','/directories'],['get','/profiles/:locationId/events']]) expect((await call(method,path)).statusCode).toBe(401);
  expect(store.list).not.toHaveBeenCalled();
 });
 it('uses workspace account but authenticates admin privileges against the actual actor',async()=> {
  vi.mocked(pool.query).mockResolvedValue({rows:[{email:'customer@example.com'}]} as never);
  const {call,store}=harness({id:22,email:'support@constructhub.us'},{id:1});
  await call('get','');
  expect(pool.query).toHaveBeenLastCalledWith('SELECT email FROM users WHERE id=$1',[1]);
  expect(store.list).toHaveBeenCalledWith({userId:22,actorId:1,admin:false},{limit:50,offset:0});
 });
 it('gives platform admins cross-account scope only after the existing gate',async()=> {
  vi.mocked(pool.query).mockResolvedValue({rows:[{email:'support@constructhub.us'}]} as never);
  const {call,store}=harness({id:3},{id:3});
  await call('get','/summary');expect(store.summary).toHaveBeenCalledWith({userId:3,actorId:3,admin:true},undefined);
  vi.mocked(platformGatePassed).mockReturnValue(false);
  expect((await call('get','')).statusCode).toBe(403);expect(store.list).not.toHaveBeenCalled();
  vi.mocked(platformGatePassed).mockReturnValue(true);
 });
 it('rejects client billability, statuses, account injection and unsafe URLs',async()=> {
  vi.mocked(pool.query).mockResolvedValue({rows:[{email:'customer@example.com'}]} as never);
  const {call,store}=harness();
  for(const body of [{profile_id:1,directory_id:2,listing_url:'https://yelp.com/a',billable:true},{profile_id:1,directory_id:2,listing_url:'http://127.0.0.1/'},{profile_id:1,directory_id:2,listing_url:'file:///etc/passwd'}]) expect((await call('post','',{body})).statusCode).toBe(400);
  expect((await call('put','/profiles/:locationId',{body:{user_id:2,name:'Other'}})).statusCode).toBe(400);
  expect((await call('get','',{query:{user_id:2}})).statusCode).toBe(400);
  expect(store.add).not.toHaveBeenCalled();expect(store.saveProfile).not.toHaveBeenCalled();
 });
 it('passes validated profile edits and the trusted account scope',async()=> {
  const {call,store}=harness();
  expect((await call('put','/profiles/:locationId',{body:{name:'Owner edited',phone:null}})).statusCode).toBe(200);
  expect(store.saveProfile).toHaveBeenCalledWith({userId:1,actorId:1,admin:false},2,{name:'Owner edited',phone:null});
 });
});
