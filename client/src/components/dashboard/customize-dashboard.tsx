import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Reorder, motion, useDragControls } from "framer-motion";
import { ChevronDown, ChevronUp, GripVertical, Lock, RotateCcw } from "lucide-react";
import {
  DASHBOARD_GROUPS, DASHBOARD_TILES,
  type DashboardGroupKey, type DashboardPayload, type DashboardTileDef, type DashboardTileKey,
} from "@shared/dashboard";
import {
  DASHBOARD_CRM_CARD_TILES, DASHBOARD_SECTIONS, dashboardGroupsInOrder, defaultDashboardLayout, groupContiguous,
  isDefaultDashboardLayout, type DashboardLayout, type DashboardSectionKey,
} from "@shared/dashboard-prefs";
import { PLANS } from "@shared/plans";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSaveLayout } from "./use-dashboard-prefs";

type Row = {
  key: DashboardTileKey;
  title: string;
  group: DashboardGroupKey;
  /** Plan name when the account's plan doesn't include it (it can be shown or hidden, never unlocked here). */
  lockedPlan: string | null;
  comingSoon: boolean;
};

/** `subset` (a reordered slice of `order`) written back into the slots its keys held. */
function placeSubset(order: readonly DashboardTileKey[], subset: readonly DashboardTileKey[]): DashboardTileKey[] {
  const inSubset = new Set(subset);
  let i = 0;
  return order.map((k) => (inSubset.has(k) ? subset[i++] : k));
}

function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** One draggable row: the grip drags (pointer) or moves with the arrow keys (keyboard). */
function SortableRow({ value, label, index, count, onMove, children, hidden }: {
  value: DashboardTileKey;
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  children: ReactNode;
  hidden: boolean;
}) {
  const controls = useDragControls();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : e.key === "Home" ? 0 : e.key === "End" ? count - 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to !== index && to >= 0 && to < count) onMove(to);
  };
  return (
    <Reorder.Item
      as="li"
      value={value}
      dragListener={false}
      dragControls={controls}
      className="relative flex items-center gap-1 rounded-md border bg-card py-1 pl-1 pr-1"
      data-testid={`customize-tile-${value}`}
      data-hidden={hidden ? "true" : "false"}
    >
      <button
        type="button"
        className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
        onKeyDown={onKey}
        aria-label={`Reorder ${label}, position ${index + 1} of ${count}`}
        aria-describedby="customize-reorder-help"
        data-testid={`handle-customize-${value}`}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {children}
      <Button
        type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 sm:h-8 sm:w-8"
        aria-label={`Move ${label} up`}
        aria-disabled={index === 0}
        onClick={() => index > 0 && onMove(index - 1)}
        data-testid={`button-customize-up-${value}`}
      >
        <ChevronUp className={cn("h-4 w-4", index === 0 && "opacity-30")} aria-hidden="true" />
      </Button>
      <Button
        type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0 sm:h-8 sm:w-8"
        aria-label={`Move ${label} down`}
        aria-disabled={index === count - 1}
        onClick={() => index < count - 1 && onMove(index + 1)}
        data-testid={`button-customize-down-${value}`}
      >
        <ChevronDown className={cn("h-4 w-4", index === count - 1 && "opacity-30")} aria-hidden="true" />
      </Button>
    </Reorder.Item>
  );
}

/**
 * "Customize dashboard": every tool in the catalogue with a show/hide checkbox
 * and its place in the order (drag the grip, use the arrows, or focus the grip
 * and press ↑ ↓ Home End), the page sections, grouped or one list, Select
 * all / none and Reset to default. Nothing changes until Save; the layout is
 * saved to the account (PUT /api/dashboard/layout), so it follows the user to
 * every device. Locked tools stay locked: hiding or showing them never changes
 * what the plan includes.
 */
