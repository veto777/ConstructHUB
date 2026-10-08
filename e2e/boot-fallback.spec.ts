import { expect, test, type Page } from "@playwright/test";

/**
 * index.html's static fallback ("ConstructHUB … Privacy Policy · Terms of Use") must never be on
 * screen for a browser that runs the app — it flashed on every full page load, and in every tutorial
 * video (owner, 2026-10-08) — and must still be there for a visitor without JavaScript and in the
 * HTML a crawler reads. The boot screen shown instead is the app's own loading state.
 *
 * Against any running server (dev or built):
 *   BOOT_URL=http://127.0.0.1:8187 npx playwright test -c playwright.boot-fallback.config.ts
 * and it runs in the main suite too (baseURL). The CPU is slowed six times so the moment before the
 * app mounts is long enough to see.
 */

type BootLog = { samples: number; fallbackShown: number; bootShown: number; darkAtBody: boolean | null; bootBackground: string | null };

/** Watch every animation frame and every DOM change from the first moment of the document. */
async function watchBoot(page: Page) {
  await page.addInitScript(() => {
    const log = ((window as any).__boot = { samples: 0, fallbackShown: 0, bootShown: 0, darkAtBody: null, bootBackground: null }) as any;
    const look = () => {
      if (!document.body) return;
      log.samples++;
      if (log.darkAtBody === null) log.darkAtBody = document.documentElement.classList.contains("dark");
      // By what it is, not by its id: the bare <main> index.html ships in #root, before the app replaces it.
      const fallback = document.querySelector('#root > main[style*="max-width:720px"]'), boot = document.getElementById("ch-boot");
      if (fallback && fallback.getClientRects().length) log.fallbackShown++;
      if (boot && boot.getClientRects().length) { log.bootShown++; log.bootBackground ??= getComputedStyle(boot).backgroundColor; }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true });
    const frame = () => { look(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
}
async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
}
const mounted = (page: Page) => page.waitForFunction(() => !document.querySelector('#root > main[style*="max-width:720px"]') && !!document.querySelector("#root [data-testid]"), null, { timeout: 60_000 });
const bootLog = (page: Page) => page.evaluate(() => (window as any).__boot as BootLog);

for (const path of ["/", "/crm", "/crm/clients", "/auth", "/e/not-a-real-token"]) {
  test(`with JavaScript, the fallback is never shown while ${path} loads`, async ({ page }) => {
    await watchBoot(page);
    await slowCpu(page);
    await page.goto(path, { waitUntil: "commit" });
    await mounted(page);
    const log = await bootLog(page);
    expect(log.samples).toBeGreaterThan(3);
    expect(log.fallbackShown, "frames or DOM changes during which the static fallback was displayed").toBe(0);
  });
}

test("a full reload and Back never show it either", async ({ page }) => {
  await watchBoot(page);
  await slowCpu(page);
  await page.goto("/crm", { waitUntil: "commit" });
  await mounted(page);
  await page.goto("/crm/clients", { waitUntil: "commit" });
  await mounted(page);
  expect((await bootLog(page)).fallbackShown).toBe(0);
  await page.goBack({ waitUntil: "commit" });
  await mounted(page);
  expect((await bootLog(page)).fallbackShown).toBe(0);
  await page.reload({ waitUntil: "commit" });
  await mounted(page);
  expect((await bootLog(page)).fallbackShown).toBe(0);
});

test("the saved dark theme is applied before the first paint, and the boot screen is dark", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch { /* storage off */ } });
  await watchBoot(page);
  await slowCpu(page);
  await page.goto("/crm", { waitUntil: "commit" });
  await mounted(page);
  const log = await bootLog(page);
  expect(log.darkAtBody).toBe(true);
  expect(log.fallbackShown).toBe(0);
  // hsl(222 30% 14%) — the dark --background of index.css.
  if (log.bootShown) expect(log.bootBackground).toBe("rgb(25, 31, 46)");
});

test("without JavaScript the fallback is the page: its text and its links", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/crm");
  const fallback = page.locator("#ch-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback.locator("h1")).toHaveText("ConstructHUB");
  await expect(fallback).toContainText("two products for contractors");
  await expect(fallback.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(fallback.getByRole("link", { name: "Terms of Use" })).toBeVisible();
  await expect(page.locator("#ch-boot")).toBeHidden();
  await context.close();
});

test("the HTML a crawler is sent still carries the fallback text, unhidden", async ({ request }) => {
  const html = await (await request.get("/crm")).text();
  const main = /<main id="ch-fallback"([^>]*)>([\s\S]*?)<\/main>/.exec(html);
  expect(main).not.toBeNull();
  expect(main![1]).not.toMatch(/hidden|display\s*:\s*none/);
  expect(main![2]).toContain("Privacy Policy");
  expect(main![2]).toContain("Terms of Use");
});
