/**
 * The one answer to "is this account connected to Google Business Profile?" (review w2-agent10 #1).
 *
 * Every page that shows the Google connection — Google Business overview, Locations, the home dashboard,
 * Google Reviews, Posts / Photos / Listing editor — reads this shape (server/gbp/connection-status.ts serves
 * it at GET /api/gbp/connection and inside /api/gbp/status) and prints the same three words.
 *
 * Pure: no DB, no fetch. The server loader passes the gbp_grants rows, the linked locations and their
 * sync times; this decides the state.
 */

export type GoogleConnectionState = "connected" | "needs_reconnect" | "not_connected";

/** The only words any page uses for the state. */
export const GOOGLE_CONNECTION_LABEL: Record<GoogleConnectionState, string> = {
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  not_connected: "Not connected",
};

export type GoogleConnectionGrantInput = {
  subject: string;
  email: string | null;
  /** Business Profile scope granted and Google has not revoked it (server/gbp/grants.ts `usable`). */
  usable: boolean;
};

export type GoogleConnectionLocationInput = {
  id: number;
  name: string;
  /** business_locations.gbp_location_name is set: the location is tied to a Google listing. */
  linked: boolean;
  /** business_locations.gbp_google_subject: the Google account it syncs through (null on legacy rows). */
  subject: string | null;
  /** max(gbp_sync_status.last_success) for the location. */
  lastSuccess: string | Date | null;
  /** Newest Google review row saved for the location: a sync wrote it, so a sync ran at least then. */
  reviewSavedAt: string | Date | null;
  lastError: string | null;
  /** Google reviews saved for the location (not removed by Google). */
  reviews: number;
};

export type GoogleConnectionLocation = {
  id: number;
  name: string;
  state: GoogleConnectionState;
  label: string;
  accountEmail: string | null;
  /** ISO; null = no sync on record. */
  lastSync: string | null;
  lastError: string | null;
  reviews: number;
};

export type GoogleConnection = {
  state: GoogleConnectionState;
  label: string;
  /** One plain sentence: why the state is what it is. */
  detail: string;
  /** Newest sync across the linked locations (ISO), null when none is on record. */
  lastSync: string | null;
  accounts: { subject: string; email: string | null; state: GoogleConnectionState; label: string }[];
  locations: GoogleConnectionLocation[];
  counts: Record<GoogleConnectionState, number>;
};

const toIso = (v: string | Date | null | undefined): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const newest = (...values: (string | null)[]): string | null =>
  values.filter((v): v is string => !!v).sort().pop() ?? null;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deriveGoogleConnection(input: {
  grants: GoogleConnectionGrantInput[];
  locations: GoogleConnectionLocationInput[];
}): GoogleConnection {
  const { grants } = input;
  // A legacy location with no recorded account syncs through the user's only account (grants.ts soleSubject).
  const grantFor = (subject: string | null) => subject ? grants.find((g) => g.subject === subject) : grants.length === 1 ? grants[0] : undefined;

  const locations: GoogleConnectionLocation[] = input.locations.map((l) => {
    const grant = l.linked ? grantFor(l.subject) : undefined;
    const state: GoogleConnectionState = !l.linked ? "not_connected" : grant?.usable ? "connected" : "needs_reconnect";
    return {
      id: l.id, name: l.name, state, label: GOOGLE_CONNECTION_LABEL[state],
      accountEmail: grant?.email ?? null,
      lastSync: l.linked ? newest(toIso(l.lastSuccess), toIso(l.reviewSavedAt)) : null,
      lastError: l.linked ? l.lastError : null,
      reviews: l.reviews,
    };
  });
  const counts = { connected: 0, needs_reconnect: 0, not_connected: 0 } as Record<GoogleConnectionState, number>;
  for (const l of locations) counts[l.state]++;

  const accounts = grants.map((g) => {
    const state: GoogleConnectionState = g.usable ? "connected" : "needs_reconnect";
    return { subject: g.subject, email: g.email, state, label: GOOGLE_CONNECTION_LABEL[state] };
  });
  const usableAccounts = grants.filter((g) => g.usable).length;

  let state: GoogleConnectionState;
  let detail: string;
  const broken = locations.filter((l) => l.state === "needs_reconnect");
  if (broken.length) {
    // A linked listing whose Google access is gone: its reviews and stats stop updating until reconnect.
    state = "needs_reconnect";
    const who = broken.length === 1 ? broken[0].name : plural(broken.length, "linked location");
    detail = `Google access for ${who} ended. Reconnect the Google account that manages ${broken.length === 1 ? "it" : "them"} to sync and publish again.`;
  } else if (counts.connected) {
    state = "connected";
    detail = `${plural(counts.connected, "location")} syncing from Google.`;
  } else if (usableAccounts) {
    state = "connected";
    detail = "Google account connected. No location is linked to its listing yet.";
  } else if (grants.length) {
    state = "needs_reconnect";
    detail = "Google access for your account ended. Reconnect it to sync and publish again.";
  } else {
    state = "not_connected";
    detail = "No Google Business Profile is connected yet.";
  }
  return {
    state, label: GOOGLE_CONNECTION_LABEL[state], detail,
    lastSync: newest(...locations.map((l) => l.lastSync)),
    accounts, locations, counts,
  };
}

/** "Last sync Oct 9, 2026, 3:57 PM" / "No sync on record" — the same words on every page. */
export function lastSyncText(iso: string | null | undefined): string {
  if (!iso) return "No sync on record";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `Last sync ${d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "No sync on record";
}

/** The one next step for the state: reconnect, connect, or link a location (null when nothing is missing). */
export function connectionAction(c: Pick<GoogleConnection, "state" | "counts">): { label: string; href: string } | null {
  if (c.state === "needs_reconnect") return { label: "Reconnect Google account", href: "/api/gbp/connect" };
  if (c.state === "not_connected") return { label: "Connect Google Business Profile", href: "/api/gbp/connect" };
  if (!c.counts.connected) return { label: "Link a location", href: "/locations" };
  return null;
}
