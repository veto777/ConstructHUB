import { test, expect } from "@playwright/test";
import { autoSchema } from "../shared/social";
test("connect, compose, schedule, approve an AI draft, configure automatic mode, and read guides", async ({
  page,
}) => {
  let state: any = {
    connected: false,
    accounts: [],
    settings: autoSchema.parse({}),
    posts: [],
  };
  const requests: any[] = [];
  let uploadBytes = "";
  let finishUpload!: () => void;
  const uploadFinished = new Promise<void>(resolve => { finishUpload = resolve; });
  await page.route("https://example.com/fixture-upload", async route => {
    expect(route.request().method()).toBe("PUT");
    uploadBytes = route.request().postData() || "";
    await uploadFinished;
    await route.fulfill({ status: 200, body: "" });
  });
  // Browser contract fixture: no key or publish request can reach Blotato or AI.
  await page.route("**/api/social**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const body = req.method() === "GET" ? null : req.postDataJSON();
    requests.push({ path, body });
    let result: any = { ok: true };
    if (path === "/api/social") result = state;
    else if (path === "/api/social/connect") {
      state.connected = true;
      state.accounts = [
        { id: "fixture-x", name: "Fixture business", platform: "twitter" },
      ];
      result = { connected: true, accounts: state.accounts };
    } else if (path === "/api/social/media")
      result = [
        {
          id: 1,
          name: "Fixture project photo",
          url: "https://example.com/fixture.jpg",
        },
      ];
    else if (path === "/api/social/sources") result = [];
    else if (path === "/api/social/uploads") result = { presignedUrl: "https://example.com/fixture-upload", publicUrl: "https://example.com/uploaded-fixture.jpg" };
    else if (path === "/api/social/posts") {
      const p = {
        id: crypto.randomUUID(),
        state: body.draft ? "draft" : "queued",
        due_at: body.scheduledTime || new Date().toISOString(),
        payload: {
          post: {
            content: {
              platform: "twitter",
              text: body.tweaks.twitter || body.text,
              mediaUrls: body.mediaUrls,
            },
          },
        },
      };
      state.posts.unshift(p);
      result = { posts: [p] };
    } else if (path === "/api/social/settings") state.settings = body;
    else if (path === "/api/social/generate") {
      state.posts.unshift({
        id: crypto.randomUUID(),
        state: "draft",
        ai_generated: true,
        due_at: new Date().toISOString(),
        payload: {
          post: { content: { platform: "twitter", text: "AI fixture draft" } },
        },
      });
    } else if (path.endsWith("/action")) {
      const p = state.posts.find((p: any) => path.includes(p.id));
      p.state = body.action === "approve" ? "queued" : "cancelled";
      if (body.text) p.payload.post.content.text = body.text;
    } else if (path === "/api/social/disconnect") {
      state.connected = false;
      state.accounts = [];
    } else throw new Error(`Unmocked Social request ${path}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/social-media");
  await expect(
    page.getByRole("heading", { name: "Social Media", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Blotato is a separate subscription you buy from Blotato.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Blotato API key").fill("fixture-key-never-real");
  await page
    .getByRole("button", { name: "Connect Blotato", exact: true })
    .click();
  await expect(page.getByLabel("Blotato API key")).toHaveValue("");
  await page
    .getByRole("checkbox", { name: "Fixture business · twitter" })
    .check();
  await page
    .getByLabel("Post text", { exact: true })
    .fill("Fixture project update");
  await page.getByLabel("twitter text tweak").fill("Short fixture update");
  await page
    .getByLabel("Media Library", { exact: true })
    .selectOption("https://example.com/fixture.jpg");
  await page.getByLabel("Upload media", { exact: true }).setInputFiles({ name: "fixture.jpg", mimeType: "image/jpeg", buffer: Buffer.from("explicit upload fixture bytes") });
  await expect.poll(() => uploadBytes).toBe("explicit upload fixture bytes");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeDisabled();
  finishUpload();
  await expect(page.getByRole("button", { name: "Post now", exact: true })).toBeEnabled();
  await page
    .getByLabel("Schedule time", { exact: true })
    .fill("2030-10-05T10:00");
  await page
    .getByRole("button", { name: "Schedule post", exact: true })
    .click();
  await expect(
    page.getByText("Short fixture update", { exact: true }),
  ).toBeVisible();
  const post = requests.find((r) => r.path === "/api/social/posts").body;
  expect(post.destinations[0].accountId).toBe("fixture-x");
  expect(post.mediaUrls).toEqual(["https://example.com/fixture.jpg", "https://example.com/uploaded-fixture.jpg"]);
  expect(post.scheduledTime).toContain("2030-10-05");
  await page.getByRole("button", { name: "Auto mode", exact: true }).click();
  await page
    .getByRole("button", { name: "Use accounts selected in Compose" })
    .click();
  await page.getByRole("checkbox", { name: "Enable auto mode" }).check();
  await page.getByRole("button", { name: "Save auto settings" }).click();
  await expect.poll(() => state.settings.enabled).toBe(true);
  expect(state.settings.mode).toBe("approval");
  await page
    .getByRole("button", { name: "Generate draft from saved settings" })
    .click();
  await page.getByRole("button", { name: "Calendar & queue" }).click();
  await expect(
    page.getByText("AI-generated draft", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Edit draft").fill("Reviewed AI fixture");
  await page.getByRole("button", { name: "Approve & queue" }).click();
  await expect(
    page.getByText("Reviewed AI fixture", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Auto mode", exact: true }).click();
  await page.getByLabel("Publishing mode").selectOption("automatic");
  await page.getByLabel("Daily AI budget").fill("2");
  await page.getByRole("button", { name: "Save auto settings" }).click();
  await expect.poll(() => state.settings.mode).toBe("automatic");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await page.goto("/guides");
  for (const title of [
    "Guides",
    "Connect Blotato",
    "Manual posting",
    "Auto mode",
    "Profile Guard",
    "AI review replies",
    "Posts & Photos scheduling and AI captions",
    "Security",
    "Site Scan",
  ])
    await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
});

test("guides match shipped approval controls and link to every walkthrough", async ({ page }) => {
  await page.goto("/guides");
  const main = page.getByRole("region", { name: "Guides walkthroughs" });
  for (const [label, href] of [
    ["Open Locations", "/locations"], ["Open Google Reviews", "/google-reviews"],
    ["Open Posts & Photos", "/gbp-content"], ["Open Security & activity", "/settings?tab=security"],
    ["Open Site Scan", "/site-scan"],
  ]) await expect(main.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  for (const text of ["Approve snapshot and save settings", "Confirm backfill", "Approve & queue photos", "Verify & Enable", "Revoke share link"])
    await expect(main.getByText(text, { exact: false }).first()).toBeVisible();
  await expect(main).not.toContainText("labels may vary");
  await main.getByRole("link", { name: "Open Site Scan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Site Scan", exact: true })).toBeVisible();
});

test("growth tools remain discoverable with Google Business collapsed", async ({ page }) => {
  await page.goto("/guides");
  const google = page.getByTestId("link-nav-group-google-business");
  await expect(google).toHaveAttribute("aria-expanded", "false");
  for (const name of ["social-media", "site-scan", "guides"])
    await expect(page.getByTestId(`link-nav-${name}`)).toBeVisible();
  await google.click();
  await expect(google).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("link-nav-posts-&-photos")).toBeVisible();
});

test("social tabs and guides fit a narrow phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/social**", route => route.fulfill({ json: route.request().url().endsWith("/social") ? { connected: false, accounts: [], settings: autoSchema.parse({}), posts: [] } : [] }));
  await page.goto("/social-media");
  for (const name of ["Compose", "Calendar & queue", "Auto mode"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const overflowing = await page.locator("main button, main input, main select").evaluateAll(elements => elements.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map(e => e.textContent || e.getAttribute("aria-label")));
    expect(overflowing).toEqual([]);
  }
  await page.goto("/guides");
  await expect(page.getByRole("region", { name: "Guides walkthroughs" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
