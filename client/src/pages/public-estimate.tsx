import { useEffect, useRef, useState } from "react";
import { isSameTerms } from "@shared/terms-dedupe";
import { amountDueCents, previewEstimatePage, totalsFromBases, sumLineBases, PAY_IN_FULL_CODE } from "@shared/estimate-totals";
import { effectiveOffer, bundleRuleOf, SCOPE_CATEGORY_LABEL, type BundleRule, type ScopeCategory } from "@shared/scope-category";
import { autoTitleFrom } from "@shared/estimate-draft";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiErrorMessage, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Phone, Mail, Globe, ShieldCheck, BadgePercent, ChevronDown, Sparkles } from "lucide-react";
import { StatusPill, ErrorCard, statusTone } from "@/components/crm-ui";
import { useEngagementTracker } from "@/components/engagement-tracker";
import { PrintLockdown } from "@/components/print-lockdown";
import { DocGateChallenge } from "@/components/doc-gate";
import { EstimateAttachments } from "@/components/client-uploads";
import { orgThemeStyle } from "@/lib/org-theme";
import { Home3DCard } from "@/components/hover-3d-card";
import { SelfEstimatePrompts, estimateTransport } from "@/components/self-estimate";
import { CardFeeConfirm } from "@/components/card-fee-confirm";
import { WARRANTY_ANCHOR } from "@shared/bid-headline";
import { BidHeadlineBanner } from "@/components/bid-headline-banner";

const money = (c?: number | null) =>
  c === null || c === undefined ? "—" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const qty = (m: number) => (m / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

/**
 * A small round white button at the bottom centre of the screen while the reader scrolls: "↑ Top" past the
 * middle of the page or near the bottom, "↓ Bottom" otherwise. Fades out 3 s after scrolling stops (owner,
 * 2026-10-21). `raised` lifts it clear of the fixed Approve bar.
 */
function ScrollJumpButton({ raised }: { raised: boolean }) {
  const [shown, setShown] = useState(false);
  const [toTop, setToTop] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max < 200) return; // nothing worth jumping over
      const y = window.scrollY;
      setToTop(y > max / 2 || max - y < 200);
      setShown(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShown(false), 3000);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, []);
  return (
    <button type="button"
      aria-label={toTop ? "Scroll to top" : "Scroll to bottom"} aria-hidden={!shown} tabIndex={shown ? 0 : -1}
      onClick={() => window.scrollTo({ top: toTop ? 0 : document.documentElement.scrollHeight, behavior: "smooth" })}
      className={`fixed left-1/2 -translate-x-1/2 z-40 h-14 w-14 rounded-full border border-slate-200 bg-white text-slate-900 shadow-lg text-[11px] font-semibold leading-tight flex items-center justify-center text-center transition-opacity duration-300 print:hidden ${
        shown ? "opacity-100" : "opacity-0 pointer-events-none"} ${
        raised ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))]" : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))]"}`}
      data-testid="button-scroll-jump" data-direction={toTop ? "top" : "bottom"}>
      {toTop ? "↑ Top" : "↓ Bottom"}
    </button>
  );
}

/** "Have a question?" — lands in the contractor's Messages inbox, tagged
 *  with this estimate, and pings whoever is assigned to the job. */
