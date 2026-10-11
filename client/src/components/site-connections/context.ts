import { useEffect, useState } from "react";
export function useReportParam(key: string, fallback = "") {
  const read = () =>
    typeof window === "undefined"
      ? fallback
      : (new URLSearchParams(window.location.search).get(key) ?? fallback);
  const [value, setValue] = useState(read);
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [key]);
  const update = (next: string) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
  };
  return [value, update] as const;
}
export function syncRange(start: string, end: string) {
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}
export function useReportPage(key: string) {
  const [raw, setRaw] = useReportParam(key, "1");
  const n = Number(raw);
  return [
    Number.isSafeInteger(n) && n > 0 ? n : 1,
    (page: number) => setRaw(String(page)),
  ] as const;
}
export function urlBelongsToProperty(property: string, url: string) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return false;
    if (property.startsWith("sc-domain:")) {
      const d = property.slice(10);
      return u.hostname === d || u.hostname.endsWith(`.${d}`);
    }
    const p = new URL(property);
    return u.origin === p.origin && u.pathname.startsWith(p.pathname);
  } catch {
    return false;
  }
}
export const previewFingerprint = (
  ids: number[],
  pack: string,
  path: string,
  ips: string,
  officeIps: string,
) =>
  JSON.stringify([[...ids].sort((a, b) => a - b), pack, path, ips, officeIps]);
