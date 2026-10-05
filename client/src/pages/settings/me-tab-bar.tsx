import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabBarPicker } from "@/components/tab-bar-picker";
import { CRM_TAB_DEFAULT, CRM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT, PLATFORM_TAB_OPTIONS } from "@shared/tab-bar";
import { CRM_TAB_ICONS, PLATFORM_TAB_ICONS, useSaveTabPrefs, useTabPrefs } from "@/lib/tab-prefs";
import type { SettingsSectionProps } from "./types";

/**
 * Settings → Phone tab bar (owner, 2026-10-04: "Let the settings allow you to pick what's in your lower Ribbon on
 * mobile and app"). Both bars live on the account, so the phone browser and the iPhone apps show the same tabs.
 * The CRM's own More menu has the same CRM picker ("Customize the bar").
 */
export function PhoneTabBarSection(_props: SettingsSectionProps) {
  const prefs = useTabPrefs();
  const save = useSaveTabPrefs();
  return (
    <div className="space-y-6" data-testid="section-phone-tab-bar">
      <Card>
        <CardHeader><CardTitle className="text-base">ConstructHUB tools</CardTitle></CardHeader>
        <CardContent>
          <TabBarPicker options={PLATFORM_TAB_OPTIONS} defaults={PLATFORM_TAB_DEFAULT} value={prefs.data?.platformTabs}
            icons={PLATFORM_TAB_ICONS} lastLabel="Menu" saving={save.isPending} testIdPrefix="platform-tabs"
            onSave={(keys) => save.mutateAsync({ platformTabs: keys })} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">ConstructHUB CRM</CardTitle></CardHeader>
        <CardContent>
          <TabBarPicker options={CRM_TAB_OPTIONS} defaults={CRM_TAB_DEFAULT} value={prefs.data?.crmTabs}
            icons={CRM_TAB_ICONS} lastLabel="More" saving={save.isPending} testIdPrefix="crm-tabs"
            onSave={(keys) => save.mutateAsync({ crmTabs: keys })} />
        </CardContent>
      </Card>
    </div>
  );
}
