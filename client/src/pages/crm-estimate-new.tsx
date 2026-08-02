import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  cartSubtotalCents, lineTotalCents, milliToQty, money, priceToCents, qtyToMilli,
} from "@/lib/estimate-math";
import {
  ArrowLeft, Check, CheckCircle2, ChevronRight, ClipboardCopy, FileText, Loader2,
  Plus, Search, Send, Trash2, UserPlus, X,
} from "lucide-react";
import { InitialAvatar } from "@/components/crm-ui";
import { InfoTip } from "@/components/info-tip";
import { cn } from "@/lib/utils";

/**
 * The fast path: a three-step, one-handed estimate builder for the contractor
 * standing in the client's driveway. Pick the client, tap price-book items in,
 * review and send. Every touch target is 44px+, every number field summons a
 * numeric keyboard, and the running total never leaves the screen.
 *
 * This is deliberately NOT a replacement for the desktop builder on the client
 * page (options, packages, per-line cost) — it reuses the exact same endpoints
 * (POST /api/crm/estimates, POST …/send), and sales tax is left to the server:
 * the create call omits taxRateBps so the tax.ts hook resolves it from the
 * client's address.
 */

interface CustomerLite {
  id: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
}

interface CartLine {
  /** Price-book item id (an item can appear once — re-tapping bumps qty). */
  key: string;
  name: string;
  unit: string | null;
  taxable: boolean;
  /** Raw text keeps typing natural ("2." stays put); numbers are derived. */
  qtyText: string;
  priceText: string;
}

const lineNumbers = (l: CartLine) => ({
  quantityMilli: qtyToMilli(l.qtyText),
  unitPriceCents: priceToCents(l.priceText),
});

interface DoneState {
  sent: boolean;
  emailed: boolean;
  sentToEmail?: string | null;
  number?: string | null;
  totalCents?: number;
  expiresAt?: string | null;
  link?: string | null;
  error?: string;
}

