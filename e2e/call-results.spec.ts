/**
 * Call Assistant Results (owner, 2026-10-02: "The clients want to see this data when using this service") and the
 * signed-in /call-assistant hand-off to the dashboard ("why is the alpine dashboard not updated here?").
 *   CR_PORTAL_URL  a portal dev server, bypass on  (default http://127.0.0.1:8179)
 *   CR_SITE_URL    a site dev server, bypass on    (default http://127.0.0.1:8199)
 * The voice API is answered in the browser (like 40-call-assistant-studio); the shell, session and routing are real.
 */
import { expect, test, type Page } from "@playwright/test";

const PORTAL = process.env.CR_PORTAL_URL || "http://127.0.0.1:8179";
// localhost, not 127.0.0.1: the portal host is portal.<host>, and portal.127.0.0.1 is not a valid URL to a browser.
const SITE = process.env.CR_SITE_URL || "http://localhost:8199";

const SUMMARY = {
  range: "30d", total: 63, minutes: 141, recordings: 61, firstCallAt: "2026-10-01T14:00:00.000Z",
  outcomes: { hangup: 22, info: 17, spam: 12, lead_submitted: 6, declined: 4, alerted: 2 },
  lines: [{ label: "FL line", calls: 43, leads: 4 }, { label: "WA line", calls: 20, leads: 2 }],
};

async function mockVoice(page: Page, seen: string[]) {
  await page.context().addCookies([{ name: "ch_consent", value: "denied", url: PORTAL }]);
  await page.route("**/api/crm/voice/**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url.pathname + url.search);
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    const p = url.pathname.replace(/^\/api\/crm\/voice/, "");
    if (p === "/calls/summary") return json({ ...SUMMARY, range: url.searchParams.get("range") ?? "30d", total: url.searchParams.get("range") === "7d" ? 0 : SUMMARY.total });
    if (p === "/status") return json({
      enabled: true, addon: { key: "call_assistant", name: "AI Call Assistant", preview: false, availableOn: ["pro"] }, plan: "pro",
      allowance: { numbers: 1, minutes: 2000 }, pricing: { includedMinutes: 2000, overageCentsPerMinute: 10, freeSpamCalls: 500 },
      tier: null, tiers: [], canManage: true, engine: { configured: true, reachable: true, models: true, checkedAt: "2026-10-02T00:00:00.000Z" },
      numbers: [], profile: { status: "live", publishedVersion: 1 },
      usage: { month: "2026-10", minutes: 0, calls: 0, overageMinutes: 0, spamCallsThisMonth: 0, freeSpamCalls: 0, freeSpamCallsLimit: 500 },
    });
    if (p === "/calls") return json({ calls: [], total: 0, page: 1, limit: 25 });
    if (p === "/spam") return json({ entries: [], blocked: 0, thisMonth: { spamCalls: 12 } });
    if (p.startsWith("/escalations")) return json({ escalations: [] });
    return json({});
  });
}

test("Overview shows the results, and a tile opens the matching calls", async ({ page }) => {
  const seen: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await mockVoice(page, seen);
  await page.goto(`${PORTAL}/crm/call-assistant`);
  const card = page.getByTestId("card-call-results");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("text-results-total")).toHaveText("63");
  await expect(page.getByTestId("text-results-real")).toHaveText("51");
  await expect(page.getByTestId("text-results-lead-rate")).toHaveText("12%");
  for (const [k, n] of [["lead_submitted", "6"], ["alerted", "2"], ["info", "17"], ["declined", "4"], ["hangup", "22"], ["spam", "12"]]) {
    await expect(page.getByTestId(`text-results-${k}`)).toHaveText(n);
  }
  await expect(page.getByTestId("row-results-line")).toHaveCount(2);
  await expect(page.getByTestId("list-results-lines")).toContainText("FL line");
  await expect(page.getByTestId("text-results-recordings")).toHaveText("61");

  await page.getByTestId("select-results-range").click();
  await page.getByRole("option", { name: "Last 7 days" }).click();
  await expect(page.getByTestId("text-results-empty")).toBeVisible();
  expect(seen).toContain("/api/crm/voice/calls/summary?range=7d");
  await page.getByTestId("select-results-range").click();
  await page.getByRole("option", { name: "Last 30 days" }).click();

  await page.getByTestId("tile-results-lead_submitted").click();
  await expect(page.getByTestId("panel-call-assistant-calls")).toBeVisible();
  await expect(page).toHaveURL(/tab=calls&outcome=lead_submitted/);
  await expect.poll(() => seen.some((u) => u.startsWith("/api/crm/voice/calls?") && u.includes("outcome=lead_submitted"))).toBe(true);

  await page.getByTestId("tile-results-spam").click();
  await expect(page.getByTestId("button-calls-view-spam")).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

test("signed in, the main site's Call Assistant opens the dashboard on the portal", async ({ page }) => {
  await page.context().addCookies([{ name: "ch_consent", value: "denied", url: SITE }]);
  const portalHost = `portal.${new URL(SITE).host}`;
  let landed = "";
  await page.route(`http://${portalHost}/**`, (route) => { landed = route.request().url(); return route.fulfill({ status: 200, contentType: "text/html", body: "<p>portal</p>" }); });
  await page.goto(`${SITE}/call-assistant`);
  await expect.poll(() => landed, { timeout: 30_000 }).toBe(`http://${portalHost}/crm/call-assistant`);
});
