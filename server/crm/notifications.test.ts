/**
 * Notification preferences: the per-org switches in crm_orgs.custom_fields->
 * 'notificationPrefs' that gate the estimate-viewed/approved/declined and
 * invoice-paid emails (portal.ts / integrations.ts).
 *
 * The API tests require the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { crmNotificationEnabled, CRM_NOTIFICATION_PREFS } from "@shared/schema";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("crmNotificationEnabled (pure)", () => {
  it("defaults to ON for every preference when nothing is stored", () => {
    for (const pref of CRM_NOTIFICATION_PREFS) {
      expect(crmNotificationEnabled(null, pref)).toBe(true);
      expect(crmNotificationEnabled(undefined, pref)).toBe(true);
      expect(crmNotificationEnabled({}, pref)).toBe(true);
      expect(crmNotificationEnabled({ notificationPrefs: {} }, pref)).toBe(true);
    }
  });

  it("honours an explicit false and an explicit true", () => {
    const cf = { notificationPrefs: { estimateViewed: false, invoicePaid: true } };
    expect(crmNotificationEnabled(cf, "estimateViewed")).toBe(false);
    expect(crmNotificationEnabled(cf, "invoicePaid")).toBe(true);
    expect(crmNotificationEnabled(cf, "estimateApproved")).toBe(true);
  });

  it("treats malformed stored data as ON rather than silencing mail", () => {
    expect(crmNotificationEnabled("junk", "invoicePaid")).toBe(true);
    expect(crmNotificationEnabled({ notificationPrefs: "junk" }, "invoicePaid")).toBe(true);
  });
});

describe("notificationPrefs API (dev server)", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
  });

  it("persists prefs, merges instead of clobbering custom_fields, and restores", async () => {
    const before = await api("/api/crm/org", {}, cookie);
    expect(before.status).toBe(200);
    const priorCustomFields = before.body.customFields ?? {};

    // Turn one off.
    const off = await api("/api/crm/org", {
      method: "PATCH",
      body: JSON.stringify({ notificationPrefs: { estimateViewed: false } }),
    }, cookie);
    expect(off.status).toBe(200);
    expect(off.body.customFields.notificationPrefs.estimateViewed).toBe(false);

    // A second patch merges — the first pref (and any other custom_fields
    // keys, e.g. HCP import data) survive.
    const second = await api("/api/crm/org", {
      method: "PATCH",
      body: JSON.stringify({ notificationPrefs: { invoicePaid: false } }),
    }, cookie);
    expect(second.status).toBe(200);
    expect(second.body.customFields.notificationPrefs.estimateViewed).toBe(false);
    expect(second.body.customFields.notificationPrefs.invoicePaid).toBe(false);
    for (const k of Object.keys(priorCustomFields)) {
      if (k === "notificationPrefs") continue;
      expect(second.body.customFields[k]).toEqual(priorCustomFields[k]);
    }

    // Restore exactly what was there before (usually nothing).
    const restore = await api("/api/crm/org", {
      method: "PATCH",
      body: JSON.stringify({
        notificationPrefs: Object.fromEntries(
          CRM_NOTIFICATION_PREFS.map((p) => [p, (priorCustomFields as any).notificationPrefs?.[p] !== false]),
        ),
      }),
    }, cookie);
    expect(restore.status).toBe(200);
  });

  it("rejects unknown preference keys", async () => {
    const bad = await api("/api/crm/org", {
      method: "PATCH",
      body: JSON.stringify({ notificationPrefs: { smsWhenRaining: false } }),
    }, cookie);
    expect(bad.status).toBe(400);
  });
});
