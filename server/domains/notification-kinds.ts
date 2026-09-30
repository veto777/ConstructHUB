export const DOMAIN_MAIL_NOTIFICATION_KINDS = {
  "domains.changed": {
    label: "Domain DNS change applied",
    inApp: true,
    email: true,
    security: true,
  },
  "domains.monitor": {
    label: "Domain expiry, DNS or website alert",
    inApp: true,
    email: true,
  },
  "mail.alert": {
    label: "Forwarded provider alert",
    inApp: true,
    email: false,
  },
  "mail.security": {
    label: "Provider security or domain transfer attempt",
    inApp: true,
    email: true,
    security: true,
  },
} as const;
