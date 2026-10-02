/**
 * The marketing site's one menu bar ("the ribbon"): the same links on the home
 * page, /features and every feature page, /call-assistant, /pricing and the
 * other public pages (owner, 2026-10-02: "make sure every page keeps the menu
 * details in the ribbon").
 *
 *   Features ▾   a dropdown of every feature page, grouped like the dashboard,
 *                read from the feature catalogue (shared/feature-pages) — never
 *                a hand-typed list, so a new page shows up here by itself.
 *   Done-For-You · Plans · Results · Coverage   sections of the home page;
 *                on the home page they jump, elsewhere they go to "/#section".
 *
 * Desktop uses the Radix navigation menu (hover or click, keyboard, Escape);
 * phones get the same links, with the features as fold-out groups, in the
 * slide-over menu (SiteMobileMenu).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
import { ArrowRight, ChevronDown, LayoutDashboard, Menu } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { CartSheet } from "@/components/cart-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { FEATURE_ICON_COMPONENTS } from "@/components/feature-landing/icons";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import { FEATURES_PATH, FEATURE_CATALOGUE, FEATURE_GROUPS, type FeatureCatalogueEntry } from "@shared/feature-pages";

const FLAGS: Record<NonNullable<FeatureCatalogueEntry["flag"]>, boolean> = { SHOW_COMPETITOR_INTEL, SHOW_GOOGLE_REVIEWS };
const visible = (e: FeatureCatalogueEntry) => !e.flag || FLAGS[e.flag];

/** The feature groups with their entries, in catalogue order (empty groups dropped). */
export const NAV_FEATURE_GROUPS = FEATURE_GROUPS
  .map((g) => ({ ...g, entries: FEATURE_CATALOGUE.filter((e) => e.group === g.key && visible(e)) }))
  .filter((g) => g.entries.length > 0);

/** The home page's sections, in the order the page shows them. */
const SECTIONS = [
  { id: "done-for-you", label: "Done-For-You" },
  { id: "plans", label: "Plans" },
  { id: "stats", label: "Results" },
  { id: "coverage", label: "Coverage" },
] as const;

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
        data-testid={`nav-item-${entry.path.split("/").pop()}`}
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

/** Desktop: "Features ▾" with every feature page in a three-column panel. */
function FeaturesDropdown() {
  return (
    <NavigationMenuPrimitive.Root className="static" delayDuration={80}>
      <NavigationMenuPrimitive.List className="flex items-center">
        <NavigationMenuPrimitive.Item>
          <NavigationMenuPrimitive.Trigger
            className="group inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-white/75 hover:text-white data-[state=open]:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange transition-colors"
            data-testid="nav-dropdown-features"
          >
            Features
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
          </NavigationMenuPrimitive.Trigger>
          <NavigationMenuPrimitive.Content className="p-5">
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
                <Link
                  href={FEATURES_PATH}
                  onClick={toTop}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-mkt-orange px-4 h-9 text-sm font-semibold text-white hover:bg-mkt-orange-hover transition-colors"
                  data-testid="nav-features-all"
                >
                  See every feature <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </NavigationMenuPrimitive.Link>
            </div>
          </NavigationMenuPrimitive.Content>
        </NavigationMenuPrimitive.Item>
      </NavigationMenuPrimitive.List>
      {/* The panel hangs under the bar, centred on it, as wide as the screen allows. */}
      <div className="absolute left-1/2 top-full -translate-x-1/2 pt-1 z-50">
        <NavigationMenuPrimitive.Viewport
          className="relative w-[min(980px,calc(100vw-2rem))] h-[var(--radix-navigation-menu-viewport-height)] overflow-hidden rounded-2xl border border-mkt-rule bg-mkt-card text-mkt-ink shadow-2xl shadow-black/20 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in"
        />
      </div>
    </NavigationMenuPrimitive.Root>
  );
}

/** Phones: the same bar in a slide-over, features as fold-out groups. */
function SiteMobileMenu({ signedIn, signInHref }: { signedIn: boolean; signInHref: string }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const row = "block rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted transition-colors";
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center rounded-md h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Open menu"
          data-testid="button-landing-menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 max-w-[88vw] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>Every feature, our done-for-you services and plans.</SheetDescription>
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
                          <Link key={e.key} href={e.path} onClick={() => { toTop(); close(); }} className="block rounded-md px-4 py-2 text-[15px] hover:bg-muted" data-testid={`mobile-nav-item-${e.path.split("/").pop()}`}>
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
  const signInHref = next && next !== "/" ? `/auth?next=${encodeURIComponent(next)}` : "/auth";
  const link = "rounded-md px-2 py-1.5 text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mkt-orange transition-colors";
  return (
    <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
      <Link href="/" onClick={toTop} aria-label="ConstructHUB home" data-testid="link-public-home">
        <CHLogo height={38} />
      </Link>
      <div className="hidden md:flex items-center gap-1 lg:gap-3 text-[14px] lg:text-[15px] font-medium" data-testid="site-nav-links">
        <FeaturesDropdown />
        {SECTIONS.map((s) => (
          <SectionLink key={s.id} id={s.id} label={s.label} className={link} testid={`link-nav-${s.id}`} />
        ))}
      </div>
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
