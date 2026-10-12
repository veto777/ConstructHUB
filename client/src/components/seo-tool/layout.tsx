/**
 * The SEO tool shell (owner, 2026-10-09: inside SEO "have the entire sidebar to all other tools vanish and have the
 * side icons for each tool and the sub categories"). Under /seo the app's sidebar is not rendered; the generic
 * <ToolShell> (components/tool/shell.tsx) carries the navigation from the config in ./nav.ts, and "All tools" — one
 * click, first thing in the bar — lists the rest of ConstructHUB.
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, GraduationCap, KanbanSquare, Settings } from "lucide-react";
import { CHLogo } from "@/components/ch-logo";
import { APP_NAV } from "@/components/app-sidebar";
import { useSidebar } from "@/components/ui/sidebar";
import { ToolShell } from "@/components/tool/shell";
import { nextTabIndex } from "@/components/tool/tabs";
import { inNativeApp } from "@/lib/app-shell";
import { SHOW_GOOGLE_REVIEWS } from "@/lib/features";
import type { SeoSite, SeoStatus } from "@/pages/seo/shell";
import { seoNav } from "./nav";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./seo-layout.css";

type NavEntry = { title: string; url: string; icon?: any; logo?: string; logoComponent?: (props: { className?: string }) => JSX.Element };

function Glyph({ item }: { item: NavEntry }) {
  if (item.logoComponent) return <item.logoComponent className="h-[18px] w-[18px] shrink-0" />;
  if (item.logo) return <img src={item.logo} alt="" />;
  if (item.icon) return <item.icon aria-hidden="true" />;
  return null;
}

/** Every other ConstructHUB tool, as the sidebar lists them (its own lists: APP_NAV). Social Media`s shell uses it too. */
export function AllTools({ close }: { close: () => void }) {
  const [location] = useLocation();
  const item = (i: NavEntry, sub = false) => (
    <Link key={i.url} href={i.url} onClick={close} className={`tool-all__item${sub ? " tool-all__sub" : ""}`} aria-current={location === i.url ? "page" : undefined} data-testid={`all-tools-${i.url.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}`}>
      {!sub && <Glyph item={i} />}<span>{i.title}</span>
    </Link>
  );
  const group = (g: { label: string; icon: any; logo?: string; logoComponent?: NavEntry["logoComponent"]; children: NavEntry[] }) => (
    <div className="tool-all__group" key={g.label}>
      <div className="tool-all__item" style={{ fontWeight: 600 }}><Glyph item={{ title: g.label, url: "", icon: g.icon, logo: g.logo, logoComponent: g.logoComponent }} /><span>{g.label}</span></div>
      {g.children.filter(APP_NAV.shownHere).map((c) => item(c, true))}
    </div>
  );
  return (
    <nav className="tool-all" aria-label="All ConstructHUB tools">
      <div className="tool-all__group">
        <Link href="/" onClick={close} className="tool-all__item" data-testid="all-tools-home"><ArrowLeft aria-hidden="true" /><span>Back to ConstructHUB home</span></Link>
        {item({ title: "CRM", url: "/crm-app", icon: KanbanSquare })}
      </div>
      {group(APP_NAV.permitsGroup)}
      {APP_NAV.googleGroups.map(group)}
      <div className="tool-all__group">
        <div className="tool-all__title">Tools</div>
        {SHOW_GOOGLE_REVIEWS && item(APP_NAV.googleReviewsItem)}
        {APP_NAV.standaloneItems.filter(APP_NAV.shownHere).map((i) => item(i))}
      </div>
      <div className="tool-all__group">
        <div className="tool-all__title">Help and account</div>
        {item({ title: "Tutorials", url: "/tutorials", icon: GraduationCap })}
        {item({ title: "Account settings", url: "/settings", icon: Settings })}
        {!inNativeApp() && APP_NAV.pricingGroup.children.slice(0, 1).map((c) => item({ ...c, title: "Plans and pricing" }))}
      </div>
    </nav>
  );
}

export function SeoToolLayout({ actions, banner, footer, children }: { actions?: ReactNode; banner?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [path] = useLocation();
  const search = useSearch();
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const reveal = () => {
      const header = host.querySelector<HTMLElement>(".tool-top");
      host.style.setProperty("--seo-header-height", `${header?.getBoundingClientRect().height ?? 0}px`);
      const strip = host.querySelector<HTMLElement>(".tool-top__tabs .tool-tabs__scroll");
      const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!strip || !active) return;
      const box = strip.getBoundingClientRect(), tab = active.getBoundingClientRect();
      // Recheck after fonts, the global input and viewport changes settle. Sideways only.
      if (tab.left < box.left + 48) strip.scrollLeft -= box.left + 48 - tab.left;
      else if (tab.right > box.right - 48) strip.scrollLeft += tab.right - box.right + 48;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    host.querySelectorAll(".tool-top, .tool-top__tabs, .tool-top__tabs nav").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [path, search]);
  const { setOpenMobile } = useSidebar();
  const sites = useQuery<SeoSite[]>({ queryKey: ["/api/seo/sites"] });
  const status = useQuery<SeoStatus>({ queryKey: ["/api/seo/status"] });
  // The chosen site, as the pages choose it (pages/seo/shell.tsx useSelectedSite): the address, else the remembered one, else the first.
  const domain = useMemo(() => {
    const list = sites.data ?? [];
    let remembered: number | null = null;
    try { remembered = Number(window.localStorage.getItem("seo:site")) || null; } catch { /* private window */ }
    const wanted = Number(new URLSearchParams(search).get("site")) || remembered;
    return (list.find((s) => s.id === wanted) ?? list[0])?.domain ?? null;
  }, [sites.data, search]);
  const config = useMemo(() => seoNav({ domain }), [domain]);
  const ctx = { path, params: new URLSearchParams(search) };
  return (
    <div ref={root} className="seo-layout" onKeyDownCapture={(event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      const list = target.closest(".tool-top__tabs .tool-tabs__list");
      if (!list) return;
      const all = Array.from(list.querySelectorAll<HTMLElement>(":scope > a"));
      const visible = all.filter((link) => link.getClientRects().length > 0);
      if (visible.length === all.length) return; // The shared strip handles the full list.
      const current = visible.indexOf(target);
      if (current < 0) return;
      const next = nextTabIndex(event.key, current, visible.length);
      if (next === null) return;
      event.preventDefault(); event.stopPropagation();
      visible[next].focus({ preventScroll: true });
    }}>
    <ToolShell config={config} testId="seo-tool-shell"
      brand={<Link href="/" aria-label="ConstructHUB home" title="ConstructHUB home" data-testid="link-tool-home"><CHLogo height={26} /></Link>}
      allToolsNote="Everything else in ConstructHUB. SEO stays where you left it." allTools={(close) => <AllTools close={close} />} onAllToolsPhone={() => setOpenMobile(true)}
      actions={<><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="tool-top__all seo-more" data-testid="seo-more">More</button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70dvh] overflow-y-auto" aria-label="More SEO tools">
          {config.tools.map((tool) => <DropdownMenuItem key={tool.key} asChild><Link href={tool.to(ctx)} aria-current={tool.path === path || tool.paths?.includes(path) ? "page" : undefined} className="min-h-11 focus-visible:outline focus-visible:outline-2">{tool.label}</Link></DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>{actions}</>} badges={{ alerts: status.data?.alertsUnread || undefined }} banner={banner} footer={footer}>
      {children}
    </ToolShell>
    </div>
  );
}
