/**
 * The platform's page kit — every signed-in growth page is built from these, so the product reads as ONE thing
 * (owner, 2026-10-03: "make them flow and look cleaner simpler and better! Less is more"). Rules and examples:
 * docs/design/APP-UI.md. Theme: `.app-theme` in index.css.
 *
 *   <AppPage>                        page frame: width, gutters (16 px on phones), vertical rhythm
 *     <PageHeader title description actions />    one title, one short line, ONE primary action
 *     <StatGrid><Stat …/>…</StatGrid>              2 across on phones, up to 4 on desktop, no icons
 *     <Section title actions>…</Section>           the one card style
 *     <Toolbar search filters actions />           search + filters (a sheet on phones)
 *     <Notice tone>…</Notice>                      one quiet line, never a wall of text
 *     <AppTabsList>…</AppTabsList>                 tabs that scroll sideways on phones instead of wrapping
 *     <EmptyState …/>                              re-exported from crm-ui
 * Tables: `appTable` / `appTableCards` (rows become cards below sm).
 */
import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Ticket,
  AlertTriangle, ArrowRight, CheckCircle2, Info, SlidersHorizontal, XCircle, type LucideIcon,
  LayoutDashboard, Search, Database, Home, CalendarClock, History, Camera, Images, Eye, Grid3x3, Swords, Briefcase,
  MapPin, Store, Globe, MailWarning, Newspaper, Megaphone, BookOpen, Cloud, LineChart, ScanSearch, GraduationCap,
  LifeBuoy, Building2, MousePointerClick, BarChart3, Users, Fingerprint, Phone, ShieldCheck, Star, Settings,
  KeyRound, Bug, LayoutGrid, Kanban, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
export { EmptyState, StatusPill, ErrorCard, statusTone, crmTable as appTable, crmTableCards as appTableCards } from "@/components/crm-ui";

/* ── Color ──────────────────────────────────────────────────────────────────── */
/* Owner, 2026-10-04: "…need a little color", then "i didnt ask for every color of the fucking rainbow" — ONE accent:
   the brand orange, used lightly; green/amber/red only where they mean a status.
   One small palette, used the same way everywhere: a tinted chip for a page or section icon, a soft tint and a
   colored label on number tiles. Orange stays the action color; the others only label and decorate. */

