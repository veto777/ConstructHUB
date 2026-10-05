import type { ComponentType } from "react";
import { Activity, Bell, CreditCard, Gauge, KeyRound, Lock, Plug, ScrollText, Smartphone, User } from "lucide-react";
import type { SettingsGroupId, SettingsSectionDef, SettingsSectionId, SettingsSectionProps } from "./types";
import { inNativeApp } from "@/lib/app-shell";
import { MyAccountSection } from "./me-account";
import { PasswordSecuritySection } from "./me-security";
import { NotificationsSection } from "./me-notifications";
import { PhoneTabBarSection } from "./me-tab-bar";
import { LimitsUsageSection } from "./limits-usage";
import { BillingSection, ApiKeysSection, ApiUsageSection } from "./account-panels";
import { AuditLogSection } from "./audit-log";
import { IntegrationsSection } from "./integrations";

/**
 * The section registry. The nav reads SETTINGS_SECTIONS; the shell renders
 * `settingsSectionComponent(id)`. A panel built elsewhere replaces a default
 * either by editing DEFAULT_COMPONENTS or, without touching this file, by
 * calling `registerSettingsSection(id, Panel)` from a module the shell
 * imports (settings.tsx). Every panel takes SettingsSectionProps (types.ts).
 */

export const DEFAULT_SECTION: SettingsSectionId = "account";

/** Not in the iPhone apps, which sell nothing (App Store 3.1.3(f)): Billing, plan limits and the plan-metered API. */
export const APP_HIDDEN_SECTIONS: ReadonlySet<SettingsSectionId> = new Set<SettingsSectionId>(["billing", "limits", "api-keys", "api-usage"]);
export const sectionVisible = (id: SettingsSectionId): boolean => !(inNativeApp() && APP_HIDDEN_SECTIONS.has(id));

export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: string }[] = [
  { id: "me", label: "Me" },
  { id: "workspace", label: "Workspace" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "account", group: "me", label: "My account", description: "Your name, photo, company details and account information.", icon: User, infoKey: "account-profile" },
  { id: "security", group: "me", label: "Password & security", description: "Password, two-factor sign-in, remembered devices and recent security activity.", icon: Lock, infoKey: "account-security" },
  { id: "notifications", group: "me", label: "Notifications", description: "Which alerts reach you in the app and by email.", icon: Bell, infoKey: "account-notifications" },
  { id: "phone-bar", group: "me", label: "Phone tab bar", description: "Pick the four tabs at the bottom of the screen on your phone and in the app.", icon: Smartphone, infoKey: "account-phone-bar" },
  { id: "billing", group: "workspace", label: "Billing", description: "Your subscription, add-ons, invoices and payment methods.", icon: CreditCard, infoKey: "account-billing" },
  { id: "limits", group: "workspace", label: "Limits & usage", description: "Everything your plan includes and how much of it you've used this month.", icon: Gauge, infoKey: "account-limits" },
  { id: "api-keys", group: "workspace", label: "API keys", description: "Keys for reading and writing your own data from your own tools.", icon: KeyRound, infoKey: "account-api-keys" },
  { id: "api-usage", group: "workspace", label: "API usage", description: "Units and requests your API keys have used.", icon: Activity, infoKey: "account-api-usage" },
  { id: "audit-log", group: "workspace", label: "Audit log", description: "Sign-ins, security changes and tool activity on this account.", icon: ScrollText, infoKey: "account-audit-log" },
  { id: "integrations", group: "workspace", label: "Integrations", description: "Every connected service and where each one is managed.", icon: Plug, infoKey: "account-integrations" },
];

const DEFAULT_COMPONENTS: Record<SettingsSectionId, ComponentType<SettingsSectionProps>> = {
  "account": MyAccountSection,
  "security": PasswordSecuritySection,
  "notifications": NotificationsSection,
  "phone-bar": PhoneTabBarSection,
  "billing": BillingSection,
  "limits": LimitsUsageSection,
  "api-keys": ApiKeysSection,
  "api-usage": ApiUsageSection,
  "audit-log": AuditLogSection,
  "integrations": IntegrationsSection,
};

const overrides = new Map<SettingsSectionId, ComponentType<SettingsSectionProps>>();

/** Replace a section's panel (Billing with its tabs, the API console). Call at module load, before the page renders. */
export function registerSettingsSection(id: SettingsSectionId, Component: ComponentType<SettingsSectionProps>): void {
  overrides.set(id, Component);
}

export function settingsSectionComponent(id: SettingsSectionId): ComponentType<SettingsSectionProps> {
  return overrides.get(id) ?? DEFAULT_COMPONENTS[id];
}

export function settingsSectionDef(id: SettingsSectionId): SettingsSectionDef {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && value in DEFAULT_COMPONENTS;
}

/**
 * ?tab= values → section (+ inner view). The old tab names (profile, account,
 * notifications, security, billing) stay valid: links in emails, notifications
 * and other pages keep opening the right place. Inner tabs of Billing can be
 * deep-linked as ?tab=invoices / ?tab=payment-methods.
 */
const TAB_ALIASES: Record<string, { section: SettingsSectionId; view?: string }> = {
  profile: { section: "account" },
  account: { section: "account" },
  security: { section: "security" },
  password: { section: "security" },
  notifications: { section: "notifications" },
  billing: { section: "billing" },
  plans: { section: "billing" },
  subscriptions: { section: "billing", view: "subscriptions" },
  invoices: { section: "billing", view: "invoices" },
  "payment-methods": { section: "billing", view: "payment-methods" },
  purchases: { section: "billing", view: "purchases" },
  usage: { section: "limits" },
  limits: { section: "limits" },
  api: { section: "api-keys" },
  "api-keys": { section: "api-keys" },
  "api-usage": { section: "api-usage" },
  audit: { section: "audit-log" },
  activity: { section: "audit-log" },
  "audit-log": { section: "audit-log" },
  integrations: { section: "integrations" },
  "phone-bar": { section: "phone-bar" },
  "tab-bar": { section: "phone-bar" },
};

export function resolveSettingsTab(tab: string | null | undefined): { section: SettingsSectionId; view: string | null } {
  const key = (tab ?? "").trim().toLowerCase();
  if (!key) return { section: DEFAULT_SECTION, view: null };
  const hit = TAB_ALIASES[key];
  return hit && sectionVisible(hit.section) ? { section: hit.section, view: hit.view ?? null } : { section: DEFAULT_SECTION, view: null };
}
