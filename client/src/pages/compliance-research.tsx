/**
 * Permit & License Research Reports (/compliance/research): the order form (names, states, trades, the three
 * agreements), the free preview, then Stripe Checkout; /compliance/research/orders/:id shows the order and, once the
 * research bot (server/research/runner.ts) finishes, the report itself (printable).
 * Prices and limits come from shared/research-reports.ts, the same module the server charges from.
 */
import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, FileSearch, Loader2, Plus, Printer, Trash2, XCircle } from "lucide-react";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { inNativeApp } from "@/lib/app-shell";
import { US_STATES, stateName } from "@/lib/voice-studio";
import { formatUsd } from "@shared/plan-copy";
import {
  RESEARCH_TIERS, RESEARCH_TRADES, RESEARCH_TRADE_KEYS, RESEARCH_PATH, COMPLIANCE_PATH,
  RESEARCH_NONREFUNDABLE, RESEARCH_NO_GUARANTEE, RESEARCH_NOT_FCRA, researchTierFor,
  type ResearchOrderView, type ResearchTrade, type ResearchSubjectReport,
} from "@shared/research-reports";
import { ComplianceFrame } from "./compliance";

type Subject = { name: string; kind: "person" | "company" };
const MAX_NAMES = RESEARCH_TIERS.extended.maxNames;
const MAX_STATES = RESEARCH_TIERS.extended.maxStates;

function Terms() {
  return (
    <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5" data-testid="list-research-terms">
      <li>{RESEARCH_NONREFUNDABLE}</li>
      <li>{RESEARCH_NO_GUARANTEE}</li>
      <li>{RESEARCH_NOT_FCRA}</li>
    </ul>
  );
}

