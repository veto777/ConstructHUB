/**
 * Account-notification kinds for public-API keys. Spread into NOTIFICATION_KINDS
 * (server/notification-kinds.ts) like EDGE_NOTIFICATION_KINDS, so the security
 * email cannot be muted and the Notifications tab lists them.
 */
export const API_KEY_NOTIFICATION_KINDS = {
  "security.api_key_created": { label: "An API key was created", inApp: true, email: true, security: true },
  "security.api_key_revoked": { label: "An API key was revoked", inApp: true, email: true, security: true },
} as const;
export type ApiKeyNotificationKind = keyof typeof API_KEY_NOTIFICATION_KINDS;