export type Accent = "orange" | "sky" | "emerald" | "violet" | "amber" | "rose" | "teal" | "indigo" | "slate";
const ACCENTS: Record<Accent, { chip: string; tint: string; border: string; label: string; dot: string; bar: string }> = {
  orange: { chip: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400", tint: "from-orange-50 dark:from-orange-500/[0.09]", border: "border-orange-200/80 dark:border-orange-500/25", label: "text-orange-700 dark:text-orange-300", dot: "bg-orange-500", bar: "bg-orange-500" },
  sky: { chip: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400", tint: "from-sky-50 dark:from-sky-500/[0.09]", border: "border-sky-200/80 dark:border-sky-500/25", label: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500", bar: "bg-sky-500" },
  emerald: { chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400", tint: "from-emerald-50 dark:from-emerald-500/[0.09]", border: "border-emerald-200/80 dark:border-emerald-500/25", label: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  violet: { chip: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400", tint: "from-violet-50 dark:from-violet-500/[0.09]", border: "border-violet-200/80 dark:border-violet-500/25", label: "text-violet-700 dark:text-violet-300", dot: "bg-violet-500", bar: "bg-violet-500" },
  amber: { chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400", tint: "from-amber-50 dark:from-amber-500/[0.09]", border: "border-amber-200/80 dark:border-amber-500/25", label: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500", bar: "bg-amber-500" },
  rose: { chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400", tint: "from-rose-50 dark:from-rose-500/[0.09]", border: "border-rose-200/80 dark:border-rose-500/25", label: "text-rose-700 dark:text-rose-300", dot: "bg-rose-500", bar: "bg-rose-500" },
  teal: { chip: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400", tint: "from-teal-50 dark:from-teal-500/[0.09]", border: "border-teal-200/80 dark:border-teal-500/25", label: "text-teal-700 dark:text-teal-300", dot: "bg-teal-500", bar: "bg-teal-500" },
  indigo: { chip: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400", tint: "from-indigo-50 dark:from-indigo-500/[0.09]", border: "border-indigo-200/80 dark:border-indigo-500/25", label: "text-indigo-700 dark:text-indigo-300", dot: "bg-indigo-500", bar: "bg-indigo-500" },
  slate: { chip: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300", tint: "from-slate-50 dark:from-slate-500/[0.09]", border: "border-slate-200/80 dark:border-slate-500/25", label: "text-slate-700 dark:text-slate-300", dot: "bg-slate-500", bar: "bg-slate-500" },
};
export const accentClasses = (a: Accent) => ACCENTS[a];
/** Number tiles without an accent of their own take these in turn, so a row of numbers is never grey. */
const STAT_CYCLE: Accent[] = ["orange"];

/** Each page's icon and color, by route (the sidebar's families: Google = sky, ads = amber, permits = emerald …). */
const PAGE_ICONS: [string, LucideIcon, Accent][] = [
  ["/call-assistant", Phone, "orange"], ["/google-reviews", Star, "orange"], ["/google-profile", Store, "orange"],
  ["/google-business", Store, "orange"], ["/locations", MapPin, "orange"], ["/gmb-monitor", Eye, "orange"],
  ["/ranking-grid", Grid3x3, "orange"], ["/gbp-content", Newspaper, "orange"], ["/reinstatement", LifeBuoy, "orange"],
  ["/agency", Building2, "orange"], ["/competitors", Swords, "orange"], ["/google-ads", MousePointerClick, "orange"],
  ["/ads-manager", BarChart3, "orange"], ["/lsa-leads", Users, "orange"], ["/lsa-account-manager", Briefcase, "orange"],
  ["/search", Search, "orange"], ["/databases", Database, "orange"], ["/property", Home, "orange"],
  ["/schedules", CalendarClock, "orange"], ["/history", History, "orange"], ["/photos", Camera, "orange"],
  ["/media-library", Images, "orange"], ["/domains", Globe, "orange"], ["/mail-alerts", MailWarning, "orange"],
  ["/cloudflare", Cloud, "orange"], ["/search-console", LineChart, "orange"], ["/site-scan", ScanSearch, "orange"], ["/seo", TrendingUp, "orange"],
  ["/vpn-shield", ShieldCheck, "orange"], ["/ip-tracker", Fingerprint, "orange"], ["/social-media", Megaphone, "orange"],
  ["/guides", BookOpen, "orange"], ["/master-class", GraduationCap, "orange"], ["/settings", Settings, "orange"],
  ["/admin/access", KeyRound, "orange"], ["/admin/issues", Bug, "orange"], ["/admin/tickets", Ticket, "orange"], ["/admin/feature-pages", LayoutGrid, "orange"],
  ["/crm-app", Kanban, "orange"], ["/", LayoutDashboard, "orange"],
];
function pageIconFor(path: string): { icon: LucideIcon; accent: Accent } | null {
  const hit = PAGE_ICONS.find(([p]) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)));
  return hit ? { icon: hit[1], accent: hit[2] } : null;
}

/* ── Page frame ─────────────────────────────────────────────────────────────── */

const WIDTHS = { narrow: "max-w-3xl", default: "max-w-6xl", wide: "max-w-[1400px]" } as const;

export function AppPage({ children, width = "default", className, testId }: {
  children: ReactNode;
  /** narrow: forms and settings · default: most tools · wide: grids, maps and big tables */
  width?: keyof typeof WIDTHS;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn(
      // Flat, like Google: no glow behind the header (the platform sits on the Google surface, App.tsx).
      "relative isolate mx-auto w-full px-4 pb-10 pt-5 sm:px-6 sm:pt-8 space-y-5 sm:space-y-6",
      WIDTHS[width], className)} data-testid={testId}>
      {children}
    </div>
  );
}

/* ── Page header ────────────────────────────────────────────────────────────── */

export function PageHeader({ title, description, actions, meta, back, testId, icon, accent }: {
  title: ReactNode;
  /** The page's icon chip. Defaults to the route's icon (PAGE_ICONS); pass null for none. */
  icon?: LucideIcon | null;
  accent?: Accent;
  /** One short sentence: what this page is for. Never a paragraph. */
  description?: ReactNode;
  /** The page's actions, primary first. On phones they sit on their own row under the title. */
  actions?: ReactNode;
  /** A small status line or badge beside the title (plan, live/draft, last synced). */
  meta?: ReactNode;
  /** A quiet "← Back to …" link above the title, for sub-pages. */
  back?: { href: string; label: string };
  testId?: string;
}) {
  const [location] = useLocation();
  const auto = pageIconFor(location);
  const Icon = icon === null ? null : icon ?? auto?.icon ?? null;
  const tone = ACCENTS[accent ?? auto?.accent ?? "orange"];
  return (
    <header className="space-y-3" data-testid={testId}>
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          {Icon && (
            <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5 sm:h-12 sm:w-12 sm:rounded-2xl", tone.chip)} aria-hidden="true">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.9} />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-9">{title}</h1>
              {meta}
            </div>
            {description && <p className="max-w-2xl text-sm text-muted-foreground sm:text-[0.9375rem]">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
    </header>
  );
}

/* ── Numbers ────────────────────────────────────────────────────────────────── */

export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5; className?: string }) {
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[cols];
  let i = 0;
  const colored = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== Stat) return child;
    const el = child as ReactElement<StatProps>;
    const accent = el.props.accent ?? STAT_CYCLE[i % STAT_CYCLE.length];
    i++;
    return cloneElement(el, { accent });
  });
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", lg, className)}>{colored}</div>;
}

