import { useEffect } from "react";

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = "Privacy Policy | ConstructHUB";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="page-privacy-policy">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <a href="/" className="text-primary hover:underline text-sm" data-testid="link-back-home">Back to Home</a>

        <h1 className="text-3xl font-bold mt-6 mb-2" data-testid="heading-privacy-policy">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8" data-testid="text-effective-date">Effective Date: June 20, 2026</p>

        <p className="mb-6" data-testid="text-intro">
          ConstructHUB ("we," "us," or "our") operates the website at constructhub.us. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our services. Please read this policy carefully. By accessing or using ConstructHUB, you agree to the terms of this Privacy Policy.
        </p>

        <section className="mb-8" data-testid="section-contact-info">
          <h2 className="text-xl font-semibold mb-3">Contact Information</h2>
          <p>
            If you have questions or concerns about this Privacy Policy, please contact us at{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-contact-email">support@constructhub.us</a>.
          </p>
        </section>

        <section className="mb-8" data-testid="section-information-we-collect">
          <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>

          <h3 className="text-lg font-medium mt-4 mb-2">1.1 Personal Information</h3>
          <p className="mb-3">We may collect personally identifiable information that you voluntarily provide, including but not limited to:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Full name</li>
            <li>Email address</li>
            <li>Company name and business information</li>
            <li>Phone number</li>
            <li>Billing and payment information (processed securely via Stripe)</li>
            <li>Google account information (when using Google OAuth sign-in)</li>
            <li>Uploaded photos, documents, and business assets</li>
            <li>Contract and agreement signatures</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">1.2 Usage Data</h3>
          <p className="mb-3">We automatically collect certain information when you access our platform, including:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>IP address and geolocation data</li>
            <li>Browser type, version, and settings</li>
            <li>Device type and operating system</li>
            <li>Pages visited, time spent, and navigation paths</li>
            <li>Referring URLs and search queries</li>
            <li>Session duration and interaction data</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">1.3 Cookies and Tracking Technologies</h3>
          <p className="mb-3">
            We use cookies, local storage, and similar tracking technologies to maintain your session, remember your preferences, and analyze usage patterns. You may disable cookies through your browser settings, but some features of the platform may not function properly without them.
          </p>
        </section>

        <section className="mb-8" data-testid="section-tracking-tools">
          <h2 className="text-xl font-semibold mb-3">2. Tracking Tools and Services</h2>
          <p className="mb-4">
            ConstructHUB provides several tracking and analytics tools designed for contractors and businesses. These tools collect and process data as described below:
          </p>

          <h3 className="text-lg font-medium mt-4 mb-2">2.1 Click Guard (Google Ad Fraud Detection)</h3>
          <p className="mb-3">
            Click Guard monitors and analyzes clicks on your Google Ads campaigns to detect potentially fraudulent or invalid click activity. This tool collects:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Visitor IP addresses and geolocation data</li>
            <li>Browser fingerprinting data (screen resolution, installed fonts, canvas rendering, WebGL data, timezone, language settings)</li>
            <li>Click patterns, frequency, and timing</li>
            <li>Referrer information and ad campaign parameters (GCLID)</li>
            <li>VPN and proxy detection indicators</li>
            <li>Device and session identifiers</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">2.2 IP Tracker (Visitor Analytics)</h3>
          <p className="mb-3">
            IP Tracker provides visitor analytics for websites where the tracking script is installed. This tool collects:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Visitor IP addresses</li>
            <li>Geographic location (city, state, country) derived from IP addresses</li>
            <li>Browser and device information</li>
            <li>Page views, visit duration, and navigation behavior</li>
            <li>Referrer URLs and UTM campaign parameters</li>
            <li>Repeat visit detection and session tracking</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">2.3 VPN Shield (VPN Detection and Blocking)</h3>
          <p className="mb-3">
            VPN Shield detects and optionally blocks visitors using VPN services, proxies, or Tor exit nodes. This tool collects:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Visitor IP addresses</li>
            <li>VPN, proxy, and Tor detection results</li>
            <li>ISP and ASN (Autonomous System Number) information</li>
            <li>Connection type indicators</li>
            <li>Blocked visitor logs</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">2.4 Embeddable Tracking Scripts</h3>
          <p className="mb-3">
            ConstructHUB provides embeddable JavaScript tracking scripts that users install on their own websites. These scripts collect visitor data on behalf of our users. When you install our tracking scripts on your website, you are responsible for:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Disclosing the use of tracking technologies in your own website's privacy policy</li>
            <li>Complying with applicable data protection laws in your jurisdiction</li>
            <li>Obtaining any required consent from your website visitors</li>
          </ul>
        </section>

        <section className="mb-8" data-testid="section-review-tracking">
          <h2 className="text-xl font-semibold mb-3">3. Review Request Email Tracking</h2>
          <p className="mb-3">
            When you send review request emails through ConstructHUB, we track:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Email open events (via tracking pixels)</li>
            <li>Link click events</li>
            <li>Delivery status and bounce information</li>
            <li>Recipient responses and opt-out requests</li>
          </ul>
          <p>
            Recipients of review request emails may unsubscribe from future emails at any time using the unsubscribe link included in each email.
          </p>
        </section>

        <section className="mb-8" data-testid="section-gmb-monitoring">
          <h2 className="text-xl font-semibold mb-3">4. Google Business Profile Data and Google API Services</h2>
          <p className="mb-3">
            When you connect your Google account, ConstructHUB accesses your Google Business Profile information through the Google Business Profile APIs (using the <code className="text-sm">https://www.googleapis.com/auth/business.manage</code> scope) so that you can view and manage your own business profile from within ConstructHUB. With your authorization, we may access:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Business listing information you manage (name, address, phone, hours, categories, attributes)</li>
            <li>Reviews on your profile and your responses to them</li>
            <li>Profile performance and insights (views, searches, calls, and similar metrics)</li>
            <li>Media (photos) associated with your profile</li>
          </ul>
          <p className="mb-3">
            We use this data solely to provide the features you request — monitoring changes to your profile, helping you respond to reviews, optimizing photos, and reporting on performance. We do not use Google user data for advertising, and we do not sell it.
          </p>
          <p className="mb-3">
            Separately, we use publicly available Google Maps listing information (for example, public business names, addresses, and ratings) to provide context about your own profile and local market. This public data is obtained through the Google Places API, not the Business Profile API, and is not tied to your authorized Google account.
          </p>

          <h3 className="text-lg font-medium mt-4 mb-2">4.1 Limited Use Disclosure</h3>
          <p className="mb-3">
            ConstructHUB's use and transfer of information received from Google APIs to any other app will adhere to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-google-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Specifically:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>We only use Google user data to provide and improve the user-facing features described in this policy.</li>
            <li>We do not transfer or sell Google user data to third parties, except as necessary to provide or improve those features, to comply with applicable law, or as part of a merger or acquisition.</li>
            <li>We do not use Google user data to serve advertisements.</li>
            <li>We do not allow humans to read Google user data unless we have your consent for specific messages, it is necessary for security purposes or to comply with applicable law, or the data has been aggregated and anonymized.</li>
          </ul>

          <h3 className="text-lg font-medium mt-4 mb-2">4.2 Revoking Access</h3>
          <p>
            You can revoke ConstructHUB's access to your Google account at any time through your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-google-permissions">Google Account permissions page</a>, or by contacting us at{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline">support@constructhub.us</a>. Upon revocation, we stop accessing your Google Business Profile data.
          </p>
        </section>

        <section className="mb-8" data-testid="section-third-party-services">
          <h2 className="text-xl font-semibold mb-3">5. Third-Party Services</h2>
          <p className="mb-3">We integrate with the following third-party services, each of which has its own privacy policy:</p>

          <ul className="list-disc pl-6 space-y-2 mb-4">
            <li>
              <strong>Google OAuth</strong> — Used for account authentication. We receive your name, email address, and profile picture from Google when you sign in.
            </li>
            <li>
              <strong>Stripe</strong> — Used for payment processing. We do not store your full credit card number. Stripe handles all payment data in accordance with PCI DSS standards. See{" "}
              <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Stripe's Privacy Policy</a>.
            </li>
            <li>
              <strong>Google Places API</strong> — Used to retrieve publicly available business information, reviews, and location data from Google Maps.
            </li>
            <li>
              <strong>Google Business Profile API</strong> — Used, with your authorization, to access and manage your own Google Business Profile (listing details, reviews, performance insights, and media). Our use of this data adheres to the Google API Services User Data Policy, including the Limited Use requirements (see Section 4).
            </li>
            <li>
              <strong>OpenAI</strong> — Used for AI-powered features including the site assistant, ads consultant, and content generation. Conversations and prompts may be sent to OpenAI for processing. See{" "}
              <a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI's Privacy Policy</a>.
            </li>
            <li>
              <strong>Cloudflare R2</strong> — Used for cloud storage of uploaded photos and processed images. Files are stored securely in Cloudflare's infrastructure.
            </li>
            <li>
              <strong>Gmail SMTP</strong> — Used for sending transactional emails including review requests, notifications, and account communications.
            </li>
          </ul>
        </section>

        <section className="mb-8" data-testid="section-how-we-use">
          <h2 className="text-xl font-semibold mb-3">6. How We Use Your Information</h2>
          <p className="mb-3">We use the information we collect to:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Provide, maintain, and improve our services</li>
            <li>Process transactions and manage subscriptions</li>
            <li>Send you service-related communications</li>
            <li>Detect and prevent fraudulent ad clicks on your behalf</li>
            <li>Provide visitor analytics and tracking data</li>
            <li>Manage and monitor your own Google Business Profile</li>
            <li>Generate AI-powered insights and recommendations</li>
            <li>Enforce our Terms of Use and protect our platform</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section className="mb-8" data-testid="section-data-sharing">
          <h2 className="text-xl font-semibold mb-3">7. Data Sharing and Disclosure</h2>
          <p className="mb-3">We do not sell your personal information. We may share your information in the following circumstances:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>With third-party service providers (listed above) who assist in operating our platform</li>
            <li>To comply with legal obligations, court orders, or government requests</li>
            <li>To protect the rights, property, or safety of ConstructHUB, our users, or others</li>
            <li>In connection with a merger, acquisition, or sale of assets (with notice to users)</li>
            <li>With your explicit consent</li>
          </ul>
        </section>

        <section className="mb-8" data-testid="section-data-retention">
          <h2 className="text-xl font-semibold mb-3">8. Data Retention</h2>
          <p className="mb-3">
            We retain your personal information for as long as your account is active or as needed to provide services to you. Specific retention periods include:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>Account data: Retained until account deletion is requested</li>
            <li>Google Business Profile data: Retained only while your Google account is connected; removed when you disconnect, revoke access, or delete your account</li>
            <li>Tracking and analytics data (IP Tracker, Click Guard, VPN Shield): Retained for up to 24 months</li>
            <li>Payment and transaction records: Retained for 7 years as required by financial regulations</li>
            <li>Email communication logs: Retained for 12 months</li>
            <li>Uploaded photos and documents: Retained until manually deleted by the user or upon account termination</li>
          </ul>
          <p>
            After account deletion, we may retain anonymized or aggregated data that cannot identify you for analytics and improvement purposes.
          </p>
        </section>

        <section className="mb-8" data-testid="section-data-security">
          <h2 className="text-xl font-semibold mb-3">9. Data Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your personal information, including encryption in transit (TLS/SSL), secure password hashing, and access controls. However, no method of transmission over the internet or electronic storage is 100% secure. We cannot guarantee absolute security of your data.
          </p>
        </section>

        <section className="mb-8" data-testid="section-your-rights">
          <h2 className="text-xl font-semibold mb-3">10. Your Rights</h2>
          <p className="mb-3">Depending on your location, you may have the following rights regarding your personal information:</p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li><strong>Right of Access</strong> — You may request a copy of the personal information we hold about you.</li>
            <li><strong>Right to Rectification</strong> — You may request correction of inaccurate or incomplete information.</li>
            <li><strong>Right to Deletion</strong> — You may request deletion of your personal information, subject to legal retention requirements.</li>
            <li><strong>Right to Data Portability</strong> — You may request your data in a structured, commonly used, machine-readable format.</li>
            <li><strong>Right to Restrict Processing</strong> — You may request that we limit how we use your data.</li>
            <li><strong>Right to Object</strong> — You may object to certain processing of your personal information.</li>
            <li><strong>Right to Withdraw Consent</strong> — Where processing is based on consent, you may withdraw it at any time.</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-rights-email">support@constructhub.us</a>.
            We will respond to your request within 30 days.
          </p>
        </section>

        <section className="mb-8" data-testid="section-ccpa">
          <h2 className="text-xl font-semibold mb-3">11. California Privacy Rights (CCPA)</h2>
          <p className="mb-3">
            If you are a California resident, you have additional rights under the California Consumer Privacy Act (CCPA):
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li>The right to know what personal information we collect, use, and disclose about you</li>
            <li>The right to request deletion of your personal information</li>
            <li>The right to opt out of the sale of your personal information (we do not sell personal information)</li>
            <li>The right to non-discrimination for exercising your CCPA rights</li>
          </ul>
          <p>
            To submit a CCPA request, contact us at{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline">support@constructhub.us</a>.
            We may need to verify your identity before processing your request.
          </p>
        </section>

        <section className="mb-8" data-testid="section-gdpr">
          <h2 className="text-xl font-semibold mb-3">12. GDPR Compliance</h2>
          <p className="mb-3">
            If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, we process your personal data under the following legal bases:
          </p>
          <ul className="list-disc pl-6 space-y-1 mb-4">
            <li><strong>Contract Performance</strong> — Processing necessary to provide our services to you</li>
            <li><strong>Legitimate Interests</strong> — Processing necessary for our business interests, such as fraud prevention and service improvement</li>
            <li><strong>Consent</strong> — Processing based on your explicit consent, which you may withdraw at any time</li>
            <li><strong>Legal Obligation</strong> — Processing necessary to comply with applicable laws</li>
          </ul>
          <p>
            You have the right to lodge a complaint with your local data protection authority if you believe we are processing your personal data unlawfully.
          </p>
        </section>

        <section className="mb-8" data-testid="section-children">
          <h2 className="text-xl font-semibold mb-3">13. Children's Privacy</h2>
          <p>
            ConstructHUB is not intended for use by individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information promptly. If you believe we have inadvertently collected information from a child under 13, please contact us at{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline">support@constructhub.us</a>.
          </p>
        </section>

        <section className="mb-8" data-testid="section-changes">
          <h2 className="text-xl font-semibold mb-3">14. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy on this page and updating the "Effective Date" above. Your continued use of ConstructHUB after changes are posted constitutes your acceptance of the updated policy.
          </p>
        </section>

        <section className="mb-8" data-testid="section-contact-bottom">
          <h2 className="text-xl font-semibold mb-3">15. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us at:
          </p>
          <p className="mt-3">
            <strong>ConstructHUB</strong><br />
            Email:{" "}
            <a href="mailto:support@constructhub.us" className="text-primary hover:underline" data-testid="link-bottom-email">support@constructhub.us</a><br />
            Website: constructhub.us
          </p>
        </section>

        <p className="text-xs text-muted-foreground mt-10 border-t border-border pt-4" data-testid="text-copyright">
          &copy; 2025 Construction Hub. All rights reserved.
        </p>
      </div>
    </div>
  );
}
