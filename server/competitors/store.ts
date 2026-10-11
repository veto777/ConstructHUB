import { pool } from "../db";
/**
 * The competitor_scans row is the durable job record. Every lease and quota
 * transition here is a compare-and-swap on the row, and every time-bound
 * check takes an explicit `now`: the worker passes the system clock, tests
 * pass a clock they advance by hand (fake clock), and Postgres never calls
 * now() on its own so no test needs a database.
 */
export type ScanRow = {
  id: number;
  user_id: number;
  industry: string;
  location: string;
  lat: string | null;
  lon: string | null;
  radius: number;
  status: string;
  total_found: number | null;
  error_message: string | null;
  created_at: string | Date;
  lease_token: string | null;
  lease_until: string | Date | null;
  run_at: string | Date;
  attempts: number;
  abandoned: number;
  quota_key: string | null;
  quota_amount: number;
  quota_refunded: boolean;
  started_at: string | Date | null;
  finished_at: string | Date | null;
};

/** The scan row shape the API has returned since round 1 (drizzle camelCase). Lease/quota internals stay server-side. */
export function toApiScan(r: ScanRow) {
  return {
    id: r.id,
    userId: r.user_id,
    industry: r.industry,
    location: r.location,
    lat: r.lat,
    lon: r.lon,
    radius: r.radius,
    status: r.status,
    totalFound: r.total_found ?? 0,
    errorMessage: r.error_message,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  };
}

/** Queue a scan. The reservation the route already holds is persisted on the row so settlement survives a restart. */
export async function enqueueScan(
  userId: number,
  params: { industry: string; location: string; lat: string | null; lon: string | null; radius: number },
  quota: { key: string | null; amount: number },
  now: Date,
): Promise<ScanRow> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO competitor_scans(user_id,industry,location,lat,lon,radius,status,quota_key,quota_amount,run_at)
     VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9) RETURNING *`,
    [userId, params.industry, params.location, params.lat, params.lon, params.radius, quota.key, quota.amount, now],
  );
  return row;
}

/**
 * Claim the next runnable scan: queued ('pending'), or 'running' whose lease
 * lapsed (the holder went away). Rows that never held a lease (written by the
 * pre-worker fire-and-forget path) get a grace period: a young one may still
 * be finishing in its own process, an old one is stranded. FOR UPDATE SKIP
 * LOCKED lets several processes share the queue. `attempts` counts tries;
 * `abandoned` counts takeovers, which set the retry delay through the
 * worker's backoff.
 */
export async function claimNextScan(token: string, leaseUntil: Date, now: Date, maxAttempts: number, graceMs = 5 * 60_000): Promise<ScanRow | null> {
  const stale = `(lease_until IS NOT NULL AND lease_until<$3 OR lease_until IS NULL AND created_at<$5)`;
  const { rows: [row] } = await pool.query(
    `UPDATE competitor_scans
       SET status='running',lease_token=$1,lease_until=$2,attempts=attempts+1,
           abandoned=abandoned+CASE WHEN status='running' THEN 1 ELSE 0 END,
           started_at=COALESCE(started_at,$2)
     WHERE id=(SELECT id FROM competitor_scans
               WHERE (status='pending' OR (status='running' AND ${stale}))
                 AND run_at<=$3 AND attempts<$4
               ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [token, leaseUntil, now, maxAttempts, new Date(now.getTime() - graceMs)],
  );
  return row ?? null;
}

export async function heartbeatScan(id: number, token: string, until: Date): Promise<void> {
  await pool.query("UPDATE competitor_scans SET lease_until=$3 WHERE id=$1 AND lease_token=$2 AND status='running'", [id, token, until]);
}

/** The worker's lease is still the live one and the scan has not been cancelled or deleted. */
export async function isLive(id: number, token: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM competitor_scans WHERE id=$1 AND lease_token=$2 AND status='running'", [id, token]);
  return rowCount === 1;
}

