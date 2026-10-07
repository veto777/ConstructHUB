/**
 * The click-by-click "how do I connect my account" walkthrough shown ON the Connections form of the Cloudflare
 * and Search Console pages (owner, 2026-10-07: "most users dont know how to connect their account … we need a
 * walkthrough to access this key").
 *
 * Cloudflare has no "sign in and allow access" screen for outside apps, so the customer has to fetch a key from
 * their Cloudflare profile themselves. These steps follow Cloudflare's own documentation for where that key lives
 * (developers.cloudflare.com/fundamentals/api/get-started/keys: "User Profile > API Tokens", then "In the API Keys
 * section, click View button of Global API Key") and what this page really does with it (server/cloudflare/routes.ts:
 * the key is used for the verify and create requests only and is never stored; a limited key with Zone Read,
 * Analytics Read and Zone WAF Edit on the chosen zones is what gets saved).
 *
 * Open by default while the account has no connection yet; collapsed afterwards.
 */
import type { ReactNode } from "react";
import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";

/** Cloudflare's API Tokens page in the customer's own profile (the Global API Key and "Create Token" both live there). */
export const CLOUDFLARE_API_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";
/** Google Search Console, where the customer can check which Google account owns their property. */
export const SEARCH_CONSOLE_URL = "https://search.google.com/search-console";

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[12px] font-medium"
        style={{ background: "var(--g-accent-soft)", color: "var(--g-accent-ink)" }}
      >
        {n}
      </span>
      <div className="min-w-0 text-[14px] leading-5">
        <p className="g-text font-medium">{title}</p>
        {children && <div className="g-text-2 mt-0.5 space-y-1">{children}</div>}
      </div>
    </li>
  );
}

function OutLink({ href, children, testId }: { href: string; children: ReactNode; testId: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="g-pill" data-testid={testId}>
      <ExternalLink aria-hidden="true" /> {children}
    </a>
  );
}

