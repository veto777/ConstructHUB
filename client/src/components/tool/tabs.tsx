/**
 * Tabs of the tool layer (styles: client/src/styles/tool.css).
 *
 *   <ToolTabs label="Sections">…links or buttons…</ToolTabs>     a section's tabs: a bar, the active tab marked by an
 *                                                                orange indicator. Sticks to the top of the page's
 *                                                                scroll area. `tone="dark"` is the navy tool bar.
 *   <SegmentedTabs label="Which alerts">…</SegmentedTabs>        a view switch inside a page: joined rectangles.
 *   <ToolTabsList>/<SegmentedTabsList>                           the same two looks around Radix <TabsTrigger>s
 *                                                                (inside a shadcn <Tabs>).
 *
 * A tab is any direct <a>/<button> child. It reads as active when it carries aria-current="page" (route links),
 * aria-selected="true" / data-state="active" (tabs) or aria-pressed="true" (toggle buttons) — the component adds no
 * state of its own, so existing markup, roles and data-testids stay exactly as they were.
 *
 * Behaviour (both looks): never wraps — the row scrolls sideways with an edge fade and, on a mouse, chevron buttons;
 * the active tab is brought into view on load and whenever it changes; ← → Home End move between tabs (Radix lists
 * bring their own); a visible focus ring.
 */
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementRef, type KeyboardEvent, type ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "bar" | "segmented";
type Tone = "light" | "dark";

const ITEMS = ":scope > a, :scope > button";
const ACTIVE = '[aria-current="page"], [aria-selected="true"], [data-state="active"], [aria-pressed="true"]';

/** The tabs of a list, in order, skipping disabled ones. */
export const tabItems = (list: Element) => Array.from(list.querySelectorAll<HTMLElement>(ITEMS)).filter((el) => !el.hasAttribute("disabled"));

