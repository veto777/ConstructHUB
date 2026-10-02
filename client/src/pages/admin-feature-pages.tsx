/**
 * /admin/feature-pages — platform admins' map of every feature intro page:
 * its group, whether it is written yet (stub / ready), the public page and the
 * page inside the app; then every done-for-you service page as a second group;
 * plus /call-assistant, /reinstatement and the home landing. Reached from
 * the sidebar ("Feature pages · ADMIN") and the dashboard header.
 *
 * The list comes from GET /api/admin/feature-pages, which answers 403 to
 * anyone but a platform admin (server/feature-pages.ts); the links themselves
 * are public pages, so nothing here is customer data.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink, LayoutGrid, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DashLink, FOCUS_RING } from "@/components/dashboard/dash-link";
import { useDocumentTitle } from "@/components/feature-landing/primitives";

type Row = {
  key: string;
  group: string;
  groupLabel: string;
  title: string;
  status: "stub" | "ready" | "external" | "page";
  path: string;
  app: { href: string; surface: "app" | "portal" } | null;
  legacyPath: string | null;
  sources: string[];
};
type Counts = { ready: number; stub: number };
type Payload = { catalogue: string; services?: string; pages: Row[]; counts: Counts; serviceCounts?: Counts };

const STATUS: Record<Row["status"], { label: string; className: string; title: string }> = {
  ready: { label: "Ready", className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400", title: "Written and checked; in the sitemap" },
  stub: { label: "Stub", className: "border-amber-500/50 text-amber-700 dark:text-amber-400", title: "Placeholder: title, one line and the in-app link only" },
  external: { label: "Own page", className: "text-muted-foreground", title: "A hand-built page outside the feature template" },
  page: { label: "Page", className: "text-muted-foreground", title: "A site page" },
};

const linkClass = `inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline underline-offset-4 break-all ${FOCUS_RING}`;

export default function AdminFeaturePagesPage() {
  useDocumentTitle("Feature pages | ConstructHUB");
  const { data, isLoading, error } = useQuery<Payload>({ queryKey: ["/api/admin/feature-pages"], retry: false });

  if (isLoading) {
    return <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground" data-testid="page-admin-feature-pages-loading">Loading feature pages…</div>;
  }
  if (error || !data) {
    const forbidden = /^40[13]/.test(String((error as Error | null)?.message ?? ""));
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center" data-testid="page-admin-feature-pages-denied">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{forbidden ? "Platform admins only" : "Couldn't load the feature pages"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {forbidden ? "This page lists every feature page for the people who run ConstructHUB." : "Try again in a moment."}
        </p>
        <Link href="/features" className={`mt-4 ${linkClass}`}>See every feature</Link>
      </div>
    );
  }

  const groups = data.pages.reduce<{ key: string; label: string; rows: Row[] }[]>((acc, row) => {
    const group = acc.find((g) => g.key === row.group) ?? (acc.push({ key: row.group, label: row.groupLabel, rows: [] }), acc[acc.length - 1]);
    group.rows.push(row);
    return acc;
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6" data-testid="page-admin-feature-pages">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Feature pages</h1>
            <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">ADMIN</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-feature-pages-counts">
            {data.counts.ready} of {data.counts.ready + data.counts.stub} feature pages written{data.counts.stub > 0 ? " · the rest are stubs until their copy lands." : " · no stubs left."}
            {data.serviceCounts && ` · ${data.serviceCounts.ready} of ${data.serviceCounts.ready + data.serviceCounts.stub} service pages written.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:items-end">
          <Link href={data.catalogue} className={linkClass} data-testid="link-admin-features-catalogue">
            <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Open the public catalogue ({data.catalogue})
          </Link>
          {data.services && (
            <Link href={data.services} className={linkClass} data-testid="link-admin-dfy-catalogue">
              <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Open the services catalogue ({data.services})
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {groups.map((group) => (
          <Card key={group.key} className="overflow-hidden" data-testid={`card-admin-feature-group-${group.key}`}>
            <div className="grid border-b bg-muted/40 px-4 py-2.5 text-sm md:grid-cols-12">
              <h2 className="font-semibold md:col-span-4">{group.label}</h2>
              <span className="hidden text-xs font-medium text-muted-foreground md:col-span-4 md:block">Public page</span>
              <span className="hidden text-xs font-medium text-muted-foreground md:col-span-4 md:block">In the app</span>
            </div>
            <ul className="divide-y">
              {group.rows.map((row) => {
                const status = STATUS[row.status];
                return (
                  <li key={row.key} className="grid gap-2 px-4 py-3 md:grid-cols-12 md:items-center" data-testid={`row-admin-feature-${row.key}`} data-status={row.status}>
                    <div className="min-w-0 md:col-span-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.title}</span>
                        <Badge variant="outline" className={`font-medium ${status.className}`} title={status.title}>{status.label}</Badge>
                      </div>
                      {row.legacyPath && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Replaces {row.legacyPath}{row.status === "ready" ? " (redirects here)" : " (still live until this page is ready)"}
                        </p>
                      )}
                    </div>
                    <div className="min-w-0 md:col-span-4">
                      <span className="text-xs text-muted-foreground md:hidden">Public page: </span>
                      <Link href={row.path} className={linkClass} data-testid={`link-admin-feature-public-${row.key}`}>{row.path}</Link>
                    </div>
                    <div className="min-w-0 md:col-span-4">
                      {row.app ? (
                        <>
                          <span className="text-xs text-muted-foreground md:hidden">In the app: </span>
                          <DashLink href={row.app.href} surface={row.app.surface} className={linkClass} data-testid={`link-admin-feature-app-${row.key}`}>
                            {row.app.surface === "portal" ? `CRM ${row.app.href}` : row.app.href}
                            {row.app.surface === "portal" && <ExternalLink className="h-3 w-3" aria-hidden="true" />}
                          </DashLink>
                        </>
                      ) : <span className="text-sm text-muted-foreground">—</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
