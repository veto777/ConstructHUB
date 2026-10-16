/** press_orders / press_releases / press_messages / press_inbox_state (schema.ts): plain SQL on the shared pool. */
import { randomBytes } from "node:crypto";
import { pool } from "../db";
import {
  PRESS_CREDIT_MONTHS, type PressGuidelineIssue, type PressOrderView, type PressPackageKey, type PressReleaseInput, type PressReleaseStatus, type PressReleaseText, type PressReleaseView, type PressReport, type PressTier, pressPackage,
} from "@shared/press";

export type OrderRow = {
  id: number; user_id: number; email: string; package_key: PressPackageKey; tier: PressTier; credits: number; credits_used: number; amount_cents: number;
  status: "awaiting_payment" | "paid"; stripe_session_id: string | null; created_at: Date; paid_at: Date | null; expires_at: Date | null;
};
export type ReleaseRow = {
  id: number; user_id: number; order_id: number | null; tier: PressTier; status: PressReleaseStatus; code: string; input: PressReleaseInput;
  text: PressReleaseText | null; issues: PressGuidelineIssue[]; wire_notes: string | null; wire_message_id: string | null; live_url: string | null;
  report: PressReport | null; scheduled_for: string | null; created_at: Date; updated_at: Date; submitted_at: Date | null; live_at: Date | null;
  reported_at: Date | null; attempts: number; last_error: string | null;
};
export type MessageRow = {
  id: number; message_id: string; thread_key: string | null; direction: "in" | "out"; release_id: number | null; from_email: string; from_name: string | null;
  to_email: string | null; subject: string; body: string; attachments: { name: string; url: string; contentType: string; size: number }[]; kind: string | null;
  reading: Record<string, unknown> | null; status: "new" | "applied" | "needs_owner" | "ignored" | "failed"; reason: string | null; received_at: Date; created_at: Date;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export const orderView = (r: OrderRow): PressOrderView => ({
  id: r.id, packageKey: r.package_key, packageName: pressPackage(r.package_key)?.name ?? r.package_key, tier: r.tier, credits: r.credits, creditsUsed: r.credits_used,
  creditsLeft: Math.max(0, r.credits - r.credits_used), amountCents: r.amount_cents, status: r.status, createdAt: iso(r.created_at)!, paidAt: iso(r.paid_at), expiresAt: iso(r.expires_at),
});
export const releaseView = (r: ReleaseRow): PressReleaseView => ({
  id: r.id, orderId: r.order_id, tier: r.tier, status: r.status, code: r.code, input: r.input, text: r.text, issues: r.issues ?? [], wireNotes: r.wire_notes,
  liveUrl: r.live_url, report: r.report, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, submittedAt: iso(r.submitted_at), liveAt: iso(r.live_at),
  reportedAt: iso(r.reported_at), scheduledFor: r.scheduled_for ? String(r.scheduled_for).slice(0, 10) : null,
});

// ---- orders -------------------------------------------------------------------------------------------------

export async function createOrder(o: { userId: number; email: string; packageKey: PressPackageKey; tier: PressTier; credits: number; amountCents: number }): Promise<OrderRow> {
  const { rows } = await pool.query<OrderRow>(
    `INSERT INTO press_orders (user_id, email, package_key, tier, credits, amount_cents) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [o.userId, o.email, o.packageKey, o.tier, o.credits, o.amountCents],
  );
  return rows[0];
}
export async function getOrder(id: number): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>(`SELECT * FROM press_orders WHERE id=$1`, [id]);
  return rows[0] ?? null;
}
export async function setCheckoutSession(id: number, sessionId: string): Promise<void> {
  await pool.query(`UPDATE press_orders SET stripe_session_id=$2 WHERE id=$1`, [id, sessionId]);
}
/** Marks the order paid once; false when it already was (a webhook redelivery). Credits last PRESS_CREDIT_MONTHS. */
export async function markPaid(id: number, sessionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE press_orders SET status='paid', paid_at=now(), expires_at=now() + ($3 || ' months')::interval, stripe_session_id=COALESCE(stripe_session_id,$2)
     WHERE id=$1 AND status='awaiting_payment'`,
    [id, sessionId, String(PRESS_CREDIT_MONTHS)],
  );
  return (rowCount ?? 0) > 0;
}
export async function listOrders(userId: number): Promise<OrderRow[]> {
  const { rows } = await pool.query<OrderRow>(`SELECT * FROM press_orders WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
  return rows;
}
/** Paid orders with a credit left, oldest expiry first, for the tier. */
export async function ordersWithCredit(userId: number, tier: PressTier): Promise<OrderRow[]> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT * FROM press_orders WHERE user_id=$1 AND tier=$2 AND status='paid' AND credits_used < credits AND (expires_at IS NULL OR expires_at > now()) ORDER BY expires_at NULLS LAST, id`,
    [userId, tier],
  );
  return rows;
}
export async function creditsLeft(userId: number): Promise<Record<PressTier, number>> {
  const { rows } = await pool.query<{ tier: PressTier; left: string }>(
    `SELECT tier, COALESCE(SUM(credits - credits_used),0)::text AS left FROM press_orders WHERE user_id=$1 AND status='paid' AND (expires_at IS NULL OR expires_at > now()) GROUP BY tier`,
    [userId],
  );
  const out: Record<PressTier, number> = { budget: 0, premium: 0 };
  for (const r of rows) out[r.tier] = Number(r.left);
  return out;
}

/**
 * Spend one credit on a release, atomically: the release takes the oldest paid order with a credit left for its tier.
 * False when there is none (nothing changes).
 */
export async function spendCredit(releaseId: number, userId: number, tier: PressTier): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OrderRow>(
      `SELECT * FROM press_orders WHERE user_id=$1 AND tier=$2 AND status='paid' AND credits_used < credits AND (expires_at IS NULL OR expires_at > now())
       ORDER BY expires_at NULLS LAST, id LIMIT 1 FOR UPDATE`,
      [userId, tier],
    );
    const order = rows[0];
    if (!order) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE press_orders SET credits_used = credits_used + 1 WHERE id=$1`, [order.id]);
    await client.query(`UPDATE press_releases SET order_id=$2, updated_at=now() WHERE id=$1`, [releaseId, order.id]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
/** A cancelled release gives its credit back to the order it took it from. */
export async function refundCredit(releaseId: number): Promise<void> {
  await pool.query(
    `UPDATE press_orders o SET credits_used = GREATEST(0, o.credits_used - 1) FROM press_releases r WHERE r.id=$1 AND r.order_id=o.id`,
    [releaseId],
  );
  await pool.query(`UPDATE press_releases SET order_id=NULL, updated_at=now() WHERE id=$1`, [releaseId]);
}

// ---- releases -----------------------------------------------------------------------------------------------

const newCode = () => `CH-PR-${randomBytes(3).toString("hex").toUpperCase()}`;

export async function createRelease(userId: number, tier: PressTier, input: PressReleaseInput): Promise<ReleaseRow> {
  for (let i = 0; i < 5; i++) {
    try {
      const { rows } = await pool.query<ReleaseRow>(
        `INSERT INTO press_releases (user_id, tier, code, input) VALUES ($1,$2,$3,$4) RETURNING *`,
        [userId, tier, newCode(), JSON.stringify(input)],
      );
      return rows[0];
    } catch (e: any) {
      if (e?.code !== "23505" || i === 4) throw e;
    }
  }
  throw new Error("unreachable");
}
export async function getRelease(id: number): Promise<ReleaseRow | null> {
  const { rows } = await pool.query<ReleaseRow>(`SELECT * FROM press_releases WHERE id=$1`, [id]);
  return rows[0] ?? null;
}
export async function releaseByCode(code: string): Promise<ReleaseRow | null> {
  const { rows } = await pool.query<ReleaseRow>(`SELECT * FROM press_releases WHERE code=$1`, [code.toUpperCase()]);
  return rows[0] ?? null;
}
export async function listReleases(userId: number): Promise<ReleaseRow[]> {
  const { rows } = await pool.query<ReleaseRow>(`SELECT * FROM press_releases WHERE user_id=$1 ORDER BY created_at DESC`, [userId]);
  return rows;
}
export async function listAllReleases(status?: PressReleaseStatus, limit = 200): Promise<(ReleaseRow & { email: string | null })[]> {
  const { rows } = await pool.query<ReleaseRow & { email: string | null }>(
    `SELECT r.*, u.email FROM press_releases r LEFT JOIN users u ON u.id = r.user_id ${status ? "WHERE r.status=$2" : ""} ORDER BY r.updated_at DESC LIMIT $1`,
    status ? [limit, status] : [limit],
  );
  return rows;
}
export async function releasesInStatus(status: PressReleaseStatus): Promise<ReleaseRow[]> {
  const { rows } = await pool.query<ReleaseRow>(`SELECT * FROM press_releases WHERE status=$1 ORDER BY updated_at`, [status]);
  return rows;
}
export async function updateRelease(id: number, patch: Partial<{
  input: PressReleaseInput; text: PressReleaseText | null; issues: PressGuidelineIssue[]; status: PressReleaseStatus; tier: PressTier; wire_notes: string | null;
  wire_message_id: string | null; live_url: string | null; report: PressReport | null; scheduled_for: string | null; submitted_at: Date | null; live_at: Date | null;
  reported_at: Date | null; attempts: number; last_error: string | null;
}>): Promise<ReleaseRow> {
  const sets: string[] = ["updated_at=now()"]; const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    vals.push(k === "input" || k === "text" || k === "issues" || k === "report" ? (v == null ? null : JSON.stringify(v)) : v);
    sets.push(`${k}=$${vals.length}`);
  }
  const { rows } = await pool.query<ReleaseRow>(`UPDATE press_releases SET ${sets.join(", ")} WHERE id=$1 RETURNING *`, vals);
  return rows[0];
}
/** The customer's last live release, for the one-a-month pacing note. */
export async function lastSubmittedAt(userId: number): Promise<Date | null> {
  const { rows } = await pool.query<{ t: Date | null }>(`SELECT MAX(submitted_at) AS t FROM press_releases WHERE user_id=$1`, [userId]);
  return rows[0]?.t ?? null;
}

// ---- messages -----------------------------------------------------------------------------------------------

export async function saveMessage(m: {
  messageId: string; threadKey: string | null; direction: "in" | "out"; releaseId: number | null; fromEmail: string; fromName: string | null; toEmail: string | null;
  subject: string; body: string; attachments: MessageRow["attachments"]; receivedAt: Date; status?: MessageRow["status"]; reason?: string | null; kind?: string | null;
}): Promise<MessageRow | null> {
  const { rows } = await pool.query<MessageRow>(
    `INSERT INTO press_messages (message_id, thread_key, direction, release_id, from_email, from_name, to_email, subject, body, attachments, received_at, status, reason, kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (message_id) DO NOTHING RETURNING *`,
    [m.messageId, m.threadKey, m.direction, m.releaseId, m.fromEmail, m.fromName, m.toEmail, m.subject, m.body, JSON.stringify(m.attachments), m.receivedAt, m.status ?? "new", m.reason ?? null, m.kind ?? null],
  );
  return rows[0] ?? null;
}
export async function setMessage(id: number, patch: Partial<{ release_id: number | null; kind: string | null; reading: Record<string, unknown> | null; status: MessageRow["status"]; reason: string | null }>): Promise<void> {
  const sets: string[] = []; const vals: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) { vals.push(k === "reading" ? (v == null ? null : JSON.stringify(v)) : v); sets.push(`${k}=$${vals.length}`); }
  if (!sets.length) return;
  await pool.query(`UPDATE press_messages SET ${sets.join(", ")} WHERE id=$1`, vals);
}
export async function newMessages(): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(`SELECT * FROM press_messages WHERE direction='in' AND status='new' ORDER BY received_at LIMIT 100`);
  return rows;
}
export async function listMessages(opts: { releaseId?: number; status?: MessageRow["status"]; limit?: number }): Promise<MessageRow[]> {
  const where: string[] = []; const vals: unknown[] = [];
  if (opts.releaseId) { vals.push(opts.releaseId); where.push(`release_id=$${vals.length}`); }
  if (opts.status) { vals.push(opts.status); where.push(`status=$${vals.length}`); }
  vals.push(opts.limit ?? 100);
  const { rows } = await pool.query<MessageRow>(`SELECT * FROM press_messages ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY received_at DESC LIMIT $${vals.length}`, vals);
  return rows;
}
/** Outgoing messages for a release, newest first (to thread a resend under the first submission). */
export async function threadFor(releaseId: number): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(`SELECT * FROM press_messages WHERE release_id=$1 ORDER BY received_at`, [releaseId]);
  return rows;
}

// ---- inbox cursor -------------------------------------------------------------------------------------------

export async function getState(mailbox: string): Promise<{ uid_validity: string | null; last_uid: number; last_pass_at: Date | null; last_pass_error: string | null }> {
  const { rows } = await pool.query(`SELECT uid_validity, last_uid::int AS last_uid, last_pass_at, last_pass_error FROM press_inbox_state WHERE mailbox=$1`, [mailbox]);
  return rows[0] ?? { uid_validity: null, last_uid: 0, last_pass_at: null, last_pass_error: null };
}
export async function saveState(mailbox: string, s: { uidValidity?: string; lastUid?: number; error?: string | null }): Promise<void> {
  await pool.query(
    `INSERT INTO press_inbox_state (mailbox, uid_validity, last_uid, last_pass_at, last_pass_error) VALUES ($1,$2,COALESCE($3,0),now(),$4)
     ON CONFLICT (mailbox) DO UPDATE SET uid_validity=COALESCE($2, press_inbox_state.uid_validity), last_uid=COALESCE($3, press_inbox_state.last_uid), last_pass_at=now(), last_pass_error=$4`,
    [mailbox, s.uidValidity ?? null, s.lastUid ?? null, s.error ?? null],
  );
}

export async function counts(): Promise<{ releases: Partial<Record<PressReleaseStatus, number>>; messages: Partial<Record<MessageRow["status"], number>>; orders: number; creditsSold: number; creditsUsed: number }> {
  const [r, m, o] = await Promise.all([
    pool.query<{ status: PressReleaseStatus; n: string }>(`SELECT status, COUNT(*)::text AS n FROM press_releases GROUP BY status`),
    pool.query<{ status: MessageRow["status"]; n: string }>(`SELECT status, COUNT(*)::text AS n FROM press_messages WHERE direction='in' GROUP BY status`),
    pool.query<{ orders: string; sold: string; used: string }>(`SELECT COUNT(*)::text AS orders, COALESCE(SUM(credits),0)::text AS sold, COALESCE(SUM(credits_used),0)::text AS used FROM press_orders WHERE status='paid'`),
  ]);
  const releases: Partial<Record<PressReleaseStatus, number>> = {}; for (const x of r.rows) releases[x.status] = Number(x.n);
  const messages: Partial<Record<MessageRow["status"], number>> = {}; for (const x of m.rows) messages[x.status] = Number(x.n);
  return { releases, messages, orders: Number(o.rows[0]?.orders ?? 0), creditsSold: Number(o.rows[0]?.sold ?? 0), creditsUsed: Number(o.rows[0]?.used ?? 0) };
}
