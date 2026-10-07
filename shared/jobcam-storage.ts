/**
 * JobCam storage sizes — the one place the numbers live.
 *
 * Owner, 2026-10-07: "we provide small amount maybe 5 gigs and then 10 gigs
 * and 100 gigs 500, 1000, 2000 etc". Every org with JobCam gets 5 GB; the
 * larger sizes are set per org (jobcam_org_usage.storage_tier_gb).
 *
 * NO PRICES: the owner has not priced the larger sizes. Until he does, only a
 * platform admin can move an org to one (POST /api/admin/jobcam/storage-tier)
 * and the customer's way forward is "Request more storage". Do not add a
 * dollar amount here or anywhere that reads this file.
 *
 * Pure (no server, no React): the server enforces with it, the client draws
 * the meter with it and the tests check it.
 */

export const JOBCAM_STORAGE_TIERS_GB = [5, 10, 100, 500, 1000, 2000] as const;
export type JobcamStorageTierGb = (typeof JOBCAM_STORAGE_TIERS_GB)[number];

/** What every org with JobCam gets without asking. */
export const JOBCAM_INCLUDED_GB: JobcamStorageTierGb = 5;

/** 1 GB = 1024³ bytes, everywhere in JobCam. */
export const JOBCAM_BYTES_PER_GB = 1024 ** 3;

/** The meter turns amber here. */
export const JOBCAM_STORAGE_WARN_RATIO = 0.8;

export const isJobcamStorageTier = (value: unknown): value is JobcamStorageTierGb =>
  typeof value === "number" && (JOBCAM_STORAGE_TIERS_GB as readonly number[]).includes(value);

/** A stored tier as a valid one: anything that is not on the list reads as the included size. */
export const jobcamTierOrIncluded = (value: unknown): JobcamStorageTierGb => {
  const n = typeof value === "string" ? Number(value) : value;
  return isJobcamStorageTier(n) ? n : JOBCAM_INCLUDED_GB;
};

export const jobcamTierBytes = (tierGb: number): number => tierGb * JOBCAM_BYTES_PER_GB;

/** The next size up, or null on the largest. */
export function nextJobcamTierGb(tierGb: number): JobcamStorageTierGb | null {
  return JOBCAM_STORAGE_TIERS_GB.find((t) => t > tierGb) ?? null;
}

/** "5 GB", "1,000 GB". */
export const formatJobcamTier = (tierGb: number): string => `${tierGb.toLocaleString("en-US")} GB`;

/**
 * Bytes as a GB figure for the meter: one decimal under 100 GB (never rounded
 * UP — 4.96 of 5 GB must not read "5.0 of 5" while there is room left), whole
 * numbers above. A non-zero amount too small to show reads "<0.1".
 */
export function formatJobcamGb(bytes: number): string {
  const gb = Math.max(0, bytes) / JOBCAM_BYTES_PER_GB;
  if (gb >= 100) return Math.floor(gb).toLocaleString("en-US");
  const tenths = Math.floor(gb * 10 + 1e-6) / 10;
  if (tenths === 0) return bytes > 0 ? "<0.1" : "0";
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

/** "4.2 of 5 GB". */
export const formatJobcamUsage = (usedBytes: number, tierGb: number): string =>
  `${formatJobcamGb(usedBytes)} of ${formatJobcamTier(tierGb)}`;

export type JobcamStorageState = {
  tierGb: JobcamStorageTierGb;
  limitBytes: number;
  usedBytes: number;
  /** Declared bytes of uploads still open or being processed (not in usedBytes yet). */
  pendingBytes: number;
  /** 0..1 of the limit that is used (stored files only). */
  ratio: number;
  /** 80% or more: say so quietly. */
  warn: boolean;
  /** Nothing more fits: new uploads are refused. */
  full: boolean;
  nextTierGb: JobcamStorageTierGb | null;
  /** "4.2 of 5 GB" */
  label: string;
};

export function jobcamStorageState(usedBytes: number, tierGb: number, pendingBytes = 0): JobcamStorageState {
  const tier = jobcamTierOrIncluded(tierGb);
  const limitBytes = jobcamTierBytes(tier);
  const used = Math.max(0, usedBytes), pending = Math.max(0, pendingBytes);
  const ratio = Math.min(1, used / limitBytes);
  return {
    tierGb: tier, limitBytes, usedBytes: used, pendingBytes: pending, ratio,
    warn: used / limitBytes >= JOBCAM_STORAGE_WARN_RATIO,
    full: used + pending >= limitBytes,
    nextTierGb: nextJobcamTierGb(tier),
    label: formatJobcamUsage(used, tier),
  };
}

/**
 * Would `addBytes` more fit? `pendingBytes` are the declared sizes of the
 * org's other in-flight uploads: two uploads opened together must not both
 * squeeze past the limit, so what is on its way counts as used.
 */
export function jobcamStorageFits(args: { usedBytes: number; pendingBytes: number; addBytes: number; tierGb: number }): boolean {
  return Math.max(0, args.usedBytes) + Math.max(0, args.pendingBytes) + Math.max(0, args.addBytes) <= jobcamTierBytes(jobcamTierOrIncluded(args.tierGb));
}

/**
 * The 403 body for a refused upload — the platform's limit_reached shape
 * (server/entitlements.ts sendLimitReached) plus the storage numbers. No plan
 * or add-on is named: larger sizes are not for sale yet.
 */
export function jobcamStorageLimitBody(args: { usedBytes: number; pendingBytes: number; addBytes: number; tierGb: number }) {
  const tier = jobcamTierOrIncluded(args.tierGb);
  const next = nextJobcamTierGb(tier);
  return {
    code: "limit_reached" as const,
    feature: "jobcamStorage" as const,
    limit: jobcamTierBytes(tier),
    used: Math.max(0, args.usedBytes),
    pendingBytes: Math.max(0, args.pendingBytes),
    requestedBytes: Math.max(0, args.addBytes),
    tierGb: tier,
    nextTierGb: next,
    upgradePlan: null,
    addon: null,
    message: `JobCam storage is full: ${formatJobcamUsage(args.usedBytes, tier)} used. Delete photos or videos you no longer need, or request more storage${next ? ` (next size: ${formatJobcamTier(next)})` : ""}.`,
  };
}
