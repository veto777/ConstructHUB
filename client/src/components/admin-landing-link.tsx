/**
 * The admins' "see the landing page" icon in the app's top bar (owner, 2026-10-16: "every page the admin tools
 * control … should have an icon on the top that lets you see the landing pages for each of these features. We
 * need to be able to view those internally too in case they need to be updated").
 *
 * Platform admins only (the server decides: /api/auth/me isPlatformAdmin). The page → intro page map comes from
 * each feature's own `app.href` (shared/feature-pages landingPagesForAppPath). Several features on one page →
 * a menu. A sidebar tool with no intro page yet shows a muted icon that says so, so the gap is visible.
 * Links open in a new tab, at the preview path a signed-in admin can see (/call-assistant → its intro page).
 */
import { useQuery } from "@tanstack/react-query";
import { PanelsTopLeft } from "lucide-react";
import { landingPagesForAppPath, type AppLandingPage } from "@shared/feature-pages";
import { APP_NAV } from "@/components/app-sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BUTTON = "inline-flex items-center justify-center rounded-md h-10 w-10 transition-colors";

/** Every tool URL in the app's sidebar: the pages where a missing intro page is worth flagging. */
const SIDEBAR_TOOL_URLS: ReadonlySet<string> = new Set([
  // Admin-only pages (Scrape Schedules) are internal tools with no public page to show.
  ...APP_NAV.permitsGroup.children.filter((c) => !c.adminOnly).map((c) => c.url),
  ...APP_NAV.googleGroups.flatMap((g) => g.children.flatMap((c) => [c.url, ...(c.subChildren ?? []).map((s) => s.url)])),
  APP_NAV.googleReviewsItem.url,
  APP_NAV.yelpReviewsItem.url,
  ...APP_NAV.standaloneItems.filter((i) => !i.crmPath).map((i) => i.url),
]);

const statusNote = (page: AppLandingPage) => (page.status === "stub" ? " (draft)" : "");

export function AdminLandingLink({ location }: { location: string }) {
  const { data: user } = useQuery<{ isPlatformAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  if (user?.isPlatformAdmin !== true) return null;

  const pages = landingPagesForAppPath(location);
  if (pages.length === 0) {
    if (!SIDEBAR_TOOL_URLS.has(location)) return null;
    return (
      <span className={`${BUTTON} text-muted-foreground/40 cursor-help`} title="No landing page for this tool yet"
        aria-label="No landing page for this tool yet" data-testid="admin-landing-none">
        <PanelsTopLeft className="h-4 w-4" />
      </span>
    );
  }
  if (pages.length === 1) {
    const [page] = pages;
    const label = `See the landing page: ${page.title}${statusNote(page)}`;
    return (
      <a href={page.preview} target="_blank" rel="noopener" title={label} aria-label={label} data-testid="admin-landing-link"
        className={`${BUTTON} text-muted-foreground hover:text-foreground hover:bg-accent`}>
        <PanelsTopLeft className="h-4 w-4" />
      </a>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title="See the landing pages" aria-label="See the landing pages" data-testid="admin-landing-menu"
          className={`${BUTTON} text-muted-foreground hover:text-foreground hover:bg-accent`}>
          <PanelsTopLeft className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Landing pages</DropdownMenuLabel>
        {pages.map((page) => (
          <DropdownMenuItem key={page.key} asChild>
            <a href={page.preview} target="_blank" rel="noopener" data-testid={`admin-landing-link-${page.key}`}>
              {page.title}{statusNote(page)}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
