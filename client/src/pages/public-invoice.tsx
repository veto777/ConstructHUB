import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle, CheckCircle2, Phone, Mail, Landmark } from "lucide-react";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Public invoice — token-authorised, no login. Mirrors the estimate page. */
export default function PublicInvoicePage() {
  const [, params] = useRoute("/i/:token");
  const token = params?.token;
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/public/invoices/${token}`], enabled: !!token, retry: false,
  });

  const pay = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/invoices/${token}/pay`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not start payment");
      return j;
    },
    onSuccess: (j: any) => { if (j.url) window.location.href = j.url; },
    onError: (e: any) => toast({ title: "Payment unavailable", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (error) {
    return (
      <div className="p-6 max-w-lg mx-auto mt-10">
        <Card><CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> This link isn't valid</CardTitle>
          <CardDescription>{String((error as Error).message)}</CardDescription>
        </CardHeader></Card>
      </div>
    );
  }

  const { invoice: inv, items, company, customer } = data;
  // Only the server says "paid". The ?paid=1 redirect from Stripe just means
  // checkout finished — an ACH debit can still be settling, and the parameter
  // itself is trivially forgeable, so it must never render as "Paid".
  const settled = Boolean(inv.paidAt);
  const processing = !settled && new URLSearchParams(window.location.search).get("paid") === "1";

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center space-y-1">
          {company.logoUrl && <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto object-contain" />}
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <div className="text-sm text-muted-foreground flex flex-wrap justify-center gap-x-4">
            {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
            {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
          </div>
          {company.licenseNumber && (
            <div className="text-xs text-muted-foreground">
              License {company.licenseNumber}{company.licenseState ? ` (${company.licenseState})` : ""}
            </div>
          )}
        </div>

        {settled && (
          <Card className="border-green-600"><CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Paid — thank you!
            </CardTitle>
            <CardDescription>{company.name} has been notified.</CardDescription>
          </CardHeader></Card>
        )}

        {processing && (
          <Card className="border-primary"><CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Payment processing
            </CardTitle>
            <CardDescription>
              Your payment was submitted. Bank transfers (ACH) can take a few days to settle —
              this page shows Paid the moment it clears.
            </CardDescription>
          </CardHeader></Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{inv.title}</CardTitle>
                <CardDescription>{inv.number} · for {customer.displayName}</CardDescription>
              </div>
              <Badge variant={settled ? "default" : "outline"}>{settled ? "paid" : inv.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr>
                  <th className="text-left p-2">Item</th><th className="text-right p-2 w-20">Qty</th>
                  <th className="text-right p-2 w-28">Price</th><th className="text-right p-2 w-28">Total</th>
                </tr></thead>
                <tbody>
                  {items.map((i: any) => (
                    <tr key={i.id} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{i.name}</div>
                        {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                      </td>
                      <td className="p-2 text-right">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""}</td>
                      <td className="p-2 text-right">{money(i.unitPriceCents)}</td>
                      <td className="p-2 text-right">{money(i.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-sm space-y-1 text-right">
              <div>Subtotal <span className="font-medium ml-4">{money(inv.subtotalCents)}</span></div>
              {inv.taxCents > 0 && <div>Tax <span className="font-medium ml-4">{money(inv.taxCents)}</span></div>}
              <div>Invoice total <span className="font-medium ml-4">{money(inv.totalCents)}</span></div>
              {inv.retainageCents > 0 && (
                <div className="text-muted-foreground">
                  Retainage withheld <span className="font-medium ml-4">−{money(inv.retainageCents)}</span>
                </div>
              )}
              {inv.paidCents > 0 && (
                <div className="text-muted-foreground">Already paid <span className="font-medium ml-4">−{money(inv.paidCents)}</span></div>
              )}
              <div className="text-xl font-bold">Due now <span className="ml-4">{money(inv.dueCents)}</span></div>
            </div>

            {inv.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{inv.notes}</p>}
          </CardContent>
        </Card>

        {!settled && !processing && inv.dueCents > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Landmark className="h-5 w-5" /> Pay this invoice</CardTitle>
              <CardDescription>
                Paid directly to {company.name}. Bank transfer (ACH) is the cheapest option.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => pay.mutate()} disabled={pay.isPending} data-testid="button-pay-invoice">
                {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Pay {money(inv.dueCents)}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
