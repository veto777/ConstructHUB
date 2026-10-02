import { ArrowRight, Clock3, LayoutGrid, Lock, Star, TriangleAlert } from "lucide-react";
import type { DashboardMetric, DashboardTile } from "@shared/dashboard";
import { featureIntroPath } from "@shared/feature-pages";
import { PLANS } from "@shared/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DashLink, FOCUS_RING } from "./dash-link";
import { LockedPrompt } from "./locked-prompt";
import { TILE_ICONS } from "./tile-icons";
import { formatCount, formatMetricValue, percentOf, toneBar, toneText, DASH } from "./format";

const usedOf = (m: DashboardMetric): number | null => (typeof m.value === "number" ? m.value : null);

/** The metric a tile leads with: label, big tabular number, then the meter or hint. */
const HERO_SIZE = { lg: "text-3xl", md: "text-2xl", sm: "text-xl" } as const;

export function MetricHero({ tileKey, metric, size = "lg" }: { tileKey: string; metric: DashboardMetric; size?: keyof typeof HERO_SIZE }) {
  const value = formatMetricValue(metric);
  const hasLimit = metric.limit !== undefined;
  const pct = hasLimit ? percentOf(usedOf(metric), metric.limit) : null;
  const unknown = value === DASH;
  return (
    <div className="min-w-0" data-testid={`metric-${tileKey}-${metric.key}`}>
      <dt className="text-xs font-medium text-muted-foreground leading-snug">{metric.label}</dt>
      <dd className="mt-1">
        <span className={`flex items-baseline gap-1.5 font-semibold tabular-nums tracking-tight ${HERO_SIZE[size]} ${unknown ? "text-muted-foreground" : toneText(metric.tone)}`}>
          <span className="truncate">{value}</span>
          {metric.format === "rating" && !unknown && <Star className="h-5 w-5 self-center fill-amber-400 text-amber-400" aria-hidden="true" />}
          {metric.format === "score" && !unknown && <span className="text-sm font-medium text-muted-foreground">/ 100</span>}
          {hasLimit && (
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {metric.limit! < 0 ? "· Unlimited" : `of ${formatCount(metric.limit!)}`}
            </span>
          )}
        </span>
        {pct !== null && (
          <Progress
            value={pct}
            className={`mt-2 h-1.5 ${toneBar(pct >= 100 ? "bad" : pct >= 80 ? "warn" : "default")}`}
            aria-label={`${metric.label}: ${value} of ${formatCount(metric.limit!)}`}
          />
        )}
        {metric.hint && <span className="mt-1.5 block text-xs text-muted-foreground">{metric.hint}</span>}
      </dd>
    </div>
  );
}

/** A secondary metric: label on the left, value on the right. */
function MetricRow({ tileKey, metric }: { tileKey: string; metric: DashboardMetric }) {
  const value = formatMetricValue(metric);
  const unknown = value === DASH;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" data-testid={`metric-${tileKey}-${metric.key}`}>
      <dt className="min-w-0 text-sm text-muted-foreground">
        {metric.label}
        {metric.hint && <span className="block text-xs text-muted-foreground">{metric.hint}</span>}
      </dt>
      <dd className={`shrink-0 text-sm font-semibold tabular-nums ${unknown ? "text-muted-foreground" : toneText(metric.tone)}`}>
        {value}
        {metric.limit !== undefined && (
          <span className="font-normal text-muted-foreground"> {metric.limit < 0 ? "· Unlimited" : `of ${formatCount(metric.limit)}`}</span>
        )}
      </dd>
    </div>
  );
}

