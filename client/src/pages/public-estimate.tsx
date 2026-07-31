import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Phone, Mail, Globe, ShieldCheck } from "lucide-react";
import { StatusPill, ErrorCard, statusTone } from "@/components/crm-ui";
import { useEngagementTracker } from "@/components/engagement-tracker";
import { PrintLockdown } from "@/components/print-lockdown";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Deposit payment, shown only after approval. ACH is highlighted because it is
 *  dramatically cheaper on a large deposit and the client should know. */
function PayCard({ token, company, estimate }: { token: string; company: any; estimate: any }) {
  const { toast } = useToast();
  // ?paid=1 is only the Stripe redirect hint — "Paid" comes from the server.
  const returned = new URLSearchParams(window.location.search).get("paid");
  const pay = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/estimates/${token}/pay`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not start payment");
      return j;
    },
    onSuccess: (j: any) => { if (j.url) window.location.href = j.url; },
    onError: (e: any) => toast({ title: "Payment unavailable", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (estimate.paid) {
    return (
      <Card className="border-emerald-500/50 bg-emerald-500/5">
        <CardContent className="p-5 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Payment received</div>
            <p className="text-sm text-muted-foreground mt-0.5">Thank you — {company.name} has been notified.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (returned === "1") {
    return (
      <Card className="border-primary/50 bg-primary/5">
        <CardContent className="p-5 flex items-start gap-3">
          <Loader2 className="h-5 w-5 animate-spin shrink-0 mt-0.5 text-primary" />
          <div>
            <div className="font-semibold">Payment processing</div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your payment was submitted. Bank transfers (ACH) can take a few days to settle —
              {company.name} has been notified.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const amount = estimate.depositCents || estimate.totalCents;
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-lg">
          {estimate.depositCents ? "Pay your deposit" : "Pay this invoice"}
        </CardTitle>
        <CardDescription>
          {money(amount)} — paid directly to {company.name}. Bank transfer (ACH) is the
          cheapest option and usually free to you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="lg" className="w-full sm:w-auto" onClick={() => pay.mutate()} disabled={pay.isPending} data-testid="button-pay">
          {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Pay {money(amount)}
        </Button>
      </CardContent>
    </Card>
  );
}

/** The homeowner's estimate page. No login — authorised by the link itself. */
export default function PublicEstimatePage() {
  const [, params] = useRoute("/e/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [done, setDone] = useState<"approved" | "declined" | null>(null);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/public/estimates/${token}`],
    enabled: !!token,
    retry: false,
  });

  // Engagement heartbeat — starts only once the document has loaded.
  useEngagementTracker("estimate", token, !!data);

  const respond = useMutation({
    mutationFn: async (decision: "approve" | "decline") => {
      const r = await fetch(`/api/public/estimates/${token}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          signatureName: decision === "approve" ? name : undefined,
          reason: decision === "decline" ? reason : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: (_r, decision) => setDone(decision === "approve" ? "approved" : "declined"),
    onError: (e: any) => toast({ title: "Could not submit", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    // 410 = expired. The server sends only org contact details with it (never
    // document content), so this page is all an expired visitor can reach.
    const msg = String((error as Error).message ?? "");
    let expiredInfo: any = null;
    if (msg.startsWith("410:")) {
      try { expiredInfo = JSON.parse(msg.slice(msg.indexOf(":") + 1)); } catch { /* fall through */ }
    }
    if (expiredInfo?.expired) {
      const co = expiredInfo.company ?? {};
      return (
        <main className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
          <PrintLockdown />
          <Card className="max-w-md w-full shadow-md" data-testid="expired-notice">
            <CardContent className="p-8 text-center space-y-4">
              <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
              <h1 className="text-xl font-semibold">
                This estimate expired{expiredInfo.expiredAt ? ` on ${new Date(expiredInfo.expiredAt).toLocaleDateString()}` : ""}
              </h1>
              <p className="text-sm text-muted-foreground">
                Contact {co.name ?? "us"}
                {co.email ? <> at <a className="text-primary underline" href={`mailto:${co.email}`}>{co.email}</a></> : ""}
                {co.phone ? <> or <a className="text-primary underline" href={`tel:${co.phone}`}>{co.phone}</a></> : ""}
                {" "}for a fresh one.
              </p>
            </CardContent>
          </Card>
        </main>
      );
    }
    return (
      <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
        <ErrorCard title="This link isn't valid" description={String((error as Error).message)} />
      </div>
    );
  }

  const { estimate: e, items, company, customer, options } = data;
  const settled = done ?? (e.approvedAt ? "approved" : e.declinedAt ? "declined" : null);
  const expired = e.expiresAt && new Date(e.expiresAt).getTime() < Date.now();

  return (
    <main className="min-h-screen bg-muted/40 py-10 px-4">
      <PrintLockdown />
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Letterhead — the company the client hired, not us. */}
        <div className="text-center space-y-1.5 pb-2">
          {company.logoUrl && (
            <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto object-contain" />
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <div className="text-sm text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-1">
            {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
            {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
            {company.website && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{company.website}</span>}
          </div>
          {company.licenseNumber && (
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              License {company.licenseNumber}{company.licenseState ? ` (${company.licenseState})` : ""}
            </div>
          )}
        </div>

        {settled === "approved" && (
          <PayCard token={token!} company={company} estimate={e} />
        )}

        {settled && (
          <Card className={settled === "approved" ? "border-emerald-500/50 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}>
            <CardContent className="p-5 flex items-start gap-3">
              {settled === "approved"
                ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                : <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
              <div>
                <div className="font-semibold">
                  {settled === "approved" ? "Approved — thank you!" : "Estimate declined"}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {settled === "approved"
                    ? `${company.name} has been notified and will be in touch to schedule.`
                    : `${company.name} has been notified. Contact them if you'd like changes.`}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {options?.length > 1 && (
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Choose your option</CardTitle>
              <CardDescription>
                {company.name} put together {options.length} ways to do this.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {options.map((o: any) => (
                <div key={o.id}
                  className={`rounded-lg border p-4 transition-colors ${o.recommended ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "bg-card"}`}
                  data-testid={`option-${o.tier}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.name}</span>
                    {o.recommended && <StatusPill tone="info" dot={false}>recommended</StatusPill>}
                  </div>
                  {o.description && <p className="text-xs text-muted-foreground mt-1.5">{o.description}</p>}
                  {o.totalCents != null && (
                    <div className="text-xl font-semibold tabular-nums mt-3">{money(o.totalCents)}</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* The document itself */}
        <Card className="shadow-md">
          <CardHeader className="border-b bg-muted/30 rounded-t-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-xl">{e.title}</CardTitle>
                <CardDescription className="mt-1">
                  {e.number} · prepared for {customer.displayName}
                </CardDescription>
              </div>
              <StatusPill tone={settled === "approved" ? "success" : settled ? "danger" : statusTone(e.status)}>
                {settled ?? e.status}
              </StatusPill>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {e.introText && <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.introText}</p>}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Item</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-24">Qty</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Price</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i: any) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{i.name}</div>
                        {i.description && <div className="text-muted-foreground text-xs mt-0.5">{i.description}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(i.unitPriceCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{money(i.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-xs text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums">{money(e.subtotalCents)}</span>
                </div>
                {e.discountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium tabular-nums">−{money(e.discountCents)}</span>
                  </div>
                )}
                {e.taxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium tabular-nums">{money(e.taxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  Total <span className="tabular-nums">{money(e.totalCents)}</span>
                </div>
                {e.depositCents ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Deposit due</span>
                    <span className="font-medium tabular-nums">{money(e.depositCents)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {(e.termsText || company.warrantyText) && (
              <>
                <Separator />
                {company.warrantyText && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{company.warrantyText}</p>}
                {e.termsText && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{e.termsText}</p>}
              </>
            )}
          </CardContent>
        </Card>

        {!settled && !expired && (
          <Card className="shadow-md border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg">Ready to go ahead?</CardTitle>
              <CardDescription>Type your name to approve. This is your signature.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="sig">Your full name</Label>
                <Input id="sig" value={name} onChange={(ev) => setName(ev.target.value)}
                  placeholder={customer.displayName} data-testid="input-signature" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={name.trim().length < 2 || respond.isPending}
                  onClick={() => respond.mutate("approve")} data-testid="button-approve">
                  {respond.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Approve this estimate
                </Button>
                <Button variant="outline" onClick={() => setShowDecline(!showDecline)} data-testid="button-show-decline">
                  Decline
                </Button>
              </div>

              {showDecline && (
                <div className="space-y-2 border-t pt-3">
                  <Label htmlFor="why">Anything we should know? (optional)</Label>
                  <Textarea id="why" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)}
                    placeholder="Price, timing, going another direction…" />
                  <Button variant="destructive" size="sm" disabled={respond.isPending}
                    onClick={() => respond.mutate("decline")} data-testid="button-decline">
                    {respond.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Confirm decline
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {expired && !settled && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-5 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">This estimate has expired</div>
                <p className="text-sm text-muted-foreground mt-0.5">Please contact {company.name} for an updated quote.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground/70 pb-4">
          Secure link — only people with this URL can view this estimate.
        </p>
      </div>
    </main>
  );
}
