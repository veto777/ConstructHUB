// Isolated browser regression fixture. Never imported by the application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { CartProvider } from "@/contexts/cart-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import MasterClassPage from "@/pages/master-class";
import { SpamView } from "@/pages/crm-call-assistant/calls";
import { CloudflareDetails, DataList } from "@/pages/site-connections";
import { ReportTrend, SavedDataSummary, analyticsColumns } from "./report";
import "@/index.css";
queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false, staleTime: Infinity } });
queryClient.setQueryData(["/api/auth/me"], { id: 101 });
Object.assign(window, { prefilm: {
  refresh: (prefix: string) => queryClient.refetchQueries({ predicate: q => String(q.queryKey[0]).startsWith(prefix) }),
  switchUser: (id: number) => queryClient.setQueryData(["/api/auth/me"], { id }),
} });
function Reports() {
  const [reversed, setReversed] = useState(false);
  const rows = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10), clicks: reversed ? 90 - i : i + 1 }));
  return <main className="mx-auto max-w-5xl space-y-4 p-4">
    <h1>Reporting regression fixture</h1>
    <button onClick={() => setReversed(v => !v)}>Change periods</button>
    <ReportTrend rows={rows} label="Daily clicks" value={r => r.clicks} date={r => r.date} />
    <SavedDataSummary>
      <DataList title="Search analytics" url="/api/test/report" columns={analyticsColumns} sortable render={() => null} />
      <DataList title="Other report" url="/api/test/other" columns={analyticsColumns} sortable render={() => null} />
    </SavedDataSummary>
  </main>;
}
const fixture = new URLSearchParams(location.search).get("fixture");
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><CartProvider><TooltipProvider>
  {fixture === "course" ? <MasterClassPage /> : fixture === "spam" ? <main className="p-4"><SpamView canManage={false} onOpen={() => {}} /></main> : fixture === "cloudflare" ? <main className="p-4"><SavedDataSummary><CloudflareDetails id={1} onFlag={() => {}} /></SavedDataSummary></main> : <Reports />}
</TooltipProvider></CartProvider></QueryClientProvider>);
