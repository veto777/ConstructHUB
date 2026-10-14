/**
 * research_orders: one row per research report order. Plain SQL on the shared pool (like server/billing), created
 * idempotently at boot. The input is stored exactly as validated by shared/research-reports.ts researchOrderSchema;
 * the price and tier are the server's, never the client's.
 */
import { pool } from "../db";
import type {
  ResearchOrderInput, ResearchOrderView, ResearchPreview, ResearchReport, ResearchStatus, ResearchTier,
} from "@shared/research-reports";

const DDL = `
CREATE TABLE IF NOT EXISTS research_orders (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment',
  tier text NOT NULL,
  price_cents integer NOT NULL,
  input jsonb NOT NULL,
  preview jsonb,
  report jsonb,
  error text,
  agreed_at timestamptz NOT NULL,
  agreed_terms text NOT NULL,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS research_orders_session_uq ON research_orders (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS research_orders_user_idx ON research_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_orders_status_idx ON research_orders (status);
`;

let ready: Promise<void> | null = null;
export function researchSchemaReady(): Promise<void> {
  ready ??= pool.query(DDL).then(() => undefined).catch((err) => { ready = null; throw err; });
  return ready;
}

export type ResearchOrderRow = {
  id: number; user_id: number; email: string; status: ResearchStatus; tier: ResearchTier; price_cents: number;
  input: ResearchOrderInput; preview: ResearchPreview | null; report: ResearchReport | null; error: string | null;
  stripe_session_id: string | null; created_at: Date; paid_at: Date | null; started_at: Date | null; completed_at: Date | null;
};

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function orderView(row: ResearchOrderRow): ResearchOrderView {
  const { agreeNonRefundable: _a, agreeNoGuarantee: _b, agreeNotFcra: _c, ...input } = row.input;
  return {
    id: row.id, status: row.status, tier: row.tier, priceCents: row.price_cents, input,
    preview: row.preview, report: row.status === "complete" ? row.report : null, error: row.status === "failed" ? row.error : null,
    createdAt: iso(row.created_at)!, paidAt: iso(row.paid_at), completedAt: iso(row.completed_at),
  };
}

export async function createOrder(o: {
  userId: number; email: string; tier: ResearchTier; priceCents: number; input: ResearchOrderInput; preview: ResearchPreview; terms: string;
}): Promise<ResearchOrderRow> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `INSERT INTO research_orders (user_id, email, tier, price_cents, input, preview, agreed_at, agreed_terms)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING *`,
    [o.userId, o.email, o.tier, o.priceCents, JSON.stringify(o.input), JSON.stringify(o.preview), o.terms],
  );
  return rows[0];
}

export async function getOrder(id: number): Promise<ResearchOrderRow | null> {
  await researchSchemaReady();
  const { rows } = await pool.query(`SELECT * FROM research_orders WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listOrders(userId: number | null, limit = 50): Promise<ResearchOrderRow[]> {
  await researchSchemaReady();
  const { rows } = userId == null
    ? await pool.query(`SELECT * FROM research_orders ORDER BY created_at DESC LIMIT $1`, [limit])
    : await pool.query(`SELECT * FROM research_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return rows;
}

export async function setCheckoutSession(id: number, sessionId: string): Promise<void> {
  await pool.query(`UPDATE research_orders SET stripe_session_id = $2 WHERE id = $1 AND status = 'awaiting_payment'`, [id, sessionId]);
}

/** Paid, once: true only for the call that moved it out of awaiting_payment. */
export async function markPaid(id: number, userId: number, sessionId: string): Promise<boolean> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `UPDATE research_orders SET status = 'paid', paid_at = now(), stripe_session_id = $3
     WHERE id = $1 AND user_id = $2 AND status = 'awaiting_payment' RETURNING id`,
    [id, userId, sessionId],
  );
  return rows.length > 0;
}

/** The next paid order to research (oldest first), claimed atomically. */
export async function claimNext(): Promise<ResearchOrderRow | null> {
  await researchSchemaReady();
  const { rows } = await pool.query(
    `UPDATE research_orders SET status = 'researching', started_at = now()
     WHERE id = (SELECT id FROM research_orders WHERE status = 'paid' ORDER BY paid_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
  );
  return rows[0] ?? null;
}

/** At boot: an order cut off mid-research (a restart) goes back to the queue. */
export async function requeueInterrupted(): Promise<number> {
  await researchSchemaReady();
  const { rowCount } = await pool.query(`UPDATE research_orders SET status = 'paid' WHERE status = 'researching'`);
  return rowCount ?? 0;
}

export async function finishOrder(id: number, report: ResearchReport): Promise<void> {
  await pool.query(`UPDATE research_orders SET status = 'complete', report = $2, completed_at = now(), error = NULL WHERE id = $1`, [id, JSON.stringify(report)]);
}

export async function failOrder(id: number, error: string): Promise<void> {
  await pool.query(`UPDATE research_orders SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`, [id, error.slice(0, 2000)]);
}

/** Admin: put a failed order back in the queue. */
export async function retryOrder(id: number): Promise<boolean> {
  const { rows } = await pool.query(`UPDATE research_orders SET status = 'paid', error = NULL WHERE id = $1 AND status = 'failed' RETURNING id`, [id]);
  return rows.length > 0;
}
