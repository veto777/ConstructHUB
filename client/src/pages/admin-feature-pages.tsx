import { AppPage } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GooglePill, GoogleSectionHeader, GoogleStat, GoogleStatGrid } from "@/components/google";
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
  ready: { label: "Ready", className: "!text-[var(--g-green)]", title: "Written and checked; in the sitemap" },
  stub: { label: "Stub", className: "!text-[var(--g-red)]", title: "Placeholder: title, one line and the in-app link only" },
  external: { label: "Own page", className: "", title: "A hand-built page outside the feature template" },
  page: { label: "Page", className: "", title: "A site page" },
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
      {/* Google's list format (owner, 2026-10-07): a quiet header, stat tiles, hairline rows with pill links. */}
      <GoogleSectionHeader as="h1" title="Feature pages" description="Review public pages and open their tools." flush actions={<>
        <GooglePill variant="solid" href={data.catalogue} label="Open public catalogue" testId="link-admin-features-catalogue" />
        {data.services && <GooglePill href={data.services} label="Services catalogue" testId="link-admin-dfy-catalogue" />}
      </>} />
      <div data-testid="text-feature-pages-counts">
        <GoogleStatGrid cols={3}>
          <GoogleStat label="Features written" value={data.counts.ready} hint={`of ${data.counts.ready + data.counts.stub} feature pages`} />
          <GoogleStat label="Feature stubs" value={data.counts.stub} />
          <GoogleStat label="Services written" value={data.serviceCounts?.ready ?? 0} hint={`of ${(data.serviceCounts?.ready ?? 0) + (data.serviceCounts?.stub ?? 0)} service pages`} />
        </GoogleStatGrid>
      </div>
      <div className="mt-6 space-y-8">
        {groups.map((group) => (
          <section key={group.key} data-testid={`card-admin-feature-group-${group.key}`}>
            <GoogleSectionHeader title={group.label} count={group.rows.length} flush />
            <GoogleList as="ul">
              {group.rows.map((row) => {
                const status = STATUS[row.status];
                return (
                  <GoogleListRow
                    as="li"
                    size="md"
                    key={row.key}
                    testId={`row-admin-feature-${row.key}`}
                    data-status={row.status}
                    title={row.title}
                    badges={<span className={`g-chip g-chip--sm !normal-case ${status.className}`} title={status.title}>{status.label}</span>}
                    meta={[
                      <Link key="public" href={row.path} data-testid={`link-admin-feature-public-${row.key}`}>{row.path}</Link>,
                      row.app ? (
                        <DashLink key="app" href={row.app.href} surface={row.app.surface} className="inline-flex items-center gap-1" data-testid={`link-admin-feature-app-${row.key}`}>
                          {row.app.surface === "portal" ? `CRM ${row.app.href}` : row.app.href}
                          {row.app.surface === "portal" && <ExternalLink className="h-3 w-3" aria-hidden="true" />}
                        </DashLink>
                      ) : null,
                    ]}
                    line={row.legacyPath ? <>Replaces {row.legacyPath}{row.status === "ready" ? " (redirects here)" : " (still live until this page is ready)"}</> : undefined}
                  />
                );
              })}
            </GoogleList>
          </section>
        ))}
      </div>
    </AppPage>
  );
}
