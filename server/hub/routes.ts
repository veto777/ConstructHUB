/**
 * Hub HTTP routes (guardrails §2, §5). Everything is injected (model client,
 * budgets, stats, preset store), so this file imports no database and the
 * route tests run against a stub model.
 *
 *   GET  /api/hub/presets   chip list + this visitor's tier (browse | builder)
 *   POST /api/hub/preset    { presetId }  — anyone; cached/template answer, never a per-request model call
 *   POST /api/hub/chat      { conversationId?, messages, pageKey? } — signed-in (builder) only
 *
 * The routes catch every error themselves (the global handler never sees a Hub
 * error) and log only "hub: <outcome> <reason> <ms>".
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { PAGE_KEYS, type PageKey } from "@shared/hub-links";
import { HUB_PRESETS, PRESET_IDS, PRIMARY_PRESETS, WELCOME_PRESETS, type PresetId } from "@shared/hub-presets";
import { prefilter } from "./prefilter";
import { appAnswerBlocked, appPrefilterOverride, appSalesQuestion, APP_SALES_PRESETS, hubAppRequest } from "./app-guard";
import { buildMessages, buildPresetMessages, buildRequest, knowledgeHash, type VisitorTurn } from "./prompt";
import { filterOutput } from "./output-filter";
import { REPLIES, replyText } from "./replies";
import { checkConversation, signTurn, type InTurn } from "./turns";
import { Breaker, HUB_LIMITS, Semaphore, globalDailyCap, keys, maxConcurrency, type Budget } from "./limits";
import { latencyBucket, logError, logLine, type HubOutcome, type HubTier, type StatsSink } from "./stats";
import { requiredFactsOk, templateAnswer, appTemplateAnswer, presetList, type PresetStore } from "./presets";
import type { HubAi, HubCompletion } from "./ai";

export type HubDeps = {
  ai: () => HubAi;
  budget: Budget;
  stats: StatsSink;
  presets: PresetStore;
  model: () => string;
  providerOk: () => boolean;
  timeoutMs: () => number;
  ipKey: (req: Request) => string;
  /** Same-origin / known-host check for state-changing requests. */
  originOk: (req: Request) => boolean;
  /** Signed in with a verified email (or the local dev bypass). */
  isBuilder: (req: Request) => boolean;
  now?: () => number;
};

const MAX_USER_CHARS = 500;
const MAX_TOTAL_CHARS = 4000;

const userTurn = z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(MAX_USER_CHARS) }).strict();
// index/sig are optional here so a forged (unsigned) assistant turn is answered as
// "tampered" by the signature check rather than as a generic schema error.
const assistantTurn = z.object({
  role: z.literal("assistant"),
  content: z.string().min(1).max(1500),
  index: z.number().int().min(1).max(999).optional(),
  sig: z.string().max(128).optional(),
}).strict();
export const chatBody = z.object({
  conversationId: z.string().uuid().optional(),
  messages: z.array(z.discriminatedUnion("role", [userTurn, assistantTurn])).min(1).max(12),
  pageKey: z.enum(PAGE_KEYS).optional(),
}).strict().refine((b) => b.messages.reduce((n, m) => n + m.content.length, 0) <= MAX_TOTAL_CHARS, { message: "too long" });
export const presetBody = z.object({ presetId: z.enum(PRESET_IDS) }).strict();

type Upstream = { ok: true; completion: HubCompletion; ms: number } | { ok: false; kind: "timeout" | "upstream" | "client"; ms: number };

