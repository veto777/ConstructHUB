import { Link } from "wouter";
import { ExternalLink, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/queryClient";
import { LoadingCard, useOptionalQuery } from "./shared";
import type { SettingsSectionProps } from "./types";

/**
 * Workspace → Integrations: every connected service in one list, as
 * GET /api/account/integrations reports it. Each row links to the page where
 * that connection is managed; nothing here holds a token itself.
 */

type IntegrationStatus = "connected" | "not_connected" | "reconnect";
type IntegrationItem = { id: string; service: string; status: IntegrationStatus; detail?: string | null; manageHref?: string | null };

const STATUS: Record<IntegrationStatus, { label: string; className: string }> = {
  connected: { label: "Connected", className: "text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950" },
  not_connected: { label: "Not connected", className: "text-muted-foreground" },
  reconnect: { label: "Reconnect needed", className: "text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950" },
};

/** Where each connection is managed when the status endpoint isn't on this server yet (routes in App.tsx). */
const MANAGE_PAGES: { service: string; href: string }[] = [
  { service: "Google Business Profile", href: "/locations" },
  { service: "Cloudflare", href: "/cloudflare" },
  { service: "Google Search Console", href: "/search-console" },
  { service: "Google Ads & Local Services Ads", href: "/ads-manager" },
  { service: "Gmail (mail alerts)", href: "/mail-alerts" },
  { service: "Domain registrar", href: "/domains" },
  { service: "HOVER & lead capture (CRM)", href: "/crm/integrations" },
  { service: "Stripe payments (CRM)", href: "/crm/payments" },
];

function ManageLink({ href, label, testId }: { href: string; label: string; testId: string }) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <Button asChild size="sm" variant="outline">
        <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>{label} <ExternalLink className="h-3.5 w-3.5 ml-1" /></a>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href} data-testid={testId}>{label}</Link>
    </Button>
  );
}

export function IntegrationsSection(_props: SettingsSectionProps) {
  const { data, error, isLoading } = useOptionalQuery<{ items: IntegrationItem[] }>("/api/account/integrations");

  if (isLoading) return <LoadingCard label="Checking connections…" />;

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive" role="alert" data-testid="text-integrations-error">
          Couldn't load your integrations. {apiErrorMessage(error)}
        </CardContent>
      </Card>
    );
  }

  if (data === null) {
    return (
      <Card data-testid="card-integrations-unavailable">
        <CardHeader>
          <CardTitle className="text-lg">Connection status isn't available on this server yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Each connection is still managed on its own page. Once the status service is installed, this page lists every connection with its state in one place.
          </p>
          <ul className="divide-y">
            {MANAGE_PAGES.map((p) => (
              <li key={p.href} className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="row-integration-page">
                <span className="text-sm font-medium">{p.service}</span>
                <ManageLink href={p.href} label="Open" testId={`link-integration-page-${p.href.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "")}`} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6" data-testid="section-integrations">
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="text-center py-10 px-4" data-testid="text-integrations-empty">
              <Plug className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No integrations reported</p>
              <p className="text-sm text-muted-foreground mt-1">Connected services appear here with their status.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const status = STATUS[item.status] ?? STATUS.not_connected;
                return (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-testid={`row-integration-${item.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium" data-testid={`text-integration-service-${item.id}`}>{item.service}</p>
                        <Badge variant="outline" className={`text-[10px] ${status.className}`} data-testid={`badge-integration-status-${item.id}`}>{status.label}</Badge>
                      </div>
                      {item.detail && <p className="text-xs text-muted-foreground mt-0.5 break-words" data-testid={`text-integration-detail-${item.id}`}>{item.detail}</p>}
                    </div>
                    {item.manageHref && (
                      <ManageLink href={item.manageHref} label={item.status === "connected" ? "Manage" : item.status === "reconnect" ? "Reconnect" : "Connect"} testId={`link-integration-manage-${item.id}`} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
