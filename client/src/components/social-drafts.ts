/** Account-scoped Social Media drafts that survive navigation and business switches.
 *
 * Row edits and in-progress compositions used to live only in page state: following "How it works"
 * or pressing Back unmounted the page, and switching businesses remounted the workbench — both
 * silently discarded the work. This store keeps the drafts per account and per business in
 * sessionStorage, with a try/catch + in-memory fallback, so blocked storage degrades to
 * visit-only persistence instead of losing the edit. Posting or scheduling clears the draft.
 */
import { destinationSchema, type Destination } from "@shared/social";

export type ComposerDraft = {
  text: string;
  tweaks: Record<string, string>;
  destinations: Destination[];
  mediaText: string;
  schedule: string;
};

const VERSION = "v1";
const key = (accountId: string | number, part: string) =>
  `constructhub.social-drafts.${VERSION}.user:${encodeURIComponent(String(accountId))}.${part}`;

// Memory wins over storage once written: after a quota/security failure it holds the newest state
// for the visit, and it never resurrects stale storage over a newer in-memory write.
const memory = new Map<string, string>();
const readRaw = (k: string): string | null => {
  if (memory.has(k)) return memory.get(k)!;
  try {
    return window.sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeRaw = (k: string, raw: string | null): void => {
  if (raw === null) {
    memory.delete(k);
    try {
      window.sessionStorage.removeItem(k);
    } catch { /* visit-only: the memory delete above is all we can do */ }
    return;
  }
  memory.set(k, raw);
  try {
    window.sessionStorage.setItem(k, raw);
  } catch { /* blocked storage: the memory write above keeps it for the visit */ }
};
const parseJson = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const asTweaks = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, item]) => typeof item === "string")) as Record<string, string>)
    : {};
const asDestinations = (v: unknown): Destination[] =>
  Array.isArray(v)
    ? v
        .map((d) => destinationSchema.safeParse(d))
        .filter((r) => r.success)
        .map((r) => r.data)
    : [];

export const isEmptyComposerDraft = (d: ComposerDraft): boolean =>
  !d.text && !d.mediaText && !d.schedule && !Object.keys(d.tweaks).length && !d.destinations.length;

export function loadComposerDraft(accountId: string | number | null | undefined, businessId: string): ComposerDraft | null {
  if (accountId === null || accountId === undefined) return null;
  const raw = parseJson(readRaw(key(accountId, `composer.${businessId}`)));
  if (!raw) return null;
  const draft: ComposerDraft = {
    text: asText(raw.text),
    tweaks: asTweaks(raw.tweaks),
    destinations: asDestinations(raw.destinations),
    mediaText: asText(raw.mediaText),
    schedule: asText(raw.schedule),
  };
  // An empty composer means "nothing in progress" — treat it as no draft so the saved mapping
  // (not an empty stash) drives the destination checkboxes on the next visit.
  return isEmptyComposerDraft(draft) ? null : draft;
}

export function saveComposerDraft(accountId: string | number | null | undefined, businessId: string, draft: ComposerDraft): void {
  if (accountId === null || accountId === undefined) return;
  writeRaw(key(accountId, `composer.${businessId}`), isEmptyComposerDraft(draft) ? null : JSON.stringify(draft));
}

/** Edited draft text keyed by post id, hoisted above the page so it survives full unmounts. */
export function loadRowEdits(accountId: string | number | null | undefined): Record<string, string> {
  if (accountId === null || accountId === undefined) return {};
  const raw = parseJson(readRaw(key(accountId, "rowEdits")));
  return raw ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>) : {};
}

export function saveRowEdits(accountId: string | number | null | undefined, edits: Record<string, string>): void {
  if (accountId === null || accountId === undefined) return;
  writeRaw(key(accountId, "rowEdits"), Object.keys(edits).length ? JSON.stringify(edits) : null);
}
