/**
 * The scrape-schedule request shape (POST/PATCH /api/scrape-schedules) and the one additive
 * column custom intervals need. Boot runs the DDL (server/growth-schema.ts); so does
 * scripts/apply-schema-migration.ts. Existing rows keep every_hours NULL and run by their preset.
 */
import { z } from "zod";
import { SCHEDULE_FREQUENCIES, SCHEDULE_MAX_EVERY_HOURS, SCHEDULE_MIN_EVERY_HOURS } from "@shared/scrape-schedules";

export const SCRAPE_SCHEDULE_DDL: readonly string[] = [
  `ALTER TABLE scrape_schedules ADD COLUMN IF NOT EXISTS every_hours integer`,
];

export const EVERY_HOURS_MESSAGE = `For a custom frequency, enter how often to run: ${SCHEDULE_MIN_EVERY_HOURS} to ${SCHEDULE_MAX_EVERY_HOURS} hours (up to 30 days)`;

export const scheduleFields = z.object({
  databaseId: z.number({ required_error: "Choose a permit portal", invalid_type_error: "Choose a permit portal" }).int().positive("Choose a permit portal"),
  searchType: z.enum(["address", "name", "company", "license", "permit"], { errorMap: () => ({ message: "Choose a search type" }) }),
  searchValue: z.string({ required_error: "Enter what to search for" }).trim().min(1, "Enter what to search for").max(200, "Search value is too long"),
  frequency: z.enum(SCHEDULE_FREQUENCIES, { errorMap: () => ({ message: "Frequency must be daily, weekly, monthly or custom" }) }).optional(),
  everyHours: z.number({ invalid_type_error: EVERY_HOURS_MESSAGE }).int(EVERY_HOURS_MESSAGE)
    .min(SCHEDULE_MIN_EVERY_HOURS, EVERY_HOURS_MESSAGE).max(SCHEDULE_MAX_EVERY_HOURS, EVERY_HOURS_MESSAGE).nullable().optional(),
  isActive: z.boolean().default(true),
});
export type ScheduleFields = z.infer<typeof scheduleFields>;

/**
 * Makes frequency and everyHours agree, in place: "custom" needs hours; a preset clears them; hours
 * given on their own mean "custom"; a bare null changes nothing. Returns the error message, or null.
 */
export function settleFrequency(v: Partial<Pick<ScheduleFields, "frequency" | "everyHours">>): string | null {
  if (v.frequency === "custom") return v.everyHours == null ? EVERY_HOURS_MESSAGE : null;
  if (v.frequency !== undefined) { v.everyHours = null; return null; }
  if (typeof v.everyHours === "number") { v.frequency = "custom"; return null; }
  delete v.everyHours;
  return null;
}

/** A new schedule: daily unless a frequency or custom hours are given. */
export const scheduleInput = scheduleFields.transform((v, ctx) => {
  const message = settleFrequency(v);
  if (message) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["everyHours"], message }); return z.NEVER; }
  return { ...v, frequency: v.frequency ?? "daily", everyHours: v.everyHours ?? null };
});
/** The fields a PATCH may carry; the route keeps only the keys sent, then calls settleFrequency on them. */
export const schedulePatchInput = scheduleFields.partial().strict();
