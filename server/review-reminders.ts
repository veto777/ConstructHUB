import { z } from "zod";

export const reminderSettingsInput = z.object({
  enabled: z.boolean().default(true),
  maxReminders: z.number().int().min(0).max(10).default(3),
  intervalHours: z.number().int().min(1).max(720).default(48),
  timeWindows: z.array(z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) })
    .refine(w => w.start < w.end, "Window end must follow its start")).min(1).max(6)
    .refine(windows => windows.every((w, i) => windows.every((v, j) => i === j || w.end <= v.start || v.end <= w.start)), "Windows must not overlap")
    .default([{ start: 9, end: 12 }, { start: 15, end: 18 }, { start: 18, end: 21 }]),
  timezone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; }
  }, "Use an IANA timezone").default("America/New_York"),
});

export function calculateNextReminderTime(settings: unknown, reminderNumber: number, now = new Date()): Date | null {
  const parsed = reminderSettingsInput.safeParse(settings ?? {});
  // Invalid legacy settings fail closed until corrected by the owner.
  if (!parsed.success || !parsed.data.enabled || reminderNumber >= parsed.data.maxReminders) return null;
  const config = parsed.data;
  const window = config.timeWindows[reminderNumber % config.timeWindows.length];
  const format = new Intl.DateTimeFormat("en-US", { timeZone: config.timezone, hour: "numeric", hourCycle: "h23" });
  const earliest = Math.ceil((now.getTime() + config.intervalHours * 3600_000) / 60_000) * 60_000;
  // Walk real instants, never construct an ambiguous/nonexistent local time.
  // This handles spring gaps and both occurrences of a fall-back hour.
  for (let minute = 0; minute < 3 * 24 * 60; minute++) {
    const candidate = new Date(earliest + minute * 60_000);
    const hour = Number(format.format(candidate));
    if (hour >= window.start && hour < window.end) return candidate;
  }
  return null;
}

export function inReminderWindow(settings: unknown, now = new Date()): boolean {
  const parsed = reminderSettingsInput.safeParse(settings ?? {});
  if (!parsed.success || !parsed.data.enabled || parsed.data.maxReminders === 0) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  return parsed.data.timeWindows.some(w => hour >= w.start && hour < w.end);
}

export function canonicalAppOrigin(): string {
  const raw = process.env.APP_URL || (process.env.NODE_ENV !== "production" ? `http://localhost:${process.env.PORT || 5000}` : "");
  if (!raw) throw new Error("APP_URL must be configured for background links");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("APP_URL must be an HTTP(S) origin");
  return url.origin;
}
