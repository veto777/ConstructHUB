/**
 * The Call Assistant's colour kit (the SEO-Suite facelift standard, owner 2026-10-15; same pieces as the Ranking
 * Grid's): brand navy + orange chrome, one colour per call outcome used everywhere — pills, tiles, card stripes,
 * avatars — and a coloured stat tile. Pure presentation: no data, no queries.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const NAVY = "hsl(var(--sidebar))";
export const BRAND_ORANGE = "#f57c00";

/** One colour per outcome: green made money, orange needed a person, blue answered, grey went nowhere, red was spam. */
export function outcomeColor(outcome: string | null | undefined): string {
  switch (outcome) {
    case "lead_submitted":
    case "booked":
    case "support_ticket":
      return "#16a34a";
    case "alerted":
      return BRAND_ORANGE;
    case "info":
    case "voicemail":
      return "#0284c7";
    case "spam":
    case "blocked":
    case "error":
      return "#dc2626";
    case "declined":
    case "out_of_area":
    case "hangup":
      return "#64748b";
    default:
      return "#ca8a04"; // still in progress
  }
}

/** A filled, coloured outcome pill (a dot + the label). `testId` keeps the pill's old data-testid. */
export function OutcomePill({ outcome, children, testId, className }: { outcome: string | null | undefined; children: ReactNode; testId?: string; className?: string }) {
  const c = outcomeColor(outcome);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", className)}
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 35%, transparent)` }}
      data-testid={testId}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} aria-hidden="true" />
      {children}
    </span>
  );
}

/** The caller's initials (or a phone glyph's stand-in) in a circle of the outcome's colour. */
export function CallerAvatar({ name, outcome, size = 36 }: { name: string | null | undefined; outcome: string | null | undefined; size?: number }) {
  const c = outcomeColor(outcome);
  const initials = (name ?? "").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "#";
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: c, fontSize: size * 0.36 }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** A stat tile with a colour bar, an icon chip and a link (the GoogleStat it replaces kept its testId and href). */
export function ColorStat({ label, value, hint, color, icon: Icon, href, testId }: {
  label: string; value: ReactNode; hint?: ReactNode; color: string; icon: LucideIcon; href?: string; testId?: string;
}) {
  const body = (
    <>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} aria-hidden="true" />
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-2 block truncate text-2xl font-semibold tabular-nums tracking-tight" data-ui="stat-value">{value}</span>
      {hint && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const cls = "relative block h-full overflow-hidden rounded-xl border bg-card p-3.5 sm:p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} data-testid={testId} data-ui="stat">{body}</Link>
  ) : (
    <div className={cls} data-testid={testId} data-ui="stat">{body}</div>
  );
}
