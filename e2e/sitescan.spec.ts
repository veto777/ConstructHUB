import { test, expect } from "@playwright/test";
import { pool } from "../server/db";
import { runSiteScanWorker } from "../server/sitescan/worker";
import { crawl } from "../server/sitescan/audit";
test.afterAll(async () => {
  await pool.query(
    "DELETE FROM sitescan_jobs WHERE url='https://sitescan-browser.test/'",
  );
  await pool.query(
    "DELETE FROM sitescan_schedules WHERE url='https://sitescan-browser.test/'",
  );
  await pool.end();
});
test("start, live progress, report, draft, PDF, share and revoke", async ({
  page,
  request,
}) => {
  await page.goto("/site-scan");
  await expect(
    page.getByRole("heading", { name: "Site Scan", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Website URL").fill("https://sitescan-browser.test");
  await page.getByLabel("PageSpeed pages").fill("0");
  await page.getByLabel("Page cap").fill("3");
  const started = page.waitForResponse(
    (r) => r.url().endsWith("/api/sitescan") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start scan", exact: true }).click();
  const { id } = await (await started).json();
  await expect(
    page.getByRole("status").filter({ hasText: "queued" }),
  ).toBeVisible();
  const http = async (url: string) => ({
    url,
    status: 200,
    headers: {},
    redirects: [],
    bytes: 200,
    body: url.endsWith("robots.txt")
      ? "User-agent: *\nAllow: /"
      : url.endsWith("sitemap.xml")
        ? "<urlset/>"
        : url.endsWith("llms.txt")
          ? "# Fixture"
          : "<html><title>Browser fixture</title><body><h1>Browser fixture</h1><p>Explicit test content, not business data.</p></body></html>",
  });
  await runSiteScanWorker({
    crawl,
    http,
    pageSpeed: async () => {
      throw new Error("PSI must not be called");
    },
  });
  await expect(
    page.getByRole("status").filter({ hasText: "completed" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByText("Missing or long description", { exact: false }),
  ).toBeVisible();
  await page.route(`**/api/sitescan/jobs/${id}/plan`, (route) =>
    route.fulfill({ json: { draft: "AI DRAFT: Browser fixture title" } }),
  );
  // Persist explicit fixture draft for the polling report; AI HTTP remains intercepted.
  await pool.query("UPDATE sitescan_jobs SET ai_draft=$2 WHERE id=$1", [
    id,
    "AI DRAFT: Browser fixture title",
  ]);
  await page.getByRole("button", { name: "Generate AI fix plan" }).click();
  await expect(
    page.getByRole("heading", { name: "AI fix plan — draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy draft" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const pdf = await request.get(`/api/sitescan/jobs/${id}/pdf`);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: "Create share link" }).click();
  const link = page.getByRole("link", { name: /http.*site-scan\/report/ });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(
    (await request.get("/api/sitescan/shared/" + href!.split("/").pop())).ok(),
  ).toBeTruthy();
  const shared = await page.context().newPage();
  await shared.goto(href!);
  await expect(
    shared.getByRole("heading", { name: "Shared Site Scan" }),
  ).toBeVisible();
  await expect(
    shared.getByRole("button", { name: "Generate AI fix plan" }),
  ).toHaveCount(0);
  await shared.close();
  await page.getByRole("button", { name: "Revoke share link" }).click();
  await expect(link).not.toBeVisible();
  expect(
    (
      await request.get("/api/sitescan/shared/" + href!.split("/").pop())
    ).status(),
  ).toBe(404);
  await page.getByRole("button", { name: "Enable monthly rescan" }).click();
  await expect(
    page.getByRole("button", { name: "Disable monthly rescan" }),
  ).toBeVisible();
});
test("public lead magnet shows summary and email verification guidance", async ({
  page,
}) => {
  await page.route("**/api/sitescan/public/config", (r) =>
    r.fulfill({ json: { captchaSiteKey: null } }),
  );
  await page.route("**/api/sitescan/public/start", (r) =>
    r.fulfill({ status: 202, json: { access: "a".repeat(64) } }),
  );
  await page.route("**/api/sitescan/public/status/*", (r) =>
    r.fulfill({
      json: {
        status: "completed",
        summary: {
          pages: 1,
          scores: {
            overall: 72,
            categories: { technical: 72, performance: null },
          },
          findings: [
            {
              id: "title",
              category: "content",
              severity: "warning",
              title: "Missing title",
              why: "Search snippets need context.",
              fix: "Write a factual title.",
              urls: ["https://fixture.test/"],
            },
          ],
        },
      },
    }),
  );
  await page.goto("/free-site-scan");
  await page.getByLabel("Website URL").fill("https://fixture.test/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("fixture@example.invalid");
  await page.getByRole("button", { name: "Scan my website" }).click();
  await expect(
    page.getByText("Check your email for the verification link"),
  ).toBeVisible();
  await expect(page.getByText("Missing title", { exact: false })).toBeVisible();
  await expect(page.getByText("Preview shows up to five findings.", { exact: false })).toBeVisible();
  await expect(page.getByText("No findings from available checks.")).toHaveCount(0);
  await expect(page.getByText("0 URLs remain", { exact: false })).toHaveCount(0);
});

test("configured CAPTCHA can be solved again after a rejected submission", async ({ page }) => {
  await page.route("**/api/sitescan/public/config", r => r.fulfill({ json: { captchaSiteKey: "fixture-site-key" } }));
  await page.route("https://www.google.com/recaptcha/api.js*", r => r.fulfill({
    contentType: "application/javascript",
    body: `window.grecaptcha = {
      ready: callback => callback(),
      render: (id, options) => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Solve fixture CAPTCHA';
        button.onclick = () => options.callback('fixture-token');
        document.getElementById(id).appendChild(button);
        return 0;
      },
      reset: () => { window.captchaReset = true; }
    };`,
  }));
  let attempts = 0;
  await page.route("**/api/sitescan/public/start", r => {
    attempts++;
    return r.fulfill({ status: 400, json: { message: "CAPTCHA failed." } });
  });
  await page.goto("/free-site-scan");
  await page.getByLabel("Website URL").fill("https://fixture.test/");
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.invalid");
  const submit = page.getByRole("button", { name: "Scan my website" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Solve fixture CAPTCHA" }).click();
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("CAPTCHA failed");
  await expect(submit).toBeDisabled();
  expect(await page.evaluate(() => (window as any).captchaReset)).toBe(true);
  await page.getByRole("button", { name: "Solve fixture CAPTCHA" }).click();
  await submit.click();
  await expect.poll(() => attempts).toBe(2);
});

test("account history and reports fit a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const url = "https://sitescan-mobile.test/" + "long-path-".repeat(30);
  await page.route("**/api/sitescan", r => r.fulfill({ json: {
    locations: [], schedules: [], jobs: [{ id: "fixture-mobile", url, created_at: "2026-09-29", status: "completed", scores: { overall: 80 } }],
  } }));
  await page.route("**/api/sitescan/jobs/fixture-mobile", r => r.fulfill({ json: {
    url, status: "completed", pages: 1, pageCap: 1, aiDraft: url,
    report: { pages: 1, scores: { overall: 80, categories: { technical: 80 } }, findings: [], jsonLdDraft: { url } },
  } }));
  await page.goto("/site-scan");
  await page.getByRole("button", { name: /sitescan-mobile/ }).click();
  await expect(page.getByRole("heading", { name: "AI fix plan — draft" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const history = await page.getByRole("button", { name: /sitescan-mobile/ }).boundingBox();
  expect(history!.x + history!.width).toBeLessThanOrEqual(390);
  expect(await page.locator("pre").evaluateAll(nodes => nodes.every(n => n.scrollWidth <= n.clientWidth))).toBe(true);
});

test("verified quick report progresses from queued to complete and expired shares explain failure", async ({ page }) => {
  let polls = 0;
  await page.route("**/api/sitescan/public/config", r => r.fulfill({ json: { captchaSiteKey: null } }));
  await page.route("**/api/sitescan/public/verify", r => r.fulfill({ json: ++polls === 1
    ? { status: "queued", report: null }
    : { status: "completed", report: { pages: 11, scores: { overall: 80, categories: { technical: 80 } }, findings: [], coverage: { notes: ["Fixture full report"] } } },
  }));
  await page.goto("/free-site-scan?verify=" + "c".repeat(64));
  await expect(page.getByRole("status")).toContainText("queued");
  await expect(page.getByText("Fixture full report")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.route("**/api/sitescan/shared/*", r => r.fulfill({ status: 404, json: { message: "Expired" } }));
  await page.goto("/site-scan/report/" + "d".repeat(64));
  await expect(page.getByRole("alert")).toContainText("unavailable or revoked");
});

test("signed-out site-scan uses the free form and account APIs deny access", async ({ page, request }) => {
  test.skip(process.env.DEV_AUTH_BYPASS_USER1 !== "false", "Run against the lane server with bypass disabled");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/site-scan");
  await expect(page.getByRole("heading", { name: "Free 60-second website scan" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect((await request.get("/api/sitescan")).status()).toBe(401);
  expect((await request.post("/api/sitescan", { data: { url: "https://fixture.test/" } })).status()).toBe(401);
  expect((await request.get("/api/admin/sitescan-leads")).status()).toBe(401);
});
