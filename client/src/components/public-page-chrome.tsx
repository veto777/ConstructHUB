/**
 * Minimal header + footer for marketing-site pages a signed-out visitor can
 * land on directly (/reinstatement, /crm-app, /pricing, /master-class). Signed
 * in, those pages render inside the dashboard frame, which already has
 * navigation and the cart — so this renders nothing unless the visitor is
 * signed out.
 *
 * Styled to match the landing page ("Bold trades": navy band, orange accent,
 * Barlow Condensed labels, DM Sans body) via the `mk` root class in index.css.
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
      className={`mk mk-navy border-b border-white/10${cart ? " sticky top-0 z-40" : ""}`}
      data-testid="header-public-page"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <Link href="/" onClick={startAtTop} aria-label="ConstructHUB home" data-testid="link-public-home">
          <CHLogo height={36} />
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          {location !== "/pricing" && (
            <Link href="/pricing" onClick={startAtTop} className="hidden sm:inline-flex mk-navlink px-3 py-2 text-white/80 hover:text-white transition-colors" data-testid="link-public-pricing">
              Pricing
            </Link>
          )}
          {cart && <div className="text-white"><CartSheet /></div>}
          <Link href={`/auth?next=${encodeURIComponent(next)}`} onClick={startAtTop} className="mk-btn mk-btn-primary mk-btn-sm" data-testid="link-public-signin">
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
    <footer className="mk !bg-transparent border-t mk-rule py-8 px-4 text-center text-xs mk-muted" data-testid="footer-public-page">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-display font-semibold uppercase tracking-[0.12em] text-[13px]">
        <Link href="/" onClick={startAtTop} className="hover:text-[#F97316] transition-colors">Home</Link>
        <span aria-hidden className="text-[#F97316]">&middot;</span>
        <a href="mailto:support@constructhub.us" className="hover:text-[#F97316] transition-colors normal-case tracking-normal font-sans font-medium">support@constructhub.us</a>
        <span aria-hidden className="text-[#F97316]">&middot;</span>
        <a href="/terms" className="hover:text-[#F97316] transition-colors">Terms</a>
        <span aria-hidden className="text-[#F97316]">&middot;</span>
        <a href="/privacy" className="hover:text-[#F97316] transition-colors">Privacy</a>
      </div>
      <p className="mt-3">{copyrightNotice()}</p>
    </footer>
  );
}