export default function CrmEstimateNewPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [done, setDone] = useState<DoneState | null>(null);

  // ── Step 1: the client ────────────────────────────────────────────────────
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [nc, setNc] = useState({ name: "", email: "", phone: "" });
  const [dupes, setDupes] = useState<CustomerLite[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const { data: customers, isLoading: customersLoading } = useQuery<CustomerLite[]>({
    queryKey: [`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`],
    enabled: step === 1 && !customer,
  });

  const pick = (c: CustomerLite) => { setCustomer(c); setStep(2); };

  /** Raw fetch — a 409 is the dedupe flow offering matches, not an error. */
  const createClient = async () => {
    setCreating(true);
    setDupes([]);
    try {
      const r = await fetch("/api/crm/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: nc.name.trim(),
          email: nc.email.trim() || null,
          phone: nc.phone.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && Array.isArray(j.matches) && j.matches.length) {
        setDupes(j.matches);
        return;
      }
      if (!r.ok) throw new Error(j.message || "Could not create the client");
      queryClient.invalidateQueries({ predicate: (qr) => String(qr.queryKey[0]).startsWith("/api/crm/customers") });
      pick(j);
    } catch (e: any) {
      toast({ title: "Could not create client", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // ── Step 2: price-book items ──────────────────────────────────────────────
  const [itemInput, setItemInput] = useState("");
  const [itemQ, setItemQ] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setItemQ(itemInput.trim()), 250);
    return () => clearTimeout(t);
  }, [itemInput]);

  const { data: pbItems, isLoading: pbLoading } = useQuery<any[]>({
    queryKey: [`/api/crm/pricebook/items${itemQ ? `?q=${encodeURIComponent(itemQ)}` : ""}`],
    enabled: step === 2,
  });

  const subtotal = cartSubtotalCents(lines.map(lineNumbers));

  const addItem = async (item: any) => {
    // One tap = one unit. Already in the cart? The tap bumps its quantity.
    const existing = lines.find((l) => l.key === item.id);
    if (existing) {
      setLines(lines.map((l) => l.key === item.id
        ? { ...l, qtyText: String(qtyToMilli(l.qtyText) / 1000 + 1) }
        : l));
      return;
    }
    setAddingId(item.id);
    try {
      // Flat items carry their price; computed assemblies expand server-side
      // for one unit and the per-unit price is what the contractor edits.
      let priceCents: number | null = item.flatPriceCents ?? null;
      if (priceCents == null) {
        const r = await apiRequest("POST", `/api/crm/pricebook/items/${item.id}/preview`, { quantityMilli: 1000 });
        priceCents = (await r.json()).totalPriceCents ?? 0;
      }
      setLines((ls) => [...ls, {
        key: item.id, name: item.name, unit: item.unit ?? null, taxable: item.taxable ?? true,
        qtyText: "1", priceText: ((priceCents ?? 0) / 100).toString(),
      }]);
    } catch (e: any) {
      toast({ title: "Could not price that item", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setAddingId(null);
    }
  };

  const setLine = (key: string, patch: Partial<CartLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ── Step 3: review + send ─────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (sendEmail: boolean) => {
    if (!customer || !lines.length) return;
    setSending(true);
    try {
      const created = await (await apiRequest("POST", "/api/crm/estimates", {
        customerId: customer.id,
        title: title.trim() || "Estimate",
        // No taxRateBps — the server resolves sales tax from the client's address.
        items: lines.map((l, idx) => ({
          kind: "labor",
          name: l.name,
          description: null,
          unit: l.unit,
          taxable: l.taxable,
          hiddenFromClient: false,
          sortOrder: idx,
          ...lineNumbers(l),
        })),
      })).json();
      queryClient.invalidateQueries({ predicate: (qr) => String(qr.queryKey[0]).startsWith("/api/crm/estimates") });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/customers/${customer.id}`] });

      if (!sendEmail) {
        setDone({ sent: false, emailed: false, number: created.number, totalCents: created.totalCents });
        return;
      }
      try {
        const r = await (await apiRequest("POST", `/api/crm/estimates/${created.id}/send`, {})).json();
        setDone({
          sent: true, emailed: !!r.emailed,
          sentToEmail: r.estimate?.sentToEmail ?? customer.email ?? null,
          number: r.estimate?.number ?? created.number,
          totalCents: r.estimate?.totalCents ?? created.totalCents,
          expiresAt: r.estimate?.expiresAt ?? null,
          link: r.link ?? null,
        });
      } catch (e: any) {
        // Typically "this client has no email" — the draft exists, so hand the
        // contractor the shareable link instead of dead-ending the flow.
        let link: string | null = null;
        try {
          const det = await (await apiRequest("GET", `/api/crm/estimates/${created.id}`)).json();
          if (det.publicPath) link = window.location.origin + det.publicPath;
        } catch { /* link is a nicety, not a blocker */ }
        setDone({
          sent: false, emailed: false, number: created.number, totalCents: created.totalCents,
          link, error: apiErrorMessage(e),
        });
      }
    } catch (e: any) {
      toast({ title: "Could not create the estimate", description: apiErrorMessage(e), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", description: link, variant: "destructive" });
    }
  };

  const reset = () => {
    setDone(null); setStep(1); setCustomer(null); setLines([]);
    setQInput(""); setItemInput(""); setTitle(""); setShowNew(false); setDupes([]);
    setNc({ name: "", email: "", phone: "" });
  };

  // ── Done ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-10 space-y-5" data-testid="step-done">
        <Card className={done.sent && done.emailed ? "border-emerald-500/50" : "shadow-md"}>
          <CardContent className="p-6 text-center space-y-4">
            <CheckCircle2 className={cn("h-12 w-12 mx-auto", done.emailed ? "text-emerald-600" : "text-primary")} />
            <h1 className="text-xl font-semibold" data-testid="text-sent-title">
              {done.sent && done.emailed
                ? "Estimate sent"
                : done.sent
                  ? "Estimate created — email didn't go out"
                  : "Estimate saved as a draft"}
            </h1>
            <div className="text-sm text-muted-foreground space-y-1">
              {done.number && <div>{done.number}</div>}
              {done.sent && done.emailed && done.sentToEmail && <div>Emailed to {done.sentToEmail}</div>}
              {done.totalCents != null && (
                <div className="text-2xl font-bold text-foreground tabular-nums" data-testid="text-final-total">
                  {money(done.totalCents)}
                </div>
              )}
              {done.expiresAt && (
                <div data-testid="text-expiry">
                  Valid until {new Date(done.expiresAt).toLocaleDateString()}
                </div>
              )}
              {done.error && <div className="text-destructive">{done.error}</div>}
            </div>
            {done.link && (
              <Button variant="outline" className="w-full h-12" onClick={() => copyLink(done.link!)}
                data-testid="button-copy-link">
                <ClipboardCopy className="h-4 w-4 mr-2" /> Copy the client link
              </Button>
            )}
            <div className="grid gap-2">
              <Button className="w-full h-12" onClick={reset} data-testid="button-new-another">
                <Plus className="h-4 w-4 mr-2" /> New estimate
              </Button>
              <Link href="/crm/estimates">
                <Button variant="ghost" className="w-full h-11" data-testid="link-view-estimates">
                  All estimates
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-5 sm:py-8 space-y-4">
      {/* Header — back chevron steps out one level, never dead-ends. */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost" size="icon" className="h-11 w-11 -ml-2 shrink-0"
          data-testid="button-back"
          onClick={() => {
            if (step === 3) setStep(2);
            else if (step === 2) setStep(1);
            else if (window.history.length > 1) window.history.back();
          }}
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="text-xl font-semibold tracking-tight leading-tight">New estimate</h1>
            <InfoTip k="estimate-new" />
          </div>
          <div className="text-xs text-muted-foreground" data-testid="text-step">
            Step {step} of 3 — {step === 1 ? "pick the client" : step === 2 ? "add the work" : "review & send"}
          </div>
        </div>
        {/* Progress pips. */}
        <div className="ml-auto flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span key={n} className={cn("h-1.5 w-6 rounded-full", n <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-3" data-testid="step-client">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-client-search"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search clients — name, email, phone…"
              className="h-12 pl-9 text-base"
              autoFocus
            />
          </div>

          {!showNew ? (
            <Button
              variant="outline" className="w-full h-12"
              onClick={() => setShowNew(true)}
              data-testid="button-new-client-toggle"
            >
              <UserPlus className="h-4 w-4 mr-2" /> New client
            </Button>
          ) : (
            <Card data-testid="new-client-form">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm">New client</div>
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setShowNew(false); setDupes([]); }}
                    aria-label="Close new client form">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <Input data-testid="input-new-client-name" placeholder="Full name *" className="h-12 text-base"
                  value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
                <Input data-testid="input-new-client-email" placeholder="Email" type="email" inputMode="email"
                  className="h-12 text-base" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
                <Input data-testid="input-new-client-phone" placeholder="Phone" type="tel" inputMode="tel"
                  className="h-12 text-base" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
                <Button className="w-full h-12" disabled={!nc.name.trim() || creating}
                  onClick={createClient} data-testid="button-create-client">
                  {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
                  Create & use this client
                </Button>
                {dupes.length > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">
                      That email or phone already belongs to someone — tap to use them instead:
                    </div>
                    {dupes.map((d) => (
                      <button key={d.id} type="button" onClick={() => pick(d)}
                        data-testid={`client-dupe-${d.id}`}
                        className="w-full text-left rounded-lg border bg-card px-3 py-2.5 text-sm font-medium hover:bg-accent">
                        {d.displayName}
                        <span className="block text-xs font-normal text-muted-foreground">{d.email ?? d.phone ?? ""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            {customersLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (customers ?? []).slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                data-testid={`client-row-${c.id}`}
                className="w-full flex items-center gap-3 rounded-xl border bg-card px-3.5 min-h-[60px] py-2 text-left transition-colors hover:bg-accent active:bg-accent"
              >
                <InitialAvatar name={c.displayName} className="h-10 w-10 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{c.displayName}</span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {[c.email, c.phone, c.city].filter(Boolean).join(" · ") || "No contact details yet"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {!customersLoading && customers && customers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No clients match — create one above.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 2 && customer && (
        <div className="space-y-3" data-testid="step-items">
          {/* The cart rides on top: the running total and the way forward are
              never a scroll away. */}
          <Card className="shadow-md border-primary/25">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm min-w-0">
                  <span className="text-muted-foreground">For </span>
                  <span className="font-medium" data-testid="text-cart-customer">{customer.displayName}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
                  <div className="text-lg font-bold tabular-nums leading-none" data-testid="text-subtotal">
                    {money(subtotal)}
                  </div>
                </div>
              </div>

              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-cart-empty">
                  Nothing added yet — search the price book below and tap to add.
                </p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => {
                    const nums = lineNumbers(l);
                    return (
                      <div key={l.key} className="rounded-lg border p-2.5 space-y-2" data-testid={`cart-line-${l.key}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-medium leading-snug min-w-0">{l.name}</div>
                          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 -mr-1 -mt-1 text-muted-foreground"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            data-testid={`button-remove-${l.key}`} aria-label={`Remove ${l.name}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex items-end gap-2">
                          <div className="w-20">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Qty{l.unit ? ` (${l.unit})` : ""}
                            </div>
                            <Input
                              value={l.qtyText}
                              inputMode="decimal"
                              onChange={(e) => setLine(l.key, { qtyText: e.target.value })}
                              className="h-11 text-base"
                              data-testid={`input-qty-${l.key}`}
                              aria-label={`Quantity for ${l.name}`}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Price $</div>
                            <Input
                              value={l.priceText}
                              inputMode="decimal"
                              onChange={(e) => setLine(l.key, { priceText: e.target.value })}
                              className="h-11 text-base"
                              data-testid={`input-price-${l.key}`}
                              aria-label={`Unit price for ${l.name}`}
                            />
                          </div>
                          <div className="text-right tabular-nums font-medium text-sm pb-2.5 w-20">
                            {money(lineTotalCents(nums))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                className="w-full h-12 text-base"
                disabled={!lines.length || subtotal <= 0}
                onClick={() => setStep(3)}
                data-testid="button-review"
              >
                Review · {money(subtotal)}
              </Button>
            </CardContent>
          </Card>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-item-search"
              value={itemInput}
              onChange={(e) => setItemInput(e.target.value)}
              onKeyDown={async (e) => {
                // Typing a bare SKU number + Enter adds that scope instantly.
                if (e.key !== "Enter") return;
                const n = itemInput.trim();
                if (!/^\d+$/.test(n)) return;
                e.preventDefault();
                try {
                  const r = await apiRequest("GET", `/api/crm/pricebook/items?q=${encodeURIComponent(n)}`);
                  const hit = ((await r.json()) ?? []).find((x: any) => x.code === n);
                  if (hit) {
                    await addItem(hit);
                    setItemInput("");
                  } else {
                    toast({ title: `No SKU #${n} in the price book` });
                  }
                } catch {
                  /* the visible search list still works as a fallback */
                }
              }}
              placeholder="Search the price book — or type a SKU # and press Enter"
              className="h-12 pl-9 text-base"
            />
          </div>

          <div className="space-y-2">
            {pbLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (pbItems ?? []).slice(0, 12).map((i) => {
              const inCart = lines.some((l) => l.key === i.id);
              return (
                <div key={i.id} className="flex items-center gap-3 rounded-xl border bg-card px-3.5 min-h-[60px] py-2"
                  data-testid={`pb-row-${i.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm leading-snug">{i.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.code ? `${/^\d+$/.test(i.code) ? `SKU #${i.code}` : i.code} · ` : ""}per {i.unit}
                      {i.flatPriceCents != null ? ` · ${money(i.flatPriceCents)}` : ""}
                    </div>
                  </div>
                  {i.code && /^\d+$/.test(i.code) && (
                    <Button
                      variant="outline"
                      className="h-11 px-3 shrink-0 font-mono tabular-nums"
                      disabled={addingId === i.id}
                      onClick={() => addItem(i)}
                      data-testid={`button-sku-${i.id}`}
                      aria-label={`Add SKU number ${i.code}`}
                    >
                      #{i.code}
                    </Button>
                  )}
                  <Button
                    variant={inCart ? "secondary" : "default"}
                    className="h-11 px-4 shrink-0"
                    disabled={addingId === i.id}
                    onClick={() => addItem(i)}
                    data-testid={`button-add-${i.id}`}
                  >
                    {addingId === i.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : inCart
                        ? <><Check className="h-4 w-4 mr-1" /> +1</>
                        : <><Plus className="h-4 w-4 mr-1" /> Add</>}
                  </Button>
                </div>
              );
            })}
            {!pbLoading && pbItems && pbItems.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No price-book items match{itemQ ? ` "${itemQ}"` : ""}.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 3 && customer && (
        <div className="space-y-3" data-testid="step-review">
          <Card className="shadow-md">
            <CardContent className="p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Title</div>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`Estimate for ${customer.displayName}`}
                  className="h-12 text-base mt-1"
                  data-testid="input-title"
                />
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">For </span>
                <span className="font-medium">{customer.displayName}</span>
                {customer.email
                  ? <span className="text-muted-foreground"> · {customer.email}</span>
                  : <span className="block text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      No email on file — sending needs one; you can still save the draft.
                    </span>}
              </div>
              <div className="space-y-1.5 border-t pt-3">
                {lines.map((l) => {
                  const nums = lineNumbers(l);
                  return (
                    <div key={l.key} className="flex justify-between gap-3 text-sm" data-testid={`review-line-${l.key}`}>
                      <span className="min-w-0">
                        {l.name}
                        <span className="text-muted-foreground">
                          {" "}· {milliToQty(nums.quantityMilli)}{l.unit ? ` ${l.unit}` : ""} × {money(nums.unitPriceCents)}
                        </span>
                      </span>
                      <span className="tabular-nums font-medium shrink-0">{money(lineTotalCents(nums))}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums font-medium" data-testid="text-review-subtotal">{money(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales tax</span>
                  <span className="text-muted-foreground text-right text-xs leading-relaxed max-w-[180px]">
                    Added automatically from the client's address
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total</span>
                  <span className="tabular-nums" data-testid="text-review-total">{money(subtotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  The client link is valid for 7 days from the moment it's sent.
                </p>
              </div>
            </CardContent>
          </Card>

          <Button
            className="w-full h-12 text-base"
            disabled={sending || !customer.email}
            onClick={() => submit(true)}
            data-testid="button-send"
            title={!customer.email ? "This client has no email address" : undefined}
          >
            {sending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Send estimate
          </Button>
          <Button
            variant="outline" className="w-full h-12"
            disabled={sending}
            onClick={() => submit(false)}
            data-testid="button-save-draft"
          >
            <FileText className="h-4 w-4 mr-2" /> Save as draft
          </Button>
        </div>
      )}
    </div>
  );
}
