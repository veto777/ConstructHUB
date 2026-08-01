import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Phone, Mail, Globe, ShieldCheck, BadgePercent } from "lucide-react";
import { StatusPill, ErrorCard, statusTone } from "@/components/crm-ui";
import { useEngagementTracker } from "@/components/engagement-tracker";
import { PrintLockdown } from "@/components/print-lockdown";
import { DocGateChallenge } from "@/components/doc-gate";
import { EstimateAttachments } from "@/components/client-uploads";
import { orgThemeStyle } from "@/lib/org-theme";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

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

/** The homeowner's estimate page. Authorised by the link PLUS a verified
 *  client session — anonymous browsers get the email-verification challenge. */
export default function PublicEstimatePage() {
  const [, params] = useRoute("/e/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [done, setDone] = useState<"approved" | "declined" | null>(null);
  // Optional discount offers the client has ticked (ids). Preview only —
  // the server re-computes the real approved total on submit.
  const [selectedDiscounts, setSelectedDiscounts] = useState<string[]>([]);
  // Client-selectable scopes: ticked option ids + the review step before the
  // estimate is regenerated with just the chosen scopes.
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);

  // A contractor preview grant rides in the page URL — forward it to the API.
  const previewGrant = new URLSearchParams(window.location.search).get("preview");
  const docUrl = `/api/public/estimates/${token}${previewGrant ? `?preview=${encodeURIComponent(previewGrant)}` : ""}`;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [docUrl],
    enabled: !!token,
    retry: false,
  });

  // Engagement heartbeat — starts only once the document has loaded, and
  // never for a contractor preview (that's not client behaviour).
  useEngagementTracker("estimate", token, !!data && !data?.preview);

  // The org's primary financing link. Gated like the document itself; skipped
  // in contractor preview (no client session exists there).
  const { data: payInfo } = useQuery<any>({
    queryKey: [`/api/public/estimates/${token}/pay-info`],
    enabled: !!data && !data?.preview,
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
          selectedDiscounts: decision === "approve" && selectedDiscounts.length ? selectedDiscounts : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: (_r, decision) => {
      setDone(decision === "approve" ? "approved" : "declined");
      // Refetch: an approval may carry selected optional discounts, and the
      // signed page shows the server-recomputed approved total.
      queryClient.invalidateQueries({ queryKey: [docUrl] });
    },
    onError: (e: any) => toast({ title: "Could not submit", description: String(e.message ?? e), variant: "destructive" }),
  });

  // A selection-generated estimate pre-ticks the discounts the client already
  // chose on the source document (server maps them by code to this doc's ids).
  useEffect(() => {
    if (Array.isArray(data?.preselectedDiscounts)) setSelectedDiscounts(data.preselectedDiscounts);
    // Only when the document first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.preselectedDiscounts]);

  // Generate the "your selections" estimate from the ticked scopes, then go
  // there — the normal approve flow signs exactly what the client picked.
  const generate = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/estimates/${token}/select-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionIds: selectedOptions,
          selectedDiscounts: selectedDiscounts.length ? selectedDiscounts : undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: (j: any) => {
      toast({ title: `Estimate ${j.number ?? ""} created`, description: "Review and approve it to lock in your selections." });
      window.location.href = `/e/${j.token}`;
    },
    onError: (e: any) => toast({ title: "Could not create your estimate", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    const msg = String((error as Error).message ?? "");
    // 401 requiresVerification = the email gate. The document stays sealed
    // until the visitor proves they own the inbox it was sent to.
    if (msg.startsWith("401:")) {
      try {
        const j = JSON.parse(msg.slice(msg.indexOf(":") + 1));
        if (j?.requiresVerification) {
          return <DocGateChallenge docType="estimate" token={token!} />;
        }
      } catch { /* fall through to the generic error card */ }
    }
    // 410 = expired. The server sends only org contact details with it (never
    // document content), so this page is all an expired visitor can reach.
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

  const { estimate: e, items, company, customer, options, preview, discountOffers } = data;
  const settled = done ?? (e.approvedAt ? "approved" : e.declinedAt ? "declined" : null);
  const expired = e.expiresAt && new Date(e.expiresAt).getTime() < Date.now();

  // Optional discounts — LIVE preview, mirroring the server's approve-time
  // math (server/crm/discounts.ts): the combined concession is capped at the
  // taxable base and tax is charged on the reduced base. The server
  // re-computes on approve; this is only what the client sees before signing.
  const offers: any[] = discountOffers ?? [];
  const selBps = Math.min(10_000,
    offers.filter((o) => selectedDiscounts.includes(o.id)).reduce((s, o) => s + (o.percentBps ?? 0), 0));
  const previewing = selBps > 0 && !settled;
  const optDiscountCents = Math.round(((e.taxableBaseCents ?? 0) * selBps) / 10_000);
  const shownTaxCents = previewing
    ? Math.round(((e.taxableBaseCents ?? 0) - optDiscountCents) * (e.taxRateBps ?? 0) / 10_000)
    : e.taxCents;
  const shownTotalCents = previewing
    ? Math.max(0, (e.subtotalCents ?? 0) - (e.discountCents ?? 0) - optDiscountCents + shownTaxCents)
    : (settled === "approved" ? (e.approvedTotalCents ?? e.totalCents) : e.totalCents);
  const appliedDiscounts: any[] = settled === "approved" && Array.isArray(e.selectedDiscounts) ? e.selectedDiscounts : [];

  const toggleDiscount = (id: string, on: boolean) =>
    setSelectedDiscounts((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  // ── Client-selectable scopes ──────────────────────────────────────────────
  // Options carrying their own line items are checkboxes; the live total uses
  // the server's per-option subtotal/taxable and mirrors the approve-time
  // discount math (server/crm/discounts.ts). The server regenerates the real
  // document — this is only what the client sees before confirming.
  const selectable: any[] = (options ?? []).filter((o: any) => o.selectable);
  const chosenOptions = selectable.filter((o) => selectedOptions.includes(o.id));
  const selSubtotalCents = chosenOptions.reduce((s, o) => s + (o.subtotalCents ?? 0), 0);
  const selTaxableCents = chosenOptions.reduce((s, o) => s + (o.taxableCents ?? 0), 0);
  const selDiscountCents = Math.round((selTaxableCents * selBps) / 10_000);
  const selTaxCents = Math.round(((selTaxableCents - selDiscountCents) * (e.taxRateBps ?? 0)) / 10_000);
  const selTotalCents = Math.max(0, selSubtotalCents - selDiscountCents + selTaxCents);
  const toggleOption = (id: string, on: boolean) =>
    setSelectedOptions((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  // The org's company theme — black + their accent. Server-resolved in the
  // payload; re-points --primary for everything below this root.
  const themeStyle = orgThemeStyle(company?.theme);

  return (
    <main className="min-h-screen bg-muted/40 py-6 px-3 sm:py-10 sm:px-4"
      style={themeStyle} data-testid="public-estimate-root">
      <PrintLockdown />
      <div className="max-w-3xl mx-auto space-y-5">
        {preview && (
          <Card className="border-amber-500/50 bg-amber-500/5" data-testid="preview-banner">
            <CardContent className="p-4 text-sm text-center">
              <span className="font-medium">Contractor preview</span> — this is what your client
              sees after verifying their email. Approving and paying are disabled here.
            </CardContent>
          </Card>
        )}

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

        {selectable.length > 0 && !settled && !expired && !preview ? (
          <Card className="shadow-sm" data-testid="options-checklist">
            <CardHeader>
              <CardTitle className="text-lg">Choose your scopes</CardTitle>
              <CardDescription>
                {reviewing
                  ? "Check your selection — anything struck through is left out of your new estimate."
                  : `${company.name} put together ${selectable.length} scopes for this job. Tick the ones you want — the total updates as you go.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {selectable.map((o: any) => {
                  const on = selectedOptions.includes(o.id);
                  // Review step: unchosen scopes show struck through; chosen
                  // ones read normally. Before review, cards are checkboxes.
                  if (reviewing && !on) {
                    return (
                      <div key={o.id}
                        className="rounded-lg border p-4 bg-card text-muted-foreground"
                        data-testid={`struck-option-${o.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium line-through">{o.name}</span>
                        </div>
                        {o.description && <p className="text-xs mt-1.5 line-through">{o.description}</p>}
                        {o.subtotalCents != null && (
                          <div className="text-xl font-semibold tabular-nums mt-3 line-through">{money(o.subtotalCents)}</div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <label key={o.id}
                      className={`rounded-lg border p-4 transition-colors ${reviewing ? "" : "cursor-pointer"} ${
                        on ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "bg-card hover:bg-accent/50"}`}
                      data-testid={`option-${o.tier}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{o.name}</span>
                        {reviewing ? (
                          <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                        ) : (
                          <Checkbox
                            className="h-5 w-5"
                            checked={on}
                            onCheckedChange={(c) => toggleOption(o.id, c === true)}
                            data-testid={`checkbox-option-${o.id}`}
                          />
                        )}
                      </div>
                      {o.description && <p className="text-xs text-muted-foreground mt-1.5">{o.description}</p>}
                      {o.subtotalCents != null && (
                        <div className="text-xl font-semibold tabular-nums mt-3">{money(o.subtotalCents)}</div>
                      )}
                      {o.recommended && !reviewing && (
                        <div className="mt-2"><StatusPill tone="info" dot={false}>recommended</StatusPill></div>
                      )}
                    </label>
                  );
                })}
              </div>

              {reviewing ? (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="w-full max-w-xs text-sm space-y-1.5" data-testid="review-totals">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium tabular-nums" data-testid="text-review-subtotal">{money(selSubtotalCents)}</span>
                      </div>
                      {selDiscountCents > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Optional discounts</span>
                          <span className="font-medium tabular-nums" data-testid="text-review-discount">−{money(selDiscountCents)}</span>
                        </div>
                      )}
                      {selTaxCents > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tax</span>
                          <span className="font-medium tabular-nums" data-testid="text-review-tax">{money(selTaxCents)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-2 text-lg font-bold">
                        Total <span className="tabular-nums" data-testid="text-review-total">{money(selTotalCents)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button className="w-full sm:w-auto h-12 sm:h-10"
                      disabled={generate.isPending}
                      onClick={() => generate.mutate()}
                      data-testid="button-generate-estimate">
                      {generate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Generate my estimate
                    </Button>
                    <Button variant="outline" className="w-full sm:w-auto h-12 sm:h-10"
                      onClick={() => setReviewing(false)} data-testid="button-back-to-options">
                      Back
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This creates a new estimate with just your chosen scopes — you approve that one to lock it in.
                    Nothing is final until you sign.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Your total: </span>
                    <strong className="tabular-nums" data-testid="text-options-total">{money(selTotalCents)}</strong>
                  </div>
                  <Button className="h-10" disabled={selectedOptions.length === 0}
                    onClick={() => setReviewing(true)} data-testid="button-review-selection">
                    Review selection
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : options?.length > 1 && (
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

        {/* The document itself — a real letterhead: company on the left,
            document facts on the right, 'Prepared for' below, footer band
            at the bottom. */}
        <Card className="shadow-md overflow-hidden" data-testid="estimate-document">
          {/* Letterhead accent line — the org's exact theme hex (inline, so
              no hsl round-trip drift). */}
          <div className="h-1.5" style={company?.theme ? { backgroundColor: company.theme.hex } : undefined}
            data-testid="letterhead-accent" />
          <div className="border-b p-4 sm:p-8 space-y-6">
            <div className="flex flex-wrap justify-between gap-x-8 gap-y-6">
              {/* Letterhead — the company the client hired, not us. */}
              <div className="space-y-1.5 min-w-0">
                {company.logoUrl && (
                  <img src={company.logoUrl} alt={company.name} className="h-12 object-contain mb-1" />
                )}
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
              {/* Document facts. The big number mirrors the totals block
                  below — label and amount stay separate elements so the
                  totals block's exact "Total $X" row remains unique. */}
              <div className="sm:text-right space-y-1.5 shrink-0">
                <div className="text-3xl font-bold tracking-tight text-primary" data-testid="doc-wordmark">ESTIMATE</div>
                {e.number && <div className="font-medium">{e.number}</div>}
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {e.createdAt && <div>Created {day(e.createdAt)}</div>}
                  {e.expiresAt && <div>Valid until {day(e.expiresAt)}</div>}
                </div>
                <div>
                  <StatusPill tone={settled === "approved" ? "success" : settled ? "danger" : statusTone(e.status)}>
                    {settled ?? e.status}
                  </StatusPill>
                </div>
                <div className="pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</div>
                  <div className="text-2xl font-bold tabular-nums" data-testid="doc-total">{money(shownTotalCents)}</div>
                </div>
              </div>
            </div>
            {/* Prepared for — the client's own details. */}
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
          <CardContent className="p-4 sm:p-8 space-y-6">
            <CardTitle className="text-xl">{e.title}</CardTitle>
            {e.introText && <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.introText}</p>}

            {/* Line items. Below sm each row stacks: name, "qty × price",
                then the line total — no sideways scrolling on a phone. The
                qty column folds into the price line; desktop is unchanged. */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="block sm:table w-full text-sm">
                <thead className="hidden sm:table-header-group bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Item</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-24">Qty</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Price</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-28">Total</th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {items.map((i: any) => (
                    <tr key={i.id} className="block sm:table-row border-t px-4 py-3 sm:p-0">
                      <td className="block sm:table-cell sm:px-4 sm:py-3">
                        <div className="font-medium">{i.name}</div>
                        {i.description && <div className="text-muted-foreground text-xs mt-0.5">{i.description}</div>}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""}</td>
                      <td className="block sm:table-cell mt-1 sm:mt-0 sm:px-4 sm:py-3 sm:text-right tabular-nums">
                        <span className="text-muted-foreground sm:hidden">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""} × </span>
                        {money(i.unitPriceCents)}
                      </td>
                      <td className="flex items-baseline justify-between sm:table-cell sm:px-4 sm:py-3 sm:text-right tabular-nums font-medium">
                        <span className="text-xs font-normal text-muted-foreground sm:hidden">Total</span>
                        {money(i.lineTotalCents)}
                      </td>
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
                {previewing && (
                  <div className="flex justify-between" data-testid="row-optional-discount">
                    <span className="text-muted-foreground">Optional discounts</span>
                    <span className="font-medium tabular-nums">−{money(optDiscountCents)}</span>
                  </div>
                )}
                {appliedDiscounts.length > 0 && (
                  <div className="flex justify-between" data-testid="row-applied-discounts">
                    <span className="text-muted-foreground">Optional discounts</span>
                    <span className="font-medium text-right">{appliedDiscounts.map((d) => d.label).join(", ")}</span>
                  </div>
                )}
                {shownTaxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium tabular-nums">{money(shownTaxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  Total <span className="tabular-nums">{money(shownTotalCents)}</span>
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
          {/* Footer band — company name · license # · website. The "#" form
              keeps the header's "License X (ST)" string unique for tests. */}
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

        {/* Files the contractor pinned to this estimate (same email gate). */}
        {!preview && <EstimateAttachments token={token!} />}

        {offers.length > 0 && !settled && !expired && (
          <Card className="shadow-md" data-testid="discounts-section">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BadgePercent className="h-5 w-5 text-primary" /> Optional discounts
              </CardTitle>
              <CardDescription>
                Tick any you qualify for — the total updates as you go, and is confirmed when you approve.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {offers.map((o: any) => (
                <label key={o.id} className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 active:bg-accent transition-colors"
                  data-testid={`discount-offer-${o.code}`}>
                  <Checkbox
                    className="mt-0.5 h-5 w-5"
                    checked={selectedDiscounts.includes(o.id)}
                    onCheckedChange={(c) => toggleDiscount(o.id, c === true)}
                    data-testid={`check-discount-${o.code}`}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-sm">
                      {o.label} <span className="text-primary">−{(o.percentBps / 100).toLocaleString("en-US")}%</span>
                    </span>
                    {o.conditions && (
                      <span className="block text-xs text-muted-foreground mt-0.5">{o.conditions}</span>
                    )}
                  </span>
                </label>
              ))}
              {previewing && (
                <p className="text-xs text-muted-foreground" data-testid="text-discount-note">
                  Your new total: <strong className="text-foreground">{money(shownTotalCents)}</strong> —
                  verified against the offer conditions when the job is scheduled.
                </p>
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

        {!settled && !expired && !preview && (
          <Card className="shadow-md border-primary/30">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-lg">Ready to go ahead?</CardTitle>
              <CardDescription>Type your name to approve. This is your signature.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-3">
              <div>
                <Label htmlFor="sig">Your full name</Label>
                <Input id="sig" value={name} onChange={(ev) => setName(ev.target.value)}
                  placeholder={customer.displayName} data-testid="input-signature"
                  className="h-12 text-base" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button disabled={name.trim().length < 2 || respond.isPending}
                  className="w-full sm:w-auto h-12 sm:h-10"
                  onClick={() => respond.mutate("approve")} data-testid="button-approve">
                  {respond.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Approve this estimate
                </Button>
                <Button variant="outline" className="w-full sm:w-auto h-12 sm:h-10"
                  onClick={() => setShowDecline(!showDecline)} data-testid="button-show-decline">
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
          Private document — it opens only after verifying the email address it was sent to.
        </p>
      </div>
    </main>
  );
}