export function createHub(deps: HubDeps) {
  const now = deps.now ?? Date.now;
  const breaker = new Breaker(3, 60_000, now);
  const semaphore = new Semaphore(maxConcurrency);
  const memo = new Map<string, string>();
  const generating = new Map<string, Promise<void>>();

  const tierOf = (req: Request): HubTier => (deps.isBuilder(req) ? "builder" : "browse");
  const note = (tier: HubTier, outcome: HubOutcome, reason: string, started: number) => {
    try { deps.stats.record(tier, outcome, reason); } catch { /* stats never break a reply */ }
    logLine(outcome, reason, now() - started);
  };

  /** One model call with a hard timeout. Counts toward the breaker; never retried. */
  async function callModel(body: ReturnType<typeof buildRequest>): Promise<Upstream> {
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs());
    try {
      const completion = await Promise.race([
        deps.ai().complete(body, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "HubTimeout" })))),
      ]);
      breaker.success();
      return { ok: true, completion, ms: now() - started };
    } catch (err: any) {
      const timedOut = controller.signal.aborted || /timeout/i.test(String(err?.name ?? ""));
      const status = Number(err?.status);
      const kind = timedOut ? "timeout" : Number.isFinite(status) && status >= 400 && status < 500 ? "client" : "upstream";
      if (kind !== "client") breaker.failure();
      logError(`model_${kind}`, err);
      return { ok: false, kind, ms: now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- presets

  const cacheKey = (presetId: PresetId, hash: string) => `${presetId}:${hash}`;

  /** Generate, filter, fact-check and store one preset answer (single-flight per key). */
  function generatePreset(presetId: PresetId): Promise<void> {
    const hash = knowledgeHash(deps.model());
    const key = cacheKey(presetId, hash);
    const running = generating.get(key);
    if (running) return running;
    const job = (async () => {
      const started = now();
      try {
        if (!deps.providerOk() || breaker.isOpen()) return;
        if (!(await deps.budget.take(keys.presetGen(presetId, hash), HUB_LIMITS.presetGeneration.limit, HUB_LIMITS.presetGeneration.windowMs))) return;
        const release = semaphore.tryAcquire(`preset:${presetId}`);
        if (!release) return;
        try {
          const result = await callModel(buildRequest(deps.model(), buildPresetMessages(presetId)));
          if (!result.ok) return;
          const filtered = filterOutput(result.completion, { publicOnly: true });
          if (!filtered.ok) { logLine("warm", filtered.code, now() - started); return; }
          if (!requiredFactsOk(presetId, filtered.text)) { logLine("warm", "facts", now() - started); return; }
          await deps.presets.put(presetId, hash, filtered.text);
          memo.set(key, filtered.text);
          logLine("warm", "stored", now() - started);
        } finally { release(); }
      } catch (err) {
        logError("preset_gen", err);
      } finally {
        generating.delete(key);
      }
    })();
    generating.set(key, job);
    return job;
  }

  /** The answer for a preset: a filtered cached model answer, else the template (and a background generation). */
  async function presetAnswer(presetId: PresetId): Promise<{ kind: "answer" | "template"; text: string }> {
    if (deps.providerOk()) {
      const hash = knowledgeHash(deps.model());
      const key = cacheKey(presetId, hash);
      let cached = memo.get(key) ?? null;
      if (cached === null) {
        try { cached = await deps.presets.get(presetId, hash); } catch (err) { logError("preset_get", err); }
        if (cached !== null) memo.set(key, cached);
      }
      if (cached !== null) {
        const filtered = filterOutput({ content: cached, finishReason: "stop" }, { publicOnly: true });
        if (filtered.ok && requiredFactsOk(presetId, filtered.text)) return { kind: "answer", text: filtered.text };
        memo.delete(key); // never serve a cached answer that fails today's filter; try a fresh one
        void generatePreset(presetId);
      } else {
        void generatePreset(presetId);
      }
    }
    return { kind: "template", text: templateAnswer(presetId) };
  }

  /** Warm every preset in the background, one at a time. */
  async function warm(): Promise<void> {
    for (const id of PRESET_IDS) {
      const hash = knowledgeHash(deps.model());
      try {
        const stored = memo.get(cacheKey(id, hash)) ?? (await deps.presets.get(id, hash));
        if (stored !== null && stored !== undefined) { memo.set(cacheKey(id, hash), stored); continue; }
      } catch (err) { logError("preset_get", err); }
      await generatePreset(id);
    }
  }

  // ---------------------------------------------------------------- routes

  const router = Router();
  router.use("/api/hub", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  /** JSON body + same-origin for every POST; refused before any budget is touched. */
  const guard = (req: Request, res: Response): boolean => {
    if (!req.is("application/json")) { res.status(415).json({ message: "Send JSON." }); return false; }
    if (!deps.originOk(req)) { res.status(403).json({ message: "Forbidden" }); return false; }
    return true;
  };

  router.get("/api/hub/presets", (req, res) => {
    const builder = deps.isBuilder(req);
    // The iPhone apps sell nothing (App Store 3.1.3(f)): the chip list there drops the
    // questions whose answer is plans/pricing/buying ("How much does it cost?", "talk to
    // sales"…). Tapping one still gets the fixed line (POST /preset), so old app builds
    // that cached the list stay safe.
    if (hubAppRequest(req.get("user-agent"))) {
      const presets = presetList().filter((p) => !APP_SALES_PRESETS.has(p.id));
      return void res.json({
        presets,
        primary: PRIMARY_PRESETS.filter((id) => !APP_SALES_PRESETS.has(id)),
        welcome: WELCOME_PRESETS.filter((id) => !APP_SALES_PRESETS.has(id)),
        tier: builder ? "builder" : "browse",
        chat: builder && deps.providerOk(),
        maxChars: MAX_USER_CHARS,
      });
    }
    res.json({
      presets: presetList(),
      primary: PRIMARY_PRESETS,
      welcome: WELCOME_PRESETS,
      tier: builder ? "builder" : "browse",
      chat: builder && deps.providerOk(),
      maxChars: MAX_USER_CHARS,
    });
  });

  router.post("/api/hub/preset", async (req, res) => {
    const started = now();
    const tier = tierOf(req);
    try {
      if (!guard(req, res)) return;
      const parsed = presetBody.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ message: "Unknown question." });
      const { presetId } = parsed.data;
      if (!(await deps.budget.take(keys.presetIp(deps.ipKey(req)), HUB_LIMITS.presetPerIp.limit, HUB_LIMITS.presetPerIp.windowMs))) {
        note(tier, "limit", "preset_ip", started);
        res.setHeader("Retry-After", String(Math.ceil(HUB_LIMITS.presetPerIp.windowMs / 1000)));
        return void res.status(429).json({ reply: REPLIES.R_SLOWDOWN, code: "slowdown" });
      }
      // The iPhone apps sell nothing (App Store 3.1.3(f)): a sales preset gets the one fixed
      // answer — never the template, never a cached model answer (those quote the price book).
      if (hubAppRequest(req.get("user-agent"))) {
        if (APP_SALES_PRESETS.has(presetId)) {
          note(tier, "preset_template", "app_pricing", started);
          return void res.json({ presetId, question: HUB_PRESETS[presetId].label, reply: REPLIES.R_APP_PRICING, kind: "template" });
        }
        const answer = { kind: "template" as const, text: appTemplateAnswer(presetId) };
        note(tier, "preset_template", "-", started);
        return void res.json({ presetId, question: HUB_PRESETS[presetId].label, reply: answer.text, kind: answer.kind });
      }
      const answer = await presetAnswer(presetId);
      note(tier, answer.kind === "answer" ? "preset_hit" : "preset_template", "-", started);
      res.json({ presetId, question: HUB_PRESETS[presetId].label, reply: answer.text, kind: answer.kind });
    } catch (err) {
      logError("preset", err);
      if (!res.headersSent) res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" });
    }
  });

  router.post("/api/hub/chat", async (req, res) => {
    const started = now();
    const tier = tierOf(req);
    try {
      // 1. CSRF / Origin + content type
      if (!guard(req, res)) return;
      // 2. schema
      const parsed = chatBody.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ message: "Messages must be 1–500 characters (12 messages, 4,000 characters in all)." });
      // 3. auth / tier
      if (!req.user) return void res.status(401).json({ presetsOnly: true, reply: REPLIES.R_SIGNIN });
      if (tier !== "builder") return void res.status(403).json({ presetsOnly: true, reply: REPLIES.R_SIGNIN, code: "verify_email" });
      const userId = Number((req.user as { id: number }).id);
      const { messages, pageKey } = parsed.data;
      const inApp = hubAppRequest(req.get("user-agent"));

      // 4. turn signatures
      const convo = checkConversation(userId, parsed.data.conversationId, messages as InTurn[]);
      if (!convo.ok) { note(tier, "tampered", "sig", started); return void res.status(400).json({ code: "tampered", message: "This chat can't continue. Start a new one." }); }
      if (convo.capped) { note(tier, "limit", "convo_cap", started); return void res.json({ reply: REPLIES.R_CONVO_CAP, code: "convo_cap", reset: true }); }
      if (!deps.providerOk()) { note(tier, "offline", "provider", started); return void res.status(503).json({ reply: inApp ? REPLIES.R_APP_OFFLINE : REPLIES.R_OFFLINE, code: "offline" }); }

      // 5. per-minute (before the pre-filter, so probing is throttled too)
      if (!(await deps.budget.take(keys.minute(userId), HUB_LIMITS.chatPerMinute.limit, HUB_LIMITS.chatPerMinute.windowMs))) {
        note(tier, "limit", "minute", started);
        res.setHeader("Retry-After", "60");
        return void res.status(429).json({ reply: REPLIES.R_SLOWDOWN, code: "slowdown" });
      }
      // 6. refusal cooldown
      if ((await deps.budget.used(keys.refusals(userId), HUB_LIMITS.refusalsPerDay.windowMs)) >= HUB_LIMITS.refusalsPerDay.limit) {
        note(tier, "limit", "refusals", started);
        return void res.status(429).json({ reply: REPLIES.R_LIMIT, code: "limit" });
      }

      const newMessage = messages[messages.length - 1].content;
      const signed = (reply: string, kind: "answer" | "refusal" | "fallback") => {
        const index = convo.newIndex + 1;
        res.json({ reply, kind, conversationId: convo.conversationId, index, sig: signTurn(userId, convo.conversationId, index, reply, newMessage) });
      };

      // 6.5 — the iPhone apps sell nothing (App Store 3.1.3(f)): a price / plan / buying question
      // gets one fixed answer, deterministically — the model (its knowledge pack holds the price
      // book) and the pre-filter's own replies never see it.
      if (inApp && appSalesQuestion(newMessage)) {
        await deps.budget.take(keys.refusals(userId), HUB_LIMITS.refusalsPerDay.limit, HUB_LIMITS.refusalsPerDay.windowMs);
        note(tier, "prefilter", "app_pricing", started);
        return void signed(REPLIES.R_APP_PRICING, "refusal");
      }

      // 7. pre-filter (fixed reply, no model call)
      const pre = prefilter(newMessage);
      if (pre.code !== "pass") {
        const override = inApp ? appPrefilterOverride(pre.reply, pre.link?.path) : null;
        await deps.budget.take(keys.refusals(userId), HUB_LIMITS.refusalsPerDay.limit, HUB_LIMITS.refusalsPerDay.windowMs);
        note(tier, "prefilter", override ? "app_pricing" : pre.code, started);
        return void signed(override ? REPLIES.R_APP_PRICING : replyText(pre.reply, pre.link), "refusal");
      }

      // 8. breaker
      if (breaker.isOpen()) { note(tier, "busy", "breaker", started); return void res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" }); }
      // 9. concurrency — before the daily budgets, so a request turned away as busy costs no model-call slot
      const release = semaphore.tryAcquire(`user:${userId}`);
      if (!release) { note(tier, "busy", "concurrency", started); return void res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" }); }

      let result: Upstream;
      try {
        // 10. daily budgets — taken only now that a model call will happen (the finally below releases the slot)
        if (!(await deps.budget.take(keys.userDaily(userId), HUB_LIMITS.userDaily.limit, HUB_LIMITS.userDaily.windowMs))) {
          note(tier, "limit", "user_daily", started); return void res.status(429).json({ reply: REPLIES.R_LIMIT, code: "limit" });
        }
        if (!(await deps.budget.take(keys.ipDaily(deps.ipKey(req)), HUB_LIMITS.ipDaily.limit, HUB_LIMITS.ipDaily.windowMs))) {
          note(tier, "limit", "ip_daily", started); return void res.status(429).json({ reply: REPLIES.R_LIMIT, code: "limit" });
        }
        if (!(await deps.budget.take(keys.globalDaily(), globalDailyCap(), HUB_LIMITS.userDaily.windowMs))) {
          note(tier, "busy", "global_daily", started); return void res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" });
        }

        // 11. TruthCoder
        // Earlier questions that were refused (and their fixed replies) never reach the model.
        const turns: VisitorTurn[] = [];
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          if (m.role === "user" && i < messages.length - 1 && prefilter(m.content).code !== "pass") { i++; continue; }
          turns.push({ role: m.role, content: m.content });
        }
        result = await callModel(buildRequest(deps.model(), buildMessages(turns, pageKey as PageKey | undefined)));
      } finally { release(); }
      if (!result.ok) {
        if (result.kind === "timeout") { note(tier, "timeout", "model", started); return void res.status(503).json({ reply: REPLIES.R_TIMEOUT, code: "timeout" }); }
        note(tier, "busy", result.kind, started);
        return void res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" });
      }

      // 12. output filter (with this request's own turns, so visitor text echoed back is caught: O18)
      const echo = {
        user: messages.filter((m) => m.role === "user").map((m) => m.content),
        assistant: messages.filter((m) => m.role === "assistant").map((m) => m.content),
      };
      const filtered = filterOutput(result.completion, { publicOnly: false, echo });
      if (!filtered.ok) { note(tier, "output_block", filtered.code, started); return void signed(inApp ? REPLIES.R_APP_FALLBACK : REPLIES.R_FALLBACK, "fallback"); }
      // The iPhone apps sell nothing: no model answer in the app may state a price or point at Pricing.
      if (inApp && appAnswerBlocked(filtered.text)) {
        note(tier, "output_block", "app_pricing", started);
        return void signed(REPLIES.R_APP_PRICING, "refusal");
      }
      note(tier, "chat_ok", latencyBucket(result.ms), started);
      signed(filtered.text, "answer");
    } catch (err) {
      logError("chat", err);
      if (!res.headersSent) res.status(503).json({ reply: REPLIES.R_BUSY, code: "busy" });
    }
  });

  return { router, warm, presetAnswer, generatePreset, breaker, semaphore };
}
