import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import path from "node:path";

// DATABASE_URL= npx vitest run --config client/src/components/hub/hub-widget.test.config.ts
// Requires the existing Playwright Chromium installation. All API responses are test fixtures.

let server: ViteDevServer;
let browser: Browser;
let origin: string;
beforeAll(async () => {
  server = await createServer({ configFile: false, publicDir: path.resolve("client/public"), cacheDir: "/tmp/gabe-vite-cache", root: process.cwd(), resolve: { alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "hub-test-page", configureServer(s) { s.middlewares.use((req, res, next) => {
    if (req.url !== "/") return next();
    res.setHeader("Content-Type", "text/html");
    res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/client/src/components/hub/hub-widget.harness.tsx"></script></body></html>');
  }); } }] });
  await server.listen();
  origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
});
afterAll(async () => { await browser?.close(); await server?.close(); });

function meta(remaining = 5, userId = 1) {
  return { tier: "builder", userId, chat: true, maxChars: 500, presets: [{ id: "help", label: "How does Gabe work?" }], primary: ["help"], welcome: ["help"], allowance: { monthly: 10, used: 10 - remaining, remaining, resetsAt: "2026-11-01T00:00:00Z", daily: { limit: 40, used: 3 } } };
}
async function fixture(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on("pageerror", (error) => console.error(error.message));
  const state = { meta: meta(), calls: 0, failMeta: false, failChat: true, requests: [] as any[] };
  await page.route("**/api/hub/presets", async (route) => { state.calls++; await route.fulfill({ status: state.failMeta ? 503 : 200, json: state.failMeta ? {} : state.meta }); });
  await page.route("**/api/hub/chat", async (route) => { state.requests.push(route.request().postDataJSON()); await route.fulfill({ status: state.failChat ? 503 : 200, json: state.failChat ? { reply: "Please try again." } : { reply: "Test answer", sig: "test-signature", index: state.requests.length, conversationId: "test-conversation", kind: "answer" } }); });
  await page.goto(origin);
  await page.getByTestId("hub-launcher").waitFor();
  return { page, state };
}
async function open(page: Page) { await page.getByTestId("hub-launcher").click(); await page.getByTestId("hub-panel").waitFor(); }
async function send(page: Page, text: string) { await page.getByTestId("hub-input").fill(text); await page.getByTestId("hub-send").click(); }
async function hook(page: Page, name: string, arg?: number) { return page.evaluate(({ name, arg }) => (window as any).hubTest[name](arg), { name, arg }); }

