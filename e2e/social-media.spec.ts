import { test, expect, type Page } from "@playwright/test";
import { autoSchema } from "../shared/social";

/**
 * Social Media is a full-screen tool (components/social-tool/nav.ts): each view is its own route and the menu is the
 * rail on wide screens and the top tabs on phones. The business switcher is in the tool bar; its "Business list…" /
 * "All … businesses and bulk actions…" choice (?pick=1) shows the full list with its pills.
 */
async function openView(page: Page, key: "overview" | "calendar" | "compose" | "posts" | "analytics" | "inbox" | "accounts" | "auto" | "guides") {
  const rail = page.getByTestId(`tool-rail-${key}`);
  if (await rail.isVisible()) await rail.click();
  else await page.getByTestId(`tool-tab-${key}`).click();
  await expect(page).toHaveURL(new RegExp(`/social-media${key === "overview" ? "" : `/${key}`}(\\?|$)`));
}
const businessSwitch = (page: Page) => page.getByTestId("social-business-switch").locator("select");
async function businessList(page: Page) {
  await businessSwitch(page).selectOption("__pick");
  await expect(page).toHaveURL(/pick=1/);
}

for (const draft of [false, true]) {
test(`lost ${draft ? "draft" : "post"} response survives navigation and reload with one post per destination`, async ({ page }, testInfo) => {
  const destinations = [
    { accountId: "recovery-x", platform: "twitter", privacy: "private", tiktokPublic: false, isBrandedContent: false, isYourBrand: false },
    { accountId: "recovery-threads", platform: "threads", privacy: "private", tiktokPublic: false, isBrandedContent: false, isYourBrand: false },
  ];
  const requests: any[] = [];
  const accepted = new Map<string, any[]>();
  await page.route("**/api/social**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/posts") {
      const body = route.request().postDataJSON();
      requests.push(body);
      if (!accepted.has(body.requestId)) accepted.set(body.requestId, body.destinations.map((d: any) => ({
        id: crypto.randomUUID(), state: body.draft ? "draft" : "queued", due_at: new Date().toISOString(),
        payload: { post: { content: { platform: d.platform, text: body.tweaks[d.platform] || body.text, mediaUrls: body.mediaUrls } } },
      })));
      // Simulate commit succeeding, with the first response lost on the network.
      if (requests.length === 1) return route.abort("failed");
      return route.fulfill({ json: { posts: accepted.get(body.requestId) } });
    }
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Recovery fixture" }], total: 1 } });
    if (path === "/api/social") return route.fulfill({ json: {
      connected: true, accounts: destinations.map(d => ({ id: d.accountId, platform: d.platform, name: d.platform })),
      defaults: destinations, settings: autoSchema.parse({}), posts: [...accepted.values()].flat(), total: [...accepted.values()].flat().length,
    } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media/compose?business=1");
  await page.getByLabel("Post text", { exact: true }).fill("Recovery fixture update");
  await page.getByLabel("threads text tweak", { exact: true }).fill("Threads recovery fixture");
  await page.getByLabel("Public media URLs", { exact: true }).fill("https://example.com/recovery.jpg");
  await page.getByRole("button", { name: draft ? "Save draft" : "Post now", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry saved submission", exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await page.goBack();
  await expect(retry).toBeVisible();
  await page.reload(); // Discards module memory, exercising sessionStorage recovery too.
  await expect(page.getByLabel("Post text", { exact: true })).toHaveValue("Recovery fixture update");
  await expect(page.getByLabel("Post text", { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await retry.scrollIntoViewIfNeeded();
  await retry.focus();
  await expect(retry).toBeFocused();
  expect(await retry.evaluate(el => {
    const style = getComputedStyle(el);
    return style.boxShadow !== "none" || (style.outlineStyle !== "none" && style.outlineWidth !== "0px");
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("submission-recovery-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("submission-recovery-desktop.png"), fullPage: true });
  await retry.click();
  await expect(page).toHaveURL(/\/social-media\/posts\?business=1/);
  await expect(page.getByRole("heading", { level: 1, name: "Posts" })).toBeVisible();
  await openView(page, "compose");
  await expect(retry).toHaveCount(0);
  await expect(page.getByLabel("Post text", { exact: true })).toHaveValue("");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect([...accepted.values()].flat()).toHaveLength(2);
  await page.getByLabel("Post text", { exact: true }).fill("A separate new post");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2].requestId).not.toBe(requests[0].requestId);
});
}

test("switching account in place resets composer and restores only that account's draft", async ({ page }) => {
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Account fixture" }], total: 1 } });
    if (path === "/api/social") return route.fulfill({ json: { connected: true, accounts: [], defaults: [], posts: [], total: 0, settings: autoSchema.parse({}) } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media/compose?business=1");
  const text = page.getByLabel("Post text", { exact: true });
  await text.fill("Original account draft");
  const original = await page.evaluate(async () => {
    const modulePath = "/src/lib/queryClient.ts";
    const { queryClient } = await import(/* @vite-ignore */ modulePath);
    const me = queryClient.getQueryData(["/api/auth/me"]);
    queryClient.setQueryData(["/api/auth/me"], { ...me, id: "recovery-second-account" });
    return me;
  });
  await expect(text).toHaveValue("");
  await text.fill("Second account draft");
  await page.evaluate(async me => {
    const modulePath = "/src/lib/queryClient.ts";
    const { queryClient } = await import(/* @vite-ignore */ modulePath);
    queryClient.setQueryData(["/api/auth/me"], me);
  }, original);
  await expect(text).toHaveValue("Original account draft");
  await page.evaluate(async () => {
    const modulePath = "/src/lib/queryClient.ts";
    const { queryClient } = await import(/* @vite-ignore */ modulePath);
    const me = queryClient.getQueryData(["/api/auth/me"]);
    queryClient.setQueryData(["/api/auth/me"], { ...me, id: "recovery-second-account" });
  });
  await expect(text).toHaveValue("Second account draft");
});

test("validation rejection keeps the composer editable for a corrected new request", async ({ page }) => {
  const requests: any[] = [];
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/posts") {
      requests.push(route.request().postDataJSON());
      return requests.length === 1
        ? route.fulfill({ status: 400, json: { message: "Use a shorter post" } })
        : route.fulfill({ json: { posts: [] } });
    }
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Validation fixture" }], total: 1 } });
    if (path === "/api/social") return route.fulfill({ json: { connected: true, accounts: [{ id: "validation-x", platform: "twitter", name: "Validation" }], defaults: [{ accountId: "validation-x", platform: "twitter" }], posts: [], total: 0, settings: autoSchema.parse({}) } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media/compose?business=1");
  const text = page.getByLabel("Post text", { exact: true });
  await text.fill("x".repeat(281));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(text).toBeEnabled();
  await expect(page.getByText("Use a shorter post", { exact: true })).toBeVisible();
  await text.fill("Corrected post");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].text).toBe("Corrected post");
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
});

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
    if (path === "/api/social/businesses") result = {items:[{id:1,business_name:'Fixture business'}],total:1};
    else if (path === "/api/social/accounts") result = {items:state.accounts,hasMore:false};
    else if (path === "/api/social") result = {...state,total:state.posts.length,business:{business_name:'Fixture business'}};
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
    else if (path === "/api/social/youtube/status")
      result = {
        configured: false,
        connected: false,
        needsReconnect: false,
        channel: null,
        connectedAt: null,
        lastError: null,
        limits: { perDay: 3, usedToday: 0, sharedLimitReached: false, maxBytes: 1, maxWaitingFiles: 1, fileTypes: [] },
      };
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
  await page.goto("/social-media/accounts?business=1");
  await expect(
    page.getByRole("heading", { level: 1, name: "Accounts", exact: true }),
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
  await openView(page, "compose");
  await page.locator("fieldset")
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
  // Scheduling clears the composer (the toast says so); pick the account again for auto mode.
  await openView(page, "compose");
  await page.locator("fieldset")
    .getByRole("checkbox", { name: "Fixture business · twitter" })
    .check();
  const post = requests.find((r) => r.path === "/api/social/posts").body;
  expect(post.destinations[0].accountId).toBe("fixture-x");
  expect(post.mediaUrls).toEqual(["https://example.com/fixture.jpg", "https://example.com/uploaded-fixture.jpg"]);
  expect(post.scheduledTime).toContain("2030-10-05");
  await openView(page, "auto");
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
  await openView(page, "posts");
  await expect(
    page.getByText("AI-generated draft", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(/^Edit draft for /).fill("Reviewed AI fixture");
  await page.getByRole("button", { name: "Approve & queue" }).click();
  await expect(
    page.getByText("Reviewed AI fixture", { exact: true }),
  ).toBeVisible();
  await openView(page, "auto");
  await page.getByLabel("Publishing mode").selectOption("automatic");
  await page.getByLabel("Daily AI budget").fill("2");
  await page.getByRole("button", { name: "Save auto settings" }).click();
  await expect.poll(() => state.settings.mode).toBe("automatic");
  await openView(page, "accounts");
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
  // /guides is its own page again (fix/tools-course); the Social tab embeds it with a link out.
  await page.goto("/guides");
  await expect(page).toHaveURL(/\/guides$/);
  const main = page.getByRole("region", { name: "Guides walkthroughs" });
  await expect(main).toBeVisible();
  for (const [label, href] of [
    ["Open Locations", "/locations"], ["Open Google Reviews", "/google-reviews"],
    ["Open Posts & Photos", "/gbp-content"], ["Open Security & activity", "/settings?tab=security"],
    ["Open Site Scan", "/site-scan"],
  ]) await expect(main.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  for (const text of ["Approve snapshot and save settings", "Confirm backfill", "Approve & queue photos", "Verify & Enable", "Revoke share link"])
    await expect(main.getByText(text, { exact: false }).first()).toBeVisible();
  await expect(main).not.toContainText("labels may vary");
  await main.getByRole("link", { name: "Open Site Scan", exact: true }).click();
  await expect(page).toHaveURL(/\/site-scan(\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "New scan", exact: true })).toBeVisible();
});

test("growth tools remain discoverable with Google Business collapsed", async ({ page }) => {
  await page.goto("/guides");
  const google = page.getByTestId("link-nav-group-google-business");
  await expect(google).toHaveAttribute("aria-expanded", "false");
  for (const name of ["social-media", "site-scan"])
    await expect(page.getByTestId(`link-nav-${name}`)).toBeVisible();
  await google.click();
  await expect(google).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("link-nav-posts-&-photos")).toBeVisible();
});

test("social tabs and guides fit a narrow phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/social**", route => { const path=new URL(route.request().url()).pathname; return route.fulfill({json:path==='/api/social/businesses'?{items:[{id:1,business_name:'Fixture business'}],total:1}:path==='/api/social/accounts'?{items:[],hasMore:false}:path==='/api/social'?{ connected: false, accounts: [], settings: autoSchema.parse({}), posts: [],defaults:[] }:path==='/api/social/youtube/status'?{ configured:false, connected:false, needsReconnect:false, channel:null, connectedAt:null, lastError:null, limits:{ perDay:3, usedToday:0, sharedLimitReached:false, maxBytes:1, maxWaitingFiles:1, fileTypes:[] } } : []}); });
  await page.goto("/social-media?business=1");
  for (const key of ["compose", "posts", "auto", "guides"] as const) {
    await openView(page, key);
    const overflowing = await page.locator("main button, main input, main select").evaluateAll(elements => elements.filter(e => { if (e.closest(".tool-tabs__scroll")) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map(e => e.textContent || e.getAttribute("aria-label")));
    expect(overflowing).toEqual([]);
  }
  await page.goto("/guides");
  await expect(page.getByRole("region", { name: "Guides walkthroughs" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

const YT_STATUS = { configured: false, connected: false, needsReconnect: false, channel: null, connectedAt: null, lastError: null, limits: { perDay: 3, usedToday: 0, sharedLimitReached: false, maxBytes: 1, maxWaitingFiles: 1, fileTypes: [] } };

test("unsaved draft edits survive status-filter, tab and business-switch round trips", async ({ page }) => {
  const draft = { id: "11111111-1111-4111-8111-111111111111", state: "draft", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Fixture draft text" } } } };
  const queued = { id: "22222222-2222-4222-8222-222222222222", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Fixture queued text" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social") return route.fulfill({ json: { connected: true, accounts: [], settings: autoSchema.parse({}), posts: [draft, queued], total: 2, defaults: [] } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media/posts?business=1");
  const edit = page.getByLabel(/^Edit draft for /);
  await edit.fill("Edited marker text");
  // The row unmounts and remounts on each of these; the edit must not die with it.
  await page.getByLabel("Post status filter", { exact: true }).selectOption("queued");
  await expect(edit).toHaveCount(0);
  await page.getByLabel("Post status filter", { exact: true }).selectOption("");
  await expect(edit).toHaveValue("Edited marker text");
  await openView(page, "auto");
  await openView(page, "posts");
  await expect(edit).toHaveValue("Edited marker text");
  await businessList(page);
  await page.getByRole("button", { name: "All-clients calendar", exact: true }).click();
  await expect(page).toHaveURL(/business=all/);
  // One business: the bar's menu has no other entry to pick, so go back through the list's Open button.
  await businessList(page);
  await page.getByTestId("button-open-business-1").click();
  await expect(page).toHaveURL(/business=1/);
  await openView(page, "posts");
  await expect(edit).toHaveValue("Edited marker text");
  // Discard returns to the saved text.
  await page.getByTestId(`button-post-discard-${draft.id}`).click();
  await expect(edit).toHaveValue("Fixture draft text");
});

test("'How it works' opens the standalone social guides from all-clients mode", async ({ page }) => {
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: [], total: 0 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await page.getByRole("heading", { name: /^All clients/ }).waitFor();
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page).toHaveURL(/\/guides\?topic=social$/);
  await expect(page.getByRole("region", { name: "Guides walkthroughs" })).toBeVisible();
  await expect(page.getByTestId("chip-topic-social")).toHaveAttribute("aria-pressed", "true");
});

test("bulk cancel asks first, naming the count and the businesses", async ({ page }) => {
  let bulkBody: any = null;
  const p1 = { id: "33333333-3333-4333-8333-333333333333", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Fixture queued one" } } } };
  const p2 = { id: "44444444-4444-4444-8444-444444444444", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Second business", payload: { post: { content: { platform: "twitter", text: "Fixture queued two" } } } };
  await page.route("**/api/social**", route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === "/api/social/posts/bulk-action") { bulkBody = req.postDataJSON(); return route.fulfill({ json: { results: [p1, p2].map((p) => ({ id: p.id, ok: true })) } }); }
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: [p1, p2], total: 2 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await page.getByRole("button", { name: "Select this page of posts", exact: true }).click();
  await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
  const dialog = page.getByTestId("dialog-bulk-cancel-posts");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Cancel 2 selected posts?");
  await expect(dialog).toContainText("2 businesses");
  await expect(dialog).toContainText("Fixture business (1)");
  await expect(dialog).toContainText("Second business (1)");
  // Keep sends nothing.
  await dialog.getByRole("button", { name: "Keep them" }).click();
  await expect(dialog).toBeHidden();
  expect(bulkBody).toBeNull();
  // Confirm cancels exactly the selected ids.
  await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
  await page.getByTestId("button-bulk-cancel-confirm").click();
  await expect.poll(() => bulkBody && [...bulkBody.ids].sort()).toEqual([p1.id, p2.id].sort());
  expect(bulkBody.action).toBe("cancel");
});

test("zero-match business search says so; only a truly empty account says add a location", async ({ page }) => {
  const all = [{ id: 1, business_name: "Fixture business" }, { id: 2, business_name: "Second business" }];
  let emptyAccount = false;
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()), search = path.searchParams.get("search") || "";
    if (path.pathname === "/api/social/businesses") {
      const items = (emptyAccount ? [] : all).filter((b) => b.business_name.toLowerCase().includes(search.toLowerCase()));
      return route.fulfill({ json: { items, total: items.length } });
    }
    if (path.pathname === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media");
  // The account has businesses; a search that matches nothing says so (not "No businesses yet").
  await page.getByLabel("Search businesses", { exact: true }).fill("nothing-matches-this");
  await expect(page.getByTestId("text-no-business-match")).toBeVisible();
  await expect(page.getByTestId("empty-social-businesses")).toHaveCount(0);
  // An account with no businesses at all points at Locations, even with a search active.
  emptyAccount = true;
  await page.reload();
  await page.getByLabel("Search businesses", { exact: true }).fill("anything");
  await expect(page.getByTestId("empty-social-businesses")).toBeVisible();
  await expect(page.getByTestId("empty-social-businesses").getByRole("link", { name: "Add a location" })).toBeVisible();
  await expect(page.getByTestId("text-no-business-match")).toHaveCount(0);
});

test('agency searches 1,000 saved businesses, remembers URL scope, isolates sources and queues bulk work', async ({page})=>{
  const {Pool}=await import('pg');
  const db=new Pool({connectionString:process.env.DATABASE_URL});
  if(!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname))throw new Error('a4 DB required');
  const marker=`Social E2E ${Date.now()}`;
  const {rows}=await db.query("INSERT INTO business_locations(user_id,business_name,city) SELECT 1,$1||' '||lpad(n::text,4,'0'),'Fixture city' FROM generate_series(1,1000) n RETURNING id,business_name",[marker]);
  const [a,b]=rows;
  try {
    await page.goto('/social-media');
    await page.getByLabel('Search businesses',{exact:true}).fill(marker);
    await expect(page.getByText('1000 businesses.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Next businesses',exact:true}).click();
    await expect(page.getByRole('button',{name:`${marker} 0026 · Fixture city`,exact:true})).toBeVisible();
    await page.getByLabel('Search businesses',{exact:true}).fill(`${marker} 0001`);
    await page.getByRole('button',{name:`${a.business_name} · Fixture city`,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`business=${a.id}`));
    await openView(page,'auto');
    await page.getByLabel('Source text',{exact:true}).fill('Business A private fixture source');
    await page.getByRole('button',{name:'Add content source',exact:true}).click();
    await expect(page.getByText('offers: Business A private fixture source',{exact:true})).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`business=${a.id}`));
    await expect(page.getByText('offers: Business A private fixture source',{exact:true})).toBeVisible();
    await businessList(page);
    await page.getByLabel('Search businesses',{exact:true}).fill(`${marker} 0002`);
    await page.getByRole('button',{name:`${b.business_name} · Fixture city`,exact:true}).click();
    await expect(page.getByText('offers: Business A private fixture source',{exact:true})).toHaveCount(0);
    await businessList(page);
    await page.getByRole('button',{name:'Bulk actions (0)',exact:true}).click();
    await page.getByRole('checkbox',{name:`Select ${b.business_name} for bulk`,exact:true}).check();
    await page.getByLabel('Search businesses',{exact:true}).fill(`${marker} 0001`);
    await page.getByRole('checkbox',{name:`Select ${a.business_name} for bulk`,exact:true}).check();
    await page.getByLabel('Bulk post text',{exact:true}).fill('Fixture update for {business} in {city}');
    await page.getByLabel('Bulk media URLs',{exact:true}).fill('https://example.com/agency-fixture.jpg');
    await page.getByRole('button',{name:'Create bulk drafts',exact:true}).click();
    await expect.poll(async()=>Number((await db.query('SELECT count(*) n FROM social_bulk_jobs WHERE user_id=1 AND business_id=ANY($1)',[[a.id,b.id]])).rows[0].n)).toBe(2);
    expect((await db.query('SELECT payload FROM social_bulk_jobs WHERE user_id=1 AND business_id=$1',[a.id])).rows[0].payload.mediaUrls).toEqual(['https://example.com/agency-fixture.jpg']);
    await page.getByRole('button',{name:'All-clients calendar',exact:true}).click();
    await expect(page).toHaveURL(/business=all/);
    await expect(page.getByLabel('Search calendar',{exact:true})).toBeVisible();
    await page.getByLabel('Post status filter',{exact:true}).selectOption('draft');
    await expect(page.getByRole('heading',{name:/^All clients/})).toBeVisible();
  } finally {
    await db.query('DELETE FROM business_locations WHERE user_id=1 AND id=ANY($1)',[rows.map(r=>r.id)]);
    await db.end();
  }
});


test("row edits and a new composition survive How it works, browser Back and business switches", async ({ page }) => {
  const draft = { id: "55555555-5555-4555-8555-555555555555", state: "draft", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Saved draft text" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }, { id: 2, business_name: "Second business" }], total: 2 } });
    if (path === "/api/social") return route.fulfill({ json: { connected: true, accounts: [], settings: autoSchema.parse({}), posts: [draft], total: 1, defaults: [] } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media/posts?business=1");
  const edit = page.getByLabel(/^Edit draft for /);
  await edit.fill("Surviving row edit");
  await openView(page, "compose");
  await page.getByLabel("Post text", { exact: true }).fill("Surviving composition");
  await page.getByLabel("Public media URLs", { exact: true }).fill("https://example.com/survives.jpg");
  await page.getByLabel("Schedule time", { exact: true }).fill("2030-10-05T10:00");
  // Leave through "How it works" and return with the browser — nothing may be lost.
  await page.getByRole("link", { name: "How it works", exact: true }).click();
  await expect(page).toHaveURL(/\/guides\?topic=social$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/social-media\/compose\?business=1/);
  await openView(page, "posts");
  await expect(edit).toHaveValue("Surviving row edit");
  await openView(page, "compose");
  await expect(page.getByLabel("Post text", { exact: true })).toHaveValue("Surviving composition");
  await expect(page.getByLabel("Public media URLs", { exact: true })).toHaveValue("https://example.com/survives.jpg");
  await expect(page.getByLabel("Schedule time", { exact: true })).toHaveValue("2030-10-05T10:00");
  // Switching business and coming back restores the per-business composer draft.
  await businessSwitch(page).selectOption("2");
  await expect(page).toHaveURL(/business=2/);
  await businessSwitch(page).selectOption("1");
  await expect(page).toHaveURL(/business=1/);
  await openView(page, "compose");
  await expect(page.getByLabel("Post text", { exact: true })).toHaveValue("Surviving composition");
});

test("all-clients calendar keeps saved data under a strip with Retry when a refresh fails", async ({ page }) => {
  let calendarDown = false;
  const queued = { id: "66666666-6666-4666-8666-666666666666", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Saved queued text" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/calendar") {
      if (calendarDown) return route.abort();
      return route.fulfill({ json: { posts: [queued], total: 1 } });
    }
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await expect(page.getByText("Saved queued text", { exact: true })).toBeVisible();
  calendarDown = true;
  // The queue polls every 15 seconds; the failed poll must surface as a strip over saved data.
  const strip = page.getByTestId("strip-social-saved-data");
  await expect(strip).toBeVisible({ timeout: 25000 });
  await expect(strip).toContainText("Refresh failed — showing saved data from");
  await expect(page.getByText("Post count unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/^\d+ matching posts$/)).toHaveCount(0);
  await expect(page.getByTestId("text-social-posts-empty")).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  // The saved row stays rendered underneath the strip.
  await expect(page.getByText("Saved queued text", { exact: true })).toBeVisible();
  // Retry while still down keeps the strip; recovering clears it.
  await strip.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForTimeout(1000);
  await expect(strip).toBeVisible();
  calendarDown = false;
  await strip.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(strip).toBeHidden({ timeout: 10000 });
});

test("stale bulk selection prunes itself when a selected post leaves draft or queued", async ({ page }) => {
  let published = false;
  const queued = { id: "77777777-7777-4777-8777-777777777777", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Queued fixture text" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: published ? [{ ...queued, state: "published" }] : [queued], total: 1 } });
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await page.getByLabel(`Select post ${queued.id}`).check();
  await expect(page.getByText("1 selected", { exact: false }).first()).toBeVisible();
  // A refetch (a filter change fetches with a new key) reconciles the selection against post state.
  published = true;
  await page.getByLabel("Search calendar", { exact: true }).fill("Queued");
  await expect(page.getByText("0 selected", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel(`Select post ${queued.id}`)).toHaveCount(0);
});

test("zero-match post search says so instead of pretending the account is empty", async ({ page }) => {
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: [], total: 0 } });
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await page.getByLabel("Search calendar", { exact: true }).fill("nothing-matches-this");
  await expect(page.getByTestId("text-social-posts-empty")).toHaveText("No posts match your search or filters.");
  // No filter with no posts at all keeps the original empty-state copy.
  await page.getByLabel("Search calendar", { exact: true }).fill("");
  await expect(page.getByTestId("text-social-posts-empty")).toHaveText("No posts yet. Compose your first update or generate an AI draft.");
});

test("unsaved-edit gate names the businesses and Discard all edits reverts every edit", async ({ page }) => {
  const d1 = { id: "88888888-8888-4888-8888-888888888888", state: "draft", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "First saved" } } } };
  const d2 = { id: "99999999-9999-4999-8999-999999999999", state: "draft", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Second business", payload: { post: { content: { platform: "facebook", text: "Second saved" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: [d1, d2], total: 2 } });
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  // The unique per-row labels find each draft without ambiguity.
  const edit1 = page.getByLabel("Edit draft for Fixture business · twitter", { exact: true });
  const edit2 = page.getByLabel("Edit draft for Second business · facebook", { exact: true });
  await edit1.fill("Edited one");
  await edit2.fill("Edited two");
  await page.getByLabel(`Select post ${d1.id}`).check();
  await page.getByLabel(`Select post ${d2.id}`).check();
  const gate = page.getByTestId("text-social-unsaved-edits");
  await expect(gate).toContainText("Fixture business (1)");
  await expect(gate).toContainText("Second business (1)");
  await page.getByTestId("button-discard-all-edits").click();
  await expect(edit1).toHaveValue("First saved");
  await expect(edit2).toHaveValue("Second saved");
  await expect(gate).toHaveCount(0);
});

test("partial bulk failure keeps the failed ids selected with the error visible", async ({ page }) => {
  const p1 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Fixture business", payload: { post: { content: { platform: "twitter", text: "Bulk one" } } } };
  const p2 = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", state: "queued", due_at: new Date(Date.now() + 86400000).toISOString(), business_name: "Second business", payload: { post: { content: { platform: "twitter", text: "Bulk two" } } } };
  await page.route("**/api/social**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/social/posts/bulk-action") return route.fulfill({ json: { results: [{ id: p1.id, ok: true }, { id: p2.id, ok: false, error: "Post already submitted or finalized" }] } });
    if (path === "/api/social/calendar") return route.fulfill({ json: { posts: [p1, p2], total: 2 } });
    if (path === "/api/social/businesses") return route.fulfill({ json: { items: [{ id: 1, business_name: "Fixture business" }], total: 1 } });
    if (path === "/api/social/youtube/status") return route.fulfill({ json: YT_STATUS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/social-media?business=all");
  await page.getByLabel(`Select post ${p1.id}`).check();
  await page.getByLabel(`Select post ${p2.id}`).check();
  await page.getByRole("button", { name: "Cancel selected posts", exact: true }).click();
  await page.getByTestId("button-bulk-cancel-confirm").click();
  await expect(page.getByText("Post already submitted or finalized")).toBeVisible();
  // The failure stays selected (retry-ready, checkbox still there) and the success clears.
  await expect(page.getByText("1 selected", { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel(`Select post ${p2.id}`)).toBeChecked();
  await expect(page.getByLabel(`Select post ${p1.id}`)).not.toBeChecked();
  // Clear selection releases even a failed id whose row later loses its checkbox.
  await page.getByTestId("button-clear-selection").click();
  await expect(page.getByText("0 selected", { exact: false }).first()).toBeVisible();
});
