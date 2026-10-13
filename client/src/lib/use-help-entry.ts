/**
 * The help registry (shared/help/registry.ts, ~270 KB of text once its entries are in) loads on demand.
 * It used to ride in the first download of every page because the home page looks up its overview film
 * and HelpButton looks up its entry at render time; a Meta ad click on a phone paid for all of it before
 * the landing page could draw. The first lookup fetches the registry chunk; from then on it is synchronous.
 */
import { useEffect, useState } from "react";
import type { HelpEntry } from "@shared/help/types";

type Registry = typeof import("@shared/help/registry");
let registry: Registry | undefined;
let loading: Promise<Registry> | undefined;

export function loadHelpRegistry(): Promise<Registry> {
  return (loading ??= import("@shared/help/registry").then((m) => (registry = m)));
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