export function CustomizeDashboard({ open, onOpenChange, data, flagOff }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DashboardPayload;
  /** Tiles a client feature flag turns off: never offered. */
  flagOff: (key: DashboardTileKey) => boolean;
}) {
  const save = useSaveLayout();
  const { toast } = useToast();
  const [draft, setDraft] = useState<DashboardLayout>(data.layout);
  const [announce, setAnnounce] = useState("");
  const wasOpen = useRef(false);

  // A fresh draft from the saved layout each time the sheet opens.
  useEffect(() => {
    if (open && !wasOpen.current) { setDraft(data.layout); setAnnounce(""); }
    wasOpen.current = open;
  }, [open, data.layout]);

  const rows = useMemo(() => {
    const status = new Map<DashboardTileKey, { lockedPlan: string | null; comingSoon: boolean }>();
    for (const t of data.tiles) {
      status.set(t.key, {
        lockedPlan: t.status === "locked" ? (t.requiredPlan ? PLANS[t.requiredPlan].name : "a paid") : null,
        comingSoon: t.status === "coming_soon",
      });
    }
    for (const h of data.hiddenTiles) {
      status.set(h.key, {
        lockedPlan: !h.entitled && !h.comingSoon ? (h.requiredPlan ? PLANS[h.requiredPlan].name : "a paid") : null,
        comingSoon: !!h.comingSoon,
      });
    }
    const out = new Map<DashboardTileKey, Row>();
    for (const def of DASHBOARD_TILES as readonly DashboardTileDef[]) {
      if (DASHBOARD_CRM_CARD_TILES.has(def.key) || flagOff(def.key)) continue;
      const s = status.get(def.key) ?? { lockedPlan: null, comingSoon: false };
      out.set(def.key, { key: def.key, title: def.title, group: def.group, ...s });
    }
    return out;
  }, [data.tiles, data.hiddenTiles, flagOff]);

  const listed = (keys: readonly DashboardTileKey[]) => keys.filter((k) => rows.has(k));
  const hidden = new Set(draft.hidden);
  const allKeys = listed(draft.order);
  const shownCount = allKeys.filter((k) => !hidden.has(k)).length;

  const setOrder = (order: DashboardTileKey[]) => setDraft((d) => ({ ...d, order }));
  const toggleTile = (key: DashboardTileKey, show: boolean) =>
    setDraft((d) => ({ ...d, hidden: show ? d.hidden.filter((k) => k !== key) : [...d.hidden.filter((k) => k !== key), key] }));
  const setAll = (show: boolean) =>
    setDraft((d) => ({ ...d, hidden: show ? d.hidden.filter((k) => !rows.has(k)) : Array.from(new Set([...d.hidden, ...listed(d.order)])) }));
  const toggleSection = (key: DashboardSectionKey, on: boolean) => setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: on } }));
  const setKeepGroups = (on: boolean) => setDraft((d) => ({ ...d, keepGroups: on, order: on ? groupContiguous(d.order) : d.order }));

  /** Move within one visible list (a group's tools, or the whole list). */
  const moveIn = (list: DashboardTileKey[], where: string) => (key: DashboardTileKey) => (to: number) => {
    const from = list.indexOf(key);
    if (from < 0) return;
    const next = moveTo(list, from, to);
    setOrder(placeSubset(draft.order, next));
    setAnnounce(`${rows.get(key)?.title} moved to position ${to + 1} of ${list.length}${where}.`);
  };

  const groups = dashboardGroupsInOrder(draft.order);
  const moveGroup = (from: number, to: number) => {
    if (to < 0 || to >= groups.length) return;
    setOrder(moveTo(groups, from, to).flatMap((g) => g.tiles));
    const label = DASHBOARD_GROUPS.find((g) => g.key === groups[from].key)?.label;
    setAnnounce(`${label} moved to position ${to + 1} of ${groups.length}.`);
  };

  const renderList = (keys: DashboardTileKey[], where: string) => {
    const move = moveIn(keys, where);
    return (
      <Reorder.Group
        as="ul"
        axis="y"
        values={keys}
        onReorder={(next: DashboardTileKey[]) => setOrder(placeSubset(draft.order, next))}
        className="space-y-1.5"
      >
        {keys.map((key, i) => {
          const row = rows.get(key)!;
          const id = `customize-check-${key}`;
          const shown = !hidden.has(key);
          return (
            <SortableRow key={key} value={key} label={row.title} index={i} count={keys.length} onMove={move(key)} hidden={!shown}>
              <Checkbox
                id={id}
                checked={shown}
                onCheckedChange={(v) => toggleTile(key, v === true)}
                className="ml-1 h-5 w-5"
                data-testid={`checkbox-customize-${key}`}
              />
              <label htmlFor={id} className={cn("flex min-h-10 min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-2 text-sm", !shown && "text-muted-foreground")}>
                <span className="min-w-0 truncate font-medium">{row.title}</span>
                {row.lockedPlan && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-testid={`badge-customize-locked-${key}`}>
                    <Lock className="h-3 w-3" aria-hidden="true" /> {row.lockedPlan} plan
                  </span>
                )}
                {row.comingSoon && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Coming soon</span>}
              </label>
            </SortableRow>
          );
        })}
      </Reorder.Group>
    );
  };

  const onSave = () => {
    save.mutate(draft, {
      onSuccess: () => toast({ title: "Dashboard saved", description: "Your layout is saved to your account." }),
    });
    onOpenChange(false);
  };

  const isDefault = isDefaultDashboardLayout(draft);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" data-testid="sheet-customize-dashboard">
        <SheetHeader className="border-b px-4 py-4 pr-12 text-left sm:px-6">
          <SheetTitle>Customize dashboard</SheetTitle>
          <SheetDescription>Choose what shows and in what order. It's saved to your account, so it follows you to every device.</SheetDescription>
        </SheetHeader>

        <motion.div layoutScroll className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <fieldset>
            <legend className="text-sm font-semibold">Tools</legend>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground" data-testid="text-customize-count">{shownCount} of {allKeys.length} shown</p>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="min-h-10 sm:min-h-8" onClick={() => setAll(true)} data-testid="button-customize-select-all">Select all</Button>
                <Button type="button" variant="ghost" size="sm" className="min-h-10 sm:min-h-8" onClick={() => setAll(false)} data-testid="button-customize-select-none">Select none</Button>
              </div>
            </div>
            <div className="mt-2 flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
              <label htmlFor="customize-keep-groups" className="cursor-pointer text-sm">
                <span className="font-medium">Keep groups</span>
                <span className="block text-xs text-muted-foreground">
                  {draft.keepGroups ? "Tools sit under Grow, Protect, Win jobs… Order the groups and the tools in each." : "One list, in exactly your order."}
                </span>
              </label>
              <Switch id="customize-keep-groups" checked={draft.keepGroups} onCheckedChange={setKeepGroups} data-testid="switch-customize-keep-groups" />
            </div>
            <p id="customize-reorder-help" className="mt-2 text-xs text-muted-foreground">
              Drag the grip, use the arrows, or focus the grip and press ↑ ↓ (Home / End for first / last). Hidden tools leave the grid; their alerts still show in Needs you today until you clear them.
            </p>

            <div className="mt-3">
              {draft.keepGroups ? (
                <div className="space-y-5">
                  {groups.map((g, gi) => {
                    const meta = DASHBOARD_GROUPS.find((x) => x.key === g.key)!;
                    const keys = listed(g.tiles);
                    return (
                      <section key={g.key} aria-labelledby={`customize-group-${g.key}`} data-testid={`customize-group-${g.key}`}>
                        <div className="mb-1.5 flex items-center gap-1">
                          <h3 id={`customize-group-${g.key}`} className="min-w-0 flex-1 text-sm font-medium">{meta.label}</h3>
                          <Button
                            type="button" variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8"
                            aria-label={`Move the ${meta.label} group up`} aria-disabled={gi === 0}
                            onClick={() => moveGroup(gi, gi - 1)}
                            data-testid={`button-customize-group-up-${g.key}`}
                          >
                            <ChevronUp className={cn("h-4 w-4", gi === 0 && "opacity-30")} aria-hidden="true" />
                          </Button>
                          <Button
                            type="button" variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8"
                            aria-label={`Move the ${meta.label} group down`} aria-disabled={gi === groups.length - 1}
                            onClick={() => moveGroup(gi, gi + 1)}
                            data-testid={`button-customize-group-down-${g.key}`}
                          >
                            <ChevronDown className={cn("h-4 w-4", gi === groups.length - 1 && "opacity-30")} aria-hidden="true" />
                          </Button>
                        </div>
                        {g.key === "run" && (
                          <p className="mb-1.5 text-xs text-muted-foreground">Your CRM, schedule and leads numbers are the CRM snapshot (under Sections).</p>
                        )}
                        {keys.length > 0 ? renderList(keys, ` in ${meta.label}`) : <p className="text-xs text-muted-foreground">Nothing else here.</p>}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <>
                  <p className="mb-1.5 text-xs text-muted-foreground">Your CRM, schedule and leads numbers are the CRM snapshot (under Sections).</p>
                  {renderList(allKeys, "")}
                </>
              )}
            </div>
          </fieldset>
          <fieldset className="mt-6">
            <legend className="text-sm font-semibold">Sections</legend>
            <ul className="mt-2 space-y-1">
              {DASHBOARD_SECTIONS.map((s) => {
                const id = `customize-section-${s.key}`;
                return (
                  <li key={s.key} className="flex items-start gap-3 rounded-md px-1 py-1.5">
                    <Checkbox
                      id={id}
                      checked={draft.sections[s.key]}
                      onCheckedChange={(v) => toggleSection(s.key, v === true)}
                      className="mt-0.5 h-5 w-5"
                      aria-describedby={`${id}-desc`}
                      data-testid={`checkbox-customize-section-${s.key}`}
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
                      <span className="font-medium">{s.label}</span>
                      <span id={`${id}-desc`} className="block text-xs text-muted-foreground">{s.description}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <span className="sr-only" role="status" aria-live="polite" data-testid="text-customize-live">{announce}</span>
        </motion.div>

        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-6">
          <Button
            type="button" variant="ghost" size="sm" className="mr-auto min-h-10"
            onClick={() => { setDraft(defaultDashboardLayout()); setAnnounce("Back to the default layout. Save to keep it."); }}
            disabled={isDefault}
            data-testid="button-customize-reset"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Reset to default
          </Button>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => onOpenChange(false)} data-testid="button-customize-cancel">Cancel</Button>
          <Button type="button" className="min-h-10" onClick={onSave} disabled={save.isPending} data-testid="button-customize-save">Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
