/**
 * "Curious what a roof replacement would cost?" — the client self-estimate.
 *
 * Rendered on the public estimate page and in the client portal for every
 * trade the contractor's division offers that is NOT on the client's bid.
 * The live number previews with the SAME function the server prices with
 * (shared/self-estimate.ts computeBallpark); the ballpark the client is shown
 * on the last step is the server's own (POST …/quote), and "Send this to my
 * contractor" only creates a draft + a task on the contractor's side —
 * nothing is bought, nothing is sent automatically.
 *
 * Every meaningful step is reported as interest (POST …/event); the server
 * dedupes per visit. A contractor preview renders read-only: no events, no
 * request.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Home, Calculator, CheckCircle2, ArrowLeft, ArrowRight, Info } from "lucide-react";
import {
  computeBallpark, SIDING_PORTIONS, SELF_ESTIMATE_UNIT_LABEL,
  type PricedSelfEstimate, type PricedTrade, type MeasuredQuantities, type SelfEstimateTrade,
  type SelfEstimateTradeSelection, type Ballpark, type SidingPortion,
} from "@shared/self-estimate";

export type SelfEstimateOffer = {
  enabled: true;
  companyName: string;
  repName: string | null;
  onBid: SelfEstimateTrade[];
  config: PricedSelfEstimate;
  measured: MeasuredQuantities;
  hasMeasurements: boolean;
};

/** How the component talks to its surface (estimate token routes or portal session routes). */
export type SelfEstimateTransport = (path: "event" | "quote" | "request", body: Record<string, unknown>) => Promise<any>;

export function estimateTransport(token: string): SelfEstimateTransport {
  return async (path, body) => {
    const r = await fetch(`/api/public/estimates/${token}/self-estimate/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`);
    return j;
  };
}

