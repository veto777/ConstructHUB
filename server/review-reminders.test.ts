import { describe, expect, it, vi } from "vitest";
import { calculateNextReminderTime, canonicalAppOrigin, reminderSettingsInput } from "./review-reminders";
describe("timezone-aware reminders", () => {
  it.each([{ maxReminders: -1 }, { maxReminders: 11 }, { intervalHours: 0 }, { timezone: "Bad/Zone" }, { timeWindows: [] }, { timeWindows: [{ start: 12, end: 9 }] }, { enabled: "yes" }])("rejects invalid settings %j", input => {
    expect(reminderSettingsInput.safeParse(input).success).toBe(false);
  });
  it("honors zero reminders and invalid legacy settings", () => {
    expect(calculateNextReminderTime({ maxReminders: 0 }, 0)).toBeNull();
    expect(calculateNextReminderTime({ timeWindows: [] }, 0)).toBeNull();
  });
  it.each([
    ["America/New_York", "2026-03-07T15:00:00Z", "2026-03-08T15:00:00Z"],
    ["America/New_York", "2026-10-31T13:00:00Z", "2026-11-01T14:00:00Z"],
    ["America/Los_Angeles", "2026-03-07T15:00:00Z", "2026-03-08T16:00:00Z"],
  ])("handles DST in %s without shortening the interval", (timezone, start, expected) => {
    expect(calculateNextReminderTime({ timezone, intervalHours: 24, timeWindows: [{ start: 9, end: 12 }] }, 0, new Date(start))?.toISOString()).toBe(new Date(expected).toISOString());
  });
  it("skips nonexistent spring hours and preserves real fall-back instants", () => {
    expect(calculateNextReminderTime({ timezone: "America/New_York", intervalHours: 24, timeWindows: [{ start: 2, end: 3 }] }, 0, new Date("2026-03-07T06:00:00Z"))?.toISOString()).toBe("2026-03-09T06:00:00.000Z");
  });
  it("uses APP_URL in every environment and requires it in production", () => {
    vi.stubEnv("APP_URL", "https://app.example.invalid/base");
    expect(canonicalAppOrigin()).toBe("https://app.example.invalid");
    vi.stubEnv("APP_URL", ""); vi.stubEnv("NODE_ENV", "production");
    expect(() => canonicalAppOrigin()).toThrow("APP_URL");
    vi.unstubAllEnvs();
  });
});
