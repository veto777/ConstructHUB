import { describe, expect, it } from "vitest";
import { EVERY_HOURS_MESSAGE, SCRAPE_SCHEDULE_DDL, scheduleInput, schedulePatchInput, settleFrequency } from "./scrape-schedule-input";
import { customEveryHours, describeScheduleFrequency, scheduleIntervalMs } from "@shared/scrape-schedules";

// /schedules: daily, weekly, monthly, or a custom "every N hours" (1 hour to 30 days), honoured by the
// 15-minute scheduler tick in server/routes.ts. Existing rows carry every_hours NULL and keep running.
const base = { databaseId: 12, searchType: "address", searchValue: "123 Main St" };

describe("scrape schedule input", () => {
  it("presets stay as before and store no hours", () => {
    expect(scheduleInput.parse(base)).toEqual({ ...base, frequency: "daily", everyHours: null, isActive: true });
    expect(scheduleInput.parse({ ...base, frequency: "weekly", everyHours: 6 }).everyHours).toBeNull();
    expect(scheduleInput.parse({ ...base, frequency: "monthly" }).frequency).toBe("monthly");
  });
  it("custom needs whole hours from 1 to 720", () => {
    expect(scheduleInput.parse({ ...base, frequency: "custom", everyHours: 6 })).toMatchObject({ frequency: "custom", everyHours: 6 });
    expect(scheduleInput.parse({ ...base, frequency: "custom", everyHours: 720 }).everyHours).toBe(720);
    for (const everyHours of [undefined, null, 0, -1, 1.5, 721, "6", 1e9]) {
      const r = scheduleInput.safeParse({ ...base, frequency: "custom", everyHours });
      expect(r.success, String(everyHours)).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe(EVERY_HOURS_MESSAGE);
    }
  });
  it("hours on their own mean custom; an unknown frequency is refused", () => {
    expect(scheduleInput.parse({ ...base, everyHours: 48 })).toMatchObject({ frequency: "custom", everyHours: 48 });
    const r = scheduleInput.safeParse({ ...base, frequency: "hourly" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Frequency must be daily, weekly, monthly or custom");
  });
  it("a PATCH settles frequency and hours the same way", () => {
    const toCustom = schedulePatchInput.parse({ frequency: "custom", everyHours: 3 });
    expect(settleFrequency(toCustom)).toBeNull();
    expect(toCustom).toEqual({ frequency: "custom", everyHours: 3 });
    const missing = schedulePatchInput.parse({ frequency: "custom" });
    expect(settleFrequency(missing)).toBe(EVERY_HOURS_MESSAGE);
    const toPreset: Record<string, unknown> = { frequency: "weekly" };
    expect(settleFrequency(toPreset)).toBeNull();
    expect(toPreset).toEqual({ frequency: "weekly", everyHours: null });
    const hoursOnly: Record<string, unknown> = { everyHours: 12 };
    expect(settleFrequency(hoursOnly)).toBeNull();
    expect(hoursOnly).toEqual({ frequency: "custom", everyHours: 12 });
    const pauseOnly: Record<string, unknown> = { isActive: false, everyHours: null };
    expect(settleFrequency(pauseOnly)).toBeNull();
    expect(pauseOnly).toEqual({ isActive: false });
    expect(schedulePatchInput.safeParse({ nextRunAt: "2026-01-01" }).success).toBe(false);
  });
  it("the column is added without touching existing rows", () => {
    expect(SCRAPE_SCHEDULE_DDL).toEqual(["ALTER TABLE scrape_schedules ADD COLUMN IF NOT EXISTS every_hours integer"]);
  });
});

describe("schedule interval and label", () => {
  const H = 3_600_000;
  it("presets, custom hours, and the daily fallback for rows the column predates", () => {
    expect(scheduleIntervalMs({ frequency: "daily" })).toBe(24 * H);
    expect(scheduleIntervalMs({ frequency: "weekly", everyHours: null })).toBe(7 * 24 * H);
    expect(scheduleIntervalMs({ frequency: "monthly" })).toBe(30 * 24 * H);
    expect(scheduleIntervalMs({ frequency: "custom", everyHours: 6 })).toBe(6 * H);
    expect(scheduleIntervalMs({ frequency: "custom", everyHours: 720 })).toBe(720 * H);
    expect(scheduleIntervalMs({ frequency: "custom", everyHours: null })).toBe(24 * H);
    expect(scheduleIntervalMs({ frequency: "custom", everyHours: 0 })).toBe(24 * H);
    expect(scheduleIntervalMs({ frequency: "daily", everyHours: 6 })).toBe(24 * H);
    expect(scheduleIntervalMs({ frequency: "whenever" })).toBe(24 * H);
  });
  it("reads plainly in the list", () => {
    expect(describeScheduleFrequency({ frequency: "daily" })).toBe("Daily");
    expect(describeScheduleFrequency({ frequency: "weekly" })).toBe("Weekly");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: 1 })).toBe("Every hour");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: 6 })).toBe("Every 6 hours");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: 24 })).toBe("Every 24 hours");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: 36 })).toBe("Every 36 hours");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: 72 })).toBe("Every 3 days");
    expect(describeScheduleFrequency({ frequency: "custom", everyHours: null })).toBe("Daily");
  });
  it("the form's amount and unit become hours, or null when out of range", () => {
    expect(customEveryHours("6", "hours")).toBe(6);
    expect(customEveryHours("3", "days")).toBe(72);
    expect(customEveryHours("30", "days")).toBe(720);
    expect(customEveryHours("31", "days")).toBeNull();
    expect(customEveryHours("721", "hours")).toBeNull();
    for (const bad of ["", "0", "-2", "1.5", "abc", " "]) expect(customEveryHours(bad, "hours"), bad).toBeNull();
  });
});