/** firstSeenAt dates to carry across a resume's re-index, keyed by place id. */
export async function firstSeenByPlace(scanId: number): Promise<Map<string, Date>> {
  const { rows } = await pool.query("SELECT place_id,first_seen_at FROM competitor_listings WHERE scan_id=$1", [scanId]);
  return new Map(rows.map((r: any) => [r.place_id, new Date(r.first_seen_at)]));
}

export async function clearListings(scanId: number): Promise<void> {
  await pool.query("DELETE FROM competitor_listings WHERE scan_id=$1", [scanId]);
}

export type ListingInsert = {
  placeId: string;
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: string | null;
  reviewCount: number;
  category: string;
  bsScore: number;
  bsReasons: string[];
  reviewAnalysis: unknown;
  rank: number;
  firstSeenAt: Date | null;
};

export async function insertListing(scanId: number, userId: number, l: ListingInsert): Promise<void> {
  await pool.query(
    `INSERT INTO competitor_listings(scan_id,user_id,place_id,business_name,address,phone,website,rating,review_count,category,is_new,bs_score,bs_reasons,review_analysis,rank_history,first_seen_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,$13,$14,$15)`,
    [scanId, userId, l.placeId, l.businessName, l.address, l.phone, l.website, l.rating, l.reviewCount, l.category,
     l.bsScore, l.bsReasons, l.reviewAnalysis, [{ rank: l.rank, date: new Date().toISOString() }], l.firstSeenAt],
  );
}

/** Mid-run truth: the geocoded center and the partial-pages note, written only while our lease holds. */
export async function noteProgress(id: number, token: string, fields: { lat: string | null; lon: string | null; note: string | null }): Promise<void> {
  await pool.query("UPDATE competitor_scans SET lat=$3,lon=$4,error_message=$5 WHERE id=$1 AND lease_token=$2 AND status='running'",
    [id, token, fields.lat, fields.lon, fields.note]);
}

/** Terminal success. Returns false when the row no longer carries our lease (cancelled/deleted/re-leased mid-run). */
export async function completeScan(id: number, token: string, totalFound: number, now: Date): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE competitor_scans SET status='completed',total_found=$3,finished_at=$4,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",
    [id, token, totalFound, now],
  );
  return rowCount === 1;
}

