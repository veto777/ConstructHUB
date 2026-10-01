/**
 * Fulfilment of one-time purchases: the course_purchases / service_purchases
 * rows that give an account what a paid Checkout Session bought (a Master
 * Class module or the bundle, a DFY service). ONE path for both Stripe events
 * that can say a one-time checkout is paid — checkout.session.completed (a
 * card: paid when the session completes) and
 * checkout.session.async_payment_succeeded (a bank debit: the session
 * completes unpaid and is paid days later) — so a purchase is granted exactly
 * when Stripe says it is paid, and never from metadata alone.
 *
 *   - Paid means `payment_status === "paid"` on the VERIFIED session object.
 *     A session that completed unpaid grants nothing; its later
 *     async_payment_succeeded grants it, async_payment_failed never does.
 *     (`no_payment_required` — a $0 session — is not a confirmed payment
 *     here; our checkouts never create one.)
 *   - The identity is the Checkout Session + item, not the Stripe event id:
 *     one session arrives on several event ids (completed, then
 *     async_payment_succeeded; a redelivery under a fresh id), which the
 *     webhook's per-event claim cannot see. Each row is inserted ON CONFLICT
 *     DO NOTHING against a unique index on (stripe_session_id, item) —
 *     FULFILMENT_DDL in ./schema — so each item of a session is granted once.
 *   - A session's rows are written in ONE transaction: a failure on any item
 *     rolls all of them back and throws, so the webhook answers non-2xx, its
 *     event claim is released and Stripe's retry runs the whole session
 *     again. Nothing is half-granted, nothing is granted twice.
 *
 * What to grant is read from the metadata OUR checkout wrote
 * (server/stripe.ts create-cart-checkout / create-course-checkout, names and
 * prices resolved on the server). Metadata this module cannot read is a
 * defect in that checkout, not a reason to guess: it throws, the webhook
 * fails loudly and Stripe keeps retrying until someone looks.
 *
 * Plain SQL on the shared pool, like the rest of server/billing.
 */
import type Stripe from "stripe";
import { pool } from "../db";

export type FulfilmentItem =
  | { kind: "course"; moduleId: number | null; isBundle: boolean }
  | { kind: "service"; serviceType: string; serviceName: string; price: number };

export type FulfilmentResult =
  /** Not a one-time purchase, or not (yet) paid: nothing was written. */
  | { fulfilled: false; reason: "not_payment" | "unpaid" }
  /** Paid: every item is granted now. `granted` counts the rows this call inserted (0 when an earlier delivery already had). */
  | { fulfilled: true; items: number; granted: number };

const positiveInt = (raw: unknown): number | null => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const unreadable = (session: Stripe.Checkout.Session, what: string) =>
  new Error(`[billing] checkout ${session.id}: ${what} — fulfilment refused, nothing granted`);

/** The rows a session's metadata says to grant (pure). Throws on metadata our checkout could not have written. */
export function fulfilmentItemsFor(session: Stripe.Checkout.Session): FulfilmentItem[] {
  const meta = session.metadata ?? {};
  if (meta.type === "cart") {
    let raw: unknown;
    try { raw = JSON.parse(meta.items || "[]"); } catch { throw unreadable(session, "cart items metadata is not JSON"); }
    if (!Array.isArray(raw)) throw unreadable(session, "cart items metadata is not a list");
    const items: FulfilmentItem[] = [];
    for (const item of raw as any[]) {
      const type = String(item?.type ?? "");
      if (type === "course_module") {
        const moduleId = positiveInt(item?.moduleId);
        if (!moduleId) throw unreadable(session, `cart course_module item without a module id (${JSON.stringify(item?.moduleId ?? null)})`);
        items.push({ kind: "course", moduleId, isBundle: false });
      } else if (type === "course_bundle") {
        items.push({ kind: "course", moduleId: null, isBundle: true });
      } else if (type === "dfy_service" || type === "dfy_bundle") {
        const serviceType = String(item?.id ?? "").trim();
        const serviceName = String(item?.name ?? "").trim();
        const price = Number(item?.price);
        if (!serviceType || !serviceName || !Number.isInteger(price) || price < 0) {
          throw unreadable(session, `cart ${type} item is incomplete (${JSON.stringify(item ?? null)})`);
        }
        items.push({ kind: "service", serviceType, serviceName, price });
      } else {
        // Nothing these tables grant (our checkout writes no other type today); said, not silently dropped.
        console.warn(`[billing] checkout ${session.id}: cart item type ${JSON.stringify(type)} has no fulfilment here — skipped.`);
      }
    }
    return items;
  }
  if (meta.type === "master_class") {
    if (meta.bundle === "true") return [{ kind: "course", moduleId: null, isBundle: true }];
    const moduleId = positiveInt(meta.moduleId);
    if (!moduleId) throw unreadable(session, "master_class metadata names neither the bundle nor a module");
    return [{ kind: "course", moduleId, isBundle: false }];
  }
  // Other one-time checkouts (an SEO agreement, a reinstatement, a CRM client
  // payment that reached the platform endpoint) are not granted through these
  // tables; the purchase ledger (./webhook-events recordOneTimePurchase) still
  // records them.
  return [];
}

// The ON CONFLICT targets name the partial unique indexes of FULFILMENT_DDL
// (./schema) exactly — expressions and predicate included — so Postgres infers
// them; a database without the indexes refuses the insert instead of
// duplicating a grant.
const COURSE_INSERT = `INSERT INTO course_purchases (user_id, module_id, is_bundle, stripe_session_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (stripe_session_id, (COALESCE(module_id, 0)), (COALESCE(is_bundle, false))) WHERE stripe_session_id IS NOT NULL
    DO NOTHING RETURNING id`;
const SERVICE_INSERT = `INSERT INTO service_purchases (user_id, service_type, service_name, price, stripe_session_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (stripe_session_id, service_type) WHERE stripe_session_id IS NOT NULL
    DO NOTHING RETURNING id`;

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>; release: () => void };
type Connectable = { connect: () => Promise<Client> };

/**
 * Grant what a paid one-time Checkout Session bought — once per session and
 * item, all of its items in one transaction (see the header). Safe to call
 * for every checkout.session.completed / async_payment_succeeded: an unpaid
 * or non-payment session returns without writing; a redelivery writes
 * nothing new. Throws when the rows could not be written — the caller must
 * NOT swallow that: the webhook's event claim is released by the throw, and
 * Stripe's retry is the recovery path.
 */
export async function fulfilOneTimePurchase(
  session: Stripe.Checkout.Session, userId: number, db: Connectable = pool,
): Promise<FulfilmentResult> {
  if (session.mode !== "payment") return { fulfilled: false, reason: "not_payment" };
  if (session.payment_status !== "paid") return { fulfilled: false, reason: "unpaid" };
  const items = fulfilmentItemsFor(session);
  if (!items.length) return { fulfilled: true, items: 0, granted: 0 };

  const client = await db.connect();
  let granted = 0;
  try {
    await client.query("BEGIN");
    for (const item of items) {
      const { rows } = item.kind === "course"
        ? await client.query(COURSE_INSERT, [userId, item.moduleId, item.isBundle, session.id])
        : await client.query(SERVICE_INSERT, [userId, item.serviceType, item.serviceName, item.price, session.id]);
      granted += rows.length;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (granted) console.log(`[billing] checkout ${session.id}: granted ${granted} of ${items.length} item(s) to user ${userId}.`);
  else console.log(`[billing] checkout ${session.id}: all ${items.length} item(s) already granted to user ${userId} (redelivery) — nothing written.`);
  return { fulfilled: true, items: items.length, granted };
}
