import type { LucideIcon } from "lucide-react";

/**
 * Account settings — the shared contract between the shell (settings.tsx),
 * the left nav and every section panel. Panels built elsewhere (Billing with
 * its Subscriptions / Invoices / Payment methods tabs, API keys, API usage)
 * take the same `SettingsSectionProps` and are swapped in through
 * `registerSettingsSection` (sections.tsx) or the default component table.
 */

export type SettingsSectionId =
  | "account"
  | "security"
  | "notifications"
  | "phone-bar"
  | "billing"
  | "limits"
  | "api-keys"
  | "api-usage"
  | "audit-log"
  | "integrations";

export type SettingsGroupId = "me" | "workspace";

/** GET /api/auth/me as the settings pages read it (loose on purpose: the server adds fields over time). */
export type SettingsUser = {
  id?: number;
  email?: string;
  displayName?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  avatarUrl?: string | null;
  accountId?: string | null;
  createdAt?: string | null;
  /** The server reports a linked Google account as a truthy value (id or `true`), `false`/null otherwise. */
  googleId?: string | boolean | null;
  hasPassword?: boolean;
  totpEnabled?: boolean;
  emailVerified?: boolean;
  isPlatformAdmin?: boolean;
  [key: string]: unknown;
};

/** Props every section panel receives from the shell. */
export interface SettingsSectionProps {
  /** The signed-in account; undefined while /api/auth/me loads. */
  user: SettingsUser | undefined;
  /** The section being shown (a panel may render for more than one id). */
  section: SettingsSectionId;
  /** `?view=` — the inner tab of a panel that has them (Billing: subscriptions | invoices | payment-methods). */
  view: string | null;
  /** Open another section, optionally on one of its inner tabs. */
  go: (section: SettingsSectionId, view?: string | null) => void;
}

export interface SettingsSectionDef {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  /** One line under the section title. */
  description: string;
  icon: LucideIcon;
  /** The ⓘ entry in lib/info-content.ts shown next to the section title. */
  infoKey: string;
}
