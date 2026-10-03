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
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, SlidersHorizontal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
export { EmptyState, StatusPill, ErrorCard, statusTone, crmTable as appTable, crmTableCards as appTableCards } from "@/components/crm-ui";

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
    <div className={cn("mx-auto w-full px-4 pb-10 pt-5 sm:px-6 sm:pt-8 space-y-5 sm:space-y-6", WIDTHS[width], className)} data-testid={testId}>
      {children}
    </div>
  );
}

/* ── Page header ────────────────────────────────────────────────────────────── */

export function PageHeader({ title, description, actions, meta, back, testId }: {
  title: ReactNode;
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
  return (
    <header className="space-y-3" data-testid={testId}>
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem] sm:leading-9">{title}</h1>
            {meta}
          </div>
          {description && <p className="max-w-2xl text-sm text-muted-foreground sm:text-[0.9375rem]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
    </header>
  );
}

/* ── Numbers ────────────────────────────────────────────────────────────────── */

export function StatGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5; className?: string }) {
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[cols];
  return <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", lg, className)}>{children}</div>;
}

export function Stat({ label, value, hint, href, tone = "default", testId }: {
  label: ReactNode;
  value: ReactNode;
  /** One short line under the number ("of 2,000 included", "3 need a reply"). */
  hint?: ReactNode;
  /** A number that stands for a list links to it. */
  href?: string;
  tone?: "default" | "good" | "warn" | "bad";
  testId?: string;
}) {
  const toneClass = { default: "", good: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" }[tone];
  const body = (
    <div className={cn("h-full rounded-xl border bg-card p-3.5 sm:p-4", href && "transition-colors hover:border-primary/40 hover:bg-accent/40")} data-testid={testId}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight", toneClass)}>{value}</div>
      {hint && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

/* ── Sections ───────────────────────────────────────────────────────────────── */

export function Section({ title, description, actions, children, className, contentClassName, flush, testId, id }: {
  title?: ReactNode;
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
            {title && <h2 className="text-base font-semibold leading-6">{title}</h2>}
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
  info: { icon: Info, cls: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100" },
  warning: { icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" },
  danger: { icon: XCircle, cls: "border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100" },
  success: { icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100" },
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
      <TabsList className={cn("inline-flex h-10 w-max min-w-full justify-start gap-1 rounded-xl bg-muted p-1 sm:min-w-0", className)} {...rest}>
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
