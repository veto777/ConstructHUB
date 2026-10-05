import { Menu } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { PLATFORM_TAB_DEFAULT, PLATFORM_TAB_OPTIONS, resolveTabs } from "@shared/tab-bar";
import { PLATFORM_TAB_ICONS, activeTabKey, useTabPrefs } from "@/lib/tab-prefs";

/**
 * The platform's phone tab bar — the counterpart of the CRM's ribbon (crm-ribbon.tsx), so the signed-in platform
 * works like an app on a phone (owner, 2026-10-04: "make this project more app friendly"). Four tabs the person picks
 * in Settings → Phone tab bar (owner: "Let the settings allow you to pick what's in your lower Ribbon on mobile and
 * app"; default Home, Calls, Reviews, Locations) and "Menu", which opens the full sidebar. Phones only (below md).
 */
const tabClass = (active: boolean) =>
  cn("flex flex-1 flex-col items-center gap-1 py-1.5 min-h-[52px] transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground");

function TabFace({ icon: Icon, label, active }: { icon: typeof Menu; label: string; active: boolean }) {
  return (
    <>
      <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-primary/10")}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
      </span>
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </>
  );
}

export function AppTabBar() {
  const [location] = useLocation();
  const { setOpenMobile, openMobile } = useSidebar();
  const prefs = useTabPrefs();
  const tabs = resolveTabs(prefs.data?.platformTabs, PLATFORM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT);
  const active = activeTabKey(tabs, location);
  return (
    <nav data-testid="app-tabbar" aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} data-testid={`tabbar-${t.key}`} className={tabClass(active === t.key)} aria-current={active === t.key ? "page" : undefined}>
          <TabFace icon={PLATFORM_TAB_ICONS[t.key] ?? Menu} label={t.label} active={active === t.key} />
        </Link>
      ))}
      <button type="button" data-testid="tabbar-menu" className={tabClass(openMobile)} onClick={() => setOpenMobile(true)} aria-label="Open the menu">
        <TabFace icon={Menu} label="Menu" active={openMobile} />
      </button>
    </nav>
  );
}
