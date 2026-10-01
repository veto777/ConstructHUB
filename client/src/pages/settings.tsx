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
 * (settings/sections.tsx resolveSettingsTab). Below md the nav collapses into
 * a menu button. Each section is a panel from the registry in sections.tsx.
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
    <div ref={root} className="h-full overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Account settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Your profile and security, and your workspace's billing, limits, API access, activity and connections.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (previousEntryIsInApp()) {
                window.history.back();
              } else {
                navigate("/");
              }
            }}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Close settings"
            data-testid="button-close-settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-5 md:gap-8">
          <SettingsNav active={section} onSelect={(id) => go(id)} />

          <div className="flex-1 min-w-0" data-testid={`settings-section-${section}`}>
            <SettingsSectionHeader title={def.label} description={def.description} infoKey={def.infoKey} />
            <div className="mt-6">
              <Section user={user} section={section} view={view} go={go} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
