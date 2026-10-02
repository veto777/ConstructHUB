import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Gabe — the corner assistant (the Hub widget). Run with playwright.hub.config.ts (two servers:
 * signed in on HUB_SIGNED_IN_URL, signed out on HUB_SIGNED_OUT_URL).
 */
test.skip(!process.env.HUB_E2E, "run with -c playwright.hub.config.ts");

const SIGNED_IN = process.env.HUB_SIGNED_IN_URL || "http://127.0.0.1:8301";
const SIGNED_OUT = process.env.HUB_SIGNED_OUT_URL || "http://127.0.0.1:8302";
const SHOTS = process.env.HUB_SCREENSHOT_DIR;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function openHub(page: Page) {
  await page.getByTestId("hub-launcher").click();
  const panel = page.getByRole("dialog", { name: "Gabe — your ConstructHUB guide" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("signed out", () => {
  test("preset chips only: answers from the server, no text box, sign-up call to action", async ({ page }) => {
    await page.goto(`${SIGNED_OUT}/`);
    const launcher = page.getByTestId("hub-launcher");
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAccessibleName("Ask Gabe, your ConstructHUB guide");
    const panel = await openHub(page);
    await expect(panel.locator("[data-hub-chip]")).toHaveCount(8);
    await panel.getByTestId("hub-more").click();
    await expect(panel.locator("[data-hub-chip]")).toHaveCount(14);
    await expect(panel.getByTestId("hub-input")).toHaveCount(0);
    await expect(panel.getByTestId("hub-signup-cta")).toContainText("Create a free account to ask Gabe anything");
    await expect(panel.getByTestId("hub-signup-link")).toHaveAttribute("href", "/auth");

    await panel.getByTestId("hub-chip-trial").click();
    await expect(panel.getByTestId("hub-msg-user").last()).toHaveText("Is there a free trial?");
    const answer = panel.getByTestId("hub-msg-assistant").last();
    await expect(answer).toContainText("1-day trial");
    await expect(answer).toContainText(/no free plan/i);
    await shot(page, "hub-signed-out-1280");
  });

  test("keyboard: focus is trapped in the panel and Escape closes it, returning focus to the launcher", async ({ page }) => {
    await page.goto(`${SIGNED_OUT}/pricing`);
    const panel = await openHub(page);
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("hub-launcher")).toBeFocused();
  });

  test("keyboard: after a chip answer focus is still in the panel, and Escape still closes it", async ({ page }) => {
    await page.goto(`${SIGNED_OUT}/`);
    await page.getByTestId("hub-launcher").focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Gabe — your ConstructHUB guide" });
    await expect(panel).toBeVisible();
    await panel.getByTestId("hub-chip-pricing").focus();
    await page.keyboard.press("Enter");
    // While the answer loads and after it arrives, focus never falls to <body>.
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("$29/month or $290/year");
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("hub-launcher")).toBeFocused();
  });

  test("never on homeowner token pages or the sign-in page; shown on marketing pages", async ({ page }) => {
    for (const path of ["/e/not-a-real-token", "/portal/not-a-real-token", "/auth", "/terms"]) {
      await page.goto(`${SIGNED_OUT}${path}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("hub-launcher"), path).toHaveCount(0);
    }
    for (const path of ["/pricing", "/reinstatement", "/master-class-landing"]) {
      await page.goto(`${SIGNED_OUT}${path}`);
      await expect(page.getByTestId("hub-launcher"), path).toBeVisible();
    }
  });

  test("390px: the panel fits the screen with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${SIGNED_OUT}/`);
    const panel = await openHub(page);
    await panel.getByTestId("hub-chip-pricing").click();
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("$29/month or $290/year");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await shot(page, "hub-signed-out-390");
  });
});

test.describe("signed in", () => {
  /** Mock the chat endpoint (the model path is covered server-side with a stub). */
  async function mockChat(page: Page, replies: { status?: number; body: Record<string, unknown>; delayMs?: number }[]) {
    const bodies: any[] = [];
    await page.route("**/api/hub/chat", async (route: Route) => {
      bodies.push(route.request().postDataJSON());
      const next = replies.shift() ?? { status: 503, body: { reply: "busy", code: "busy" } };
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      await route.fulfill({ status: next.status ?? 200, contentType: "application/json", body: JSON.stringify(next.body) });
    });
    return bodies;
  }
  const convo = "7f0e7a52-6b8e-4f53-9f1b-3c2a3f4f8a11";
  const sig = (c: string) => c.repeat(64);

  test("free-text chat: thinking, then a rendered answer; the signed turn goes back next time", async ({ page }) => {
    const bodies = await mockChat(page, [
      { delayMs: 900, body: { reply: "Here's how to set up **Click Guard**:\n1. Add your website.\n2. Paste the tracking code.\nSee [Pricing](/pricing) or [this](https://evil.example/x).", kind: "answer", conversationId: convo, index: 1, sig: sig("a") } },
      { body: { reply: "Text <img src=x onerror=alert(1)> stays text.", kind: "answer", conversationId: convo, index: 3, sig: sig("b") } },
    ]);
    // A returning account (welcome already seen) gets the regular greeting.
    await page.addInitScript(() => window.localStorage.setItem("hub.welcomeSeen", "1"));
    await page.goto(`${SIGNED_IN}/`);
    await expect(page.getByTestId("hub-welcome-dot")).toHaveCount(0);
    const panel = await openHub(page);
    await expect(panel.getByTestId("hub-greeting")).toContainText("I can't see your account");
    const input = panel.getByTestId("hub-input");
    await expect(input).toBeFocused();
    await input.fill("How do I set up Click Guard on my website?");
    await input.press("Enter");
    await expect(panel.getByTestId("hub-header-mascot")).toHaveAttribute("data-state", "thinking");
    await expect(panel.getByTestId("hub-thinking")).toBeVisible();
    const answer = panel.getByTestId("hub-msg-assistant").last();
    await expect(answer).toContainText("Paste the tracking code.");
    await expect(panel.getByTestId("hub-header-mascot")).toHaveAttribute("data-state", "talking");
    await expect(answer.locator("strong")).toHaveText("Click Guard");
    await expect(answer.locator("ol li")).toHaveCount(2);
    await expect(answer.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    await expect(answer.getByRole("link", { name: "this" })).toHaveCount(0); // not allowlisted: plain text
    expect(bodies[0]).toMatchObject({ messages: [{ role: "user", content: "How do I set up Click Guard on my website?" }], pageKey: "home" });
    await shot(page, "hub-signed-in-1280");

    await input.fill("And which plans include it?");
    await panel.getByTestId("hub-send").click();
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("<img src=x onerror=alert(1)> stays text.");
    // The transcript never renders an injected image; the only <img> in the dialog is Gabe in the header.
    await expect(panel.getByTestId("hub-messages").locator("img")).toHaveCount(0);
    await expect(panel.locator("img")).toHaveCount(1);
    expect(bodies[1].conversationId).toBe(convo);
    expect(bodies[1].messages).toEqual([
      { role: "user", content: "How do I set up Click Guard on my website?" },
      { role: "assistant", content: expect.stringContaining("Click Guard"), index: 1, sig: sig("a") },
      { role: "user", content: "And which plans include it?" },
    ]);
  });

  test("honest errors: a busy model shows the server's message and the question can be asked again", async ({ page }) => {
    await mockChat(page, [{ status: 503, body: { reply: "My radio's crackling, so that took too long. Please try again in a minute. The quick questions below still work.", code: "timeout" } }]);
    await page.goto(`${SIGNED_IN}/`);
    const panel = await openHub(page);
    await panel.getByTestId("hub-input").fill("How do I connect Google?");
    await panel.getByTestId("hub-send").click();
    const err = panel.getByTestId("hub-msg-assistant").last();
    await expect(err).toHaveAttribute("data-tone", "error");
    await expect(err).toContainText("My radio's crackling");
    await expect(panel.getByTestId("hub-input")).toBeEnabled();
  });

  test("keyboard: 'Start a new chat' moves focus to the text box, and Escape closes from anywhere", async ({ page }) => {
    await mockChat(page, [{ body: { reply: "Open **Locations** first.", kind: "answer", conversationId: convo, index: 1, sig: sig("d") } }]);
    await page.addInitScript(() => window.localStorage.setItem("hub.welcomeSeen", "1"));
    await page.goto(`${SIGNED_IN}/`);
    const panel = await openHub(page);
    await panel.getByTestId("hub-input").fill("How do I connect Google?");
    await panel.getByTestId("hub-send").click();
    await expect(panel.getByTestId("hub-input")).toBeFocused(); // not left on the inactive Send button
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("Open Locations first.");
    await panel.getByTestId("hub-new-chat").focus();
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("hub-new-chat")).toHaveCount(0);
    await expect(panel.getByTestId("hub-input")).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("390px: a long unbroken message wraps inside its bubble", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockChat(page, [{ body: { reply: "Mock answer.", kind: "answer", conversationId: convo, index: 1, sig: sig("e") } }]);
    await page.addInitScript(() => window.localStorage.setItem("hub.welcomeSeen", "1"));
    await page.goto(`${SIGNED_IN}/`);
    const panel = await openHub(page);
    await panel.getByTestId("hub-input").fill(`Is this link ok https://constructhub.us/settings?tab=billing&${"a".repeat(90)} for Pro?`);
    await panel.getByTestId("hub-send").click();
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("Mock answer.");
    const fit = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="hub-messages"]')!;
      const bubble = document.querySelector('[data-testid="hub-msg-user"]')!.getBoundingClientRect();
      const panelBox = document.querySelector('[data-testid="hub-panel"]')!.getBoundingClientRect();
      return { overflow: list.scrollWidth - list.clientWidth, bubbleRight: bubble.right, panelRight: panelBox.right };
    });
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.bubbleRight).toBeLessThanOrEqual(fit.panelRight);
  });

  test("first visit after sign-up: a welcome bubble that opens Gabe with setup questions", async ({ page }) => {
    await page.goto(`${SIGNED_IN}/locations`);
    const bubble = page.getByTestId("hub-welcome-bubble");
    await expect(bubble).toBeVisible();
    await page.getByTestId("hub-welcome-open").click();
    const panel = page.getByRole("dialog", { name: "Gabe — your ConstructHUB guide" });
    await expect(panel.getByTestId("hub-greeting")).toContainText("Welcome aboard");
    await expect(panel.getByTestId("hub-chip-get-started")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("hub-launcher")).toBeVisible();
    await expect(page.getByTestId("hub-welcome-bubble")).toHaveCount(0);
  });

  test("390px: chat fits the phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockChat(page, [{ body: { reply: "Open **Locations** and click **Connect Google Business Profile**.", kind: "answer", conversationId: convo, index: 1, sig: sig("c") } }]);
    await page.goto(`${SIGNED_IN}/`);
    // On a phone the welcome is a dot on the launcher, never a bubble over the page.
    await expect(page.getByTestId("hub-welcome-dot")).toBeVisible();
    await expect(page.getByTestId("hub-welcome-bubble")).toBeHidden();
    const panel = await openHub(page);
    await expect(panel.getByTestId("hub-greeting")).toContainText("Welcome aboard");
    await panel.getByTestId("hub-input").fill("How do I connect my Google Business Profile?");
    await panel.getByTestId("hub-send").click();
    await expect(panel.getByTestId("hub-msg-assistant").last()).toContainText("Connect Google Business Profile");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await shot(page, "hub-signed-in-390");
  });

  test("CRM portal on a phone: the launcher sits above the bottom ribbon", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${SIGNED_IN}/?portal=1`);
    const ribbon = page.getByTestId("crm-ribbon");
    await expect(ribbon).toBeVisible();
    const launcher = page.getByTestId("hub-launcher");
    await expect(launcher).toBeVisible();
    const l = (await launcher.boundingBox())!;
    const r = (await ribbon.boundingBox())!;
    expect(l.y + l.height).toBeLessThanOrEqual(r.y);
    await shot(page, "hub-portal-390");
  });

  test("the Google Ads pages keep their own consultant chat (no Gabe there)", async ({ page }) => {
    await page.goto(`${SIGNED_IN}/google-ads-guide`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("hub-launcher")).toHaveCount(0);
  });
});
