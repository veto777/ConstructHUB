/**
 * The marketing site's editorial building blocks (design B: Fraunces +
 * Plus Jakarta Sans on cream paper, navy grid panels, one orange — the
 * `mkt-editorial` scope in client/src/index.css). Extracted unchanged from the
 * /call-assistant page so the feature pages and that page share one source:
 * call-assistant-marketing.tsx re-exports these.
 */
import { useEffect } from "react";

/** Button recipes — anchors styled as buttons (same as landing.tsx). */
const BTN = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange focus-visible:ring-offset-2 focus-visible:ring-offset-mkt-paper";
export const BTN_PRIMARY = `${BTN} bg-mkt-orange text-white hover:bg-mkt-orange-hover`;
export const BTN_OUTLINE = `${BTN} border-2 border-mkt-ink text-mkt-ink hover:bg-mkt-ink hover:text-mkt-paper`;
export const BTN_OUTLINE_ON_NAVY = `${BTN} border-2 border-mkt-navy-ink text-mkt-navy-ink hover:bg-mkt-navy-ink hover:text-mkt-navy`;
export const BTN_LG = "h-12 px-6 text-base";
/** Hairlines on the navy panel. The --mkt-* colours take no Tailwind opacity modifier, so mix them. */
export const PANEL_RULE = "border-[color:color-mix(in_srgb,var(--mkt-panel-ink)_16%,transparent)]";
export const PANEL_RULE_STRONG = "border-[color:color-mix(in_srgb,var(--mkt-panel-ink)_42%,transparent)]";

/** Section H2 and lead paragraph, as on /call-assistant. */
export const H2 = "font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3.1rem] leading-[1.05] tracking-[-0.02em] mt-5";
export const LEAD = "text-[17px] text-mkt-ink-soft leading-relaxed";
/** An inline text link on paper. */
export const TEXT_LINK = "font-semibold text-mkt-orange-ink underline decoration-2 decoration-mkt-orange-soft underline-offset-4 hover:decoration-mkt-orange";

/** Section kicker: a short orange rule, an index (or a word) and small caps — as on the landing page. */
export function Kicker({ n, children, className = "" }: { n: string; children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-3 text-[11px] sm:text-[12px] font-semibold uppercase tracking-[0.14em] sm:tracking-[0.18em] text-mkt-orange-ink [text-wrap:balance] ${className}`}>
      <span className="hidden sm:block h-px w-8 bg-mkt-orange shrink-0" aria-hidden />
      {n && <span className="font-display italic normal-case tracking-normal text-[15px] text-mkt-muted">{n}</span>}
      <span>{children}</span>
    </p>
  );
}

/** The page's meta description in the browser (the server writes the same into the HTML). */
export function useMetaDescription(description: string) {
  useEffect(() => {
    const tag = document.querySelector('meta[name="description"]');
    const previous = tag?.getAttribute("content");
    tag?.setAttribute("content", description);
    return () => { if (tag && previous != null) tag.setAttribute("content", previous); };
  }, [description]);
}

/** The tab title while the page is open (App.tsx leaves /features/* to the page). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * Start a page at its top when it is entered by an in-app link. Signed out the
 * window scrolls; signed in the app frame's <main> does — and a SPA navigation
 * keeps either offset, so a card clicked far down /features would otherwise
 * open the next page far down too. A URL with a #fragment is left alone.
 */
export function useStartAtTop(key: string) {
  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo(0, 0);
    document.querySelector("main")?.scrollTo(0, 0);
  }, [key]);
}
