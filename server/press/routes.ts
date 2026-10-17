/**
 * Press Releases API (shared/press.ts). Signed-in account:
 *   GET   /api/press/overview                         packages, credits, orders, releases, setup state, pacing
 *   GET   /api/press/outlets?tier=budget|national|premium   the wire's outlet list for the tier (public lists, from the sheets)
 *   POST  /api/press/orders {tier, packageKey}        an order + Stripe Checkout (one-off) → {url}; packageKey single | program_12
 *   POST  /api/press/releases {tier, input}           a new release (needs a credit of that tier left)
 *   GET   /api/press/releases/:id
 *   PATCH /api/press/releases/:id {input?, text?}     edits; the guideline check runs again
 *   POST  /api/press/releases/:id/photos (multipart "photos", ≤4 × 15 MB)
 *   POST  /api/press/releases/:id/draft {notes?}      the AI writes (or revises to the notes)
 *   POST  /api/press/releases/:id/approve             spends the credit, queues it for the wire
 *   POST  /api/press/releases/:id/cancel              before it is sent; the credit comes back
 *   GET   /api/press/prefill                          the writer's company/contact fields from the account (ideas.ts)
 *   GET   /api/press/ideas                            up to 5 story ideas from the account's own data (ideas.ts)
 *   POST  /api/press/ideas/:key/dismiss               hides an idea for this user
 *   GET   /api/press/autopilot · PUT {enabled, dayOfMonth, sendForMe?}   the monthly draft setting (autopilot.ts)
 *   POST  /api/press/releases/:id/send-for-me {on}    schedule a clean draft to go out (send.ts), or stop it
 *   POST  /api/press/releases/:id/hold                stop a scheduled send
 *   GET   /api/press/share · PUT {social, gbp}        where a live release is shared (share.ts)
 *   GET   /api/public/press-hold?t= · POST {t}        the email's one-click Hold link: GET confirms, POST holds
 * Platform admins (requirePlatformAdmin):
 *   GET   /api/admin/press/summary · GET /api/admin/press/releases?status · GET /api/admin/press/messages?status
 *   POST  /api/admin/press/run {inbox?}               a pass now
 *   POST  /api/admin/press/releases/:id/live {url}    mark live by hand (an email the reader missed)
 *   POST  /api/admin/press/releases/:id/resend        send to the wire again
 *   POST  /api/admin/press/messages/:id/handled
 * The webhook side is fulfilPressCheckout (server/stripe.ts applyOneTimeCheckout).
 */
import express, { type Express, type Request, type Response } from "express";
import type Stripe from "stripe";
import multer from "multer";
import { z } from "zod";
import { stripe } from "../billing/client";
import { appReturnBaseUrl } from "../site-context";
import { rateLimit } from "../growth-limits";
import { requirePlatformAdmin } from "../crm/admin";
import { sendWithFallback } from "../email";
import { escapeHtml, firstZodMessage } from "../route-guards";
import { getFromR2, getR2Url, r2Configured, uploadToR2 } from "../r2";
import {
  PRESS_AUTOPILOT_MAX_DAY, PRESS_CHECKOUT_TYPE, PRESS_PACKAGES, PRESS_PATH, PRESS_RECOMMENDED_GAP_DAYS, PRESS_RELEASE_STATUSES, PRESS_TIERS,
  PRESS_TIER_LABEL, pressOrderName, pressPackage, pressPackagePrice, type PressReleaseInput, type PressTier,
} from "@shared/press";
import { checkRelease } from "./guidelines";
import { approveRelease } from "./approve";
import { pressInputSchema, writeDraft } from "./draft";
import { findIdeas, loadPrefill, markIdea } from "./ideas";
import { autopilotView, saveSettings } from "./autopilot";
import { holdSend, releaseHash, scheduleSend, verifyHoldToken } from "./send";
import { ShareSettingsError, saveShareSettings, shareSettings, shareWhenLive } from "./share";
import { loadOutlets } from "./outlets";
import { mailboxConfig, mailboxConfigured, wireConfigured } from "./mailbox";
import * as store from "./store";
import { pressWorkerConfig, runPressPass } from "./worker";
import { pressAiConfigured } from "./writer";
import { logError } from "../ops/log";

