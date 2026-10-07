import { AppPage } from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill } from "@/components/google";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { useUrlParam } from "@/hooks/use-url-param";
import { SettingsNav } from "./settings/nav";
import { DEFAULT_SECTION, resolveSettingsTab, settingsSectionComponent, settingsSectionDef } from "./settings/sections";
import { SettingsSectionHeader } from "./settings/shared";
import type { SettingsSectionId, SettingsUser } from "./settings/types";

/**
 * Account settings: a left nav in two groups — Me (My account, Password &
 * security, Notifications) and Workspace (Billing, Limits & usage, API keys,
 * API usage, Audit log, Integrations) — with the open section in ?tab= so a
 * reload or a shared link reopens it. Old tab names keep working
 * (settings/sections.tsx resolveSettingsTab). Below lg the nav collapses into
 * a menu button (the app sidebar already takes a tablet's left edge). Each
 * section is a panel from the registry in sections.tsx.
 */

export type { SettingsSectionId, SettingsSectionProps, SettingsUser } from "./settings/types";
export { registerSettingsSection, resolveSettingsTab, SETTINGS_SECTIONS } from "./settings/sections";

/**
 * Close (X) should go back only when the previous history entry is part of
 * the app. A document opened straight at /settings (typed URL, a link from
 * another site, an email) has no in-app entry behind it — go home instead.
 */
function previousEntryIsInApp(): boolean {
  if (window.history.length <= 1) return false;
  const entry = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  // Reached through in-app navigation: the document was loaded elsewhere.
  if (entry && new URL(entry.name).pathname !== window.location.pathname) return true;
  try {
    return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const [tabParam, setTabParam] = useUrlParam("tab");
  const [viewParam, setViewParam] = useUrlParam("view");
  const resolved = resolveSettingsTab(tabParam);
  const section = resolved.section;
  const view = viewParam ?? resolved.view;
  const def = settingsSectionDef(section);
  const Section = settingsSectionComponent(section);

  const { data: user } = useQuery<SettingsUser>({ queryKey: ["/api/auth/me"] });

  const go = (next: SettingsSectionId, nextView: string | null = null) => {
    setTabParam(next === DEFAULT_SECTION ? null : next);
    setViewParam(nextView || null);
  };

  // A new section starts at the top, not wherever the last one was scrolled to.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.scrollTo?.({ top: 0 }); }, [section]);

  return (
    <div ref={root} className="min-w-0">
      <AppPage>
        {/* Google's page format (owner, 2026-10-07): a quiet header, pill actions, hairline sections. */}
        <GoogleSectionHeader
          as="h1"
          titleTestId="text-settings-title"
          title="Account settings"
          description="Manage your account and workspace."
          flush
          actions={
            <GooglePill
              icon={X}
              variant="quiet"
              label="Close"
              onClick={() => {
                if (previousEntryIsInApp()) {
                  window.history.back();
                } else {
                  navigate("/");
                }
              }}
              ariaLabel="Close settings"
              testId="button-close-settings"
            />
          } />

        <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
          <SettingsNav active={section} onSelect={(id) => go(id)} />

          <div className="flex-1 min-w-0" data-testid={`settings-section-${section}`}>
            <SettingsSectionHeader title={def.label} description={def.description} infoKey={def.infoKey} />
            <div className="mt-4">
              <Section user={user} section={section} view={view} go={go} />
            </div>
          </div>
        </div>
      </AppPage>
    </div>
  );
}
