import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * The sales-tax rate a new estimate gets from the client's (or project's)
 * job-site address — GET /api/crm/tax/estimate-rate, resolved by
 * server/crm/tax.ts (division city override → state construction treatment →
 * official city rate → division/org default). `label` is the one line shown
 * under Tax %: "Bellingham, WA · 9.2% (WA DOR, Q4 2026)".
 */
export type EstimateTaxRate = {
  bps: number;
  source: "city" | "construction-exempt" | "official" | "division" | "org" | "none";
  label: string;
  city: string | null;
  state: string | null;
  fallbackReason: string | null;
};

export function useEstimateTaxRate(customerId: string | null | undefined, enabled: boolean, projectId?: string | null) {
  const qs = new URLSearchParams({ customerId: customerId ?? "" });
  if (projectId) qs.set("projectId", projectId);
  return useQuery<EstimateTaxRate>({
    queryKey: ["/api/crm/tax/estimate-rate", customerId ?? "", projectId ?? ""],
    queryFn: async () => (await apiRequest("GET", `/api/crm/tax/estimate-rate?${qs}`)).json(),
    enabled: !!customerId && enabled,
    staleTime: 0,
    retry: false,
  });
}

/** Percent text for a Tax % input: 920 → "9.2", 888 → "8.88". */
export const bpsToPctText = (bps: number) => String(Number((bps / 100).toFixed(2)));

/** The line under Tax %: where the rate came from, and whether the user changed it. */
export function TaxRateNote({ rate, loading, currentBps }: { rate?: EstimateTaxRate; loading?: boolean; currentBps?: number }) {
  if (loading) return <p className="text-xs text-muted-foreground" data-testid="text-tax-source">Looking up the tax rate for the client's address…</p>;
  if (!rate) return null;
  const changed = currentBps !== undefined && currentBps !== rate.bps;
  const warn = rate.source === "none" || rate.fallbackReason != null || / — check$/.test(rate.label);
  return (
    <p className={`text-xs ${warn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="text-tax-source">
      {rate.label}
      {changed && <span className="text-muted-foreground"> · you changed it (suggested {bpsToPctText(rate.bps)}%)</span>}
    </p>
  );
}
