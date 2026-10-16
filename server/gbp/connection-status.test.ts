import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTION_LABEL, connectionAction, deriveGoogleConnection, lastSyncText, type GoogleConnectionLocationInput } from "@shared/gbp-connection";
import { loadGoogleConnection } from "./connection-status";
import { GBP_SCOPE } from "./client";

// The one Google-connection truth (review w2-agent10 #1): every page prints these words from this function.
const loc = (over: Partial<GoogleConnectionLocationInput> = {}): GoogleConnectionLocationInput => ({
  id: 3, name: "Alpine Exteriors", linked: true, subject: "sub-a", lastSuccess: null, reviewSavedAt: null, lastError: null, reviews: 0, ...over,
});

describe("deriveGoogleConnection", () => {
  it("says Not connected with no Google account and no linked location", () => {
    const c = deriveGoogleConnection({ grants: [], locations: [loc({ linked: false, subject: null })] });
    expect(c.state).toBe("not_connected");
    expect(c.label).toBe("Not connected");
    expect(c.lastSync).toBeNull();
    expect(c.locations[0].state).toBe("not_connected");
  });

  it("says Needs reconnect for a linked location whose Google account is gone, and keeps its last sync from saved reviews", () => {
    // The owner's real case: location 3 linked, 107 reviews saved by an earlier sync, the grant since removed.
    const c = deriveGoogleConnection({ grants: [], locations: [loc({ reviews: 107, reviewSavedAt: "2026-10-09T19:57:29Z" })] });
    expect(c.state).toBe("needs_reconnect");
    expect(c.label).toBe("Needs reconnect");
    expect(c.detail).toContain("Alpine Exteriors");
    expect(c.lastSync).toBe("2026-10-09T19:57:29.000Z");
    expect(c.locations[0]).toMatchObject({ state: "needs_reconnect", lastSync: "2026-10-09T19:57:29.000Z", reviews: 107 });
  });

  it("says Needs reconnect when the linked location's grant lost access", () => {
    const c = deriveGoogleConnection({ grants: [{ subject: "sub-a", email: "a@example.invalid", usable: false }], locations: [loc()] });
    expect(c.state).toBe("needs_reconnect");
    expect(c.locations[0].accountEmail).toBe("a@example.invalid");
    expect(c.accounts[0]).toMatchObject({ state: "needs_reconnect", label: "Needs reconnect" });
  });

  it("says Connected when the linked location's account works, with the newest sync time", () => {
    const c = deriveGoogleConnection({
      grants: [{ subject: "sub-a", email: "a@example.invalid", usable: true }],
      locations: [loc({ lastSuccess: new Date("2026-10-14T08:00:00Z"), reviewSavedAt: "2026-10-09T00:00:00Z" })],
    });
    expect(c.state).toBe("connected");
    expect(c.lastSync).toBe("2026-10-14T08:00:00.000Z");
    expect(c.counts).toEqual({ connected: 1, needs_reconnect: 0, not_connected: 0 });
  });

  it("one broken linked location makes the account Needs reconnect even when another works", () => {
    const c = deriveGoogleConnection({
      grants: [{ subject: "sub-a", email: "a@example.invalid", usable: true }],
      locations: [loc({ id: 1 }), loc({ id: 2, name: "Branch", subject: "sub-gone" })],
    });
    expect(c.state).toBe("needs_reconnect");
    expect(c.counts).toMatchObject({ connected: 1, needs_reconnect: 1 });
    expect(c.detail).toContain("Branch");
  });

  it("a legacy location with no recorded account syncs through the only account", () => {
    const c = deriveGoogleConnection({ grants: [{ subject: "sub-a", email: null, usable: true }], locations: [loc({ subject: null })] });
    expect(c.locations[0].state).toBe("connected");
  });

  it("an account with nothing linked is Connected, and the next step is linking a location", () => {
    const c = deriveGoogleConnection({ grants: [{ subject: "sub-a", email: null, usable: true }], locations: [loc({ linked: false })] });
    expect(c.state).toBe("connected");
    expect(c.detail).toMatch(/No location is linked/);
    expect(connectionAction(c)).toEqual({ label: "Link a location", href: "/locations" });
  });

  it("an unlinked location never carries a sync time", () => {
    const c = deriveGoogleConnection({ grants: [], locations: [loc({ linked: false, lastSuccess: "2026-10-01T00:00:00Z" })] });
    expect(c.locations[0].lastSync).toBeNull();
  });
});

describe("connectionAction and labels", () => {
  it("gives exactly one action per state", () => {
    expect(connectionAction({ state: "needs_reconnect", counts: { connected: 0, needs_reconnect: 1, not_connected: 0 } })).toEqual({ label: "Reconnect Google account", href: "/api/gbp/connect" });
    expect(connectionAction({ state: "not_connected", counts: { connected: 0, needs_reconnect: 0, not_connected: 1 } })).toEqual({ label: "Connect Google Business Profile", href: "/api/gbp/connect" });
    expect(connectionAction({ state: "connected", counts: { connected: 1, needs_reconnect: 0, not_connected: 0 } })).toBeNull();
  });
  it("uses the three words and never 'Never synced'", () => {
    expect(Object.values(GOOGLE_CONNECTION_LABEL)).toEqual(["Connected", "Needs reconnect", "Not connected"]);
    expect(lastSyncText(null)).toBe("No sync on record");
    expect(lastSyncText("2026-10-09T19:57:29Z")).toMatch(/^Last sync /);
  });
});

describe("loadGoogleConnection", () => {
  it("reads grants (scope + reconnect flag) and linked locations through the injected query", async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM gbp_grants")) return [
        { google_subject: "sub-a", email: "a@example.invalid", scopes: [GBP_SCOPE], reconnect_required: false },
        { google_subject: "sub-b", email: "b@example.invalid", scopes: [], reconnect_required: false },
      ];
      return [
        { id: 1, business_name: "Main", linked: true, gbp_google_subject: "sub-a", last_success: "2026-10-14T08:00:00Z", last_error: null, review_saved_at: null, reviews: 4 },
        { id: 2, business_name: "Branch", linked: true, gbp_google_subject: "sub-b", last_success: null, last_error: "auth", review_saved_at: null, reviews: "0" },
      ];
    };
    const c = await loadGoogleConnection(7, { query });
    expect(calls).toHaveLength(2);
    expect(c.locations.map((l) => l.state)).toEqual(["connected", "needs_reconnect"]);
    // A grant without the Business Profile scope is not usable, exactly like server/gbp/grants.ts.
    expect(c.accounts.map((a) => a.state)).toEqual(["connected", "needs_reconnect"]);
    expect(c.state).toBe("needs_reconnect");
    expect(c.lastSync).toBe("2026-10-14T08:00:00.000Z");
  });
});
