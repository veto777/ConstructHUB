/**
 * The media inbox pass (MEDIA_INBOX_ENABLED=true; every MEDIA_INBOX_INTERVAL_MIN, default 30):
 *   1. reads new email in media@ — machine senders are logged as automated, everything else waits for an answer;
 *   2. answers each waiting email (owner's law: none is ignored) — the model drafts, ./guard.ts checks; a refused draft,
 *      a model failure (after 3 tries) or a money / meeting / contract question gets a holding reply and waits for the owner;
 *   3. records the company and where the relationship stands; an agreement adds it to our lists (store.addAgreedPartner).
 * One process at a time (a Postgres advisory lock).
 */
import { pool } from "../db";
import { recordFailure } from "../ops/issues";
import { decide, mediaAiConfigured } from "./ai";
import { companyDomain, firstNameOf, holdingReply, machineReason, replyProblem, replySubject } from "./guard";
import { fetchSince, mailboxConfig, mailboxConfigured, sendMail } from "./mailbox";
import * as store from "./store";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const mediaWorkerConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  enabled: env.MEDIA_INBOX_ENABLED === "true",
  intervalMin: num(env.MEDIA_INBOX_INTERVAL_MIN, 30),
});

export const MAX_ATTEMPTS = 3;
export const MAX_REPLIES_PER_DAY = 4;
const ANSWER_BATCH = 25;

export const workerDeps = { fetchSince, sendMail, decide };

/** Step 1: store every new email. */
export async function readInbox(): Promise<{ read: number; automated: number }> {
  const mailbox = mailboxConfig().user;
  const state = await store.getState(mailbox);
  const { uidValidity, messages } = await workerDeps.fetchSince(state.lastUid, state.uidValidity);
  let read = 0, automated = 0, top = state.uidValidity === uidValidity ? state.lastUid : 0;
  for (const m of messages) {
    const reason = machineReason(m);
    if (await store.saveInbound(mailbox, m, reason)) { read++; if (reason) automated++; }
    top = Math.max(top, m.uid);
  }
  if (uidValidity) await store.saveState(mailbox, uidValidity, top);
  return { read, automated };
}

/** Step 2 + 3: answer every waiting email. */
export async function answerPending(): Promise<{ replied: number; held: number; failed: number }> {
  const mailbox = mailboxConfig().user;
  const out = { replied: 0, held: 0, failed: 0 };
  for (const m of await store.pending(ANSWER_BATCH)) {
    const first = firstNameOf(m.fromName);
    let body: string, status: "replied" | "needs_owner" | "failed", reason: string | null = null, partnerId: number | null = null;
    let newlyAgreed: Awaited<ReturnType<typeof store.upsertPartner>> | null = null;
    try {
      if ((await store.repliesToday(m.fromEmail)) >= MAX_REPLIES_PER_DAY) {
        await store.finishMessage(m.id, "needs_owner", `Reply limit for this sender reached (${MAX_REPLIES_PER_DAY} in 24 hours) — loop protection`, null, null);
        out.held++;
        continue;
      }
      const d = await workerDeps.decide(await store.thread(m.threadKey, m.id));
      if (d.relevant) {
        newlyAgreed = await store.upsertPartner({ domain: companyDomain(m.fromEmail), contactEmail: m.fromEmail, contactName: m.fromName, d });
        partnerId = newlyAgreed.partner.id;
      }
      const problem = replyProblem(d.reply);
      if (problem) { body = holdingReply(first); status = "needs_owner"; reason = [problem, d.ownerQuestion, `Drafted by ${d.provider}`].filter(Boolean).join(" — "); }
      else { body = d.reply; status = d.needsOwner ? "needs_owner" : "replied"; reason = [d.needsOwner ? d.ownerQuestion ?? "Owner decision needed" : null, `Answered by ${d.provider}`].filter(Boolean).join(" — "); }
    } catch (e: any) {
      if (m.attempts + 1 < MAX_ATTEMPTS) { await store.bumpAttempt(m.id, e?.message ?? String(e)); continue; }
      body = holdingReply(first); status = "failed"; reason = `Could not draft an answer: ${String(e?.message ?? e).slice(0, 300)}`;
    }
    const subject = replySubject(m.subject);
    const messageId = await workerDeps.sendMail({ to: m.fromEmail, cc: m.cc, subject, body, inReplyTo: m.messageId, references: m.references });
    const replyId = await store.saveOutbound(mailbox, { messageId, threadKey: m.threadKey, to: m.fromEmail, cc: m.cc, subject, body, partnerId });
    await store.finishMessage(m.id, status, reason, replyId || null, partnerId);
    if (newlyAgreed?.newlyAgreed) await store.addAgreedPartner(newlyAgreed.partner);
    if (status === "replied") out.replied++; else if (status === "needs_owner") out.held++; else out.failed++;
  }
  return out;
}

const LOCK_KEY = 0x6d656469; // "medi"
let running = false;

export async function runMediaPass(): Promise<{ ok: boolean; skipped?: string; read?: number; replied?: number; held?: number; failed?: number }> {
  if (!mailboxConfigured()) return { ok: false, skipped: "The media@ mailbox is not configured (MEDIA_EMAIL / MEDIA_APP_PASSWORD)" };
  if (!mediaAiConfigured()) return { ok: false, skipped: "No AI key configured for the media inbox" };
  if (running) return { ok: false, skipped: "A pass is already running" };
  running = true;
  const client = await pool.connect();
  try {
    if (!(await client.query(`SELECT pg_try_advisory_lock($1) ok`, [LOCK_KEY])).rows[0]?.ok) return { ok: false, skipped: "A pass is already running" };
    try {
      const r = await readInbox();
      const a = await answerPending();
      await store.markPass(mailboxConfig().user, null);
      return { ok: true, read: r.read, ...a };
    } catch (e: any) {
      await store.markPass(mailboxConfig().user, String(e?.message ?? e).slice(0, 500)).catch(() => undefined);
      throw e;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } catch (e: any) {
    void recordFailure("job", "Media inbox pass", e);
    console.error(`[media-inbox] pass failed: ${e?.message ?? e}`);
    return { ok: false, skipped: String(e?.message ?? e) };
  } finally {
    client.release();
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startMediaInboxWorker(env: NodeJS.ProcessEnv = process.env) {
  const cfg = mediaWorkerConfig(env);
  if (!cfg.enabled || timer) return;
  setTimeout(() => void runMediaPass(), 60_000).unref();
  timer = setInterval(() => void runMediaPass(), cfg.intervalMin * 60_000);
  timer.unref();
}
