/**
 * The tool shell: the frame of a multi-view tool (styles: client/src/styles/tool.css, `.tool-shell*`).
 *
 *   ┌ navy top bar ─ row 1: brand · "All tools" · the tools as tabs · the app's own controls
 *   │                row 2: the tool's global input (a slot the page fills: site switcher, add a site, balance)
 *   ├ icon rail ─ one icon + small label per tool (active: orange icon and indicator)
 *   ├ sub-navigation ─ the active tool's views: ungrouped first, then collapsible bold groups
 *   └ content ─ a slim line (hamburger + where you are), then the page
 *
 * Everything is driven by a config object (`ToolShellConfig`): a tool is a route, a sub-item is a real deep link
 * (route + query) — the shell never invents a view. The item whose parameters match the address is the current one,
 * so the sub-navigation, the back button and any link into a view agree.
 *
 * Sizes: from 1024px the sub-navigation sits beside the page (the hamburger collapses it, remembered); below that
 * it is a drawer over the page; below 768px the rail is gone — the tools are the top bar's sideways-scrolling tabs —
 * and the page's slot scrolls with the page so the bar stays two short rows.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronDown, LayoutGrid, PanelLeft } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToolTabs, TabCount } from "./tabs";

export type ToolNavCtx = { path: string; params: URLSearchParams };
export type ToolSubItem = {
  key: string; label: string;
  /** The item's address, built from the current one (so the chosen site / domain / keyword carries over). */
  to: (ctx: ToolNavCtx) => string;
  /** The route this item lives on when it is not the tool's own. */
  path?: string;
  /** The query parameters that make this view the current one (all must match). */
  params?: Record<string, string>;
  /** Shown only when true for the current address (e.g. sections that need a keyword). */
  when?: (ctx: ToolNavCtx) => boolean;
  isNew?: boolean;
};
export type ToolSubGroup = { key: string; label?: string; items: ToolSubItem[]; when?: (ctx: ToolNavCtx) => boolean };
export type ToolDef = {
  key: string; label: string;
  /** A shorter label for the rail (two short lines at most). */
  rail?: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  path: string;
  /** Other routes that belong to this tool. */
  paths?: string[];
  to: (ctx: ToolNavCtx) => string;
  groups: ToolSubGroup[];
  /** Sits at the bottom of the rail (settings-like). */
  foot?: boolean;
};
export type ToolShellConfig = { key: string; label: string; tools: ToolDef[] };

/** The tool a route belongs to (the first tool when none claims it). */
export function toolOf(config: ToolShellConfig, path: string): ToolDef {
  return config.tools.find((t) => t.path === path || t.paths?.includes(path)) ?? config.tools[0];
}

/** The groups and items shown for the current address. */
export function shownGroups(tool: ToolDef, ctx: ToolNavCtx): ToolSubGroup[] {
  return tool.groups.filter((g) => !g.when || g.when(ctx)).map((g) => ({ ...g, items: g.items.filter((i) => !i.when || i.when(ctx)) })).filter((g) => g.items.length > 0);
}

/**
 * The sub-item the address is on: on the item's route, with every one of its parameters matching; the most specific
 * match wins (an item with no parameters is the tool's plain view).
 */
export function activeSubItem(tool: ToolDef, ctx: ToolNavCtx): ToolSubItem | null {
  let best: ToolSubItem | null = null, score = -1;
  for (const g of shownGroups(tool, ctx)) for (const i of g.items) {
    if ((i.path ?? tool.path) !== ctx.path) continue;
    const entries = Object.entries(i.params ?? {});
    if (!entries.every(([k, v]) => ctx.params.get(k) === v)) continue;
    // An item on another route of the tool outranks the tool's plain view when the address is on that route.
    const s = entries.length + (i.path ? 0.5 : 0);
    if (s > score) { best = i; score = s; }
  }
  return best;
}

const SlotContext = createContext<HTMLElement | null>(null);
/** The top bar's second row: a page renders its global input there with a portal (null outside a tool shell). */
export const useToolSlot = () => useContext(SlotContext);

