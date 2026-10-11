// Browser-only test harness; never imported by the application.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HubWidget from "./hub-widget";
import "../../index.css";
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json() } } });
client.setQueryData(["/api/auth/me"], { id: 1 });
Object.assign(window, { hubTest: {
  switchUser: (id: number) => client.setQueryData(["/api/auth/me"], { id }),
  entitlement: () => client.setQueryData(["/api/entitlements"], { plan: "changed" }),
  invalidateEntitlement: () => client.invalidateQueries({ queryKey: ["/api/entitlements"] }),
  keys: () => client.getQueryCache().getAll().map((q) => q.queryKey),
} });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={client}><main><h1>Gabe recovery test fixture</h1><button>Page action</button></main><HubWidget surface="growth" signedIn /></QueryClientProvider>);
