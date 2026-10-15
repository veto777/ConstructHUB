/**
 * The press pass (owner, 2026-10-15: "fully automated"):
 *   1. submitReady   every approved release ("ready") is emailed to the wire for distribution, with its photos,
 *                    under its code [CH-PR-xxxxxx] — every 15 minutes. Held, visibly, until PRESS_EMAIL /
 *                    PRESS_APP_PASSWORD / PRESS_WIRE_EMAIL are set (the mailbox the owner named: pressrelease@).
 *   2. readInbox     the pressrelease@ mailbox is read once a day (PRESS_INBOX_POLL_HOURS, default 24; "crawled daily")
 *                    and whenever an admin presses "Check now": each email is tied to its release by the code.
 *   3. applyReplies  the writer reads each new email (writer.ts readWireReply): live → the customer gets the link;
 *                    changes → the customer gets the editors' notes and a revised draft to approve again (no new
 *                    credit); report → the report, with the wire's attachments, is emailed to the customer.
 *                    Anything a program should not decide (a question, an unmatched email) waits for the owner.
 * One process at a time (a Postgres advisory lock). Nothing is charged twice: a resend after changes reuses the credit.
 */
import { pool } from "../db";
import { getFromR2, isR2Key } from "../r2";
import { PRIMARY_DOMAIN } from "../site-context";
import { PRESS_PATH, PRESS_STATUS_LABELS, type PressReport, type PressTier } from "@shared/press";
import { fetchSince, mailboxConfig, mailboxConfigured, sendMail, wireConfigured, type Inbound, type OutgoingAttachment } from "./mailbox";
import * as store from "./store";
import { readWireReply, releaseAsText, reviseRelease } from "./writer";
import { checkRelease } from "./guidelines";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const pressWorkerConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  enabled: env.PRESS_WORKER_ENABLED !== "false",
  inboxHours: num(env.PRESS_INBOX_POLL_HOURS, 24),
  submitMinutes: num(env.PRESS_SUBMIT_EVERY_MIN, 15),
});
export const workerDeps = { fetchSince, sendMail, readWireReply, reviseRelease };

