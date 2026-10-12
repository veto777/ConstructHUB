/**
 * A page section that lives in the address path (/google-ads/traffic) rather than ?tab=: the section, a setter that
 * keeps the other query parameters, and a one-time redirect of the old ?tab= links to their new address.
 */
import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { routeOf } from "./nav";

type Tabs<T extends string> = readonly (readonly [T, string, string])[];

/** The address of a section, with `params` (minus any old ?tab=). */
export function routeTabHref<T extends string>(base: string, tabs: Tabs<T>, tab: T, params: URLSearchParams = new URLSearchParams()): string {
  const seg = tabs.find(([key]) => key === tab)?.[1] ?? "";
  const p = new URLSearchParams(params);
  p.delete("tab");
  const s = p.toString();
  return `${routeOf(base, seg)}${s ? `?${s}` : ""}`;
}

export function useRouteTab<T extends string>(base: string, tabs: Tabs<T>): [T, (tab: T) => void] {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const seg = path.startsWith(`${base}/`) ? path.slice(base.length + 1).split("/")[0] : "";
  const fallback = tabs[0][0];
  const tab = tabs.find(([, s]) => s === seg)?.[0] ?? fallback;
  const legacy = params.get("tab");
  useEffect(() => {
    if (!legacy) return;
    const wanted = tabs.find(([key, s]) => key === legacy || s === legacy)?.[0] ?? tab;
    navigate(routeTabHref(base, tabs, wanted, params), { replace: true });
  }, [legacy]); // eslint-disable-line react-hooks/exhaustive-deps
  return [tab, (next: T) => navigate(routeTabHref(base, tabs, next, new URLSearchParams(window.location.search)))];
}
