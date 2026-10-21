/**
 * Notification channel defaults that differ from the usual in-app ON / email ON / text OFF (shared/schema.ts
 * crmNotificationChannel; the Settings page mirrors it). Kept out of schema.ts so the client can import it without
 * pulling in drizzle.
 *
 * The bid reminder exists to be a text (owner, 2026-10-21: "alert you via text 30 min before the bid … you can turn
 * it off in settings"), and an email 30 minutes out is noise, so it starts text ON, email OFF.
 */
export const CRM_NOTIFICATION_CHANNEL_DEFAULTS: Record<string, Partial<Record<"inApp" | "email" | "sms", boolean>>> = {
  bidReminder: { inApp: true, email: false, sms: true },
};
