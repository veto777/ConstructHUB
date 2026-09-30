import { useEffect, useState } from "react";

/** Keeps a value in the address bar (?key=value) so a refresh or shared link reopens the same view.
 *  push=true adds a history entry (Back returns to the previous view); otherwise the URL is replaced. */
export function useUrlParam(key: string, fallback: string | null = null): [string | null, (value: string | null, push?: boolean) => void] {
  const read = () => (typeof window === "undefined" ? fallback : new URLSearchParams(window.location.search).get(key) ?? fallback);
  const [value, setValue] = useState<string | null>(read);
  useEffect(() => {
    const onPop = () => setValue(read());
    // wouter v3 fires "pushState"/"replaceState" on window for every navigation, so a <Link> to the
    // same page without the param (e.g. the sidebar's /settings while on ?tab=security) resets it too.
    const events = ["popstate", "urlparamchange", "pushState", "replaceState"];
    for (const event of events) window.addEventListener(event, onPop);
    return () => { for (const event of events) window.removeEventListener(event, onPop); };
  }, [key]);
  const update = (next: string | null, push = false) => {
    const url = new URL(window.location.href);
    if (next === null || next === "") url.searchParams.delete(key); else url.searchParams.set(key, next);
    window.history[push ? "pushState" : "replaceState"](window.history.state, "", url.toString());
    setValue(next === "" ? null : next);
    window.dispatchEvent(new Event("urlparamchange"));
  };
  return [value, update];
}
