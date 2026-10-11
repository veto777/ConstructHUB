// Browser regression fixture only; never imported by the application.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrlActions } from "./url-actions";
import { ReportTable, MetricTiles, analyticsColumns, cloudflareColumns } from "./report";
import { LocationSearchSummary } from "@/pages/site-connections";
import "@/index.css";
const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
  const response = await fetch(String(queryKey[0]));
  if (!response.ok) throw new Error("Regression fixture unavailable");
  return response.json();
} } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><main className="g-surface mx-auto max-w-5xl space-y-6 p-4">
  <h1>Round 8 component regression fixture</h1>
  <UrlActions assets={[{ id: 1, name: "Example property", external_id: "sc-domain:example.com" }]} busy={false} submit={async () => false} />
  <MetricTiles metrics={[{ label: "Clicks", value: 18928 }, { label: "Impressions", value: 19522 }]} />
  <ReportTable caption="Search Console" columns={analyticsColumns} rows={[{ clicks: 18928, impressions: 19522, date: "2026-10-01", key: "Test row" }]} />
  <ReportTable caption="Cloudflare" columns={cloudflareColumns.countries} rows={[{ country: "Test row", requests: 18928, threats: 19522 }]} />
  <LocationSearchSummary locationId={1} />
</main></QueryClientProvider>);
