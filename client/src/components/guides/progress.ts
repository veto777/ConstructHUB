/** Shared progress for Guides and Master Class; no server sync or anonymous-to-account migration. */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { createProgressStore, type ProgressOptions } from "./progress-store";

// Older guide consumers use this conditional disclosure; Master Class uses the live list.note.
export const PROGRESS_NOTE = "Progress stays in this browser when storage is available; otherwise, only for this visit.";
const store = createProgressStore(() => typeof window === "undefined" ? undefined : window.localStorage);
const SERVER_SNAPSHOT = { ids: [], persistent: false } as const;
const DEFAULT_OPTIONS: ProgressOptions = {};

export type Checklist = {
  done: ReadonlySet<string>;
  isDone: (id: string) => boolean;
  toggle: (id: string, on?: boolean) => void;
  reset: () => void;
  count: number;
  note: string;
  ready: boolean;
  accountError: boolean;
  checkingAccount: boolean;
  checkAccount: () => void;
};

/** Keep stable IDs for unchanged items; give changed tasks new IDs. Explicit migrations retain only current IDs. */
export function useChecklist(key: string, options: ProgressOptions = DEFAULT_OPTIONS): Checklist {
  const auth = useQuery<{ id: number | string } | null>({ queryKey: ["/api/auth/me"] });
  const userId = auth.isSuccess ? auth.data?.id ?? null : null;
  const snapshot = useSyncExternalStore(store.subscribe, () => store.read(userId, key, options), () => SERVER_SNAPSHOT);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => store.storageChanged(event.key);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const toggle = useCallback((id: string, on?: boolean) => { if (auth.isSuccess) store.toggle(userId, key, id, on, options); }, [auth.isSuccess, userId, key, options]);
  const reset = useCallback(() => { if (auth.isSuccess) store.reset(userId, key, options); }, [auth.isSuccess, userId, key, options]);
  const done = new Set(auth.isSuccess ? snapshot.ids.filter((id) => !options.itemIds || options.itemIds.includes(id)) : []);
  const note = auth.isError ? "Account unavailable — progress is paused."
    : auth.isPending ? "Checking your account before saving progress…"
    : userId === null ? "Saved for this visit only — sign in to keep account-specific progress."
    : snapshot.persistent ? "Progress is saved for your account in this browser only."
    : "Saved for this visit only — browser storage is unavailable.";
  return { done, isDone: (id) => done.has(id), toggle, reset, count: done.size, note, ready: auth.isSuccess,
    accountError: auth.isError, checkingAccount: auth.isFetching, checkAccount: () => { void auth.refetch(); } };
}

export const progressLabel = (done: number, total: number) => `${done} of ${total} done`;
