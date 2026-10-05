/**
 * The marketing site's one menu bar ("the ribbon"): the same links on the home
 * page, /features and every feature page, /call-assistant, /pricing and the
 * other public pages (owner, 2026-10-02: "make sure every page keeps the menu
 * details in the ribbon").
 *
 *   Features ▾      a dropdown of every feature page, grouped like the
 *                   dashboard, read from the feature catalogue
 *                   (shared/feature-pages) — never a hand-typed list, so a new
 *                   page shows up here by itself.
 *   Done-For-You ▾  a dropdown of every done-for-you service page, read from
 *                   the done-for-you catalogue (shared/dfy-pages), plus "See
 *                   all services" (/done-for-you).
 *   Plans · Results · Coverage   sections of the home page; on the home page
 *                   they jump, elsewhere they go to "/#section".
 *
 * Desktop (1024px and up) uses one Radix navigation menu for both dropdowns
 * (hover or click, arrow keys between them, Escape); phones and tablets get the
 * same links, with the features and the services as fold-out groups, in the
 * slide-over menu (SiteMobileMenu).
 *
 * Radix mounts a dropdown's panel only while it is open, so the bar also
 * carries every dropdown link as a plain, never-shown list (NavDirectory): the
 * HTML a search engine reads, prerendered or booted, holds the whole menu.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
import { ArrowRight, ChevronDown, LayoutDashboard, Menu } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { inNativeApp } from "@/lib/app-shell";
import { CartSheet } from "@/components/cart-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { FEATURE_ICON_COMPONENTS } from "@/components/feature-landing/icons";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import { FEATURES_PATH, FEATURE_CATALOGUE, FEATURE_GROUPS, type FeatureCatalogueEntry } from "@shared/feature-pages";
import { DFY_CATALOGUE, DFY_PATH, type DfyCatalogueEntry } from "@shared/dfy-pages";

const FLAGS: Record<NonNullable<FeatureCatalogueEntry["flag"]>, boolean> = { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS };
const visible = (e: FeatureCatalogueEntry) => !e.flag || FLAGS[e.flag];

/** The feature groups with their entries, in catalogue order (empty groups dropped). */
export const NAV_FEATURE_GROUPS = FEATURE_GROUPS
  .map((g) => ({ ...g, entries: FEATURE_CATALOGUE.filter((e) => e.group === g.key && visible(e)) }))
  .filter((g) => g.entries.length > 0);

/** The home page's sections, in the order the page shows them (Done-For-You is its own dropdown now). */
const SECTIONS = [
  { id: "plans", label: "Plans" },
  { id: "stats", label: "Results" },
  { id: "coverage", label: "Coverage" },
] as const;

/** "/done-for-you/business-formation" → "business-formation", "/reinstatement" → "reinstatement". */
const lastSegment = (path: string) => path.split("/").pop() ?? "";

const isHome = (location: string) => location === "/" || location === "/landing";

/** Start a page at its top (the bar is clicked from far down a page). */
const toTop = () => { try { window.scrollTo({ top: 0 }); } catch { /* cosmetic */ } };

/** A home-page section: a smooth jump on the home page, "/#id" anywhere else. */
function SectionLink({ id, label, className, onDone, testid }: { id: string; label: string; className: string; onDone?: () => void; testid: string }) {
  const [location] = useLocation();
  if (isHome(location)) {
    return (
      <a
        href={`#${id}`}
        className={className}
        data-testid={testid}
        onClick={(e) => {
          e.preventDefault();
          onDone?.();
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          try { window.history.replaceState(window.history.state, "", `#${id}`); } catch { /* cosmetic */ }
        }}
      >
        {label}
      </a>
    );
  }
  return <a href={`/#${id}`} className={className} data-testid={testid} onClick={onDone}>{label}</a>;
}

