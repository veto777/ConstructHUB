import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";

test.beforeEach(async ({ page }) => switchOrg(page, ORGS.aspire));

/** Unfold an iCal document into logical lines. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

test.describe("/crm/settings — Calendar card", () => {
  test("curated: feed URL generate/copy/regenerate, feed.ics serves a real appointment", async ({ page }) => {
    const guards = watchPage(page);
    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("card-calendar")).toBeVisible();

    // The feed URL provisions lazily and is well-formed.
    const urlInput = page.getByTestId("input-calendar-feed-url");
    await expect(urlInput).not.toHaveValue("");
    const url1 = await urlInput.inputValue();
    expect(url1).toContain("/api/crm/calendar/feed.ics?token=");

    // Copy: click must not error (clipboard may be unavailable headless).
    await page.getByTestId("button-copy-calendar-feed").click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();

    // Regenerate: URL changes, the old one dies, the new one serves.
    await page.getByTestId("button-regenerate-calendar-feed").click();
    // exact: the aria-live announcer span carries the same words prefixed with "Notification ".
    await expect(page.getByText("New feed URL generated", { exact: true })).toBeVisible();
    await expect(urlInput).not.toHaveValue(url1);
    const url2 = await urlInput.inputValue();

    const oldFeed = await page.request.get(new URL(url1).pathname + new URL(url1).search);
    expect(oldFeed.status()).toBe(401);
    const newFeed = await page.request.get(new URL(url2).pathname + new URL(url2).search);
    expect(newFeed.status()).toBe(200);
    expect(newFeed.headers()["content-type"]).toContain("text/calendar");

    // Parse the feed: seeded Aspire appointments are there as VEVENTs.
    const ics = await newFeed.text();
    const lines = unfold(ics);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(lines.filter((l) => l === "BEGIN:VEVENT").length).toBeGreaterThan(0);

    // A real appointment created through the API shows up by its stable uid,
    // with summary = project — customer and the arrival window as dtend.
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const cust = await page.request.post("/api/crm/customers", {
      data: { displayName: `E2E Cal ${stamp}` },
    });
    expect(cust.ok()).toBeTruthy();
    const customer = await cust.json();
    const proj = await page.request.post("/api/crm/projects", {
      data: { customerId: customer.id, name: `E2E Cal Project ${stamp}` },
    });
    expect(proj.ok()).toBeTruthy();
    const project = await proj.json();
    const startsAt = new Date(Date.now() + 5 * 86400000);
    startsAt.setMinutes(0, 0, 0);
    const appt = await page.request.post("/api/crm/appointments", {
      data: {
        projectId: project.id,
        customerId: customer.id,
        title: "E2E calendar visit",
        startsAt: startsAt.toISOString(),
        arrivalWindowMinutes: 60,
      },
    });
    expect(appt.ok()).toBeTruthy();
    const { appointment } = await appt.json();

    const feed2 = await page.request.get(new URL(url2).pathname + new URL(url2).search);
    const lines2 = unfold(await feed2.text());
    const uidIdx = lines2.indexOf(`UID:${appointment.id}@constructhub-crm`);
    expect(uidIdx).toBeGreaterThan(-1);
    const block = lines2.slice(uidIdx, lines2.indexOf("END:VEVENT", uidIdx));
    expect(block).toContain(`SUMMARY:E2E Cal Project ${stamp} — E2E Cal ${stamp}`);
    expect(block).toContain("STATUS:CONFIRMED");
    expect(block.some((l) => l.startsWith("DTSTART:"))).toBe(true);
    expect(block.some((l) => l.startsWith("DTEND:"))).toBe(true);

    guards.assertClean("calendar curated");
  });

  test("google card: honest state — not-configured with env names, or an enabled connect", async ({ page }) => {
    const guards = watchPage(page);
    const statusRes = await page.request.get("/api/crm/calendar/google/status");
    expect(statusRes.ok()).toBeTruthy();
    const status = await statusRes.json();

    await gotoCrm(page, "/crm/settings");
    await expect(page.getByTestId("card-calendar")).toBeVisible();

    if (status.configured) {
      // Creds exist (dev .env has them) but no org connection: the connect
      // button is live. Don't click — it leaves for accounts.google.com.
      await expect(page.getByTestId("pill-google-calendar-status")).toHaveText("Not connected");
      await expect(page.getByTestId("button-connect-google-calendar")).toBeEnabled();
    } else {
      // The honest state: the card names the missing env vars, no dead button.
      const notice = page.getByTestId("text-google-calendar-not-configured");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("GOOGLE_CLIENT_ID");
      await expect(page.getByTestId("button-connect-google-calendar")).toBeDisabled();
    }
    guards.assertClean("calendar google honesty");
  });
});
