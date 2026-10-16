/**
 * /admin/referrals — the referral program (server/referrals): who referred whom, how far each referral got, and
 * the reward. Platform admins only. An unpaid reward (or a referral) can be voided here; an applied one is already
 * in Stripe and is reversed there.
 *
 * Look (owner 2026-10-15, the SEO Suite dashboard): a stat row with the count per status and the rewards' money,
 * status chips that filter the list (plus a typed status, for a word the chips don't offer), and hairline rows with
 * the key facts and the Void actions as pills. Everything is filtered here from the one list the API returns.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Ban, Loader2 } from "lucide-react";
import { AppPage, PageHeader } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { SegmentedTabs, TabCount } from "@/components/tool";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { StatusPill, type PillTone } from "@/components/crm-ui";
import { useDocumentTitle } from "@/components/feature-landing/primitives";
import { appPageTitle } from "@/lib/page-titles";

type Row = {
  id: number; status: string; reason: string | null; kind: string | null; product: string | null; tier: string | null;
  qualified_at: string | null; earn_at: string | null; created_at: string; referrer_email: string | null; referred_email: string | null;
  paid_invoices: number; reward_id: number | null; reward_status: string | null; amount_cents: number | null; applied_at: string | null; reward_reason: string | null;
};
const STATUSES = ["pending", "qualified", "rewarded", "void"] as const;
const TONE: Record<string, PillTone> = { pending: "neutral", qualified: "info", rewarded: "success", void: "danger", earned: "warning", applying: "info", applied: "success" };
const CUSTOM = "custom";
const usd = (c: number | null) => (c == null ? "" : `$${(c / 100).toFixed(2)}`);
const day = (d: string | null) => (d ? format(new Date(d), "MMM d, yyyy") : "—");
const norm = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, " ");
/** A typed status matches the referral's status or its reward's status. */
const matchesTyped = (r: Row, typed: string) => { const q = norm(typed); return !!q && (norm(r.status) === q || (!!r.reward_status && norm(r.reward_status) === q)); };

export default function AdminReferralsPage() {
  useDocumentTitle(appPageTitle("/admin/referrals")!);
  const { toast } = useToast();
  const [filter, setFilter] = useState("all");
  const [typed, setTyped] = useState("");
  const q = useQuery<{ referrals: Row[] }>({ queryKey: ["/api/admin/referrals"] });
  const done = { onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/referrals"] }); toast({ title: "Voided" }); }, onError: (e: unknown) => toast({ title: "Couldn't void", description: apiErrorMessage(e), variant: "destructive" as const }) };
  const voidReferral = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/admin/referrals/${id}/void`, {}), ...done });
  const voidReward = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/admin/referrals/rewards/${id}/void`, {}), ...done });
  const all = q.data?.referrals ?? [];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of all) c[r.status] = (c[r.status] ?? 0) + 1; return c; }, [all]);
  const rows = filter === "all" ? all : filter === CUSTOM ? all.filter((r) => matchesTyped(r, typed)) : all.filter((r) => r.status === filter);
  const waiting = all.filter((r) => r.reward_status === "earned");
  const applied = all.filter((r) => r.reward_status === "applied");
  const cents = (list: Row[]) => list.reduce((n, r) => n + (r.amount_cents ?? 0), 0);

  return (
    <AppPage testId="page-admin-referrals">
      <PageHeader title="Referrals" description="Every sign-up from a referral link, how far it got, and the referrer's reward; void the ones that should not stand." />
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /> : q.error ? <p className="text-sm text-destructive">{apiErrorMessage(q.error)}</p> : (
        <div className="space-y-4">
          <GoogleStatGrid cols={4}>
            <GoogleStat label="Referrals" value={all.length} hint={`${counts.pending ?? 0} pending · ${counts.qualified ?? 0} qualified`} testId="stat-referrals-total" />
            <GoogleStat label="Rewarded" value={counts.rewarded ?? 0} hint={`${counts.void ?? 0} void`} testId="stat-referrals-rewarded" />
            <GoogleStat label="Rewards waiting to apply" value={waiting.length} hint={usd(cents(waiting)) || "$0.00"} tone={waiting.length ? "bad" : "default"} testId="stat-referrals-waiting" />
            <GoogleStat label="Rewards applied" value={applied.length} hint={usd(cents(applied)) || "$0.00"} testId="stat-referrals-applied" />
          </GoogleStatGrid>

          <div className="flex flex-wrap items-center gap-3">
            <SegmentedTabs as="tablist" label="Filter by status">
              {[{ key: "all", label: "All", n: all.length }, ...STATUSES.map((s) => ({ key: s, label: s.replace(/^./, (c) => c.toUpperCase()), n: counts[s] ?? 0 })), { key: CUSTOM, label: "Custom…", n: null as number | null }].map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} onClick={() => setFilter(c.key)} data-testid={`filter-referral-${c.key}`}>
                  {c.label}{c.n !== null && <TabCount>{c.n}</TabCount>}
                </button>
              ))}
            </SegmentedTabs>
            {filter === CUSTOM && (
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type a status, e.g. earned" aria-label="Status to match" className="h-9 w-56 max-sm:h-11" autoFocus data-testid="input-referral-status-custom" />
            )}
          </div>

          {rows.length === 0 ? (
            <div className="g-callout" data-testid="empty-referrals">
              <h2>{all.length === 0 ? "No referrals yet" : "No referral matches"}</h2>
              <p>{all.length === 0 ? "A row appears here when someone signs up through a referral link." : filter === CUSTOM ? "Type a referral status (pending, qualified, rewarded, void) or a reward status (earned, applying, applied)." : "Pick another status."}</p>
            </div>
          ) : (
            <GoogleList as="ul" testId="list-referrals">
              {rows.map((r) => (
                <GoogleListRow
                  as="li"
                  size="md"
                  key={r.id}
                  testId={`row-referral-${r.id}`}
                  title={<span className="break-all">{r.referrer_email ?? "—"} → {r.referred_email ?? "—"}</span>}
                  badges={<>
                    <StatusPill tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusPill>
                    {r.reward_status && <StatusPill tone={TONE[r.reward_status] ?? "neutral"}>reward {r.reward_status} {usd(r.amount_cents)}</StatusPill>}
                  </>}
                  meta={[
                    `Signed up ${day(r.created_at)}`,
                    `${r.paid_invoices} paid invoice${r.paid_invoices === 1 ? "" : "s"}`,
                    r.kind ? `${r.kind === "month" ? "free month" : "30% annual"} (${r.product} ${r.tier})` : null,
                    r.kind ? `earns ${day(r.earn_at)}` : null,
                  ]}
                  line={r.reason || r.reward_reason ? <>{r.reason}{r.reason && r.reward_reason ? " · " : ""}{r.reward_reason && <span className="text-destructive">{r.reward_reason}</span>}</> : undefined}
                  actions={(r.reward_id && r.reward_status === "earned") || ["pending", "qualified"].includes(r.status) ? <>
                    {r.reward_id && r.reward_status === "earned" && <GooglePill size="sm" icon={Ban} label="Void reward" disabled={voidReward.isPending} onClick={() => voidReward.mutate(r.reward_id!)} testId={`button-void-reward-${r.reward_id}`} />}
                    {["pending", "qualified"].includes(r.status) && <GooglePill size="sm" variant="danger" icon={Ban} label="Void referral" disabled={voidReferral.isPending} onClick={() => voidReferral.mutate(r.id)} testId={`button-void-referral-${r.id}`} />}
                  </> : undefined}
                />
              ))}
            </GoogleList>
          )}
        </div>
      )}
    </AppPage>
  );
}
