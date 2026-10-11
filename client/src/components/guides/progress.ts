/**
 * Checklist progress for the guides and the Master Class lessons.
 *
 * Done items are kept in this browser (localStorage) under one key per checklist; nothing is sent to the
 * server, because the account has no per-user preferences store yet. The pages say so (PROGRESS_NOTE) instead
 * of implying a synced record. Every read and write is wrapped: a private window or blocked storage leaves the
 * checklist working for the visit and simply forgets it afterwards.
 */
import { useCallback, useEffect, useState } from "react";

export const PROGRESS_NOTE = "Progress is saved in this browser.";
const PREFIX = "constructhub.checklist.";
const EVENT = "constructhub:checklist";

function read(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, ids: string[]) {
  try {
    if (ids.length) window.localStorage.setItem(PREFIX + key, JSON.stringify(ids));
    else window.localStorage.removeItem(PREFIX + key);
  } catch { /* private window or blocked storage: the checklist still works for this visit */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export type Checklist = {
  done: ReadonlySet<string>;
  isDone: (id: string) => boolean;
  /** Toggle one item, or set it explicitly with `on`. */
  toggle: (id: string, on?: boolean) => void;
  reset: () => void;
  count: number;
};

/** The done items of one checklist, shared live between every component on the page that uses the same key. */
export function useChecklist(key: string): Checklist {
  const [ids, setIds] = useState<string[]>(() => (typeof window === "undefined" ? [] : read(key)));
  useEffect(() => {
    setIds(read(key));
    const onChange = (e: Event) => { if ((e as CustomEvent).detail === key) setIds(read(key)); };
    const onStorage = (e: StorageEvent) => { if (e.key === PREFIX + key) setIds(read(key)); };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onStorage); };
  }, [key]);
  const toggle = useCallback((id: string, on?: boolean) => {
    const current = read(key);
    const has = current.includes(id);
    const next = on ?? !has;
    if (next === has) return;
    write(key, next ? [...current, id] : current.filter((x) => x !== id));
  }, [key]);
  const reset = useCallback(() => write(key, []), [key]);
  const done = new Set(ids);
  return { done, isDone: (id) => done.has(id), toggle, reset, count: done.size };
}

/** "3 of 8 done" — the progress line every checklist shows. */
export const progressLabel = (done: number, total: number) => `${done} of ${total} done`;
