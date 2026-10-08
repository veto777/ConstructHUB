/**
 * Minimal header + footer for marketing-site pages a signed-out visitor can
 * land on directly (/reinstatement, /crm-app, /pricing, /master-class,
 * /call-assistant, /features and every /features/<slug>). Signed
 * in, those pages render inside the dashboard frame, which already has
 * navigation and the cart — so this renders nothing unless the visitor is
 * signed out.
 *
 * Styled to match the landing page's editorial chrome: a navy masthead with
 * an orange rule, the orange sign-in button, and the marketing type (the
 * `mkt-editorial` scope in client/src/index.css — Plus Jakarta Sans here,
 * Inter everywhere else in the app).
 */
import { inNativeApp } from "@/lib/app-shell";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SiteNavBar } from "@/components/site-nav";
import { copyrightNotice } from "@/lib/marketing";
import { reportIssueHref } from "@/lib/report-issue-link";
import { SocialLinks } from "@/components/social-links";

function useSignedOut(): boolean {
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  return !isLoading && !user;
}

/** Signed out, the window scrolls every page, and an in-app link keeps the
 *  offset it was clicked at: the pinned header and the footer are clicked from
 *  far down the page, and the next page would open that far down too. Their
 *  links start the next page at its top. */
const startAtTop = () => window.scrollTo(0, 0);

/**
 * `cart`: the page sells things (Add to Cart buttons). The header then carries
 * the cart and stays pinned to the top of the window, so the cart is in reach
 * from every Add to Cart button however far down the page it sits. Render it
 * outside the page's own `overflow-y-auto` wrapper, or it cannot stick.
 */
export function PublicPageHeader({ next, cart = false, backWhenSignedIn = false }: { next: string; cart?: boolean; backWhenSignedIn?: boolean }) {
  const signedOut = useSignedOut();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  // The free Site Scan pages render outside the platform shell: a signed-in visitor gets a way back (audit lane 6).
  if (!signedOut && backWhenSignedIn && user) {
    return (
      <header className="app-status-pad box-content sticky top-0 z-40 flex h-12 items-center border-b bg-background px-4" data-testid="header-signed-in-back">
        <a href="/" className="text-sm font-medium text-primary hover:underline" data-testid="link-back-to-app">← Back to ConstructHUB</a>
      </header>
    );
  }
  if (!signedOut) return null;
  // The same ribbon as the home page (components/site-nav.tsx): Features ▾, the
  // home page's sections, sign in / get started. Pinned to the top on every page.
  return (
    // .app-status-pad: inside the iPhone apps the header clears the status bar (client/src/index.css).
    <header className="app-status-pad mkt-editorial sticky top-0 z-40 bg-mkt-navy border-b-[3px] border-mkt-orange" data-testid="header-public-page">
      <SiteNavBar signedIn={false} next={next} cart={cart} />
    </header>
  );
}

/**
 * The free guides and reports (in the sitemap, but in neither dropdown): linked
 * from every public footer so no marketing page is left without links to it.
 */
export const FOOTER_GUIDES = [
  { href: "/google-ads-guide", label: "Google Ads Guide", testId: "google-ads-guide" },
  { href: "/lsa-guide", label: "LSA Guide", testId: "lsa-guide" },
  { href: "/google-ad-fraud", label: "Click Fraud: What We Observed", testId: "google-ad-fraud" },
  { href: "/google-business", label: "Google Business Profile Tools", testId: "google-business" },
] as const;

export function FooterGuides({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 ${className}`} data-testid="footer-guides">
      {FOOTER_GUIDES.map((g, i) => (
        <span key={g.href} className="inline-flex items-center gap-x-3">
          {i > 0 && <span aria-hidden className="opacity-40">·</span>}
          <Link href={g.href} onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid={`link-footer-guide-${g.testId}`}>{g.label}</Link>
        </span>
      ))}
    </div>
  );
}

export function PublicPageFooter() {
  if (!useSignedOut()) return null;
  // Inside the iPhone apps: support and the legal pages only — no sales pages (the apps sell nothing, 3.1.3(f)).
  if (inNativeApp()) {
    return (
      <footer className="mkt-editorial bg-mkt-navy text-mkt-navy-muted border-t border-mkt-navy-rule pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] px-4 text-center text-[13px]" data-testid="footer-public-page-app">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a href="mailto:support@constructhub.us" className="hover:text-mkt-navy-ink transition-colors">support@constructhub.us</a>
          <span aria-hidden className="opacity-40">·</span>
          <a href="/support" className="hover:text-mkt-navy-ink transition-colors">Support</a>
          <span aria-hidden className="opacity-40">·</span>
          {/* Help and the report page sell nothing, so they stay inside the apps too. */}
          <Link href="/tutorials" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-help">Help</Link>
          <span aria-hidden className="opacity-40">·</span>
          <Link href={reportIssueHref()} onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-report-issue">Report an issue</Link>
          <span aria-hidden className="opacity-40">·</span>
          <a href="/terms" className="hover:text-mkt-navy-ink transition-colors">Terms</a>
          <span aria-hidden className="opacity-40">·</span>
          <a href="/privacy" className="hover:text-mkt-navy-ink transition-colors">Privacy</a>
        </div>
        <SocialLinks tone="navy" className="mt-3" testId="social-public-footer" />
        <p className="mt-2">{copyrightNotice()}</p>
      </footer>
    );
  }
  return (
    <footer className="mkt-editorial bg-mkt-navy text-mkt-navy-muted border-t border-mkt-navy-rule pt-8 pb-24 sm:pb-8 px-4 text-center text-[13px]" data-testid="footer-public-page">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors">Home</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/features" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-features">Features</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/done-for-you" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-dfy">Done-For-You</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/call-assistant" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-call-assistant">AI Call Assistant</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/tutorials" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-help">Help</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href={reportIssueHref()} onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-report-issue">Report an issue</Link>
        <span aria-hidden className="opacity-40">·</span>
        <a href="mailto:support@constructhub.us" className="hover:text-mkt-navy-ink transition-colors">support@constructhub.us</a>
        <span aria-hidden className="opacity-40">·</span>
        <a href="/terms" className="hover:text-mkt-navy-ink transition-colors">Terms</a>
        <span aria-hidden className="opacity-40">·</span>
        <a href="/privacy" className="hover:text-mkt-navy-ink transition-colors">Privacy</a>
      </div>
      <FooterGuides className="mt-2" />
      <SocialLinks tone="navy" className="mt-3" testId="social-public-footer" />
      <p className="mt-2">{copyrightNotice()}</p>
    </footer>
  );
}
