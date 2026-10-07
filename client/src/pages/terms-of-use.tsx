import { useEffect } from "react";
import { copyrightNotice } from "@/lib/marketing";
import { LegalPage } from "@/components/legal-page";
import { ADDONS, PLANS, PLAN_KEYS } from "@shared/plans";
import { inNativeApp } from "@/lib/app-shell";
import {
  AGENCY_ONLY_MODULES, CRM_SEATS_LINE, SALES_REP_LABEL, SALES_THRESHOLD_LABEL, TRIAL_LABEL,
  agencyBandsLine, formatUsd, joinNames, planPriceLine,
} from "@shared/plan-copy";

/** Shown under the title; update whenever these Terms change. */
const LAST_UPDATED = "October 7, 2026";

export default function TermsOfUsePage() {
  useEffect(() => {
    document.title = "Terms of Use | ConstructHUB";
  }, []);

  return (
    <LegalPage
      path="/terms"
      pageTestId="page-terms-of-use"
      title="Terms of Use"
      titleTestId="heading-terms-title"
      date={<>Last updated: {LAST_UPDATED}</>}
      dateTestId="text-effective-date"
      footer={copyrightNotice()}
    >
        <div>
          <section data-testid="section-introduction">
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p>Welcome to ConstructHUB ("we," "us," or "our"), operated at constructhub.us. These Terms of Use ("Terms") govern your access to and use of our website, platform, tools, services, and content. By creating an account or using any part of ConstructHUB, you agree to be bound by these Terms. If you do not agree, do not use the platform.</p>
          </section>

          <section data-testid="section-eligibility">
            <h2 className="text-xl font-semibold mb-3">2. Account Registration and Eligibility</h2>
            <p className="mb-2">You must be at least 18 years of age to create an account and use ConstructHUB. By registering, you represent and warrant that:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>You are at least 18 years old.</li>
              <li>All information you provide during registration is accurate, current, and complete.</li>
              <li>You will maintain the security of your account credentials and promptly notify us of any unauthorized use.</li>
              <li>You are responsible for all activity that occurs under your account.</li>
            </ul>
            <p className="mt-2">We reserve the right to suspend or terminate accounts that violate these Terms or provide false information during registration.</p>
          </section>

          <section data-testid="section-subscription-plans">
            <h2 className="text-xl font-semibold mb-3">3. Subscription Plans and Pricing</h2>
            {inNativeApp() ? <p>Paid plans aren't sold in the ConstructHUB apps. A paid plan on your account is governed by the plan, price and billing terms in effect when you subscribed, including automatic renewal and cancellation at the end of the billing period.</p> : <>
            <p className="mb-2">ConstructHUB offers the following subscription plans, billed monthly or annually (the annual price is 10 times the monthly price):</p>
            <ul className="list-disc pl-6 space-y-1 mb-3" data-testid="list-plans">
              {PLAN_KEYS.map((key) => (
                <li key={key}><strong>{PLANS[key].name}</strong> &mdash; {planPriceLine(key)}</li>
              ))}
            </ul>
            <p className="mb-2">The {PLANS.agency.name} plan includes {PLANS.agency.limits.locations} locations. Additional locations are billed at {agencyBandsLine()}. Only the {PLANS.agency.name} plan includes the {joinNames(AGENCY_ONLY_MODULES)}.</p>
            <p className="mb-2">The ConstructHUB CRM is included in every plan; the plan sets the number of CRM seats ({CRM_SEATS_LINE}). What each plan includes, and its usage limits, are listed on the Pricing page.</p>
            <p className="mb-2">There is no free plan. A new subscription starts with a {TRIAL_LABEL}. When the trial ends, the subscription continues at the plan price unless you cancel before then.</p>
            <p>All subscription plans automatically renew at the end of each billing cycle unless canceled before the renewal date. You may cancel your subscription at any time through your account settings, and cancellation will take effect at the end of the current billing period. No partial refunds are issued for unused portions of the current billing cycle unless otherwise stated.</p>
            </>}
          </section>

          <section data-testid="section-add-ons">
            <h2 className="text-xl font-semibold mb-3">4. Add-ons</h2>
            {inNativeApp() ? <p>Add-ons aren't sold in the ConstructHUB apps. Add-ons on your account follow the same terms as your plan.</p> : <>
            <p className="mb-2">Individual tools are not sold on their own. You can add the following to an eligible plan; add-ons are billed with your plan, monthly or annually (10 times the monthly price):</p>
            <ul className="list-disc pl-6 space-y-1">
              {Object.values(ADDONS).map((addon) => (
                <li key={addon.key}>
                  <strong>{addon.name}</strong> &mdash; {formatUsd(addon.monthlyCents)}/month
                  {addon.setupCents ? <> plus a {formatUsd(addon.setupCents)} one-time setup fee</> : null}
                  {" "}({joinNames(addon.availableOn.map((key) => PLANS[key].name))})
                </li>
              ))}
            </ul>
            <p className="mt-2">Add-ons are subject to the same auto-renewal, cancellation, and billing policies as subscription plans.</p>
            </>}
          </section>

          <section data-testid="section-billing">
            <h2 className="text-xl font-semibold mb-3">5. Billing and Payments</h2>
            <p className="mb-2">All payments are processed securely through Stripe. By subscribing, you authorize ConstructHUB to charge your payment method on a recurring basis at the applicable rate. You agree that:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>All billing is recurring and will automatically renew unless you cancel.</li>
              <li>You are responsible for keeping your payment information current.</li>
              <li>Failed payments may result in suspension or termination of your account.</li>
              <li>Prices are subject to change with 30 days' prior notice.</li>
            </ul>
          </section>

          <section data-testid="section-done-for-you">
            <h2 className="text-xl font-semibold mb-3">6. Done-For-You Services</h2>
            {inNativeApp() ? <p>Done-For-You services aren't sold in the ConstructHUB apps. Services you have agreed to are governed by the scope, price and contract terms you accepted.</p> : <>
            <p className="mb-2">ConstructHUB offers Done-For-You services, including but not limited to business formation and licensing, GMB &amp; website setup, SEO programs, the Complete Business Build, and custom work.</p>
            <p className="mb-2">Services priced at {SALES_THRESHOLD_LABEL} or more are not sold through online checkout. A sales rep (&ldquo;{SALES_REP_LABEL}&rdquo;) confirms the scope and the price with you before you commit or pay.</p>
            <p className="mb-2">SEO packages require a minimum 6-month contract commitment. Early termination of SEO contracts is subject to an early termination penalty equal to 50% of the remaining contract value. Done-For-You service fees are non-refundable once work has commenced.</p>
            </>}
          </section>

          <section data-testid="section-master-class">
            <h2 className="text-xl font-semibold mb-3">7. Master Class</h2>
            {inNativeApp() ? <p>Master Class content isn't sold in the ConstructHUB apps. Master Class materials you have access to are proprietary; you may not redistribute, share, copy, or resell them.</p> : <>
            <p className="mb-2">ConstructHUB offers educational Master Class content as individual modules and as a complete bundle. Master Class items priced at {SALES_THRESHOLD_LABEL} or more are quoted by a sales rep before purchase; items under {SALES_THRESHOLD_LABEL} show their price at checkout.</p>
            <p>Master Class purchases are non-refundable once access has been granted. All Master Class materials are proprietary and protected by intellectual property laws. You may not redistribute, share, copy, or resell any Master Class content.</p>
            </>}
          </section>

          <section data-testid="section-trial-beta">
            <h2 className="text-xl font-semibold mb-3">8. Trial Access Codes and Beta Access</h2>
            <p>ConstructHUB may issue trial access codes or grant beta access to certain users at our discretion. Trial and beta access is provided "as-is" without warranty. We reserve the right to modify, limit, or revoke trial or beta access at any time without notice. Features available during trial or beta periods may change or be discontinued. Trial access codes are non-transferable and intended for single-user use only.</p>
          </section>

          <section data-testid="section-custom-work">
            <h2 className="text-xl font-semibold mb-3">9. Custom Work</h2>
            <p>Custom work is not included in any subscription plan. It is quoted by a sales rep and agreed with you before it is scheduled.</p>
          </section>

          <section data-testid="section-refund-policy">
            <h2 className="text-xl font-semibold mb-3">10. Refund Policy</h2>
            <p className="mb-2">Due to the digital nature of our services:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Digital services, tools, and Master Class content are generally non-refundable.</li>
              <li>Subscription plans may be eligible for pro-rated refunds at our discretion if canceled within the first 7 days of a billing cycle.</li>
              <li>Done-For-You services are non-refundable once work has commenced.</li>
              <li>Refund requests should be directed to support@constructhub.us.</li>
            </ul>
          </section>

          <section data-testid="section-acceptable-use">
            <h2 className="text-xl font-semibold mb-3">11. Acceptable Use Policy</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Abuse, overload, or exploit our scraping, tracking, or monitoring tools beyond normal usage patterns.</li>
              <li>Share, distribute, or allow unauthorized access to tracking scripts provided by ConstructHUB (Click Guard, IP Tracker, VPN Shield) to third parties.</li>
              <li>Resell, sublicense, or commercially redistribute any data, reports, or analytics generated by ConstructHUB tools.</li>
              <li>Use the platform for any unlawful purpose or in violation of any applicable local, state, national, or international law.</li>
              <li>Attempt to reverse engineer, decompile, or disassemble any part of the platform.</li>
              <li>Interfere with or disrupt the integrity or performance of the platform.</li>
              <li>Create multiple accounts to circumvent usage limits or abuse trial offers.</li>
            </ul>
            <p className="mt-2">Violation of this Acceptable Use Policy may result in immediate account suspension or termination without refund.</p>
          </section>

          <section data-testid="section-tracking-tools">
            <h2 className="text-xl font-semibold mb-3">12. Tracking Tools Usage</h2>
            <p className="mb-2">ConstructHUB provides the following tracking and protection tools:</p>
            <ul className="list-disc pl-6 space-y-1 mb-3">
              <li><strong>Click Guard</strong> &mdash; Detects and blocks fraudulent clicks on your Google Ads campaigns by monitoring IP addresses, click patterns, and device fingerprints.</li>
              <li><strong>IP Tracker</strong> &mdash; Provides visitor analytics including IP addresses, geographic location, device information, and browsing behavior for visitors to your website.</li>
              <li><strong>VPN Shield</strong> &mdash; Detects and blocks visitors using VPNs, proxies, or anonymization tools from accessing your website.</li>
            </ul>
            <p className="mb-2">By using these tools, you acknowledge and agree that:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>You are solely responsible for disclosing the use of tracking technologies on your own websites in compliance with all applicable privacy laws.</li>
              <li>You will update your website's privacy policy to reflect the use of ConstructHUB tracking scripts.</li>
              <li>ConstructHUB is not liable for your failure to comply with privacy disclosure requirements.</li>
              <li>Data collected through tracking tools is stored securely but ConstructHUB does not guarantee 100% accuracy of tracking data.</li>
            </ul>
          </section>

          <section data-testid="section-gmb-monitoring">
            <h2 className="text-xl font-semibold mb-3">13. Google Business Profile and Google API Services</h2>
            <p>ConstructHUB provides tools to help you manage and monitor your own Google Business Profile, including review tracking, ranking analysis, photo optimization, and performance reporting. You acknowledge that:</p>
            <ul className="list-disc pl-6 space-y-1 mt-2">
              <li>When you connect your Google account, you authorize ConstructHUB to access and manage your Google Business Profile on your behalf.</li>
              <li>ConstructHUB's use of information received from Google APIs adheres to the{" "}
                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements, as described in our Privacy Policy.</li>
              <li>You may revoke ConstructHUB's access to your Google account at any time through your Google Account permissions page.</li>
              <li>Data accuracy is not guaranteed, as it depends on third-party sources and APIs.</li>
              <li>Google Business Profile data may be subject to delays or discrepancies.</li>
              <li>ConstructHUB is not affiliated with or endorsed by Google.</li>
              <li>Changes to Google's APIs or policies may affect the availability or accuracy of these features.</li>
            </ul>
            <h3 className="text-lg font-medium mt-4 mb-2" data-testid="heading-youtube-terms">YouTube API Services</h3>
            <p>
              ConstructHUB uses YouTube API Services to publish its own tutorial videos to its own YouTube channel. By using features of ConstructHUB that rely on YouTube, you agree to be bound by the{" "}
              <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-youtube-terms">YouTube Terms of Service</a>. How we handle YouTube data is described in our Privacy Policy.
            </p>
          </section>

          <section data-testid="section-intellectual-property">
            <h2 className="text-xl font-semibold mb-3">14. Intellectual Property</h2>
            <p>All content, materials, software, tools, guides, Master Class modules, branding, logos, and documentation on ConstructHUB are the exclusive property of Construction Hub and are protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, sell, or create derivative works based on any ConstructHUB content without our express written permission.</p>
          </section>

          <section data-testid="section-limitation-liability">
            <h2 className="text-xl font-semibold mb-3">15. Limitation of Liability</h2>
            <p className="mb-2">TO THE MAXIMUM EXTENT PERMITTED BY LAW, CONSTRUCTHUB AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:</p>
            <ul className="list-disc pl-6 space-y-1 mb-3">
              <li>Loss of profits, revenue, data, or business opportunities.</li>
              <li>Damages arising from reliance on tracking data, analytics, or reports.</li>
              <li>Damages resulting from unauthorized access to your account.</li>
              <li>Service interruptions, downtime, or data loss.</li>
            </ul>
            <p className="mb-2"><strong>Data retention and backups.</strong> You acknowledge that any data you store on the platform — including clients, estimates, invoices, projects, notes, and uploaded files — may be deleted or lost at any time, for any reason, including technical failure, human error, security incidents, or termination of your account. ConstructHUB maintains internal disaster-recovery backups for its own operational purposes only, retains them for no more than a few days, and does not guarantee that any specific record can be restored. You are solely responsible for maintaining your own independent copies of your data. The platform provides scheduled self-service backup exports (Settings &rarr; Backups), and it is your responsibility to enable and use them. ConstructHUB is not responsible or liable for any deletion, loss, corruption, or unavailability of your data under any circumstances.</p>
            <p>OUR TOTAL LIABILITY FOR ANY CLAIM ARISING FROM OR RELATED TO THESE TERMS SHALL NOT EXCEED THE AMOUNT YOU PAID TO CONSTRUCTHUB IN THE 12 MONTHS PRECEDING THE CLAIM.</p>
          </section>

          <section data-testid="section-indemnification">
            <h2 className="text-xl font-semibold mb-3">16. Indemnification</h2>
            <p>You agree to indemnify, defend, and hold harmless ConstructHUB, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising from or related to: (a) your use of the platform; (b) your violation of these Terms; (c) your violation of any applicable law or regulation; (d) your failure to disclose tracking technologies on your website; or (e) any content or data you submit through the platform.</p>
          </section>

          <section data-testid="section-dispute-resolution">
            <h2 className="text-xl font-semibold mb-3">17. Dispute Resolution</h2>
            <p className="mb-2">Any dispute, controversy, or claim arising out of or relating to these Terms or your use of ConstructHUB shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. You agree that:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Arbitration shall be conducted on an individual basis; class actions and class arbitrations are not permitted.</li>
              <li>The arbitration shall take place in the United States.</li>
              <li>The arbitrator's decision shall be final and binding.</li>
              <li>These Terms are governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles.</li>
            </ul>
          </section>

          <section data-testid="section-termination">
            <h2 className="text-xl font-semibold mb-3">18. Termination of Accounts</h2>
            <p className="mb-2">We reserve the right to suspend or terminate your account at any time, with or without cause, including but not limited to:</p>
            <ul className="list-disc pl-6 space-y-1 mb-3">
              <li>Violation of these Terms or the Acceptable Use Policy.</li>
              <li>Non-payment or repeated payment failures.</li>
              <li>Fraudulent or abusive activity.</li>
              <li>Inactivity for an extended period.</li>
            </ul>
            <p>Upon termination, your access to the platform and all associated tools will be revoked. You may request deletion of your account data by contacting support@constructhub.us. Data deletion requests will be processed within 30 days, subject to any legal retention requirements.</p>
          </section>

          <section data-testid="section-modifications">
            <h2 className="text-xl font-semibold mb-3">19. Modifications to Terms</h2>
            <p>We reserve the right to modify these Terms at any time. Material changes will be communicated via email or a prominent notice on the platform. Your continued use of ConstructHUB after any modifications constitutes your acceptance of the revised Terms. We encourage you to review these Terms periodically.</p>
          </section>

          <section data-testid="section-disclaimers">
            <h2 className="text-xl font-semibold mb-3">20. Disclaimers</h2>
            <p>THE PLATFORM AND ALL SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. CONSTRUCTHUB DOES NOT WARRANT THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.</p>
          </section>

          <section data-testid="section-contact">
            <h2 className="text-xl font-semibold mb-3">21. Contact Information</h2>
            <p>If you have any questions or concerns about these Terms of Use, please contact us at:</p>
            <p className="mt-2">
              <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-contact-email">support@constructhub.us</a>
            </p>
          </section>
        </div>
    </LegalPage>
  );
}