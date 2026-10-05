import { useEffect } from "react";
import { copyrightNotice } from "@/lib/marketing";
import { LegalPage } from "@/components/legal-page";

/**
 * /support — how to reach ConstructHUB support and help for the iPhone apps. It is the App Store listing's Support
 * URL for both apps (docs/app/APP-STORE-PLAN.md), so every answer here must match the apps exactly.
 */
export default function SupportPage() {
  useEffect(() => {
    document.title = "Support | ConstructHUB";
  }, []);
  const mail = <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-support-email">support@constructhub.us</a>;

  return (
    <LegalPage
      path="/support"
      pageTestId="page-support"
      title="Support"
      titleTestId="heading-support"
      date="ConstructHUB on the web and on iPhone"
      dateTestId="text-support-scope"
      footer={copyrightNotice()}
    >
      <section className="mb-8" data-testid="section-contact">
        <h2 className="text-xl font-semibold mb-3">Contact support</h2>
        <p className="mb-3">
          Email {mail} from the address on your account and tell us what you were doing, on which page or screen, and
          what you expected to happen. A screenshot helps. We answer every message by email.
        </p>
      </section>

      <section className="mb-8" data-testid="section-sign-in">
        <h2 className="text-xl font-semibold mb-3">Signing in</h2>
        <ul className="list-disc pl-6 space-y-1 mb-4">
          <li>Use the same account on the website and in both iPhone apps (ConstructHUB and ConstructHUB CRM).</li>
          <li>Sign in with your email and password, with Google, or in the iPhone apps with Apple.</li>
          <li>Forgot your password? Choose <strong>Forgot password?</strong> on the sign-in screen to get a reset link by email.</li>
          <li>If your account uses two-factor sign-in, have your authenticator app ready.</li>
        </ul>
      </section>

      <section className="mb-8" data-testid="section-iphone-apps">
        <h2 className="text-xl font-semibold mb-3">The iPhone apps</h2>
        <ul className="list-disc pl-6 space-y-1 mb-4">
          <li><strong>ConstructHUB</strong> opens your growth tools; <strong>ConstructHUB CRM</strong> opens your clients, jobs, estimates, invoices and schedule.</li>
          <li><strong>Notifications:</strong> in ConstructHUB, open Settings → Notifications; in ConstructHUB CRM, open More. Tap <strong>Turn on</strong> under "Notifications on this iPhone". The switches on that page decide which alerts you get. To stop them, turn notifications off for the app in iPhone Settings.</li>
          <li><strong>Tab bar:</strong> pick the tabs at the bottom of the screen in Settings → Phone tab bar (ConstructHUB) or More → Customize the bar (ConstructHUB CRM).</li>
          <li><strong>Offline:</strong> the apps need an internet connection; when you are offline they say so and retry when you tap <strong>Retry</strong>.</li>
        </ul>
      </section>

      <section className="mb-8" data-testid="section-delete-account">
        <h2 className="text-xl font-semibold mb-3">Deleting your account</h2>
        <p className="mb-3">
          In the ConstructHUB app, open Settings → My account → <strong>Delete account</strong>. In ConstructHUB CRM, open
          More → <strong>Delete account</strong>. Deleting cancels billing, signs you out everywhere, revokes Sign in with
          Apple if you used it, and erases your data within 30 days (payment records are kept as the law requires). On the
          website, email {mail} from your account's address to ask for deletion.
        </p>
      </section>

      <section className="mb-8" data-testid="section-policies">
        <h2 className="text-xl font-semibold mb-3">Privacy and terms</h2>
        <p>
          Read our <a href="/privacy" className="text-primary hover:underline" data-testid="link-support-privacy">Privacy Policy</a> and{" "}
          <a href="/terms" className="text-primary hover:underline" data-testid="link-support-terms">Terms of Use</a>.
        </p>
      </section>
    </LegalPage>
  );
}
