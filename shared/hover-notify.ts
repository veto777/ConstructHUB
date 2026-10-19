/**
 * "New HOVER report" owner notification — which states it fires for (owner, 2026-10-19: "when a new report hits
 * HOVER, the CRM for WA should send the owner account a notification").
 *
 * The channel switches (in-app / email / text) live with every other notification in notificationPrefs under the
 * key "hoverReportReady". THIS file is the scope: `customFields.notificationScopes.hoverReportReady.states` lists
 * the two-letter states that ring; absent (or empty) means every report, wherever it is.
 *
 * A report whose state is unknown (HOVER sent no address state and the client has none) always rings — a missed
 * report costs more than a spare notification, and the title says the state is unknown.
 */
export type HoverNotifyScope = { states: string[] };

export const HOVER_NOTIFY_SCOPE_KEY = "hoverReportReady";

/** The states the owner asked to hear about, uppercased and deduplicated; null = every state. */
export function hoverNotifyStatesOf(customFields: unknown): string[] | null {
  const scopes = (customFields as Record<string, unknown> | null | undefined)?.notificationScopes;
  const scope = scopes && typeof scopes === "object" ? (scopes as Record<string, unknown>)[HOVER_NOTIFY_SCOPE_KEY] : undefined;
  const raw = scope && typeof scope === "object" ? (scope as Record<string, unknown>).states : undefined;
  if (!Array.isArray(raw)) return null;
  const states = [...new Set(raw.map((s) => String(s ?? "").trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))];
  return states.length ? states : null;
}

/** Does a report in `state` (null = unknown) ring under this org's scope? */
export function hoverReportWanted(customFields: unknown, state: string | null | undefined): boolean {
  const states = hoverNotifyStatesOf(customFields);
  if (!states) return true;
  const s = String(state ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return true; // unknown → ring, never silently drop
  return states.includes(s);
}