type Deps = { getOrCreateCustomer: (userId: number, email: string) => Promise<string>; sendStripeError: (res: Response, err: unknown) => void };
type GetUser = (req: any, res: any) => any;
/** The signed-in account (an agency member acts as the owner, as server/routes.ts getDevUser does); 401 otherwise. */
const defaultGetUser: GetUser = (req, res) => {
  const user = req.user;
  if (user) return res.locals?.agencyOwner ? { ...user, id: res.locals.agencyOwner } : user;
  res.status(401).json({ message: "Not authenticated" });
  return null;
};

const idParam = z.coerce.number().int().positive().max(2_147_483_647);
const tierSchema = z.enum(PRESS_TIERS as [PressTier, ...PressTier[]]);
const text = (max: number) => z.string().trim().max(max);
const inputSchema = pressInputSchema;
const textSchema = z.object({
  headline: text(200).min(10), subheadline: text(300), dateline: text(120), body: text(20_000).min(100), boilerplate: text(2000), mediaContact: text(1000),
}).strict();

const own = async (req: Request, res: Response, getUser: GetUser) => {
  const user = getUser(req, res);
  if (!user) return null;
  const id = idParam.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ message: "Bad id" }); return null; }
  const row = await store.getRelease(id.data);
  if (!row || row.user_id !== user.id) { res.status(404).json({ message: "Release not found" }); return null; }
  return { user, row };
};

/** A release as the page shows it, with where it was shared. */
const viewOf = async (r: store.ReleaseRow) => store.releaseView(r, (await store.sharesFor([r.id])).get(r.id) ?? []);

const setup = () => ({ ai: pressAiConfigured(), mailbox: mailboxConfigured(), wire: wireConfigured(), photos: r2Configured() });

