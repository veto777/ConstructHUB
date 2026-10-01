import { NotificationPreferences } from "@/components/account-security";
import type { SettingsSectionProps } from "./types";

/** Me → Notifications: which alerts arrive in-app and by email (security mail is always on). */
export function NotificationsSection(_props: SettingsSectionProps) {
  return (
    <div className="space-y-6" data-testid="section-notifications">
      <NotificationPreferences />
    </div>
  );
}
