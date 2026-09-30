/**
 * Identity routes (server/crm/routes.ts) — validation + consent guarantees:
 *
 *   1. Saving the profile never records SMS consent. The My profile form has
 *      no disclosure and re-sends the phone on every save, so consent comes
 *      only from the disclosed opt-in (or a Text notification switch).
 *   2. The profile mobile must be a real number; it's stored as E.164.
 *   3. Validation failures answer with ONE readable sentence in `message`
 *      (never just "Invalid company profile" + a zod dump); `issues` stays.
 *   4. The company logo URL must be loadable: http(s) or our own upload path.
 *
 * Runs against the dev server (CRM_TEST_BASE_URL). Everything it changes on
 * the dev member / org is put back through the API.
 */
import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

const patch = (path: string, body: unknown, cookie?: string) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) }, cookie);

describe("CRM identity validation against the dev server", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
  });

  it("saving the profile with a phone never stamps SMS consent", async () => {
    const me = await api("/api/crm/me", {}, cookie);
    const original = me.body.member;
    const wasConsented = Boolean(original.smsConsentAt);
    try {
      await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: false }) }, cookie);

      // Exactly what the Team page sends: the whole form, phone included.
      const saved = await patch("/api/crm/profile", {
        displayName: original.displayName ?? "",
        title: original.title ?? "",
        phone: original.phone || "+1 555 010 0199",
      }, cookie);
      expect(saved.status).toBe(200);
      expect(saved.body.smsConsentAt).toBeNull();

      const after = await api("/api/crm/me", {}, cookie);
      expect(after.body.member.smsConsentAt).toBeNull();
      expect(after.body.member.smsConsentPhone).toBeNull();
    } finally {
      await patch("/api/crm/profile", { phone: original.phone ?? null }, cookie);
      if (wasConsented) {
        await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: true }) }, cookie);
      }
    }
  });

  it("profile mobile: junk is refused with a sentence, a real number is stored as E.164, blank clears", async () => {
    const me = await api("/api/crm/me", {}, cookie);
    const originalPhone = me.body.member.phone ?? null;
    try {
      const bad = await patch("/api/crm/profile", { phone: "abc" }, cookie);
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe("Enter a valid mobile number, e.g. +1 555 123 4567.");
      expect(Array.isArray(bad.body.issues)).toBe(true);

      const tooShort = await patch("/api/crm/profile", { phone: "12345" }, cookie);
      expect(tooShort.status).toBe(400);

      // Nothing was written by the refused saves.
      const still = await api("/api/crm/me", {}, cookie);
      expect(still.body.member.phone ?? null).toBe(originalPhone);

      const good = await patch("/api/crm/profile", { phone: "(555) 010-0123" }, cookie);
      expect(good.status).toBe(200);
      expect(good.body.phone).toBe("+15550100123");

      const cleared = await patch("/api/crm/profile", { phone: "   " }, cookie);
      expect(cleared.status).toBe(200);
      expect(cleared.body.phone).toBeNull();
    } finally {
      await patch("/api/crm/profile", { phone: originalPhone }, cookie);
    }
  });

  it("company validation answers with one readable sentence per field", async () => {
    const before = await api("/api/crm/org", {}, cookie);

    const email = await patch("/api/crm/org", { email: "not-an-email" }, cookie);
    expect(email.status).toBe(400);
    expect(email.body.message).toBe("Email must be a valid email address, like name@company.com.");
    expect(Array.isArray(email.body.issues)).toBe(true);

    const name = await patch("/api/crm/org", { name: "" }, cookie);
    expect(name.status).toBe(400);
    expect(name.body.message).toBe("Business name can't be blank.");

    const deposit = await patch("/api/crm/org", { defaultDepositBps: 15000 }, cookie);
    expect(deposit.status).toBe(400);
    expect(deposit.body.message).toBe("Default deposit must be at most 100%.");

    // Cents read as dollars, never the stored integer. Validation runs before
    // any member lookup, so this refused PATCH writes nothing.
    const me = await api("/api/crm/me", {}, cookie);
    const cost = await patch(`/api/crm/members/${me.body.member.id}`, { hourlyCostCents: 100_000_01 }, cookie);
    expect(cost.status).toBe(400);
    expect(cost.body.message).toBe("Cost rate must be at most $100,000.");

    const theme = await patch("/api/crm/org", { themeColor: "not-a-theme" }, cookie);
    expect(theme.status).toBe(400);
    expect(theme.body.message).toBe("Unknown theme colour");

    // None of the refused writes landed.
    const after = await api("/api/crm/org", {}, cookie);
    expect(after.body.email).toBe(before.body.email);
    expect(after.body.name).toBe(before.body.name);
    expect(after.body.defaultDepositBps).toBe(before.body.defaultDepositBps);
  });

  it("logo URL: free text is refused; https and our own upload path are accepted", async () => {
    const before = await api("/api/crm/org", {}, cookie);
    const originalLogo = before.body.logoUrl ?? null;
    try {
      const bad = await patch("/api/crm/org", { logoUrl: "not a url" }, cookie);
      expect(bad.status).toBe(400);
      expect(bad.body.message).toContain("Logo URL must be a full web address");

      const js = await patch("/api/crm/org", { logoUrl: "javascript:alert(1)" }, cookie);
      expect(js.status).toBe(400);

      const https = await patch("/api/crm/org", { logoUrl: "https://example.com/FIX-c16-logo.png" }, cookie);
      expect(https.status).toBe(200);
      expect(https.body.logoUrl).toBe("https://example.com/FIX-c16-logo.png");

      const own = await patch("/api/crm/org", { logoUrl: "/api/crm/org-logos/FIX-c16.png" }, cookie);
      expect(own.status).toBe(200);

      const cleared = await patch("/api/crm/org", { logoUrl: null }, cookie);
      expect(cleared.status).toBe(200);
      expect(cleared.body.logoUrl).toBeNull();
    } finally {
      await patch("/api/crm/org", { logoUrl: originalLogo }, cookie);
    }
  });
});
