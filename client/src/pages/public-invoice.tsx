import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, CheckCircle2, Phone, Mail, Globe, Landmark, ShieldCheck } from "lucide-react";
import { StatusPill, ErrorCard, statusTone } from "@/components/crm-ui";
import { useEngagementTracker } from "@/components/engagement-tracker";
import { PrintLockdown } from "@/components/print-lockdown";
import { DocGateChallenge } from "@/components/doc-gate";
import { orgThemeStyle } from "@/lib/org-theme";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

/** Public invoice — authorised by the link PLUS a verified client session,
 *  like the estimate page. Anonymous browsers get the email challenge. */
export default function PublicInvoicePage() {
  const [, params] = useRoute("/i/:token");
  const token = params?.token;
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/public/invoices/${token}`], enabled: !!token, retry: false,
  });

  // Fee + financing info, fetched only once the document itself loaded (which
  // means the email gate already passed — this endpoint is gated the same way).
  const { data: payInfo } = useQuery<any>({
    queryKey: [`/api/public/invoices/${token}/pay-info`], enabled: !!data, retry: false,
  });

  // Engagement heartbeat — starts only once the document has loaded.
  useEngagementTracker("invoice", token, !!data);

  const pay = useMutation({
    mutationFn: async (method?: "card" | "ach") => {
      const r = await fetch(`/api/public/invoices/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method ? { method } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not start payment");
      return j;
    },
    onSuccess: (j: any) => { if (j.url) window.location.href = j.url; },
    onError: (e: any) => toast({ title: "Payment unavailable", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (error) {
    const msg = String((error as Error).message ?? "");
    // 401 requiresVerification = the email gate.
    if (msg.startsWith("401:")) {
      try {
        const j = JSON.parse(msg.slice(msg.indexOf(":") + 1));
        if (j?.requiresVerification) {
          return <DocGateChallenge docType="invoice" token={token!} />;
        }
      } catch { /* fall through to the generic error card */ }
    }
    return (
      <div className="min-h-screen bg-muted/40 flex items-start justify-center py-16 px-4">
        <ErrorCard title="This link isn't valid" description={String((error as Error).message)} />
      </div>
    );
  }

  const { invoice: inv, items, company, customer } = data;
  // The org's company theme — black + their accent, server-resolved in the
  // payload; re-points --primary for everything below this root.
  const themeStyle = orgThemeStyle(company?.theme);
  // Only the server says "paid". The ?paid=1 redirect from Stripe just means
  // checkout finished — an ACH debit can still be settling, and the parameter
  // itself is trivially forgeable, so it must never render as "Paid".
  const settled = Boolean(inv.paidAt);
  const processing = !settled && new URLSearchParams(window.location.search).get("paid") === "1";

  return (
    <main className="min-h-screen bg-muted/40 py-10 px-4" style={themeStyle} data-testid="public-invoice-root">
      <PrintLockdown />
      <div className="max-w-3xl mx-auto space-y-5">
        {settled && (
          <Card className="border-emerald-500/50 bg-emerald-500/5">
            <CardContent className="p-5 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Paid — thank you!</div>
                <p className="text-sm text-muted-foreground mt-0.5">{company.name} has been notified.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {processing && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="p-5 flex items-start gap-3">
              <Loader2 className="h-5 w-5 animate-spin shrink-0 mt-0.5 text-primary" />
              <div>
                <div className="font-semibold">Payment processing</div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Your payment was submitted. Bank transfers (ACH) can take a few days to settle —
                  this page shows Paid the moment it clears.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* The document itself — same letterhead layout as the estimate:
            company left, document facts right, 'Prepared for', footer band. */}
        <Card className="shadow-md overflow-hidden" data-testid="invoice-document">
          {/* Letterhead accent line — the org's exact theme hex. */}
          <div className="h-1.5" style={company?.theme ? { backgroundColor: company.theme.hex } : undefined}
            data-testid="letterhead-accent" />
          <div className="border-b p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap justify-between gap-x-8 gap-y-6">
              <div className="space-y-1.5 min-w-0">
                {company.logoUrl && <img src={company.logoUrl} alt={company.name} className="h-12 object-contain mb-1" />}
                <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
                {(company.addressLine1 || company.city) && (
                  <div className="text-sm text-muted-foreground" data-testid="text-company-address">
                    {[
                      [company.addressLine1, company.addressLine2].filter(Boolean).join(", "),
                      [company.city, [company.state, company.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                    ].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="text-sm text-muted-foreground space-y-0.5">
                  {company.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{company.phone}</div>}
                  {company.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{company.email}</div>}
                  {company.website && <div className="flex items-center gap-1.5"><Globe className="h-3 w-3" />{company.website}</div>}
                </div>
                {company.licenseNumber && (
                  <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    License {company.licenseNumber}{company.licenseState ? ` (${company.licenseState})` : ""}
                  </div>
                )}
              </div>
              <div className="sm:text-right space-y-1.5 shrink-0">
                <div className="text-3xl font-bold tracking-tight text-primary" data-testid="doc-wordmark">INVOICE</div>
                {inv.number && <div className="font-medium">{inv.number}</div>}
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {inv.createdAt && <div>Created {day(inv.createdAt)}</div>}
                  {inv.dueAt && <div>Due {day(inv.dueAt)}</div>}
                </div>
                <div>
                  <StatusPill tone={settled ? "success" : statusTone(inv.status)}>
                    {settled ? "paid" : inv.status}
                  </StatusPill>
                </div>
                <div className="pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Amount due</div>
                  <div className="text-2xl font-bold tabular-nums" data-testid="doc-total">{money(inv.dueCents)}</div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4" data-testid="prepared-for">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Prepared for</div>
              <div className="font-medium mt-1">{customer.displayName}</div>
              {(customer.addressLine1 || customer.city) && (
                <div className="text-sm text-muted-foreground">
                  {[
                    [customer.addressLine1, customer.addressLine2].filter(Boolean).join(", "),
                    [customer.city, [customer.state, customer.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                  ].filter(Boolean).join(" · ")}
                </div>
              )}
              {(customer.email || customer.phone) && (
                <div className="text-sm text-muted-foreground">
                  {[customer.email, customer.phone].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
          </div>
          <CardContent className="p-6 sm:p-8 space-y-6">
            <CardTitle className="text-xl">{inv.title}</CardTitle>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Item</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-24">Qty</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Price</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Total</th>
                </tr></thead>
                <tbody>
                  {items.map((i: any) => (
                    <tr key={i.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{i.name}</div>
                        {i.description && <div className="text-xs text-muted-foreground mt-0.5">{i.description}</div>}
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
                  <span className="font-medium tabular-nums">{money(inv.subtotalCents)}</span>
                </div>
                {inv.taxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium tabular-nums">{money(inv.taxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice total</span>
                  <span className="font-medium tabular-nums">{money(inv.totalCents)}</span>
                </div>
                {inv.retainageCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Retainage withheld</span>
                    <span className="font-medium tabular-nums">−{money(inv.retainageCents)}</span>
                  </div>
                )}
                {inv.paidCents > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Already paid</span>
                    <span className="font-medium tabular-nums">−{money(inv.paidCents)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  Due now <span className="tabular-nums">{money(inv.dueCents)}</span>
                </div>
              </div>
            </div>

            {inv.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{inv.notes}</p>}
          </CardContent>
          {/* Footer band — company name · license # · website. */}
          <div className="border-t bg-muted/30 px-6 py-3.5 text-center text-xs text-muted-foreground" data-testid="document-footer">
            {[
              company.name,
              company.licenseNumber
                ? `License #${company.licenseNumber}${company.licenseState ? ` (${company.licenseState})` : ""}`
                : null,
              company.website,
            ].filter(Boolean).join(" · ")}
          </div>
        </Card>

        {!settled && !processing && inv.dueCents > 0 && (
          <Card className="shadow-md border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" /> Pay this invoice</CardTitle>
              <CardDescription>
                Paid directly to {company.name}. Bank transfer (ACH) is the cheapest option.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {payInfo?.cardFee && (payInfo.achAvailable || payInfo.cardAvailable) ? (
                <>
                  {/* The fee is stated BEFORE the client chooses a rail. */}
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1" data-testid="text-card-fee-notice">
                    {payInfo.achAvailable && (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Bank transfer (ACH)</span>
                        <span className="font-medium tabular-nums">{money(payInfo.dueCents)} — no fee</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        Card (includes {money(payInfo.cardFee.feeCents)} card processing fee, {(payInfo.cardFee.bps / 100).toFixed(2)}%)
                      </span>
                      <span className="font-medium tabular-nums">{money(payInfo.cardFee.totalCents)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {payInfo.achAvailable && (
                      <Button size="lg" variant="outline" onClick={() => pay.mutate("ach")} disabled={pay.isPending}
                        data-testid="button-pay-invoice-ach">
                        {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Pay {money(payInfo.dueCents)} by bank
                      </Button>
                    )}
                    {payInfo.cardAvailable && (
                      <Button size="lg" onClick={() => pay.mutate("card")} disabled={pay.isPending}
                        data-testid="button-pay-invoice-card">
                        {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Pay {money(payInfo.cardFee.totalCents)} by card
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <Button size="lg" className="w-full sm:w-auto" onClick={() => pay.mutate(undefined)} disabled={pay.isPending} data-testid="button-pay-invoice">
                  {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Pay {money(inv.dueCents)}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {payInfo?.financing && (
          <Card className="shadow-sm">
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">Prefer to spread payments out?</div>
              <a href={payInfo.financing.url} target="_blank" rel="noreferrer" data-testid="link-financing"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Finance this project →
                <span className="font-normal text-muted-foreground">{payInfo.financing.label}</span>
              </a>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground/70 pb-4">
          Private document — it opens only after verifying the email address it was sent to.
        </p>
      </div>
    </main>
  );
}
