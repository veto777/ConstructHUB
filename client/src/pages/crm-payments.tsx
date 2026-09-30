import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  CreditCard, Landmark, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Unplug, ShieldCheck, Undo2,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, SectionTitle, statusTone,
} from "@/components/crm-ui";
import { TakePaymentDialog } from "@/components/crm-take-payment";

const money = (c?: number | null) =>
  `$${((c ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Readable labels for the stored slugs on a payment row. */
const PURPOSE_LABELS: Record<string, string> = {
  deposit: "Deposit", progress: "Invoice payment", final: "Final payment",
};
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash", check: "Check", wire: "Wire transfer", credit_card: "Credit card",
  ach: "Bank transfer (ACH)", card: "Card", other: "Other",
};

type ClientLite = { id: string; displayName: string; email: string | null; phone: string | null };

/** Search every client server-side (?q=) — the plain list stops at 500. */
function ClientSearchPicker({ value, onChange }: {
  value: ClientLite | null;
  onChange: (c: ClientLite | null) => void;
}) {
  const [q, setQ] = useState("");
  // The result list opens once the field is used, not on page load.
  const [active, setActive] = useState(false);
  const { data: clients, isFetching } = useQuery<ClientLite[]>({
    queryKey: ["/api/crm/customers", "take-payment-search", q],
    queryFn: async () => {
      const r = await fetch(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !value && active,
  });

  if (value) {
    return (
      <div className="flex flex-1 min-w-56 items-center justify-between rounded-lg border px-3 py-2"
        data-testid="picked-take-client">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{value.displayName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {[value.email, value.phone].filter(Boolean).join(" · ") || "No contact details"}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}
          data-testid="button-change-take-client">Change</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-56 space-y-2">
      <Input placeholder="Search clients by name, email, phone or address"
        value={q} onChange={(e) => { setQ(e.target.value); setActive(true); }} onFocus={() => setActive(true)}
        aria-label="Search clients" data-testid="input-take-client-search" />
      {active && (
        <div className="max-h-56 overflow-y-auto rounded-lg border divide-y" data-testid="take-client-list">
          {(clients ?? []).slice(0, 25).map((c) => (
            <button key={c.id} type="button" onClick={() => onChange(c)}
              data-testid={`take-client-${c.id}`}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent transition-colors">
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{c.displayName}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                </span>
              </span>
            </button>
          ))}
          {clients && clients.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No clients match.</div>
          )}
          {!clients && isFetching && (
            <div className="px-3 py-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          )}
        </div>
      )}
      {active && clients && clients.length > 25 && (
        <p className="text-xs text-muted-foreground">
          Showing 25 of {clients.length >= 500 ? "500+" : clients.length} — type to narrow it down.
        </p>
      )}
    </div>
  );
}

export default function CrmPaymentsPage() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/payments/status"] });
  const canSeePrices = me?.permissions?.seePrices === true;
  const canTakePayment = me?.permissions?.takePayment === true;
  const isOwner = me?.member?.role === "owner";
  const { data: payments, isError: paymentsError } = useQuery<any[]>({
    queryKey: ["/api/crm/payments"], retry: false, enabled: canSeePrices,
  });
  const canManage = me?.permissions?.manageIntegrations === true;

  // Stripe's redirect lands here with ?connected=1 / ?error=… — read it once,
  // then drop it from the address bar so a refresh doesn't replay the banner.
  const [returnParams] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    if (!["connected", "ach", "error"].some((k) => returnParams.has(k))) return;
    const url = new URL(window.location.href);
    ["connected", "ach", "error"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [returnParams]);

  // ── Take a payment: pick a client, then record manual or send a link ──────
  const [takeClient, setTakeClient] = useState<ClientLite | null>(null);
  const [takeOpen, setTakeOpen] = useState(false);
  const takeClientId = takeClient?.id ?? "";
  const { data: takeInvoices } = useQuery<any[]>({
    queryKey: [`/api/crm/invoices?customerId=${takeClientId}`],
    enabled: canTakePayment && !!takeClientId,
  });
  const { data: takeEstimates } = useQuery<any[]>({
    queryKey: [`/api/crm/estimates?customerId=${takeClientId}`],
    enabled: canTakePayment && !!takeClientId, retry: false,
  });
  const { data: takePayments } = useQuery<any[]>({
    queryKey: [`/api/crm/payments?customerId=${takeClientId}`],
    enabled: canTakePayment && canSeePrices && !!takeClientId, retry: false,
  });

  // ── Owner: reverse a mistyped manual payment ──────────────────────────────
  const [reverseFor, setReverseFor] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const reverse = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/payments/${reverseFor.id}/reverse`, { reason: reverseReason })).json(),
    onSuccess: () => {
      toast({ title: "Payment reversed", description: "The invoice balance is restored and the reversal is on the client's notes." });
      setReverseFor(null);
      setReverseReason("");
      queryClient.invalidateQueries({ predicate: (qy) => String(qy.queryKey[0] ?? "").startsWith("/api/crm/payments")
        || String(qy.queryKey[0] ?? "").startsWith("/api/crm/invoices") });
    },
    onError: (e: any) => toast({ title: "Could not reverse the payment", description: apiErrorMessage(e), variant: "destructive" }),
  });

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
    onError: (e: any) => toast({ title: "Could not disconnect", description: String(e.message ?? e), variant: "destructive" }),
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
  const params = returnParams;

  return (
    <CrmPage className="max-w-3xl">
      <CrmPageHeader
        icon={Landmark}
        title="Payments"
        infoKey="payments"
        subtitle="Connect your own Stripe account. Money goes straight to you — we never hold it."
      />

      {/* Only claim "connected" when the server actually has the account. */}
      {params.get("connected") === "1" && acct && (
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

      {canTakePayment && (
        <Card>
          <CardHeader>
            <SectionTitle
              icon={CreditCard}
              title="Take a payment"
              description="Pick a client — send them a secure card/ACH link, or record cash, check or wire you already have."
            />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-start gap-2">
              <ClientSearchPicker value={takeClient} onChange={setTakeClient} />
              <Button onClick={() => setTakeOpen(true)} disabled={!takeClient}
                data-testid="button-open-take-payment">
                <CreditCard className="h-4 w-4 mr-2" /> Take a payment
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              You can also take a payment straight from the client's page — their balance and
              history live there too.
            </p>
          </CardContent>
        </Card>
      )}

      {takeClient && (
        <TakePaymentDialog
          customerName={takeClient.displayName}
          invoices={takeInvoices}
          estimates={takeEstimates}
          payments={takePayments}
          open={takeOpen}
          onOpenChange={setTakeOpen}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/crm/payments"] });
            queryClient.invalidateQueries({ queryKey: [`/api/crm/payments?customerId=${takeClientId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/crm/invoices?customerId=${takeClientId}`] });
          }}
        />
      )}

      <Dialog open={!!reverseFor} onOpenChange={(o) => { if (!o) { setReverseFor(null); setReverseReason(""); } }}>
        <DialogContent className="max-w-md" data-testid="dialog-reverse-payment">
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {reverseFor && <>
                {money(reverseFor.amountCents)} · {METHOD_LABELS[reverseFor.method] ?? reverseFor.method ?? "manual"}
                {reverseFor.customerName ? ` from ${reverseFor.customerName}` : ""}
                {reverseFor.invoiceNumber ? ` on ${reverseFor.invoiceNumber}` : ""}.
              </>}{" "}
              The payment stays in the history marked "reversed", the invoice balance goes back up,
              and the reason is noted on the client. Use this for a payment recorded by mistake.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Input id="reverse-reason" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Typed $1,000 instead of $100" data-testid="input-reverse-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReverseFor(null); setReverseReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => reverse.mutate()}
              disabled={reverseReason.trim().length < 3 || reverse.isPending} data-testid="button-confirm-reverse">
              {reverse.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reverse payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {payments?.slice(0, 50).map((p: any) => {
            const doc = p.invoiceNumber ? `Invoice ${p.invoiceNumber}` : p.estimateNumber ? `Estimate ${p.estimateNumber}` : null;
            return (
              <div key={p.id} className="rounded-lg border px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                data-testid={`payment-${p.id}`}>
                <div className="min-w-0">
                  <div className="font-medium tabular-nums">
                    {money(p.amountCents)}
                    <span className="text-muted-foreground font-normal text-sm">
                      {" "}· {METHOD_LABELS[p.method] ?? p.method ?? p.provider} · {PURPOSE_LABELS[p.purpose] ?? p.purpose}
                    </span>
                  </div>
                  <div className="text-sm truncate" data-testid={`payment-who-${p.id}`}>
                    <Link href={`/crm/clients/${p.customerId}`} className="font-medium hover:underline">
                      {p.customerName ?? "Client"}
                    </Link>
                    {doc && <span className="text-muted-foreground"> · {doc}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.refundedCents > 0 && <span>{money(p.refundedCents)} refunded · </span>}
                    {new Date(p.createdAt).toLocaleString()}
                    {p.note ? ` · ${p.note}` : ""}
                  </div>
                  {p.status === "reversed" && p.failureReason && (
                    <div className="text-xs text-muted-foreground mt-0.5" data-testid={`payment-reversed-${p.id}`}>
                      {p.failureReason}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && p.provider === "manual" && p.status === "succeeded" && (
                    <Button size="sm" variant="ghost" onClick={() => { setReverseFor(p); setReverseReason(""); }}
                      data-testid={`button-reverse-payment-${p.id}`}>
                      <Undo2 className="h-4 w-4 mr-1" /> Reverse
                    </Button>
                  )}
                  <StatusPill tone={statusTone(p.status)}>{p.status}</StatusPill>
                </div>
              </div>
            );
          })}
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
