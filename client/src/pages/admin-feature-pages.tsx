import { AppPage, PageHeader, Section, Stat, StatGrid } from "@/components/app-ui";
import { Button } from "@/components/ui/button";
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
    <AppPage testId="page-admin-feature-pages">
      <PageHeader title="Feature pages" description="Review public pages and open their tools." actions={<>
        <Button asChild><Link href={data.catalogue} data-testid="link-admin-features-catalogue">Open public catalogue</Link></Button>
        {data.services && <Button asChild variant="outline"><Link href={data.services} data-testid="link-admin-dfy-catalogue">Services catalogue</Link></Button>}
      </>} />
      <div data-testid="text-feature-pages-counts">
        <StatGrid cols={3}>
          <Stat label="Features written" value={data.counts.ready} hint={`of ${data.counts.ready + data.counts.stub} feature pages`} />
          <Stat label="Feature stubs" value={data.counts.stub} />
          <Stat label="Services written" value={data.serviceCounts?.ready ?? 0} hint={`of ${(data.serviceCounts?.ready ?? 0) + (data.serviceCounts?.stub ?? 0)} service pages`} />
        </StatGrid>
      </div>
      <div className="mt-6 space-y-6">
        {groups.map((group) => (
          <Section flush key={group.key} className="overflow-hidden" testId={`card-admin-feature-group-${group.key}`}>
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
          </Section>
        ))}
      </div>
    </AppPage>
  );
}
