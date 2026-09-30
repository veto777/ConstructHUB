import { listBusinesses, pageInput, saveMapping, enqueueBulk, requestSync } from "./agency";
import { ownedBusiness } from "./service";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { rateLimit } from "../growth-limits";
import { autoSchema, opaqueId, publicMediaUrl } from "../../shared/social";
import { SocialError } from "./client";
import {
  connect,
  disconnect,
  discoverPages,
  createPosts,
  changePost,
  saveSettings,
  connection,
  type ClientFactory,
  clientFactory,
} from "./service";
export function registerSocialRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  make: ClientFactory = clientFactory,
) {
  const publicPost = ({connection_hash, request_hash, ...post}:any) => post;
  const gate = rateLimit("social", 60, 120);
  const route = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    fn: (req: Request, res: Response, id: number, businessId: number | null) => Promise<any>,
  ) => {
    app[method](
      `/api/social${path}`,
      (req, res, next) => {
        if (auth(req, res)) next();
      },
      ...(method === "get" ? [] : [gate]),
      async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
          const businessId = req.query?.businessId === undefined ? null : z.coerce.number().int().positive().parse(req.query.businessId);
          await ownedBusiness(req.user!.id, businessId);
          await fn(req, res, req.user!.id, businessId);
        } catch (e) {
          res
            .status(
              e instanceof SocialError
                ? e.status
                : e instanceof z.ZodError
                  ? 400
                  : 500,
            )
            .json({
              message:
                e instanceof SocialError
                  ? e.message
                  : e instanceof z.ZodError
                    ? "Invalid Social Media input"
                    : "Social Media operation could not be completed. Check your input and retry.",
            });
        }
      },
    );
  };
  route("get", "/businesses", async (req,res,id) => res.json(await listBusinesses(id,req.query||{})));
  route("post", "/bulk", async(req,res,id)=>res.status(202).json(await enqueueBulk(id,req.body)));
  route("get", "/bulk", async(req,res,id)=>{
    const q=pageInput.parse(req.query||{});
    const {rows}=await pool.query(`SELECT j.id,j.business_id,j.request_id,j.kind,j.state,j.error,l.business_name FROM social_bulk_jobs j
      JOIN business_locations l ON l.id=j.business_id AND l.user_id=j.user_id WHERE j.user_id=$1 AND (l.business_name ILIKE $2 OR j.state ILIKE $2)
      ORDER BY j.id DESC LIMIT $3 OFFSET $4`,[id,`%${q.search}%`,q.limit,q.offset]);
    res.json({items:rows,hasMore:rows.length===q.limit});
  });
  route("put", "/mapping", async(req,res,id,businessId)=>{
    if(!businessId)throw new SocialError("Choose a business");
    res.json(await saveMapping(id,businessId,req.body));
  });
  route("get", "/accounts", async(req,res,id,businessId)=>{
    const q=pageInput.parse(req.query||{});
    const {rows}=await pool.query(`WITH conn AS (SELECT accounts FROM social_connections WHERE user_id=$1
      AND (business_id=$2 OR business_id IS NULL) ORDER BY business_id NULLS LAST LIMIT 1)
      SELECT a-'pages'-'boards' AS a FROM conn,jsonb_array_elements(accounts) a WHERE a->>'name' ILIKE $3 OR a->>'platform' ILIKE $3
      ORDER BY a->>'name',a->>'id' LIMIT $4 OFFSET $5`,[id,businessId,`%${q.search}%`,q.limit,q.offset]);
    res.json({items:rows.map(r=>r.a),hasMore:rows.length===q.limit});
  });
  route("get", "/accounts/:id/targets", async(req,res,id,businessId)=>{
    const q=pageInput.parse(req.query||{}),accountId=opaqueId.parse(req.params.id);
    const {rows}=await pool.query(`WITH conn AS (SELECT accounts FROM social_connections WHERE user_id=$1
      AND (business_id=$2 OR business_id IS NULL) ORDER BY business_id NULLS LAST LIMIT 1), account AS (
      SELECT a FROM conn,jsonb_array_elements(accounts) a WHERE a->>'id'=$3)
      SELECT p FROM account,jsonb_array_elements(COALESCE(a->'boards',a->'pages','[]'::jsonb)) p WHERE p->>'name' ILIKE $4
      ORDER BY p->>'name',p->>'id' LIMIT $5 OFFSET $6`,[id,businessId,accountId,`%${q.search}%`,q.limit,q.offset]);
    res.json({items:rows.map(r=>r.p),hasMore:rows.length===q.limit});
  });
  const dashboard = async (req:Request,res:Response,id:number,businessId:number|null,all=false) => {
    const q=pageInput.extend({state:z.enum(['','draft','queued','submitting','submitted','published','failed','uncertain','cancelled']).default(''),
      platform:z.string().max(30).default(''),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(day=>Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day).optional(),
      timezone:z.string().max(80).default('UTC')}).parse(req.query||{});
    try {new Intl.DateTimeFormat('en',{timeZone:q.timezone});}catch{throw new SocialError('Invalid timezone');}
    const {rows:[c]}=await pool.query("SELECT accounts,updated_at,business_id FROM social_connections WHERE user_id=$1 AND (business_id=$2 OR business_id IS NULL) ORDER BY business_id NULLS LAST LIMIT 1",[id,businessId]);
    const {rows:[s]}=await pool.query("SELECT settings,next_at,last_error FROM social_settings WHERE user_id=$1 AND business_id IS NOT DISTINCT FROM $2",[id,businessId]);
    const {rows:[config]}=await pool.query("SELECT destinations,sync_requested,sync_error,synced_at FROM social_business_config WHERE user_id=$1 AND business_id=$2",[id,businessId]);
    const params=[id,businessId,all,`%${q.search}%`,q.state,q.platform,q.day||null,q.timezone];
    const where=`p.user_id=$1 AND ($3 OR p.business_id IS NOT DISTINCT FROM $2) AND
      (p.payload->'post'->'content'->>'text' ILIKE $4 OR l.business_name ILIKE $4) AND ($5='' OR p.state=$5)
      AND ($6='' OR p.payload->'post'->'content'->>'platform'=$6)
      AND ($7::date IS NULL OR (COALESCE(p.scheduled_at,p.created_at) AT TIME ZONE $8)::date=$7::date)`;
    const {rows:posts}=await pool.query(`SELECT p.*,l.business_name FROM social_posts p LEFT JOIN business_locations l ON l.id=p.business_id AND l.user_id=p.user_id
      WHERE ${where} ORDER BY COALESCE(p.scheduled_at,p.created_at) DESC,p.id LIMIT $9 OFFSET $10`,[...params,q.limit,q.offset]);
    const {rows:[count]}=await pool.query(`SELECT count(*)::int total FROM social_posts p LEFT JOIN business_locations l ON l.id=p.business_id AND l.user_id=p.user_id WHERE ${where}`,params);
    const {rows:[connections]}=await pool.query("SELECT bool_or(business_id IS NULL) AS agency, bool_or(business_id=$2) AS business FROM social_connections WHERE user_id=$1",[id,businessId]);
    const mappings=config?.destinations||[];
    const accounts=businessId ? (c?.accounts||[]).filter((a:any)=>mappings.some((d:any)=>d.accountId===a.id)).map((a:any)=>({...a,
      pages:a.pages?.filter((p:any)=>mappings.some((d:any)=>d.accountId===a.id&&d.pageId===p.id)),
      boards:a.boards?.filter((p:any)=>mappings.some((d:any)=>d.accountId===a.id&&d.boardId===p.id))})) : (c?.accounts||[]).slice(0,25);
    res.json({connected:!!c,agencyConnected:!!connections?.agency,businessConnected:!!connections?.business,connectionScope:c?.business_id?'business':'agency',accounts,settings:s?.settings||autoSchema.parse({}),
      nextAt:s?.next_at,lastError:s?.last_error,posts:posts.map(publicPost),total:count.total,defaults:mappings,sourcesSync:config,
      business:businessId?await ownedBusiness(id,businessId):null});
  };
  route("get", "", async(req,res,id,businessId)=>dashboard(req,res,id,businessId));
  route("get", "/calendar", async(req,res,id,businessId)=>dashboard(req,res,id,businessId,true));
  route("post", "/connect", async (req, res, id, businessId) => {
    const { apiKey } = z
      .object({ apiKey: z.string().trim().min(8).max(512) })
      .strict()
      .parse(req.body);
    const result=await connect(id, apiKey, req, make, businessId);
    res.json({connected:result.connected,accounts:result.accounts.slice(0,25).map(({id,platform,name}:any)=>({id,platform,name}))});
  });
  route("post", "/disconnect", async (_req, res, id, businessId) =>
    res.json(await disconnect(id, _req, businessId)),
  );
  route("post", "/accounts/:id/pages", async (req, res, id, businessId) =>
    res.json(await discoverPages(id, opaqueId.parse(req.params.id), make, businessId)),
  );
  route("post", "/posts", async (req, res, id, businessId) => {
    if(!businessId)throw new SocialError("Choose a business");
    res.status(201).json({ posts: (await createPosts(id, req.body, businessId)).map(publicPost) });
  });
  route("post", "/posts/bulk-action", async(req,res,id,businessId)=>{
    const body=z.object({ids:z.array(z.string().uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length),action:z.enum(['approve','cancel'])}).strict().parse(req.body);
    const {rows}=await pool.query("SELECT id,business_id FROM social_posts WHERE user_id=$1 AND id=ANY($2::uuid[]) AND ($3::int IS NULL OR business_id=$3)",[id,body.ids,businessId]);
    if(rows.length!==body.ids.length)throw new SocialError('Post not found',404);
    const results=[];
    for(const p of rows) {
      try {await changePost(id,p.id,body.action,undefined,p.business_id);results.push({id:p.id,ok:true});}
      catch(e){results.push({id:p.id,ok:false,error:e instanceof SocialError?e.message:'Could not change post'});}
    }
    res.json({results});
  });
  route("post", "/posts/:id/action", async (req, res, id, businessId) => {
    const body = z
      .object({
        action: z.enum(["approve", "cancel"]),
        text: z.string().trim().min(1).max(63206).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      publicPost(await changePost(
        id,
        z.string().uuid().parse(req.params.id),
        body.action,
        body.text,
        businessId,
      )),
    );
  });
  route("put", "/settings", async (req, res, id, businessId) => {
    if(!businessId)throw new SocialError("Choose a business");
    res.json(await saveSettings(id, req.body, businessId));
  });
  route("post", "/generate", async(req,res,id,businessId)=>{
    if(!businessId)throw new SocialError("Choose a business");
    res.status(202).json(await enqueueBulk(id,{requestId:z.string().uuid().parse(req.body?.requestId),businessIds:[businessId],kind:'generate'}));
  });
  route("get", "/media", async(req,res,id,businessId)=>{
    const q=pageInput.parse(req.query||{});
    const {rows}=await pool.query(businessId ? `SELECT m.name AS id,COALESCE(m.description,m.category,'Business photo') AS name,m.google_url AS url
      FROM gbp_media m JOIN business_locations l ON l.id=m.location_id WHERE l.user_id=$1 AND l.id=$2 AND m.source='business'
      AND COALESCE(m.description,m.category,'Business photo') ILIKE $3 ORDER BY m.create_time DESC NULLS LAST,m.name LIMIT $4 OFFSET $5`
      : "SELECT id,name,url FROM media_photos WHERE user_id=$1 AND name ILIKE $2 ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",
      businessId?[id,businessId,`%${q.search}%`,q.limit,q.offset]:[id,`%${q.search}%`,q.limit,q.offset]);
    res.json(rows.filter(r=>publicMediaUrl.safeParse(r.url).success));
  });
  route("post", "/uploads", async (req, res, id, businessId) => {
    const { filename } = z
      .object({
        filename: z
          .string()
          .min(1)
          .max(160)
          .regex(/^[\w .-]+\.(jpg|jpeg|png|webp|mp4|mov)$/i),
      })
      .strict()
      .parse(req.body);
    const { client } = await connection(id, make, businessId);
    const data = await client.request("/media/uploads", { filename });
    const publicUrl = publicMediaUrl.parse(data.publicUrl),
      presignedUrl = publicMediaUrl.parse(data.presignedUrl);
    res.json({ publicUrl, presignedUrl });
  });
  route("post", "/sources/sync-gbp", async(req,res,id,businessId)=>{
    if(!businessId)throw new SocialError("Choose a business");
    res.status(202).json(await requestSync(id,businessId));
  });
  route("get", "/sources", async(req,res,id,businessId)=>{
    const q=pageInput.extend({kind:z.enum(['','offers','gbp']).default('')}).parse(req.query||{});
    const {rows}=await pool.query("SELECT * FROM social_sources WHERE user_id=$1 AND business_id IS NOT DISTINCT FROM $2 AND text ILIKE $3 AND ($4='' OR kind=$4) ORDER BY created_at DESC,id DESC LIMIT $5 OFFSET $6",[id,businessId,`%${q.search}%`,q.kind,q.limit,q.offset]);
    res.json(rows);
  });
  route("post", "/sources", async (req, res, id, businessId) => {
    const input = z
      .object({
        kind: z.enum(["offers", "gbp"]),
        text: z.string().trim().min(1).max(4000),
        mediaUrls: z.array(publicMediaUrl).max(10).default([]),
      })
      .strict()
      .parse(req.body);
    const {
      rows: [row],
    } = await pool.query(
      "INSERT INTO social_sources(user_id,kind,text,media_urls,business_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [id, input.kind, input.text, JSON.stringify(input.mediaUrls), businessId],
    );
    res.status(201).json(row);
  });
  route("delete", "/sources/:id", async (req, res, id, businessId) => {
    const sourceId = z.coerce.number().int().positive().parse(req.params.id);
    const r = await pool.query(
      "DELETE FROM social_sources WHERE id=$1 AND user_id=$2 AND business_id IS NOT DISTINCT FROM $3",
      [sourceId, id, businessId],
    );
    if (!r.rowCount) throw new SocialError("Source not found", 404);
    res.json({ ok: true });
  });
}
