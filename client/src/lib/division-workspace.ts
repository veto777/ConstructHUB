/**
 * The CRM's division WORKSPACE on the client (server side: server/crm/tenancy.ts
 * attachActiveDivision + server/crm/division-workspaces.ts).
 *
 * An unpinned seat (the owner, a division-less admin) works either in "All
 * divisions" or inside ONE division. The pick is
 *   - sent on every /api/crm request as the x-crm-division header ("all" or a
 *     division id) — by apiRequest/getQueryFn (lib/queryClient.ts) and, for the
 *     pages' raw fetch() calls, by the fetch wrapper installed below;
 *   - remembered on the member server-side (PUT /api/crm/divisions/workspace),
 *     so it follows the owner to another device — /api/crm/me is asked WITHOUT
 *     the header and answers the saved pick, which wins;
 *   - cached in localStorage so the first requests after a reload already
 *     carry it (no flash of mixed numbers).
 * Switching clears the whole react-query cache: no list, total or detail from
 * one division can bleed into another.
 */
import { useSyncExternalStore } from "react";
import { CRM_DIVISION_HEADER } from "@shared/divisions";

const STORAGE_KEY = "crm.divisionWorkspace";
export const ALL_DIVISIONS = "all";

function readStored(): string {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : ALL_DIVISIONS;
  } catch {
    return ALL_DIVISIONS;
  }
}

let current: string = typeof window === "undefined" ? ALL_DIVISIONS : readStored();
/** False for a pinned seat (and until /api/crm/me says otherwise): no header is sent at all. */
let switchable = true;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

/** "all" or the active division id. */
export function getDivisionWorkspace(): string { return current; }

/** Set locally (cache + memory). Callers that change the pick go through switchDivisionWorkspace. */
export function setDivisionWorkspaceLocal(next: string | null | undefined): boolean {
  const v = next || ALL_DIVISIONS;
  if (v === current) return false;
  current = v;
  try { window.localStorage.setItem(STORAGE_KEY, v); } catch { /* private mode: memory only */ }
  emit();
  return true;
}

export function setDivisionSwitchable(on: boolean) {
  if (switchable === on) return;
  switchable = on;
  emit();
}

export function useDivisionWorkspace(): string {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
    () => ALL_DIVISIONS,
  );
}

/** Same-origin /api/crm/* paths, except /api/crm/me itself (it reports the SAVED pick). */
function isCrmApi(url: string): boolean {
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (typeof window !== "undefined" && u.origin !== window.location.origin) return false;
      path = u.pathname;
    } catch { return false; }
  }
  if (!path.startsWith("/api/crm/") && path !== "/api/crm") return false;
  return !/^\/api\/crm\/me(\?|$)/.test(path);
}

/** The header to add for this URL, or null. */
export function divisionHeaderFor(url: string): Record<string, string> | null {
  if (!switchable || !isCrmApi(url)) return null;
  return { [CRM_DIVISION_HEADER]: current };
}

/** Merge the workspace header into fetch() init headers (never overrides an explicit one). */
export function withDivisionHeader(url: string, init?: RequestInit): RequestInit | undefined {
  const h = divisionHeaderFor(url);
  if (!h) return init;
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has(CRM_DIVISION_HEADER)) headers.set(CRM_DIVISION_HEADER, h[CRM_DIVISION_HEADER]);
  return { ...(init ?? {}), headers };
}

let installed = false;
/** Wrap window.fetch once so the pages' raw fetch('/api/crm/…') calls carry the workspace too. */
export function installDivisionFetch(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (typeof input !== "string" && !(input instanceof URL)) return orig(input, init);
    return orig(input, withDivisionHeader(url, init));
  }) as typeof window.fetch;
}