/** Renders its children in the tool bar's second row (a page's own global input, e.g. a domain box); in place outside a tool shell. */
export function ToolBarSlot({ children }: { children: ReactNode }) {
  const slot = useToolSlot();
  return slot ? createPortal(children, slot) : <>{children}</>;
}

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private window */ } };

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query), f = () => setOn(m.matches);
    f(); m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

export function ToolShell({ config, brand, allToolsLabel = "All tools", allToolsNote, allTools, onAllToolsPhone, actions, badges, banner, footer, children, testId }: {
  config: ToolShellConfig;
  /** The product mark, as a link back to the main app. */
  brand: ReactNode;
  allToolsLabel?: string;
  /** One line under the drawer's title. */
  allToolsNote?: string;
  /** The full list of the product's tools — the way back to everything else. Rendered in a drawer. */
  allTools: (close: () => void) => ReactNode;
  /** On phones the product already has its own menu sheet: open that instead of the drawer. */
  onAllToolsPhone?: () => void;
  /** The app's own controls (notifications, settings, cart, theme), kept reachable in row 1. */
  actions?: ReactNode;
  /** A count on a tool (tool key → count), e.g. unread alerts. */
  badges?: Record<string, number | undefined>;
  banner?: ReactNode; footer?: ReactNode; children: ReactNode; testId?: string;
}) {
  const [path] = useLocation();
  const search = useSearch();
  const ctx = useMemo<ToolNavCtx>(() => ({ path, params: new URLSearchParams(search) }), [path, search]);
  const tool = toolOf(config, path);
  const groups = shownGroups(tool, ctx);
  const current = activeSubItem(tool, ctx);
  const hasSub = groups.reduce((n, g) => n + g.items.length, 0) > 1;

  const wide = useMedia("(min-width: 1024px)"), phone = useMedia("(max-width: 767px)");
  const [pinned, setPinned] = useState(() => read(`tool.${config.key}.subnav`) !== "0");
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [closed, setClosed] = useState<string[]>(() => { try { const v = JSON.parse(read(`tool.${config.key}.groups`) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } });
  // A link followed closes the drawers.
  useEffect(() => { setDrawer(false); setMenu(false); }, [path, search]);
  useEffect(() => {
    if (!drawer) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [drawer]);

  const subOpen = hasSub && (wide ? pinned : drawer);
  const toggleSub = useCallback(() => {
    if (wide) setPinned((p) => { write(`tool.${config.key}.subnav`, p ? "0" : "1"); return !p; });
    else setDrawer((d) => !d);
  }, [wide, config.key]);
  const toggleGroup = (key: string) => setClosed((c) => { const next = c.includes(key) ? c.filter((k) => k !== key) : [...c, key]; write(`tool.${config.key}.groups`, JSON.stringify(next)); return next; });
  const openAll = () => { if (phone && onAllToolsPhone) onAllToolsPhone(); else setMenu(true); };

  const main = config.tools.filter((t) => !t.foot), foot = config.tools.filter((t) => t.foot);
  const railItem = (t: ToolDef) => (
    <Link key={t.key} href={t.to(ctx)} className="tool-rail__item" aria-current={t.key === tool.key ? "page" : undefined} title={t.label} data-testid={`tool-rail-${t.key}`}>
      <t.icon aria-hidden="true" />
      <span>{t.rail ?? t.label}</span>
      {badges?.[t.key] ? <span className="tool-rail__badge" aria-label={`${badges[t.key]} new`}>{badges[t.key]}</span> : null}
    </Link>
  );

  const tabs = (
    <ToolTabs label={`${config.label} tools`} tone="dark" sticky={false} bleed={false} testId="tool-tabs">
      {config.tools.map((t) => <Link key={t.key} href={t.to(ctx)} aria-current={t.key === tool.key ? "page" : undefined} data-testid={`tool-tab-${t.key}`}>{t.label}{badges?.[t.key] ? <TabCount label={`${badges[t.key]} new`}>{badges[t.key]}</TabCount> : null}</Link>)}
    </ToolTabs>
  );

  return (
    <SlotContext.Provider value={slot}>
      <div className="tool-shell g-surface" data-tool={config.key} data-subnav-inline={wide && subOpen ? "true" : undefined} data-testid={testId}>
        <header className="tool-top" data-testid="tool-top">
          <div className="tool-top__row">
            <span className="tool-top__brand">{brand}</span>
            <button type="button" className="tool-top__all" onClick={openAll} aria-haspopup="dialog" aria-expanded={menu} data-testid="button-all-tools"><LayoutGrid aria-hidden="true" /> {allToolsLabel}</button>
            {!phone && (
              <div className="tool-top__tabs">
                {tabs}
              </div>
            )}
            {actions && <div className="tool-top__actions">{actions}</div>}
          </div>
          {phone && (
            <div className="tool-top__tabs">
              {tabs}
            </div>
          )}
          {!phone && <div className="tool-top__row2"><div className="tool-slot" ref={setSlot} data-testid="tool-slot" /></div>}
        </header>
        {banner}
        <div className="tool-body">
          <nav className="tool-rail" aria-label={`${config.label} tools`} data-testid="tool-rail">
            {main.map(railItem)}
            {foot.length > 0 && <span className="tool-rail__sep" aria-hidden="true" />}
            {foot.map(railItem)}
          </nav>
          {hasSub && <button type="button" className="tool-subnav__backdrop" data-open={!wide && drawer ? "true" : undefined} aria-label="Close the menu" tabIndex={-1} onClick={() => setDrawer(false)} />}
          {hasSub && (
            <nav className="tool-subnav" id={`tool-subnav-${config.key}`} data-open={subOpen ? "true" : undefined} aria-label={`${tool.label} views`} data-testid="tool-subnav">
              <p className="tool-subnav__title">{tool.label}</p>
              {groups.map((g) => {
                const open = !g.label || !closed.includes(`${tool.key}:${g.key}`);
                return (
                  <div key={g.key}>
                    {g.label && (
                      <button type="button" className="tool-subnav__group" aria-expanded={open} aria-controls={`tool-subnav-${tool.key}-${g.key}`} onClick={() => toggleGroup(`${tool.key}:${g.key}`)} data-testid={`subnav-group-${tool.key}-${g.key}`}>
                        {g.label}<ChevronDown aria-hidden="true" />
                      </button>
                    )}
                    {open && (
                      <ul className="tool-subnav__items" id={`tool-subnav-${tool.key}-${g.key}`}>
                        {g.items.map((i) => (
                          <li key={i.key}>
                            <Link href={i.to(ctx)} className="tool-subnav__item" aria-current={current?.key === i.key ? "page" : undefined} data-testid={`subnav-${tool.key}-${i.key}`}>
                              <span>{i.label}</span>{i.isNew && <span className="tool-chip tool-chip--new">New</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
          <main className="tool-main" data-testid="tool-main">
            {phone && <div className="tool-slot tool-slot--page" ref={setSlot} data-testid="tool-slot" />}
            <div className="tool-crumb">
              {hasSub && <button type="button" className="tool-btn tool-btn--icon tool-btn--quiet" onClick={toggleSub} aria-expanded={subOpen} aria-controls={`tool-subnav-${config.key}`} aria-label={subOpen ? `Hide the ${tool.label} menu` : `Show the ${tool.label} menu`} title={subOpen ? "Hide the menu" : "Show the menu"} data-testid="button-subnav-toggle"><PanelLeft aria-hidden="true" /></button>}
              <span>{config.label}</span><span className="tool-crumb__sep" aria-hidden="true">/</span>
              {current && hasSub ? <><Link href={tool.to(ctx)}>{tool.label}</Link><span className="tool-crumb__sep" aria-hidden="true">/</span><b>{current.label}</b></> : <b>{tool.label}</b>}
            </div>
            <div className="tool-main__content">{children}</div>
            {footer}
          </main>
        </div>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" className="w-[min(22rem,92vw)] overflow-y-auto p-4" data-testid="all-tools">
            <SheetHeader className="mb-3 text-left">
              <SheetTitle>{allToolsLabel}</SheetTitle>
              <SheetDescription>{allToolsNote ?? `Everything else. ${config.label} stays where you left it.`}</SheetDescription>
            </SheetHeader>
            {allTools(() => setMenu(false))}
          </SheetContent>
        </Sheet>
      </div>
    </SlotContext.Provider>
  );
}