function AskQuestionCard({ token, repName }: { token: string; repName: string | null }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/estimates/${token}/comment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not send");
      return j;
    },
    onSuccess: () => { setSent(true); setBody(""); },
    onError: (e: any) => toast({ title: "Could not send", description: String(e.message ?? e), variant: "destructive" }),
  });
  return (
    <Card data-testid="card-ask-question" data-track-section="questions">
      <CardContent className="p-4 space-y-2">
        <div className="font-medium text-sm">
          Questions about this estimate?{repName ? ` ${repName} answers fast.` : ""}
        </div>
        {sent ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="text-question-sent">
            Sent — you'll get a reply by email, and it's saved in your customer portal.
          </p>
        ) : (
          <div className="flex gap-2">
            <Textarea rows={2} className="resize-none" placeholder="Ask anything — scope, timing, materials…"
              value={body} onChange={(ev) => setBody(ev.target.value)} data-testid="input-ask-question" data-track="question_open" />
            <Button className="self-end" disabled={!body.trim() || send.isPending}
              onClick={() => send.mutate()} data-testid="button-ask-question" data-track="question_send">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Deposit payment, shown only after approval. ACH is highlighted because it is
 *  dramatically cheaper on a large deposit and the client should know. When
 *  pay-info says neither card nor bank is offered, there is no Pay button —
 *  the client is told how to reach the contractor instead. */
function PayCard({ token, company, estimate, payInfo }: {
  token: string; company: any; estimate: any; payInfo?: any;
}) {
  const { toast } = useToast();
  // ?paid=1 is only the Stripe redirect hint — "Paid" comes from the server.
  const returned = new URLSearchParams(window.location.search).get("paid");
  // The card-fee pop-up: a card checkout is created only from its Continue button.
  const [feeConfirm, setFeeConfirm] = useState(false);
  const pay = useMutation({
    mutationFn: async (method?: "card" | "ach") => {
      const r = await fetch(`/api/public/estimates/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method ? { method } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not start payment");
      return j;
    },
    onSuccess: (j: any) => { if (j.url) window.location.href = j.url; },
    // The fee pop-up closes on a failure so the reason is readable and the client can try again.
    onError: (e: any) => { setFeeConfirm(false); toast({ title: "Payment unavailable", description: String(e.message ?? e), variant: "destructive" }); },
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
              If you completed checkout, your payment is processing. Bank transfers (ACH) can take a
              few days to settle — this page shows "Payment received" once {company.name} has it.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Exactly what the pay route charges (payments.ts): the deposit when one is
  // set, otherwise the APPROVED total — which already reflects any optional
  // discounts the client ticked when signing.
  // One function for both sides (shared/estimate-totals.ts): a deposit is
  // never more than the signed total.
  const amount = amountDueCents(estimate);
  // Only a LOADED pay-info can say no rail is offered; while it loads (or if
  // it fails) the plain Pay button stays and the server answers honestly.
  const noOnlineRail = Boolean(payInfo) && !payInfo.cardAvailable && !payInfo.achAvailable;
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-lg">
          {estimate.depositCents ? "Pay your deposit" : "Pay in full"}
        </CardTitle>
        <CardDescription>
          {noOnlineRail
            ? `${money(amount)} — pay ${company.name} directly.`
            : `${money(amount)} — paid directly to ${company.name}. Bank transfer (ACH) is the cheapest option and usually free to you.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {noOnlineRail ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1.5" data-testid="text-online-pay-unavailable">
            <p>
              Online payment isn't available for this estimate. To pay the {money(amount)}
              {estimate.depositCents ? " deposit" : ""}, contact {company.name}
              {company.phone || company.email ? ":" : " directly."}
            </p>
            {company.phone && (
              <a href={`tel:${company.phone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                <Phone className="h-3.5 w-3.5" />{company.phone}
              </a>
            )}
            {company.email && (
              <a href={`mailto:${company.email}`} className="flex items-center gap-1.5 text-primary hover:underline">
                <Mail className="h-3.5 w-3.5" />{company.email}
              </a>
            )}
          </div>
        ) : payInfo?.cardFee && (payInfo.achAvailable || payInfo.cardAvailable) ? (
          <div className="space-y-3">
            {/* The fee is stated BEFORE the client chooses a rail, and again in the pop-up. */}
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1" data-testid="text-card-fee-notice">
              {payInfo.achAvailable && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Bank transfer (ACH)</span>
                  <span className="font-medium tabular-nums">{money(amount)} — no fee</span>
                </div>
              )}
              {payInfo.cardAvailable && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">
                    Card (includes {money(payInfo.cardFee.feeCents)} card processing fee, {(payInfo.cardFee.bps / 100).toFixed(2)}%)
                  </span>
                  <span className="font-medium tabular-nums">{money(payInfo.cardFee.totalCents)}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {payInfo.achAvailable && (
                <Button size="lg" variant="outline" onClick={() => pay.mutate("ach")} disabled={pay.isPending}
                  data-testid="button-pay-ach" data-track="pay_click" data-track-detail="bank (ACH)">
                  {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Pay {money(amount)} by bank
                </Button>
              )}
              {payInfo.cardAvailable && (
                <Button size="lg" onClick={() => setFeeConfirm(true)} disabled={pay.isPending} data-testid="button-pay-card" data-track="pay_click" data-track-detail="card">
                  {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Pay {money(payInfo.cardFee.totalCents)} by card
                </Button>
              )}
            </div>
            <CardFeeConfirm
              open={feeConfirm} onOpenChange={setFeeConfirm}
              amountCents={amount} quote={payInfo.cardFee} achAvailable={!!payInfo.achAvailable}
              pending={pay.isPending} companyName={company.name}
              onCard={() => pay.mutate("card")}
              onBank={() => { setFeeConfirm(false); pay.mutate("ach"); }}
            />
          </div>
        ) : (
          <Button size="lg" className="w-full sm:w-auto" onClick={() => pay.mutate(undefined)} disabled={pay.isPending} data-testid="button-pay" data-track="pay_click">
            {pay.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Pay {money(amount)}
          </Button>
        )}
        {payInfo?.offlineInstructions && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="text-offline-pay"
            data-track="pay_offline_info" data-track-section="pay_offline_info">
            <div className="font-medium">Prefer to pay by check or Zelle?</div>
            <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{payInfo.offlineInstructions}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The verified client adds a spouse/co-signer: they get their own gated
 *  link by email, and the share is recorded for the contractor. */
function ShareEstimateCard({ token }: { token: string }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const share = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/public/estimates/${token}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Could not share");
      return j;
    },
    onSuccess: (j: any) => {
      setSharedWith((xs) => [...xs, j.sharedWith]);
      setEmail("");
      toast({ title: "Shared", description: `We emailed ${j.sharedWith} a secure link.` });
    },
    onError: (e: any) => toast({ title: "Could not share", description: String(e.message ?? e), variant: "destructive" }),
  });
  return (
    <Card className="shadow-sm" data-testid="share-estimate-card">
      <CardHeader className="p-4 sm:p-6 pb-2 sm:pb-2">
        <CardTitle className="text-base">Need someone else to see this?</CardTitle>
        <CardDescription>
          Share it with a spouse or co-decision-maker — they'll get their own secure link by email.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-2 sm:pt-2 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="email" value={email} placeholder="their@email.com"
            onChange={(ev) => setEmail(ev.target.value)}
            className="flex-1 h-11" data-testid="input-share-email" />
          <Button variant="outline" className="h-11"
            disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || share.isPending}
            onClick={() => share.mutate()} data-testid="button-share-estimate" data-track="share_send">
            {share.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Send secure link
          </Button>
        </div>
        {sharedWith.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-shared-with">
            Shared with {sharedWith.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Sticky top brand bar in the org's chosen base colour (black by default,
 *  white optional — Settings → Company theme). Logos ride on a white chip
 *  when the base is dark so any logo stays legible. */
function BrandBar({ company }: { company: any }) {
  const dark = (company?.theme?.base ?? "black") === "black";
  return (
    <header className="app-status-pad sticky top-0 z-30 border-b" data-testid="estimate-brandbar"
      style={{ backgroundColor: company?.theme?.baseHex ?? "#111827" }}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
        {company?.logoUrl ? (
          <span className={dark ? "inline-flex bg-white rounded-md px-1.5 py-1" : "inline-flex"}>
            <img src={company.logoUrl} alt={company?.name} className="h-8 object-contain" />
          </span>
        ) : (
          <span className="font-semibold" style={{ color: company?.theme?.hex }}>{company?.name}</span>
        )}
      </div>
    </header>
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
  // Which option the document shows (display only — never what's ticked or approved). null = the estimate as written.
  const [viewOptionId, setViewOptionId] = useState<string | null>(null);
  // Optional discounts start folded behind "See available discounts" (owner, 2026-10-21).
  const [discountsOpen, setDiscountsOpen] = useState(false);
  // "Want more than one option?" — the combine-scopes checklist under the option tabs.
  const [combineOpen, setCombineOpen] = useState(false);
  // Upsell scopes asked for in this visit (the server remembers earlier ones).
  const [upsellAsked, setUpsellAsked] = useState<string[]>([]);

  // A contractor preview grant rides in the page URL — forward it to the API.
  const previewGrant = new URLSearchParams(window.location.search).get("preview");
  const docUrl = `/api/public/estimates/${token}${previewGrant ? `?preview=${encodeURIComponent(previewGrant)}` : ""}`;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [docUrl],
    enabled: !!token,
    retry: false,
  });

  // First-open pass (?k= from the document email): clicking from the inbox
  // proves inbox possession, so the pass signs the recipient in directly —
  // no email round-trip on the first open. Redeemed here via POST (scanners
  // that prefetch the link never consume it); single-use, so a forwarded
  // copy opened on another device falls back to the email gate below.
  const firstOpenPass = new URLSearchParams(window.location.search).get("k");
  const [passState, setPassState] = useState<"idle" | "trying" | "failed">("idle");
  // One attempt per page load, guarded by a ref: state changes re-run the
  // effect, and a cleanup-style cancellation here once left a successful
  // redemption ignored (spinner forever until a manual reload).
  const passAttempted = useRef(false);
  const needsGate = (() => {
    const msg = String((error as Error | null)?.message ?? "");
    if (!msg.startsWith("401:")) return false;
    try { return JSON.parse(msg.slice(msg.indexOf(":") + 1))?.requiresVerification === true; }
    catch { return false; }
  })();
  useEffect(() => {
    if (!needsGate || !firstOpenPass || passAttempted.current) return;
    passAttempted.current = true;
    setPassState("trying");
    (async () => {
      try {
        const r = await fetch("/api/client/auth/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: firstOpenPass, docToken: token }),
        });
        if (r.ok) {
          // The pass is spent and the session cookie is set — navigate to the
          // bare URL (no ?k) for a clean load on the session. A full
          // navigation, deliberately: no client-state juggling can strand it.
          const url = new URL(window.location.href);
          url.searchParams.delete("k");
          window.location.replace(url.toString());
        } else {
          setPassState("failed");
        }
      } catch {
        setPassState("failed");
      }
    })();
  }, [needsGate, firstOpenPass]);

  // Engagement heartbeat — starts only once the document has loaded, and
  // never for a contractor preview (that's not client behaviour).
  useEngagementTracker("estimate", token, !!data && !data?.preview,
    new URLSearchParams(window.location.search).get("terms") === "1" ? "terms" : "estimate");

  // The org's primary financing link. Gated like the document itself; skipped
  // in contractor preview (no client session exists there).
  const { data: payInfo } = useQuery<any>({
    queryKey: [`/api/public/estimates/${token}/pay-info`],
    enabled: !!data && !data?.preview,
    retry: false,
  });

  // "Curious what a roof replacement would cost?" — trades the division offers
  // that aren't on this bid (server/crm/self-estimate.ts). Same gate as the
  // document; a preview grant reads it read-only.
  const { data: selfEstimate } = useQuery<any>({
    queryKey: [`/api/public/estimates/${token}/self-estimate${previewGrant ? `?preview=${encodeURIComponent(previewGrant)}` : ""}`],
    enabled: !!data,
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
    // No argument: the ticked scopes. An option id: approve that one option on its own (the option tabs).
    mutationFn: async (onlyOptionId?: string) => {
      const r = await fetch(`/api/public/estimates/${token}/select-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optionIds: onlyOptionId ? [onlyOptionId] : selectedOptions,
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

  // "Yes, show me my roofing bid" — the team gets a draft to review; nothing is priced for the client here.
  const upsell = useMutation({
    mutationFn: async (scope: string) => {
      const r = await fetch(`/api/public/estimates/${token}/upsell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "Something went wrong");
      return r.json();
    },
    onSuccess: (_j, scope) => setUpsellAsked((cur) => [...cur, scope]),
    onError: (e: any) => toast({ title: "Could not send your request", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    const msg = String((error as Error).message ?? "");
    // 401 requiresVerification = the email gate. The document stays sealed
    // until the visitor proves they own the inbox it was sent to.
    if (needsGate) {
      // A pass is being redeemed — hold the spinner, not the gate.
      if (firstOpenPass && passState !== "failed") {
        return <div className="flex justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
      }
      return (
        <>
          {passState === "failed" && (
            <div className="bg-amber-500/10 border-b border-amber-500/40 px-4 py-3 text-center text-sm text-amber-700 dark:text-amber-400"
              data-testid="text-pass-used">
              This email link was already used on another device, so we need to confirm it's you —
              enter your email below and we'll send a fresh link only to the address this document
              belongs to.
            </div>
          )}
          <DocGateChallenge docType="estimate" token={token!} />
        </>
      );
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
        <ErrorCard title="This link isn't valid"
          description={apiErrorMessage(error, "This link is no longer valid.")} />
      </div>
    );
  }

  const { estimate: e, items, company, customer, options, preview, discountOffers, salesRep, answerBlock, home3d, viewer3d } = data;
  const settled = done ?? (e.approvedAt ? "approved" : e.declinedAt ? "declined" : null);
  const expired = e.expiresAt && new Date(e.expiresAt).getTime() < Date.now();
  // The server says this estimate can't be answered (a draft that was never
  // sent, the other half of a scope selection already signed, or withdrawn):
  // the page renders read-only with the reason — the respond route refuses
  // it too, this just doesn't offer a button that would fail.
  const blocked = !settled && !!answerBlock;

  // ?terms=1 → the separate Terms & Conditions page (HCP-style hyperlink
  // target). Same data, same email gate — just a different render.
  const showTerms = new URLSearchParams(window.location.search).get("terms") === "1";
  if (showTerms) {
    const backHref = `/e/${token}${previewGrant ? `?preview=${encodeURIComponent(previewGrant)}` : ""}`;
    return (
      <main className="min-h-screen bg-muted/40" style={orgThemeStyle(company?.theme)} data-testid="estimate-terms-root" data-track-section="terms">
        <PrintLockdown />
        <BrandBar company={company} />
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <a href={backHref} className="text-sm text-primary hover:underline" data-testid="link-back-to-estimate" data-track="back_to_estimate">
            ← Back to estimate
          </a>
          <h1 className="text-3xl font-bold tracking-tight">Terms and Conditions</h1>
          <Card className="shadow-md">
            <CardContent className="p-5 sm:p-8 space-y-6">
              {company.termsAndConditions && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-org-terms">
                  {company.termsAndConditions}
                </p>
              )}
              {e.termsText && !isSameTerms(e.termsText, company.termsAndConditions) && (
                <>
                  {company.termsAndConditions && <Separator />}
                  <div>
                    <div className="font-medium text-sm mb-2">Terms specific to this estimate</div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="text-estimate-terms">
                      {e.termsText}
                    </p>
                  </div>
                </>
              )}
              {!company.termsAndConditions && !e.termsText && (
                <p className="text-sm text-muted-foreground">
                  {company.name} hasn't published terms for this estimate. Contact them with any questions.
                </p>
              )}
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground/70 pb-4">{company.name}</p>
        </div>
      </main>
    );
  }

  // A contractor previewing a draft sees what the client will see once it's sent (the "not sent" block is the
  // only difference, and the preview banner says so).
  const blockedForClient = blocked && !(preview && answerBlock?.code === "not_sent");

  // ── Option tabs ──────────────────────────────────────────────────────────
  // Option 1 (is_main) IS the estimate's own lines; any other option with lines can be shown as the document.
  // Cancelled options never reach the payload — and a cancelled Option 1 means the estimate's own lines aren't on
  // offer either, so the page opens on the first remaining option.
  const allOptions: any[] = (options ?? []).filter((o: any) => !o.cancelledAt);
  const mainCancelled = !!data.mainCancelled;
  const mainOption = allOptions.find((o) => o.isMain) ?? null;
  const altOptions = allOptions.filter((o) => !o.isMain && o.doc);
  const viewed = (viewOptionId ? altOptions.find((o) => o.id === viewOptionId) : null)
    ?? (mainCancelled ? altOptions[0] ?? null : null);
  const viewDoc = viewed?.doc ?? null;
  const activeOptionId: string | null = viewed?.id ?? mainOption?.id ?? null;
  const optionTabs = altOptions.length > 0 && (allOptions.length > 1 || mainCancelled);
  const viewOption = (o: any | null) => setViewOptionId(!o || o.isMain ? null : o.id);

  // ── Optional discounts — LIVE preview ────────────────────────────────────
  // Same math as the server's approve (shared/estimate-totals.ts + shared/scope-category.ts effectiveOffer): a
  // tiered bundle is worth what the lines BEING SHOWN earn — Option 2 alone may not earn what Option 1 does.
  const offers: any[] = discountOffers ?? [];
  const priceOffers = (cats: string[]) => offers.map((o) => {
    const rule = bundleRuleOf(o.rule);
    if (!rule) return { ...o, available: o.available !== false };
    const eff = effectiveOffer({ percentBps: o.basePercentBps ?? o.percentBps, rule }, cats.map((c) => ({ scopeCategory: c })));
    return { ...o, percentBps: eff.percentBps, available: eff.available, unavailableReason: eff.reason };
  });
  const ticked = (list: any[]) => list.filter((o) => selectedDiscounts.includes(o.id) && o.available !== false);

  // ── Client-selectable scopes ("combine options") ─────────────────────────
  // Options carrying their own line items can be ticked together; the server regenerates the real document from
  // the ticked ones. With option tabs this checklist is folded behind "Want more than one option?".
  const selectable: any[] = (options ?? []).filter((o: any) => o.selectable);
  const canCombine = selectable.length > 1 && data?.optionApproval !== "one";
  const scopesOnOffer = selectable.length > 0 && !settled && !expired && !blockedForClient
    && (!optionTabs || (canCombine && combineOpen));
  const chosenOptions = scopesOnOffer ? selectable.filter((o) => selectedOptions.includes(o.id)) : [];
  const scopeCats: string[] = [...new Set(chosenOptions.flatMap((o) => o.categories ?? []))];
  const viewCats: string[] = viewed ? (viewed.categories ?? []) : (data.docCategories ?? []);
  const viewOffers = priceOffers(viewCats);
  const scopeOffers = priceOffers(scopeCats);
  // The card lists the offers as they apply to what the client is looking at: the ticked scopes, else the document.
  const shownOffers = chosenOptions.length ? scopeOffers : viewOffers;

  const live = previewEstimatePage(e, [], ticked(viewOffers));
  const docTotals = viewed
    ? totalsFromBases({
        subtotalCents: viewed.subtotalCents ?? 0, lineDiscountCents: viewed.lineDiscountCents ?? 0, taxableCents: viewed.taxableCents ?? 0,
      }, e.taxRateBps ?? 0, ticked(viewOffers))
    : live.document;
  const selBps = docTotals.optionalDiscountBps;
  const previewing = selBps > 0 && !settled;
  const optDiscountCents = docTotals.optionalDiscountCents;
  const shownTaxCents = previewing ? docTotals.taxCents : viewDoc ? viewDoc.taxCents : e.taxCents;
  const shownTotalCents = previewing
    ? docTotals.totalCents
    : viewDoc ? viewDoc.totalCents : (settled === "approved" ? (e.approvedTotalCents ?? e.totalCents) : e.totalCents);
  const appliedDiscounts: any[] = settled === "approved" && Array.isArray(e.selectedDiscounts) ? e.selectedDiscounts : [];
  // Pay-in-full: the client pays the whole job now, so "Deposit due" is the total.
  const payInFull = settled === "approved"
    ? appliedDiscounts.some((d) => d?.code === PAY_IN_FULL_CODE)
    : ticked(shownOffers).some((o) => o.code === PAY_IN_FULL_CODE);
  // The deposit the pay step will ask for — never more than the total shown. An option shown on its own gets the
  // estimate's deposit percentage (that's what its own estimate will carry).
  const depositFor = (total: number) => payInFull ? total
    : viewDoc ? (e.depositBps ? Math.min(total, Math.round((total * e.depositBps) / 10_000)) : 0)
    : (e.depositCents ? Math.min(e.depositCents, total) : 0);
  const shownDepositCents = depositFor(shownTotalCents);

  const toggleDiscount = (id: string, on: boolean) =>
    setSelectedDiscounts((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));

  const sel = chosenOptions.length
    ? totalsFromBases(sumLineBases(chosenOptions), e.taxRateBps ?? 0, ticked(scopeOffers))
    : null;
  const selSubtotalCents = sel ? sel.subtotalCents - sel.lineDiscountCents : 0;
  const selDiscountCents = sel?.optionalDiscountCents ?? 0;
  const selTaxCents = sel?.taxCents ?? 0;
  const selTotalCents = sel?.totalCents ?? 0;
  const noteTotalCents = sel ? selTotalCents : shownTotalCents;
  const scopePriceCents = (o: any) => (o.subtotalCents ?? 0) - (o.lineDiscountCents ?? 0);
  const toggleOption = (id: string, on: boolean) =>
    // "Customer can approve: Only one option" — picking one replaces the other (the server enforces it too).
    setSelectedOptions((cur) => (on ? (data?.optionApproval === "one" ? [id] : [...cur, id]) : cur.filter((x) => x !== id)));

  const docItems: any[] = viewDoc ? viewDoc.items : items;
  const docSubtotalCents = viewDoc ? viewDoc.subtotalCents : e.subtotalCents;
  const docDiscountCents = viewDoc ? viewDoc.discountCents : e.discountCents;
  const docTaxCents = shownTaxCents;
  const docTotalCents = shownTotalCents;
  // Each option tab's price with the ticked discounts, as that option would be signed.
  const optionTabTotal = (o: any) => {
    if (o.id === activeOptionId) return shownTotalCents;
    if (o.isMain) return previewEstimatePage(e, [], ticked(priceOffers(data.docCategories ?? []))).document.totalCents;
    if (!o.doc) return o.totalCents;
    return totalsFromBases({ subtotalCents: o.subtotalCents ?? 0, lineDiscountCents: o.lineDiscountCents ?? 0, taxableCents: o.taxableCents ?? 0 },
      e.taxRateBps ?? 0, ticked(priceOffers(o.categories ?? []))).totalCents;
  };
  // The heading names what is shown: Option 2's own lines, never Option 1's title.
  const docTitle = viewDoc ? autoTitleFrom(viewDoc.items) : e.title;

  // ── "Want to see your roofing bid too?" ─────────────────────────────────
  // Offered for the bundle's scopes this estimate doesn't have (painting, gutters, doors never count), with what
  // adding them would unlock under the org's bundle rule.
  const bundleRule: BundleRule | null = bundleRuleOf(data.bundleRule);
  const upsellPool = (bundleRule?.categories ?? ["siding", "windows", "roofing"])
    .filter((c) => c === "siding" || c === "windows" || c === "roofing");
  const haveCats = new Set<string>([...(data.docCategories ?? []), ...altOptions.flatMap((o) => o.categories ?? [])]);
  const missingScopes = upsellPool.filter((c) => !haveCats.has(c));
  const haveCount = upsellPool.filter((c) => haveCats.has(c)).length;
  const unlockFor = (add: number) => {
    if (!bundleRule) return null;
    const tier = [...bundleRule.tiers].sort((a, b) => b.min - a.min).find((t) => haveCount + add >= t.min);
    const now = [...bundleRule.tiers].sort((a, b) => b.min - a.min).find((t) => haveCount >= t.min);
    return tier && tier.percentBps > (now?.percentBps ?? 0) ? tier.percentBps : null;
  };
  const upsellUnlockBps = unlockFor(1);
  const upsellRequested = new Set<string>([...(data.upsellRequested ?? []), ...upsellAsked]);
  const showUpsell = missingScopes.length > 0 && !expired && !blockedForClient && !selfEstimate?.enabled;
  const scopeLabel = (c: string) => SCOPE_CATEGORY_LABEL[c as ScopeCategory]?.toLowerCase() ?? c;

  // The org's company theme — black + their accent. Server-resolved in the
  // payload; re-points --primary for everything below this root.
  const themeStyle = orgThemeStyle(company?.theme);

  const canRespond = !settled && !expired && !preview && !blocked;
  const termsHref = `/e/${token}?terms=1${previewGrant ? `&preview=${encodeURIComponent(previewGrant)}` : ""}`;
  const scrollToSign = () => {
    document.getElementById("sign-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => document.getElementById("sig")?.focus({ preventScroll: true }), 450);
  };

  return (
    <main className={`min-h-screen bg-muted/40 ${canRespond ? "pb-24" : ""}`}
      style={themeStyle} data-testid="public-estimate-root">
      <PrintLockdown />
      {/* HCP-style brand bar — the contractor's logo on their chosen base. */}
      <BrandBar company={company} />
      <div className="max-w-5xl mx-auto space-y-5 py-6 px-3 sm:py-8 sm:px-4">
        {/* Breadcrumb + big title, like the reference portal. */}
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground" data-testid="estimate-breadcrumb">
            <a href={/^(\d{1,3}\.){3}\d{1,3}$|^localhost$/.test(window.location.hostname)
              // IPs/localhost can't take a client. subdomain — the portal lives on the same origin there.
              ? window.location.origin
              : `https://client.${window.location.hostname.replace(/^(portal|client)\./, "")}`}
              className="hover:underline">Customer Portal</a>
            <span className="mx-1.5">›</span>Estimates<span className="mx-1.5">›</span>
            <span className="text-foreground font-medium">View Estimate</span>
          </div>
          <div>
            <div className="font-semibold">{company.name}</div>
            {(company.addressLine1 || company.city) && (
              <div className="text-sm text-muted-foreground underline decoration-dotted underline-offset-4">
                {[
                  [company.addressLine1, company.addressLine2].filter(Boolean).join(", "),
                  [company.city, [company.state, company.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                ].filter(Boolean).join(", ")}
              </div>
            )}
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-tight" data-testid="text-estimate-for">
            Estimate for {customer.displayName}
          </h1>
        </div>
        {/* The org's bid headline (Settings → Estimate & invoice defaults) —
            first thing on the bid, above the scopes and the line items. */}
        <BidHeadlineBanner headline={company.bidHeadline} hasWarranty={!!company.warrantyText} />
        {preview && (
          <Card className="border-amber-500/50 bg-amber-500/5" data-testid="preview-banner">
            <CardContent className="p-4 text-sm text-center">
              <span className="font-medium">Contractor preview</span> — this is what your client
              sees when they open the estimate link. Approving and paying are disabled here.
            </CardContent>
          </Card>
        )}

        {settled === "approved" && !preview && (
          <PayCard token={token!} company={company} estimate={e} payInfo={payInfo} />
        )}

        {blocked && !(preview && answerBlock.code === "not_sent") && (
          <Card className="border-amber-500/50 bg-amber-500/5" data-testid="notice-not-answerable">
            <CardContent className="p-5 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">
                  {answerBlock.code === "not_sent" ? "This estimate hasn't been sent yet"
                    // An imported estimate that was never sent from ConstructHUB:
                    // the server's message already says who to ask, so no suffix.
                    : answerBlock.code === "not_open" ? "Not open for online approval yet"
                    : answerBlock.code === "superseded" ? "You've already approved this job"
                    : "This estimate is no longer open"}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-not-answerable">
                  {answerBlock.message}
                  {answerBlock.code === "not_sent" && ` ${company.name} will send it to you when it's ready.`}
                </p>
                {answerBlock.link && (
                  <a href={answerBlock.link} className="inline-block mt-2 text-sm font-medium text-primary hover:underline"
                    data-testid="link-current-estimate">
                    Open the current estimate →
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
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

        {optionTabs && (
          <Card className="shadow-sm" data-testid="option-tabs-card">
            <CardHeader>
              <CardTitle className="text-lg">Choose your option</CardTitle>
              <CardDescription>
                {company.name} put together {allOptions.length} ways to do this. Tap one to see it below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div role="tablist" aria-label="Estimate options" className="grid gap-3 sm:grid-cols-3"
                onKeyDown={(ev) => {
                  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
                  if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
                  const tabs = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
                  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
                  if (i < 0) return;
                  ev.preventDefault();
                  const next = tabs[(i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                  next.focus(); next.click();
                }}>
                {!mainOption && !mainCancelled && (
                  <button type="button" role="tab" aria-selected={activeOptionId === null} aria-controls="estimate-document"
                    tabIndex={activeOptionId === null ? 0 : -1}
                    onClick={() => viewOption(null)}
                    className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      activeOptionId === null ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "bg-card hover:bg-accent/50"}`}
                    data-testid="option-tab-estimate" data-track="option_tab" data-track-detail="Estimate">
                    <span className="font-medium">Estimate</span>
                    <div className="text-xl font-semibold tabular-nums mt-3">{money(shownTotalCents)}</div>
                  </button>
                )}
                {allOptions.map((o: any) => {
                  const active = activeOptionId === o.id;
                  const viewable = o.isMain || !!o.doc;
                  return (
                    <button key={o.id} type="button" role="tab" aria-selected={active} aria-controls="estimate-document"
                      tabIndex={active ? 0 : -1} disabled={!viewable}
                      onClick={() => viewOption(o)}
                      data-track="option_tab" data-track-detail={o.name}
                      className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default ${
                        active ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "bg-card hover:bg-accent/50"}`}
                      data-testid={`option-${o.tier}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{o.name}</span>
                        {o.recommended && <StatusPill tone="info" dot={false}>recommended</StatusPill>}
                      </div>
                      {o.description && <p className="text-xs text-muted-foreground mt-1.5">{o.description}</p>}
                      {optionTabTotal(o) != null && (
                        <div className="text-xl font-semibold tabular-nums mt-3" data-testid={`option-tab-total-${o.tier}`}>{money(optionTabTotal(o))}</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {canCombine && !settled && !expired && !blockedForClient && (
                <button type="button" className="mt-3 text-sm font-medium text-primary hover:underline"
                  aria-expanded={combineOpen}
                  onClick={() => { setCombineOpen(!combineOpen); if (combineOpen) setSelectedOptions([]); }}
                  data-track="options_combine" data-track-detail={combineOpen ? "close" : "open"}
                  data-testid="button-combine-options">
                  {combineOpen ? "Hide combining options" : "Want more than one option? Combine them"}
                </button>
              )}
            </CardContent>
          </Card>
        )}
        {scopesOnOffer && (
          <Card className="shadow-sm" data-testid="options-checklist">
            <CardHeader>
              <CardTitle className="text-lg">Choose your scopes</CardTitle>
              <CardDescription>
                {reviewing
                  ? "Check your selection — anything struck through is left out of your new estimate."
                  : data?.optionApproval === "one"
                    ? `${company.name} put together ${selectable.length} options for this job. Choose one — the total updates as you go.`
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
                          <div className="text-xl font-semibold tabular-nums mt-3 line-through">{money(scopePriceCents(o))}</div>
                        )}
                      </div>
                    );
                  }
                  return (
                    <label key={o.id}
                      className={`rounded-lg border p-4 transition-colors ${reviewing ? "" : "cursor-pointer"} ${
                        on ? "border-primary ring-1 ring-primary/50 bg-primary/5" : "bg-card hover:bg-accent/50"}`}
                      data-testid={`option-${o.tier}`} data-track="scope_toggle" data-track-detail={o.name}>
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
                        <div className="text-xl font-semibold tabular-nums mt-3">{money(scopePriceCents(o))}</div>
                      )}
                      {o.recommended && !reviewing && (
                        <div className="mt-2"><StatusPill tone="info" dot={false}>recommended</StatusPill></div>
                      )}
                      {(o.doc || o.isMain) && (
                        <button type="button" aria-pressed={activeOptionId === o.id}
                          className="mt-2 block text-xs font-medium text-primary hover:underline"
                          onClick={(ev) => {
                            // Show this option's lines below — never toggles the checkbox.
                            ev.preventDefault(); ev.stopPropagation();
                            viewOption(activeOptionId === o.id ? null : o);
                            document.getElementById("estimate-document")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          data-track="option_view" data-track-detail={o.name}
                          data-testid={`button-view-option-${o.id}`}>
                          {activeOptionId === o.id ? "Viewing below" : "View"}
                        </button>
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
                      disabled={generate.isPending || !!preview}
                      onClick={() => generate.mutate(undefined)}
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
        )}
        {!optionTabs && !scopesOnOffer && options?.length > 1 && (
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
                  data-testid={`option-${o.tier}`} data-track="option_tab" data-track-detail={o.name}>
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
        <Card id="estimate-document" role={optionTabs ? "tabpanel" : undefined} className="shadow-md overflow-hidden scroll-mt-4"
          data-testid="estimate-document" data-viewing-option={viewed?.id ?? activeOptionId ?? undefined}>
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
                {/* Division separation made unmistakable: an FL estimate never
                    reads like it came from the WA arm. */}
                {company.divisionCode && (
                  <div className="inline-flex items-center rounded-md bg-primary/10 text-primary text-xs font-medium px-2 py-0.5"
                    data-testid="badge-division">
                    {company.divisionName ?? company.name} · {company.divisionCode} division
                  </div>
                )}
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
                  <div className="text-2xl font-bold tabular-nums" data-testid="doc-total">{money(docTotalCents)}</div>
                </div>
              </div>
            </div>
            {/* Prepared for — the client's own details. */}
            <div className="rounded-lg border bg-muted/30 p-4" data-testid="prepared-for" data-track-section="letterhead">
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
            {/* The warranty — FIRST in the contract, right under Prepared for,
                before the title and the line items (owner, 2026-10-21: "the
                actual contract should have the warranty in it first line").
                The estimate's own short warranty text; the full warranty lives
                in the Terms and Conditions. The only full copy on the page. */}
            {company.warrantyText && (
              <div id={WARRANTY_ANCHOR} className="scroll-mt-24 rounded-lg border-2 border-primary/60 bg-primary/5 p-4 space-y-2"
                data-testid="section-warranty" data-track-section="warranty">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-5 w-5 text-primary shrink-0" /> Warranty
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-warranty">{company.warrantyText}</p>
                <a href={termsHref} className="inline-block text-sm text-primary underline font-medium" data-testid="link-warranty-terms" data-track="terms_open" data-track-detail="from the warranty">
                  Read the full Terms and Conditions
                </a>
              </div>
            )}
            {payInfo?.financing && (
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary text-sm font-medium px-2.5 py-1"
                data-testid="badge-financing-available">
                Financing available
              </span>
            )}
            <CardTitle className="text-xl" data-testid="doc-title">{docTitle}</CardTitle>
            {viewed && (
              <span className="inline-flex items-center rounded-md bg-primary/10 text-primary text-sm font-medium px-2.5 py-1"
                data-testid="doc-viewing-option">
                Showing {viewed.name}
              </span>
            )}
            {e.introText && <p className="whitespace-pre-wrap text-sm leading-relaxed">{e.introText}</p>}

            {/* Line items. The price sits on the title's line (owner, 2026-10-21: "put the pricing at the TOP of
                each line item"), then the scope text uses the full width. Below sm the price row drops under the
                title — no sideways scrolling on a phone. */}
            <div className="rounded-lg border divide-y" data-testid="doc-lines">
              <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_8rem] gap-4 bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground rounded-t-lg">
                <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span>
              </div>
              {docItems.map((i: any) => (
                <div key={i.id} className="px-4 py-4 sm:px-5" data-testid="doc-line" data-track-section={`scope:${String(i.name ?? "").slice(0, 34)}`}>
                  <div className="sm:grid sm:grid-cols-[1fr_8rem_8rem_8rem] sm:gap-4 sm:items-baseline">
                    <div className="text-xl sm:text-2xl font-bold tracking-tight leading-snug min-w-0" data-testid="text-line-title">{i.name}</div>
                    <div className="hidden sm:block text-right tabular-nums">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""}</div>
                    <div className="hidden sm:block text-right tabular-nums">{money(i.unitPriceCents)}</div>
                    <div className="hidden sm:block text-right tabular-nums font-semibold" data-testid="text-line-total">{money(i.lineTotalCents)}</div>
                    {/* Phone: one row under the title — "300 sf × $22.00 ……… $6,600.00". */}
                    <div className="sm:hidden mt-1 flex items-baseline justify-between gap-3 text-sm tabular-nums">
                      <span className="text-muted-foreground">{qty(i.quantityMilli)}{i.unit ? ` ${i.unit}` : ""} × {money(i.unitPriceCents)}</span>
                      <span className="font-semibold">{money(i.lineTotalCents)}</span>
                    </div>
                  </div>
                  {/* Full scope of work — multi-line bullets preserved, HCP-style, across the whole card. */}
                  {i.description && <div className="text-muted-foreground text-sm mt-2 whitespace-pre-wrap leading-relaxed">{i.description}</div>}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-xs text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium tabular-nums" data-testid="doc-subtotal">{money(docSubtotalCents)}</span>
                </div>
                {docDiscountCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="font-medium tabular-nums">−{money(docDiscountCents)}</span>
                  </div>
                )}
                {previewing && (
                  <div className="flex justify-between" data-testid="row-optional-discount">
                    <span className="text-muted-foreground">Optional discounts</span>
                    <span className="font-medium tabular-nums">−{money(optDiscountCents)}</span>
                  </div>
                )}
                {appliedDiscounts.length > 0 && !viewDoc && (
                  <div className="flex justify-between" data-testid="row-applied-discounts">
                    <span className="text-muted-foreground">Optional discounts</span>
                    <span className="font-medium text-right">{appliedDiscounts.map((d) => d.label).join(", ")}</span>
                  </div>
                )}
                {docTaxCents > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="font-medium tabular-nums">{money(docTaxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  Total <span className="tabular-nums" data-testid="doc-grand-total" data-track-section="totals">{money(docTotalCents)}</span>
                </div>
                {shownDepositCents > 0 ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>{payInFull ? "Due now (paid in full)" : "Deposit due"}</span>
                    <span className="font-medium tabular-nums" data-testid="text-deposit-due">{money(shownDepositCents)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            {/* T&C moved to their own linked page (?terms=1) — see the footer
                block below. Warranty note renders there too, HCP-style. */}
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

        {/* Share with someone else — a spouse or co-signer gets their own
            secure link, and the contractor sees who was added. */}
        {!preview && !expired && <ShareEstimateCard token={token!} />}

        {((offers.length > 0 && !settled && !expired && !blockedForClient) || showUpsell) && (() => {
          // Standard offers first; the bundle and price match are "Additional discounts" with the upsell.
          const isAdditional = (o: any) => o.code === "bundle" || o.code === "price_match" || !!bundleRuleOf(o.rule);
          const standard = settled || expired || blockedForClient ? [] : shownOffers.filter((o) => !isAdditional(o));
          const additional = settled || expired || blockedForClient ? [] : shownOffers.filter(isAdditional);
          const count = standard.length + additional.length;
          const offerRow = (o: any) => {
            const on = selectedDiscounts.includes(o.id) && o.available !== false;
            const priceMatch = o.code === "price_match" && !(o.percentBps > 0);
            return (
              <label key={o.id} className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-accent/50 active:bg-accent transition-colors"
                data-testid={`discount-offer-${o.code}`}>
                <Checkbox
                  className="mt-0.5 h-5 w-5"
                  checked={on}
                  disabled={o.available === false}
                  onCheckedChange={(c) => toggleDiscount(o.id, c === true)}
                  data-track="discount_toggle" data-track-detail={`${o.code}:${on ? "off" : "on"}`}
                  data-testid={`check-discount-${o.code}`}
                />
                <span className="min-w-0">
                  <span className="font-medium text-sm">
                    {o.label}{" "}
                    <span className="text-primary">
                      {o.available === false ? "not available yet"
                        : priceMatch ? "we'll match it"
                        : `−${(o.percentBps / 100).toLocaleString("en-US")}%`}
                    </span>
                  </span>
                  {o.ruleText && <span className="block text-xs text-muted-foreground mt-0.5">{o.ruleText}</span>}
                  {o.available === false && o.unavailableReason && (
                    <span className="block text-xs text-muted-foreground mt-0.5" data-testid={`text-discount-unavailable-${o.code}`}>{o.unavailableReason}</span>
                  )}
                  {o.conditions && (
                    <span className="block text-xs text-muted-foreground mt-0.5">{o.conditions}</span>
                  )}
                  {priceMatch && on && (
                    <span className="block text-xs text-foreground mt-1" data-testid="text-price-match-ticked">
                      We'll review your competing estimate and match it. Send it to {salesRep?.name ?? company.name}
                      {salesRep?.email || company.email ? <> at {salesRep?.email ?? company.email}</> : null}. Your total here
                      doesn't change until we've compared them.
                    </span>
                  )}
                </span>
              </label>
            );
          };
          return (
            <Card className="shadow-md" data-testid="discounts-section" data-track-section="discounts">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BadgePercent className="h-5 w-5 text-primary" /> {count > 0 ? "Discounts" : "Add to your project"}
                </CardTitle>
                <CardDescription>
                  {count > 0
                    ? "You may qualify for savings on this estimate. Tick any that apply — the total updates as you go."
                    : "More of your home, done at the same time."}
                </CardDescription>
                {count > 0 && (
                  <Button variant={discountsOpen ? "secondary" : "default"} className="mt-3 w-full sm:w-auto h-11 justify-between gap-3"
                    aria-expanded={discountsOpen} aria-controls="discounts-body"
                    onClick={() => setDiscountsOpen(!discountsOpen)}
                    data-track="discounts_open" data-track-detail={discountsOpen ? "close" : "open"}
                    data-testid="button-see-discounts">
                    {discountsOpen ? "Hide discounts" : `See available discounts (${count})`}
                    <ChevronDown className={`h-4 w-4 transition-transform ${discountsOpen ? "rotate-180" : ""}`} />
                  </Button>
                )}
                {count > 0 && !discountsOpen && (sel ? sel.optionalDiscountBps : selBps) > 0 && (
                  <p className="text-xs text-muted-foreground mt-2" data-testid="text-discounts-folded-note">
                    {ticked(shownOffers).length} discount{ticked(shownOffers).length === 1 ? "" : "s"} ticked — your total: <strong className="text-foreground">{money(noteTotalCents)}</strong>
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-5" id="discounts-body">
                {discountsOpen && standard.length > 0 && (
                  <div className="space-y-3" data-testid="discounts-standard">
                    {standard.map(offerRow)}
                  </div>
                )}
                {(discountsOpen && additional.length > 0) || showUpsell ? (
                  <div className="space-y-3" data-testid="discounts-additional">
                    {discountsOpen && additional.length > 0 && (
                      <>
                        <div className="text-sm font-semibold pt-1">Additional discounts</div>
                        {additional.map(offerRow)}
                      </>
                    )}
                    {showUpsell && (
                      <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3"
                        data-track-section="upsell" data-testid="upsell-card">
                        {preview && (
                          <div className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="upsell-preview-note">
                            Preview — your client sees this; the buttons are off here.
                          </div>
                        )}
                        <div className="flex items-start gap-2">
                          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold">
                              Want to see your {missingScopes.map(scopeLabel).join(" or ")} bid too?
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              Your report and bid can be created instantly
                              {upsellUnlockBps ? <> — add {haveCount + 1 >= upsellPool.length ? "the third" : "1 more"} scope
                                and save <strong className="text-foreground">{(upsellUnlockBps / 100).toLocaleString("en-US")}%</strong> on the whole job with the bundle discount</> : null}.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
                          {missingScopes.map((c) => {
                            const asked = upsellRequested.has(c);
                            return asked ? (
                              <p key={c} className="text-sm rounded-md border bg-background p-3" data-testid={`upsell-asked-${c}`}>
                                <CheckCircle2 className="inline h-4 w-4 text-emerald-600 mr-1 -mt-0.5" />
                                Got it — we're putting your {scopeLabel(c)} bid together and will email it to you shortly.
                              </p>
                            ) : (
                              <Button key={c} variant="outline" className="h-11 border-primary/50"
                                disabled={!!preview || upsell.isPending}
                                onClick={() => upsell.mutate(c)}
                                data-track="upsell_click" data-track-detail={c}
                                data-testid={`button-upsell-${c}`}>
                                {upsell.isPending && upsell.variables === c && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Yes, show me my {scopeLabel(c)} bid
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                {/* The total these ticks lead to: the ticked scopes when there are any, else what is shown above. */}
                {discountsOpen && sel && sel.optionalDiscountBps > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="text-discount-note">
                    Your new total for the {chosenOptions.length === 1 ? "scope" : `${chosenOptions.length} scopes`} you
                    ticked ({chosenOptions.map((o) => o.name).join(", ")}):{" "}
                    <strong className="text-foreground" data-testid="text-discount-note-total">{money(noteTotalCents)}</strong> —
                    verified against the offer conditions when the job is scheduled.
                  </p>
                )}
                {discountsOpen && previewing && !sel && (
                  <p className="text-xs text-muted-foreground" data-testid="text-discount-note">
                    Your new total{viewed ? ` for ${viewed.name}` : ""}: <strong className="text-foreground" data-testid="text-discount-note-total">{money(noteTotalCents)}</strong> —
                    verified against the offer conditions when the job is scheduled.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {payInfo?.financing && (
          <Card className="shadow-sm">
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">Prefer to spread payments out?</div>
              <a href={payInfo.financing.url} target="_blank" rel="noreferrer" data-testid="link-financing" data-track="financing_open"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Finance this project →
                <span className="font-normal text-muted-foreground">{payInfo.financing.label}</span>
              </a>
            </CardContent>
          </Card>
        )}

        {canRespond && (
          <Card className="shadow-md border-primary/30" id="sign-card" data-track-section="approve">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="text-lg">Ready to go ahead{viewed ? ` with ${viewed.name}` : ""}?</CardTitle>
              <CardDescription>
                {viewed ? "You'll sign on the next page." : "Type your name to approve. This is your signature."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-3">
              {!viewed && (
              <div>
                <Label htmlFor="sig">Your full name</Label>
                <Input id="sig" value={name} onChange={(ev) => setName(ev.target.value)}
                  placeholder={customer.displayName} data-testid="input-signature" data-track="approve_open" data-track-detail="typed in the signature box"
                  className="h-12 text-base" />
              </div>
              )}
              {/* Ticking scopes is not a selection until it is generated:
                  this button signs the document above, as written. */}
              {chosenOptions.length > 0 && !viewed && (
                <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                  data-testid="text-approve-scope-warning">
                  You ticked {chosenOptions.map((o) => o.name).join(", ")} above. Approving here signs the full
                  estimate as written — <strong>{money(shownTotalCents)}</strong>. To sign only what you ticked
                  ({money(selTotalCents)}), use <strong>Review selection</strong> first.
                </p>
              )}
              {/* Approve acts on what is shown: another option becomes its own estimate (with the ticked discounts
                  carried over) and the client signs that one — never Option 1 at Option 1's price behind Option 2. */}
              {viewed && (
                <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs" data-testid="text-approve-option-note">
                  You're looking at <strong>{viewed.name}</strong> ({money(shownTotalCents)}). Continuing makes {viewed.name} its
                  own estimate with just these lines and your ticked discounts, and you sign that one. Nothing is final until you sign.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2">
                {viewed ? (
                  <Button disabled={generate.isPending}
                    className="w-full sm:w-auto h-12 sm:h-10"
                    onClick={() => generate.mutate(viewed.id)}
                    data-track="approve_option" data-track-detail={viewed.name}
                    data-testid="button-approve-option">
                    {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Continue with {viewed.name}
                  </Button>
                ) : (
                <Button disabled={name.trim().length < 2 || respond.isPending}
                  className="w-full sm:w-auto h-12 sm:h-10"
                  onClick={() => respond.mutate("approve")} data-testid="button-approve" data-track="approve_submit">
                  {respond.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Approve this estimate
                </Button>
                )}
                <Button variant="outline" className="w-full sm:w-auto h-12 sm:h-10"
                  onClick={() => setShowDecline(!showDecline)} data-testid="button-show-decline" data-track="decline_open">
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

        {/* "Not what you were looking for?" — decline / contact, HCP-style. */}
        {canRespond && (
          <div className="text-center space-y-3 py-4" data-testid="section-not-looking">
            <div className="text-xl font-semibold">Not what you were looking for?</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Please let us know if you'd like to request some changes. We'd love to win your business.
            </p>
            <div className="flex items-center justify-center gap-5 pt-1">
              <Button variant="outline" className="rounded-full px-5"
                onClick={() => { setShowDecline(true); scrollToSign(); }}
                data-testid="button-decline-shortcut" data-track="decline_open">
                Decline estimate
              </Button>
              {(company.email || company.phone) && (
                <a href={company.email ? `mailto:${company.email}` : `tel:${company.phone}`}
                  className="text-sm font-medium text-primary hover:underline" data-testid="link-contact-us">
                  Contact us
                </a>
              )}
            </div>
          </div>
        )}

        {/* Upsell: price the trades that aren't on this bid. Interest is tracked; nothing is bought here. */}
        {selfEstimate?.enabled && (
          <SelfEstimatePrompts offer={selfEstimate} transport={estimateTransport(token!)} scope={token!}
            preview={!!preview || !!selfEstimate.preview} />
        )}

        {/* "Your home in 3D" — the in-app viewer for this estimate's customer (server/crm/hover-model3d.ts); the HOVER
            design studio shows inside it only with a live share link. */}
        <Home3DCard home3d={home3d} companyName={company?.name}
          viewer={viewer3d && token ? { kind: "estimate", token, preview: previewGrant } : null} />

        {/* Footer facts — job address, expiry, warranty, contact card, T&C link. */}
        {/* Who to talk to — the client should never wonder who their person is. */}
        {salesRep && (
          <Card data-testid="card-sales-rep" data-track-section="contact">
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Your {salesRep.role === "Sales" ? "salesperson" : "contact"}</div>
                <div className="font-semibold">{salesRep.name}</div>
                <div className="text-sm space-x-3">
                  {salesRep.phone && (
                    <a href={`tel:${salesRep.phone}`} className="text-primary hover:underline" data-testid="link-salesrep-phone">{salesRep.phone}</a>
                  )}
                  {salesRep.email && (
                    <a href={`mailto:${salesRep.email}`} className="text-primary hover:underline break-all" data-testid="link-salesrep-email">{salesRep.email}</a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!preview && <AskQuestionCard token={token!} repName={salesRep?.name ?? null} />}

        <div className="space-y-4 border-t pt-6" data-testid="estimate-footer-info" data-track-section="contact">
          {(customer.addressLine1 || customer.city) && (
            <div>
              <div className="font-semibold text-sm">For:</div>
              <div className="text-sm text-muted-foreground">
                {[
                  [customer.addressLine1, customer.addressLine2].filter(Boolean).join(", "),
                  [customer.city, [customer.state, customer.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
                ].filter(Boolean).join(", ")}
              </div>
            </div>
          )}
          {e.expiresAt && (
            <div className="text-sm">
              <span className="font-semibold">Expires on:</span>{" "}
              <span className="text-muted-foreground">{new Date(e.expiresAt).toDateString()}</span>
            </div>
          )}
          {/* The warranty prints at the top of the document (section-warranty) — not again here. */}
          {e.footerText && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap" data-testid="text-estimate-footer">{e.footerText}</p>
          )}
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {company.logoUrl && (
              <img src={company.logoUrl} alt={company.name} className="h-14 object-contain" />
            )}
            <div className="text-sm">
              <div className="font-medium">{company.name}</div>
              {company.phone && <a href={`tel:${company.phone}`} className="block text-primary hover:underline">{company.phone}</a>}
              {company.email && <a href={`mailto:${company.email}`} className="block text-primary hover:underline">{company.email}</a>}
            </div>
          </div>
          <p className="text-sm">
            Please make sure to read our{" "}
            <a href={termsHref} className="text-primary underline font-medium" data-testid="link-terms" data-track="terms_open">
              Terms and Conditions
            </a>
          </p>
        </div>

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

      {/* Floating ↑ Top / ↓ Bottom while scrolling — above the Approve bar when it's showing. */}
      <ScrollJumpButton raised={canRespond} />

      {/* Sticky bottom Approve bar — always one tap away, HCP-style. Scrolls
          to the signature card, which is the real (typed-name) approval. */}
      {canRespond && (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-card border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          data-testid="estimate-approve-bar">
          <div className="max-w-5xl mx-auto">
            <Button size="lg" className="w-full h-12 rounded-full text-base" onClick={scrollToSign}
              data-testid="button-approve-bar" data-track="approve_open">
              Approve
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
