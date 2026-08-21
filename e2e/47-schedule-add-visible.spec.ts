import { expect, test } from "@playwright/test";
import { gotoCrm, ORGS, switchOrg, watchPage } from "./helpers";
import { q } from "./db";

/**
 * Calendar adds must be VISIBLE right after save (prod incident: "I added
 * Lunch Meeting and it just disappeared"). Two mechanisms hid a
 * successfully-created visit:
 *
 *   1. The create dialog accepts any date — even one outside the visible
 *      window — and the calendar never moved to it.
 *   2. A crowded day collapses to 3 chips + "+N more"; the just-added visit
 *      silently landed behind that collapse.
 *
 * After the fix, a create re-centers the calendar on the visit's date and,
 * when it would be past the 3-chip collapse, lands on the week view (exactly
 * what tapping "+N more" does). Runs in America/Los_Angeles — the org's real
 * timezone — to catch UTC-vs-local window/bucketing regressions.
 */

test.use({ timezoneId: "America/Los_Angeles" });

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-15" N months ahead of today — a deterministic uncrowded date. */
function targetDay(monthsAhead: number): { key: string; year: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 15);
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-15`, year: d.getFullYear(), month: d.getMonth() };
}

async function deleteAppointment(page: any, id: string) {
  await page.request.delete(`/api/crm/appointments/${id}`).catch(() => {});
}

test.describe("/crm/schedule — added visits stay visible", () => {
  test.beforeEach(async ({ page }) => switchOrg(page, ORGS.alpine));

  test("add appointment → chip in month AND week without a reload (LA timezone)", async ({ page }) => {
    const guards = watchPage(page);
    const { key } = targetDay(2);
    const title = `E2E Visit ${Date.now().toString(36)}`;
    let apptId = "";

    await gotoCrm(page, "/crm/schedule");
    await expect(page.getByTestId("calendar-month")).toBeVisible();

    // Two months out — outside the initially visible window.
    await page.getByTestId("button-cal-next").click();
    await page.getByTestId("button-cal-next").click();

    await page.locator(`[data-testid="cal-day-${key}"] > div:first-child`).click();
    await expect(page.getByTestId("dialog-appointment")).toBeVisible();
    await page.getByTestId("input-appt-title").fill(title);
    await page.getByTestId("input-appt-start").fill("12:30");
    await page.getByTestId("input-appt-end").fill("13:30");

    const posted = page.waitForResponse(
      (r) => r.url().includes("/api/crm/appointments") && r.request().method() === "POST");
    await page.getByTestId("button-appt-save").click();
    apptId = (await (await posted).json()).appointment.id;

    await expect(page.getByTestId("dialog-appointment")).toBeHidden();
    await expect(page.getByText("Appointment scheduled", { exact: true })).toBeVisible();

    // Month grid shows the chip immediately — no reload.
    await expect(page.getByTestId(`event-${apptId}`)).toBeVisible();

    // Week view shows it too (the create re-centered the cursor on its date).
    await page.getByTestId("button-view-week").click();
    await expect(page.getByTestId("calendar-week")).toBeVisible();
    await expect(page.getByTestId(`event-${apptId}`)).toBeVisible();

    // …and it survives a full reload (the row really persisted).
    await gotoCrm(page, "/crm/schedule");
    await page.getByTestId("button-cal-next").click();
    await page.getByTestId("button-cal-next").click();
    await expect(page.getByTestId(`event-${apptId}`)).toBeVisible();

    const rows = await q(`select id, title, status from crm_appointments where id = $1`, [apptId]);
    expect(rows[0]?.title).toBe(title);
    expect(rows[0]?.status).toBe("scheduled");

    await deleteAppointment(page, apptId);
    guards.assertClean("schedule add visible");
  });

  test("crowded day: a 4th visit is on screen right after save (not lost behind '+N more')", async ({ page }) => {
    const guards = watchPage(page);
    const { key } = targetDay(3);
    const seedIds: string[] = [];
    let apptId = "";

    // Seed a busy crew day: three dispatches earlier than the visit we add.
    // 15:00/16:00/17:00 UTC = 08:00/09:00/10:00 PDT — same LA day, no
    // midnight-boundary games.
    await gotoCrm(page, "/crm/schedule");
    for (const [hour, name] of [[15, "E2E Crew A"], [16, "E2E Crew B"], [17, "E2E Material drop"]] as const) {
      const r = await page.request.post("/api/crm/appointments", {
        data: {
          title: name,
          startsAt: `${key}T${pad(hour)}:00:00.000Z`,
          endsAt: `${key}T${pad(hour + 1)}:00:00.000Z`,
          dispatchedMemberIds: [],
        },
      });
      expect(r.status()).toBe(201);
      seedIds.push((await r.json()).appointment.id);
    }

    try {
      await gotoCrm(page, "/crm/schedule");
      await expect(page.getByTestId("calendar-month")).toBeVisible();
      await page.getByTestId("button-cal-next").click();
      await page.getByTestId("button-cal-next").click();
      await page.getByTestId("button-cal-next").click();

      // The day cell shows all three seeds — the collapse starts at four.
      await expect(page.getByTestId(`cal-day-${key}`).getByText("E2E Material drop")).toBeVisible();
      await expect(page.getByTestId(`cal-more-${key}`)).toBeHidden();

      await page.locator(`[data-testid="cal-day-${key}"] > div:first-child`).click();
      await page.getByTestId("input-appt-title").fill("E2E Lunch Meeting");
      await page.getByTestId("input-appt-start").fill("12:30");
      await page.getByTestId("input-appt-end").fill("13:30");
      const posted = page.waitForResponse(
        (r) => r.url().includes("/api/crm/appointments") && r.request().method() === "POST");
      await page.getByTestId("button-appt-save").click();
      apptId = (await (await posted).json()).appointment.id;
      await expect(page.getByTestId("dialog-appointment")).toBeHidden();

      // The fix: a visit that would land behind the collapse brings the
      // calendar to the week view — the owner SEES what they just booked.
      await expect(page.getByTestId("calendar-week")).toBeVisible();
      await expect(page.getByTestId(`event-${apptId}`)).toBeVisible();

      // Month view keeps the 3-chip collapse by design, behind "+1 more".
      await page.getByTestId("button-view-month").click();
      await expect(page.getByTestId("calendar-month")).toBeVisible();
      await expect(page.getByTestId(`cal-more-${key}`)).toBeVisible();
    } finally {
      for (const id of [...seedIds, apptId]) await deleteAppointment(page, id);
    }
    guards.assertClean("crowded day add");
  });
});