export function portalTransport(customerId: string): SelfEstimateTransport {
  return async (path, body) => {
    const r = await fetch(`/api/client/self-estimate/${path}`, {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ ...body, customerId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`);
    return j;
  };
}

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** One random key per page visit — the server dedupes interest per visit with it. */
function visitKey(scope: string): string {
  const k = `se-visit:${scope}`;
  try {
    const have = sessionStorage.getItem(k);
    if (have) return have;
  } catch { /* storage blocked */ }
  const fresh = `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.slice(0, 40);
  try { sessionStorage.setItem(k, fresh); } catch { /* storage blocked */ }
  return fresh;
}

type Answers = Record<SelfEstimateTrade, SelfEstimateTradeSelection>;
type Step = "trades" | "details" | "discounts" | "result";

function defaultAnswer(t: PricedTrade, m: MeasuredQuantities): SelfEstimateTradeSelection {
  const firstPriced = t.products.find((p) => p.unitPriceCents) ?? t.products[0];
  const measuredCount = t.trade === "windows" ? m.windowsCount : t.trade === "doors" ? m.doorsCount : null;
  return {
    trade: t.trade, productId: firstPriced?.id ?? "",
    ...(t.trade === "siding" ? { portion: "whole" as const } : {}),
    ...(t.trade === "roofing" ? { layers: 1 as const, gutters: false } : {}),
    ...(measuredCount ? { count: measuredCount } : {}),
  };
}

export function SelfEstimatePrompts({ offer, transport, scope, preview = false }: {
  offer: SelfEstimateOffer;
  transport: SelfEstimateTransport;
  /** Visit-key scope (estimate token or portal customer id). */
  scope: string;
  preview?: boolean;
}) {
  const sessionKey = useMemo(() => visitKey(scope), [scope]);
  const trades = offer.config.trades;
  const [open, setOpen] = useState<SelfEstimateTrade | null>(null);
  const sent = useRef(false);

  const track = (type: string, extra: Record<string, unknown>) => {
    if (preview) return;
    transport("event", { type, sessionKey, ...extra }).catch(() => { /* tracking never breaks the page */ });
  };

  // "Prompt viewed" — once per visit (the server dedupes too).
  useEffect(() => {
    if (sent.current || !trades.length) return;
    sent.current = true;
    track("prompt_viewed", { trades: trades.map((t) => t.trade) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades.length]);

  if (!trades.length) return null;
  return (
    <section className="space-y-3" data-testid="self-estimate-prompts">
      {trades.map((t) => (
        <Card key={t.trade} className="shadow-sm border-primary/20 overflow-hidden" data-testid={`self-estimate-prompt-${t.trade}`}>
          <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Home className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold">{t.prompt}</div>
                <p className="text-sm text-muted-foreground">
                  {t.quotable ? t.blurb : `Tell ${offer.companyName} what you have in mind and they'll price it for you.`}
                </p>
              </div>
            </div>
            <Button className="w-full sm:w-auto h-11 sm:h-10 rounded-full" onClick={() => setOpen(t.trade)}
              data-testid={`button-self-estimate-${t.trade}`}>
              <Calculator className="h-4 w-4 mr-1.5" />
              {t.quotable ? "Make your own estimate" : "Request a price"}
            </Button>
          </CardContent>
        </Card>
      ))}
      {open && (
        <SelfEstimateDialog offer={offer} transport={transport} sessionKey={sessionKey} preview={preview}
          initialTrade={open} onClose={() => setOpen(null)} track={track} />
      )}
    </section>
  );
}

function SelfEstimateDialog({ offer, transport, sessionKey, preview, initialTrade, onClose, track }: {
  offer: SelfEstimateOffer;
  transport: SelfEstimateTransport;
  sessionKey: string;
  preview: boolean;
  initialTrade: SelfEstimateTrade;
  onClose: () => void;
  track: (type: string, extra: Record<string, unknown>) => void;
}) {
  const { config, measured } = offer;
  const [step, setStep] = useState<Step>("details");
  const [chosen, setChosen] = useState<SelfEstimateTrade[]>([initialTrade]);
  const [answers, setAnswers] = useState<Answers>(() => {
    const a = {} as Answers;
    for (const t of config.trades) a[t.trade] = defaultAnswer(t, measured);
    return a;
  });
  const [codes, setCodes] = useState<string[]>([]);
  const [server, setServer] = useState<Ballpark | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"sent" | "looking" | null>(null);

  useEffect(() => { track("trade_opened", { trades: [initialTrade] }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const selection = { trades: chosen.map((t) => answers[t]), discountCodes: codes };
  const live = computeBallpark(config, measured, selection);
  const setAnswer = (t: SelfEstimateTrade, patch: Partial<SelfEstimateTradeSelection>) =>
    setAnswers((a) => ({ ...a, [t]: { ...a[t], ...patch } }));
  const toggleTrade = (t: SelfEstimateTrade, on: boolean) => {
    setChosen((c) => (on ? [...new Set([...c, t])] : c.filter((x) => x !== t)));
    if (on) track("trade_opened", { trades: [t] });
  };

  const showResult = async () => {
    if (codes.length) track("discounts_claimed", { trades: chosen, discountCodes: codes });
    setStep("result");
    setError(null);
    if (preview) { setServer(live); return; }
    setBusy(true);
    try {
      const r = await transport("quote", { selection, sessionKey });
      setServer(r.ballpark);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      await transport("request", { selection, sessionKey, note: note.trim() || undefined });
      setDone("sent");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally { setBusy(false); }
  };
  const justLooking = () => {
    track("just_looking", { trades: chosen });
    setDone("looking");
  };

  const steps: Step[] = config.discounts.length ? ["trades", "details", "discounts", "result"] : ["trades", "details", "result"];
  const idx = steps.indexOf(step);
  const next = () => {
    const n = steps[idx + 1];
    if (step === "details") track("questionnaire_completed", { trades: chosen });
    if (n === "result") void showResult(); else setStep(n);
  };
  const back = () => setStep(steps[Math.max(0, idx - 1)]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-y-auto p-4 sm:p-6" data-testid="self-estimate-dialog">
        <DialogHeader>
          <DialogTitle>Make your own estimate</DialogTitle>
          <DialogDescription>
            A quick ballpark from {offer.companyName}'s prices. {config.disclaimer}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-6 text-center space-y-3" data-testid={`self-estimate-done-${done}`}>
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <div className="font-semibold text-lg">{done === "sent" ? "Sent to your contractor" : "No problem — thanks for looking"}</div>
            <p className="text-sm text-muted-foreground">
              {done === "sent"
                ? `${offer.repName ?? offer.companyName} will reach out to confirm measurements and a real price. Nothing is booked or charged.`
                : "You can come back to this any time from your estimate."}
            </p>
            <Button className="rounded-full" onClick={onClose} data-testid="button-self-estimate-close">Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-1" aria-hidden>
              {steps.map((s, i) => (
                <div key={s} className={`h-1 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-muted"}`} />
              ))}
            </div>

            {step === "trades" && (
              <div className="space-y-2" data-testid="self-estimate-step-trades">
                <div className="text-sm font-medium">What would you like to price?</div>
                {config.trades.map((t) => (
                  <label key={t.trade} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary">
                    <Checkbox checked={chosen.includes(t.trade)} onCheckedChange={(v) => toggleTrade(t.trade, v === true)}
                      data-testid={`checkbox-se-trade-${t.trade}`} />
                    <span className="flex-1 text-sm font-medium">{t.label}</span>
                    {!t.quotable && <span className="text-xs text-muted-foreground">Request a price</span>}
                  </label>
                ))}
              </div>
            )}

            {step === "details" && (
              <div className="space-y-5" data-testid="self-estimate-step-details">
                {chosen.map((tr) => {
                  const t = config.trades.find((x) => x.trade === tr);
                  return t ? <TradeQuestions key={tr} t={t} measured={measured} a={answers[tr]} onChange={(p) => setAnswer(tr, p)} /> : null;
                })}
                <button type="button" className="text-sm text-primary hover:underline" onClick={() => setStep("trades")}
                  data-testid="button-se-add-trade">
                  + Price something else too
                </button>
              </div>
            )}

            {step === "discounts" && (
              <div className="space-y-2" data-testid="self-estimate-step-discounts">
                <div className="text-sm font-medium">Any of these apply to you?</div>
                <p className="text-xs text-muted-foreground">Tick what you qualify for — we'll verify it before the job.</p>
                {config.discounts.map((d) => (
                  <label key={d.code} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                    <Checkbox checked={codes.includes(d.code)} className="mt-0.5"
                      onCheckedChange={(v) => setCodes((c) => (v === true ? [...new Set([...c, d.code])] : c.filter((x) => x !== d.code)))}
                      data-testid={`checkbox-se-discount-${d.code}`} />
                    <span className="flex-1">
                      <span className="text-sm font-medium">{d.label} <span className="text-primary">−{d.percentBps / 100}%</span></span>
                      {d.conditions && <span className="block text-xs text-muted-foreground">{d.conditions}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {step === "result" && (
              <ResultView bp={server} busy={busy} disclaimer={config.disclaimer} rangeBps={config.rangeBps} />
            )}

            {error && <p className="text-sm text-destructive" data-testid="text-se-error">{error}</p>}

            {step !== "result" && (
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm flex items-center justify-between gap-2" data-testid="self-estimate-live">
                <span className="text-muted-foreground">Ballpark so far</span>
                <strong className="tabular-nums">
                  {live.lowCents !== null && live.highCents !== null ? `${dollars(live.lowCents)} – ${dollars(live.highCents)}` : "Request a price"}
                </strong>
              </div>
            )}

            {step === "result" ? (
              <div className="space-y-2">
                {!preview && (
                  <Textarea rows={2} className="resize-none" placeholder="Anything we should know? (optional)"
                    value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-se-note" />
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button className="h-11 sm:h-10 rounded-full flex-1" disabled={busy || preview || !chosen.length} onClick={send}
                    data-testid="button-se-send">
                    {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                    Send this to my contractor
                  </Button>
                  <Button variant="outline" className="h-11 sm:h-10 rounded-full" disabled={busy} onClick={justLooking}
                    data-testid="button-se-just-looking">
                    Just looking
                  </Button>
                </div>
                {preview && <p className="text-xs text-muted-foreground text-center">Preview — your client can send this from here.</p>}
                <button type="button" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
                  onClick={back} data-testid="button-se-back">
                  <ArrowLeft className="h-3.5 w-3.5" /> Change my answers
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                {idx > 0 && (
                  <Button variant="outline" className="h-11 sm:h-10 rounded-full" onClick={back} data-testid="button-se-prev">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                <Button className="h-11 sm:h-10 rounded-full flex-1" disabled={!chosen.length} onClick={next} data-testid="button-se-next">
                  {steps[idx + 1] === "result" ? "See my ballpark" : "Next"} <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TradeQuestions({ t, measured, a, onChange }: {
  t: PricedTrade; measured: MeasuredQuantities; a: SelfEstimateTradeSelection;
  onChange: (p: Partial<SelfEstimateTradeSelection>) => void;
}) {
  const area = t.trade === "siding" ? measured.sidingSqft : t.trade === "roofing" ? measured.roofSqft : null;
  const count = t.trade === "windows" ? measured.windowsCount : t.trade === "doors" ? measured.doorsCount : null;
  const isArea = t.trade === "siding" || t.trade === "roofing";
  const noun = t.trade === "windows" ? "windows" : "doors";
  return (
    <div className="space-y-3" data-testid={`se-questions-${t.trade}`}>
      <div className="font-semibold">{t.label}</div>
      <div className="grid gap-2">
        {t.products.map((p) => (
          <label key={p.id} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <input type="radio" name={`se-product-${t.trade}`} className="accent-[hsl(var(--primary))]" checked={a.productId === p.id}
              onChange={() => onChange({ productId: p.id })} data-testid={`radio-se-product-${t.trade}-${p.id}`} />
            {p.photoUrl && <img src={p.photoUrl} alt="" className="h-10 w-10 rounded object-cover shrink-0" loading="lazy" />}
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium">{p.name}</span>
              {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
            </span>
            {!p.unitPriceCents && <span className="text-xs text-muted-foreground shrink-0">Request a price</span>}
          </label>
        ))}
      </div>

      {isArea && (area ? (
        <p className="text-sm rounded-lg bg-primary/5 border border-primary/20 px-3 py-2" data-testid={`text-se-measured-${t.trade}`}>
          Based on your home's measurements: <strong>{fmt(area)} ft²</strong> of {t.trade === "siding" ? "siding" : "roof"}
          {t.trade === "roofing" && measured.roofWastePct ? ` (incl. ${fmt(measured.roofWastePct)}% waste)` : ""}
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`se-size-${t.trade}`}>
            {a.clientSizeKind === "house" ? "Your home's living area (ft²)" : `Roughly how many ft² of ${t.trade === "siding" ? "wall to side" : "roof"}?`}
          </Label>
          <Input id={`se-size-${t.trade}`} type="number" inputMode="numeric" min={1} className="h-11"
            value={a.clientSize ?? ""} placeholder="Your best guess"
            onChange={(e) => onChange({ clientSize: e.target.value ? Number(e.target.value) : undefined })}
            data-testid={`input-se-size-${t.trade}`} />
          {t.houseSqftFactorBps && (
            <button type="button" className="text-xs text-primary hover:underline"
              onClick={() => onChange({ clientSizeKind: a.clientSizeKind === "house" ? "area" : "house" })}>
              {a.clientSizeKind === "house" ? "I know the area instead" : "I only know my home's size"}
            </button>
          )}
          <p className="text-xs text-muted-foreground">This is your estimate — we'll measure before any real quote.</p>
        </div>
      ))}

      {t.trade === "siding" && (area || a.clientSizeKind === "house") && (
        <div className="space-y-1.5">
          <Label>How much of the house?</Label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(SIDING_PORTIONS) as SidingPortion[]).map((k) => (
              <Button key={k} type="button" variant={(a.portion ?? "whole") === k ? "default" : "outline"} size="sm"
                className="h-auto py-2 whitespace-normal text-xs" onClick={() => onChange({ portion: k })}
                data-testid={`button-se-portion-${k}`}>
                {SIDING_PORTIONS[k].label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {t.trade === "roofing" && (
        <div className="space-y-2">
          <Label>Layers of old roofing to tear off</Label>
          <div className="flex gap-2">
            {[1, 2].map((n) => (
              <Button key={n} type="button" size="sm" variant={(a.layers ?? 1) === n ? "default" : "outline"}
                onClick={() => onChange({ layers: n as 1 | 2 })} data-testid={`button-se-layers-${n}`}>
                {n} layer{n === 2 ? "s" : ""}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground self-center">Not sure? Pick 1.</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!a.gutters} onCheckedChange={(v) => onChange({ gutters: v === true })} data-testid="checkbox-se-gutters" />
            Include new gutters
          </label>
        </div>
      )}

      {!isArea && (
        <div className="space-y-1.5">
          <Label htmlFor={`se-count-${t.trade}`}>How many {noun}?</Label>
          <Input id={`se-count-${t.trade}`} type="number" inputMode="numeric" min={1} max={200} className="h-11 w-32"
            value={a.count ?? ""} onChange={(e) => onChange({ count: e.target.value ? Math.max(1, Math.min(200, Math.round(Number(e.target.value)))) : undefined })}
            data-testid={`input-se-count-${t.trade}`} />
          <p className="text-xs text-muted-foreground">
            {count ? `Your home measured ${count} ${noun} — change it if you only want some replaced.` : "Your estimate — we'll count them on site."}
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Priced {SELF_ESTIMATE_UNIT_LABEL[t.unit].per}.</p>
    </div>
  );
}

function ResultView({ bp, busy, disclaimer, rangeBps }: { bp: Ballpark | null; busy: boolean; disclaimer: string; rangeBps: number }) {
  if (busy && !bp) {
    return <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!bp) return null;
  const hasRange = bp.lowCents !== null && bp.highCents !== null;
  return (
    <div className="space-y-3" data-testid="self-estimate-step-result">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Your ballpark</div>
        <div className="text-2xl font-bold tabular-nums mt-1" data-testid="text-se-range">
          {hasRange ? `${dollars(bp.lowCents!)} – ${dollars(bp.highCents!)}` : "Request a price"}
        </div>
        {hasRange && <div className="text-xs text-muted-foreground mt-1">±{rangeBps / 100}% around {dollars(bp.totalCents)} · before tax</div>}
      </div>
      <ul className="space-y-2 text-sm">
        {bp.lines.map((l) => (
          <li key={l.trade} className="rounded-lg border p-3" data-testid={`se-line-${l.trade}`}>
            <div className="flex justify-between gap-2 font-medium">
              <span>{l.productName} {l.label.toLowerCase()}</span>
              <span className="tabular-nums">{dollars(l.totalCents)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {l.basis} · {fmt(l.quantity)} {SELF_ESTIMATE_UNIT_LABEL[l.unit].short}
            </div>
            {l.extras.map((x) => (
              <div key={x.label} className="text-xs text-muted-foreground flex justify-between gap-2">
                <span>+ {x.label}</span><span className="tabular-nums">{dollars(x.amountCents)}</span>
              </div>
            ))}
            {l.minimumAdjustmentCents > 0 && <div className="text-xs text-muted-foreground">Includes the minimum job price.</div>}
            {l.notes.map((n) => <div key={n} className="text-xs text-amber-700 dark:text-amber-400">{n}</div>)}
          </li>
        ))}
        {bp.unpriced.map((u) => (
          <li key={u.trade} className="rounded-lg border border-dashed p-3 text-muted-foreground" data-testid={`se-unpriced-${u.trade}`}>
            <div className="font-medium text-foreground">{u.productName ? `${u.productName} ${u.label.toLowerCase()}` : u.label} — Request a price</div>
            <div className="text-xs">{u.message}</div>
          </li>
        ))}
        {bp.discounts.length > 0 && (
          <li className="rounded-lg bg-muted/50 p-3 text-xs">
            {bp.discounts.map((d) => (
              <div key={d.code} className="flex justify-between gap-2">
                <span>{d.label} (to be verified)</span><span className="tabular-nums">−{d.percentBps / 100}%</span>
              </div>
            ))}
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground flex gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />{disclaimer}</p>
    </div>
  );
}