function Shell({ title, open, testId, children }: { title: string; open: boolean; testId: string; children: ReactNode }) {
  return (
    <details className="g-callout list-none" open={open} data-testid={testId}>
      <summary className="list-none flex cursor-pointer items-center gap-2 text-[15px] font-medium g-text">
        <KeyRound className="h-4 w-4 flex-none" aria-hidden="true" style={{ color: "var(--g-accent-ink)" }} />
        {title}
        <span className="g-text-2 ml-auto text-[12px] font-normal">show / hide</span>
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

/** Step by step: get the Global API Key out of Cloudflare and connect with it. */
export function CloudflareConnectSteps({ open }: { open: boolean }) {
  return (
    <Shell title="First time? How to connect your Cloudflare account" open={open} testId="cloudflare-connect-steps">
      <p className="g-text-2 text-[14px] leading-5">
        Cloudflare has no "sign in and allow" button for outside apps. Instead you copy one key from your own
        Cloudflare profile and paste it here once. It takes about two minutes.
      </p>
      <ol className="space-y-3">
        <Step n={1} title="Open your Cloudflare API Tokens page">
          <p>Sign in to Cloudflare if it asks. The button opens the right page in a new tab.</p>
          <p className="pt-1"><OutLink href={CLOUDFLARE_API_TOKENS_URL} testId="link-cloudflare-api-tokens">Open Cloudflare → API Tokens</OutLink></p>
          <p>By hand: click the person icon at the top right of Cloudflare, choose <b className="g-text font-medium">My Profile</b>, then <b className="g-text font-medium">API Tokens</b> in the left menu.</p>
        </Step>
        <Step n={2} title="Find “Global API Key” and click View">
          <p>Scroll down that page to the section called <b className="g-text font-medium">API Keys</b>. On the <b className="g-text font-medium">Global API Key</b> row, click <b className="g-text font-medium">View</b>. Cloudflare may ask for your Cloudflare password before it shows the key.</p>
        </Step>
        <Step n={3} title="Copy the key">
          <p>It is a long line of letters and numbers. Click to copy it. Leave the “Origin CA Key” alone — that is a different key.</p>
        </Step>
        <Step n={4} title="Come back here and paste it">
          <p>Type the email you log in to Cloudflare with, paste the key into <b className="g-text font-medium">Global API Key</b> below, then choose <b className="g-text font-medium">Verify and choose zones</b>. (A “zone” is Cloudflare's word for one website.)</p>
        </Step>
        <Step n={5} title="Tick your websites and choose “Create limited key”">
          <p>Your sites then appear under the <b className="g-text font-medium">Sites</b> tab within a minute or two. <b className="g-text font-medium">Work queue</b> shows the import finishing.</p>
        </Step>
      </ol>
      <div className="flex gap-2 text-[13px] leading-5 g-text-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" style={{ color: "var(--g-green)" }} />
        <p>
          <b className="g-text font-medium">What happens to the key:</b> the Global API Key is used once, to check it is your account and to
          create a separate limited key, and it is not saved. The limited key is what ConstructHUB keeps. It can only read
          the sites you ticked and their traffic numbers, and edit their firewall rules (Zone Read, Analytics Read, Zone WAF Edit).
          You can delete it any time on that same Cloudflare page, under API Tokens.
        </p>
      </div>
      <p className="g-text-2 text-[13px] leading-5">
        Rather not use the Global API Key? Open <b className="g-text font-medium">Fallback: paste a scoped API token</b> below and make
        a limited token yourself instead.
      </p>
    </Shell>
  );
}

/** The numbered version of the scoped-token fallback (same Cloudflare page, "Create Token"). */
export function CloudflareTokenSteps() {
  return (
    <ol className="space-y-3" data-testid="cloudflare-token-steps">
      <Step n={1} title="Open your Cloudflare API Tokens page">
        <p className="pt-1"><OutLink href={CLOUDFLARE_API_TOKENS_URL} testId="link-cloudflare-api-tokens-fallback">Open Cloudflare → API Tokens</OutLink></p>
      </Step>
      <Step n={2} title="Create Token → Custom token → Get started" />
      <Step n={3} title="Add three permissions">
        <p>Under Permissions choose <b className="g-text font-medium">Zone</b> each time and add: <b className="g-text font-medium">Zone — Read</b>, <b className="g-text font-medium">Analytics — Read</b> and <b className="g-text font-medium">Zone WAF — Edit</b>.</p>
      </Step>
      <Step n={4} title="Limit it to your sites">
        <p>Under Zone Resources choose <b className="g-text font-medium">Include → Specific zone</b> and pick each client site.</p>
      </Step>
      <Step n={5} title="Continue to summary → Create Token, then copy the token">
        <p>Cloudflare shows the token only once. Paste it below and choose <b className="g-text font-medium">Connect scoped token</b>.</p>
      </Step>
    </ol>
  );
}

/** Step by step: connect the Google account that can see the Search Console property. */
export function SearchConsoleConnectSteps({ open }: { open: boolean }) {
  return (
    <Shell title="First time? How to connect Google Search Console" open={open} testId="gsc-connect-steps">
      <ol className="space-y-3">
        <Step n={1} title="Know which Google account has the site">
          <p>You need the Google account that can already see the website in Search Console (an owner or a full user of the property). Not sure? Open Search Console and check which account lists your site.</p>
          <p className="pt-1"><OutLink href={SEARCH_CONSOLE_URL} testId="link-search-console">Open Google Search Console</OutLink></p>
        </Step>
        <Step n={2} title="Choose “Connect Google Search Console” below">
          <p>ConstructHUB may first ask you to confirm it is you. Then Google's own sign-in page opens.</p>
        </Step>
        <Step n={3} title="Pick that Google account and allow access">
          <p>Google lists what is being asked for: your email address and Search Console. Tick the Search Console box if Google shows one, then choose Continue or Allow.</p>
        </Step>
        <Step n={4} title="You come back here automatically">
          <p>The account appears under Connections and its properties are imported for you. They show under the <b className="g-text font-medium">Sites</b> tab within a minute or two; <b className="g-text font-medium">Work queue</b> shows the import finishing.</p>
        </Step>
      </ol>
      <div className="flex gap-2 text-[13px] leading-5 g-text-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" style={{ color: "var(--g-green)" }} />
        <p>
          <b className="g-text font-medium">What you are allowing:</b> Search Console only. This connection is kept separate from Google Business
          Profile and Calendar, and you can remove it here with Disconnect or in your Google account under Security → third-party access.
        </p>
      </div>
    </Shell>
  );
}
