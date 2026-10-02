/**
 * Simulator: a text chat against the compiled profile, through the app
 * (SPEC.md § CRM API → Simulator). OWNER: studio-backend lane.
 *
 * Two backends, one contract:
 *   app    (default) — server/voice/brain.ts runs the decision protocol here
 *          with the app's own AI provider, so the Studio works before the
 *          engine is deployed and in every lane. Sessions live in this
 *          process's memory (30-minute TTL, a few per org).
 *   engine — VOICE_SIM_BACKEND=engine proxies to the engine's /sim/* with the
 *          internal bearer, so the Studio tests the exact Python code a caller
 *          gets. Engine unreachable → 503 voice_engine_unavailable, never a
 *          fake reply.
 *
 * The app passes the DRAFT's compiled profile (useDraft, default true) so
 * unpublished edits can be tried; useDraft:false takes the published one.
 */
import type { Express, Response } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { voiceContext, type GetUser } from "./context";
import { voiceInternalHeaders } from "./internal-auth";
import { voiceEngineUrl } from "./proxy";
import { getOrCreateProfile, previewDraft, publishedState, callerStatus } from "./profile-store";
import { Brain, type TurnResult } from "./brain";
import { parseVoiceProfile, type CompiledProfile } from "@shared/voice-profile";
import { aiErrorTag } from "../ai-output";

const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS_PER_ORG = 6;
const MAX_TEXT = 1000;
/** Every simulated turn is a paid model call (up to two with the retry): a per-org hourly ceiling. */
export const SIM_TURNS_PER_HOUR = 150;
const turnLog = new Map<string, number[]>();

