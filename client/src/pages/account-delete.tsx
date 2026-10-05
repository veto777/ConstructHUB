import { AppPage, PageHeader } from "@/components/app-ui";
import { AccountDeletionCard } from "@/components/account-deletion";
import { inNativeApp } from "@/lib/app-shell";

/**
 * /account/delete — the iPhone apps' self-serve account deletion (both the platform and the CRM app reach it).
 * On the website the page only points to the support request: deletion lives in the native apps (owner, 2026-10-04).
 */
export default function AccountDeletePage() {
  return (
    <AppPage width="narrow">
      <PageHeader title="Delete account" />
      {inNativeApp() ? <AccountDeletionCard /> : (
        <p className="text-sm text-muted-foreground" data-testid="text-account-delete-web">
          To delete your account, go to Settings → Account → Delete account and send the request to
          support@constructhub.us from your account's email address.
        </p>
      )}
    </AppPage>
  );
}