export function registerPressRoutes(app: Express, deps: Deps, getUser: GetUser = defaultGetUser) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 4 }, fileFilter: (_r, f, cb) => cb(null, ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)) });

  // Inbound wire attachments are private (never on the public /api/files allow-list): platform admins only.
  app.get("/api/admin/press/attachments/:file", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const file = String(req.params.file ?? "");
    if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{1,32}$/i.test(file)) return res.status(404).json({ message: "File not found" });
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const { body, contentType } = await getFromR2(`press/inbox/${file}`, { abortSignal: ac.signal });
      if (!body) return res.status(404).json({ message: "File not found" });
      const stream = body as any;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Original-Content-Type", String(contentType || "").slice(0, 100));
      res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.on("close", () => stream.destroy?.());
      stream.on?.("error", () => res.destroy());
      stream.pipe(res);
    } catch (err: any) {
      if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Could not read the attachment" });
    }
  });

  app.get("/api/press/overview", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const [orders, releases, credits, last, autopilot] = await Promise.all([store.listOrders(user.id), store.listReleases(user.id), store.creditsLeft(user.id), store.lastSubmittedAt(user.id), autopilotView(user.id)]);
      const outlets = loadOutlets();
      res.json({
        packages: PRESS_PACKAGES,
        credits,
        orders: orders.map(store.orderView),
        releases: await (async () => { const sh = await store.sharesFor(releases.map((r) => r.id)); return releases.map((r) => store.releaseView(r, sh.get(r.id) ?? [])); })(),
        outletCounts: { budget: outlets.budget.length, national: outlets.national.length, premium: outlets.premium.length },
        setup: setup(),
        pacing: { lastSubmittedAt: last ? new Date(last).toISOString() : null, recommendedGapDays: PRESS_RECOMMENDED_GAP_DAYS },
        autopilot,
      });
    } catch (err) { logError("[press] overview:", err); res.status(500).json({ message: "Could not load your press releases" }); }
  });

  // Signed in only (owner, 2026-10-16: no scraping); the API paywall (server/platform-access.ts) adds the plan check.
  app.get("/api/press/outlets", (req, res) => {
    if (!getUser(req, res)) return;
    const tier = tierSchema.safeParse(req.query.tier);
    if (!tier.success) return res.status(400).json({ message: "tier must be budget, national or premium" });
    res.set("Cache-Control", "private, max-age=86400");
    res.json({ tier: tier.data, outlets: loadOutlets()[tier.data] });
  });

  app.post("/api/press/orders", rateLimit("press-order", 10, 30), async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ packageKey: z.string(), tier: tierSchema }).safeParse(req.body ?? {});
      const pkg = body.success ? pressPackage(body.data.packageKey) : undefined;
      if (!body.success || !pkg) return res.status(400).json({ message: "Pick Standard, National or Premium, and one release or the 12-month program" });
      const tier = body.data.tier;
      const amount = pressPackagePrice(pkg, tier);
      const order = await store.createOrder({ userId: user.id, email: user.email, packageKey: pkg.key, tier, credits: pkg.credits, amountCents: amount });
      const customer = await deps.getOrCreateCustomer(user.id, user.email);
      const session = await stripe.checkout.sessions.create({
        customer,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd", unit_amount: amount,
            product_data: { name: `Press Releases — ${pressOrderName(pkg, tier)}`, description: `${pkg.credits} press release${pkg.credits > 1 ? "s" : ""} on the ${PRESS_TIER_LABEL[tier]} distribution, written by ConstructHUB to the wire's guidelines. Credits are good for 12 months.`.slice(0, 500) },
          },
          quantity: 1,
        }],
        success_url: `${appReturnBaseUrl(req)}${PRESS_PATH}?paid=${order.id}`,
        cancel_url: `${appReturnBaseUrl(req)}${PRESS_PATH}?canceled=1`,
        metadata: { userId: String(user.id), type: PRESS_CHECKOUT_TYPE, pressOrderId: String(order.id), tier },
        payment_intent_data: { description: `ConstructHUB press releases #${order.id} (${pressOrderName(pkg, tier)})`, metadata: { pressOrderId: String(order.id) } },
      });
      await store.setCheckoutSession(order.id, session.id);
      res.json({ url: session.url, orderId: order.id });
    } catch (err) { deps.sendStripeError(res, err); }
  });

  app.post("/api/press/releases", rateLimit("press-release", 30, 60), async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ tier: tierSchema, input: inputSchema, ideaKey: text(200).optional() }).safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: firstZodMessage(body.error) });
      const credits = await store.creditsLeft(user.id);
      if (credits[body.data.tier] < 1) return res.status(402).json({ code: "no_credit", message: `You have no ${PRESS_TIER_LABEL[body.data.tier]} release credit left. Pick a package first.` });
      const row = await store.createRelease(user.id, body.data.tier, body.data.input as PressReleaseInput);
      // A release started from a story idea uses it up: it leaves the list and autopilot never drafts it again.
      if (body.data.ideaKey) await markIdea(user.id, body.data.ideaKey, "used", row.id);
      res.json(store.releaseView(row));
    } catch (err) { logError("[press] create release:", err); res.status(500).json({ message: "Could not start the release" }); }
  });

  app.get("/api/press/releases/:id", async (req, res) => {
    const found = await own(req, res, getUser);
    if (found) res.json(await viewOf(found.row));
  });

  app.patch("/api/press/releases/:id", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { row } = found;
      if (!["draft", "changes_requested"].includes(row.status)) return res.status(409).json({ message: `A release that is ${row.status.replace("_", " ")} cannot be edited` });
      const body = z.object({ input: inputSchema.optional(), text: textSchema.nullable().optional() }).safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: firstZodMessage(body.error) });
      const input = (body.data.input as PressReleaseInput | undefined) ?? row.input;
      const txt = body.data.text === undefined ? row.text : body.data.text;
      const issues = txt ? checkRelease(txt, input) : [];
      // An edit stops a scheduled "Send it for me": what goes out is only ever what was scheduled.
      const changed = releaseHash({ input, text: txt, tier: row.tier }) !== releaseHash(row);
      const stop = row.send_at && changed ? { send_at: null, send_for_me: false, send_note: "You edited it, so it will not go out on its own. Approve it, or turn on Send it for me again." } : {};
      const upd = await store.updateRelease(row.id, { input, text: txt, issues, ...stop });
      res.json(await viewOf(upd));
    } catch (err) { logError("[press] edit release:", err); res.status(500).json({ message: "Could not save" }); }
  });

  app.post("/api/press/releases/:id/photos", async (req, res) => {
    const found = await own(req, res, getUser);
    if (!found) return;
    if (!r2Configured()) return res.status(503).json({ message: "Photo storage is not available right now" });
    const { row } = found;
    if (!["draft", "changes_requested"].includes(row.status)) return res.status(409).json({ message: "Photos can be added before the release is sent" });
    upload.array("photos", 4)(req, res, async (err: unknown) => {
      if (err) return res.status(400).json({ message: "Photos must be JPEG, PNG or WebP, 15 MB or less, up to 4 at a time" });
      try {
        const files = ((req as any).files ?? []) as Express.Multer.File[];
        if (!files.length) return res.status(400).json({ message: "No photo received" });
        const photos = [...row.input.photos];
        for (const f of files.slice(0, Math.max(0, 6 - photos.length))) {
          const ext = f.mimetype === "image/png" ? "png" : f.mimetype === "image/webp" ? "webp" : "jpg";
          const key = await uploadToR2(f.buffer, f.mimetype, "press/photos", ext);
          photos.push({ key, url: getR2Url(key), caption: "" });
        }
        const upd = await store.updateRelease(row.id, { input: { ...row.input, photos } });
        res.json(store.releaseView(upd));
      } catch (e) { logError("[press] photo upload:", e); res.status(500).json({ message: "Could not store the photo" }); }
    });
  });

  app.post("/api/press/releases/:id/draft", rateLimit("press-draft", 20, 40), async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { row } = found;
      if (!["draft", "changes_requested"].includes(row.status)) return res.status(409).json({ message: "This release has already been sent" });
      if (!pressAiConfigured()) return res.status(503).json({ message: "The writer is not available right now. Please try again shortly." });
      const notes = z.object({ notes: text(2000).optional() }).safeParse(req.body ?? {});
      let upd = await writeDraft(row, notes.success ? notes.data.notes : undefined);
      if (row.send_at) upd = await store.updateRelease(row.id, { send_at: null, send_for_me: false, send_note: "Rewritten, so it will not go out on its own. Approve it, or turn on Send it for me again." });
      res.json(await viewOf(upd));
    } catch (err: any) { logError("[press] draft:", err); res.status(502).json({ message: `The writer could not finish: ${String(err?.message ?? err).slice(0, 200)}` }); }
  });

  app.post("/api/press/releases/:id/approve", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { user, row } = found;
      const out = await approveRelease(row, user.id);
      if (!out.ok) return res.status(out.status).json({ ...(out.code && out.code !== "state" && out.code !== "no_text" ? { code: out.code } : {}), message: out.message, ...(out.issues ? { issues: out.issues } : {}) });
      res.json(await viewOf(out.row));
    } catch (err) { logError("[press] approve:", err); res.status(500).json({ message: "Could not approve the release" }); }
  });

  app.post("/api/press/releases/:id/cancel", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { row } = found;
      if (!["draft", "ready", "changes_requested"].includes(row.status)) return res.status(409).json({ message: "A release that reached the wire cannot be cancelled here" });
      if (row.order_id) await store.refundCredit(row.id);
      res.json(await viewOf(await store.updateRelease(row.id, { status: "cancelled", send_at: null, send_for_me: false })));
    } catch (err) { logError("[press] cancel:", err); res.status(500).json({ message: "Could not cancel" }); }
  });

  // ---- automation (ideas.ts, autopilot.ts) ------------------------------------------------------------------

  app.get("/api/press/prefill", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      res.json(await loadPrefill(user.id));
    } catch (err) { logError("[press] prefill:", err); res.status(500).json({ message: "Could not read your account details" }); }
  });

  app.get("/api/press/ideas", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      res.json({ ideas: await findIdeas(user.id) });
    } catch (err) { logError("[press] ideas:", err); res.status(500).json({ message: "Could not look for story ideas" }); }
  });

  app.post("/api/press/ideas/:key/dismiss", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const key = z.string().trim().min(1).max(200).regex(/^[a-z]+:[A-Za-z0-9:_-]+$/).safeParse(req.params.key);
      if (!key.success) return res.status(400).json({ message: "Bad idea" });
      await markIdea(user.id, key.data, "dismissed");
      res.json({ ok: true });
    } catch (err) { logError("[press] dismiss idea:", err); res.status(500).json({ message: "Could not dismiss the idea" }); }
  });

  app.get("/api/press/autopilot", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      res.json(await autopilotView(user.id));
    } catch (err) { logError("[press] autopilot:", err); res.status(500).json({ message: "Could not read the autopilot setting" }); }
  });

  app.put("/api/press/autopilot", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ enabled: z.boolean(), dayOfMonth: z.number().int().min(1).max(PRESS_AUTOPILOT_MAX_DAY), sendForMe: z.boolean().optional() }).strict().safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: `Pick a day from 1 to ${PRESS_AUTOPILOT_MAX_DAY}` });
      if (body.data.enabled || body.data.sendForMe) {
        const credits = await store.creditsLeft(user.id);
        if (!PRESS_TIERS.some((t) => credits[t] > 0)) return res.status(402).json({ code: "no_credit", message: body.data.sendForMe ? "Send it for me needs a release credit. Pick a package first." : "Autopilot needs a release credit. Pick a package first." });
      }
      await saveSettings(user.id, body.data);
      res.json(await autopilotView(user.id));
    } catch (err) { logError("[press] save autopilot:", err); res.status(500).json({ message: "Could not save the autopilot setting" }); }
  });

  // ---- send it for me (send.ts) ------------------------------------------------------------------------------

  app.post("/api/press/releases/:id/send-for-me", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const on = z.object({ on: z.boolean() }).safeParse(req.body ?? {});
      if (!on.success) return res.status(400).json({ message: "on must be true or false" });
      if (!on.data.on) { await holdSend(found.row.id, { userId: found.user.id }); return res.json(await viewOf((await store.getRelease(found.row.id))!)); }
      const out = await scheduleSend(found.row);
      if (!out.scheduled) return res.status(out.why === "no_credit" ? 402 : 409).json({ code: out.why, message: out.message, ...(out.issues ? { issues: out.issues } : {}) });
      res.json(await viewOf(out.row));
    } catch (err) { logError("[press] send for me:", err); res.status(500).json({ message: "Could not schedule it" }); }
  });

  app.post("/api/press/releases/:id/hold", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      await holdSend(found.row.id, { userId: found.user.id });
      res.json(await viewOf((await store.getRelease(found.row.id))!));
    } catch (err) { logError("[press] hold:", err); res.status(500).json({ message: "Could not hold it" }); }
  });

  // The one-click Hold link from the bell and the email: no sign-in, a signed token that expires at the send time.
  // GET only shows a confirm button (mail scanners open links); POST holds.
  const holdPage = (title: string, body: string, form?: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} | ConstructHUB</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#111827;margin:0;padding:48px 16px}main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 8px}p{font-size:15px;line-height:1.5;color:#374151}button{font:inherit;font-weight:600;background:#1a73e8;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}a{color:#1a73e8}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${body}</p>${form ?? ""}<p><a href="${PRESS_PATH}">Open Press Releases</a></p></main></body></html>`;
  app.get("/api/public/press-hold", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const t = String(req.query.t ?? "");
    const tok = verifyHoldToken(t);
    const row = tok ? await store.getRelease(tok.releaseId) : null;
    if (!tok || !row) return res.status(410).type("html").send(holdPage("This link has expired", "The send time has passed or the link is not valid. Open Press Releases to see the release."));
    if (!row.send_at) return res.type("html").send(holdPage("Nothing to hold", "This release is not scheduled to go out on its own any more."));
    res.type("html").send(holdPage("Hold this press release?", `&ldquo;${escapeHtml(row.text?.headline ?? row.code)}&rdquo; is scheduled to go to the wire. Holding it keeps it as a draft; nothing is sent and no credit is used until you approve it.`,
      `<form method="post" action="/api/public/press-hold"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit">Hold it</button></form>`));
  });
  app.post("/api/public/press-hold", express.urlencoded({ extended: false, limit: "4kb" }), rateLimit("press-hold", 30, 10), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tok = verifyHoldToken(String(req.body?.t ?? ""));
    if (!tok) return res.status(410).type("html").send(holdPage("This link has expired", "The send time has passed or the link is not valid. Open Press Releases to see the release."));
    const held = await holdSend(tok.releaseId, { sendAt: tok.sendAt });
    res.type("html").send(held ? holdPage("Held", "It will not go out on its own. It stays a draft until you approve it.") : holdPage("Nothing to hold", "This release is not scheduled to go out on its own any more."));
  });

  // ---- auto-share when live (share.ts) ----------------------------------------------------------------------

  app.get("/api/press/share", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      res.json(await shareSettings(user.id));
    } catch (err) { logError("[press] share settings:", err); res.status(500).json({ message: "Could not read where releases are shared" }); }
  });
  app.put("/api/press/share", async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ social: z.array(z.string().max(500)).max(20), gbp: z.array(z.number().int().positive()).max(50) }).strict().safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Choose up to 20 social accounts and 50 Google profiles" });
      res.json(await saveShareSettings(user.id, body.data));
    } catch (err) {
      if (err instanceof ShareSettingsError) return res.status(err.status).json({ message: err.message });
      logError("[press] save share settings:", err); res.status(500).json({ message: "Could not save where releases are shared" });
    }
  });

  // ---- admin ------------------------------------------------------------------------------------------------

  app.get("/api/admin/press/summary", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const cfg = pressWorkerConfig();
    const state = mailboxConfigured() ? await store.getState(mailboxConfig().user) : null;
    res.json({ setup: setup(), mailbox: mailboxConfigured() ? mailboxConfig().user : null, wireTo: mailboxConfig().wireTo || null, inboxHours: cfg.inboxHours, submitMinutes: cfg.submitMinutes, lastPassAt: state?.last_pass_at ?? null, lastPassError: state?.last_pass_error ?? null, counts: await store.counts() });
  });
  app.get("/api/admin/press/releases", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const status = z.enum(PRESS_RELEASE_STATUSES).optional().safeParse(req.query.status || undefined);
    const rows = await store.listAllReleases(status.success ? status.data : undefined);
    res.json({ rows: rows.map((r) => ({ ...store.releaseView(r), email: r.email, lastError: r.last_error, attempts: r.attempts })) });
  });
  app.get("/api/admin/press/messages", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const q = z.object({ status: z.enum(["new", "applied", "needs_owner", "ignored", "failed"]).optional(), releaseId: idParam.optional() }).safeParse(req.query);
    const rows = await store.listMessages({ status: q.success ? q.data.status : undefined, releaseId: q.success ? q.data.releaseId : undefined, limit: 200 });
    res.json({ rows });
  });
  app.post("/api/admin/press/run", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    res.json(await runPressPass({ inbox: req.body?.inbox !== false }));
  });
  app.post("/api/admin/press/releases/:id/live", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const id = idParam.safeParse(req.params.id); const body = z.object({ url: z.string().url().max(500) }).safeParse(req.body ?? {});
    if (!id.success || !body.success) return res.status(400).json({ message: "A release id and a live URL are required" });
    const row = await store.getRelease(id.data);
    if (!row) return res.status(404).json({ message: "Not found" });
    const upd = await store.updateRelease(row.id, { status: row.status === "reported" ? "reported" : "live", live_url: body.data.url, live_at: row.live_at ?? new Date(), last_error: null });
    await shareWhenLive(upd.id);
    res.json(await viewOf(upd));
  });
  app.post("/api/admin/press/releases/:id/resend", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const id = idParam.safeParse(req.params.id);
    const row = id.success ? await store.getRelease(id.data) : null;
    if (!row) return res.status(404).json({ message: "Not found" });
    if (!row.text) return res.status(400).json({ message: "No text" });
    await store.updateRelease(row.id, { status: "ready", last_error: null });
    res.json(await runPressPass({ inbox: false }));
  });
  app.post("/api/admin/press/messages/:id/handled", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getUser))) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Bad id" });
    await store.setMessage(id.data, { status: "applied", reason: "Handled by hand" });
    res.json({ ok: true });
  });
}

