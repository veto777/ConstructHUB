/**
 * Client helpers for the price book that must agree with the server:
 * ranking-grid credit costs, usage meters, the plan-answer links the Toaster
 * adds, and the saved-credential sources behind Settings → API keys.
 * Pure modules only — no dev server, no database.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("./db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) }, db: {} }));
vi.mock("./growth-limits", () => ({ takeBudget: vi.fn() }));

import { gridCreditCost as serverGridCreditCost } from "./growth-quotas";
import { ADDONS, PLANS, PLAN_KEYS } from "../shared/plans";
import { creditsLabel, gridCreditCost, usageLine, usagePercent, USAGE_METERS } from "../client/src/lib/pricing-display";
import {
  apiErrorCode, apiErrorInfo, planPromptFor, planPromptFromBody, rememberPlanPrompt, BILLING_SETTINGS_HREF,
} from "../client/src/lib/plan-errors";
import { CREDENTIAL_SOURCES, disconnectMessage, fetchOptionalList } from "../client/src/lib/saved-credentials";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

describe("ranking-grid credits on the client", () => {
  it("cost exactly what the server charges for every size the picker offers", () => {
    for (const size of [1, 3, 5, 7, 9, 11, 13, 15, 21]) expect(gridCreditCost(size)).toBe(serverGridCreditCost(size));
    expect([3, 5, 7, 9, 11, 13, 15].map(gridCreditCost)).toEqual([1, 1, 2, 4, 5, 7, 9]);
  });

  it("labels credits in the singular and plural", () => {
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(4)).toBe("4 credits");
  });

  it("the size picker shows each size's credit cost", () => {
    const page = read("client/src/pages/ranking-grid.tsx");
    expect(page).toContain("creditsLabel(gridCreditCost(n))");
    expect(page).not.toMatch(/label: "\d+×\d+ \(\d+ points\)"/);
  });
});

describe("usage meters", () => {
  it("reads finite, unlimited and not-included allowances", () => {
    expect(usageLine({ used: 12, limit: 100 })).toBe("12 of 100 used");
    expect(usageLine({ used: 1234, limit: 5000 })).toBe("1,234 of 5,000 used");
    expect(usageLine({ used: 3, limit: -1 })).toBe("3 used · fair use");
    expect(usageLine({ used: 0, limit: 0 })).toBeNull();
    expect(usageLine(undefined)).toBeNull();
    expect(usagePercent({ used: 5, limit: 20 })).toBe(25);
    expect(usagePercent({ used: 30, limit: 20 })).toBe(100);
    expect(usagePercent({ used: 3, limit: -1 })).toBeNull();
    // A platform admin's -1 reads as unlimited, never "12 of -1" or a full bar.
    expect(usageLine({ used: 12, limit: -1 }, true)).toBe("12 used · unlimited");
    expect(usageLine({ used: 12, limit: 10 }, true)).toBe("12 of 10 used");
  });

  it("Limits & usage and Billing say 'Unlimited' for a platform admin, with nothing to buy", () => {
    const limits = read("client/src/pages/settings/limits-usage.tsx");
    expect(limits).toContain('export const ADMIN_UNLIMITED = "Unlimited";');
    expect(limits).toContain("const admin = entitlements.isPlatformAdmin === true;");
    // No add-on rows on an all-access account, and Agency's per-location wording is not the admin's.
    expect(limits).toContain("const addon = !admin && row.addon");
    expect(limits).toContain('const isAgency = plan === "agency" && !admin;');
    const billing = read("client/src/pages/settings/plan-billing.tsx");
    expect(billing).toContain("usageLine(meter, admin)");
    const overview = read("client/src/pages/crm-call-assistant/overview.tsx");
    expect(overview).toContain('unlimitedMinutes ? "Unlimited minutes"');
  });

  it("cover every monthly meter the server reports", () => {
    const quotas = read("server/growth-quotas.ts");
    for (const m of USAGE_METERS) expect(quotas).toMatch(new RegExp(`\\b${m.key}: \\{ what:`));
  });
});

describe("plan answers become links", () => {
  it("plan_required points to Pricing, naming the plan", () => {
    expect(planPromptFromBody({ code: "plan_required", requiredPlan: "pro", message: "x" }))
      .toEqual({ label: `See ${PLANS.pro.name}`, href: "/pricing" });
    expect(planPromptFromBody({ code: "plan_required", requiredPlan: "platinum", message: "x" }))
      .toEqual({ label: "See plans", href: "/pricing" });
  });

  it("limit_reached prefers the add-on (bought in Settings → Billing), then the next plan, else nothing", () => {
    expect(planPromptFromBody({ code: "limit_reached", addon: "competitor_pack", upgradePlan: "growth", message: "x" }))
      .toEqual({ label: `Add ${ADDONS.competitor_pack.name.toLowerCase()}`, href: BILLING_SETTINGS_HREF });
    expect(planPromptFromBody({ code: "limit_reached", addon: null, upgradePlan: "growth", message: "x" }))
      .toEqual({ label: `See ${PLANS.growth.name}`, href: "/pricing" });
    expect(planPromptFromBody({ code: "limit_reached", addon: null, upgradePlan: null, message: "x" })).toBeNull();
  });

  it("a declined card points to billing; other bodies get nothing", () => {
    expect(planPromptFromBody({ code: "payment_failed", message: "x" })).toEqual({ label: "Manage billing", href: BILLING_SETTINGS_HREF });
    expect(planPromptFromBody({ code: "talk_to_sales", message: "x" })).toBeNull();
    expect(planPromptFromBody({ message: "Not found" })).toBeNull();
    expect(planPromptFromBody(null)).toBeNull();
  });

  it("remembers the link for exactly the message a toast will show", () => {
    const message = "I- Competitor Intel is included with the Pro plan. Upgrade in Pricing to use it.";
    expect(planPromptFor(message)).toBeNull();
    rememberPlanPrompt({ code: "plan_required", requiredPlan: "pro", message });
    expect(planPromptFor(message)).toEqual({ label: `See ${PLANS.pro.name}`, href: "/pricing" });
    expect(planPromptFor(`Couldn't save: ${message}`)).toBeNull();
    rememberPlanPrompt({ code: "not_a_plan_answer", message: "I- other" });
    expect(planPromptFor("I- other")).toBeNull();
  });

  it("keeps a bounded memory", () => {
    for (let i = 0; i < 80; i++) rememberPlanPrompt({ code: "plan_required", requiredPlan: "starter", message: `I- bound ${i}` });
    expect(planPromptFor("I- bound 0")).toBeNull();
    expect(planPromptFor("I- bound 79")).not.toBeNull();
  });

  it("apiErrorMessage records plan answers it unwraps", () => {
    const source = read("client/src/lib/queryClient.ts");
    expect(source).toMatch(/rememberPlanPrompt\(parsed\)/);
    expect(read("client/src/components/ui/toaster.tsx")).toMatch(/planPromptFor\(description\)/);
  });

  it("parses apiRequest errors into a status, a body and a code", () => {
    const err = new Error(`409: ${JSON.stringify({ code: "talk_to_sales", message: "Talk to a sales rep" })}`);
    expect(apiErrorInfo(err)).toEqual({ status: 409, body: { code: "talk_to_sales", message: "Talk to a sales rep" } });
    expect(apiErrorCode(err)).toBe("talk_to_sales");
    expect(apiErrorInfo(new Error("500: Internal Server Error"))).toEqual({ status: 500, body: null });
    expect(apiErrorCode(new Error("network down"))).toBeNull();
  });
});

describe("saved credentials (Settings → API keys)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every required list and disconnect route is exempt from the plan gate on the server", () => {
    expect(CREDENTIAL_SOURCES.filter((s) => !s.optional).map((s) => s.url)).toEqual([
      "/api/cloudflare/saved-connections", "/api/gsc/saved-connections", "/api/ads/saved-connection", "/api/mail-alerts/oauth/saved-connections",
    ]);
    // Cloudflare and Search Console share registerAssetRoutes (one exemption for both providers).
    expect(read("server/ads/routes.ts")).toMatch(/req\.path==='\/saved-connection'.*req\.path==='\/disconnect'/s);
    expect(read("server/cloudflare/routes.ts")).toMatch(/req\.path === "\/saved-connections"[\s\S]*req\.path === "\/disconnect"/);
    expect(read("server/mail-alerts/gmail.ts")).toMatch(/oauth\/saved-connections[\s\S]*oauth\/disconnect/);
  });

  it("maps each server list to rows with a disconnect request", () => {
    const by = (url: string) => CREDENTIAL_SOURCES.find((s) => s.url === url)!;
    expect(by("/api/cloudflare/saved-connections").items({ items: [{ id: 7, label: "i-cf@example.invalid" }] })).toEqual([{
      key: "cloudflare-7", service: "Cloudflare", label: "i-cf@example.invalid", kind: "API token",
      disconnect: { url: "/api/cloudflare/disconnect", body: { ids: [7] } },
    }]);
    expect(by("/api/gsc/saved-connections").items({ items: [{ id: 8, label: "i-gsc@example.invalid" }] })[0])
      .toMatchObject({ service: "Search Console", kind: "Google sign-in", disconnect: { url: "/api/gsc/disconnect", body: { ids: [8] } } });
    expect(by("/api/ads/saved-connection").items({ saved: true, managerId: "1112223334" })).toEqual([{
      key: "ads", service: "Google Ads", label: "Manager account 1112223334", kind: "Google sign-in",
      disconnect: { url: "/api/ads/disconnect", body: { confirm: true } },
    }]);
    expect(by("/api/ads/saved-connection").items({ saved: false, managerId: null })).toEqual([]);
    expect(by("/api/mail-alerts/oauth/saved-connections").items({ items: [{ subject: "s1", email: "i-g@example.invalid" }] })[0])
      .toMatchObject({ service: "Gmail", label: "i-g@example.invalid", disconnect: { url: "/api/mail-alerts/oauth/disconnect", body: { subject: "s1" } } });
    expect(by("/api/domains/saved-connections").items({ items: [{ id: 3, provider: "namecom", label: "I- main" }] })[0])
      .toMatchObject({ service: "Name.com", kind: "API key", disconnect: { url: "/api/domains/disconnect", body: { ids: [3] } } });
    for (const s of CREDENTIAL_SOURCES) expect(s.items(undefined)).toEqual([]);
  });

  it("keys are unique across sources and every source says where it is managed", () => {
    expect(new Set(CREDENTIAL_SOURCES.map((s) => s.url)).size).toBe(CREDENTIAL_SOURCES.length);
    for (const s of CREDENTIAL_SOURCES) expect(s.manageHref).toMatch(/^\/[a-z-]+$/);
  });

  it("an optional list the server doesn't offer (404, plan gate, SPA fallback) is left out, not an error", async () => {
    const answer = (status: number, body: string, type: string) =>
      vi.fn(async () => new Response(body, { status, headers: { "content-type": type } }));
    vi.stubGlobal("fetch", answer(404, JSON.stringify({ message: "Not found" }), "application/json"));
    await expect(fetchOptionalList("/api/domains/saved-connections")).resolves.toBeNull();
    vi.stubGlobal("fetch", answer(402, JSON.stringify({ code: "plan_required" }), "application/json"));
    await expect(fetchOptionalList("/api/domains/saved-connections")).resolves.toBeNull();
    vi.stubGlobal("fetch", answer(200, "<!doctype html><html></html>", "text/html; charset=utf-8"));
    await expect(fetchOptionalList("/api/domains/saved-connections")).resolves.toBeNull();
    vi.stubGlobal("fetch", answer(200, JSON.stringify({ items: [] }), "application/json; charset=utf-8"));
    await expect(fetchOptionalList("/api/domains/saved-connections")).resolves.toEqual({ items: [] });
    vi.stubGlobal("fetch", answer(500, JSON.stringify({ message: "Domain operation failed" }), "application/json"));
    await expect(fetchOptionalList("/api/domains/saved-connections")).rejects.toThrow(/^500: /);
  });

  it("reads the server's confirmation in either shape", () => {
    expect(disconnectMessage({ ok: true, message: "Disconnected locally." })).toBe("Disconnected locally.");
    expect(disconnectMessage({ results: [{ id: 1, message: "Local data deleted." }] })).toBe("Local data deleted.");
    expect(disconnectMessage({})).toBe("Disconnected.");
  });
});

describe("client copy follows the price book", () => {
  it("no retired plan names in the pages this lane owns", () => {
    for (const file of [
      "client/src/pages/settings.tsx", "client/src/pages/crm-settings.tsx", "client/src/pages/photos.tsx",
      "client/src/pages/google-reviews.tsx", "client/src/pages/google-ads-guide-section.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/\bPlatinum\b|\bPremium, Gold\b|platinum: 20/);
    }
  });

  it("the review-template limit is the server's allowance, not a table of plan keys", () => {
    const page = read("client/src/pages/google-reviews.tsx");
    expect(page).toContain("allowances?.reviewTemplates");
    expect(page).not.toMatch(/planLimits/);
    for (const key of PLAN_KEYS) expect(PLANS[key].limits.reviewTemplates).not.toBe(0);
  });

  it("the Terms no longer sell consulting sessions", () => {
    const terms = read("client/src/pages/terms-of-use.tsx");
    expect(terms).not.toMatch(/Consulting session/i);
    expect(terms).toContain('data-testid="section-custom-work"');
  });

  it("every sales link has a #services section to land on", () => {
    expect(read("shared/plan-copy.ts")).toContain('SALES_HREF = "/pricing#services"');
    const pricing = read("client/src/pages/pricing.tsx");
    expect(pricing).toContain('<section id="services"');
    expect(pricing).toContain('id="done-for-you"');
    expect(read("client/src/components/app-sidebar.tsx")).toContain('url: "/pricing#services"');
  });
});
