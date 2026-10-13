import { listBusinesses, pageInput, saveMapping, enqueueBulk, requestSync } from "./agency";
import { libraryMedia } from "./library-media";
import { ownedBusiness } from "./service";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { rateLimit } from "../growth-limits";
import { requireModule } from "../entitlements";
import { autoSchema, opaqueId, publicMediaUrl } from "../../shared/social";
import { decryptKey, encryptKey, SocialError, socialErrorBody } from "./client";
import {
  disconnect,
  discoverPages,
  createPosts,
  changePost,
  saveSettings,
  connection,
  type ClientFactory,
  clientFactory,
  connectionProvider,
  LEGACY_CONNECTION,
  outstandConnectUrl,
  outstandRefresh,
  outstandPending,
  outstandFinalize,
  nativeConnectUrl,
  nativeCallback,
  nativeNetCallback,
  nativeRefresh,
  nativePending,
  nativeFinalize,
} from "./service";
import { CONNECTABLE, outstandConfigured, webhookSigned } from "./outstand";
import { NativeClient, nativeNetworksFor, receiveUpload, NATIVE_UPLOAD_MAX_BYTES } from "./native";
import { accountStats, postStats, comments as postComments, replyComment, hideComment, deleteComment, deletePost } from "./insights";
import { putToR2Key } from "../r2";
import { registerDeletionRoutes } from "./deletion";
import { registerTikTokWebhook } from "./tiktok-webhook";
import express from "express";
// Curated, field-specific messages. Raw Zod text is never echoed; custom
// refinements (written for people) pass through as-is.
const fieldMessages: Record<string, string> = {
  text: "Enter the text. It cannot be empty or longer than the allowed length.",
  mediaUrls: "Media URLs must be public HTTPS links (up to 10).",
  destinations: "Choose valid accounts and pages (up to 20).",
  scheduledTime: "Choose a valid schedule time.",
  cadence: "Posts per period must be a whole number from 1 to 7.",
  period: "Choose a cadence period of day or week.",
  mode: "Choose a publishing mode.",
  mix: "Choose at least one content type.",
  instructions: "Business instructions must be 4,000 characters or fewer.",
  examples: "Writing examples must be 4,000 characters or fewer.",
  timezone: "Enter a valid timezone, for example America/New_York.",
  blackoutStart: "Blackout start must be an hour from 0 to 23.",
  blackoutEnd: "Blackout end must be an hour from 0 to 23.",
  aiDailyBudget: "Daily AI budget must be a whole number from 0 to 20.",
  kind: "Choose a source type.",
  businessIds: "Choose between 1 and 1,000 different businesses.",
};
/**
 * POST /posts/:id/action — approve a draft (optionally with edited text), save an edited draft
 * without queueing it, or cancel a draft / queued post. "save" always carries the text.
 */
export const postActionBody = z
  .object({
    action: z.enum(["approve", "cancel", "save"]),
    text: z.string().trim().min(1).max(63206).optional(),
  })
  .strict()
  .refine((b) => b.action !== "save" || b.text !== undefined, { path: ["text"], message: "Enter the draft text to save it." });

export function socialInputMessage(e: z.ZodError): string {
  const issue = e.issues[0];
  if (!issue) return "Invalid Social Media input";
  if (issue.code === "custom" && issue.message && issue.message !== "Invalid input")
    return issue.message;
  return fieldMessages[String(issue.path[0] ?? "")] ?? "Invalid Social Media input";
}
/** Read-only readiness check; never contacts the provider or exposes key material. */
export function socialSetupProblem(keyEnc: string | undefined, userId: number): string | null {
  try {
    // Validate the server key even when no account is connected yet.
    encryptKey("setup-check", userId);
    if (keyEnc !== undefined && !/^(native|outstand):/.test(decryptKey(keyEnc, userId))) return LEGACY_CONNECTION;
    return null;
  } catch (e) {
    return e instanceof SocialError ? e.message : "This business’s social connection could not be unlocked. Reconnect your accounts above before posting or saving drafts.";
  }
}

