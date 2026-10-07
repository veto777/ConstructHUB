/**
 * A tab that outlived a deploy. Every deploy replaces the content-hashed
 * bundles under /assets/ (script/deploy-vb11.sh removes the old ones), so a
 * page opened before it asks for a lazy chunk that is gone; the server answers
 * 404 (server/static.ts) and the dynamic import fails. That is expected, not a
 * fault: the cure is one reload, which fetches the new index.html (served
 * no-cache) and with it the new bundle names.
 *
 *   recoverFromStaleBuild()  asks the server for the current index.html and
 *     compares its bundles with the ones this page runs:
 *       "reloading"         a newer build is out — the page says "Updating to
 *                           the latest version…" and reloads, once
 *       "already_reloaded"  a newer build is out but this tab reloaded for it
 *                           moments ago and still fails — no second reload
 *       "same_build"        the page is current: the chunk failed for another
 *                           reason (a real fault, worth a report)
 *       "offline"           the server could not be reached — nothing to load
 *
 * The reload is guarded by a sessionStorage timestamp (per tab): at most one
 * automatic reload per RELOAD_WINDOW_MS, and none at all when sessionStorage
 * is unavailable, so a broken deploy can never put a tab in a reload loop.
 * No "@/…" imports: the vitest (server/client-stale-build.test.ts) loads this file directly.
 */

/** What browsers say when a dynamically imported module (or its CSS) cannot be loaded. */
const CHUNK_LOAD_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type|Loading (?:CSS )?chunk [\w-]+ failed|ChunkLoadError|Unable to preload CSS|Failed to load module script/i;

export function isChunkLoadMessage(message: unknown): boolean {
  return CHUNK_LOAD_RE.test(String(message ?? ""));
}

export function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) return isChunkLoadMessage(`${err.name}: ${err.message}`);
  return isChunkLoadMessage(typeof err === "string" ? err : (err as { message?: unknown } | null)?.message);
}

export const RELOAD_KEY = "chub.staleBuildReloadAt";
export const RELOAD_WINDOW_MS = 10 * 60_000;
export const UPDATING_TEXT = "Updating to the latest version…";

export type StaleBuildOutcome = "reloading" | "already_reloaded" | "same_build" | "offline";

export type StaleBuildEnv = {
  /** The tab's sessionStorage, or null when the browser refuses it. */
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  now: () => number;
  /** The entry bundle(s) this page was loaded with (/assets/index-….js) — not the chunks loaded since. */
  currentAssets: () => string[];
  /** The server's current index.html, or null when it cannot be fetched. */
  fetchIndex: () => Promise<string | null>;
  showUpdating: () => void;
  reload: () => void;
};

/** The hashed bundles an index.html loads. */
export function assetRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
}

/** Is `html` (the server's index.html now) a different build from the one that loaded `current`? */
export function isNewerBuild(current: readonly string[], html: string): boolean {
  const served = assetRefs(html);
  if (!current.length || !served.length) return false;
  return current.some((ref) => !served.includes(ref));
}

/** May this tab reload itself now? Marks the attempt when it may. */
export function takeReloadSlot(storage: StaleBuildEnv["storage"], now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    // Only a mark that can be read back guards the next load.
    return storage.getItem(RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
}

export async function decideStaleBuild(env: StaleBuildEnv): Promise<StaleBuildOutcome> {
  let html: string | null = null;
  try { html = await env.fetchIndex(); } catch { html = null; }
  if (html === null) return "offline";
  if (!isNewerBuild(env.currentAssets(), html)) return "same_build";
  if (!takeReloadSlot(env.storage, env.now())) return "already_reloaded";
  env.showUpdating();
  env.reload();
  return "reloading";
}

function showUpdatingNotice(): void {
  try {
    if (document.getElementById("stale-build-notice")) return;
    const el = document.createElement("div");
    el.id = "stale-build-notice";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("data-testid", "stale-build-updating");
    el.textContent = UPDATING_TEXT;
    el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:500 16px/1.4 system-ui,sans-serif;background:hsl(var(--background,0 0% 99%));color:hsl(var(--foreground,215 50% 13%))";
    document.body.appendChild(el);
  } catch { /* the reload follows anyway */ }
}

function browserEnv(): StaleBuildEnv {
  let storage: StaleBuildEnv["storage"] = null;
  try { storage = window.sessionStorage; } catch { storage = null; }
  return {
    storage,
    now: () => Date.now(),
    currentAssets: () => [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
      .map((el) => el.getAttribute("src") ?? "").filter((src) => src.startsWith("/assets/")),
    fetchIndex: async () => {
      // "/" is answered by the app shell or a prerendered page; both name the current bundles (server/static.ts).
      const res = await fetch(`/?build-check=${Date.now()}`, { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" } });
      return res.ok ? await res.text() : null;
    },
    showUpdating: showUpdatingNotice,
    reload: () => window.location.reload(),
  };
}

let inFlight: Promise<StaleBuildOutcome> | null = null;

/** One decision per page load, however many chunks fail at once. */
export function recoverFromStaleBuild(env?: StaleBuildEnv): Promise<StaleBuildOutcome> {
  if (env) return decideStaleBuild(env);
  inFlight ??= decideStaleBuild(browserEnv()).catch(() => "offline" as const);
  return inFlight;
}
