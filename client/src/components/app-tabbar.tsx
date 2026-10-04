import { Home, Phone, Star, MapPin, Menu, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * The platform's phone tab bar — the counterpart of the CRM's ribbon (crm-ribbon.tsx), so the signed-in platform
 * works like an app on a phone (owner, 2026-10-04: "make this project more app friendly"). Four everyday pages and
 * "Menu", which opens the full sidebar. Phones only (below md); the desktop sidebar is unchanged.
 */
const TABS: { href: string; icon: LucideIcon; label: string; testid: string; active: (l: string) => boolean }[] = [
  { href: "/", icon: Home, label: "Home", testid: "tabbar-home", active: (l) => l === "/" || l === "/dashboard" },
  { href: "/call-assistant", icon: Phone, label: "Calls", testid: "tabbar-call-assistant", active: (l) => l.startsWith("/call-assistant") },
  { href: "/google-reviews", icon: Star, label: "Reviews", testid: "tabbar-reviews", active: (l) => l.startsWith("/google-reviews") },
  { href: "/locations", icon: MapPin, label: "Locations", testid: "tabbar-locations", active: (l) => l.startsWith("/locations") },
];

function Tab({ icon: Icon, label, active }: { icon: LucideIcon; label: string; active: boolean }) {
  return (
    <>
      <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-primary/10")}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} />
      </span>
      <span className="text-[10px] font-semibold leading-none">{label}</span>
    </>
  );
}

const tabClass = (active: boolean) =>
  cn("flex flex-1 flex-col items-center gap-1 py-1.5 min-h-[52px] transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground");

export function AppTabBar() {
  const [location] = useLocation();
  const { setOpenMobile, openMobile } = useSidebar();
  return (
    <nav data-testid="app-tabbar" aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-background/90 backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {TABS.map((t) => {
        const active = t.active(location);
        return (
          <Link key={t.href} href={t.href} data-testid={t.testid} className={tabClass(active)} aria-current={active ? "page" : undefined}>
            <Tab icon={t.icon} label={t.label} active={active} />
          </Link>
        );
      })}
      <button type="button" data-testid="tabbar-menu" className={tabClass(openMobile)} onClick={() => setOpenMobile(true)} aria-label="Open the menu">
        <Tab icon={Menu} label="Menu" active={openMobile} />
      </button>
    </nav>
  );
}