type StatProps = {
  label: ReactNode;
  value: ReactNode;
  /** One short line under the number ("of 2,000 included", "3 need a reply"). */
  hint?: ReactNode;
  /** A number that stands for a list links to it. */
  href?: string;
  tone?: "default" | "good" | "warn" | "bad";
  /** The tile's color; StatGrid gives each tile one in turn when not set. */
  accent?: Accent;
  icon?: LucideIcon;
  testId?: string;
};

export function Stat({ label, value, hint, href, tone = "default", accent, icon: Icon, testId }: StatProps) {
  const toneClass = { default: "", good: "text-primary", warn: "text-primary", bad: "text-red-600 dark:text-red-400" }[tone];
  const a = accent ? ACCENTS[accent] : null;
  const body = (
    <div className={cn(
      "h-full rounded-xl border bg-card p-3.5 sm:p-4",
      // one brand color, used lightly: a white tile, an orange dot (owner, 2026-10-04: no rainbow)
      href && "transition-shadow hover:shadow-md",
    )} data-testid={testId} data-ui="stat">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-ui="stat-label">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : a ? <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", a.dot)} aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight", toneClass)} data-ui="stat-value">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

/* ── Sections ───────────────────────────────────────────────────────────────── */

export function Section({ title, description, actions, children, className, contentClassName, flush, testId, id, icon: Icon, accent = "orange" }: {
  title?: ReactNode;
  /** A small colored icon chip before the title; without one the title gets the orange marker. */
  icon?: LucideIcon;
  accent?: Accent;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** No inner padding: a table or list that runs edge to edge. */
  flush?: boolean;
  testId?: string;
  id?: string;
}) {
  const head = title || description || actions;
  return (
    <section id={id} className={cn("rounded-xl border bg-card text-card-foreground", className)} data-testid={testId}>
      {head && (
        <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5", flush && "pb-3")}>
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-2 text-base font-semibold leading-6">
                {Icon
                  ? <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", ACCENTS[accent].chip)} aria-hidden="true"><Icon className="h-4 w-4" /></span>
                  : <span className={cn("h-4 w-1 shrink-0 rounded-full", ACCENTS[accent].bar)} aria-hidden="true" />}
                <span className="min-w-0">{title}</span>
              </h2>
            )}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn(flush ? "" : head ? "p-4 pt-3 sm:p-5 sm:pt-4" : "p-4 sm:p-5", contentClassName)}>{children}</div>
    </section>
  );
}

/* ── Search + filters ───────────────────────────────────────────────────────── */

export function Toolbar({ search, filters, activeFilters = 0, actions, className }: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string; testId?: string };
  /** Selects/toggles. Inline from sm up; behind a "Filters" button (a bottom sheet) on phones. */
  filters?: ReactNode;
  /** How many filters are not at their default: shown on the phone's Filters button. */
  activeFilters?: number;
  actions?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {search && (
        <Input
          type="search"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder}
          aria-label={search.placeholder}
          className="h-10 sm:w-72 sm:flex-none"
          data-testid={search.testId}
        />
      )}
      {filters && (
        <>
          <div className="hidden flex-wrap items-center gap-2 sm:flex">{filters}</div>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="h-10 justify-center sm:hidden" data-testid="button-toolbar-filters">
                <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" /> Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl sm:hidden">
              <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
              <div className="mt-4 flex flex-col gap-3 [&>*]:w-full">{filters}</div>
              <Button className="mt-5 w-full" onClick={() => setOpen(false)}>Show results</Button>
            </SheetContent>
          </Sheet>
        </>
      )}
      {actions && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}

/* ── Notices ────────────────────────────────────────────────────────────────── */

const NOTICE = {
  // Three colors on the platform (owner, 2026-10-04: "2-3 colors tops"): ink/neutral, the brand orange, and red
  // only for real errors.
  info: { icon: Info, cls: "border-border bg-muted/60 text-foreground [&>svg]:text-primary" },
  warning: { icon: AlertTriangle, cls: "border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-100 [&>svg]:text-primary" },
  danger: { icon: XCircle, cls: "border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100" },
  success: { icon: CheckCircle2, cls: "border-border bg-muted/60 text-foreground [&>svg]:text-primary" },
} as const;

export function Notice({ tone = "info", title, children, action, testId }: {
  tone?: keyof typeof NOTICE;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const { icon: Icon, cls } = NOTICE[tone];
  return (
    <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", cls)} data-testid={testId}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Tabs ───────────────────────────────────────────────────────────────────── */

/** A TabsList that scrolls sideways on phones (never wraps to a second row) and sits flush on desktop. */
export function AppTabsList({ children, className, ...rest }: React.ComponentProps<typeof TabsList>) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
      <TabsList className={cn("inline-flex h-10 w-max min-w-full justify-start gap-1 rounded-xl bg-muted p-1 sm:min-w-0 [&>[data-state=active]]:text-primary [&>[data-state=active]]:font-semibold", className)} {...rest}>
        {children}
      </TabsList>
    </div>
  );
}

/* ── Key/value rows ─────────────────────────────────────────────────────────── */

export function DetailList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("divide-y rounded-xl border bg-card text-sm", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 px-4 py-3">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
