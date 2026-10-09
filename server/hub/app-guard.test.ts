import { PLANS } from "@shared/plans";
import { formatUsd } from "@shared/plan-copy";
/**
 * The iPhone apps sell nothing (App Store 3.1.3(f)): inside the apps Gabe must
 * not quote prices or plans or suggest buying — deterministically, from the
 * user-agent token, never from the prompt. Route-level tests reuse the
 * routes.test.ts harness shape (in-memory budgets/presets, stub model).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { appAnswerBlocked, appPrefilterOverride, appSalesQuestion, APP_SALES_PRESETS, hubAppRequest } from "./app-guard";
import { appTemplateAnswer } from "./presets";
import { REPLIES } from "./replies";
import { createHub, type HubDeps } from "./routes";
import { originOk } from "./access";
import type { HubRequest } from "./ai";

const APP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ConstructHUBApp/1.0";
const CRM_APP_UA = "Mozilla/5.0 ConstructHUBCRM/1.0";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

describe("hubAppRequest", () => {
  it("recognises both app tokens and rejects browsers", () => {
    expect(hubAppRequest(APP_UA)).toBe(true);
    expect(hubAppRequest(CRM_APP_UA)).toBe(true);
    expect(hubAppRequest(BROWSER_UA)).toBe(false);
    expect(hubAppRequest(undefined)).toBe(false);
    expect(hubAppRequest("ConstructHUBApp without version")).toBe(false);
  });
});

describe("appSalesQuestion", () => {
  const yes = [
    "How much does ConstructHUB cost?",
    "What does the Pro plan include?",
    "Which plan is right for me?",
    "Is there a free trial?",
    "How do I upgrade my account?",
    "Can I buy more scan credits?",
    "What is the Solo tier?",
    "How much is the Call Assistant per month?",
    "Do you have yearly pricing?",
    "How do I change my billing?",
    "Where do I update my card?",
    "What's the starter plan price?",
    "Can I get a refund?",
    "how much does gr0wth c0st?",
    "Is the Agency plan billed per location?",
    "How do I subscribe?",
    "Is the site scan free?",
    "How many seats do I get?",
  ];
  const no = [
    "How do I connect my Google Business Profile?",
    "How does Click Guard work?",
    "What is the AI Call Assistant?",
    "How do I add my crew to the CRM?",
    "I'm a pro roofer — how do I schedule posts?",
    "Where do I forward my calls?",
    "How do I set up review requests?",
    "What permits are available in Maricopa County?",
  ];
  it("answers sales questions with the guard", () => {
    for (const q of yes) expect(appSalesQuestion(q), q).toBe(true);
  });
  it("lets feature questions through", () => {
    for (const q of no) expect(appSalesQuestion(q), q).toBe(false);
  });
});

describe("appPrefilterOverride / appAnswerBlocked", () => {
  it("overrides sales-rep and billing self-service replies in the app", () => {
    expect(appPrefilterOverride("R_SALES")).toBe("R_APP_PRICING");
    expect(appPrefilterOverride("R_OWN_DATA", "/settings?tab=billing")).toBe("R_APP_PRICING");
    expect(appPrefilterOverride("R_OWN_DATA", "/crm/invoices")).toBeNull();
    expect(appPrefilterOverride("R_DATA")).toBeNull();
  });
  it("blocks model answers that state a price or point at Pricing", () => {
    expect(appAnswerBlocked("**Pro** is $99/month.")).toBe(true);
    expect(appAnswerBlocked("See [Pricing](/pricing) for plans.")).toBe(true);
    expect(appAnswerBlocked("Connect Google under Locations.")).toBe(false);
  });
});

describe("appTemplateAnswer", () => {
  it("names no plan tiers or prices and never links /pricing", () => {
    for (const presetId of ["features", "crm", "permits", "google-profile", "reviews", "click-fraud", "site-scan"] as const) {
      const text = appTemplateAnswer(presetId);
      expect(text, presetId).not.toMatch(/\$\s?\d/);
      expect(text, presetId).not.toMatch(/\]\(\/pricing/);
      expect(text, presetId).not.toMatch(/\b(Starter|Growth|Agency|Lite|Solo|Crew|Fleet) (plan|tier)\b/i);
      expect(text.length, presetId).toBeGreaterThan(80);
    }
  });
  it("covers exactly the presets that are not sales presets", () => {
    expect(APP_SALES_PRESETS.has("pricing")).toBe(true);
    expect(APP_SALES_PRESETS.has("done-for-you")).toBe(true);
    expect(APP_SALES_PRESETS.has("call-number")).toBe(true);
    expect(APP_SALES_PRESETS.has("reviews")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route level: the app user agent gets the fixed line, never the model.

function setup(over: Partial<HubDeps> = {}) {
  const budgetStore = new Map<string, number>();
  const budget = {
    take: async (key: string, limit: number, windowMs: number) => {
      const k = `${key}|${Math.floor(Date.now() / windowMs)}`;
      const used = budgetStore.get(k) ?? 0;
      if (used + 1 > limit) return false;
      budgetStore.set(k, used + 1);
      return true;
    },
    used: async (key: string, windowMs: number) => budgetStore.get(`${key}|${Math.floor(Date.now() / windowMs)}`) ?? 0,
  };
  const ai = {
    calls: [] as HubRequest[],
    fallback: { content: `**Pro** is $99/month or ${formatUsd(PLANS.pro.annualCents)}/year. See [Pricing](/pricing).`, finishReason: "stop" },
    complete(body: HubRequest): Promise<any> {
      ai.calls.push(body);
      return Promise.resolve(ai.fallback);
    },
  };
  const hub = createHub({
    ai: () => ai as any,
    budget,
    stats: { record: () => {} },
    presets: { get: async () => null, put: async () => {} } as any,
    model: () => "truthcode:38",
    providerOk: () => true,
    timeoutMs: () => 500,
    ipKey: (req) => req.get("x-test-ip") ?? "ip-a",
    originOk,
    isBuilder: (req) => !!req.user,
    ...over,
  });
  const app = express();
  app.use("/api/hub", express.json({ limit: "8kb" }));
  app.use((req, _res, next) => {
    const id = req.get("x-test-user");
    if (id) (req as any).user = { id: Number(id), emailVerified: true };
    next();
  });
  app.use(hub.router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function post(path: string, body: unknown, opts: { user?: number; ua?: string } = {}) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: base,
      "user-agent": opts.ua ?? BROWSER_UA,
    };
    if (opts.user) headers["x-test-user"] = String(opts.user);
    const res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const chat = (text: string, ua: string) => post("/api/hub/chat", { messages: [{ role: "user", content: text }] }, { user: 42, ua });

  return { ai, post, chat, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let env: ReturnType<typeof setup>;
beforeEach(() => { env = setup(); });
afterEach(async () => { await env.close(); });

describe("app guard on the routes", () => {
  it("answers a pricing question in the app with the fixed line and no model call", async () => {
    const out = await env.chat("How much does the Pro plan cost?", APP_UA);
    expect(out.status).toBe(200);
    expect(out.data).toMatchObject({ reply: REPLIES.R_APP_PRICING, kind: "refusal" });
    expect(env.ai.calls.length).toBe(0);
  });

  it("CRM app token gets the same guard", async () => {
    const out = await env.chat("Is there a free trial?", CRM_APP_UA);
    expect(out.data).toMatchObject({ reply: REPLIES.R_APP_PRICING, kind: "refusal" });
    expect(env.ai.calls.length).toBe(0);
  });

  it("lets a feature question through to the model — and blocks a price-quoting answer", async () => {
    const out = await env.chat("How do I connect my Google Business Profile?", APP_UA);
    expect(env.ai.calls.length).toBe(1);
    expect(out.data).toMatchObject({ reply: REPLIES.R_APP_PRICING, kind: "refusal" });
  });

  it("does not touch browser requests", async () => {
    const out = await env.chat("How much does the Pro plan cost?", BROWSER_UA);
    expect(env.ai.calls.length).toBe(1);
    expect(out.data.reply).toContain("$99");
  });

  it("sales presets get the fixed line in the app, never the template", async () => {
    for (const presetId of ["pricing", "which-plan", "trial", "agency", "done-for-you", "call-assistant", "call-number", "master-class", "get-started"]) {
      const out = await env.post("/api/hub/preset", { presetId }, { ua: APP_UA });
      expect(out.data, presetId).toMatchObject({ reply: REPLIES.R_APP_PRICING });
    }
  });

  it("informational presets get the scrubbed template in the app", async () => {
    const out = await env.post("/api/hub/preset", { presetId: "reviews" }, { ua: APP_UA });
    expect(out.status).toBe(200);
    expect(out.data.reply).toContain("Review Requests");
    expect(out.data.reply).not.toMatch(/\$\s?\d|\]\(\/pricing/);
  });

  it("browser presets still get the price-book template", async () => {
    const out = await env.post("/api/hub/preset", { presetId: "pricing" }, { ua: BROWSER_UA });
    expect(out.data.reply).toContain("/pricing");
  });

  it("a billing self-service question gets the fixed line instead of the Billing link", async () => {
    const out = await env.chat("Show my usage", APP_UA);
    expect(env.ai.calls.length).toBe(0);
    expect(out.data).toMatchObject({ reply: REPLIES.R_APP_PRICING, kind: "refusal" });
  });
});