const CODE_RE = /CH-PR-[0-9A-F]{6}/i;
const siteBase = () => `https://${PRIMARY_DOMAIN}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tierName = (t: PressTier) => (t === "premium" ? "Premium" : "Wire");

async function r2Buffer(key: string): Promise<Buffer | null> {
  try {
    const { body } = await getFromR2(key);
    if (!body) return null;
    const chunks: Buffer[] = [];
    for await (const c of body as any) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  } catch (e: any) { console.error(`[press] R2 read ${key}: ${e?.message ?? e}`); return null; }
}

/** The wire's submission email for a release: the text, the tier, the contact, the photos attached. */
export function submissionMail(r: store.ReleaseRow): { subject: string; body: string } {
  const t = r.text!;
  const i = r.input;
  const body = [
    `Please distribute the press release below on the ${tierName(r.tier)} ${r.tier === "premium" ? "(Premium)" : "(Budget)"} U.S. distribution.`,
    `Reference: ${r.code} — please keep this reference in the subject of every reply (approval, requested changes, live link and the distribution report).`,
    ``,
    `Company: ${i.companyName}`,
    `Location: ${i.city}, ${i.state}`,
    `Website: ${i.website || "n/a"}`,
    `Media contact: ${i.contactName} · ${i.contactEmail} · ${i.contactPhone || ""}`,
    i.photos.length ? `Photos: ${i.photos.length} attached${i.photos.some((p) => p.caption) ? ` (${i.photos.map((p) => p.caption).filter(Boolean).join("; ")})` : ""}` : `Photos: none`,
    ``,
    `---------------- PRESS RELEASE ----------------`,
    ``,
    releaseAsText(t),
  ].join("\n");
  return { subject: `Press release for distribution: ${t.headline} [${r.code}]`, body };
}

/** Step 1: send every approved release to the wire. */
export async function submitReady(): Promise<{ sent: number; held: number; failed: number }> {
  const out = { sent: 0, held: 0, failed: 0 };
  const ready = await store.releasesInStatus("ready");
  if (!ready.length) return out;
  if (!mailboxConfigured() || !wireConfigured()) {
    const why = !mailboxConfigured() ? "The press mailbox (PRESS_EMAIL / PRESS_APP_PASSWORD) is not set up yet." : "The wire's submission address (PRESS_WIRE_EMAIL) is not set yet.";
    for (const r of ready) if (r.last_error !== why) await store.updateRelease(r.id, { last_error: why });
    out.held = ready.length;
    return out;
  }
  for (const r of ready) {
    if (!r.text) { await store.updateRelease(r.id, { last_error: "No text to send" }); out.failed++; continue; }
    const claimed = await store.updateRelease(r.id, { status: "queued", last_error: null });
    if (claimed.status !== "queued") continue;
    try {
      const { subject, body } = submissionMail(r);
      const attachments: OutgoingAttachment[] = [];
      for (const p of r.input.photos.slice(0, 6)) {
        const key = p.key || (isR2Key(p.url.replace(/^\/api\/files\//, "")) ? p.url.replace(/^\/api\/files\//, "") : "");
        const buf = key ? await r2Buffer(key) : null;
        if (buf) attachments.push({ filename: `${r.code}-${attachments.length + 1}.${(key.match(/\.(\w+)$/)?.[1] ?? "jpg")}`, content: buf });
      }
      const prior = (await store.threadFor(r.id)).filter((m) => m.direction === "out");
      const first = prior[0];
      const messageId = await workerDeps.sendMail({
        to: mailboxConfig().wireTo, subject, body, attachments,
        ...(first ? { inReplyTo: first.message_id, references: prior.map((m) => m.message_id) } : {}),
      });
      await store.saveMessage({ messageId, threadKey: first?.thread_key ?? messageId, direction: "out", releaseId: r.id, fromEmail: mailboxConfig().user, fromName: "ConstructHUB Press Team", toEmail: mailboxConfig().wireTo, subject, body, attachments: [], receivedAt: new Date(), status: "applied" });
      await store.updateRelease(r.id, { status: "submitted", submitted_at: new Date(), wire_message_id: r.wire_message_id ?? messageId, attempts: r.attempts + 1, last_error: null });
      out.sent++;
    } catch (e: any) {
      console.error(`[press] submit ${r.code} failed: ${e?.message ?? e}`);
      await store.updateRelease(r.id, { status: "ready", attempts: r.attempts + 1, last_error: `Send failed: ${String(e?.message ?? e).slice(0, 300)}` });
      out.failed++;
    }
  }
  return out;
}

/** The release an inbound email is about: its code in the subject or body, else the thread of one we sent. */
async function releaseFor(m: Inbound): Promise<store.ReleaseRow | null> {
  const code = `${m.subject}\n${m.body}`.match(CODE_RE)?.[0];
  if (code) { const r = await store.releaseByCode(code); if (r) return r; }
  for (const ref of m.references) {
    const { rows } = await pool.query<{ release_id: number | null }>(`SELECT release_id FROM press_messages WHERE message_id=$1 AND release_id IS NOT NULL LIMIT 1`, [ref]);
    if (rows[0]?.release_id) return store.getRelease(rows[0].release_id);
  }
  const { rows } = await pool.query<{ release_id: number | null }>(`SELECT release_id FROM press_messages WHERE thread_key=$1 AND release_id IS NOT NULL LIMIT 1`, [m.threadKey]);
  return rows[0]?.release_id ? store.getRelease(rows[0].release_id) : null;
}

/** Step 2: read the mailbox past the last UID; store every email, tied to its release. */
export async function readInbox(): Promise<{ read: number; unmatched: number }> {
  const mailbox = mailboxConfig().user;
  const state = await store.getState(mailbox);
  let read = 0, unmatched = 0;
  try {
    const { uidValidity, messages } = await workerDeps.fetchSince(state.last_uid, state.uid_validity);
    let lastUid = state.uid_validity === uidValidity ? state.last_uid : 0;
    for (const m of messages) {
      const release = await releaseFor(m);
      const auto = m.autoSubmitted && !/^no$/i.test(m.autoSubmitted);
      const saved = await store.saveMessage({
        messageId: m.messageId, threadKey: m.threadKey, direction: "in", releaseId: release?.id ?? null, fromEmail: m.fromEmail, fromName: m.fromName, toEmail: m.to,
        subject: m.subject, body: m.body, attachments: m.attachments.map(({ text: _t, ...a }) => a), receivedAt: m.date,
        status: auto ? "ignored" : release ? "new" : "needs_owner", reason: auto ? "Automatic message" : release ? null : "No release reference in this email",
      });
      if (saved) { read++; if (!release && !auto) unmatched++; }
      if (saved && m.attachments.some((a) => a.text)) await store.setMessage(saved.id, { reading: { attachmentText: m.attachments.map((a) => a.text ?? "").join("\n\n").slice(0, 60_000) } });
      lastUid = Math.max(lastUid, m.uid);
    }
    await store.saveState(mailbox, { uidValidity, lastUid, error: null });
  } catch (e: any) {
    await store.saveState(mailbox, { error: String(e?.message ?? e).slice(0, 500) });
    throw e;
  }
  return { read, unmatched };
}

const statusLine = (r: store.ReleaseRow) => `${PRESS_STATUS_LABELS[r.status]} · ${r.code}`;
const releaseLink = (r: store.ReleaseRow) => `${siteBase()}${PRESS_PATH}?release=${r.id}`;

async function emailCustomer(r: store.ReleaseRow, subject: string, lines: string[], attachments: OutgoingAttachment[] = []): Promise<void> {
  const to = r.input.contactEmail;
  if (!to) return;
  const body = [...lines, "", `Track it: ${releaseLink(r)}`].join("\n");
  const html = lines.map((l) => (l ? `<p style="margin:0 0 10px">${l.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${esc(u)}" style="color:#F97316">${esc(u)}</a>`)}</p>` : "")).join("") + `<p style="margin:16px 0 0"><a href="${releaseLink(r)}" style="display:inline-block;background:#F97316;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open your release</a></p>`;
  try {
    const id = await workerDeps.sendMail({ to, subject, body, html, attachments });
    await store.saveMessage({ messageId: id, threadKey: null, direction: "out", releaseId: r.id, fromEmail: mailboxConfig().user || "support", fromName: "ConstructHUB Press Team", toEmail: to, subject, body, attachments: [], receivedAt: new Date(), status: "applied" });
  } catch (e: any) { console.error(`[press] customer email for ${r.code} failed: ${e?.message ?? e}`); }
}

