/**
 * "Interested in: Roofing, Windows — explored 3×, last Oct 17" — what a client
 * explored with the self-estimate tool on their estimate page / portal
 * (server/crm/self-estimate.ts). Contractor side only; the API answers only
 * seats that write estimates, so the hook stays off for everyone else.
 */
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { InterestSummary } from "@shared/self-estimate";

export type InterestMap = {
  byEstimate: Record<string, InterestSummary & { text: string | null }>;
  byCustomer: Record<string, InterestSummary & { text: string | null }>;
};

/** The org-wide interest map (one request for a whole list). */
export function useClientInterest(enabled: boolean, filter?: { customerId?: string; estimateId?: string }) {
  const qs = filter?.customerId ? `?customerId=${encodeURIComponent(filter.customerId)}`
    : filter?.estimateId ? `?estimateId=${encodeURIComponent(filter.estimateId)}` : "";
  return useQuery<InterestMap>({
    queryKey: [`/api/crm/self-estimate/interest${qs}`],
    enabled,
    retry: false,
    staleTime: 60_000,
  }).data;
}

export function InterestBadge({ summary, compact = false, testId }: {
  summary?: (InterestSummary & { text: string | null }) | null;
  compact?: boolean;
  testId?: string;
}) {
  if (!summary?.text) return null;
  const label = compact
    ? `${summary.requested ? "Asked for a price" : "Interested"}: ${summary.trades.map((t) => t[0].toUpperCase() + t.slice(1)).join(", ")}`
    : summary.text;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-full ${
        summary.requested
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
      }`}
      title={summary.text}
      data-testid={testId ?? "badge-client-interest"}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
