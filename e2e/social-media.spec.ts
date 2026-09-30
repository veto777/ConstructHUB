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
  expect(post.mediaUrls).toEqual(["https://example.com/fixture.jpg"]);
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
  ])
    await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
});