/**
 * The webhook side (checkout.session.completed / async_payment_succeeded): a paid press package marks its order paid
 * once (credits good for 12 months) and tells the team. Only Stripe's paid status counts, never the metadata alone.
 */
export async function fulfilPressCheckout(session: Stripe.Checkout.Session, _userId: number): Promise<void> {
  if (session.metadata?.type !== PRESS_CHECKOUT_TYPE || session.mode !== "payment" || session.payment_status !== "paid") return;
  const id = Number.parseInt(session.metadata?.pressOrderId ?? "", 10);
  if (!Number.isInteger(id)) throw new Error(`[press] checkout ${session.id} has no press order id`);
  const order = await store.getOrder(id);
  if (!order) throw new Error(`[press] checkout ${session.id}: order ${id} not found`);
  if (order.amount_cents !== session.amount_total) console.error(`[press] order ${id}: paid ${session.amount_total} for a ${order.amount_cents} order`);
  if (!(await store.markPaid(id, session.id))) return;
  console.log(`[press] order ${id} paid: ${order.credits} ${order.tier} credit(s)`);
  await sendWithFallback({
    from: `"ConstructHUB" <${process.env.SMTP_EMAIL}>`, to: process.env.SMTP_EMAIL, replyTo: order.email,
    subject: `Press package sold #${id}: ${pressOrderName(pressPackage(order.package_key), order.tier)}`,
    html: `<p>${escapeHtml(order.email)} bought ${order.credits} ${escapeHtml(order.tier)} release credit(s) for $${(order.amount_cents / 100).toLocaleString("en-US")}.</p>`,
  }).catch(() => undefined);
}
