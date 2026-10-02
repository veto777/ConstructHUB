import { DASHBOARD_GROUPS, type DashboardTile } from "@shared/dashboard";
import { DashboardTileCard } from "./dashboard-tile";

export const GRID_COLS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

/** Every tile under its group heading, groups in DASHBOARD_GROUPS order. The CRM tile is the snapshot card, not a grid tile. */
export function TileGrid({ tiles }: { tiles: DashboardTile[] }) {
  return (
    <div className="space-y-8">
      {DASHBOARD_GROUPS.map((group) => {
        const inGroup = tiles.filter((t) => t.group === group.key && t.key !== "crm");
        if (!inGroup.length) return null;
        const headingId = `dashboard-group-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} data-testid={`section-dashboard-${group.key}`}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h2 id={headingId} className="text-sm font-semibold">{group.label}</h2>
              <p className="text-sm text-muted-foreground">{group.blurb}</p>
            </div>
            <div className={GRID_COLS}>
              {inGroup.map((tile) => <DashboardTileCard key={tile.key} tile={tile} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
