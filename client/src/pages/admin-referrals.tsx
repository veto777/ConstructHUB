/**
 * /admin/referrals — the referral program (server/referrals): who referred whom, how far each referral got, and
 * the reward. Platform admins only. An unpaid reward (or a referral) can be voided here; an applied one is already
 * in Stripe and is reversed there.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { AppPage, PageHeader } from "@/components/app-ui";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";

type Row = {
  id: number; status: string; reason: string | null; kind: string | null; product: string | null; tier: string | null;
  qualified_at: string | null; earn_at: string | null; created_at: string; referrer_email: string | null; referred_email: string | null;
  paid_invoices: number; reward_id: number | null; reward_status: string | null; amount_cents: number | null; applied_at: string | null; reward_reason: string | null;
};
const TONE: Record<string, PillTone> = { pending: "neutral", qualified: "info", rewarded: "success", void: "danger", earned: "warning", applying: "info", applied: "success" };
const usd = (c: number | null) => (c == null ? "" : `$${(c / 100).toFixed(2)}`);
const day = (d: string | null) => (d ? format(new Date(d), "MMM d, yyyy") : "—");

export default function AdminReferralsPage() {
  useDocumentTitle("Referrals · Admin");
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");
  const q = useQuery<{ referrals: Row[] }>({ queryKey: ["/api/admin/referrals"] });
  const done = { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] }); toast({ title: "Voided" }); }, onError: (e: unknown) => toast({ title: "Couldn't void", description: apiErrorMessage(e), variant: "destructive" as const }) };
  const voidReferral = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/admin/referrals/${id}/void`, {}), ...done });
  const voidReward = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/admin/referrals/rewards/${id}/void`, {}), ...done });
  const rows = (q.data?.referrals ?? []).filter((r) => filter === "all" || r.status === filter);
  return (
    <AppPage testId="page-admin-referrals">
      <PageHeader title="Referrals" description="New sign-ups from a referral link, their paid invoices, and the referrer's reward." />
      <div className="mb-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-56" data-testid="select-referral-filter"><SelectValue /></SelectTrigger>
          <SelectContent>{["all", "pending", "qualified", "rewarded", "void"].map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All referrals" : s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : q.error ? <p className="text-sm text-destructive">{apiErrorMessage(q.error)}</p> : (
        <Card className="divide-y">
          {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No referrals.</p>}
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm" data-testid={`row-referral-${r.id}`}>
              <div className="min-w-0">
                <p className="font-medium">{r.referrer_email ?? "—"} → {r.referred_email ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  Signed up {day(r.created_at)} · {r.paid_invoices} paid invoice{r.paid_invoices === 1 ? "" : "s"}
                  {r.kind ? ` · ${r.kind === "month" ? "free month" : "30% annual"} (${r.product} ${r.tier}) · earns ${day(r.earn_at)}` : ""}
                  {r.reason ? ` · ${r.reason}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill>
                {r.reward_status && <StatusPill tone={TONE[r.reward_status] ?? "neutral"}>reward {r.reward_status} {usd(r.amount_cents)}</StatusPill>}
                {r.reward_reason && <span className="text-xs text-destructive">{r.reward_reason}</span>}
                {r.reward_id && r.reward_status === "earned" && <Button size="sm" variant="outline" disabled={voidReward.isPending} onClick={() => voidReward.mutate(r.reward_id!)} data-testid={`button-void-reward-${r.reward_id}`}>Void reward</Button>}
                {["pending", "qualified"].includes(r.status) && <Button size="sm" variant="outline" disabled={voidReferral.isPending} onClick={() => voidReferral.mutate(r.id)} data-testid={`button-void-referral-${r.id}`}>Void</Button>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </AppPage>
  );
}