function StatusPill({ tile }: { tile: DashboardTile }) {
  switch (tile.status) {
    case "locked":
      return (
        <Badge variant="outline" className="gap-1 font-medium text-muted-foreground" data-testid={`status-${tile.key}`}>
          <Lock className="h-3 w-3" aria-hidden="true" />
          {tile.requiredPlan ? PLANS[tile.requiredPlan].name : "Paid plan"}
        </Badge>
      );
    case "coming_soon":
      return (
        <Badge variant="secondary" className="gap-1 font-medium" data-testid={`status-${tile.key}`}>
          <Clock3 className="h-3 w-3" aria-hidden="true" /> Coming soon
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="gap-1 font-medium text-amber-700 dark:text-amber-400" data-testid={`status-${tile.key}`}>
          <TriangleAlert className="h-3 w-3" aria-hidden="true" /> Didn't load
        </Badge>
      );
    case "empty":
      return <Badge variant="secondary" className="font-medium text-muted-foreground" data-testid={`status-${tile.key}`}>Not set up</Badge>;
    default:
      return null;
  }
}

const textLink = `inline-flex min-h-10 sm:min-h-8 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 ${FOCUS_RING}`;

export function DashboardTileCard({ tile }: { tile: DashboardTile }) {
  // A tile key newer than this client still renders, with a generic icon.
  const Icon = TILE_ICONS[tile.key] ?? LayoutGrid;
  const muted = tile.status === "locked" || tile.status === "coming_soon";
  const [hero, ...rest] = tile.metrics;
  const titleId = `tile-title-${tile.key}`;
  const cta = tile.cta ?? { label: `Open ${tile.title}`, href: tile.href, surface: tile.surface };
  const intro = featureIntroPath(tile.key);

  return (
    <Card
      className={`flex h-full min-w-0 flex-col p-4 sm:p-5 ${tile.status === "coming_soon" ? "border-dashed" : ""}`}
      data-testid={`tile-${tile.key}`}
      data-status={tile.status}
      role="article"
      aria-labelledby={titleId}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}
          aria-hidden="true"
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <h3 id={titleId} className="text-sm font-semibold leading-tight">{tile.title}</h3>
        </div>
        <div className="shrink-0 pt-1"><StatusPill tile={tile} /></div>
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        {tile.status === "ok" && hero ? (
          <dl>
            <MetricHero tileKey={tile.key} metric={hero} />
            {rest.length > 0 && (
              <div className="mt-3 divide-y border-t">
                {rest.slice(0, 2).map((m) => <MetricRow key={m.key} tileKey={tile.key} metric={m} />)}
              </div>
            )}
          </dl>
        ) : tile.status === "locked" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{tile.description}</p>
            <LockedPrompt tileKey={tile.key} requiredPlan={tile.requiredPlan} module={tile.module} href={tile.cta?.href} surface={tile.cta?.surface} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tile.status === "error" || tile.status === "coming_soon" ? (tile.message ?? tile.description) : tile.description}
          </p>
        )}
      </div>

      {tile.status !== "locked" && (
        <div className={`mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 ${tile.status === "ok" ? "border-t pt-3" : ""}`}>
          {tile.status === "empty" ? (
            // Outline: the one solid button on the page is the checklist's next step.
            <Button asChild size="sm" variant="outline" className="min-h-10 sm:min-h-8">
              <DashLink href={cta.href} surface={cta.surface} data-testid={`link-tile-${tile.key}`}>
                {cta.label} <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </DashLink>
            </Button>
          ) : (
            <DashLink
              href={cta.href}
              surface={cta.surface}
              className={textLink}
              data-testid={`link-tile-${tile.key}`}
              aria-label={cta.label === "Open" ? `Open ${tile.title}` : undefined}
            >
              {cta.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </DashLink>
          )}
          {/* Not for sale yet: its intro page says what it will do. */}
          {tile.status === "coming_soon" && intro && intro !== cta.href && (
            <DashLink
              href={intro}
              surface="app"
              className={`inline-flex min-h-10 sm:min-h-8 items-center rounded-md text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 ${FOCUS_RING}`}
              data-testid={`link-tile-${tile.key}-intro`}
            >
              See what it does
            </DashLink>
          )}
          {tile.links?.map((l, i) => (
            <DashLink
              key={l.href}
              href={l.href}
              surface={l.surface}
              className={`inline-flex min-h-10 sm:min-h-8 items-center rounded-md text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-4 ${FOCUS_RING}`}
              data-testid={`link-tile-${tile.key}-${i}`}
            >
              {l.label}
            </DashLink>
          ))}
        </div>
      )}
    </Card>
  );
}
