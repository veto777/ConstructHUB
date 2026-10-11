/** Device-local, account-scoped progress. Unscoped legacy ticks are never attributed to a learner. */
export const CONTENT_VERSION = "2026-10-r4";
export type ProgressOptions = { version?: string; previousVersions?: readonly string[]; itemIds?: readonly string[] };
export type ProgressSnapshot = { ids: readonly string[]; persistent: boolean };
export const progressKey = (userId: string | number, key: string, version = CONTENT_VERSION) =>
  `constructhub.checklist.user:${encodeURIComponent(String(userId))}.${encodeURIComponent(key)}.v:${encodeURIComponent(version)}`;
const EMPTY: ProgressSnapshot = { ids: [], persistent: false };

export function createProgressStore(storage: () => Storage | undefined) {
  const memory = new Map<string, ProgressSnapshot>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const scopedKey = (userId: string | number | null, key: string, version?: string) => userId === null
    ? `visit:${encodeURIComponent(key)}:${version ?? CONTENT_VERSION}` : progressKey(userId, key, version);
  const parse = (raw: string | null): string[] => {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
  };
  const read = (userId: string | number | null, key: string, options: ProgressOptions = {}): ProgressSnapshot => {
    const scoped = scopedKey(userId, key, options.version);
    const cached = memory.get(scoped);
    if (cached) return cached;
    let snapshot = EMPTY;
    try {
      const device = userId === null ? undefined : storage();
      if (device) {
        let raw = device.getItem(scoped);
        // Migration is opt-in, stays within this learner namespace, and requires current stable IDs.
        if (raw === null && options.itemIds) {
          for (const version of options.previousVersions ?? []) {
            const previous = memory.get(scopedKey(userId, key, version));
            const old = previous ? JSON.stringify(previous.ids) : device.getItem(scopedKey(userId, key, version));
            if (old !== null) {
              raw = JSON.stringify(parse(old).filter((id) => options.itemIds!.includes(id)));
              snapshot = { ids: parse(raw), persistent: false };
              device.setItem(scoped, raw);
              break;
            }
          }
        }
        snapshot = { ids: parse(raw), persistent: true };
      }
    } catch { /* Access denied or corrupt storage: start with working visit-only progress. */ }
    // A version transition must also work when storage is blocked.
    if (!snapshot.persistent && options.itemIds) {
      const old = (options.previousVersions ?? []).map((v) => memory.get(scopedKey(userId, key, v))).find(Boolean);
      if (old) snapshot = { ids: old.ids.filter((id) => options.itemIds!.includes(id)), persistent: false };
    }
    memory.set(scoped, snapshot);
    return snapshot;
  };
  const write = (userId: string | number | null, key: string, ids: readonly string[], options: ProgressOptions = {}) => {
    const scoped = scopedKey(userId, key, options.version);
    // Memory wins even if storage still contains an older successful write.
    let persistent = false;
    try {
      const device = userId === null ? undefined : storage();
      if (device) { device.setItem(scoped, JSON.stringify(ids)); persistent = true; }
    } catch { /* Keep the new state in memory. */ }
    memory.set(scoped, { ids, persistent });
    emit();
  };
  return {
    read,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    toggle(userId: string | number | null, key: string, id: string, on?: boolean, options: ProgressOptions = {}) {
      if (options.itemIds && !options.itemIds.includes(id)) return;
      const current = read(userId, key, options).ids.filter((item) => !options.itemIds || options.itemIds.includes(item));
      const has = current.includes(id);
      const next = on ?? !has;
      if (has === next) return;
      write(userId, key, next ? [...current, id] : current.filter((item) => item !== id), options);
    },
    reset(userId: string | number | null, key: string, options: ProgressOptions = {}) { write(userId, key, [], options); },
    storageChanged(key: string | null) {
      for (const [scoped, value] of memory) {
        // Don't overwrite unsaved work after a quota/security failure in this tab.
        if (value.persistent && (key === null || scoped === key)) memory.delete(scoped);
      }
      emit();
    },
  };
}
