/**
 * Press Releases API (shared/press.ts). Signed-in account:
 *   GET   /api/press/overview                         packages, credits, orders, releases, setup state, pacing
 *   GET   /api/press/outlets?tier=budget|premium      the wire's outlet list for the tier (public lists, from the sheets)
 *   POST  /api/press/orders {packageKey, tier?}       an order + Stripe Checkout (one-off) → {url}
 *   POST  /api/press/releases {tier, input}           a new release (needs a credit of that tier left)
 *   GET   /api/press/releases/:id
 *   PATCH /api/press/releases/:id {input?, text?}     edits; the guideline check runs again
 *   POST  /api/press/releases/:id/photos (multipart "photos", ≤4 × 15 MB)
 *   POST  /api/press/releases/:id/draft {notes?}      the AI writes (or revises to the notes)
 *   POST  /api/press/releases/:id/approve             spends the credit, queues it for the wire
 *   POST  /api/press/releases/:id/cancel              before it is sent; the credit comes back
 * Platform admins (requirePlatformAdmin):
 *   GET   /api/admin/press/summary · GET /api/admin/press/releases?status · GET /api/admin/press/messages?status
 *   POST  /api/admin/press/run {inbox?}               a pass now
 *   POST  /api/admin/press/releases/:id/live {url}    mark live by hand (an email the reader missed)
 *   POST  /api/admin/press/releases/:id/resend        send to the wire again
 *   POST  /api/admin/press/messages/:id/handled
 * The webhook side is fulfilPressCheckout (server/stripe.ts applyOneTimeCheckout).
 */
