/**
 * A tool page's current view as a named route (owner, 2026-10-12: every tool in the full-screen format): /ip-tracker
 * is the first view, /ip-tracker/visitors the next. Old ?tab= links land on their route (the address is replaced).
 * Switching views keeps only the parameters listed in `keep` (e.g. the chosen ?site=).
 */
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

export function viewHref(base: string, slug: string, params: URLSearchParams, keep: readonly string[]): string {
  const next = new URLSearchParams();
  for (const k of keep) { const v = params.get(k); if (v) next.set(k, v); }
  const s = next.toString();
  return `${slug ? `${base}/${slug}` : base}${s ? `?${s}` : ""}`;
}

/** `slugs`: each view's route segment ("" for the first view, served at `base`). */
export function useToolView<V extends string>(base: string, slugs: Record<V, string>, fallback: V, keep: readonly string[] = ["site"]): [V, (v: V) => void] {
  const [path, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const views = Object.keys(slugs) as V[];
  const seg = path.startsWith(`${base}/`) ? path.slice(base.length + 1).split("/")[0] : "";
  const fromPath = seg ? views.find((v) => slugs[v] === seg) : undefined;
  const tab = params.get("tab");
  const fromTab = tab ? views.find((v) => v === tab || slugs[v] === tab) : undefined;
  const view = fromPath ?? fromTab ?? fallback;
  const go = (v: V, replace = false) => {
    const rest = new URLSearchParams(window.location.search);
    rest.delete("tab");
    navigate(viewHref(base, slugs[v], rest, [...keep, ...(replace ? [...rest.keys()] : [])]), { replace });
  };
  // An old ?tab= link: the same view at its own address, every other parameter kept.
  useEffect(() => { if (tab && !fromPath && fromTab) go(fromTab, true); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  return [view, (v: V) => go(v)];
}
