export const DOMAIN_MAIL_NOTIFICATION_KINDS = {
  "domains.changed": {
    label: "Domain DNS change applied",
    inApp: true,
    email: true,
    security: true,
  },
  "domains.verified": {
    label: "Domain DNS change verified",
    inApp: true,
    email: false,
  },
  "domains.verification_failed": {
    label: "Domain DNS change could not be verified",
    inApp: true,
    email: true,
  },
  "domains.disconnected": {
    label: "A registrar API key was removed",
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
