import { useUrlParam } from "@/hooks/use-url-param";
import { BillingPanel, BILLING_TABS, type BillingTab } from "./billing";
import { ApiKeysPanel, ApiUsagePanel } from "./api";
import { PlanBillingSection } from "./plan-billing";
import type { SettingsSectionProps } from "./types";

/**
 * The Workspace panels of the settings shell, wired to the section registry
 * (sections.tsx):
 *
 *   billing    Subscriptions / Invoices / Payment methods / Purchases tabs. The
 *              open tab is the shell's `?view=` (deep links ?tab=invoices…), or
 *              `?billing=` for the older /settings/billing links. The
 *              Subscriptions tab is the subscription statement followed by the
 *              plan cards (current plan, usage, add-ons) with their controls.
 *   api-keys   the key console (generate with step-up, rename, limit, revoke)
 *   api-usage  units and requests per day, by key
 */

const isBillingTab = (v: unknown): v is BillingTab => BILLING_TABS.some((t) => t.id === v);

export function BillingSection({ view, go }: SettingsSectionProps) {
  const [legacyParam] = useUrlParam("billing");
  const tab: BillingTab = isBillingTab(view) ? view : isBillingTab(legacyParam) ? legacyParam : "subscriptions";
  return (
    <BillingPanel
      tab={tab}
      onTabChange={(next) => go("billing", next === "subscriptions" ? null : next)}
      subscriptions={{ showActions: false }}
      subscriptionsExtra={<PlanBillingSection view={view} go={go} section="billing" user={undefined} />}
    />
  );
}

export function ApiKeysSection(_props: SettingsSectionProps) {
  return <ApiKeysPanel />;
}

export function ApiUsageSection(_props: SettingsSectionProps) {
  return <ApiUsagePanel />;
}
