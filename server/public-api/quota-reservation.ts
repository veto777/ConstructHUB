import { createPool } from '../db';

// Lock waiters must not occupy the connections used by downstream handlers.
// Created on first use, so importing this module (or mocking ../db in a test) opens nothing.
let pool: ReturnType<typeof createPool> | undefined;
const quotaPool = () => (pool ??= createPool('public-api-quota'));

/** One transaction owns the account from allowance check through durable metering.
 * All queries use its client: waiting requests cannot exhaust the pool needed to
 * finish metering. The namespace is separate from Social Media's locks.
 */
export async function reserveQuota(userId: number, keyId: string) {
  const client = await quotaPool().connect();
  let settled = false;
  const rollback = async () => {
    if (settled) return;
    settled = true;
    try { await client.query('ROLLBACK'); client.release(); }
    catch (error) { client.release(error as Error); }
  };
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(8160, $1)', [userId]);
    // Capture the billing day after waiting, including across a UTC month boundary.
    const day = new Date().toISOString().slice(0, 10);
    const { rows: [usage] } = await client.query(
      `SELECT coalesce(sum(units) FILTER (WHERE key_id=$1), 0)::int AS key_units,
              coalesce(sum(units), 0)::int AS user_units
       FROM account_api_usage WHERE user_id=$2 AND day >= $3::date`,
      [keyId, userId, `${day.slice(0, 7)}-01`]);
    return {
      used: { key: usage.key_units as number, user: usage.user_units as number },
      rollback,
      async commit(units: number) {
        if (settled) throw new Error('Quota reservation already settled');
        try {
          await client.query(
            `INSERT INTO account_api_usage(key_id, user_id, day, units, requests) VALUES ($1,$2,$3,$4,1)
             ON CONFLICT (key_id, day) DO UPDATE SET units = account_api_usage.units + EXCLUDED.units,
               requests = account_api_usage.requests + EXCLUDED.requests`,
            [keyId, userId, day, units]);
          await client.query('COMMIT');
          settled = true;
          client.release();
        } catch (error) { await rollback(); throw error; }
      },
    };
  } catch (error) { await rollback(); throw error; }
}

export type QuotaReservation = Awaited<ReturnType<typeof reserveQuota>>;
