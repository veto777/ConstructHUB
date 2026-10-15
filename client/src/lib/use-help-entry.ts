/**
 * The help registry (shared/help/registry.ts, ~270 KB of text once its entries are in) loads on demand.
 * It used to ride in the first download of every page because the home page looks up its overview film
 * and HelpButton looks up its entry at render time; a Meta ad click on a phone paid for all of it before
 * the landing page could draw. The first lookup fetches the registry chunk; from then on it is synchronous.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import type { HelpEntry } from "@shared/help/types";

type Registry = typeof import("@shared/help/registry");
let registry: Registry | undefined;
let loading: Promise<Registry> | undefined;

export function loadHelpRegistry(): Promise<Registry> {
  return (loading ??= import("@shared/help/registry").then((m) => (registry = m)));
}

/**
 * The help key whose route matches `pathname` (shared/help/registry.ts helpKeyForRoute): undefined until the
 * registry has loaded, and for a page no entry covers. Page headers use it to mount their "i" automatically.
 */
export function useHelpKeyForRoute(pathname: string): string | undefined {
  const [key, setKey] = useState<string | undefined>(() => registry?.helpKeyForRoute(pathname));
  useEffect(() => {
    let on = true;
    loadHelpRegistry().then((m) => { if (on) setKey(m.helpKeyForRoute(pathname)); });
    return () => { on = false; };
  }, [pathname]);
  return key;
}

/** The help entry for `key`: undefined until the registry has loaded (and for a key it does not have). */
export function useHelpEntry(key: string): HelpEntry | undefined {
  const [entry, setEntry] = useState<HelpEntry | undefined>(() => registry?.helpEntry(key));
  useEffect(() => {
    let on = true;
    loadHelpRegistry().then((m) => { if (on) setEntry(m.helpEntry(key)); });
    return () => { on = false; };
  }, [key]);
  return entry;
}

/**
 * Is a help control mounted on this page? The tool shell (components/tool/shell.tsx) provides `claim`; every
 * <HelpButton> (full or video-only) and every <InfoTip> calls it with its key while mounted (a layout effect, so the
 * shell settles before the page is painted). The shell shows its own crumb-row "i" for the route's entry only while
 * nothing at all has claimed — a React fact, never a look at the DOM. Null outside a tool shell: claiming is then a
 * no-op.
 */
export type HelpMountClaim = (key: string) => () => void;
export const HelpMountContext = createContext<HelpMountClaim | null>(null);

/** Report this key as mounted on the page for as long as the caller is (and `enabled`). */
export function useClaimHelpMount(key: string | undefined, enabled = true): void {
  const claim = useContext(HelpMountContext);
  useLayoutEffect(() => {
    if (!claim || !key || !enabled) return;
    return claim(key);
  }, [claim, key, enabled]);
}
