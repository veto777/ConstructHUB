/**
 * CRM project photos, as the CRM Photos page and the platform tools see them
 * (server/crm/photo-library.ts). Every URL here is a gated route: the photo
 * streams only to a signed-in member of the CRM team who can see its client.
 */
import { marketingUrl } from "@/lib/site";

export type CrmPhotoStage = "progress" | "finished" | null;
export type CrmPhotoSource = "crew" | "client" | "hover";
export type CrmPhotoFilter = "all" | "progress" | "finished" | "client" | "hover" | "unstaged";
export type CrmJobStatusFilter = "all" | "active" | "completed";

export interface CrmPhoto {
  id: string;
  fileName: string;
  stage: CrmPhotoStage;
  source: CrmPhotoSource;
  mime: string;
  sizeBytes: number;
  createdAt: string | null;
  thumbUrl: string;
  url: string;
  downloadUrl: string;
  customer: { id: string; name: string; address: string | null } | null;
  project: { id: string; name: string; status: string } | null;
}
export type CrmPhotoFacets = Record<CrmPhotoFilter, number>;
export interface CrmPhotoPage {
  photos: CrmPhoto[]; total: number; facets: CrmPhotoFacets; limit: number; offset: number; nextOffset: number | null;
}
export interface CrmPhotoJob {
  customer: { id: string; name: string; address: string | null };
  project: { id: string; name: string; status: string } | null;
  projectCount: number;
  jobStatus: { active: boolean; completed: boolean };
  counts: CrmPhotoFacets;
  cover: { id: string; thumbUrl: string } | null;
  lastPhotoAt: string | null;
}
export interface CrmPhotoJobsPage { jobs: CrmPhotoJob[]; total: number; nextOffset: number | null }
export interface CrmPhotoClient { id: string; name: string; email: string | null; phone: string | null; address: string | null; photoCount: number }

export const CRM_PHOTO_TABS: { key: CrmPhotoFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "progress", label: "In progress" },
  { key: "finished", label: "Finished" },
  { key: "client", label: "From clients" },
  { key: "hover", label: "HOVER captures" },
];

export function stageLabel(p: Pick<CrmPhoto, "stage" | "source">): string {
  if (p.stage === "finished") return "Finished";
  if (p.stage === "progress") return "In progress";
  return p.source === "hover" ? "HOVER" : "From client";
}

export function photosQuery(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== "all") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Why a CRM photo request failed, in words a page can show (never a sales pitch: the iPhone app sells nothing). */
export async function crmPhotoError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  if (res.status === 404 && body?.code === "no_crm_company") return "Project photos come from your ConstructHub CRM team, and this account isn't on one.";
  if (res.status === 401) return "Sign in to see your project photos.";
  if (res.status === 402) return "Project photos aren't included on this account.";
  return body?.message || `Could not load photos (${res.status}).`;
}

export async function fetchCrmJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await crmPhotoError(res));
  return res.json();
}

/** The Photo Optimizer (platform site) with these CRM photos queued. It takes 10 at a time. */
export const optimizerHref = (ids: string[]) => marketingUrl(`/photos?crmPhotos=${ids.slice(0, 10).join(",")}`);
/** The Google Reviews request composer with these CRM photos attached (and the client picked, if one). */
export const reviewRequestHref = (ids: string[], customerId?: string | null) =>
  marketingUrl(`/google-reviews?crmPhotos=${ids.slice(0, 30).join(",")}${customerId ? `&crmCustomer=${encodeURIComponent(customerId)}` : ""}`);

/** The ?crmPhotos= hand-off a platform page was opened with (ids only — the server re-checks every one). */
export function handoffIds(search: string = typeof window === "undefined" ? "" : window.location.search): string[] {
  const raw = new URLSearchParams(search).get("crmPhotos") ?? "";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => /^[\w-]{1,64}$/.test(s)))];
}
/** Drop the hand-off parameters once used, so a reload does not queue the photos twice. */
export function clearHandoff(keys: string[] = ["crmPhotos", "crmCustomer"]) {
  try {
    const url = new URL(window.location.href);
    for (const k of keys) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch { /* no history API — harmless */ }
}