describe("Gabe recovery in the browser", () => {
  it("refreshes on open, entitlement success/invalidation, and Check allowance; errors never show zero", async () => {
    const { page, state } = await fixture();
    try {
      state.meta = meta(0);
      const before = state.calls;
      await open(page);
      await expect.poll(() => state.calls).toBeGreaterThan(before);
      await page.getByTestId("hub-check-allowance").waitFor();
      state.meta = meta(7);
      await page.getByTestId("hub-check-allowance").click();
      await page.getByTestId("hub-input").waitFor();
      expect(await page.getByTestId("hub-allowance").innerText()).toContain("7 of 10");
      state.meta = meta(8);
      await hook(page, "entitlement");
      await expect.poll(() => page.getByTestId("hub-allowance").innerText()).toContain("8 of 10");
      state.meta = meta(9);
      await hook(page, "invalidateEntitlement");
      await expect.poll(() => page.getByTestId("hub-allowance").innerText()).toContain("9 of 10");
      state.failMeta = true;
      await page.getByTestId("hub-close").click(); await open(page);
      await page.getByTestId("hub-offline").waitFor();
      expect(await page.getByTestId("hub-allowance").innerText()).toContain("unavailable");
      expect(await page.getByTestId("hub-daily").count()).toBe(0);
      state.failMeta = false;
      await page.getByTestId("hub-retry").click(); await page.getByTestId("hub-input").waitFor();
    } finally { await page.close(); }
  });

  it.each([
    ["monthly", "2026-10-31T11:59:59Z", "2026-10-31T12:00:00Z"],
    ["daily", "2026-10-31T23:59:59Z", "2026-12-01T00:00:00Z"],
  ])("refreshes while closed at the %s boundary without looping on long timers", async (_kind, now, reset) => {
    const { page, state } = await fixture();
    try {
      state.meta.allowance.resetsAt = reset;
      await page.clock.install({ time: new Date(now) });
      await page.reload(); await page.getByTestId("hub-launcher").waitFor();
      const before = state.calls;
      state.meta = { ...meta(10), allowance: { ...meta(10).allowance, resetsAt: "2026-12-01T00:00:00Z" } };
      await page.clock.runFor(1100);
      await expect.poll(() => state.calls).toBeGreaterThan(before);
      const after = state.calls;
      await page.clock.runFor(5000);
      expect(state.calls).toBe(after);
    } finally { await page.close(); }
  });

  it("retains failed turns, restores Edit, retries once, and sends only answered pairs in signed history", async () => {
    const { page, state } = await fixture();
    try {
      await open(page); await send(page, "Failed question");
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.getByTestId("hub-input").inputValue()).toBe("Failed question");
      state.failChat = false;
      await send(page, "Different question");
      await expect.poll(() => state.requests.length).toBe(2);
      expect(state.requests[1].messages).toEqual([{ role: "user", content: "Different question" }]);
      await page.getByTestId("hub-thinking").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => state.requests.length).toBe(3);
      expect(state.requests[2].messages.map((m: any) => m.content)).toEqual(["Different question", "Test answer", "Failed question"]);
      expect(state.requests[2].messages[1].sig).toBe("test-signature");
      await page.getByTestId("hub-thinking").waitFor({ state: "hidden" });
      expect(await page.getByTestId("hub-msg-user").count()).toBe(2);
      await send(page, "Follow-up");
      await expect.poll(() => state.requests.length).toBe(4);
      expect(state.requests[3].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    } finally { await page.close(); }
  });

  it("isolates two signed-in identities and drops an old in-flight response", async () => {
    const { page, state } = await fixture();
    let release!: () => void;
    try {
      await page.evaluate(() => {
        const original = window.fetch;
        (window as any).chatAborted = false;
        window.fetch = (input, init) => {
          if (input === "/api/hub/chat") init?.signal?.addEventListener("abort", () => { (window as any).chatAborted = true; });
          return original(input, init);
        };
      });
      await page.route("**/api/hub/chat", async (route) => { await new Promise<void>((resolve) => { release = resolve; }); await route.fulfill({ json: { reply: "Old account answer", sig: "old", conversationId: "old", kind: "answer" } }).catch(() => {}); });
      await open(page); await send(page, "Old account question");
      await expect.poll(() => !!release).toBe(true);
      state.meta = meta(2, 2);
      await hook(page, "switchUser", 2);
      await page.getByTestId("hub-launcher").waitFor();
      expect(await page.evaluate(() => (window as any).chatAborted)).toBe(true);
      release(); await open(page);
      expect(await page.getByTestId("hub-msg-user").count()).toBe(0);
      expect(await page.getByTestId("hub-msg-assistant").count()).toBe(0);
      await expect.poll(() => page.getByTestId("hub-allowance").innerText()).toContain("2 of 10");
      const keys = await hook(page, "keys");
      expect(keys).toContainEqual(["/api/hub/presets", 1]); expect(keys).toContainEqual(["/api/hub/presets", 2]);
    } finally { release?.(); await page.close(); }
  });

  it("shows daily usage and a nonmodal, keyboard-accessible phone panel", async () => {
    const { page, state } = await fixture(390);
    try {
      await open(page);
      expect(await page.getByTestId("hub-daily").innerText()).toContain("Today: 3 of 40 attempts used");
      expect(await page.getByTestId("hub-panel").getAttribute("aria-modal")).toBeNull();
      await send(page, "How do I set up my account?");
      const retry = page.getByRole("button", { name: "Retry", exact: true }); await retry.waitFor();
      await page.keyboard.press("Tab");
      await retry.focus();
      expect(await retry.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
      const bounds = await page.getByTestId("hub-panel").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: "/tmp/gabe-recovery-phone.png" });
      state.meta = meta(0);
      await page.getByTestId("hub-close").click(); await open(page);
      await page.getByTestId("hub-check-allowance").waitFor();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      expect(await page.getByTestId("hub-input").inputValue()).toBe("How do I set up my account?");
      expect(await page.getByTestId("hub-send").isDisabled()).toBe(true);
      await page.screenshot({ path: "/tmp/gabe-allowance-phone.png" });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: "/tmp/gabe-allowance-desktop.png" });
      await page.getByRole("link", { name: "See plans" }).focus();
      await page.keyboard.press("Tab");
      expect(await page.getByTestId("hub-panel").evaluate((el) => el.contains(document.activeElement))).toBe(false);
      await page.keyboard.press("Escape");
      await page.getByTestId("hub-launcher").waitFor();
    } finally { await page.close(); }
  });
});

