import { useEffect } from "react";
import { CrmLogo } from "@/components/crm-logo";

/**
 * CRM-specific Terms of Service + Privacy Policy — written for BOTH audiences:
 * contractors (the account holders) and their clients (homeowners using the
 * portal / public document pages). Served publicly on every host so a client
 * can read them without signing in.
 *
 * DRAFT for attorney review before being represented as final legal terms.
 */

const EFFECTIVE = "August 1, 2026";

function LegalShell({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) {
  useEffect(() => {
    document.title = `${title} | ConstructHUB CRM`;
  }, [title]);
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid={testid}>
      <div className="max-w-3xl mx-auto px-4 py-10">
        <CrmLogo height={26} />
        <h1 className="text-3xl font-bold mt-6 mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-8">Effective Date: {EFFECTIVE}</p>
        {children}
        <div className="border-t mt-10 pt-6 text-sm text-muted-foreground space-y-1">
          <p>
            Questions? <a href="mailto:support@constructhub.us" className="text-primary hover:underline">support@constructhub.us</a> — email is the only channel we use.
          </p>
          <p>
            <a href="/crm-terms" className="text-primary hover:underline">Terms of Service</a>
            {" · "}
            <a href="/crm-privacy" className="text-primary hover:underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xl font-semibold mb-3 mt-8">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-4 leading-relaxed">{children}</p>
);
const LI = ({ children }: { children: React.ReactNode }) => <li className="mb-1">{children}</li>;

/* ── Terms of Service ────────────────────────────────────────────────────── */

export function CrmTermsPage() {
  return (
    <LegalShell title="Terms of Service — ConstructHUB CRM" testid="page-crm-terms">
      <P>
        These Terms of Service ("Terms") govern the ConstructHUB CRM — the contractor workspace at
        portal.constructhub.us and the client-facing pages it powers, including the client portal
        (client.constructhub.us) and estimate, invoice and contract links. By using any of them you
        agree to these Terms.
      </P>
      <P>
        Two kinds of people use this service, and these Terms address both: <strong>"Contractors"</strong> —
        the businesses that hold a CRM account — and <strong>"Clients"</strong> — the homeowners and
        property owners a Contractor invites to view documents, approve estimates, share photos and
        make payments.
      </P>

      <H>1. What the service is (and is not)</H>
      <P>
        ConstructHUB CRM is software. It lets a Contractor prepare and deliver estimates, invoices
        and contracts, and lets a Client review, approve, sign and pay them. ConstructHUB is{" "}
        <strong>not a party to any agreement between a Contractor and a Client</strong>. The estimate
        you approve, the contract you sign and the work performed under it are strictly between the
        Contractor and the Client. We do not perform, supervise, inspect, guarantee or warrant any
        construction work, pricing, licensing, insurance coverage or workmanship, and we make no
        representation about any Contractor's or Client's identity, qualifications or conduct.
      </P>

      <H>2. Accounts and sign-in security — protect your email</H>
      <P>
        Access to this service is anchored to your email address: Contractors sign in with their
        account email, and Clients open documents through secure links that verify their email
        inbox. That means <strong>your email account is the key to your ConstructHUB account</strong>.
        Protect it: use a strong, unique password and two-factor authentication on your email, and
        never forward sign-in links or verification codes to anyone. Anyone who controls your inbox
        can act as you here. You are responsible for all activity that occurs through your email or
        account, and you must notify us immediately at support@constructhub.us if you believe it has
        been compromised.
      </P>

      <H>3. How we contact you — email only</H>
      <P>
        We will only ever contact you by email, from a constructhub.us address. We will never call
        you, text you, or reach out through social media, and we will never ask for your password, a
        verification code, or payment outside the product. If someone contacts you any other way
        claiming to be ConstructHUB, it is not us — do not respond, and forward it to
        support@constructhub.us.
      </P>

      <H>4. Payments</H>
      <P>
        Payments run through Stripe, and money moves <strong>directly into the Contractor's own
        Stripe account — ConstructHUB never holds, touches or takes a cut of your funds</strong>.
        Card and bank details are entered on Stripe's systems, not ours. Refunds, chargebacks and
        payment disputes are between the Client, the Contractor and Stripe under Stripe's terms.
        Stripe may review or hold funds under its own risk policies; no platform can override that,
        and we will never claim otherwise.
      </P>

      <H>5. Content and responsibility</H>
      <P>
        Contractors own the business content they enter (price books, estimates, documents, terms)
        and are solely responsible for its accuracy and legality — including complying with the
        licensing, contracting, consumer-protection and tax laws that apply to their trade and
        location. Clients own the photos and messages they share, and grant the Contractor they're
        working with access to them for the project. You may not use the service for anything
        unlawful, deceptive or abusive, to send spam, to infringe anyone's rights, or to probe or
        disrupt the service's security.
      </P>

      <H>6. Disclaimers</H>
      <P>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND
        NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE OR
        SECURE, THAT DEFECTS WILL BE CORRECTED, OR THAT ANY DOCUMENT, CALCULATION, TAX FIGURE OR
        MEASUREMENT PRODUCED THROUGH THE SERVICE IS ACCURATE OR SUITABLE FOR YOUR PURPOSES. YOU ARE
        RESPONSIBLE FOR REVIEWING EVERY DOCUMENT BEFORE YOU SEND, SIGN OR PAY IT.
      </P>

      <H>7. Limitation of liability</H>
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, CONSTRUCTHUB AND ITS OWNERS, EMPLOYEES AND AGENTS
        WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR
        PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, BUSINESS INTERRUPTION, OR THE COST OF
        SUBSTITUTE SERVICES, ARISING FROM OR RELATING TO THE SERVICE — INCLUDING ANY DISPUTE BETWEEN
        A CONTRACTOR AND A CLIENT, ANY WORK PERFORMED OR NOT PERFORMED, ANY PAYMENT OR NON-PAYMENT,
        OR ANY UNAUTHORIZED ACCESS RESULTING FROM A COMPROMISED EMAIL ACCOUNT — EVEN IF WE HAVE BEEN
        ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL AGGREGATE LIABILITY FOR ANY CLAIM
        RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNT THE CONTRACTOR PAID
        CONSTRUCTHUB FOR THE SERVICE IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE, OR (B) ONE HUNDRED
        U.S. DOLLARS ($100). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO PARTS OF THIS
        SECTION MAY NOT APPLY TO YOU.
      </P>

      <H>8. Indemnification</H>
      <P>
        Contractors agree to indemnify and hold ConstructHUB harmless from claims, damages and
        expenses (including reasonable attorneys' fees) arising from their business content, their
        projects, their dealings with Clients, or their violation of these Terms or of applicable
        law.
      </P>

      <H>9. Termination</H>
      <P>
        You may stop using the service at any time. We may suspend or terminate access that violates
        these Terms, threatens the security of the service or other users, or is required by law.
        Contractors can request an export of their business data before account closure.
      </P>

      <H>10. Changes and governing law</H>
      <P>
        We may update these Terms; the effective date above changes when we do, and continued use
        after a change is acceptance of it. These Terms are governed by the laws of the State of
        Delaware, without regard to conflict-of-laws rules. Anything in these Terms notwithstanding,
        nothing here limits rights you have under consumer-protection law that cannot be limited by
        contract.
      </P>
    </LegalShell>
  );
}

/* ── Privacy Policy ──────────────────────────────────────────────────────── */

export function CrmPrivacyPage() {
  return (
    <LegalShell title="Privacy Policy — ConstructHUB CRM" testid="page-crm-privacy">
      <P>
        This Privacy Policy covers the ConstructHUB CRM: the contractor workspace at
        portal.constructhub.us and the client-facing pages it powers — the client portal
        (client.constructhub.us) and estimate, invoice and contract links. It is written for both{" "}
        <strong>Contractors</strong> (account holders) and <strong>Clients</strong> (homeowners a
        contractor works with).
      </P>

      <H>1. The short version</H>
      <ul className="list-disc pl-6 space-y-1 mb-4">
        <LI><strong>We do not sell your data.</strong> Not to advertisers, not to data brokers, not to anyone. Ever.</LI>
        <LI><strong>We only contact you by email</strong> — never by phone, text or social media.</LI>
        <LI>Client data is visible only to the Contractor the Client is working with — never to other contractors, and never used for advertising.</LI>
        <LI>Payment card and bank details go to Stripe, not to us — we never see or store them.</LI>
        <LI>Your documents travel encrypted and sit behind multiple protection layers, including Cloudflare's network.</LI>
      </ul>

      <H>2. What we collect</H>
      <P>
        <strong>From Contractors:</strong> your account email and sign-in records, your company
        profile (name, logo, address, license number, phone), and the business data you enter —
        price books, estimates, invoices, contracts, client records, team members, and settings.
      </P>
      <P>
        <strong>From Clients:</strong> the contact details your Contractor keeps for you (name,
        email, phone, project address), the documents prepared for you, your approvals and typed
        signatures, photos and messages you choose to share, and technical records of document
        activity (times a document was opened, and connection details) kept as evidence of delivery
        and approval.
      </P>
      <P>
        <strong>Payments:</strong> card numbers and bank account details are entered directly on
        Stripe's systems and never touch our servers. We keep only the payment's status and amount
        so your documents show what's paid.
      </P>

      <H>3. How we use it</H>
      <P>
        Solely to run the service: delivering documents, recording approvals, processing the
        workflow between a Contractor and their Clients, keeping the audit trail that protects both
        sides, and sending the transactional emails the service needs (sign-in links, document
        notifications, receipts). We do not use your data for advertising, we do not profile you,
        and we do not sell or rent it — to anyone.
      </P>

      <H>4. Who can see what</H>
      <P>
        A Client's information is visible to the Contractor they are working with — that's what the
        service is for — and to no other contractor. A Contractor's business data (price books,
        margins, costs) is visible only to their own team, under the permission levels they set. We
        share data outside the service only with the infrastructure providers that run it — hosting,
        Cloudflare (network security and delivery), Stripe (payments), and email delivery — each
        only receiving what their function requires; and when the law genuinely compels us. That's
        the whole list.
      </P>

      <H>5. Security</H>
      <P>
        Your data is protected by multiple layers: all traffic is encrypted in transit (HTTPS/TLS),
        the service sits behind Cloudflare's network with its DDoS and threat protections, documents
        are gated so only the verified email recipient can open them, access inside a company is
        permission-controlled, payment credentials never touch our servers, and approvals carry an
        audit trail. We work to keep every layer tight — and honesty requires the standard caveat
        every service owes you: no method of transmission or storage is 100% secure, so no one can
        truthfully promise "unhackable." What we promise is layered protection, minimal data
        exposure, and prompt notification as required by law if an incident ever affects your data.
      </P>
      <P>
        <strong>Your part:</strong> access here is anchored to your email inbox. Protect that email
        account — strong unique password, two-factor authentication — because anyone who controls
        your inbox can open what's addressed to you.
      </P>

      <H>6. Cookies and tracking</H>
      <P>
        We use essential cookies only — the session cookie that keeps you signed in. No advertising
        cookies, no third-party trackers, no analytics that follow you around the web.
      </P>

      <H>7. Retention and your rights</H>
      <P>
        We keep data as long as it's needed to run the service and preserve the legal record of
        documents and approvals (signed contracts and their audit trails are retained as evidence
        for both parties). Contractors can export their business data and request account deletion.
        Clients can ask their Contractor to correct or remove their records, or email us directly at
        support@constructhub.us to exercise access or deletion rights; where law requires us to keep
        something (like a signed contract's record), we'll tell you what and why. Depending on where
        you live (e.g. California, the EU/UK), you may have additional statutory rights — email us
        and we will honor them.
      </P>

      <H>8. Children</H>
      <P>
        The service is for business use and is not directed to anyone under 18. We do not knowingly
        collect data from children.
      </P>

      <H>9. Changes</H>
      <P>
        If this policy changes, the effective date above changes with it, and material changes will
        be announced by email — the only way we ever contact you.
      </P>
    </LegalShell>
  );
}