/** True (and counted) when the org may run another simulated turn this hour. */
export function takeSimTurn(orgId: string, now = Date.now()): boolean {
  const recent = (turnLog.get(orgId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= SIM_TURNS_PER_HOUR) { turnLog.set(orgId, recent); return false; }
  recent.push(now);
  turnLog.set(orgId, recent);
  return true;
}

type Session = { id: string; orgId: string; brain: Brain; createdAt: number; touchedAt: number; compiledVersion: number; draft: boolean };
const sessions = new Map<string, Session>();

export function simulatorBackend(): "app" | "engine" {
  return process.env.VOICE_SIM_BACKEND === "engine" ? "engine" : "app";
}

function sweep(now = Date.now()) {
  for (const [id, s] of sessions) if (now - s.touchedAt > SESSION_TTL_MS) sessions.delete(id);
}

/** Test hook. */
export function resetSimulatorSessions() { sessions.clear(); turnLog.clear(); }

const sessionBody = z.object({
  useDraft: z.boolean().default(true),
  callerNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
});
const turnBody = z.object({ sessionId: z.string().min(1).max(64), text: z.string().max(MAX_TEXT) });

function bad(res: Response, issues: unknown) {
  return res.status(400).json({ code: "bad_request", issues });
}

/** Which compiled profile a session runs: the draft (compiled now) or the published one. */
async function compiledFor(v: NonNullable<Awaited<ReturnType<typeof voiceContext>>>, useDraft: boolean): Promise<{ compiled: CompiledProfile; timezone: string; version: number } | { error: "unpublished" | "paused" }> {
  const row = await getOrCreateProfile(v.ctx.org, v.ctx.member.id);
  if (useDraft) {
    const p = await previewDraft(v.ctx.org.id);
    if (!p) return { error: "unpublished" };
    return { compiled: p.compiled, version: p.version, timezone: parseVoiceProfile(row.profile).company.timezone };
  }
  const st = publishedState(row);
  if (st.state !== "live") return { error: st.state };
  return { compiled: st.compiled, version: st.version, timezone: st.profile.company.timezone };
}

async function engineFetch(path: string, init: RequestInit): Promise<globalThis.Response | null> {
  try {
    return await fetch(`${voiceEngineUrl()}${path}`, { ...init, headers: { "content-type": "application/json", ...voiceInternalHeaders(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(30_000) });
  } catch { return null; }
}

const engineDown = (res: Response) => res.status(503).json({ code: "voice_engine_unavailable", message: "The Call Assistant engine is not reachable right now." });

export function registerVoiceSimulatorRoutes(app: Express, getDevUser: GetUser): void {
  /** POST { useDraft?: boolean, callerNumber?: string } → { sessionId, greeting, compiledVersion, backend } */
  app.post("/api/crm/voice/simulator/session", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const body = sessionBody.safeParse(req.body ?? {});
    if (!body.success) return bad(res, body.error.issues);
    const picked = await compiledFor(v, body.data.useDraft);
    if ("error" in picked) return res.status(409).json({ code: picked.error, message: picked.error === "paused" ? "The assistant is paused; resume it or simulate the draft." : "Nothing is published yet; simulate the draft or publish first." });
    const caller = body.data.callerNumber ? await callerStatus(v.ctx.org.id, body.data.callerNumber) : null;
    const callerCtx = { callerNumber: body.data.callerNumber ?? null, customer: caller?.customer ?? null };

    if (simulatorBackend() === "engine") {
      const r = await engineFetch("/sim/session", { method: "POST", body: JSON.stringify({ compiled: picked.compiled, orgId: v.ctx.org.id, callerNumber: body.data.callerNumber ?? "", caller: callerCtx, timezone: picked.timezone }) });
      if (!r) return engineDown(res);
      const j = await r.json().catch(() => ({}));
      return res.status(r.ok ? 200 : r.status >= 500 ? 503 : r.status).json(r.ok ? { ...j, backend: "engine", compiledVersion: picked.version } : j);
    }

    sweep();
    const mine = [...sessions.values()].filter((s) => s.orgId === v.ctx.org.id).sort((a, b) => a.touchedAt - b.touchedAt);
    while (mine.length >= MAX_SESSIONS_PER_ORG) sessions.delete(mine.shift()!.id);
    const brain = new Brain({ compiled: picked.compiled, timezone: picked.timezone, caller: callerCtx, tag: `voice-sim:${v.ctx.org.id.slice(0, 8)}` });
    const id = randomBytes(12).toString("base64url");
    const now = Date.now();
    sessions.set(id, { id, orgId: v.ctx.org.id, brain, createdAt: now, touchedAt: now, compiledVersion: picked.version, draft: body.data.useDraft });
    const greeting = brain.greet();
    return res.json({ sessionId: id, greeting, compiledVersion: picked.version, backend: "app", draft: body.data.useDraft, persona: picked.compiled.persona });
  });

  /** POST { sessionId, text } → Decision + { ended, outcome, events, turn, fallback } */
  app.post("/api/crm/voice/simulator/turn", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const body = turnBody.safeParse(req.body ?? {});
    if (!body.success) return bad(res, body.error.issues);

    if (simulatorBackend() === "engine") {
      const r = await engineFetch("/sim/turn", { method: "POST", body: JSON.stringify({ sessionId: body.data.sessionId, text: body.data.text, orgId: v.ctx.org.id }) });
      if (!r) return engineDown(res);
      const j = await r.json().catch(() => ({}));
      return res.status(r.ok ? 200 : r.status >= 500 ? 503 : r.status).json(j);
    }

    const s = sessions.get(body.data.sessionId);
    if (!s || s.orgId !== v.ctx.org.id) return res.status(404).json({ code: "unknown_session", message: "That simulator session has ended. Start a new one." });
    if (s.brain.ended) return res.status(409).json({ code: "session_ended", outcome: s.brain.outcome, message: "The simulated call has ended." });
    if (!takeSimTurn(v.ctx.org.id)) return res.status(429).json({ code: "rate_limited", message: `The simulator allows ${SIM_TURNS_PER_HOUR} turns an hour per company. Try again in a little while.` });
    s.touchedAt = Date.now();
    let turn: TurnResult;
    try {
      turn = await s.brain.respond(body.data.text);
    } catch (err) {
      console.warn(`[voice-sim] turn failed: ${aiErrorTag(err)}`);
      return res.status(502).json({ code: "ai_unavailable", message: "The AI provider did not answer. Try again in a moment." });
    }
    return res.json(turn);
  });

  /** GET → the transcript so far (the Studio's refresh). */
  app.get("/api/crm/voice/simulator/session/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const s = sessions.get(String(req.params.id));
    if (!s || s.orgId !== v.ctx.org.id) return res.status(404).json({ code: "unknown_session" });
    return res.json({ sessionId: s.id, compiledVersion: s.compiledVersion, draft: s.draft, ...s.brain.report() });
  });

  /** DELETE → { ended: true, summary, report } */
  app.delete("/api/crm/voice/simulator/session/:id", async (req: any, res) => {
    const v = await voiceContext(req, res, getDevUser);
    if (!v) return;
    const id = String(req.params.id);
    if (simulatorBackend() === "engine") {
      const r = await engineFetch(`/sim/session/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r) return engineDown(res);
      return res.status(r.ok ? 200 : r.status >= 500 ? 503 : r.status).json(await r.json().catch(() => ({ ended: true })));
    }
    const s = sessions.get(id);
    if (!s || s.orgId !== v.ctx.org.id) return res.json({ ended: true, summary: "" });
    sessions.delete(id);
    const rep = s.brain.report();
    const summary = rep.outcome ? `Ended: ${rep.outcome}.` : `Stopped after ${rep.callerTurns} caller turn${rep.callerTurns === 1 ? "" : "s"}${rep.submitted ? "; a lead was submitted" : ""}${rep.alerted ? "; an alert was raised" : ""}.`;
    return res.json({ ended: true, summary, report: rep });
  });
}
