/**
 * Free disk space watch (reliability review C1, 2026-10-09). The disk production Postgres lives on filled at
 * 05:40 UTC — "PANIC: could not write to file … No space left on device" — and nothing in the app had noticed the
 * 98% beforehand. The app now reads the free space of the volume it runs on at boot and every DISK_WATCH_MINUTES,
 * warns in the log and on the issue desk (source "health") when it is under DISK_WARN_FREE_GB (10 GB; critical under
 * half of that), and hands the last reading to /api/admin/issues for the banner on /admin/issues.
 */
import { statfs } from "node:fs/promises";
import { recordIssue } from "./issues";
import { onShutdown } from "../shutdown";

const envNum = (name: string, fallback: number, min = 0) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= min ? n : fallback; };
export const DISK_WARN_FREE_GB = envNum("DISK_WARN_FREE_GB", 10, 0.1);
export const DISK_WATCH_MINUTES = envNum("DISK_WATCH_MINUTES", 15, 1);
const GB = 1024 ** 3;

export type DiskStatus =
  | { ok: true; path: string; freeGb: number; totalGb: number; warn: boolean; critical: boolean; thresholdGb: number; checkedAt: string }
  | { ok: false; path: string; error: string; warn: false; critical: false; thresholdGb: number; checkedAt: string };

/** The volume watched: DISK_WATCH_PATH, else the working directory (the app, its tmp/ uploads and dumps live there). */
export const watchedPath = () => process.env.DISK_WATCH_PATH || process.cwd();

/** Free space on the volume holding `path`, as the admin page and the log read it. */
export async function diskStatus(path = watchedPath(), read: (p: string) => Promise<{ bavail: number | bigint; blocks: number | bigint; bsize: number | bigint }> = statfs as any): Promise<DiskStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const s = await read(path);
    const bsize = Number(s.bsize), freeGb = (Number(s.bavail) * bsize) / GB, totalGb = (Number(s.blocks) * bsize) / GB;
    const warn = freeGb < DISK_WARN_FREE_GB, critical = freeGb < DISK_WARN_FREE_GB / 2;
    return { ok: true, path, freeGb: round1(freeGb), totalGb: round1(totalGb), warn, critical, thresholdGb: DISK_WARN_FREE_GB, checkedAt };
  } catch (e: any) {
    return { ok: false, path, error: String(e?.message ?? e), warn: false, critical: false, thresholdGb: DISK_WARN_FREE_GB, checkedAt };
  }
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** One line for the log and the issue title. */
export function describeDisk(s: DiskStatus): string {
  if (!s.ok) return `free disk space on ${s.path} could not be read: ${s.error}`;
  return `${s.freeGb} GB free of ${s.totalGb} GB on the volume holding ${s.path}${s.warn ? ` — under the ${s.thresholdGb} GB warning line` : ""}`;
}

let last: DiskStatus | null = null;
/** The newest reading (null before the first check), for the admin page. */
export const lastDiskStatus = () => last;

/** Read once; warn in the log and on the issue desk when low. */
export async function checkDisk(record: (input: Parameters<typeof recordIssue>[0]) => Promise<void> = recordIssue): Promise<DiskStatus> {
  const s = await diskStatus();
  last = s;
  if (!s.ok) { console.warn(`[disk] ${describeDisk(s)}`); return s; }
  if (s.warn) {
    console.warn(`[disk] LOW: ${describeDisk(s)}. Prune ~/ConstructHUB-live/backups and tmp/, vacuum the journal, or grow the volume before Postgres runs out.`);
    await record({
      source: "health", severity: s.critical ? "critical" : "warning", key: "disk-space-low",
      title: `Disk space low: ${s.freeGb} GB free (warning line ${s.thresholdGb} GB)`,
      detail: { path: s.path, freeGb: s.freeGb, totalGb: s.totalGb, thresholdGb: s.thresholdGb, hint: "Prune pre-deploy dumps (deploy keeps 10), tmp/ uploads and the journal; see HANDOFF.md 2026-10-09." },
    });
  }
  return s;
}

/** Boot: check now and every DISK_WATCH_MINUTES; the timer stops with the process. */
export function startDiskWatch(): NodeJS.Timeout {
  void checkDisk().then((s) => { if (s.ok && !s.warn) console.log(`[disk] ${describeDisk(s)}`); }).catch(() => {});
  const timer = setInterval(() => { void checkDisk().catch(() => {}); }, DISK_WATCH_MINUTES * 60_000);
  timer.unref();
  onShutdown("disk watch", () => clearInterval(timer));
  return timer;
}
