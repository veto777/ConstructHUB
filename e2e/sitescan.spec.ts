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
    page.locator("article").getByRole("heading", {
      name: "Missing or long description",
      exact: true,
    }),
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
  await page.getByRole("button", { name: "Copy draft" }).last().click();
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
  await expect(
    page.getByText("Preview shows up to five findings.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("No findings from available checks."),
  ).toHaveCount(0);
  await expect(page.getByText("0 URLs remain", { exact: false })).toHaveCount(
    0,
  );
});

test("configured CAPTCHA can be solved again after a rejected submission", async ({
  page,
}) => {
  await page.route("**/api/sitescan/public/config", (r) =>
    r.fulfill({ json: { captchaSiteKey: "fixture-site-key" } }),
  );
  await page.route("https://www.google.com/recaptcha/api.js*", (r) =>
    r.fulfill({
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
    }),
  );
  let attempts = 0;
  await page.route("**/api/sitescan/public/start", (r) => {
    attempts++;
    return r.fulfill({ status: 400, json: { message: "CAPTCHA failed." } });
  });
  await page.goto("/free-site-scan");
  await page.getByLabel("Website URL").fill("https://fixture.test/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("fixture@example.invalid");
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

test("account history and reports fit a narrow mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const url = "https://sitescan-mobile.test/" + "long-path-".repeat(30);
  await page.route("**/api/sitescan?*", (r) =>
    r.fulfill({
      json: {
        locations: [],
        schedules: [],
        jobs: [
          {
            id: "fixture-mobile",
            url,
            created_at: "2026-09-29",
            status: "completed",
            scores: { overall: 80 },
          },
        ],
      },
    }),
  );
  await page.route("**/api/sitescan/jobs/fixture-mobile?*", (r) =>
    r.fulfill({
      json: {
        url,
        status: "completed",
        pages: 1,
        pageCap: 1,
        aiDraft: url,
        report: {
          pages: 1,
          scores: { overall: 80, categories: { technical: 80 } },
          findings: [],
          jsonLdDraft: { url },
        },
      },
    }),
  );
  await page.goto("/site-scan");
  await page.getByRole("button", { name: /sitescan-mobile/ }).click();
  await expect(
    page.getByRole("heading", { name: "AI fix plan — draft" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const history = await page
    .getByRole("button", { name: /sitescan-mobile/ })
    .boundingBox();
  expect(history!.x + history!.width).toBeLessThanOrEqual(390);
  expect(
    await page
      .locator("pre")
      .evaluateAll((nodes) =>
        nodes.every((n) => n.scrollWidth <= n.clientWidth),
      ),
  ).toBe(true);
});

test("verified quick report progresses from queued to complete and expired shares explain failure", async ({
  page,
}) => {
  let polls = 0;
  await page.route("**/api/sitescan/public/config", (r) =>
    r.fulfill({ json: { captchaSiteKey: null } }),
  );
  await page.route("**/api/sitescan/public/verify", (r) =>
    r.fulfill({
      json:
        ++polls === 1
          ? { status: "queued", report: null }
          : {
              status: "completed",
              report: {
                pages: 11,
                scores: { overall: 80, categories: { technical: 80 } },
                findings: [],
                coverage: { notes: ["Fixture full report"] },
              },
            },
    }),
  );
  await page.goto("/free-site-scan?verify=" + "c".repeat(64));
  await expect(page.getByRole("status")).toContainText("queued");
  await expect(page.getByText("Fixture full report")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await page.route("**/api/sitescan/shared/*", (r) =>
    r.fulfill({ status: 404, json: { message: "Expired" } }),
  );
  await page.goto("/site-scan/report/" + "d".repeat(64));
  await expect(page.getByRole("alert")).toContainText("unavailable or revoked");
});

test("signed-out site-scan uses the free form and account APIs deny access", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.DEV_AUTH_BYPASS_USER1 !== "false",
    "Run against the lane server with bypass disabled",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/site-scan");
  await expect(
    page.getByRole("heading", { name: "Free 60-second website scan" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect((await request.get("/api/sitescan")).status()).toBe(401);
  expect(
    (
      await request.post("/api/sitescan", {
        data: { url: "https://fixture.test/" },
      })
    ).status(),
  ).toBe(401);
  expect((await request.get("/api/admin/sitescan-leads")).status()).toBe(401);
});

test("agency search with 1,000 locations, bulk queue, factual checklist, done, rescan verification and branded PDF", async ({
  page,
  request,
}) => {
  const ids = (
    await pool.query(`INSERT INTO business_locations(user_id,business_name,website,gbp_location_name)
 SELECT 1,'Browser agency fixture '||lpad(i::text,4,'0'),'https://sitescan-agency-browser.test/'||i,'locations/browser-agency-'||i FROM generate_series(1,1000) i RETURNING id`)
  ).rows.map((r) => r.id);
  try {
    await pool.query(
      `INSERT INTO gbp_sync_status(location_id,kind,last_success,profile_snapshot) SELECT id,'profile',now(),jsonb_build_object('business_name',business_name,'website',website) FROM business_locations WHERE id=ANY($1::int[])`,
      [ids],
    );
    await page.goto("/site-scan");
    await page
      .getByLabel("Search client locations")
      .fill("Browser agency fixture 0999");
    await expect(
      page.getByRole("option", { name: "Browser agency fixture 0999" }),
    ).toHaveCount(1);
    await page.getByText(/Bulk scan client sites/).click();
    await page
      .getByRole("button", { name: "Select this page", exact: true })
      .click();
    await page.getByLabel("PageSpeed pages").fill("0");
    await page.getByLabel("Page cap", { exact: true }).fill("2");
    const queued = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/sitescan/bulk") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Queue selected sites" }).click();
    const { jobs } = await (await queued).json();
    expect(jobs).toHaveLength(1);
    const id = jobs[0].id;
    let repaired = false;
    const http = async (url: string) => ({
      url,
      status: url.endsWith("/broken") ? 404 : 200,
      headers: {},
      redirects: [],
      bytes: url.endsWith(".jpg") ? 650000 : 500,
      body: url.endsWith("robots.txt")
        ? "User-agent: *\nAllow: /"
        : url.endsWith("sitemap.xml")
          ? "<urlset/>"
          : url.endsWith("llms.txt")
            ? "# Fixture"
            : `<html data-wf-site="fixture"><head>${repaired ? "<title>Fixture roof repair</title>" : ""}</head><body><h1>Fixture roof repair</h1><p>${"Explicit fixture facts for browser testing. ".repeat(10)}</p>${repaired ? "" : '<a href="/broken">Roof repair</a><img src="/heavy.jpg">'}</body></html>`,
    });
    await runSiteScanWorker({
      crawl,
      http,
      pageSpeed: async () =>
        ({
          url: jobs[0].url,
          strategy: "mobile",
          score: 95,
          lab: {},
          field: null,
          originField: null,
        }) as any,
    });
    await expect(
      page.getByText("Exactly how to fix — prioritized checklist"),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Why Performance is N/A")).toBeVisible();
    await expect(
      page
        .getByRole("note")
        .getByText("PageSpeed was not selected", { exact: false }),
    ).toBeVisible();
    const title = page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Missing or long title",
        exact: true,
      }),
    });
    const mainTitle = title.filter({
      hasText: "Page: https://sitescan-agency-browser.test/999",
    });
    await expect(mainTitle).toContainText("Webflow");
    await mainTitle.getByRole("button", { name: "Copy code" }).click();
    await expect(
      mainTitle.getByRole("button", { name: "Code copied" }),
    ).toBeVisible();
    await mainTitle
      .getByRole("button", { name: "Mark done", exact: true })
      .click();
    await expect(mainTitle).toContainText("Done (reported)");
    await page
      .getByLabel("Send to my web person — email")
      .fill("browser-fixture@example.invalid");
    await page
      .getByRole("button", { name: "Send prioritized checklist" })
      .click();
    await expect(
      page.getByText("Checklist saved to local email sink."),
    ).toBeVisible();
    await page.getByText("White-label PDF branding", { exact: true }).click();
    await page
      .getByLabel("Agency name", { exact: true })
      .fill("Browser Fixture Agency");
    await page.getByLabel("Agency logo", { exact: false }).setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    const savedBrand = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/sitescan/branding") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save PDF branding" }).click();
    expect((await savedBrand).status()).toBe(200);
    const branding = await (await request.get("/api/sitescan/branding")).json();
    expect(branding.name).toBe("Browser Fixture Agency");
    expect(branding.logo).toMatch(/^data:image\/png;base64,/);
    const pdf = await request.get(`/api/sitescan/jobs/${id}/pdf`);
    expect(pdf.ok()).toBe(true);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    repaired = true;
    const retry = page.waitForResponse((r) =>
      r.url().endsWith(`/api/sitescan/jobs/${id}/retry`),
    );
    await page
      .getByRole("button", { name: "Rescan / retry PageSpeed" })
      .click();
    expect((await retry).status()).toBe(202);
    await runSiteScanWorker({
      crawl,
      http,
      pageSpeed: async (url, strategy) =>
        ({
          url,
          strategy,
          score: 95,
          lab: {},
          field: null,
          originField: null,
        }) as any,
    });
    await expect(mainTitle).toContainText("fixed", { timeout: 15000 });
    await expect(mainTitle).toContainText("Done (reported)");
  } finally {
    await pool.query(
      "DELETE FROM sitescan_jobs WHERE url LIKE 'https://sitescan-agency-browser.test/%'",
    );
    await pool.query("DELETE FROM business_locations WHERE id=ANY($1::int[])", [
      ids,
    ]);
    await pool.query(
      "DELETE FROM sitescan_branding WHERE user_id=1 AND name='Browser Fixture Agency'",
    );
  }
});
