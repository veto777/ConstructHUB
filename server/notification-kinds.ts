import { EDGE_NOTIFICATION_KINDS } from './cloudflare/notification-kinds';
/** Single registry for every growth account notification emitted by the app. */
export type NotificationDefaults = { label: string; inApp: boolean; email: boolean; security?: boolean };
import { DOMAIN_MAIL_NOTIFICATION_KINDS } from "./domains/notification-kinds";
import { API_KEY_NOTIFICATION_KINDS } from "./account/api-key-notification-kinds";
export const NOTIFICATION_KINDS = {
  ...EDGE_NOTIFICATION_KINDS,
  ...DOMAIN_MAIL_NOTIFICATION_KINDS,
  ...API_KEY_NOTIFICATION_KINDS,
  "google.connected": { label: "A Google account was connected", inApp: true, email: true, security: true },
  "google.disconnected": { label: "A Google account was disconnected", inApp: true, email: true, security: true },
  "security.2fa_changed": { label: "Two-factor sign-in was turned on or off", inApp: true, email: true, security: true },
  "security.password_changed": { label: "Your password was changed", inApp: true, email: true, security: true },
  "gbp.profile_change": { label: "Your Google Business Profile changed outside ConstructHUB", inApp: true, email: true },
  "gbp.suggested_edit": { label: "Google or the public suggested an edit to your profile", inApp: true, email: true },
  "gbp.change_reverted": { label: "Profile Guard reverted a change", inApp: true, email: true },
  "gbp.new_review": { label: "A new Google review arrived", inApp: true, email: true },
  "gbp.reply_posted": { label: "A reply was posted to Google", inApp: true, email: false },
  "gbp.post_published": { label: "A scheduled post or photo was published", inApp: true, email: false },
  "social.post_published": { label: "A social media post was published", inApp: true, email: false },
  "social.post_failed": { label: "A social media post failed", inApp: true, email: true },
  "gbp.post_failed": { label: "A Google post or photo failed", inApp: true, email: false },
  "sitescan.completed": { label: "Site Scan completed", inApp: true, email: false },
  "seo.rank_drop": { label: "Rankings fell, or you left the Google map pack", inApp: true, email: true },
  "seo.rank_gain": { label: "Rankings improved, or you entered the Google map pack", inApp: true, email: false },
  "seo.links_change": { label: "Sites linking to you were lost or gained", inApp: true, email: true },
  "sitescan.regressed": { label: "Site Scan score dropped or new critical issue", inApp: true, email: false },
  // Platform admins only (server/ops/app-review-watch.ts): bell + iPhone push; email stays off unless switched on.
  "ops.app_review": { label: "iPhone app review status changed (admins)", inApp: true, email: false },
} satisfies Record<string, NotificationDefaults>;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;
