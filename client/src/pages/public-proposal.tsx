/**
 * /proposal/<token> — the recipient's side of a proposal (shared/proposals.ts, server/proposals/routes.ts):
 * read it (the written sections and the attached PDF), choose the services they want with live totals, initial each
 * contract clause in its "Initial here" box and sign (typed name + drawn or typed signature + e-sign consent) — a
 * "Next" guide walks them field to field like DocuSign — then pay the tallied total: bank transfer (ACH) with no
 * fee, or card with the proposal's card fee on top. No sales tax (services). A preview link can be filled in and
 * "signed" end to end: nothing is recorded, and signing opens the agreement PDF it would produce.
 * Opens full-bleed on any host, signed in or not (App.tsx).
 */
import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, Info, Building2, CheckCircle2, Clock, CreditCard, Download, ExternalLink, FileText, Landmark, Loader2, Lock, PenLine, ShieldCheck, XCircle } from "lucide-react";
import {
  ESIGN_CONSENT, TAX_NOTE, allowedPlans, bodyBlocks, cardFeeCents, ALL_TERMS_ID, initialTargets, defaultSelection, formatBps, formatMoney, initialsOf, priceSelection, selectionProblems,
  type PaymentPlan, type ProposalContent, type ProposalGroup, type PublicProposal,
} from "@shared/proposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePad } from "@/components/signature-pad";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const money = (c: number) => formatMoney(c, { cents: true });

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || "Something went wrong — please try again.");
  return data as T;
}

function Body({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-600">
      {bodyBlocks(text).map((b, i) => b.kind === "p"
        ? <p key={i}>{b.text}</p>
        : <ul key={i} className="space-y-1.5">{b.items.map((it, j) => <li key={j} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />{it}</li>)}</ul>)}
    </div>
  );
}

function priceLabel(i: { priceCents: number; billing: string; termMonths: number }) {
  if (i.billing === "monthly") return <><span className="text-xl font-bold text-slate-900">{formatMoney(i.priceCents)}</span><span className="text-sm text-slate-500"> / month</span>
    {i.termMonths > 1 && <div className="text-xs text-slate-500">{i.termMonths}-month minimum · {formatMoney(i.priceCents * i.termMonths)} total</div>}</>;
  return <><span className="text-xl font-bold text-slate-900">{formatMoney(i.priceCents)}</span><span className="text-sm text-slate-500"> one-time</span></>;
}

/** The little "i": tap to read why an option (or a choice) is worth it. A span, so it can sit inside the option's button. */
function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  const toggle = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); };
  return (
    <>
      <span role="button" tabIndex={0} aria-label={`Why ${label}?`} aria-expanded={open} onClick={toggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle(e)}
        className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border text-slate-500 hover:text-slate-900" style={open ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        data-testid={`info-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}><Info className="h-3.5 w-3.5" /></span>
      {open && <span className="mt-2 block basis-full rounded-lg border-l-4 bg-slate-50 p-3 text-sm font-normal leading-relaxed text-slate-700" style={{ borderColor: "var(--accent)" }} onClick={toggle}>{text}</span>}
    </>
  );
}

