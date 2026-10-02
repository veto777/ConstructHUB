/**
 * The signed-in dashboard's per-user preferences, shared by the server (which
 * stores and applies them) and the client (which edits them):
 *
 *   - the layout: which tiles show, in what order, grouped or as one list, and
 *     which page sections show ("Customize dashboard");
 *   - cleared and snoozed "Needs you today" items.
 *
 * Both are stored server-side per user (dashboard_prefs, dashboard_dismissals)
 * so they follow the account across devices. Pure: no I/O here.
 */
import {
  DASHBOARD_GROUPS, DASHBOARD_TILES, DASHBOARD_TILE_KEYS,
  type DashboardAttentionItem, type DashboardGroupKey, type DashboardTileKey,
} from "./dashboard";
import type { PlanKey } from "./plans";

// ---------------------------------------------------------------------------
// Sections

export type DashboardSectionKey = "needs" | "crm" | "checklist" | "usage" | "recent" | "gabe";

export const DASHBOARD_SECTIONS: readonly { key: DashboardSectionKey; label: string; description: string }[] = [
  { key: "needs", label: "Needs you today", description: "The numbers that want action, at the top of the page." },
  { key: "crm", label: "CRM snapshot", description: "Pipeline, estimates, leads and today's visits." },
  { key: "checklist", label: "Getting started", description: "The setup checklist, until every step is done." },
  { key: "usage", label: "Plan usage", description: "This month's meters against your plan." },
  { key: "recent", label: "Recent activity", description: "Your latest alerts and CRM team activity." },
  { key: "gabe", label: "Ask Gabe", description: "A suggested question for the assistant." },
];
export const DASHBOARD_SECTION_KEYS: readonly DashboardSectionKey[] = DASHBOARD_SECTIONS.map((s) => s.key);

/** Rendered as the CRM snapshot card (the "crm" section), never as grid tiles. */
export const DASHBOARD_CRM_CARD_TILES: ReadonlySet<DashboardTileKey> = new Set(["crm", "crmLeads", "crmSchedule"]);

// ---------------------------------------------------------------------------
// Layout

export type DashboardLayout = {
  /** Every catalogue tile, in the user's order. */
  order: DashboardTileKey[];
  /** Tiles the user turned off: never computed, never shown. */
  hidden: DashboardTileKey[];
  sections: Record<DashboardSectionKey, boolean>;
  /**
   * true: tiles under their group headings — groups in the order their first
   * tile appears in `order`, tiles in `order` within each group.
   * false: one list in `order`.
   */
  keepGroups: boolean;
};

/** A tile the user hid: not computed, so only whether the plan includes it (for the Customize sheet). */
export type DashboardHiddenTile = {
  key: DashboardTileKey;
  entitled: boolean;
  requiredPlan?: PlanKey;
  comingSoon?: boolean;
};

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = Object.freeze({
  order: [...DASHBOARD_TILE_KEYS],
  hidden: [],
  sections: Object.fromEntries(DASHBOARD_SECTION_KEYS.map((k) => [k, true])) as Record<DashboardSectionKey, boolean>,
  keepGroups: true,
}) as DashboardLayout;

export const defaultDashboardLayout = (): DashboardLayout => ({
  order: [...DEFAULT_DASHBOARD_LAYOUT.order],
  hidden: [],
  sections: { ...DEFAULT_DASHBOARD_LAYOUT.sections },
  keepGroups: true,
});

/** Input caps for PUT /api/dashboard/layout (well above the catalogue, so a newer client never trips them). */
export const DASHBOARD_LAYOUT_MAX_KEYS = 100;
export const DASHBOARD_LAYOUT_MAX_KEY_LENGTH = 60;

const TILE_KEY_SET: ReadonlySet<string> = new Set(DASHBOARD_TILE_KEYS);
const GROUP_OF = new Map<DashboardTileKey, DashboardGroupKey>(DASHBOARD_TILES.map((t) => [t.key, t.group]));

const tileKeys = (v: unknown): DashboardTileKey[] => {
  if (!Array.isArray(v)) return [];
  const out: DashboardTileKey[] = [];
  for (const k of v.slice(0, DASHBOARD_LAYOUT_MAX_KEYS)) {
    if (typeof k === "string" && TILE_KEY_SET.has(k) && !out.includes(k as DashboardTileKey)) out.push(k as DashboardTileKey);
  }
  return out;
};

/**
 * Any stored or sent layout → a complete, valid one. Unknown tile keys and
 * duplicates are dropped; catalogue tiles missing from `order` (a tile added
 * after the user saved) go last; a section not mentioned is on.
 */
