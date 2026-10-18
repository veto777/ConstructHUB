/**
 * The client page's container layout (shared/client-page-layout.ts): the pure normalizer, and the org PATCH that
 * stores it (running dev server, pinned to the seeded second org so no other suite's custom_fields write races it).
 */
import { describe, it, expect } from "vitest";
import { CLIENT_SECTIONS, DEFAULT_CLIENT_PAGE_LAYOUT, normalizeClientPageLayout } from "@shared/client-page-layout";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const TEST_ORG = "b839980a-ad26-44d4-9e83-df427bd60fe8";

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

describe("normalizeClientPageLayout", () => {
  it("keeps a valid order, drops unknown keys and repeats, appends what is missing, never hides an unknown key", () => {
    const keys = CLIENT_SECTIONS.map((s) => s.key);
    expect(normalizeClientPageLayout(undefined)).toEqual(DEFAULT_CLIENT_PAGE_LAYOUT);
    const got = normalizeClientPageLayout({ order: ["payments", "bogus", "estimates", "payments"], hidden: ["jobcam", "nope", "jobcam"] });
    expect(got.order.slice(0, 2)).toEqual(["payments", "estimates"]);
    expect(got.order).toHaveLength(keys.length);
    expect(new Set(got.order).size).toBe(keys.length);
    expect(got.hidden).toEqual(["jobcam"]);
    expect(normalizeClientPageLayout("garbage")).toEqual(DEFAULT_CLIENT_PAGE_LAYOUT);
  });
});

describe("client page layout over the API (dev server)", () => {
  it("saves the order and hidden set normalized, /api/crm/me carries it, null resets", async () => {
    let { status, cookie } = await api("/api/crm/me");
    if (status !== 200) throw new Error(`dev server not reachable at ${BASE}`);
    const sw = await api("/api/crm/org/switch", { method: "POST", body: JSON.stringify({ orgId: TEST_ORG }) }, cookie);
    expect(sw.status).toBe(200);
    cookie = sw.cookie;
    try {
      const saved = await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ clientPageLayout: { order: ["invoices", "bogus", "estimates"], hidden: ["jobcam", "nope"] } }),
      }, cookie);
      expect(saved.status).toBe(200);
      const me = await api("/api/crm/me", {}, cookie);
      const layout = me.body.org.customFields.clientPageLayout;
      expect(layout.order.slice(0, 2)).toEqual(["invoices", "estimates"]);
      expect(layout.order).toHaveLength(CLIENT_SECTIONS.length);
      expect(layout.hidden).toEqual(["jobcam"]);
      // Shape is validated: a non-array order is a 400, not a stored mess.
      const bad = await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ clientPageLayout: { order: "estimates", hidden: [] } }) }, cookie);
      expect(bad.status).toBe(400);
    } finally {
      const reset = await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ clientPageLayout: null }) }, cookie);
      expect(reset.status).toBe(200);
      const me = await api("/api/crm/me", {}, cookie);
      expect(me.body.org.customFields.clientPageLayout).toBeUndefined();
    }
  });
});