/** Step 3: act on every new email tied to a release. */
export async function applyReplies(): Promise<{ applied: number; held: number; failed: number }> {
  const out = { applied: 0, held: 0, failed: 0 };
  for (const m of await store.newMessages()) {
    const r = m.release_id ? await store.getRelease(m.release_id) : null;
    if (!r) { await store.setMessage(m.id, { status: "needs_owner", reason: "No release reference" }); out.held++; continue; }
    try {
      const reading = await workerDeps.readWireReply({ subject: m.subject, body: m.body, fromEmail: m.from_email, attachmentText: typeof m.reading?.attachmentText === "string" ? m.reading.attachmentText : undefined });
      await store.setMessage(m.id, { kind: reading.kind, reading: { ...(m.reading ?? {}), ...reading } });
      const headline = r.text?.headline ?? r.code;
      if (reading.kind === "live" || (reading.kind === "approved" && reading.liveUrl)) {
        const url = reading.liveUrl ?? r.live_url;
        const upd = await store.updateRelease(r.id, { status: r.status === "reported" ? "reported" : "live", live_url: url, live_at: r.live_at ?? new Date(), wire_notes: null, last_error: null });
        await emailCustomer(upd, `Your press release is live: ${headline}`, [
          `Good news. "${headline}" has been distributed on the ${tierName(r.tier)} wire.`,
          url ? `Read it here: ${url}` : "The wire confirmed distribution; the live link will follow in your report.",
          "The distribution report (where it ran, views and clicks) is emailed to you as soon as the wire sends it, usually within a few days.",
        ]);
        await store.setMessage(m.id, { status: "applied" }); out.applied++;
      } else if (reading.kind === "approved") {
        await store.updateRelease(r.id, { wire_notes: null, last_error: null });
        await store.setMessage(m.id, { status: "applied", reason: "Approved, awaiting the live link" }); out.applied++;
      } else if (reading.kind === "changes") {
        const notes = reading.notes || reading.summary;
        let text = r.text;
        let revised = false;
        if (text) {
          try { text = await workerDeps.reviseRelease(r.input, text, notes, r.tier); revised = true; } catch (e: any) { console.error(`[press] revise ${r.code}: ${e?.message ?? e}`); }
        }
        const issues = text ? checkRelease(text, r.input) : [];
        const upd = await store.updateRelease(r.id, { status: "changes_requested", wire_notes: notes, text, issues, last_error: null });
        await emailCustomer(upd, `The editors asked for changes: ${headline}`, [
          `The wire's editorial team reviewed "${headline}" and asked for the following before it can run:`,
          notes,
          revised ? "We have already revised the draft to address every point. Open the release, read the new version, and press Approve to send it back. No extra credit is used." : "Open the release, make the changes, and press Approve to send it back. No extra credit is used.",
        ]);
        await store.setMessage(m.id, { status: "applied" }); out.applied++;
      } else if (reading.kind === "report") {
        const report: PressReport = {
          summary: reading.report?.summary || reading.summary,
          outlets: reading.report?.outlets ?? null, views: reading.report?.views ?? null, clicks: reading.report?.clicks ?? null,
          pickups: reading.report?.pickups ?? [],
          attachments: m.attachments.filter((a) => a.url).map((a) => ({ name: a.name, url: `${siteBase()}${a.url}` })),
          receivedAt: new Date(m.received_at).toISOString(),
        };
        const upd = await store.updateRelease(r.id, { status: "reported", report, reported_at: new Date(), live_url: r.live_url ?? reading.liveUrl, last_error: null });
        const files: OutgoingAttachment[] = [];
        for (const a of m.attachments.slice(0, 5)) {
          const key = a.url.replace(/^\/api\/files\//, "");
          const buf = key && a.url ? await r2Buffer(key) : null;
          if (buf) files.push({ filename: a.name, content: buf, contentType: a.contentType });
        }
        const stats = [report.outlets != null ? `Outlets that carried it: ${report.outlets.toLocaleString("en-US")}` : "", report.views != null ? `Views: ${report.views.toLocaleString("en-US")}` : "", report.clicks != null ? `Clicks: ${report.clicks.toLocaleString("en-US")}` : ""].filter(Boolean);
        await emailCustomer(upd, `Your distribution report: ${headline}`, [
          `Here is the distribution report for "${headline}" (${tierName(r.tier)} wire).`,
          report.summary,
          ...stats,
          ...(report.pickups.length ? ["Where it ran:", ...report.pickups.slice(0, 40).map((p) => (p.url ? `${p.outlet}: ${p.url}` : p.outlet))] : []),
          upd.live_url ? `Live link: ${upd.live_url}` : "",
          files.length ? "The wire's full report is attached." : "",
        ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")), files);
        await store.setMessage(m.id, { status: "applied" }); out.applied++;
      } else if (reading.kind === "receipt") {
        await store.setMessage(m.id, { status: "applied", reason: "Receipt" }); out.applied++;
      } else {
        await store.setMessage(m.id, { status: "needs_owner", reason: reading.summary }); out.held++;
      }
    } catch (e: any) {
      console.error(`[press] reply ${m.id} for ${r.code}: ${e?.message ?? e}`);
      await store.setMessage(m.id, { status: "failed", reason: String(e?.message ?? e).slice(0, 300) }); out.failed++;
    }
  }
  return out;
}

const LOCK = 7172;
export async function runPressPass(opts: { inbox: boolean } = { inbox: true }): Promise<{ ok: boolean; skipped?: string; submitted?: Awaited<ReturnType<typeof submitReady>>; inbox?: Awaited<ReturnType<typeof readInbox>>; replies?: Awaited<ReturnType<typeof applyReplies>>; error?: string }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
    if (!rows[0]?.ok) return { ok: false, skipped: "A pass is already running" };
    try {
      const submitted = await submitReady();
      let inbox: Awaited<ReturnType<typeof readInbox>> | undefined;
      let error: string | undefined;
      if (opts.inbox && mailboxConfigured()) {
        try { inbox = await readInbox(); } catch (e: any) { error = String(e?.message ?? e).slice(0, 300); console.error(`[press] inbox: ${error}`); }
      }
      const replies = await applyReplies();
      return { ok: true, submitted, inbox, replies, ...(error ? { error } : {}) };
    } finally { await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK]); }
  } finally { client.release(); }
}

let timers: NodeJS.Timeout[] = [];
export function startPressWorker(env: NodeJS.ProcessEnv = process.env) {
  const cfg = pressWorkerConfig(env);
  if (!cfg.enabled) return;
  timers.forEach((t) => clearInterval(t)); timers = [];
  setTimeout(() => void runPressPass({ inbox: true }).catch((e) => console.error("[press] boot pass:", e)), 90_000).unref();
  timers.push(setInterval(() => void runPressPass({ inbox: false }).catch((e) => console.error("[press] submit pass:", e)), cfg.submitMinutes * 60_000));
  timers.push(setInterval(() => void runPressPass({ inbox: true }).catch((e) => console.error("[press] inbox pass:", e)), cfg.inboxHours * 3_600_000));
  timers.forEach((t) => t.unref());
  console.log(`[press] worker: submissions every ${cfg.submitMinutes} min, inbox every ${cfg.inboxHours} h (${mailboxConfigured() ? mailboxConfig().user : "mailbox not configured"}; wire ${wireConfigured() ? "set" : "not set"})`);
}
