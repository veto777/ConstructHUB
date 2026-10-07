import { ArrowRight, ArrowUpRight, LayoutGrid, Lock, SlidersHorizontal } from "lucide-react";
import { DASHBOARD_GROUPS, type DashboardGroupKey, type DashboardTile, type DashboardTileKey } from "@shared/dashboard";
import { DASHBOARD_CRM_CARD_TILES, dashboardGroupsInOrder } from "@shared/dashboard-prefs";
import { Button } from "@/components/ui/button";
import { GoogleSectionHeader } from "@/components/google";
import { featureIntroPath } from "@shared/feature-pages";
import { ADDONS, MODULE_NAMES, PLANS, type AddonKey } from "@shared/plans";
import { joinNames } from "@shared/plan-copy";
import { inNativeApp } from "@/lib/app-shell";
import { DashboardTileCard } from "./dashboard-tile";
import { DashLink, FOCUS_RING } from "./dash-link";
import { TILE_ICONS } from "./tile-icons";

export const GRID_COLS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

/** Rendered by CrmSnapshotCard above the grid, never as grid tiles. */
export const CRM_CARD_TILES: ReadonlySet<DashboardTileKey> = DASHBOARD_CRM_CARD_TILES;

/**
 * A group's locked tiles, as one compact row: icon, name and the plan that
 * includes it, with a single "See plans" link (not a prompt box per tile).
 * Each chip keeps `tile-<key>` / data-status="locked" and shows no numbers;
 * it links to the feature's intro page (/features/<slug>) to see what it does.
 */
function LockedRow({ group, tiles, spaced }: { group: DashboardGroupKey | "all"; tiles: DashboardTile[]; spaced: boolean }) {
  const labelId = `dashboard-locked-${group}`;
  // The iPhone apps sell nothing (App Store 3.1.3(f)): no plan name, "See plans" or
  // add-on hint — the tools' names and a lock, like AppLocked.
  if (inNativeApp()) {
    return (
      <div
        className={`${spaced ? "mt-4 " : ""}flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4`}
        data-testid={`locked-row-${group}`}
      >
        <p id={labelId} className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Not on this account
        </p>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-2" aria-labelledby={labelId}>
          {tiles.map((t) => {
            const Icon = TILE_ICONS[t.key] ?? LayoutGrid;
            return (
              <li
                key={t.key}
                className="inline-flex items-center gap-2 rounded-full border bg-card py-1 pl-2 pr-3 text-sm text-muted-foreground"
                data-testid={`tile-${t.key}`}
                data-status="locked"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{t.title}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  // An add-on the account hasn't bought (the AI Call Assistant) is bought on top of a plan, not "on a higher plan".
  const anyAddon = tiles.some((t) => t.addon);
  const addonsOnly = tiles.every((t) => t.addon);
  return (
    <div
      className={`${spaced ? "mt-4 " : ""}flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4`}
      data-testid={`locked-row-${group}`}
    >
      <p id={labelId} className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" /> {anyAddon ? "Not on your plan" : "On a higher plan"}
        <span className="hidden sm:inline">· open any to see what it does</span>
      </p>
      <ul className="flex min-w-0 flex-1 flex-wrap gap-2" aria-labelledby={labelId}>
        {tiles.map((t) => {
          const Icon = TILE_ICONS[t.key] ?? LayoutGrid;
          const plan = t.requiredPlan ? PLANS[t.requiredPlan].name : "Paid plan";
          const addon = t.addon ? ADDONS[t.addon as AddonKey] : undefined;
          const addonPlans = addon ? joinNames(addon.availableOn.map((k) => PLANS[k].name)) : null;
          const intro = featureIntroPath(t.key);
          const chip = (
            <>
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{t.title}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground" data-testid={`status-${t.key}`}>
                {addonPlans ? "Add-on" : <><span className="sr-only">Included with the </span>{plan}<span className="sr-only"> plan</span></>}
              </span>
            </>
          );
          return (
            <li
              key={t.key}
              className="inline-flex"
              title={addonPlans ? `${t.title} is an add-on for the ${addonPlans} plans` : t.module ? `${MODULE_NAMES[t.module]} is included with the ${plan} plan` : `Included with the ${plan} plan`}
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
        href={addonsOnly ? "/pricing#add-ons" : "/pricing"}
        surface="app"
        className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline underline-offset-4 sm:min-h-8 ${FOCUS_RING}`}
        data-testid={`link-locked-${group}-plans`}
      >
        {addonsOnly ? "See add-ons" : "See plans"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </DashLink>
    </div>
  );
}

/**
 * The tools, in the user's order (the server sends `tiles` already sorted by
 * their layout). Grouped: each group under its heading, groups in the order
 * their first tile comes; locked tiles fold into one row per group. One list
 * (`keepGroups` off): a single grid in the user's order, locked tiles in one
 * row under it.
 */
/** Not in the iPhone apps (they sell nothing; the app routes these sales pages to Home, so the tile would look broken). */
const APP_HIDDEN_TILES = new Set(["masterClass", "reinstatement"]);
const APP_HIDDEN_LINKS = new Set(["/google-ads-guide"]);

export function TileGrid({ tiles, keepGroups = true, onCustomize }: { tiles: DashboardTile[]; keepGroups?: boolean; onCustomize?: () => void }) {
  const shown = inNativeApp()
    ? tiles.filter((t) => !APP_HIDDEN_TILES.has(t.key)).map((t) => (t.links ? { ...t, links: t.links.filter((l) => !APP_HIDDEN_LINKS.has(l.href)) } : t))
    : tiles;
  const gridTiles = shown.filter((t) => !CRM_CARD_TILES.has(t.key));
  if (!gridTiles.length) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-5 sm:flex-row sm:items-center sm:justify-between" data-testid="text-dashboard-tiles-empty">
        <p className="text-sm text-muted-foreground">You've hidden every tool from your dashboard. They're all still in the menu.</p>
        {onCustomize && (
          <Button variant="outline" size="sm" className="min-h-10 sm:min-h-8" onClick={onCustomize}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Choose tools
          </Button>
        )}
      </div>
    );
  }
  if (!keepGroups) {
    const open = gridTiles.filter((t) => t.status !== "locked");
    const locked = gridTiles.filter((t) => t.status === "locked");
    return (
      <section aria-labelledby="dashboard-group-all" data-testid="section-dashboard-all">
        <GoogleSectionHeader title={<span id="dashboard-group-all">Your tools</span>} description="In your order." />
        {open.length > 0 && (
          <div className={GRID_COLS}>
            {open.map((tile) => <DashboardTileCard key={tile.key} tile={tile} />)}
          </div>
        )}
        {locked.length > 0 && <LockedRow group="all" tiles={locked} spaced={open.length > 0} />}
      </section>
    );
  }
  const byKey = new Map(gridTiles.map((t) => [t.key, t]));
  return (
    <div className="space-y-8">
      {dashboardGroupsInOrder(gridTiles.map((t) => t.key)).map(({ key, tiles: keys }) => {
        const group = DASHBOARD_GROUPS.find((g) => g.key === key)!;
        const inGroup = keys.map((k) => byKey.get(k)!).filter(Boolean);
        if (!inGroup.length) return null;
        const open = inGroup.filter((t) => t.status !== "locked");
        const locked = inGroup.filter((t) => t.status === "locked");
        const headingId = `dashboard-group-${group.key}`;
        return (
          <section key={group.key} aria-labelledby={headingId} data-testid={`section-dashboard-${group.key}`}>
            <GoogleSectionHeader title={<span id={headingId}>{group.label}</span>} description={group.blurb} />
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
