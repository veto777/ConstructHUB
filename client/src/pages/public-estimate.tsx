import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Phone, Mail, Globe } from "lucide-react";

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
      <Card className="border-green-600">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" /> Payment received
          </CardTitle>
          <CardDescription>Thank you — {company.name} has been notified.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (returned === "1") {
    return (
      <Card className="border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Payment processing
          </CardTitle>
          <CardDescription>
            Your payment was submitted. Bank transfers (ACH) can take a few days to settle —
            {company.name} has been notified.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const amount = estimate.depositCents || estimate.totalCents;
  return (
    <Card>
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
        <Button onClick={() => pay.mutate()} disabled={pay.isPending} data-testid="button-pay">
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
    return (
      <div className="p-6 max-w-lg mx-auto mt-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> This link isn't valid
            </CardTitle>
            <CardDescription>{String((error as Error).message)}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { estimate: e, items, company, customer, options } = data;
  const settled = done ?? (e.approvedAt ? "approved" : e.declinedAt ? "declined" : null);
  const expired = e.expiresAt && new Date(e.expiresAt).getTime() < Date.now();

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Who it's from */}
        <div className="text-center space-y-1">
          {company.logoUrl && (
            <img src={company.logoUrl} alt={company.name} className="h-14 mx-auto object-contain" />
          )}
          <h1 className="text-2xl font-bold">{company.name}</h1>
          <div className="text-sm text-muted-foreground flex flex-wrap justify-center gap-x-4 gap-y-1">
            {company.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</span>}
            {company.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</span>}
            {company.website && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{company.website}</span>}
          </div>
          {company.licenseNumber && (
            <div className="text-xs text-muted-foreground">
              License {company.licenseNumber}{company.licenseState ? ` (${company.licenseState})` : ""}
            </div>
          )}
        </div>

        {settled === "approved" && (
          <PayCard token={token!} company={company} estimate={e} />
        )}

        {settled && (
          <Card className={settled === "approved" ? "border-green-600" : "border-destructive"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {settled === "approved"
                  ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> Approved — thank you!</>
                  : <><XCircle className="h-5 w-5 text-destructive" /> Estimate declined</>}
              </CardTitle>
              <CardDescription>
                {settled === "approved"
                  ? `${company.name} has been notified and will be in touch to schedule.`
                  : `${company.name} has been notified. Contact them if you'd like changes.`}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {options?.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Choose your option</CardTitle>
              <CardDescription>
                {company.name} put together {options.length} ways to do this.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {options.map((o: any) => (
                <div key={o.id}
                  className={`border rounded-md p-3 ${o.recommended ? "border-primary ring-1 ring-primary" : ""}`}
                  data-testid={`option-${o.tier}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.name}</span>
                    {o.recommended && <Badge className="text-[10px]">recommended</Badge>}
                  </div>
                  {o.description && <p className="text-xs text-muted-foreground mt-1">{o.description}</p>}
                  {o.totalCents != null && (
                    <div className="text-lg font-bold mt-2">{money(o.totalCents)}</div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{e.title}</CardTitle>
                <CardDescription>
                  {e.number} · prepared for {customer.displayName}
                </CardDescription>
              </div>
              <Badge variant={settled === "approved" ? "default" : settled ? "destructive" : "outline"}>
                {settled ?? e.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {e.introText && <p className="whitespace-pre-wrap text-sm">{e.introText}</p>}

            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium w-20">Qty</th>
                    <th className="text-right p-2 font-medium w-28">Price</th>
                    <th className="text-right p-2 font-medium w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i: any) => (
                    <tr key={i.id} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{i.name}</div>
                        {i.description && <div className="text-muted-foreground text-xs">{i.description}</div>}
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
              <div>Subtotal <span className="font-medium ml-4">{money(e.subtotalCents)}</span></div>
              {e.discountCents > 0 && <div>Discount <span className="font-medium ml-4">−{money(e.discountCents)}</span></div>}
              {e.taxCents > 0 && <div>Tax <span className="font-medium ml-4">{money(e.taxCents)}</span></div>}
              <div className="text-xl font-bold">Total <span className="ml-4">{money(e.totalCents)}</span></div>
              {e.depositCents ? (
                <div className="text-muted-foreground">Deposit due <span className="font-medium ml-2">{money(e.depositCents)}</span></div>
              ) : null}
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
          <Card>
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
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> This estimate has expired
              </CardTitle>
              <CardDescription>Please contact {company.name} for an updated quote.</CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