/** Terminal failure (the scan's month is NOT spent). CAS on our lease when we hold one; tokenless for the sweeper. */
export async function failScan(id: number, token: string | null, message: string, now: Date): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE competitor_scans SET status='failed',error_message=$3,finished_at=$4,lease_until=NULL
     WHERE id=$1 AND status IN ('running','pending') AND ($2::uuid IS NULL OR lease_token=$2)`,
    [id, token, message, now],
  );
  return rowCount === 1;
}

/** A retryable failure goes back to the queue with a backoff; the reservation stays held (no second charge). */
export async function releaseScan(id: number, token: string, runAt: Date): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE competitor_scans SET status='pending',lease_token=NULL,lease_until=NULL,run_at=$3 WHERE id=$1 AND lease_token=$2 AND status='running'",
    [id, token, runAt],
  );
  return rowCount === 1;
}

/**
 * Refund the persisted reservation, at most once per scan: the flag flip and
 * the read of key/amount are one compare-and-swap, so a crash between the
 * fail and the refund, a recovery sweep, and an in-flight worker can never
 * refund twice. Returns the refunded amount (0 = nothing to do).
 */
export async function refundScanQuota(id: number): Promise<number> {
  const { rows: [row] } = await pool.query(
    `UPDATE competitor_scans SET quota_refunded=true
     WHERE id=$1 AND quota_key IS NOT NULL AND quota_amount>0 AND quota_refunded=false AND status IN ('failed','cancelled')
     RETURNING quota_key,quota_amount`,
    [id],
  );
  if (!row) return 0;
  await pool.query("UPDATE growth_budgets SET used=greatest(0,used-$2) WHERE key=$1 AND period='0'", [row.quota_key, row.quota_amount]);
  return Number(row.quota_amount);
}

/**
 * Startup/tick sweeper for rows whose worker went away. A lapsed lease with
 * tries left goes back to the queue with the backoff delay for the attempts
 * already spent; one out of tries fails for good (its refund is settled by
 * refundUnsettledTerminalScans).
 */
export async function sweepStuckScans(now: Date, maxAttempts: number, delayMs: (attempts: number) => number, graceMs = 5 * 60_000) {
  const cutoff = new Date(now.getTime() - graceMs);
  // A lapsed lease is dead at once; a row that never held a lease (the
  // pre-worker fire-and-forget path) is stranded only once it is older than
  // the grace — a younger one may still be finishing in its own process.
  const staleUpdate = `(lease_until IS NOT NULL AND lease_until<$1 OR lease_until IS NULL AND created_at<$4)`;
  const staleSelect = `(lease_until IS NOT NULL AND lease_until<$1 OR lease_until IS NULL AND created_at<$2)`;
  const { rows: dead } = await pool.query(
    `UPDATE competitor_scans SET status='failed',error_message=$2,finished_at=$3,lease_until=NULL
     WHERE status='running' AND ${staleUpdate} AND attempts>=$5 RETURNING id`,
    [now, "The scan was interrupted and could not finish. It has not counted against your monthly limit — run it again.", now, cutoff, maxAttempts],
  );
  const { rows: stuck } = await pool.query(
    `SELECT id,attempts FROM competitor_scans WHERE status='running' AND ${staleSelect} AND attempts<$3`,
    [now, cutoff, maxAttempts],
  );
  const requeued: { id: number; attempts: number }[] = [];
  for (const r of stuck as { id: number; attempts: number }[]) {
    // The UPDATE is the claim: a worker finishing the row right now changes its
    // status and this becomes a no-op.
    const { rowCount } = await pool.query(
      "UPDATE competitor_scans SET status='pending',lease_token=NULL,lease_until=NULL,abandoned=abandoned+1,run_at=$2 WHERE id=$1 AND status='running'",
      [r.id, new Date(now.getTime() + delayMs(r.attempts))],
    );
    if (rowCount) requeued.push(r);
  }
  return { failed: dead as { id: number }[], requeued };
}

/** Refunds every terminal un-refunded scan — the crash-between-fail-and-refund net. Returns total refunded units. */
export async function refundUnsettledTerminalScans(): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE competitor_scans SET quota_refunded=true
     WHERE quota_key IS NOT NULL AND quota_amount>0 AND quota_refunded=false AND status IN ('failed','cancelled')
     RETURNING quota_key,quota_amount`,
  );
  let refunded = 0;
  for (const r of rows) {
    await pool.query("UPDATE growth_budgets SET used=greatest(0,used-$2) WHERE key=$1 AND period='0'", [r.quota_key, r.quota_amount]);
    refunded += Number(r.quota_amount);
  }
  return refunded;
}

/** User-initiated stop: pending or running becomes the terminal 'cancelled', and its reservation is refunded. */
export async function cancelActiveScan(userId: number, scanId: number, now: Date): Promise<"cancelled" | "terminal" | "missing"> {
  const { rows: [row] } = await pool.query(
    `UPDATE competitor_scans SET status='cancelled',lease_token=NULL,lease_until=NULL,finished_at=$3,
            error_message=COALESCE(error_message,'Cancelled before it finished.')
     WHERE id=$1 AND user_id=$2 AND status IN ('pending','running') RETURNING id`,
    [scanId, userId, now],
  );
  if (row) {
    await refundScanQuota(scanId);
    return "cancelled";
  }
  const { rowCount } = await pool.query("SELECT 1 FROM competitor_scans WHERE id=$1 AND user_id=$2", [scanId, userId]);
  return rowCount === 1 ? "terminal" : "missing";
}

/** Remove the scan and its listings. Call cancelActiveScan first when it may still be active. */
export async function deleteScanRows(userId: number, scanId: number): Promise<boolean> {
  await pool.query("DELETE FROM competitor_listings WHERE scan_id=$1", [scanId]);
  const { rowCount } = await pool.query("DELETE FROM competitor_scans WHERE id=$1 AND user_id=$2", [scanId, userId]);
  return rowCount === 1;
}
