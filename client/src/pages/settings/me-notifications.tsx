import { NotificationPreferences } from "@/components/account-security";
import { AppPushCard } from "@/components/app-push-card";
import type { SettingsSectionProps } from "./types";

/** Me → Notifications: which alerts arrive in-app and by email (security mail is always on); in the iPhone app,
 *  the card to turn on phone notifications (they follow the in-app switches). */
export function NotificationsSection(_props: SettingsSectionProps) {
  return (
    <div className="space-y-6" data-testid="section-notifications">
      <AppPushCard />
      <NotificationPreferences />
    </div>
  );
}