import type { Express, Request, Response } from "express";
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
  PRESS_CHECKOUT_TYPE, PRESS_NEWS_TYPES, PRESS_PACKAGES, PRESS_PATH, PRESS_RECOMMENDED_GAP_DAYS, PRESS_RELEASE_STATUSES, PRESS_TIERS,
  pressPackage, pressPackagePrice, pressPackageTier, type PressReleaseInput, type PressReleaseText, type PressTier,
} from "@shared/press";
import { checkRelease, hasBlockingIssue } from "./guidelines";
import { loadOutlets } from "./outlets";
import { mailboxConfig, mailboxConfigured, wireConfigured } from "./mailbox";
import * as store from "./store";
import { pressWorkerConfig, runPressPass } from "./worker";
import { datelineFor, draftRelease, pressAiConfigured, reviseRelease } from "./writer";
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
const inputSchema = z.object({
  newsType: z.enum(PRESS_NEWS_TYPES.map((t) => t.key) as [string, ...string[]]),
  companyName: text(120).min(2, "Company name is required"),
  website: text(300).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Website must start with http:// or https://"),
  city: text(80).min(2, "City is required"),
  state: text(40).min(2, "State is required"),
  contactName: text(120).min(2, "Media contact name is required"),
  contactEmail: text(200).email("A valid media contact email is required"),
  contactPhone: text(40),
  details: text(6000).min(80, "Tell us what happened in at least a few sentences (80 characters or more)"),
  spokesperson: text(120),
  spokespersonTitle: text(120),
  quoteNotes: text(2000),
  about: text(3000),
  photos: z.array(z.object({ key: text(300), url: text(500), caption: text(200) })).max(6).default([]),
}).strict();
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
      const [orders, releases, credits, last] = await Promise.all([store.listOrders(user.id), store.listReleases(user.id), store.creditsLeft(user.id), store.lastSubmittedAt(user.id)]);
      const outlets = loadOutlets();
      res.json({
        packages: PRESS_PACKAGES,
        credits,
        orders: orders.map(store.orderView),
        releases: releases.map(store.releaseView),
        outletCounts: { budget: outlets.budget.length, premium: outlets.premium.length },
        setup: setup(),
        pacing: { lastSubmittedAt: last ? new Date(last).toISOString() : null, recommendedGapDays: PRESS_RECOMMENDED_GAP_DAYS },
      });
    } catch (err) { logError("[press] overview:", err); res.status(500).json({ message: "Could not load your press releases" }); }
  });

  app.get("/api/press/outlets", (req, res) => {
    const tier = tierSchema.safeParse(req.query.tier);
    if (!tier.success) return res.status(400).json({ message: "tier must be budget or premium" });
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ tier: tier.data, outlets: loadOutlets()[tier.data] });
  });

  app.post("/api/press/orders", rateLimit("press-order", 10, 30), async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ packageKey: z.string(), tier: tierSchema.optional() }).safeParse(req.body ?? {});
      const pkg = body.success ? pressPackage(body.data.packageKey) : undefined;
      if (!body.success || !pkg) return res.status(400).json({ message: "Pick one of the three packages" });
      if (pkg.tier === "choose" && !body.data.tier) return res.status(400).json({ message: "Choose Wire or Premium for the program" });
      const tier = pressPackageTier(pkg, body.data.tier ?? "budget");
      const amount = pressPackagePrice(pkg, tier);
      const order = await store.createOrder({ userId: user.id, email: user.email, packageKey: pkg.key, tier, credits: pkg.credits, amountCents: amount });
      const customer = await deps.getOrCreateCustomer(user.id, user.email);
      const session = await stripe.checkout.sessions.create({
        customer,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd", unit_amount: amount,
            product_data: { name: `Press Releases — ${pkg.name}${pkg.tier === "choose" ? ` (${tier === "premium" ? "Premium" : "Wire"})` : ""}`, description: `${pkg.credits} press release${pkg.credits > 1 ? "s" : ""} on the ${tier === "premium" ? "Premium" : "Wire"} distribution, written by ConstructHUB to the wire's guidelines. Credits are good for 12 months.`.slice(0, 500) },
          },
          quantity: 1,
        }],
        success_url: `${appReturnBaseUrl(req)}${PRESS_PATH}?paid=${order.id}`,
        cancel_url: `${appReturnBaseUrl(req)}${PRESS_PATH}?canceled=1`,
        metadata: { userId: String(user.id), type: PRESS_CHECKOUT_TYPE, pressOrderId: String(order.id), tier },
        payment_intent_data: { description: `ConstructHUB press releases #${order.id} (${pkg.name})`, metadata: { pressOrderId: String(order.id) } },
      });
      await store.setCheckoutSession(order.id, session.id);
      res.json({ url: session.url, orderId: order.id });
    } catch (err) { deps.sendStripeError(res, err); }
  });

  app.post("/api/press/releases", rateLimit("press-release", 30, 60), async (req, res) => {
    try {
      const user = getUser(req, res);
      if (!user) return;
      const body = z.object({ tier: tierSchema, input: inputSchema }).safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: firstZodMessage(body.error) });
      const credits = await store.creditsLeft(user.id);
      if (credits[body.data.tier] < 1) return res.status(402).json({ code: "no_credit", message: `You have no ${body.data.tier === "premium" ? "Premium" : "Wire"} release credit left. Pick a package first.` });
      const row = await store.createRelease(user.id, body.data.tier, body.data.input as PressReleaseInput);
      res.json(store.releaseView(row));
    } catch (err) { logError("[press] create release:", err); res.status(500).json({ message: "Could not start the release" }); }
  });

  app.get("/api/press/releases/:id", async (req, res) => {
    const found = await own(req, res, getUser);
    if (found) res.json(store.releaseView(found.row));
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
      const upd = await store.updateRelease(row.id, { input, text: txt, issues });
      res.json(store.releaseView(upd));
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
      const want = notes.success ? notes.data.notes?.trim() : "";
      const t: PressReleaseText = want && row.text ? await reviseRelease(row.input, row.text, want, row.tier) : await draftRelease(row.input, row.tier);
      if (!t.dateline) t.dateline = datelineFor(row.input.city, row.input.state);
      const issues = checkRelease(t, row.input);
      const upd = await store.updateRelease(row.id, { text: t, issues });
      res.json(store.releaseView(upd));
    } catch (err: any) { logError("[press] draft:", err); res.status(502).json({ message: `The writer could not finish: ${String(err?.message ?? err).slice(0, 200)}` }); }
  });

  app.post("/api/press/releases/:id/approve", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { user, row } = found;
      if (!["draft", "changes_requested"].includes(row.status)) return res.status(409).json({ message: "This release is already on its way" });
      if (!row.text) return res.status(400).json({ message: "Write the release first" });
      const issues = checkRelease(row.text, row.input);
      if (hasBlockingIssue(issues)) { await store.updateRelease(row.id, { issues }); return res.status(409).json({ code: "guidelines", message: "Fix the flagged guideline problems first; the wire's editors would refuse it.", issues }); }
      // A resend after requested changes keeps its credit; a first approval takes one.
      if (!row.order_id && !(await store.spendCredit(row.id, user.id, row.tier))) {
        return res.status(402).json({ code: "no_credit", message: `No ${row.tier === "premium" ? "Premium" : "Wire"} credit left. Pick a package to send it.` });
      }
      const upd = await store.updateRelease(row.id, { status: "ready", issues, last_error: null });
      void runPressPass({ inbox: false }).catch((e) => logError("[press] pass after approve:", e));
      res.json(store.releaseView(upd));
    } catch (err) { logError("[press] approve:", err); res.status(500).json({ message: "Could not approve the release" }); }
  });

  app.post("/api/press/releases/:id/cancel", async (req, res) => {
    try {
      const found = await own(req, res, getUser);
      if (!found) return;
      const { row } = found;
      if (!["draft", "ready", "changes_requested"].includes(row.status)) return res.status(409).json({ message: "A release that reached the wire cannot be cancelled here" });
      if (row.order_id) await store.refundCredit(row.id);
      res.json(store.releaseView(await store.updateRelease(row.id, { status: "cancelled" })));
    } catch (err) { logError("[press] cancel:", err); res.status(500).json({ message: "Could not cancel" }); }
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
    res.json(store.releaseView(await store.updateRelease(row.id, { status: row.status === "reported" ? "reported" : "live", live_url: body.data.url, live_at: row.live_at ?? new Date(), last_error: null })));
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
    subject: `Press package sold #${id}: ${pressPackage(order.package_key)?.name ?? order.package_key} (${order.tier})`,
    html: `<p>${escapeHtml(order.email)} bought ${order.credits} ${escapeHtml(order.tier)} release credit(s) for $${(order.amount_cents / 100).toLocaleString("en-US")}.</p>`,
  }).catch(() => undefined);
}
