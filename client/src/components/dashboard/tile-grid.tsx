import { ArrowRight, ArrowUpRight, LayoutGrid, Lock } from "lucide-react";
import { DASHBOARD_GROUPS, type DashboardGroupKey, type DashboardTile, type DashboardTileKey } from "@shared/dashboard";
import { featureIntroPath } from "@shared/feature-pages";
import { MODULE_NAMES, PLANS } from "@shared/plans";
import { DashboardTileCard } from "./dashboard-tile";
import { DashLink, FOCUS_RING } from "./dash-link";
import { TILE_ICONS } from "./tile-icons";

export const GRID_COLS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

/** Rendered by CrmSnapshotCard above the grid, never as grid tiles. */
export const CRM_CARD_TILES: ReadonlySet<DashboardTileKey> = new Set(["crm", "crmLeads", "crmSchedule"]);

/**
 * A group's locked tiles, as one compact row: icon, name and the plan that
 * includes it, with a single "See plans" link (not a prompt box per tile).
 * Each chip keeps `tile-<key>` / data-status="locked" and shows no numbers;
 * it links to the feature's intro page (/features/<slug>) to see what it does.
 */
function LockedRow({ group, tiles, spaced }: { group: DashboardGroupKey; tiles: DashboardTile[]; spaced: boolean }) {
  const labelId = `dashboard-locked-${group}`;
  return (
    <div
      className={`${spaced ? "mt-4 " : ""}flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4`}
      data-testid={`locked-row-${group}`}
    >
      <p id={labelId} className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> On a higher plan
        <span className="hidden sm:inline">· open any to see what it does</span>
      </p>
      <ul className="flex min-w-0 flex-1 flex-wrap gap-2" aria-labelledby={labelId}>
        {tiles.map((t) => {
          const Icon = TILE_ICONS[t.key] ?? LayoutGrid;
          const plan = t.requiredPlan ? PLANS[t.requiredPlan].name : "Paid plan";
          const intro = featureIntroPath(t.key);
          const chip = (
            <>
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{t.title}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground" data-testid={`status-${t.key}`}>
                <span className="sr-only">Included with the </span>{plan}<span className="sr-only"> plan</span>
              </span>
            </>
          );
          return (
            <li
              key={t.key}
              className="inline-flex"
              title={t.module ? `${MODULE_NAMES[t.module]} is included with the ${plan} plan` : `Included with the ${plan} plan`}
              data-testid={`tile-${t.key}`}
              data-status="locked"
            >
              {intro ? (
                <DashLink
                  href={intro}
                  surface="app"
                  className={`group inline-flex min-h-10 sm:min-h-0 items-center gap-2 rounded-full border bg-card py-1 pl-2 pr-1.5 text-sm transition-colors hover:border-foreground/40 ${FOCUS_RING}`}
                  data-testid={`link-tile-${t.key}-intro`}
                >
                  {chip}
                  <span className="sr-only">: see what it does</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                </DashLink>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-2 pr-1 text-sm">{chip}</span>
              )}
            </li>
          );
        })}
      </ul>
      <DashLink
        href="/pricing"
        surface="app"
        className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 sm:min-h-8 ${FOCUS_RING}`}
        data-testid={`link-locked-${group}-plans`}
      >
        See plans <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </DashLink>
    </div>
  );
}

/** Every tile under its group heading, groups in DASHBOARD_GROUPS order; locked tiles fold into one row per group. */
export function TileGrid({ tiles }: { tiles: DashboardTile[] }) {
  return (
    <div className="space-y-8">
      {DASHBOARD_GROUPS.map((group) => {
        const inGroup = tiles.filter((t) => t.group === group.key && !CRM_CARD_TILES.has(t.key));
        if (!inGroup.length) return null;
        const open = inGroup.filter((t) => t.status !== "locked");
        const locked = inGroup.filter((t) => t.status === "locked");
        const headingId = `dashboard-group-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} data-testid={`section-dashboard-${group.key}`}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 id={headingId} className="text-sm font-semibold">{group.label}</h2>
              <p className="text-sm text-muted-foreground">{group.blurb}</p>
            </div>
            {open.length > 0 && (
              <div className={GRID_COLS}>
                {open.map((tile) => <DashboardTileCard key={tile.key} tile={tile} />)}
              </div>
            )}
            {locked.length > 0 && <LockedRow group={group.key} tiles={locked} spaced={open.length > 0} />}
          </section>
        );
      })}
    </div>
  );
}
