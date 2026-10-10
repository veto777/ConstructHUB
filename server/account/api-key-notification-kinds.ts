/**
 * Account-notification kinds for public-API keys. Spread into NOTIFICATION_KINDS
 * (server/notification-kinds.ts) like EDGE_NOTIFICATION_KINDS, so the security
 * email cannot be muted and the Notifications tab lists them.
 */
export const API_KEY_NOTIFICATION_KINDS = {
  "security.api_key_created": { label: "An API key was created", inApp: true, email: true, security: true },
  "security.api_key_revoked": { label: "An API key was revoked", inApp: true, email: true, security: true },
  // Code API tokens (server/dev-api, /admin/code-api): source-code access for agents and developers.
  "security.code_token_issued": { label: "A Code API token was issued", inApp: true, email: true, security: true },
  "security.code_token_revoked": { label: "A Code API token was revoked", inApp: true, email: true, security: true },
  "code_api.submitted": { label: "A Code API branch is ready for review", inApp: true, email: true },
} as const;
export type ApiKeyNotificationKind = keyof typeof API_KEY_NOTIFICATION_KINDS;