/** Which tab ← → Home End lands on (wraps at both ends); null when the key is not one of them. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The nearest ancestor that scrolls up and down — what a sticky tab bar sticks inside. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

function Scroller({ variant, tone = "light", sticky, bleed, roving, className, testId, children }: {
  variant: Variant; tone?: Tone; sticky: boolean; bleed: boolean;
  /** ← → Home End handled here (plain links and buttons). Off for Radix lists, which handle them. */
  roving: boolean;
  className?: string; testId?: string; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const [stuck, setStuck] = useState(false);

  const measure = useCallback(() => {
    const el = scroll.current;
    if (!el) return;
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  /** Brings the active tab fully into view, sideways only (never moves the page). */
  const reveal = useCallback((smooth: boolean) => {
    const el = scroll.current;
    const active = el?.querySelector<HTMLElement>(`.tool-tabs__list > :is(${ACTIVE})`);
    if (!el || !active) return;
    const pad = 48; // clear of the edge fade
    const box = el.getBoundingClientRect(), a = active.getBoundingClientRect();
    let to = el.scrollLeft;
    if (a.left < box.left + pad) to -= box.left + pad - a.left;
    else if (a.right > box.right - pad) to += a.right - (box.right - pad);
    to = Math.max(0, Math.min(to, el.scrollWidth - el.clientWidth));
    if (Math.abs(to - el.scrollLeft) > 1) el.scrollTo({ left: to, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // On load: active tab in view before paint. Afterwards: whenever the active tab changes (a route change re-renders
  // the links; a Radix tab flips data-state) or the tabs themselves change.
  useLayoutEffect(() => { reveal(false); measure(); }, [reveal, measure]);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const mo = new MutationObserver(() => { reveal(true); measure(); });
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current", "aria-selected", "data-state", "aria-pressed"] });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { mo.disconnect(); ro?.disconnect(); };
  }, [reveal, measure]);

  // "Stuck" = the bar has reached the top of its scroll area while the page is scrolled. Drives the shadow only.
  useEffect(() => {
    if (!sticky) return;
    const el = root.current, parent = scrollParent(el);
    if (!el || !parent) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const on = parent.scrollTop > 0 && el.getBoundingClientRect().top - parent.getBoundingClientRect().top < 1;
      setStuck((s) => (s === on ? s : on));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    parent.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => { parent.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [sticky]);

  const nudge = (dir: -1 | 1) => {
    const el = scroll.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!roving || e.altKey || e.ctrlKey || e.metaKey) return;
    const list = scroll.current?.querySelector(".tool-tabs__list");
    if (!list) return;
    const items = tabItems(list);
    const at = items.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const to = nextTabIndex(e.key, at, items.length);
    if (to == null) return;
    e.preventDefault();
    items[to].focus({ preventScroll: true });
    // Focus alone does not scroll a sideways row reliably; bring the focused tab in.
    const el = scroll.current!, box = el.getBoundingClientRect(), t = items[to].getBoundingClientRect();
    if (t.left < box.left + 48) el.scrollBy({ left: t.left - box.left - 48 });
    else if (t.right > box.right - 48) el.scrollBy({ left: t.right - box.right + 48 });
  };

  return (
    <div ref={root} className={cn("tool-tabs", className)} data-variant={variant} data-tone={tone === "dark" ? "dark" : undefined} data-sticky={sticky || undefined} data-stuck={stuck || undefined}
      data-bleed={bleed || undefined} data-testid={testId}>
      <button type="button" className="tool-tabs__nudge tool-tabs__nudge--left" data-show={more.left || undefined} tabIndex={-1} aria-hidden="true" onClick={() => nudge(-1)}><ChevronLeft /></button>
      <div ref={scroll} className="tool-tabs__scroll" onScroll={measure} onKeyDown={onKeyDown}>{children}</div>
      <button type="button" className="tool-tabs__nudge tool-tabs__nudge--right" data-show={more.right || undefined} tabIndex={-1} aria-hidden="true" onClick={() => nudge(1)}><ChevronRight /></button>
    </div>
  );
}

type StripProps = {
  /** What these tabs are, for screen readers ("SEO sections"). */
  label: string;
  children: ReactNode;
  /** `nav` for route links (mark the current one aria-current="page"); `tablist` for in-page tabs (children carry
   *  role="tab" + aria-selected); `group` for toggle buttons (aria-pressed). */
  as?: "nav" | "tablist" | "group";
  className?: string;
  testId?: string;
};

function List({ as = "nav", label, children }: Pick<StripProps, "as" | "label" | "children">) {
  if (as === "nav") return <nav className="tool-tabs__list" aria-label={label}>{children}</nav>;
  return <div className="tool-tabs__list" role={as === "tablist" ? "tablist" : "group"} aria-label={label}>{children}</div>;
}

/** A section's tabs. Sticky unless `sticky={false}`; `bleed={false}` where the parent has no 16px phone gutter. */
export function ToolTabs({ sticky = true, bleed = true, tone, className, testId, ...list }: StripProps & { sticky?: boolean; bleed?: boolean; tone?: Tone }) {
  return <Scroller variant="bar" tone={tone} sticky={sticky} bleed={bleed} roving className={className} testId={testId}><List {...list} /></Scroller>;
}

/** A view switch or filter inside a page. Never sticky. */
export function SegmentedTabs({ className, testId, ...list }: StripProps) {
  return <Scroller variant="segmented" sticky={false} bleed={false} roving className={className} testId={testId}><List {...list} /></Scroller>;
}

/** A count or badge inside a tab ("Alerts 3"). */
export function TabCount({ children, label, testId }: { children: ReactNode; label?: string; testId?: string }) {
  return <span className="tool-tabs__count" aria-label={label} data-testid={testId}>{children}</span>;
}

type RadixListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { sticky?: boolean; bleed?: boolean; wrapClassName?: string };

/** A section's tabs for a shadcn <Tabs>: drop-in for <TabsList> around <TabsTrigger>s. */
export const ToolTabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, RadixListProps>(
  ({ sticky = true, bleed = true, className, wrapClassName, ...props }, ref) => (
    <Scroller variant="bar" sticky={sticky} bleed={bleed} roving={false} className={wrapClassName}>
      <TabsPrimitive.List ref={ref} className={cn("tool-tabs__list", className)} {...props} />
    </Scroller>
  ));
ToolTabsList.displayName = "ToolTabsList";

/** A view switch for a shadcn <Tabs>. */
export const SegmentedTabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, Omit<RadixListProps, "sticky" | "bleed">>(
  ({ className, wrapClassName, ...props }, ref) => (
    <Scroller variant="segmented" sticky={false} bleed={false} roving={false} className={wrapClassName}>
      <TabsPrimitive.List ref={ref} className={cn("tool-tabs__list", className)} {...props} />
    </Scroller>
  ));
SegmentedTabsList.displayName = "SegmentedTabsList";
