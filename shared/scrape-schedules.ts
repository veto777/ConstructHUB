/**
 * Scrape schedule frequency, shared by the /schedules page and the scheduler in server/routes.ts.
 * Three presets plus "custom": every N hours, 1 hour to 30 days (owner rule 2026-10-15: every
 * preset choice also takes the user's own value). The server looks for due schedules every
 * SCHEDULE_TICK_MINUTES, so a custom interval is honoured to that resolution.
 */
export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly", "custom"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export const SCHEDULE_MIN_EVERY_HOURS = 1;
export const SCHEDULE_MAX_EVERY_HOURS = 720; // 30 days
export const SCHEDULE_TICK_MINUTES = 15;

const HOUR_MS = 3_600_000;
const PRESET_MS: Record<Exclude<ScheduleFrequency, "custom">, number> = { daily: 24 * HOUR_MS, weekly: 7 * 24 * HOUR_MS, monthly: 30 * 24 * HOUR_MS };

export type ScheduleTiming = { frequency: string; everyHours?: number | null };

/** True when the hours value is one a custom schedule may store. */
export const isValidEveryHours = (h: unknown): h is number =>
  typeof h === "number" && Number.isInteger(h) && h >= SCHEDULE_MIN_EVERY_HOURS && h <= SCHEDULE_MAX_EVERY_HOURS;

/** How long after a run the schedule is due again. A custom schedule without valid hours, or an unknown frequency, runs daily. */
export function scheduleIntervalMs(s: ScheduleTiming): number {
  if (s.frequency === "custom" && isValidEveryHours(s.everyHours)) return s.everyHours * HOUR_MS;
  return (PRESET_MS as Record<string, number>)[s.frequency] ?? PRESET_MS.daily;
}

/** "Daily", "Weekly", "Monthly", "Every hour", "Every 6 hours", "Every 24 hours", "Every 3 days". */
export function describeScheduleFrequency(s: ScheduleTiming): string {
  if (s.frequency === "custom") {
    if (!isValidEveryHours(s.everyHours)) return "Daily";
    const h = s.everyHours;
    if (h === 1) return "Every hour";
    if (h < 24 || h % 24 !== 0 || h === 24) return `Every ${h} hours`;
    return `Every ${h / 24} days`;
  }
  const label = s.frequency.charAt(0).toUpperCase() + s.frequency.slice(1);
  return s.frequency in PRESET_MS ? label : "Daily";
}

/** The hours a "run every <amount> <unit>" form means, or null when it is not a whole number in range. */
export function customEveryHours(amount: string | number, unit: "hours" | "days"): number | null {
  const n = typeof amount === "number" ? amount : /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1) return null;
  const h = unit === "days" ? n * 24 : n;
  return isValidEveryHours(h) ? h : null;
}
