import { ExternalLink, Plug } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleList, GoogleListRow, GooglePill } from "@/components/google";
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
  connected: { label: "Connected", className: "g-open" },
  not_connected: { label: "Not connected", className: "" },
  reconnect: { label: "Reconnect needed", className: "g-closed" },
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
    return <GooglePill icon={ExternalLink} size="sm" href={href} external label={label} testId={testId} />;
  }
  return <GooglePill size="sm" href={href} label={label} testId={testId} />;
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
          <CardTitle className="text-base">Connection status isn't available on this server yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Each connection is still managed on its own page. Once the status service is installed, this page lists every connection with its state in one place.
          </p>
          <GoogleList as="ul">
            {MANAGE_PAGES.map((p) => (
              <GoogleListRow as="li" size="md" key={p.href} testId="row-integration-page" title={p.service}
                trailing={<ManageLink href={p.href} label="Open" testId={`link-integration-page-${p.href.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "")}`} />} />
            ))}
          </GoogleList>
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6" data-testid="section-integrations">
      {/* Google's list format (owner, 2026-10-07): hairline rows, the status on the meta line, a pill to manage. */}
      <div>
          {items.length === 0 ? (
            <div className="text-center py-10 px-4" data-testid="text-integrations-empty">
              <Plug className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="font-medium">No integrations reported</p>
              <p className="text-sm text-muted-foreground mt-1">Connected services appear here with their status.</p>
            </div>
          ) : (
            <GoogleList as="ul">
              {items.map((item) => {
                const status = STATUS[item.status] ?? STATUS.not_connected;
                return (
                  <GoogleListRow
                    as="li"
                    size="md"
                    key={item.id}
                    testId={`row-integration-${item.id}`}
                    title={<span data-testid={`text-integration-service-${item.id}`}>{item.service}</span>}
                    meta={[
                      <span key="s" className={status.className} data-testid={`badge-integration-status-${item.id}`}>{status.label}</span>,
                      item.detail ? <span key="d" data-testid={`text-integration-detail-${item.id}`}>{item.detail}</span> : null,
                    ]}
                    trailing={item.manageHref ? (
                      <ManageLink href={item.manageHref} label={item.status === "connected" ? "Manage" : item.status === "reconnect" ? "Reconnect" : "Connect"} testId={`link-integration-manage-${item.id}`} />
                    ) : undefined}
                  />
                );
              })}
            </GoogleList>
          )}
      </div>
    </div>
  );
}
