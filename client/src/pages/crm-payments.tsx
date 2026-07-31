import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CreditCard, Landmark, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Unplug, ShieldCheck,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, SectionTitle, statusTone,
} from "@/components/crm-ui";

export default function CrmPaymentsPage() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/payments/status"] });
  const canSeePrices = me?.permissions?.seePrices === true;
  const { data: payments, isError: paymentsError } = useQuery<any[]>({
    queryKey: ["/api/crm/payments"], retry: false, enabled: canSeePrices,
  });
  const canManage = me?.permissions?.manageIntegrations === true;

  const connect = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/crm/payments/connect/stripe", undefined)).json(),
    onSuccess: (r: any) => { if (r.url) window.location.href = r.url; },
    onError: (e: any) => toast({ title: "Can't start Stripe connect", description: String(e.message ?? e), variant: "destructive" }),
  });

  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/payments/refresh", {})).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/payments/status"] }); toast({ title: "Refreshed from Stripe" }); },
    onError: (e: any) => toast({ title: "Refresh failed", description: String(e.message ?? e), variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/payments/disconnect", {})).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/payments/status"] }); toast({ title: "Disconnected" }); },
  });

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return (
      <ErrorCard
        title="Couldn't load payment settings"
        description="Check your connection and refresh the page."
      />
    );
  }

  const acct = data.account;
  const params = new URLSearchParams(window.location.search);

  return (
    <CrmPage className="max-w-3xl">
      <CrmPageHeader
        icon={Landmark}
        title="Payments"
        subtitle="Connect your own Stripe account. Money goes straight to you — we never hold it."
      />

      {params.get("connected") === "1" && (
        <Card className="border-emerald-500/50 bg-emerald-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Stripe connected</div>
              {params.get("ach") === "off" && (
                <p className="text-sm text-muted-foreground mt-1">
                  ACH isn't active on your Stripe account yet. Enable ACH Direct Debit in Stripe,
                  then hit Refresh below — it's the difference between $5 and $725 on a $25,000 deposit.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {params.get("error") && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Connection failed</div>
              <p className="text-sm text-muted-foreground mt-1">{params.get("error")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!data.configured && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Not configured on this server</div>
              <p className="text-sm text-muted-foreground mt-1">
                Missing environment {data.missing.length === 1 ? "variable" : "variables"}:{" "}
                <code>{data.missing.join(", ")}</code>. Add {data.missing.length === 1 ? "it" : "them"} to
                the server <code>.env</code> and restart. <code>STRIPE_CONNECT_CLIENT_ID</code> comes from
                Stripe → Settings → Connect → Onboarding options.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <SectionTitle
            title="Your payment account"
            description={acct ? "Connected via Stripe Connect (Standard)." : "No account connected yet."}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {acct ? (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Landmark className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="font-medium">{acct.businessName || acct.accountEmail || acct.externalAccountId}</div>
                  <div className="text-muted-foreground text-xs font-mono">{acct.externalAccountId}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={acct.chargesEnabled ? "success" : "danger"}>
                  {acct.chargesEnabled ? "Charges enabled" : "Charges disabled"}
                </StatusPill>
                <StatusPill tone={acct.achEnabled ? "success" : "neutral"}>
                  ACH {acct.achEnabled ? "on" : "off"}
                </StatusPill>
                <StatusPill tone={acct.cardEnabled ? "success" : "neutral"}>
                  Card {acct.cardEnabled ? "on" : "off"}
                </StatusPill>
                {!acct.livemode && <StatusPill tone="warning">test mode</StatusPill>}
              </div>
              {!acct.achEnabled && (
                <p className="text-sm text-muted-foreground">
                  ACH is off. On a $25,000 deposit that's <strong>$725 on card versus $5 on ACH</strong> —
                  worth enabling in your Stripe dashboard.
                </p>
              )}
              {acct.lastError && <p className="text-sm text-destructive">{acct.lastError}</p>}
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}
                    data-testid="button-refresh-payments">
                    {refresh.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh from Stripe
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
                    data-testid="button-disconnect-payments">
                    <Unplug className="h-4 w-4 mr-2" /> Disconnect
                  </Button>
                </div>
              )}
            </>
          ) : canManage ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                Take card and ACH payments on your estimates and invoices.
              </p>
              <Button onClick={() => connect.mutate()} disabled={connect.isPending || !data.configured}
                data-testid="button-connect-stripe">
                {connect.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Connect Stripe
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Ask an admin to connect a payment account.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle
            title="Recent payments"
            description="Online (Stripe) and manually recorded (check, cash, bank transfer)."
          />
        </CardHeader>
        <CardContent className="space-y-2">
          {!canSeePrices ? (
            <p className="text-sm text-muted-foreground">You don't have permission to see payments.</p>
          ) : paymentsError ? (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Couldn't load payments — refresh to try again.
            </p>
          ) : !payments?.length ? (
            <EmptyState
              compact
              icon={CreditCard}
              title="No payments yet"
              description="Nothing yet. Payments appear here when a client pays online or you record one from a client's page."
            />
          ) : null}
          {payments?.slice(0, 50).map((p: any) => (
            <div key={p.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2"
              data-testid={`payment-${p.id}`}>
              <div>
                <div className="font-medium tabular-nums">
                  ${((p.amountCents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  <span className="text-muted-foreground font-normal text-sm">
                    {" "}· {p.method ?? p.provider} · {p.purpose}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(p.createdAt).toLocaleString()}
                  {p.note ? ` · ${p.note}` : ""}
                </div>
              </div>
              <StatusPill tone={statusTone(p.status)}>{p.status}</StatusPill>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle icon={ShieldCheck} title="What we promise, in writing" />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(data.disclosure as Record<string, string>).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground">•</span><span>{v}</span>
            </div>
          ))}
          <Separator className="my-2" />
          <p className="text-xs text-muted-foreground">
            We say the last one plainly because it's true of every platform, and because
            hiding it is what makes a frozen deposit feel like a betrayal.
          </p>
        </CardContent>
      </Card>
    </CrmPage>
  );
}