export function registerSocialRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  make: ClientFactory = clientFactory,
) {
  const publicPost = ({connection_hash, request_hash, ...post}:any) => post;
  const gate = rateLimit("social", 60, 120);
  // The whole Social Media tool is a Pro-and-up module (shared/plans.ts
  // socialPublishing): every route answers 401/402 before touching a provider.
  // Extra middleware can gate a route further (autoPosts — the scheduled AI
  // generation, also Pro and up).
  const route = (
    method: "get" | "post" | "put" | "delete",
    path: string,
    fn: (req: Request, res: Response, id: number, businessId: number | null) => Promise<any>,
    extra: readonly ((req: Request, res: Response, next: (err?: any) => void) => void)[] = [],
  ) => {
    app[method](
      `/api/social${path}`,
      (req, res, next) => {
        if (auth(req, res)) next();
      },
      requireModule("socialPublishing"),
      ...extra,
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
            .json(
              e instanceof SocialError
                ? socialErrorBody(e)
                : {
                    message:
                      e instanceof z.ZodError
                        ? socialInputMessage(e)
                        : "Social Media operation could not be completed. Check your input and retry.",
                  },
            );
        }
      },
    );
  };
  // Outstand tells us when a post went out or failed: the worker looks at those posts now instead of in a minute.
  // Signed with OUTSTAND_WEBHOOK_SECRET (HMAC-SHA256 of the raw body); anything unsigned is refused.
  app.post("/api/social/outstand/webhook", async (req: Request, res: Response) => {
    if (!webhookSigned((req as any).rawBody, req.get("x-outstand-signature"), process.env.OUTSTAND_WEBHOOK_SECRET)) return res.status(401).json({ message: "Bad signature" });
    const event = String(req.body?.event ?? "");
    const postId = req.body?.data?.id ?? req.body?.data?.postId ?? req.body?.data?.post?.id;
    if ((event === "post.published" || event === "post.error") && typeof postId === "string" && /^[\w-]{1,200}$/.test(postId)) {
      await pool.query("UPDATE social_posts SET due_at=now(),updated_at=now() WHERE submission_id=$1 AND state='submitted'", [postId]);
    }
    if (event === "account.token_expired") console.warn("[social] outstand account needs reconnecting:", JSON.stringify(req.body?.data ?? {}).slice(0, 300));
    res.json({ ok: true });
  });
  route("get", "/businesses", async (req,res,id) => res.json(await listBusinesses(id,req.query||{})));
  // Bulk jobs of kind 'settings'/'generate' are auto-posts work (the scheduled AI
  // generation), not just publishing: they need the autoPosts module too.
  const autoPostsForBulk = (req: Request, res: Response, next: (err?: any) => void) => {
    if (["settings", "generate"].includes((req.body as any)?.kind)) return requireModule("autoPosts")(req, res, next);
    next();
  };
  route("post", "/bulk", async(req,res,id)=>res.status(202).json(await enqueueBulk(id,req.body)), [autoPostsForBulk]);
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
      timezone:z.string().max(80).default('UTC'),order:z.enum(['desc','asc']).default('desc')}).parse(req.query||{});
    try {new Intl.DateTimeFormat('en',{timeZone:q.timezone});}catch{throw new SocialError('Invalid timezone');}
    const {rows:[c]}=await pool.query("SELECT accounts,updated_at,business_id,key_enc FROM social_connections WHERE user_id=$1 AND (business_id=$2 OR business_id IS NULL) ORDER BY business_id NULLS LAST LIMIT 1",[id,businessId]);
    const {rows:[s]}=await pool.query("SELECT settings,next_at,last_error FROM social_settings WHERE user_id=$1 AND business_id IS NOT DISTINCT FROM $2",[id,businessId]);
    const {rows:[config]}=await pool.query("SELECT destinations,sync_requested,sync_error,synced_at FROM social_business_config WHERE user_id=$1 AND business_id=$2",[id,businessId]);
    const params=[id,businessId,all,`%${q.search}%`,q.state,q.platform,q.day||null,q.timezone];
    const where=`p.user_id=$1 AND ($3 OR p.business_id IS NOT DISTINCT FROM $2) AND
      (p.payload->'post'->'content'->>'text' ILIKE $4 OR l.business_name ILIKE $4) AND ($5='' OR p.state=$5)
      AND ($6='' OR p.payload->'post'->'content'->>'platform'=$6)
      AND ($7::date IS NULL OR (COALESCE(p.scheduled_at,p.created_at) AT TIME ZONE $8)::date=$7::date)`;
    const {rows:posts}=await pool.query(`SELECT p.*,l.business_name FROM social_posts p LEFT JOIN business_locations l ON l.id=p.business_id AND l.user_id=p.user_id
      WHERE ${where} ORDER BY COALESCE(p.scheduled_at,p.created_at) ${q.order==='asc'?'ASC':'DESC'},p.id LIMIT $9 OFFSET $10`,[...params,q.limit,q.offset]);
    const {rows:[count]}=await pool.query(`SELECT count(*)::int total FROM social_posts p LEFT JOIN business_locations l ON l.id=p.business_id AND l.user_id=p.user_id WHERE ${where}`,params);
    const {rows:[connections]}=await pool.query("SELECT bool_or(business_id IS NULL) AS agency, bool_or(business_id=$2) AS business FROM social_connections WHERE user_id=$1",[id,businessId]);
    const mappings=config?.destinations||[];
    const accounts=businessId ? (c?.accounts||[]).filter((a:any)=>mappings.some((d:any)=>d.accountId===a.id)).map((a:any)=>({...a,
      pages:a.pages?.filter((p:any)=>mappings.some((d:any)=>d.accountId===a.id&&d.pageId===p.id)),
      boards:a.boards?.filter((p:any)=>mappings.some((d:any)=>d.accountId===a.id&&d.boardId===p.id))})) : (c?.accounts||[]).slice(0,25);
    // A connection we cannot use (unreadable, or a legacy key: LEGACY_CONNECTION) shows as not connected; setupProblem says why.
    const provider=connectionProvider(c?.key_enc,id);
    res.json({setupProblem:socialSetupProblem(c?.key_enc,id),provider,outstand:outstandConfigured()?{networks:CONNECTABLE}:null,native:nativeNetworksFor(req.user).length?{networks:nativeNetworksFor(req.user)}:null,connected:!!c&&!!provider,agencyConnected:!!connections?.agency,businessConnected:!!connections?.business,connectionScope:c?.business_id?'business':'agency',accounts:provider?accounts:[],settings:s?.settings||autoSchema.parse({}),
      nextAt:s?.next_at,lastError:s?.last_error,posts:posts.map(publicPost),total:count.total,defaults:mappings,sourcesSync:config,
      business:businessId?await ownedBusiness(id,businessId):null});
  };
  // The Social Media page for the chosen business: connection state and accounts, auto-mode
  // settings, and the filtered post queue/calendar (plus the all-businesses calendar view).
  route("get", "", async(req,res,id,businessId)=>dashboard(req,res,id,businessId));
  route("get", "/calendar", async(req,res,id,businessId)=>dashboard(req,res,id,businessId,true));
  // "Connect Facebook / Instagram / …": the network's own sign-in, through ConstructHUB's publishing account.
  route("post", "/outstand/connect", async (req, res, id, businessId) => {
    const { network } = z.object({ network: z.enum(CONNECTABLE) }).strict().parse(req.body);
    res.json(await outstandConnectUrl(id, businessId, network, req));
  });
  // Back from the sign-in: read the connected accounts again.
  // Data deletion / deauthorize callbacks from Meta and Threads (signed_request; no session — server/social/deletion.ts).
  registerDeletionRoutes(app);
  // TikTok's webhooks (signed with the client secret; no session — server/social/tiktok-webhook.ts).
  registerTikTokWebhook(app);
  // ConstructHUB Direct (server/social/native.ts): our own apps on each network.
  route("post", "/native/connect", async (req, res, id, businessId) => {
    const { network } = z.object({ network: z.string().min(2).max(20) }).strict().parse(req.body);
    if (!nativeNetworksFor(req.user).includes(network)) throw new SocialError("That network can't be connected here yet");
    res.json(await nativeConnectUrl(id, businessId, network, req));
  });
  route("post", "/native/refresh", async (_req, res, id, businessId) => res.json(await nativeRefresh(id, businessId)));
  // Stats, comments and deleting (./insights.ts) — for accounts connected through ConstructHUB Direct, admins only
  // until Meta approves the app, like the rest of Direct.
  const direct = async (req: Request, id: number, businessId: number | null): Promise<NativeClient> => {
    if (!nativeNetworksFor(req.user).length) throw new SocialError("Not found", 404);
    const { client } = await connection(id, make, businessId);
    if (!(client instanceof NativeClient)) throw new SocialError("This business isn't connected through ConstructHUB", 409);
    return client;
  };
  /** The ConstructHUB post (this user, this business) and the submission it was published as. */
  const nativePost = async (id: number, businessId: number | null, postId: string) => {
    const pid = z.string().uuid().parse(postId);
    const { rows: [p] } = await pool.query("SELECT id,submission_id,state FROM social_posts WHERE id=$1 AND user_id=$2 AND business_id IS NOT DISTINCT FROM $3", [pid, id, businessId]);
    if (!p || typeof p.submission_id !== "string" || !p.submission_id.startsWith("nat_")) throw new SocialError("That post wasn't published through ConstructHUB's own connection", 404);
    return p as { id: string; submission_id: string; state: string };
  };
  const commentParam = z.string().regex(/^[\w.-]{1,120}$/);
  // The TikTok post panel asks this every time it opens for an account (TikTok's rule: never cached) — who is
  // posting, the privacy levels this creator offers, whether comments / Duet / Stitch are off, the longest video.
  route("get", "/native/tiktok/creator-info", async (req, res, id, businessId) => {
    const accountId = opaqueId.parse(req.query.accountId);
    const client = await direct(req, id, businessId);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json(await client.tiktokCreatorInfo(accountId));
  });
  route("get", "/native/stats", async (req, res, id, businessId) => {
    const days = z.coerce.number().pipe(z.union([z.literal(7), z.literal(28)])).catch(28).parse(req.query.days);
    res.json({ accounts: await accountStats(await direct(req, id, businessId), days as 7 | 28) });
  });
  route("get", "/native/posts/:postId/stats", async (req, res, id, businessId) => {
    const client = await direct(req, id, businessId);
    res.json(await postStats(client, (await nativePost(id, businessId, String(req.params.postId))).submission_id));
  });
  route("get", "/native/posts/:postId/comments", async (req, res, id, businessId) => {
    const client = await direct(req, id, businessId);
    res.json(await postComments(client, (await nativePost(id, businessId, String(req.params.postId))).submission_id, typeof req.query.after === "string" ? req.query.after : null));
  });
  route("post", "/native/posts/:postId/comments/:commentId/reply", async (req, res, id, businessId) => {
    const { message } = z.object({ message: z.string().trim().min(1, "Write a reply first").max(2200) }).strict().parse(req.body);
    const client = await direct(req, id, businessId);
    res.json(await replyComment(client, (await nativePost(id, businessId, String(req.params.postId))).submission_id, commentParam.parse(String(req.params.commentId)), message));
  });
  route("post", "/native/posts/:postId/comments/:commentId/hide", async (req, res, id, businessId) => {
    const { hidden } = z.object({ hidden: z.boolean() }).strict().parse(req.body);
    const client = await direct(req, id, businessId);
    res.json(await hideComment(client, (await nativePost(id, businessId, String(req.params.postId))).submission_id, commentParam.parse(String(req.params.commentId)), hidden));
  });
  route("delete", "/native/posts/:postId/comments/:commentId", async (req, res, id, businessId) => {
    const client = await direct(req, id, businessId);
    res.json(await deleteComment(client, (await nativePost(id, businessId, String(req.params.postId))).submission_id, commentParam.parse(String(req.params.commentId))));
  });
  // Deleting the published post: gone from the network; ConstructHUB keeps the record, without its link, saying so.
  route("delete", "/native/posts/:postId", async (req, res, id, businessId) => {
    const client = await direct(req, id, businessId);
    const p = await nativePost(id, businessId, String(req.params.postId));
    const { network } = await deletePost(client, p.submission_id);
    await pool.query("UPDATE social_posts SET public_url=NULL,error=$2,updated_at=now() WHERE id=$1", [p.id, `Deleted on ${network} from ConstructHUB on ${new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" })}.`]);
    res.json({ ok: true, network });
  });
  route("get", "/native/pending/:session", async (req, res, id, businessId) => res.json(await nativePending(id, businessId, z.string().regex(/^[\w-]{20,64}$/).parse(req.params.session))));
  route("post", "/native/pending/:session/finalize", async (req, res, id, businessId) => {
    const { pageIds } = z.object({ pageIds: z.array(z.string().regex(/^\d{1,40}$/)).min(1).max(50) }).strict().parse(req.body);
    res.json(await nativeFinalize(id, businessId, z.string().regex(/^[\w-]{20,64}$/).parse(req.params.session), pageIds, req));
  });
  // Back from the network's sign-in (ungated: an in-flight sign-in always lands; the session state proves it is ours).
  app.get("/api/social/native/callback", async (req: Request, res: Response) => {
    const user = auth(req, res); if (!user) return;
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, await nativeCallback(req, user.id));
  });
  // Instagram login, Threads and TikTok come back here (each registered as its app's redirect URI).
  for (const [path, api] of [["instagram", "ig_login"], ["threads", "threads"], ["tiktok", "tiktok"], ["x", "x"]] as const) {
    app.get(`/api/social/native/${path}/callback`, async (req: Request, res: Response) => {
      const user = auth(req, res); if (!user) return;
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, await nativeNetCallback(req, user.id, api));
    });
  }
  // The composer's file goes through us to our storage; the networks fetch it from its public address.
  app.put("/api/social/native/upload/:token", (req: Request, res: Response, next: () => void) => { if (auth(req, res)) next(); },
    express.raw({ type: () => true, limit: NATIVE_UPLOAD_MAX_BYTES }), async (req: Request, res: Response) => {
    const user = req.user!;
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json(await receiveUpload(String(req.params.token), user.id, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.get("content-type") ?? undefined, putToR2Key));
    } catch (e) {
      res.status(e instanceof SocialError ? e.status : 500).json({ message: e instanceof SocialError ? e.message : "The upload didn't work. Try again." });
    }
  });
  route("post", "/outstand/refresh", async (_req, res, id, businessId) => res.json(await outstandRefresh(id, businessId)));
  // Facebook / LinkedIn come back with a session: which pages may be connected, then the ones ticked.
  route("get", "/outstand/pending/:session", async (req, res) => res.json(await outstandPending(z.string().regex(/^[\w.-]{8,400}$/).parse(req.params.session))));
  route("post", "/outstand/pending/:session/finalize", async (req, res, id, businessId) => {
    const { pageIds } = z.object({ pageIds: z.array(z.string().regex(/^[\w:.-]{1,200}$/)).min(1).max(50) }).strict().parse(req.body);
    res.json(await outstandFinalize(id, businessId, z.string().regex(/^[\w.-]{8,400}$/).parse(req.params.session), pageIds, req));
  });
  route("post", "/disconnect", async (_req, res, id, businessId) =>
    res.json(await disconnect(id, _req, businessId)),
  );
  route("post", "/accounts/:id/pages", async (req, res, id, businessId) =>
    res.json(await discoverPages(id, opaqueId.parse(req.params.id), make, businessId)),
  );
  // The compose tab's "Post now" / "Schedule post" / "Save draft" buttons: creates the queued or draft
  // social posts for the chosen destinations.
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
  // The queue's per-post buttons: "Save edit" (draft stays a draft), "Approve & queue", "Cancel post".
  route("post", "/posts/:id/action", async (req, res, id, businessId) => {
    const body = postActionBody.parse(req.body);
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
  // Auto-posts settings (the schedule the worker publishes on) and on-demand AI
  // generation are the autoPosts module on top of the social tool.
  route("put", "/settings", async (req, res, id, businessId) => {
    if(!businessId)throw new SocialError("Choose a business");
    res.json(await saveSettings(id, req.body, businessId));
  }, [requireModule("autoPosts")]);
  route("post", "/generate", async(req,res,id,businessId)=>{
    if(!businessId)throw new SocialError("Choose a business");
    res.status(202).json(await enqueueBulk(id,{requestId:z.string().uuid().parse(req.body?.requestId),businessIds:[businessId],kind:'generate'}));
  }, [requireModule("autoPosts")]);
  route("get", "/media", async(req,res,id,businessId)=>{
    const q=pageInput.parse(req.query||{});
    const {rows}=await pool.query(businessId ? `SELECT m.name AS id,COALESCE(m.description,m.category,'Business photo') AS name,m.google_url AS url
      FROM gbp_media m JOIN business_locations l ON l.id=m.location_id WHERE l.user_id=$1 AND l.id=$2 AND m.source='business'
      AND COALESCE(m.description,m.category,'Business photo') ILIKE $3 ORDER BY m.create_time DESC NULLS LAST,m.name LIMIT $4 OFFSET $5`
      : "SELECT id,name,url FROM media_photos WHERE user_id=$1 AND name ILIKE $2 ORDER BY created_at DESC,id LIMIT $3 OFFSET $4",
      businessId?[id,businessId,`%${q.search}%`,q.limit,q.offset]:[id,`%${q.search}%`,q.limit,q.offset]);
    res.json(libraryMedia(rows));
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
    const up = await client.startUpload(filename, id);
    // ConstructHUB Direct knows the public address now; Outstand gives an upload id to confirm after the PUT (then the address).
    res.json({ publicUrl: up.publicUrl, presignedUrl: up.presignedUrl, ...(up.uploadId ? { uploadId: up.uploadId, contentType: up.contentType ?? null } : {}) });
  });
  // After the browser PUT the file: providers that hand out the public address only then (Outstand) confirm it here.
  route("post", "/uploads/:uploadId/confirm", async (req, res, id, businessId) => {
    const { client } = await connection(id, make, businessId);
    if (!client.confirmUpload) return res.status(400).json({ message: "Nothing to confirm for this upload." });
    res.json({ publicUrl: publicMediaUrl.parse(await client.confirmUpload(opaqueId.parse(req.params.uploadId))) });
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
