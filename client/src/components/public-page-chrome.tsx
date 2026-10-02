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
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import { copyrightNotice } from "@/lib/marketing";

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
export function PublicPageHeader({ next, cart = false }: { next: string; cart?: boolean }) {
  const [location] = useLocation();
  if (!useSignedOut()) return null;
  return (
    <header
      className={`mkt-editorial bg-mkt-navy border-b-[3px] border-mkt-orange${cart ? " sticky top-0 z-40" : ""}`}
      data-testid="header-public-page"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
        <Link href="/" onClick={startAtTop} aria-label="ConstructHUB home" data-testid="link-public-home">
          <CHLogo height={32} />
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {location !== "/features" && (
            <Link href="/features" onClick={startAtTop} className="hidden sm:inline px-3 py-1.5 rounded-md font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors" data-testid="link-public-features">
              Features
            </Link>
          )}
          {location !== "/pricing" && (
            <Link href="/pricing" onClick={startAtTop} className="hidden sm:inline px-3 py-1.5 rounded-md font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors" data-testid="link-public-pricing">
              Pricing
            </Link>
          )}
          {cart && <div className="text-white"><CartSheet /></div>}
          <Link href={`/auth?next=${encodeURIComponent(next)}`} onClick={startAtTop} className="inline-flex items-center h-9 px-4 rounded-lg bg-mkt-orange hover:bg-mkt-orange-hover text-white font-semibold transition-colors" data-testid="link-public-signin">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicPageFooter() {
  if (!useSignedOut()) return null;
  return (
    <footer className="mkt-editorial bg-mkt-navy text-mkt-navy-muted border-t border-mkt-navy-rule py-8 px-4 text-center text-[13px]" data-testid="footer-public-page">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors">Home</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/features" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-features">Features</Link>
        <span aria-hidden className="opacity-40">·</span>
        <Link href="/call-assistant" onClick={startAtTop} className="hover:text-mkt-navy-ink transition-colors" data-testid="link-public-footer-call-assistant">AI Call Assistant</Link>
        <span aria-hidden className="opacity-40">·</span>
        <a href="mailto:support@constructhub.us" className="hover:text-mkt-navy-ink transition-colors">support@constructhub.us</a>
        <span aria-hidden className="opacity-40">·</span>
        <a href="/terms" className="hover:text-mkt-navy-ink transition-colors">Terms</a>
        <span aria-hidden className="opacity-40">·</span>
        <a href="/privacy" className="hover:text-mkt-navy-ink transition-colors">Privacy</a>
      </div>
      <p className="mt-2">{copyrightNotice()}</p>
    </footer>
  );
}