function FeatureItem({ entry, onPick }: { entry: FeatureCatalogueEntry; onPick?: () => void }) {
  const Icon = entry.icon ? FEATURE_ICON_COMPONENTS[entry.icon] : null;
  return (
    <NavigationMenuPrimitive.Link asChild>
      <Link
        href={entry.path}
        onClick={() => { toTop(); onPick?.(); }}
        title={entry.lede}
        className="group/item flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-mkt-paper-2 focus-visible:bg-mkt-paper-2 focus-visible:outline-none transition-colors"
        data-testid={`nav-item-${lastSegment(entry.path)}`}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-mkt-rule bg-mkt-card text-mkt-orange-ink">
          {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[14px] font-semibold text-mkt-ink group-hover/item:text-mkt-orange-ink">
            {entry.title}
            {entry.status === "external" && (
              <span className="rounded-full bg-mkt-orange px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">New</span>
            )}
          </span>
        </span>
      </Link>
    </NavigationMenuPrimitive.Link>
  );
}

/** One service in the Done-For-You panel: icon, name and its short line (the full summary is its title tooltip). */
function ServiceItem({ entry }: { entry: DfyCatalogueEntry }) {
  const Icon = FEATURE_ICON_COMPONENTS[entry.icon];
  return (
    <NavigationMenuPrimitive.Link asChild>
      <Link
        href={entry.path}
        onClick={toTop}
        className="group/item flex items-start gap-3 rounded-lg px-2.5 py-2 hover:bg-mkt-paper-2 focus-visible:bg-mkt-paper-2 focus-visible:outline-none transition-colors"
        title={entry.lede}
        data-testid={`nav-item-dfy-${lastSegment(entry.path)}`}
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-mkt-rule bg-mkt-card text-mkt-orange-ink">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-mkt-ink group-hover/item:text-mkt-orange-ink">{entry.title}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-mkt-muted">{entry.blurb}</span>
        </span>
      </Link>
    </NavigationMenuPrimitive.Link>
  );
}

const TRIGGER = "group inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-white/75 hover:text-white data-[state=open]:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange transition-colors";
const CHEVRON = "h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180";
const ALL_BUTTON = "inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-mkt-orange px-4 h-9 text-sm font-semibold text-white hover:bg-mkt-orange-hover transition-colors";

/**
 * Desktop: "Features ▾" (every feature page in a three-column panel) and
 * "Done-For-You ▾" (every service), one Radix menu so they share the panel and
 * the keyboard moves between them.
 */
function SiteDropdowns() {
  return (
    <NavigationMenuPrimitive.Root className="static" delayDuration={80}>
      <NavigationMenuPrimitive.List className="flex items-center gap-3">
        <NavigationMenuPrimitive.Item value="features">
          <NavigationMenuPrimitive.Trigger className={TRIGGER} data-testid="nav-dropdown-features">
            Features
            <ChevronDown className={CHEVRON} aria-hidden="true" />
          </NavigationMenuPrimitive.Trigger>
          <NavigationMenuPrimitive.Content className="absolute left-0 top-0 w-[min(980px,calc(100vw-2rem))] p-5" data-testid="nav-panel-features">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              {NAV_FEATURE_GROUPS.map((g) => (
                <div key={g.key}>
                  <p className="px-2.5 mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-mkt-orange-ink">{g.label}</p>
                  <div className="space-y-0.5">
                    {g.entries.map((e) => <FeatureItem key={e.key} entry={e} />)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-mkt-rule pt-4">
              <p className="text-[13px] text-mkt-muted">Every page explains the feature, what it costs and which plan includes it.</p>
              <NavigationMenuPrimitive.Link asChild>
                <Link href={FEATURES_PATH} onClick={toTop} className={ALL_BUTTON} data-testid="nav-features-all">
                  See every feature <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </NavigationMenuPrimitive.Link>
            </div>
          </NavigationMenuPrimitive.Content>
        </NavigationMenuPrimitive.Item>
        <NavigationMenuPrimitive.Item value="done-for-you">
          <NavigationMenuPrimitive.Trigger className={TRIGGER} data-testid="nav-dropdown-dfy">
            Done-For-You
            <ChevronDown className={CHEVRON} aria-hidden="true" />
          </NavigationMenuPrimitive.Trigger>
          <NavigationMenuPrimitive.Content className="absolute left-0 top-0 w-[min(720px,calc(100vw-2rem))] p-5" data-testid="nav-panel-dfy">
            <p className="px-2.5 mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-mkt-orange-ink">Done-for-you services</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {DFY_CATALOGUE.map((e) => <ServiceItem key={e.key} entry={e} />)}
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-mkt-rule pt-4">
              <p className="text-[13px] text-mkt-muted">Work our team does for you, scoped with a sales rep before you commit.</p>
              <NavigationMenuPrimitive.Link asChild>
                <Link href={DFY_PATH} onClick={toTop} className={ALL_BUTTON} data-testid="nav-dfy-all">
                  See all services <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </NavigationMenuPrimitive.Link>
            </div>
          </NavigationMenuPrimitive.Content>
        </NavigationMenuPrimitive.Item>
      </NavigationMenuPrimitive.List>
      {/* The panel hangs under the bar, centred on it, as wide as the open dropdown. */}
      <div className="absolute left-1/2 top-full -translate-x-1/2 pt-1 z-50">
        <NavigationMenuPrimitive.Viewport
          className="relative w-[var(--radix-navigation-menu-viewport-width)] h-[var(--radix-navigation-menu-viewport-height)] overflow-hidden rounded-2xl border border-mkt-rule bg-mkt-card text-mkt-ink shadow-2xl shadow-black/20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in"
        />
      </div>
    </NavigationMenuPrimitive.Root>
  );
}

/**
 * Every link in the two dropdowns, as plain links that are never shown (display:
 * none, so not focusable and not read out twice): the dropdown panels exist only
 * while open, and this keeps the menu's links in every page's HTML for search
 * engines. The same entries, from the same catalogues, as the panels.
 */
function NavDirectory() {
  return (
    <div className="hidden" data-testid="nav-directory">
      <ul>
        <li><a href={FEATURES_PATH}>Features</a>
          <ul>
            {NAV_FEATURE_GROUPS.flatMap((g) => g.entries).map((e) => (
              <li key={e.key}><a href={e.path} data-testid={`nav-directory-item-${lastSegment(e.path)}`}>{e.title}</a></li>
            ))}
          </ul>
        </li>
        <li><a href={DFY_PATH}>Done-For-You</a>
          <ul>
            {DFY_CATALOGUE.map((e) => (
              <li key={e.key}><a href={e.path} data-testid={`nav-directory-item-dfy-${lastSegment(e.path)}`}>{e.title}</a></li>
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}

/** Phones and tablets: the same bar in a slide-over, the features and the services as fold-out groups. */
function SiteMobileMenu({ signedIn, signInHref }: { signedIn: boolean; signInHref: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const row = "block rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted transition-colors";
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center rounded-md h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Open menu"
          data-testid="button-landing-menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 max-w-[88vw] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Every feature, every done-for-you service, and plans.</SheetDescription>
        </SheetHeader>
        <nav className="mt-4" aria-label="Menu">
          <Accordion type="single" collapsible defaultValue="features">
            <AccordionItem value="features" className="border-b-0">
              <AccordionTrigger className="px-3 py-2.5 text-base font-semibold hover:no-underline" data-testid="mobile-nav-features">Features</AccordionTrigger>
              <AccordionContent>
                <Accordion type="multiple" className="pl-2">
                  {NAV_FEATURE_GROUPS.map((g) => (
                    <AccordionItem key={g.key} value={g.key} className="border-b-0">
                      <AccordionTrigger className="px-3 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline" data-testid={`mobile-nav-group-${g.key}`}>
                        {g.label}
                      </AccordionTrigger>
                      <AccordionContent className="pb-1">
                        {g.entries.map((e) => (
                          <Link key={e.key} href={e.path} onClick={() => { toTop(); close(); }} className="block rounded-md px-4 py-2 text-[15px] hover:bg-muted" data-testid={`mobile-nav-item-${lastSegment(e.path)}`}>
                            {e.title}
                          </Link>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
                <Link href={FEATURES_PATH} onClick={() => { toTop(); close(); }} className="mt-1 block rounded-md px-5 py-2 text-[15px] font-semibold text-[#AE4A04] dark:text-[#F97316] hover:bg-muted" data-testid="mobile-nav-features-all">
                  See every feature →
                </Link>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="done-for-you" className="border-b-0">
              <AccordionTrigger className="px-3 py-2.5 text-base font-semibold hover:no-underline" data-testid="mobile-nav-dfy">Done-For-You</AccordionTrigger>
              <AccordionContent className="pb-1">
                {DFY_CATALOGUE.map((e) => (
                  <Link key={e.key} href={e.path} onClick={() => { toTop(); close(); }} className="block rounded-md px-5 py-2 text-[15px] hover:bg-muted" data-testid={`mobile-nav-item-dfy-${lastSegment(e.path)}`}>
                    {e.title}
                  </Link>
                ))}
                <Link href={DFY_PATH} onClick={() => { toTop(); close(); }} className="mt-1 block rounded-md px-5 py-2 text-[15px] font-semibold text-[#AE4A04] dark:text-[#F97316] hover:bg-muted" data-testid="mobile-nav-dfy-all">
                  See all services →
                </Link>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          {SECTIONS.map((s) => (
            <SectionLink key={s.id} id={s.id} label={s.label} className={row} onDone={close} testid={`link-mobile-nav-${s.id}`} />
          ))}
          <Link href="/pricing" onClick={() => { toTop(); close(); }} className={row} data-testid="link-mobile-nav-pricing">Pricing</Link>
        </nav>
        <div className="mt-4 border-t pt-4 space-y-2">
          {!signedIn && (
            <Link href={signInHref} onClick={close} className={row} data-testid="link-mobile-signin">Sign In</Link>
          )}
          <div className="px-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The bar's contents (logo · links · actions), for a navy masthead. The caller
 * owns the wrapper (the home page hides it on scroll; other pages pin it).
 */
export function SiteNavBar({ signedIn, next = "/", cart = true }: { signedIn: boolean; next?: string; cart?: boolean }) {
  // Inside the iPhone apps the bar is the logo alone: no features, plans, pricing, cart, services or sign-up
  // pitch (the apps sell nothing — App Store 3.1.3(f), docs/app/APP-STORE-PLAN.md). Signed out, the app only
  // shows the sign-in screen and the legal/support pages, and the logo leads back to sign-in.
  if (inNativeApp()) {
    return (
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-center" data-testid="site-nav-app">
        <Link href="/auth" aria-label="Sign in to ConstructHUB" data-testid="link-app-home"><CHLogo height={38} /></Link>
      </div>
    );
  }
  const signInHref = next && next !== "/" ? `/auth?next=${encodeURIComponent(next)}` : "/auth";
  const link = "whitespace-nowrap rounded-md px-2 py-1.5 text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange transition-colors";
  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
      <Link href="/" onClick={toTop} aria-label="ConstructHUB home" className="shrink-0" data-testid="link-public-home">
        <CHLogo height={38} />
      </Link>
      <div className="hidden lg:flex items-center gap-3 text-[15px] font-medium" data-testid="site-nav-links">
        <SiteDropdowns />
        {SECTIONS.map((s) => (
          <SectionLink key={s.id} id={s.id} label={s.label} className={link} testid={`link-nav-${s.id}`} />
        ))}
      </div>
      <NavDirectory />
      <div className="flex items-center gap-1 lg:gap-3">
        {cart && <div className="text-white"><CartSheet /></div>}
        <div className="text-white hidden sm:block"><ThemeToggle /></div>
        {signedIn ? (
          <Link href="/" data-testid="link-nav-dashboard" className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-mkt-orange text-white text-sm font-semibold hover:bg-mkt-orange-hover transition-colors">
            <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
          </Link>
        ) : (
          <>
            <Link href={signInHref} onClick={toTop} className="hidden sm:inline-flex items-center whitespace-nowrap h-9 px-3 rounded-md text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors" data-testid="link-nav-signin">
              Sign In
            </Link>
            <Link href="/auth?mode=signup" onClick={toTop} data-testid="link-nav-getstarted" className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-mkt-orange text-white text-sm font-semibold hover:bg-mkt-orange-hover transition-colors whitespace-nowrap">
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </>
        )}
        <SiteMobileMenu signedIn={signedIn} signInHref={signInHref} />
      </div>
    </div>
  );
}