function GroupPicker({ group, selected, locked, onToggle }: { group: ProposalGroup; selected: Set<string>; locked: boolean; onToggle: (g: ProposalGroup, id: string) => void }) {
  return (
    <section className="space-y-3" data-testid={`group-${group.id}`}>
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold text-slate-900">{group.name}
          {group.required && <span className="align-middle text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>Required</span>}
          <InfoTip text={group.info} label={group.name} />
        </h3>
        <p className="text-sm text-slate-500">{group.description || (group.select === "one" ? "Choose one option." : "Choose any that you want.")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {group.items.map((item) => {
          const on = selected.has(item.id);
          const disabled = locked || item.included;
          return (
            <button key={item.id} type="button" disabled={disabled} onClick={() => onToggle(group, item.id)} aria-pressed={on}
              className={cn("relative flex h-full flex-col rounded-xl border-2 bg-white p-4 text-left transition", on ? "shadow-md" : "border-slate-200 hover:border-slate-300", disabled && !on && "opacity-60", disabled && "cursor-default")}
              style={on ? { borderColor: "var(--accent)" } : undefined} data-testid={`item-${item.id}`}>
              <div className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2", group.select === "one" ? "rounded-full" : "rounded")}
                  style={{ borderColor: on ? "var(--accent)" : "#cbd5e1", background: on ? "var(--accent)" : "transparent" }}>
                  {on && <CheckCircle2 className="h-4 w-4 text-white" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{item.name}</span>
                    {item.badge && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: "var(--accent)" }}>{item.badge}</span>}
                    {item.included && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Included</span>}
                    <InfoTip text={item.info} label={item.name} />
                  </div>
                  <div className="mt-1">{priceLabel(item)}</div>
                  {item.description && <p className="mt-2 text-sm text-slate-600">{item.description}</p>}
                  {item.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {item.bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />{b}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Summary({ content, itemIds, plan, setPlan, locked }: { content: ProposalContent; itemIds: string[]; plan: PaymentPlan; setPlan: (p: PaymentPlan) => void; locked: boolean }) {
  const t = priceSelection(content, itemIds, plan);
  const plans = allowedPlans(content, t.monthlyCents);
  const bps = content.payment.cardEnabled ? content.payment.cardFeeBps : 0;
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm" data-testid="card-summary">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Your selection</h3>
      {t.lines.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nothing selected yet.</p> : (
        <ul className="mt-3 divide-y text-sm">
          {t.lines.map((l) => (
            <li key={l.itemId} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 text-slate-700">{l.name}</span>
              <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-slate-900">{formatMoney(l.priceCents)}{l.billing === "monthly" ? "/mo" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 space-y-1.5 border-t pt-3 text-sm">
        {t.oneTimeCents > 0 && <Row label="One-time" value={money(t.oneTimeCents)} />}
        {t.monthlyCents > 0 && <Row label="Monthly" value={`${money(t.monthlyCents)}/mo`} />}
        <Row label="Sales tax" value="$0.00" />
        <Row label="Contract total" value={money(t.contractTotalCents)} strong />
        <p className="text-[11px] text-slate-500">{TAX_NOTE}</p>
      </div>
      {plans.length > 1 && !locked && (
        <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment plan">
          {plans.map((p) => (
            <button key={p} type="button" onClick={() => setPlan(p)} aria-checked={t.plan === p} role="radio"
              className={cn("rounded-lg border-2 px-3 py-2 text-left text-xs", t.plan === p ? "font-semibold" : "border-slate-200 text-slate-600")}
              style={t.plan === p ? { borderColor: "var(--accent)" } : undefined} data-testid={`plan-${p}`}>
              {p === "monthly" ? "Pay monthly" : "Pay in full"}
            </button>
          ))}
        </div>
      )}
      {t.lines.length > 0 && (
        <div className="mt-4 rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--accent) 8%, white)" }}>
          <Row label="Due today (bank / ACH)" value={money(t.dueTodayCents)} strong />
          {bps > 0 && <Row label={`By card (+${formatBps(bps)})`} value={money(t.dueTodayCents + cardFeeCents(t.dueTodayCents, bps))} />}
          {t.recurringCents > 0 && <Row label="Then each month" value={money(t.recurringCents)} />}
        </div>
      )}
    </div>
  );
}
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><span className={strong ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</span><span className={cn("tabular-nums", strong ? "font-bold text-slate-900" : "text-slate-700")}>{value}</span></div>;
}

function PayPanel({ token, data }: { token: string; data: PublicProposal }) {
  const { toast } = useToast();
  const t = data.totals!;
  const pay = data.content.payment;
  const fee = pay.cardEnabled ? cardFeeCents(t.dueTodayCents, pay.cardFeeBps) : 0;
  const [method, setMethod] = useState<"ach" | "card">(pay.achEnabled ? "ach" : "card");
  const go = useMutation({
    mutationFn: () => call<{ url: string }>("POST", `/api/public/proposals/${token}/checkout`, { method }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e: Error) => toast({ title: "Couldn't start payment", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4" data-testid="panel-pay">
      <div className="grid gap-3 sm:grid-cols-2">
        {pay.achEnabled && (
          <button type="button" onClick={() => setMethod("ach")} className={cn("rounded-xl border-2 bg-white p-4 text-left", method === "ach" ? "shadow-md" : "border-slate-200")}
            style={method === "ach" ? { borderColor: "var(--accent)" } : undefined} data-testid="method-ach">
            <div className="flex items-center gap-2 font-semibold text-slate-900"><Landmark className="h-5 w-5" style={{ color: "var(--accent)" }} /> Bank transfer (ACH)
              <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">No fee</span></div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{money(t.dueTodayCents)}</div>
            <p className="mt-1 text-xs text-slate-500">Connect your bank securely through Stripe. Clears in about 3–5 business days.</p>
          </button>
        )}
        {pay.cardEnabled && (
          <button type="button" onClick={() => setMethod("card")} className={cn("rounded-xl border-2 bg-white p-4 text-left", method === "card" ? "shadow-md" : "border-slate-200")}
            style={method === "card" ? { borderColor: "var(--accent)" } : undefined} data-testid="method-card">
            <div className="flex items-center gap-2 font-semibold text-slate-900"><CreditCard className="h-5 w-5" style={{ color: "var(--accent)" }} /> Credit or debit card
              {fee > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">+{formatBps(pay.cardFeeBps)} fee</span>}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{money(t.dueTodayCents + fee)}</div>
            <p className="mt-1 text-xs text-slate-500">{fee > 0 ? `Includes a ${money(fee)} card processing fee. Pay by bank transfer to avoid it.` : "Paid instantly."}</p>
          </button>
        )}
      </div>
      {t.recurringCents > 0 && (
        <p className="text-sm text-slate-600">
          After today, {money(t.recurringCents + (method === "card" ? cardFeeCents(t.recurringCents, pay.cardFeeBps) : 0))} is charged automatically each month
          {pay.endAfterMonths ? ` until the ${pay.endAfterMonths}-month term ends` : ""}{method === "card" && fee > 0 ? " (including the card fee)" : ""}.
        </p>
      )}
      <Button size="lg" className="w-full text-base text-white sm:w-auto" style={{ background: "var(--accent)" }} disabled={go.isPending || !data.stripeReady || data.preview} onClick={() => go.mutate()} data-testid="button-pay">
        {go.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
        Pay {money(method === "card" ? t.dueTodayCents + fee : t.dueTodayCents)} securely
      </Button>
      {!data.stripeReady && <p className="text-sm text-red-600">Online payment isn't available right now — contact us to arrange payment.</p>}
      <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> Payments are processed by Stripe. We never see your bank login or card number.</p>
    </div>
  );
}

export default function PublicProposalPage() {
  const [, params] = useRoute("/proposal/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const search = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  // "1" with an admin session (the editor's Preview), or the signed key in a "Send me a proof" email.
  const preview = search.get("preview");
  const returnedPaid = search.get("paid") === "1";
  const url = `/api/public/proposals/${token}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`;
  const [pollUntil] = useState(() => (returnedPaid ? Date.now() + 90_000 : 0));
  const { data, error, isLoading, refetch } = useQuery<PublicProposal>({
    queryKey: [url], queryFn: () => call("GET", url), enabled: !!token, retry: false,
    refetchInterval: (q) => (q.state.data?.status === "signed" && Date.now() < pollUntil ? 4000 : false),
  });

  const [itemIds, setItemIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<PaymentPlan>("monthly");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [initials, setInitials] = useState("");
  const [initialsEdited, setInitialsEdited] = useState(false);
  const [initialed, setInitialed] = useState<Record<string, string>>({});
  const [previewSigned, setPreviewSigned] = useState(false);
  useEffect(() => { if (!initialsEdited) setInitials(initialsOf(name)); }, [name, initialsEdited]);

  useEffect(() => {
    if (!data) return;
    setItemIds(data.selection?.itemIds ?? defaultSelection(data.content));
    const p = data.selection?.plan ?? (data.content.payment.plan === "full" ? "full" : "monthly");
    setPlan(p);
    if (!name && data.recipientName) setName(data.recipientName);
    document.title = `${data.content.title || "Proposal"} · ${data.content.brand.name}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status, data?.selection]);

  const content = data?.content;
  const signed = !!data?.signature;
  const closed = !!data && (["void", "declined"].includes(data.status) || data.expired);
  const locked = signed || closed;
  const selected = useMemo(() => new Set(itemIds), [itemIds]);
  const problems = content ? selectionProblems(content, itemIds) : [];

  const signBody = () => ({
    itemIds, plan, name, title: title || undefined, signatureDataUrl: sig ?? undefined, consent: true,
    initials: initials || undefined, initialed: Object.entries(initialed).map(([id, at]) => ({ id, at })),
  });
  const sign = useMutation({
    mutationFn: async () => {
      if (!data?.preview) return call("POST", `/api/public/proposals/${token}/sign`, signBody());
      // Preview: the same checks on the server, and the agreement PDF it would produce — nothing is stored.
      const res = await fetch(`/api/public/proposals/${token}/preview-sign?preview=${encodeURIComponent(preview ?? "")}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signBody()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Couldn't sign");
      window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
      setPreviewSigned(true);
    },
    onSuccess: () => { void refetch(); setTimeout(() => document.getElementById("pay")?.scrollIntoView({ behavior: "smooth" }), 300); },
    onError: (e: Error) => toast({ title: "Couldn't sign", description: e.message, variant: "destructive" }),
  });
  const decline = useMutation({
    mutationFn: () => call("POST", `/api/public/proposals/${token}/decline`, { reason: reason || undefined }),
    onSuccess: () => { setDeclining(false); void refetch(); },
    onError: (e: Error) => toast({ title: "Couldn't decline", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (error || !data || !content) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md text-center"><FileText className="mx-auto h-8 w-8 text-slate-400" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">This proposal isn't available</h1>
          <p className="mt-1 text-sm text-slate-500">{(error as Error)?.message || "The link may be wrong or the proposal was withdrawn."}</p></div>
      </div>
    );
  }

  const b = content.brand;
  const toggle = (g: ProposalGroup, id: string) => {
    setItemIds((cur) => {
      const has = cur.includes(id);
      if (g.select === "one") {
        const others = cur.filter((x) => !g.items.some((i) => i.id === x));
        return has && !g.required ? others : [...others, id];
      }
      return has ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };
  const toInitial = initialTargets(content);
  const once = content.clauseInitials !== "each";
  // Every field the client must complete, in page order: the "Next" guide jumps to the first one left (DocuSign style).
  const fields = [
    { id: "choose", label: "Choose your services", done: problems.length === 0 },
    ...toInitial.map((c, i) => ({ id: `clause-${c.id}`, label: once ? "Initial the program terms" : `Initial term ${i + 1}`, done: !!initialed[c.id] })),
    { id: "sig-name", label: "Type your full name", done: name.trim().length >= 2 },
    { id: "signature", label: "Sign", done: !!sig },
    { id: "consent", label: "Agree to sign electronically", done: consent },
  ];
  const nextField = fields.find((f) => !f.done);
  const goNext = () => nextField && document.getElementById(nextField.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const canSign = !locked && !previewSigned && !nextField && !!initials.trim();
  const toggleInitial = (id: string) => {
    if (!initials.trim()) { toast({ title: "Add your initials first", description: "Type your name or initials above the terms.", variant: "destructive" }); return; }
    setInitialed((cur) => { const n = { ...cur }; if (n[id]) delete n[id]; else n[id] = new Date().toISOString(); return n; });
  };
  const previewTotals = previewSigned ? priceSelection(content, itemIds, plan) : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" style={{ ["--accent" as any]: b.accent }} data-testid="page-public-proposal">
      <div className="h-1.5" style={{ background: b.accent }} />
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {b.logoUrl ? <img src={b.logoUrl} alt={b.name} className="max-h-10 max-w-[180px] object-contain" /> : <span className="text-sm font-bold tracking-wide">{b.name.toUpperCase()}</span>}
          <span className="text-right text-xs uppercase tracking-wide text-slate-500">Confidential{data.recipientName ? ` · ${data.recipientName}` : ""}</span>
        </div>
      </header>

      {data.preview && <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">Preview — exactly what your client sees. Try it like they would: pick services, initial the terms and sign. Nothing is recorded or sent; signing opens the agreement PDF it would produce.</div>}

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-12">
        {/* Hero */}
        <section className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>Private client proposal</p>
          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">{content.title || "Proposal"}</h1>
          {content.subtitle && <p className="max-w-3xl text-lg text-slate-600">{content.subtitle}</p>}
          <div className="grid overflow-hidden rounded-xl border bg-white text-sm sm:grid-cols-2">
            <div className="border-b p-4 sm:border-b-0 sm:border-r"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared by</div>
              <div className="mt-1 font-medium">{[b.contactName, b.name].filter(Boolean).join(" | ")}</div></div>
            <div className="p-4"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared for</div>
              <div className="mt-1 font-medium">{data.recipientName || "—"}</div>{data.recipientCompany && <div className="text-slate-500">{data.recipientCompany}</div>}</div>
          </div>
        </section>

        <StatusBanner data={data} returnedPaid={returnedPaid} token={token} />

        {content.intro && <section className="max-w-3xl"><Body text={content.intro} /></section>}

        {content.sections.map((s) => (
          <section key={s.id} className="max-w-3xl space-y-3">
            {s.eyebrow && <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>{s.eyebrow}</p>}
            {s.heading && <h2 className="text-2xl font-extrabold sm:text-3xl">{s.heading}</h2>}
            <Body text={s.body} />
          </section>
        ))}

        {data.hasFile && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xl font-extrabold">The full proposal</h2>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm"><a href={`/api/public/proposals/${token}/document`} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open</a></Button>
                <Button asChild variant="outline" size="sm"><a href={`/api/public/proposals/${token}/document?download=1`}><Download className="mr-1.5 h-3.5 w-3.5" /> Download PDF</a></Button>
              </div>
            </div>
            <iframe title={data.fileName ?? "Proposal document"} src={`/api/public/proposals/${token}/document#view=FitH`} className="hidden h-[80vh] w-full rounded-xl border bg-white md:block" data-testid="frame-proposal-pdf" />
            <p className="text-sm text-slate-500 md:hidden">Tap “Open” to read the full proposal.</p>
          </section>
        )}

        {/* Choose */}
        <section id="choose" className="grid gap-8 lg:grid-cols-[1fr_340px]">
          <div className="space-y-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>{locked ? "Your selection" : "Build your plan"}</p>
              <h2 className="text-2xl font-extrabold sm:text-3xl">{locked ? "What you chose" : "Choose the services you want"}</h2>
              {!locked && <p className="mt-1 text-slate-600">Your totals update as you choose. Nothing is charged until you sign and pay.</p>}
            </div>
            {content.groups.map((g) => <GroupPicker key={g.id} group={g} selected={selected} locked={locked} onToggle={toggle} />)}
          </div>
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <Summary content={content} itemIds={itemIds} plan={plan} setPlan={setPlan} locked={locked} />
          </aside>
        </section>

        {content.terms.trim() && (
          <section className="max-w-3xl">
            <details className="rounded-xl border bg-white p-4" open={!signed}>
              <summary className="cursor-pointer font-semibold">Terms &amp; conditions</summary>
              <div className="mt-3 max-h-80 overflow-auto"><Body text={content.terms} /></div>
            </details>
          </section>
        )}

        {/* Sign */}
        {!signed && !closed && (
          <section id="sign" className="max-w-3xl space-y-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-8" data-testid="section-sign">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>Step 2</p>
              <h2 className="text-2xl font-extrabold">Review &amp; sign</h2>
              <p className="mt-1 text-sm text-slate-500">{fields.filter((f) => f.done).length} of {fields.length} completed{nextField ? ` · next: ${nextField.label.toLowerCase()}` : " · ready to sign"}</p>
            </div>
            {problems.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {problems.map((p) => <div key={p} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{p}</div>)}
              </div>
            )}
            {content.clauses.length > 0 && (() => {
              const initialBox = (id: string) => {
                  const at = initialed[id];
                  return (
                    <button type="button" onClick={() => toggleInitial(id)} disabled={locked} aria-pressed={!!at}
                      className={cn("flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed text-xs transition", at ? "bg-white" : "animate-pulse bg-amber-50 text-amber-800")}
                      style={{ borderColor: at ? "var(--accent)" : "#f59e0b" }} data-testid={`initial-${id}`}>
                      {at ? <><span className="font-serif text-2xl italic text-slate-900">{initials}</span><span className="text-[10px] text-slate-500">{new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></>
                        : <><PenLine className="mb-0.5 h-4 w-4" />Initial here</>}
                    </button>
                  );
                };
              const initialsField = (
                <div className="space-y-1"><Label htmlFor="sig-initials" className="text-xs">Your initials</Label>
                  <Input id="sig-initials" value={initials} maxLength={6} className="h-9 w-24 text-center font-semibold uppercase" onChange={(e) => { setInitialsEdited(true); setInitials(e.target.value.toUpperCase()); }} data-testid="input-initials" /></div>
              );
              if (once) {
                // One initial accepts every term; the terms stay folded away until the client opens them.
                return (
                  <div id={`clause-${ALL_TERMS_ID}`} className="flex flex-wrap items-center gap-4 rounded-xl border bg-slate-50/60 p-4" data-testid="section-clauses">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">Program terms</div>
                      <p className="text-sm text-slate-500">By initialing, you accept the program terms.</p>
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-slate-500 underline-offset-2 hover:underline" data-testid="toggle-terms">View the terms</summary>
                        <div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-lg border bg-white p-3 text-xs leading-relaxed text-slate-600">
                          {content.clauses.map((c) => <p key={c.id}><b className="text-slate-800">{c.heading}</b>{c.body ? ` ${c.body}` : ""}</p>)}
                        </div>
                      </details>
                    </div>
                    {initialsField}
                    {toInitial.length > 0 && initialBox(ALL_TERMS_ID)}
                  </div>
                );
              }
              return (
                <div className="space-y-3" data-testid="section-clauses">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div><h3 className="text-lg font-bold">Program terms</h3><p className="text-sm text-slate-500">Read each term and initial it in the box.</p></div>
                    {initialsField}
                  </div>
                  {content.clauses.map((c, i) => (
                    <div key={c.id} id={`clause-${c.id}`} className="flex gap-4 rounded-xl border bg-slate-50/60 p-4" data-testid={`clause-${c.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900">{c.heading || `Term ${i + 1}`}</div>
                        {c.body && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{c.body}</p>}
                      </div>
                      {c.initials && initialBox(c.id)}
                    </div>
                  ))}
                </div>
              );
            })()}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="sig-name">Full legal name</Label>
                <Input id="sig-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="input-sign-name" /></div>
              <div className="space-y-1.5"><Label htmlFor="sig-title">Title (optional)</Label>
                <Input id="sig-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Owner, Director…" data-testid="input-sign-title" /></div>
            </div>
            <div id="signature" className="space-y-1.5"><Label>Signature</Label><SignaturePad name={name} onChange={setSig} /></div>
            <label id="consent" className="flex items-start gap-3 text-sm text-slate-700">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" data-testid="checkbox-consent" />
              <span>{ESIGN_CONSENT}</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" className="text-base text-white" style={{ background: b.accent }} disabled={!canSign || sign.isPending} onClick={() => sign.mutate()} data-testid="button-sign">
                {sign.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} {data.preview ? "Sign (preview — not recorded)" : "Sign & continue to payment"}
              </Button>
              <button type="button" className="text-sm text-slate-500 underline-offset-2 hover:underline" disabled={data.preview} onClick={() => setDeclining((v) => !v)} data-testid="button-decline-toggle">Decline this proposal</button>
            </div>
            {declining && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label htmlFor="decline-reason">Anything you'd like us to know? (optional)</Label>
                <Textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
                <Button variant="outline" size="sm" disabled={decline.isPending} onClick={() => decline.mutate()} data-testid="button-decline">Decline</Button>
              </div>
            )}
          </section>
        )}

        {/* Pay */}
        {signed && data.totals && !["paid", "processing", "void"].includes(data.status) && (
          <section id="pay" className="max-w-3xl space-y-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-8" data-testid="section-pay">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>Step 3</p>
              <h2 className="text-2xl font-extrabold">Choose how to pay</h2>
            </div>
            <PayPanel token={token} data={data} />
          </section>
        )}

        {previewTotals && (
          <section id="pay" className="max-w-3xl space-y-3 rounded-2xl border border-dashed bg-white p-5 sm:p-8" data-testid="section-preview-pay">
            <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: b.accent }}>Step 3 · preview</p>
            <h2 className="text-2xl font-extrabold">Payment</h2>
            <p className="text-sm text-slate-600">On the real link the client goes straight to payment now. The signed agreement PDF opened in a new tab.</p>
            <Row label="Due today (bank / ACH)" value={money(previewTotals.dueTodayCents)} strong />
            {content.payment.cardEnabled && content.payment.cardFeeBps > 0 && <Row label={`By card (+${formatBps(content.payment.cardFeeBps)})`} value={money(previewTotals.dueTodayCents + cardFeeCents(previewTotals.dueTodayCents, content.payment.cardFeeBps))} />}
            {previewTotals.recurringCents > 0 && <Row label="Then each month" value={money(previewTotals.recurringCents)} />}
            <Row label="Sales tax" value="$0.00" />
            <Button variant="outline" size="sm" onClick={() => { setPreviewSigned(false); setInitialed({}); }}>Start the preview again</Button>
          </section>
        )}

        {!signed && !closed && !previewSigned && nextField && (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
            <Button size="lg" className="pointer-events-auto text-white shadow-lg" style={{ background: b.accent }} onClick={goNext} data-testid="button-next-field">
              <ArrowDown className="mr-2 h-4 w-4" /> Next: {nextField.label}
            </Button>
          </div>
        )}

        <footer className="border-t pt-6 text-sm text-slate-500">
          <div className="font-semibold text-slate-700">{[b.contactName, b.name].filter(Boolean).join(" | ")}</div>
          <div>{[b.contactEmail, b.phone, b.website].filter(Boolean).join("  ·  ")}</div>
        </footer>
      </main>
    </div>
  );
}

function StatusBanner({ data, returnedPaid, token }: { data: PublicProposal; returnedPaid: boolean; token: string }) {
  const signedCopy = data.signature && (
    <Button asChild variant="outline" size="sm" className="mt-2"><a href={`/api/public/proposals/${token}/signed.pdf`} target="_blank" rel="noreferrer"><Download className="mr-1.5 h-3.5 w-3.5" /> Signed copy (PDF)</a></Button>
  );
  const box = (tone: string, Icon: any, title: string, text: string, extra?: React.ReactNode) => (
    <div className={cn("flex gap-3 rounded-xl border p-4", tone)} data-testid="banner-status">
      <Icon className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">{title}</div><div className="text-sm opacity-90">{text}</div>{extra}</div>
    </div>
  );
  if (data.status === "paid") return box("border-emerald-300 bg-emerald-50 text-emerald-900", CheckCircle2, "Signed and paid — thank you", "We'll be in touch to schedule kickoff.", signedCopy);
  if (data.status === "processing") return box("border-sky-300 bg-sky-50 text-sky-900", Clock, "Payment received — bank transfer clearing", "ACH payments take a few business days to settle. You don't need to do anything else.", signedCopy);
  if (data.status === "void") return box("border-slate-300 bg-slate-100 text-slate-700", XCircle, "This proposal was withdrawn", "Contact us for an updated proposal.");
  if (data.status === "declined") return box("border-slate-300 bg-slate-100 text-slate-700", XCircle, "You declined this proposal", "Changed your mind? Contact us and we'll send a new one.");
  if (data.expired) return box("border-amber-300 bg-amber-50 text-amber-900", Clock, "This proposal has expired", "Contact us for an updated proposal.");
  if (data.status === "payment_failed") return box("border-red-300 bg-red-50 text-red-900", AlertTriangle, "The last payment didn't go through", "Please try again below, or choose another payment method.", signedCopy);
  if (data.signature) return box("border-sky-300 bg-sky-50 text-sky-900", returnedPaid ? Loader2 : Building2,
    returnedPaid ? "Confirming your payment…" : `Signed by ${data.signature.name}`,
    returnedPaid ? "This takes a few seconds." : "One step left: choose how to pay below.", signedCopy);
  if (data.expiresAt) return box("border-slate-200 bg-white text-slate-700", Clock, "Valid until " + new Date(data.expiresAt).toLocaleDateString(), "Review, choose your services, sign and pay online.");
  return null;
}