export function normalizeDashboardLayout(input: unknown): DashboardLayout {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const order = tileKeys(raw.order);
  // Catalogue tiles the saved order doesn't name (a tile added since) go last,
  // in catalogue order; grouped, that is the end of their own group.
  for (const key of DASHBOARD_TILE_KEYS) if (!order.includes(key)) order.push(key);
  const sectionsIn = (raw.sections && typeof raw.sections === "object" ? raw.sections : {}) as Record<string, unknown>;
  const sections = {} as Record<DashboardSectionKey, boolean>;
  for (const k of DASHBOARD_SECTION_KEYS) sections[k] = typeof sectionsIn[k] === "boolean" ? (sectionsIn[k] as boolean) : true;
  const layout: DashboardLayout = {
    order,
    hidden: tileKeys(raw.hidden),
    sections,
    keepGroups: typeof raw.keepGroups === "boolean" ? raw.keepGroups : true,
  };
  return layout.keepGroups ? { ...layout, order: groupContiguous(layout.order) } : layout;
}

/**
 * PUT /api/dashboard/layout body check: the shape and the size caps. Unknown
 * tile and section keys are ignored (a newer or older client), never an error.
 */
export function parseDashboardLayoutInput(input: unknown): { ok: true; layout: DashboardLayout } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Send the layout as an object.");
  const raw = input as Record<string, unknown>;
  for (const field of ["order", "hidden"] as const) {
    const v = raw[field];
    if (v === undefined) continue;
    if (!Array.isArray(v)) return bad(`"${field}" must be a list of tile keys.`);
    if (v.length > DASHBOARD_LAYOUT_MAX_KEYS) return bad(`"${field}" has more than ${DASHBOARD_LAYOUT_MAX_KEYS} entries.`);
    if (v.some((k) => typeof k !== "string" || k.length > DASHBOARD_LAYOUT_MAX_KEY_LENGTH)) return bad(`"${field}" must be a list of tile keys.`);
  }
  if (raw.sections !== undefined) {
    if (!raw.sections || typeof raw.sections !== "object" || Array.isArray(raw.sections)) return bad(`"sections" must be an object.`);
    const entries = Object.entries(raw.sections as Record<string, unknown>);
    if (entries.length > 20) return bad(`"sections" has too many entries.`);
    if (entries.some(([, v]) => typeof v !== "boolean")) return bad(`Each section must be on (true) or off (false).`);
  }
  if (raw.keepGroups !== undefined && typeof raw.keepGroups !== "boolean") return bad(`"keepGroups" must be true or false.`);
  return { ok: true, layout: normalizeDashboardLayout(raw) };
}

export function isDefaultDashboardLayout(layout: DashboardLayout): boolean {
  const d = DEFAULT_DASHBOARD_LAYOUT;
  return layout.keepGroups === d.keepGroups
    && layout.hidden.length === 0
    && layout.order.length === d.order.length && layout.order.every((k, i) => k === d.order[i])
    && DASHBOARD_SECTION_KEYS.every((k) => layout.sections[k] === d.sections[k]);
}

/** Groups in the order their first tile appears, each with its tiles in `order`. */
export function dashboardGroupsInOrder(order: readonly DashboardTileKey[]): { key: DashboardGroupKey; tiles: DashboardTileKey[] }[] {
  const groups: { key: DashboardGroupKey; tiles: DashboardTileKey[] }[] = [];
  for (const key of order) {
    const g = GROUP_OF.get(key);
    if (!g) continue;
    let entry = groups.find((x) => x.key === g);
    if (!entry) { entry = { key: g, tiles: [] }; groups.push(entry); }
    entry.tiles.push(key);
  }
  // A group with no tile in `order` (never, after normalize) keeps its catalogue place at the end.
  for (const g of DASHBOARD_GROUPS) if (!groups.some((x) => x.key === g.key)) groups.push({ key: g.key, tiles: [] });
  return groups;
}

/** `order` with each group's tiles side by side (the grouped view's flat form). */
export function groupContiguous(order: readonly DashboardTileKey[]): DashboardTileKey[] {
  return dashboardGroupsInOrder(order).flatMap((g) => g.tiles);
}

/** Sort anything keyed by tile into the layout's order. */
export function sortByDashboardLayout<T extends { key: DashboardTileKey }>(items: readonly T[], layout: DashboardLayout): T[] {
  const pos = new Map(layout.order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (pos.get(a.key) ?? 1e6) - (pos.get(b.key) ?? 1e6));
}

// ---------------------------------------------------------------------------
// Cleared and snoozed "Needs you today" items

/**
 * A cleared item: hidden while the item still has the value it had when it was
 * cleared (`value`, see attentionSignature) and, for a snooze, until `until`.
 * A changed value (3 reviews awaiting a reply → 4) brings it back at once.
 */
