import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/utils";

/**
 * The CRM's shared visual language. Every portal page is built from these
 * pieces so spacing, hierarchy, tables and status colours stay identical
 * from screen to screen — the difference between a product and a wireframe.
 */

/* ── Page scaffold ─────────────────────────────────────────────────────── */

export function CrmPage({
  children,
  wide = false,
  className,
}: {
  children: React.ReactNode;
  /** Pipeline needs the full width for its columns; forms read better narrow. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 space-y-6",
        wide ? "max-w-[1400px]" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CrmPageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  infoKey,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Mounts a ⓘ help dialog (lib/info-content.ts) beside the title. */
  infoKey?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5 min-w-0">
        {Icon && (
          <div className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" strokeWidth={1.8} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight leading-tight">{title}</h1>
            {infoKey && <InfoTip k={infoKey} />}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

/* ── Metric card (dashboard / project costing) ─────────────────────────── */

export function MetricCard({
  icon: Icon,
  label,
  value,
  context,
  testid,
  href,
  valueClassName,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  testid?: string;
  /** Metrics that stand for a page link there — a number nobody can click is a dead end. */
  href?: string;
  /** Long values (money) can drop a size so they fit the card instead of clipping. */
  valueClassName?: string;
}) {
  const card = (
    <Card data-testid={testid} className="overflow-hidden h-full">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </div>
            <div
              className={cn(
                "mt-1.5 text-3xl font-semibold tracking-tight tabular-nums leading-none truncate",
                valueClassName,
              )}
              title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
            >
              {value}
            </div>
            {context && <div className="mt-2 text-xs text-muted-foreground">{context}</div>}
          </div>
          {Icon && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" strokeWidth={1.8} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-xl transition-shadow hover:shadow-md">
      {card}
    </Link>
  ) : (
    card
  );
}

/* ── Status pill — semantic colour, one shape everywhere ───────────────── */

export type PillTone = "success" | "warning" | "danger" | "info" | "violet" | "teal" | "neutral";

const PILL_TONE: Record<PillTone, string> = {
  success:
    "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 border-red-500/25 dark:text-red-400",
  info: "bg-blue-500/10 text-blue-700 border-blue-500/25 dark:text-blue-400",
  violet: "bg-violet-500/10 text-violet-700 border-violet-500/25 dark:text-violet-400",
  teal: "bg-teal-500/10 text-teal-700 border-teal-500/25 dark:text-teal-400",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({
  tone = "neutral",
  dot = true,
  className,
  children,
  ...rest
}: {
  tone?: PillTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        PILL_TONE[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

/** Canonical status → tone. One place, so every screen agrees. */
export function statusTone(status?: string | null): PillTone {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
    case "paid":
    case "succeeded":
    case "done":
    case "active":
    case "accepted":
      return "success";
    case "sent":
    case "viewed":
    case "open":
    case "scheduled":
      return "info";
    case "pending":
    case "draft":
    case "processing":
    case "invited":
      return "warning";
    case "declined":
    case "void":
    case "voided":
    case "failed":
    case "expired":
    case "inactive":
      return "danger";
    default:
      return "neutral";
  }
}

export function roleTone(role?: string | null): PillTone {
  switch ((role ?? "").toLowerCase()) {
    case "owner":
      return "violet";
    case "admin":
      return "info";
    case "sales":
      return "warning";
    case "pm":
      return "teal";
    case "office":
      return "success";
    case "field":
      return "warning";
    default:
      return "neutral";
  }
}

/* ── Empty state — never a blank box ────────────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8" : "py-14",
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.6} />
      </div>
      <div className="mt-3 text-sm font-medium">{title}</div>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ── Error card — one look for every "couldn't load" ────────────────────── */

export function ErrorCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 sm:px-6 pt-10 max-w-lg mx-auto">
      <Card className="border-destructive/40">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                <path d="M12 9v4" /><path d="M12 17h.01" />
              </svg>
            </div>
            <div>
              <div className="font-semibold">{title}</div>
              {description && (
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              )}
              {children && <div className="mt-3">{children}</div>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Avatar initials — deterministic tint per name, dark-mode safe ──────── */

const AVATAR_TINTS = [
  "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
];

export function InitialAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold",
        AVATAR_TINTS[h % AVATAR_TINTS.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/* ── Table idioms — HCP-style: quiet header, hover rows, tabular money ──── */

export const crmTable = {
  wrapper: "overflow-x-auto rounded-lg border bg-card",
  table: "w-full text-sm",
  thead: "bg-muted/50",
  // Cells loosen up at sm so dense tables still read on a phone without
  // changing anything on desktop.
  th: "px-3 py-2 sm:px-4 sm:py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap",
  thRight: "px-3 py-2 sm:px-4 sm:py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap",
  td: "px-3 py-2.5 sm:px-4 sm:py-3 align-middle",
  tdRight: "px-3 py-2.5 sm:px-4 sm:py-3 align-middle text-right tabular-nums",
  tr: "border-t transition-colors hover:bg-muted/40",
};

/**
 * Responsive table→cards pattern: below sm each row renders as a stacked card
 * (header hidden, cells unboxed), at sm and up it's the same table as ever.
 * Pair with `hidden sm:table-cell` on columns that can wait for a bigger screen.
 */
export const crmTableCards = {
  thead: "hidden sm:table-header-group",
  tr: "flex flex-col gap-1.5 px-3.5 py-3 sm:table-row",
  td: "block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle",
};

/* ── Section heading inside a card stack ────────────────────────────────── */

export function SectionTitle({
  icon: Icon,
  title,
  description,
  actions,
  infoKey,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Mounts a ⓘ help dialog (lib/info-content.ts) beside the title. */
  infoKey?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="flex items-center gap-2 text-base font-semibold">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />}
          {title}
          {infoKey && <InfoTip k={infoKey} />}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
