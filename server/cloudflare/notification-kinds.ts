// Delivered by the existing account-events system; security email cannot be muted.
export const EDGE_NOTIFICATION_KINDS = {
  "cloudflare.connected": {
    label: "Cloudflare connected",
    inApp: true,
    email: true,
    security: true,
  },
  "cloudflare.disconnected": {
    label: "Cloudflare disconnected",
    inApp: true,
    email: true,
    security: true,
  },
  "cloudflare.edge_changed": {
    label: "Cloudflare edge protection changed",
    inApp: true,
    email: true,
    security: true,
  },
} as const;