export type DashboardDismissal = {
  key: string;
  value: string;
  /** End of a snooze (ISO); null = "Done" (until the value changes). */
  until: string | null;
  at: string;
};

/** A cleared item that still holds: shown under "Show cleared (N)" with a Restore button. */
export type DashboardClearedItem = DashboardAttentionItem & { signature: string; until: string | null };

export const DASHBOARD_DISMISSALS_MAX = 100;
export const DASHBOARD_DISMISS_BATCH_MAX = 50;
export const DASHBOARD_SNOOZE_MAX_DAYS = 31;
export const DASHBOARD_DISMISS_KEY_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
export const DASHBOARD_DISMISS_VALUE_MAX = 200;

/**
 * What an item's situation is, as one string: its value and, for a meter, its
 * limit ("3", "12/10", "Growth"). Clearing stores it; any change brings the item back.
 */
export function attentionSignature(item: Pick<DashboardAttentionItem, "value" | "limit">): string {
  const v = item.value === null || item.value === undefined ? "" : String(item.value);
  return (item.limit !== undefined ? `${v}/${item.limit}` : v).slice(0, DASHBOARD_DISMISS_VALUE_MAX);
}

/** Is this dismissal still in force for this item now? */
export function dismissalHolds(item: DashboardAttentionItem, d: DashboardDismissal | undefined, now: Date): boolean {
  if (!d || d.key !== item.key) return false;
  if (d.value !== attentionSignature(item)) return false;
  if (d.until !== null && !(Date.parse(d.until) > now.getTime())) return false;
  return true;
}

/**
 * Split the action list into what shows and what the user cleared. `stale`
 * names dismissals that no longer hold for an item on the list (its value
 * changed or its snooze ended): the server forgets them, so a value that later
 * returns to the old number counts as new.
 */
export function splitAttention(
  items: readonly DashboardAttentionItem[], dismissals: readonly DashboardDismissal[], now: Date,
): { attention: DashboardAttentionItem[]; cleared: DashboardClearedItem[]; stale: string[] } {
  const byKey = new Map(dismissals.map((d) => [d.key, d]));
  const attention: DashboardAttentionItem[] = [];
  const cleared: DashboardClearedItem[] = [];
  const stale: string[] = [];
  for (const item of items) {
    const d = byKey.get(item.key);
    if (dismissalHolds(item, d, now)) cleared.push({ ...item, signature: attentionSignature(item), until: d!.until });
    else {
      if (d) stale.push(d.key);
      attention.push(item);
    }
  }
  // Snoozes that ended for an item that is gone too.
  for (const d of dismissals) {
    if (d.until !== null && !(Date.parse(d.until) > now.getTime()) && !stale.includes(d.key)) stale.push(d.key);
  }
  return { attention, cleared, stale };
}

export type DashboardDismissInput = { key: string; value: string; until?: string | null };

/** PUT /api/dashboard/dismissals body check. */
export function parseDismissInput(input: unknown, now: Date): { ok: true; items: { key: string; value: string; until: string | null }[] } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  const list = (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(list) || list.length === 0) return bad("Send the items to clear.");
  if (list.length > DASHBOARD_DISMISS_BATCH_MAX) return bad(`Clear at most ${DASHBOARD_DISMISS_BATCH_MAX} items at once.`);
  const out = new Map<string, { key: string; value: string; until: string | null }>();
  const maxUntil = now.getTime() + DASHBOARD_SNOOZE_MAX_DAYS * 86_400_000;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return bad("Each item needs a key and a value.");
    const { key, value, until } = raw as Record<string, unknown>;
    if (typeof key !== "string" || !DASHBOARD_DISMISS_KEY_RE.test(key)) return bad("Unknown item.");
    if (typeof value !== "string" || value.length > DASHBOARD_DISMISS_VALUE_MAX) return bad("Each item needs its current value.");
    let end: string | null = null;
    if (until !== undefined && until !== null) {
      const t = typeof until === "string" && until.length <= 40 ? Date.parse(until) : NaN;
      if (!Number.isFinite(t)) return bad("The snooze end must be a date.");
      if (t <= now.getTime()) return bad("The snooze end must be in the future.");
      if (t > maxUntil) return bad(`Snooze for at most ${DASHBOARD_SNOOZE_MAX_DAYS} days.`);
      end = new Date(t).toISOString();
    }
    out.set(key, { key, value, until: end });
  }
  return { ok: true, items: Array.from(out.values()) };
}

/** Snooze ends, in the viewer's own clock: tomorrow 8 am, or a week from now at 8 am. */
export function snoozeUntil(choice: "tomorrow" | "week", now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + (choice === "tomorrow" ? 1 : 7));
  d.setHours(8, 0, 0, 0);
  return d;
}