export default function ResearchOrderPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: orders } = useQuery<ResearchOrderView[]>({ queryKey: ["/api/research-reports/orders"], enabled: !!user });
  const [subjects, setSubjects] = useState<Subject[]>([{ name: "", kind: "company" }]);
  const [states, setStates] = useState<string[]>([]);
  const [trades, setTrades] = useState<ResearchTrade[]>([]);
  const [sinceYear, setSinceYear] = useState("");
  const [purpose, setPurpose] = useState("");
  const [agree, setAgree] = useState({ refund: false, guarantee: false, fcra: false });

  const named = subjects.filter((s) => s.name.trim().length >= 2);
  const tier = researchTierFor(named.length, states.length);
  const ready = !!tier && agree.refund && agree.guarantee && agree.fcra;

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/research-reports/orders", {
      subjects: named.map((s) => ({ name: s.name.trim(), kind: s.kind })), states, trades,
      sinceYear: /^\d{4}$/.test(sinceYear) ? Number(sinceYear) : null, purpose,
      agreeNonRefundable: agree.refund, agreeNoGuarantee: agree.guarantee, agreeNotFcra: agree.fcra,
    })).json() as Promise<ResearchOrderView>,
    onSuccess: (o) => navigate(`${RESEARCH_PATH}/orders/${o.id}`),
    onError: (err) => toast({ title: "Couldn't create the order", description: apiErrorMessage(err), variant: "destructive" }),
  });

  if (inNativeApp()) {
    return <ComplianceFrame next={RESEARCH_PATH} testId="page-research"><p className="text-sm text-muted-foreground">Research reports are ordered on constructhub.us.</p></ComplianceFrame>;
  }

  const toggleState = (code: string) => setStates((prev) => prev.includes(code) ? prev.filter((s) => s !== code) : prev.length >= MAX_STATES ? prev : [...prev, code]);

  return (
    <ComplianceFrame next={RESEARCH_PATH} testId="page-research">
      <header className="space-y-3">
        <Link href={COMPLIANCE_PATH} className="text-sm text-muted-foreground hover:underline">← Compliance Dept</Link>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FileSearch className="h-4 w-4" aria-hidden="true" /> Permit &amp; License Research Report</p>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-research-title">Find every permit and license tied to a name</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          Tell us who to look for and where. Our research bot searches the state contractor-license records and every city and
          county permit portal we can reach in those states, by name, and builds a report that links each finding to its
          official source. Reports are usually ready the same day.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
        {(Object.keys(RESEARCH_TIERS) as (keyof typeof RESEARCH_TIERS)[]).map((k) => (
          <div key={k} className={`rounded-lg border p-4 ${tier === k ? "border-primary ring-1 ring-primary" : ""}`} data-testid={`card-tier-${k}`}>
            <p className="font-semibold">{RESEARCH_TIERS[k].label}</p>
            <p className="text-2xl font-semibold mt-1">{formatUsd(RESEARCH_TIERS[k].cents)}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {RESEARCH_TIERS[k].maxNames === 1 ? "One name" : `Up to ${RESEARCH_TIERS[k].maxNames} names`} in {RESEARCH_TIERS[k].maxStates === 1 ? "one state" : `up to ${RESEARCH_TIERS[k].maxStates} states`}. Paid up front.
            </p>
          </div>
        ))}
      </div>

      <form className="space-y-6 max-w-3xl" onSubmit={(e) => { e.preventDefault(); if (!user) { navigate(`/auth?next=${encodeURIComponent(RESEARCH_PATH)}`); return; } if (ready) create.mutate(); }} data-testid="form-research">
        <fieldset className="space-y-3">
          <legend className="font-semibold">Who should we look for?</legend>
          {subjects.map((s, i) => (
            <div key={i} className="flex flex-col sm:flex-row gap-2">
              <Input value={s.name} onChange={(e) => setSubjects((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                placeholder={s.kind === "company" ? "Company name, e.g. Safe Consulting LLC" : "Person's name, e.g. Aaron Johnson"} maxLength={120}
                aria-label={`Name ${i + 1}`} data-testid={`input-subject-${i}`} className="sm:flex-1" />
              <div className="flex gap-2">
                {(["company", "person"] as const).map((k) => (
                  <Button key={k} type="button" variant={s.kind === k ? "default" : "outline"} size="sm" className="h-10"
                    onClick={() => setSubjects((p) => p.map((x, j) => j === i ? { ...x, kind: k } : x))} data-testid={`button-kind-${k}-${i}`}>
                    {k === "company" ? "Company" : "Person"}
                  </Button>
                ))}
                {subjects.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10" aria-label="Remove name" onClick={() => setSubjects((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {subjects.length < MAX_NAMES && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSubjects((p) => [...p, { name: "", kind: "person" }])} data-testid="button-add-subject">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add another name
            </Button>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-semibold">Which states? <span className="font-normal text-muted-foreground text-sm">(up to {MAX_STATES})</span></legend>
          <div className="flex flex-wrap gap-1.5" data-testid="list-states">
            {US_STATES.map((s) => (
              <button key={s.code} type="button" onClick={() => toggleState(s.code)} title={s.name} aria-pressed={states.includes(s.code)}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${states.includes(s.code) ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
                data-testid={`button-state-${s.code}`}>{s.code}</button>
            ))}
          </div>
          {states.length > 0 && <p className="text-sm text-muted-foreground">{states.map(stateName).join(", ")}</p>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-semibold">Trades to focus on <span className="font-normal text-muted-foreground text-sm">(optional; matching permits are listed first)</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {RESEARCH_TRADE_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={trades.includes(k)} onCheckedChange={(v) => setTrades((p) => v ? [...p, k] : p.filter((t) => t !== k))} data-testid={`checkbox-trade-${k}`} />
                {RESEARCH_TRADES[k].label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <Label htmlFor="since">Permits since (year)</Label>
            <Input id="since" inputMode="numeric" maxLength={4} value={sinceYear} onChange={(e) => setSinceYear(e.target.value.replace(/\D/g, ""))} placeholder="Any" className="mt-1.5" data-testid="input-since-year" />
          </div>
          <div>
            <Label htmlFor="purpose">What is this for? <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea id="purpose" rows={2} maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. checking a subcontractor's history before we hire them" className="mt-1.5" data-testid="textarea-purpose" />
          </div>
        </div>

        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 font-semibold">Before you pay</legend>
          <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={agree.refund} onCheckedChange={(v) => setAgree((a) => ({ ...a, refund: v === true }))} data-testid="checkbox-agree-refund" /><span>{RESEARCH_NONREFUNDABLE}</span></label>
          <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={agree.guarantee} onCheckedChange={(v) => setAgree((a) => ({ ...a, guarantee: v === true }))} data-testid="checkbox-agree-guarantee" /><span>{RESEARCH_NO_GUARANTEE}</span></label>
          <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={agree.fcra} onCheckedChange={(v) => setAgree((a) => ({ ...a, fcra: v === true }))} data-testid="checkbox-agree-fcra" /><span>{RESEARCH_NOT_FCRA}</span></label>
          <p className="text-xs text-muted-foreground">See our <Link href="/terms" className="underline">Terms of Use</Link>, section 10.</p>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={(!!user && !ready) || create.isPending} data-testid="button-research-continue">
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {!user ? "Sign in to continue" : tier ? `Continue: ${RESEARCH_TIERS[tier].label}, ${formatUsd(RESEARCH_TIERS[tier].cents)}` : "Add a name and a state"}
          </Button>
          <span className="text-xs text-muted-foreground">You'll see a free preview before you pay.</span>
        </div>
      </form>

      {!!orders?.length && (
        <section className="space-y-2 max-w-3xl" data-testid="list-research-orders">
          <h2 className="font-semibold">Your reports</h2>
          {orders.map((o) => (
            <Link key={o.id} href={`${RESEARCH_PATH}/orders/${o.id}`} className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm hover:bg-accent">
              <span>#{o.id} · {o.input.subjects.map((s) => s.name).join(", ")} · {o.input.states.join(", ")}</span>
              <StatusBadge status={o.status} />
            </Link>
          ))}
        </section>
      )}
    </ComplianceFrame>
  );
}

function StatusBadge({ status }: { status: ResearchOrderView["status"] }) {
  const label = { awaiting_payment: "Awaiting payment", paid: "Queued", researching: "Researching", complete: "Ready", failed: "Needs attention" }[status];
  return <Badge variant={status === "complete" ? "default" : status === "failed" ? "destructive" : "secondary"}>{label}</Badge>;
}

function SubjectReport({ s, i }: { s: ResearchSubjectReport; i: number }) {
  const searched = s.portals.filter((p) => p.outcome === "searched");
  const missed = s.portals.filter((p) => p.outcome !== "searched");
  return (
    <section className="space-y-4 break-inside-avoid-page" data-testid={`section-subject-${i}`}>
      <h2 className="text-xl font-semibold">{s.name} <span className="text-sm font-normal text-muted-foreground">({s.kind})</span></h2>

      <div className="space-y-2">
        <h3 className="font-semibold">License records ({s.licenses.length})</h3>
        {s.licenseSources.map((src, j) => (
          <p key={j} className="text-xs text-muted-foreground">{src.state}: {src.source}: {src.searched ? src.note : src.note}</p>
        ))}
        {s.licenses.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Business</th><th className="pr-3">Person</th><th className="pr-3">License</th><th className="pr-3">Type</th><th className="pr-3">Status</th><th className="pr-3">City</th><th className="whitespace-nowrap">Source</th></tr></thead>
            <tbody>{s.licenses.map((l, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3">{l.businessName ?? "—"}</td><td className="pr-3">{l.principal ?? "—"}</td><td className="pr-3 font-mono text-xs whitespace-nowrap">{l.licenseNumber ?? "—"}</td>
                <td className="pr-3">{[l.licenseType, l.specialty].filter(Boolean).join(" · ") || "—"}</td><td className="pr-3">{l.status ?? "—"}{l.expires ? ` (exp. ${l.expires})` : ""}</td>
                <td className="pr-3">{l.city ?? "—"}</td><td className="whitespace-nowrap"><a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{l.state} data</a></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Permits ({s.permits.length})</h3>
        {s.permits.length === 0 ? <p className="text-sm text-muted-foreground">No permits found under this name in the portals we searched.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Where</th><th className="pr-3">Permit</th><th className="pr-3">Type</th><th className="pr-3">Issued</th><th className="pr-3">Address</th><th className="pr-3">Contractor / applicant</th><th className="whitespace-nowrap">Source</th></tr></thead>
            <tbody>{s.permits.map((p, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3">{p.jurisdiction}</td><td className="pr-3 font-mono text-xs">{p.permitNumber ?? "—"}</td>
                <td className="pr-3">{p.permitType ?? "—"}{p.tradeMatch.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{p.tradeMatch.map((t) => <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>)}</div>}
                  {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}</td>
                <td className="pr-3">{p.issuedDate ?? "No date"}</td><td className="pr-3">{p.address ?? "—"}</td>
                <td className="pr-3">{[p.contractorName, p.applicantName].filter(Boolean).join(" / ") || "—"}</td>
                <td>{p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Record <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></a> : "Portal"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Coverage: {searched.length} portal(s) searched, {missed.length} not searched</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-xs">
          {s.portals.map((p, j) => (
            <li key={j} className="flex items-start gap-1.5">
              {p.outcome === "searched" ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-green-600 shrink-0" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" aria-hidden="true" />}
              <span><strong>{p.jurisdiction}</strong>: {p.outcome === "searched" ? `${p.found} result(s)` : p.message}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function ResearchOrderStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { data: o, isLoading, error } = useQuery<ResearchOrderView>({
    queryKey: [`/api/research-reports/orders/${id}`],
    refetchInterval: (q) => { const s = q.state.data?.status; return s === "paid" || s === "researching" ? 15_000 : false; },
  });
  const pay = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/research-reports/orders/${id}/checkout`, {})).json() as Promise<{ url: string }>,
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (err) => toast({ title: "Couldn't open checkout", description: apiErrorMessage(err), variant: "destructive" }),
  });

  return (
    <ComplianceFrame next={`${RESEARCH_PATH}/orders/${id}`} testId="page-research-order">
      <Link href={RESEARCH_PATH} className="text-sm text-muted-foreground hover:underline print:hidden">← Research reports</Link>
      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /> : error || !o ? (
        <p className="text-sm text-muted-foreground">{error ? apiErrorMessage(error) : "Order not found."}</p>
      ) : (
        <div className="space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold" data-testid="text-order-title">Research report #{o.id}</h1>
              <p className="text-sm text-muted-foreground mt-1">{o.input.subjects.map((s) => s.name).join(", ")} · {o.input.states.map(stateName).join(", ")}
                {o.input.trades.length ? ` · ${o.input.trades.map((t) => RESEARCH_TRADES[t].label).join(", ")}` : ""}{o.input.sinceYear ? ` · since ${o.input.sinceYear}` : ""}</p>
            </div>
            <div className="flex items-center gap-2"><StatusBadge status={o.status} />
              {o.status === "complete" && <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()} data-testid="button-print"><Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Print / save PDF</Button>}</div>
          </header>

          {o.status === "awaiting_payment" && (
            <div className="space-y-4 max-w-3xl">
              {o.preview && (
                <div className="rounded-lg border p-4 space-y-1 text-sm" data-testid="card-preview">
                  <p className="font-semibold">Free preview</p>
                  {o.preview.licenseSourceStates.length > 0
                    ? <p>{o.preview.licenseMatches} license record(s) match in {o.preview.licenseSourceStates.join(", ")} state license data.</p>
                    : <p>We don't search state license records for {o.input.states.join(", ")} yet. The report covers permit portals only there.</p>}
                  {Object.entries(o.preview.portalsByState).map(([st, n]) => <p key={st}>The report will search {n} live permit portal(s) in {stateName(st)} by name.</p>)}
                  <p className="text-muted-foreground">Details, permit matches and sources come with the full report.</p>
                </div>
              )}
              <Terms />
              <Button onClick={() => pay.mutate()} disabled={pay.isPending} data-testid="button-pay">
                {pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Pay {formatUsd(o.priceCents)} and start the research
              </Button>
            </div>
          )}
          {(o.status === "paid" || o.status === "researching") && (
            <p className="rounded-lg border p-4 text-sm inline-flex items-center gap-2" data-testid="text-researching"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Paid. The research bot is {o.status === "paid" ? "about to start" : "searching now"}. Big states can take a few hours; we'll email you when the report is ready.</p>
          )}
          {o.status === "failed" && <p className="rounded-lg border border-destructive p-4 text-sm">Something went wrong while researching. Our team has been told and will rerun it; you don't need to do anything.</p>}
          {o.status === "complete" && o.report && (
            <div className="space-y-10">
              <p className="text-sm">Found {o.report.totals.licenses} license record(s) and {o.report.totals.permits} permit(s). {o.report.totals.portalsSearched} portal search(es) ran; {o.report.totals.portalsNotSearched} could not. Generated {new Date(o.report.generatedAt).toLocaleString()}.</p>
              {o.report.subjects.map((s, i) => <SubjectReport key={i} s={s} i={i} />)}
              <div className="border-t pt-4"><Terms /></div>
            </div>
          )}
        </div>
      )}
    </ComplianceFrame>
  );
}