it.each([[429, "slowdown"], [429, "limit"], [503, "busy"]] as const)("renders %s %s neutrally and refreshes attempt usage", async (status, code) => {
  const { page, state } = await fixture(390);
  try {
    await page.route("**/api/hub/chat", route => route.fulfill({ status, json: { code, reply: "Please wait before asking again." } }));
    await open(page);
    const before = state.calls;
    state.meta.allowance.daily.used = 4;
    await send(page, "How does this work?");
    await expect.poll(() => page.getByTestId("hub-msg-assistant").last().getAttribute("data-tone")).toBe("note");
    expect(await page.getByRole("button", { name: "Retry", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Edit", exact: true }).count()).toBe(0);
    await expect.poll(() => state.calls).toBeGreaterThan(before);
    await expect.poll(() => page.getByTestId("hub-daily").innerText()).toContain("4 of 40 attempts");
  } finally { await page.close(); }
});

it("refreshes daily usage after a transport failure and grows a restored long question", async () => {
  const { page, state } = await fixture(390);
  try {
    await open(page);
    const before = state.calls;
    state.meta.allowance.daily.used = 4;
    await page.route("**/api/hub/chat", route => route.abort());
    const question = "How can I configure my business and get started with the tools? ".repeat(6);
    await send(page, question);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.poll(() => state.calls).toBeGreaterThan(before);
    expect(await page.getByTestId("hub-input").inputValue()).toBe(question.trim());
    await expect.poll(async () => (await page.getByTestId("hub-input").boundingBox())!.height).toBeGreaterThan(40);
  } finally { await page.close(); }
});

it("closes on a hidden route, moves focus to the page and stays closed on return", async () => {
  const { page } = await fixture();
  try {
    await open(page);
    await page.evaluate(() => { history.pushState(null, "", "/privacy"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.getByTestId("hub-panel").waitFor({ state: "hidden" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("MAIN");
    await page.evaluate(() => { history.pushState(null, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await page.getByTestId("hub-launcher").waitFor();
    expect(await page.getByTestId("hub-panel").count()).toBe(0);
  } finally { await page.close(); }
});

it("describes free quick questions and the verified-account plan requirement consistently", async () => {
  const { page, state } = await fixture(390);
  try {
    Object.assign(state.meta, { tier: "browse", chat: false, allowance: null });
    await open(page);
    await page.getByTestId("hub-signup-cta").waitFor();
    const copy = await page.getByTestId("hub-signup-cta").innerText();
    expect(copy).toContain("Quick questions are free, with or without an account");
    expect(copy).toContain("verified account and a plan allowance");
    expect(await page.getByTestId("hub-input").count()).toBe(0);
  } finally { await page.close(); }
});

it("treats preset throttling as a note without retry actions", async () => {
  const { page } = await fixture(390);
  try {
    await page.route("**/api/hub/preset", route => route.fulfill({ status: 429, json: { code: "slowdown", reply: "Please wait before asking again." } }));
    await open(page); await page.getByTestId("hub-chip-help").click();
    await expect.poll(() => page.getByTestId("hub-msg-assistant").last().getAttribute("data-tone")).toBe("note");
    expect(await page.getByRole("button", { name: "Retry", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Edit", exact: true }).count()).toBe(0);
    await page.screenshot({ path: "/tmp/gabe-neutral-phone.png" });
  } finally { await page.close(); }
});

it("the hover arrow hides Gabe for the tab; the Ask Gabe nudge brings him back", async () => {
  const { page } = await fixture();
  try {
    const hide = page.getByTestId("hub-hide");
    // Invisible (and not a tap target) until the launcher is hovered.
    expect(await hide.evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).pointerEvents])).toEqual(["0", "none"]);
    await page.getByTestId("hub-launcher").hover();
    await expect.poll(() => hide.evaluate((e) => getComputedStyle(e).opacity)).toBe("1");
    await hide.click();
    expect(await page.getByTestId("hub-launcher").count()).toBe(0);
    await page.reload(); await page.waitForTimeout(400);
    expect(await page.getByTestId("hub-launcher").count()).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("constructhub:hub-open", { detail: { question: "hi" } })));
    await page.getByTestId("hub-panel").waitFor();
    await page.getByTestId("hub-close").click();
    await page.getByTestId("hub-launcher").waitFor();
  } finally { await page.close(); }
});
