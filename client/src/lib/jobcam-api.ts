/**
 * JobCam client helpers: the media shape the API presents, small formatters
 * and the JSON fetch every JobCam surface uses (same cookie session as the
 * rest of the CRM; errors carry the server's own message).
 */
import { apiErrorMessage } from "@/lib/queryClient";

export type JobcamMediaItem = {
  id: string;
  projectId: string;
  customerId: string | null;
  kind: "photo" | "video";
  status: "uploading" | "processing" | "ready" | "failed";
  error: string | null;
  fileName: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationS: number | null;
  capturedAt: string;
  uploadedAt: string;
  starred: boolean;
  /** Team surfaces only: the homeowner's portal shows this shot. Absent on share links and in the portal. */
  clientVisible?: boolean;
  tags: string[];
  caption: string | null;
  stamp: { time?: boolean; gps?: boolean; project?: boolean; logo?: boolean } | null;
  lat: number | null;
  lng: number | null;
  gpsSource: "exif" | "device" | null;
  gpsAccuracyM: number | null;
  mapUrl: string | null;
  uploader: { id: string; name: string } | null;
  project: { id: string; name: string; number: string | null; address: string | null } | null;
  urls: { thumb: string | null; display: string | null; poster: string | null; video: string | null; original: string };
};

export type JobcamTag = { id: string; name: string; color: string | null; count: number };

export type JobcamProjectOption = {
  id: string; name: string; number: string | null; address: string | null; status: string;
  customerId: string; customerName: string | null; mediaCount: number; lastShotAt: string | null;
  distanceM: number | null; locationSource: "project" | "media" | null;
};

export async function jobcamFetch<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : (null as any)) as Promise<T>;
}

export const jobcamError = (e: unknown, fallback = "Something went wrong — try again.") => apiErrorMessage(e, fallback);

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function formatDuration(s: number | null | undefined): string {
  if (!s || s <= 0) return "";
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** "Today", "Yesterday", else "Tue, Oct 7" (with the year when it isn't this one). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function distanceLabel(m: number | null): string | null {
  if (m == null) return null;
  const ft = m * 3.28084;
  if (ft < 1000) return `${Math.round(ft)} ft`;
  const mi = m / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** Group a (newest-first) list by local calendar day, keeping order. */
export function groupByDay<T extends { capturedAt: string }>(items: T[]): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.capturedAt);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(it.capturedAt), items: [it] });
  }
  return out;
}

/** GET /api/crm/jobcam/usage — the org's storage meter (server/jobcam/usage.ts, shared/jobcam-storage.ts). */
export type JobcamUsageInfo = {
  bytes: number; mediaCount: number; photoCount: number; videoCount: number;
  tierGb: number; limitBytes: number; pendingBytes: number; nextTierGb: number | null;
  warn: boolean; full: boolean; label: string;
  storageRequest: { requestedAt: string } | null;
  mode: "r2" | "local";
};
export const JOBCAM_USAGE_KEY = "/api/crm/jobcam/usage";

/** The JSON body of a jobcamFetch / apiRequest error ("403: {json}"), or null. */
export function jobcamErrorBody(e: unknown): { status: number; body: Record<string, any> | null } | null {
  const raw = typeof (e as any)?.message === "string" ? (e as any).message as string : String(e ?? "");
  const m = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[2]);
    return { status: Number(m[1]), body: parsed && typeof parsed === "object" ? parsed : null };
  } catch { return { status: Number(m[1]), body: null }; }
}

/** The server refused for storage (403 limit_reached, feature jobcamStorage). */
export const isStorageFullError = (e: unknown): boolean => {
  const info = jobcamErrorBody(e);
  return info?.status === 403 && info.body?.code === "limit_reached" && info.body?.feature === "jobcamStorage";
};
