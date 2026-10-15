/**
 * Permit & License Research Reports (/compliance/research): the order form (names, states, trades, the three
 * agreements), the free preview, then Stripe Checkout; /compliance/research/orders/:id shows the order and, once the
 * research bot (server/research/runner.ts) finishes, the report itself (printable).
 * Prices and limits come from shared/research-reports.ts, the same module the server charges from.
 */
import { Fragment, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, FileSearch, Link2, Loader2, Plus, Printer, Trash2, XCircle } from "lucide-react";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
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
  RESEARCH_MAX_LICENSE_NUMBERS, RESEARCH_MAX_PHONES, RESEARCH_MAX_ADDRESSES, RELATED_TIES, cleanLicenseNumber, formatPhone, cleanAddress,
  type ResearchOrderView, type ResearchTrade, type ResearchSubjectReport, type EnforcementCategory, type LicenseHit, type EnforcementHit, type RelatedTie,
} from "@shared/research-reports";
import { RESEARCH_COVERAGE_PATH } from "@shared/research-coverage";
import { ComplianceFrame } from "./compliance";

/** One name on the form; the identifiers are typed as text (license numbers and phones comma-separated, addresses one per line). */
type Subject = { name: string; kind: "person" | "company"; licenses: string; phones: string; addresses: string; showIds: boolean };
const blankSubject = (kind: Subject["kind"]): Subject => ({ name: "", kind, licenses: "", phones: "", addresses: "", showIds: false });
const splitList = (v: string, sep: RegExp) => v.split(sep).map((x) => x.trim()).filter(Boolean);
/** The identifiers as the API takes them, plus the entries the shared rules reject (shown under the field). */
function subjectIds(s: Subject) {
  const lists = {
    licenseNumbers: { values: splitList(s.licenses, /[,;\n]/), check: cleanLicenseNumber, max: RESEARCH_MAX_LICENSE_NUMBERS },
    phones: { values: splitList(s.phones, /[,;\n]/), check: formatPhone, max: RESEARCH_MAX_PHONES },
    addresses: { values: splitList(s.addresses, /\n/), check: cleanAddress, max: RESEARCH_MAX_ADDRESSES },
  };
  const out: { licenseNumbers?: string[]; phones?: string[]; addresses?: string[] } = {};
  const problems: Partial<Record<keyof typeof lists, string>> = {};
  for (const [k, l] of Object.entries(lists) as [keyof typeof lists, (typeof lists)[keyof typeof lists]][]) {
    const bad = l.values.filter((v) => !l.check(v));
    if (bad.length) problems[k] = `Not recognized: ${bad.join(", ")}`;
    else if (l.values.length > l.max) problems[k] = `Up to ${l.max}`;
    if (l.values.length) out[k] = l.values;
  }
  return { ids: out, problems, count: Object.values(out).reduce((n, l) => n + (l?.length ?? 0), 0) };
}
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
  const [subjects, setSubjects] = useState<Subject[]>([blankSubject("company")]);
  const [states, setStates] = useState<string[]>([]);
  const [trades, setTrades] = useState<ResearchTrade[]>([]);
  const [sinceYear, setSinceYear] = useState("");
  const [purpose, setPurpose] = useState("");
  const [wantExtended, setWantExtended] = useState(false);
  const [agree, setAgree] = useState({ refund: false, guarantee: false, fcra: false });

  const named = subjects.filter((s) => s.name.trim().length >= 2);
  const tier = researchTierFor(named.length, states.length);
  const idsOk = named.every((s) => !Object.keys(subjectIds(s).problems).length);
  const ready = !!tier && idsOk && agree.refund && agree.guarantee && agree.fcra;
  const setSubject = (i: number, patch: Partial<Subject>) => setSubjects((p) => p.map((x, j) => j === i ? { ...x, ...patch } : x));

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/research-reports/orders", {
      subjects: named.map((s) => ({ name: s.name.trim(), kind: s.kind, ...subjectIds(s).ids })), states, trades,
      sinceYear: /^\d{4}$/.test(sinceYear) ? Number(sinceYear) : null, purpose,
      agreeNonRefundable: agree.refund, agreeNoGuarantee: agree.guarantee, agreeNotFcra: agree.fcra,
    })).json() as Promise<ResearchOrderView>,
    onSuccess: (o) => navigate(`${RESEARCH_PATH}/orders/${o.id}`),
    onError: (err) => toast({ title: "Couldn't create the order", description: apiErrorMessage(err), variant: "destructive" }),
  });

  if (inNativeApp()) {
    return <ComplianceFrame next={RESEARCH_PATH} testId="page-research"><p className="text-sm text-muted-foreground">Research reports are ordered on constructhub.us.</p></ComplianceFrame>;
  }

  const pickTier = (k: keyof typeof RESEARCH_TIERS) => {
    setWantExtended(k === "extended");
    if (k === "standard") {
      setSubjects((p) => [p.find((x) => x.name.trim()) ?? p[0]]);
      setStates((p) => p.slice(0, 1));
    } else if (subjects.length < 2) {
      setSubjects((p) => [...p, blankSubject("person")]);
      requestAnimationFrame(() => (document.querySelector('[data-testid="input-subject-1"]') as HTMLInputElement | null)?.focus());
    }
  };
  const toggleState = (code: string) => setStates((prev) => prev.includes(code) ? prev.filter((s) => s !== code) : prev.length >= MAX_STATES ? prev : [...prev, code]);

  return (
    <ComplianceFrame next={RESEARCH_PATH} testId="page-research">
      <header className="space-y-3">
        <Link href={COMPLIANCE_PATH} className="text-sm text-muted-foreground hover:underline">← Compliance Dept</Link>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FileSearch className="h-4 w-4" aria-hidden="true" /> Permit &amp; License Research Report</p>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-research-title">Find every permit and license tied to a name</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          Tell us who to look for and where. Our research bot finds contractors by name, owner, license number, phone or address
          and links related licenses: it searches the state contractor-license records and every city and county permit portal
          we can reach in those states, then follows the license numbers, phones, addresses and people on what it finds to other
          licenses and businesses tied to them. For a company it also pulls consumer complaints, state
          enforcement records (licensing-board discipline, stop-work orders, tax liens, debarments, environmental orders),
          federal court cases and OSHA safety inspections. Every finding links to its official
          source. Reports are usually ready the same day.
        </p>
      </header>

      <section className="max-w-3xl rounded-lg border bg-muted/30 p-4 sm:p-5 space-y-2" data-testid="section-research-what">
        <h2 className="font-semibold">What a report does</h2>
        <ul className="space-y-1.5 text-sm list-disc pl-5">
          <li>Finds a contractor by name, owner, license number, phone or address, in all 50 states and DC.</li>
          <li>Cross-references what it finds. Other licenses and businesses that share a license number, phone, address or person show up too, and each one says what ties it.</li>
          <li>Adds state enforcement records (board discipline, stop-work orders, debarments, liens), federal court cases and OSHA inspections for companies.</li>
        </ul>
        <Link href={RESEARCH_COVERAGE_PATH} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" data-testid="link-research-coverage">
          See exactly what we search in your state <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </section>

      {/* Picking a card shapes the form; the price always follows what's entered (one name in one state is Standard). */}
      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl" role="group" aria-label="Report size">
        {(Object.keys(RESEARCH_TIERS) as (keyof typeof RESEARCH_TIERS)[]).map((k) => (
          <button key={k} type="button" onClick={() => pickTier(k)} aria-pressed={tier === k}
            className={`rounded-lg border p-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tier === k ? "border-primary ring-1 ring-primary" : ""}`}
            data-testid={`card-tier-${k}`}>
            <p className="font-semibold">{RESEARCH_TIERS[k].label}</p>
            <p className="text-2xl font-semibold mt-1">{formatUsd(RESEARCH_TIERS[k].cents)}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {RESEARCH_TIERS[k].maxNames === 1 ? "One name" : `Up to ${RESEARCH_TIERS[k].maxNames} names`} in {RESEARCH_TIERS[k].maxStates === 1 ? "one state" : `up to ${RESEARCH_TIERS[k].maxStates} states`}. Paid up front.
            </p>
          </button>
        ))}
      </div>
      {wantExtended && tier === "standard" && (
        <p className="text-sm text-muted-foreground max-w-3xl -mt-4" data-testid="text-extended-hint">
          Add a second name or a second state for the Extended report. With one name in one state you pay the Standard price.
        </p>
      )}

      <form className="space-y-6 max-w-3xl" onSubmit={(e) => { e.preventDefault(); if (!user) { navigate(`/auth?next=${encodeURIComponent(RESEARCH_PATH)}`); return; } if (ready) create.mutate(); }} data-testid="form-research">
        <fieldset className="space-y-3">
          <legend className="font-semibold">Who should we look for?</legend>
          <p className="text-sm text-muted-foreground">Pick <strong>Person</strong> for an owner, officer or qualifier: we match the people named on licenses.</p>
          {subjects.map((s, i) => {
            const { problems, count } = subjectIds(s);
            return (
            <div key={i} className="space-y-2 rounded-lg border p-3" data-testid={`subject-${i}`}>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input value={s.name} onChange={(e) => setSubject(i, { name: e.target.value })}
                  placeholder={s.kind === "company" ? "Company name, e.g. Safe Consulting LLC" : "Person's name, e.g. Aaron Johnson"} maxLength={120}
                  aria-label={`Name ${i + 1}`} data-testid={`input-subject-${i}`} className="sm:flex-1" />
                <div className="flex gap-2">
                  {(["company", "person"] as const).map((k) => (
                    <Button key={k} type="button" variant={s.kind === k ? "default" : "outline"} size="sm" className="h-10"
                      onClick={() => setSubject(i, { kind: k })} data-testid={`button-kind-${k}-${i}`}>
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
              <button type="button" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" aria-expanded={s.showIds}
                onClick={() => setSubject(i, { showIds: !s.showIds })} data-testid={`button-ids-${i}`}>
                <ChevronDown className={`h-4 w-4 transition-transform ${s.showIds ? "rotate-180" : ""}`} aria-hidden="true" />
                Also search by license number, phone or address{count ? ` (${count})` : ""} <span className="text-muted-foreground">(optional, no extra charge)</span>
              </button>
              {s.showIds && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`lic-${i}`}>License numbers <span className="font-normal text-muted-foreground">(up to {RESEARCH_MAX_LICENSE_NUMBERS}, comma-separated)</span></Label>
                    <Input id={`lic-${i}`} value={s.licenses} onChange={(e) => setSubject(i, { licenses: e.target.value })} placeholder="e.g. CGC1512345, EC13008123" maxLength={260} className="mt-1.5" data-testid={`input-licenses-${i}`} aria-invalid={!!problems.licenseNumbers} />
                    {problems.licenseNumbers && <p className="mt-1 text-xs text-destructive">{problems.licenseNumbers}</p>}
                  </div>
                  <div>
                    <Label htmlFor={`tel-${i}`}>Phone numbers <span className="font-normal text-muted-foreground">(up to {RESEARCH_MAX_PHONES}, comma-separated)</span></Label>
                    <Input id={`tel-${i}`} type="tel" value={s.phones} onChange={(e) => setSubject(i, { phones: e.target.value })} placeholder="e.g. (813) 555-0142" maxLength={100} className="mt-1.5" data-testid={`input-phones-${i}`} aria-invalid={!!problems.phones} />
                    {problems.phones && <p className="mt-1 text-xs text-destructive">{problems.phones}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor={`addr-${i}`}>Street addresses <span className="font-normal text-muted-foreground">(up to {RESEARCH_MAX_ADDRESSES}, one per line)</span></Label>
                    <Textarea id={`addr-${i}`} rows={2} value={s.addresses} onChange={(e) => setSubject(i, { addresses: e.target.value })} placeholder="e.g. 123 Main St, Tampa FL 33602" maxLength={620} className="mt-1.5" data-testid={`input-addresses-${i}`} aria-invalid={!!problems.addresses} />
                    {problems.addresses && <p className="mt-1 text-xs text-destructive">{problems.addresses}. An address needs a house number and street.</p>}
                  </div>
                </div>
              )}
            </div>
            );
          })}
          {subjects.length < MAX_NAMES && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSubjects((p) => [...p, blankSubject("person")])} data-testid="button-add-subject">
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
            {!user ? "Sign in to continue" : tier && !idsOk ? "Fix the highlighted entries" : tier ? `Continue: ${RESEARCH_TIERS[tier].label}, ${formatUsd(RESEARCH_TIERS[tier].cents)}` : "Add a name and a state"}
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

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const ExtA = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">{children} <ArrowUpRight className="h-3 w-3" aria-hidden="true" /></a>
);

const ENFORCEMENT_LABELS: Record<EnforcementCategory, string> = {
  discipline: "Licensing-board discipline", complaint: "Licensing-board complaints", stop_work: "Stop-work orders",
  environmental: "Environmental enforcement", tax_lien: "Federal tax liens", debarment: "Debarments", business_status: "Business registration status",
  wage: "Wage and labor violations", court_case: "State court cases",
};
const ENFORCEMENT_ORDER: EnforcementCategory[] = ["discipline", "stop_work", "debarment", "wage", "court_case", "tax_lien", "environmental", "complaint", "business_status"];
/** Record sources shown in their own sections (complaints, courts, OSHA); the rest are state enforcement sources. */
const OTHER_SECTION = /consumer complaints|attorney general|court|OSHA|Complaints, lawsuits/i;

/** State enforcement and standing records: discipline, stop-work orders, debarments, liens, environmental orders, status. */
function SubjectEnforcement({ s }: { s: ResearchSubjectReport }) {
  const hits = s.enforcement ?? [];
  const sources = (s.recordSources ?? []).filter((r) => !OTHER_SECTION.test(r.source));
  if (!s.enforcement && !sources.length) return null;
  const groups = ENFORCEMENT_ORDER.map((c) => [c, hits.filter((h) => h.category === c)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">State enforcement and standing records ({hits.length})</h3>
      {sources.filter((r) => r.searched).length > 0 && (
        <p className="text-xs text-muted-foreground">Searched: {sources.filter((r) => r.searched).map((r) => `${r.source} (${r.note})`).join("; ")}.</p>
      )}
      {groups.map(([cat, list]) => (
        <div key={cat} className="space-y-1.5" data-testid={`enforcement-${cat}`}>
          <h4 className="text-sm font-medium">{ENFORCEMENT_LABELS[cat]} ({list.length}){list.some((h) => h.adverse) ? <span className="ml-2 text-xs font-normal text-destructive">{list.filter((h) => h.adverse).length} adverse</span> : null}</h4>
          <div className="overflow-x-auto max-h-[28rem] print:max-h-none"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Date</th><th className="pr-3">Name on the record</th><th className="pr-3">Status or outcome</th><th className="pr-3">Details</th><th className="pr-3">Amount</th><th className="whitespace-nowrap">Source</th></tr></thead>
            <tbody>{list.map((h, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{h.date ?? "—"}{h.endDate ? <span className="block text-xs text-muted-foreground">to {h.endDate}</span> : null}</td>
                <td className="pr-3">{h.name ?? "—"}{h.city ? <span className="block text-xs text-muted-foreground">{h.city}</span> : null}</td>
                <td className="pr-3">{h.adverse ? <span className="text-destructive">{h.status ?? "—"}</span> : (h.status ?? "—")}</td>
                <td className="pr-3">{h.detail ?? "—"}</td>
                <td className="pr-3 whitespace-nowrap">{h.amount == null ? "—" : money(h.amount)}</td>
                <td className="whitespace-nowrap"><ExtA href={h.sourceUrl}>{h.state}{h.id ? ` #${h.id}` : ""}</ExtA><span className="block text-xs text-muted-foreground">{h.source}</span></td>
              </tr>))}</tbody>
          </table></div>
        </div>
      ))}
      {hits.length > 0 && <p className="text-xs text-muted-foreground">Each row is the agency's own record. A complaint or notice is not a finding; red marks an outcome the agency itself records as adverse (an order, suspension, stop-work order, lien or debarment).</p>}
    </div>
  );
}

/** Complaints, federal cases and OSHA inspections (companies only; reports made before these were added have none). */
function SubjectRecords({ s }: { s: ResearchSubjectReport }) {
  if (!s.recordSources) return null;
  const complaints = s.complaints ?? [], cases = s.courtCases ?? [], osha = s.osha ?? [];
  const byYear = new Map<string, number>();
  for (const c of complaints) { const y = c.opened?.slice(0, 4) ?? "Undated"; byYear.set(y, (byYear.get(y) ?? 0) + 1); }
  const savings = complaints.reduce((n, c) => n + (c.savings ?? 0), 0);
  return (
    <>
      <div className="space-y-2">
        <h3 className="font-semibold">Consumer complaints ({complaints.length})</h3>
        {s.recordSources.filter((r) => /consumer complaints|attorney general/i.test(r.source)).map((r, j) => (
          <p key={j} className="text-xs text-muted-foreground">{r.source} ({r.scope}): {r.note}</p>
        ))}
        {complaints.length > 0 && (<>
          <p className="text-sm">By year: {Array.from(byYear).sort().map(([y, n]) => `${y}: ${n}`).join(" · ")}{savings > 0 ? ` · "Actual savings" to consumers recorded by the AG: ${money(savings)}` : ""}</p>
          <div className="overflow-x-auto max-h-[28rem] print:max-h-none"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Opened</th><th className="pr-3">Status</th><th className="pr-3">Business on file</th><th className="pr-3">Complaint</th><th className="pr-3">Outcome</th><th className="whitespace-nowrap">Source</th></tr></thead>
            <tbody>{complaints.map((c, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{c.opened ?? "—"}</td><td className="pr-3">{c.status ?? "—"}</td>
                <td className="pr-3">{c.business ?? "—"}{c.city ? `, ${c.city}` : ""}</td>
                <td className="pr-3">{c.description ?? c.category ?? "—"}</td>
                <td className="pr-3">{c.resolution ?? (c.savings ? `${money(c.savings)} saved` : "—")}</td>
                <td className="whitespace-nowrap"><ExtA href={c.sourceUrl}>{c.state} AG{c.id ? ` #${c.id}` : ""}</ExtA></td>
              </tr>))}</tbody>
          </table></div>
        </>)}
      </div>

      <SubjectEnforcement s={s} />

      <div className="space-y-2">
        <h3 className="font-semibold">Federal court cases ({cases.length})</h3>
        <p className="text-xs text-muted-foreground">
          {s.recordSources.filter((r) => /court/i.test(r.source)).map((r) => `${r.source}: ${r.note}`).join(". ")}.
          {" "}A case filed is not a finding against anyone; open the docket for what happened.
        </p>
        {cases.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Filed</th><th className="pr-3">Case</th><th className="pr-3">Court</th><th className="pr-3">Type</th><th className="pr-3">Closed</th></tr></thead>
            <tbody>{cases.map((c, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{c.filed ?? "—"}</td>
                <td className="pr-3"><ExtA href={c.url}>{c.caseName}</ExtA>{c.docketNumber ? <span className="block text-xs text-muted-foreground font-mono">{c.docketNumber}</span> : null}</td>
                <td className="pr-3">{c.court ?? "—"}</td><td className="pr-3">{c.nature ?? "—"}</td><td className="pr-3 whitespace-nowrap">{c.terminated ?? "Open"}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">OSHA inspections ({osha.length})</h3>
        {s.recordSources.filter((r) => /OSHA/.test(r.source)).map((r, j) => (
          <p key={j} className="text-xs text-muted-foreground">{r.source} ({r.scope}): {r.note}</p>
        ))}
        {osha.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm border-collapse">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Opened</th><th className="pr-3">Establishment</th><th className="pr-3">Where</th><th className="pr-3">Violations</th><th className="pr-3">Penalty</th><th className="whitespace-nowrap">Source</th></tr></thead>
            <tbody>{osha.map((h, j) => (
              <tr key={j} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{h.opened ?? "—"}</td><td className="pr-3">{h.establishment ?? "—"}</td>
                <td className="pr-3">{[h.city, h.state].filter(Boolean).join(", ") || "—"}</td>
                <td className="pr-3">{h.violations == null ? "—" : `${h.violations}${h.seriousViolations ? ` (${h.seriousViolations} serious, willful or repeat)` : ""}`}</td>
                <td className="pr-3">{h.penalty == null ? "—" : money(h.penalty)}</td>
                <td className="whitespace-nowrap"><ExtA href={h.url}>OSHA #{h.activityNr}</ExtA></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {osha.length > 0 && <p className="text-xs text-muted-foreground">Inspection numbers come from the U.S. Department of Labor's enforcement data. osha.gov blocks automated link checks, so the OSHA links are unconfirmed.</p>}
      </div>

      {s.recordSources.some((r) => !r.searched) && (
        <p className="text-xs text-muted-foreground">Not searched: {s.recordSources.filter((r) => !r.searched).map((r) => `${r.source}${r.note ? ` (${r.note})` : ""}`).join("; ")}.</p>
      )}
    </>
  );
}

const FOUND_BY: Partial<Record<LicenseHit["matchedOn"], string>> = { license: "Found by license number", phone: "Found by phone", address: "Found by address" };

/** Everyone named on a license, with their role ("Jane Doe, qualifier"). */
function People({ l }: { l: LicenseHit }) {
  const people = l.people?.length ? l.people : l.principal ? [{ name: l.principal, role: null }] : [];
  if (!people.length) return <>—</>;
  return <>{people.map((p, k) => <span key={k} className="block">{p.name}{p.role ? <span className="text-xs text-muted-foreground">, {p.role.toLowerCase()}</span> : null}</span>)}</>;
}

/** Licenses as a table on wide screens and as stacked cards on a phone. */
function LicenseTable({ rows, testId, related }: { rows: LicenseHit[]; testId: string; related?: boolean }) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto print:block" data-testid={testId}><table className="w-full text-sm border-collapse">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Business</th><th className="pr-3">People on the license</th><th className="pr-3">License</th><th className="pr-3">Type</th><th className="pr-3">Status</th><th className="pr-3">Address and phone</th><th className="whitespace-nowrap">Source</th></tr></thead>
        <tbody>{rows.map((l, j) => (<Fragment key={j}>
          {related && l.relatedVia && (
            <tr className="align-top"><td colSpan={7} className="pt-2 text-xs text-muted-foreground"><Link2 className="inline h-3 w-3 mr-0.5" aria-hidden="true" />Why it's here: {l.relatedVia}</td></tr>
          )}
          <tr className="border-b align-top">
            <td className="py-2 pr-3">{l.businessName ?? "—"}</td>
            <td className="pr-3"><People l={l} /></td>
            <td className="pr-3 font-mono text-xs whitespace-nowrap">{l.licenseNumber ?? "—"}{!related && FOUND_BY[l.matchedOn] ? <span className="block font-sans text-muted-foreground">{FOUND_BY[l.matchedOn]}</span> : null}</td>
            <td className="pr-3">{[l.licenseType, l.specialty].filter(Boolean).join(" · ") || "—"}</td><td className="pr-3">{l.status ?? "—"}{l.expires ? ` (exp. ${l.expires})` : ""}</td>
            <td className="pr-3">{l.address ?? l.city ?? "—"}{l.phone ? <span className="block whitespace-nowrap">{formatPhone(l.phone) ?? l.phone}</span> : null}</td>
            <td className="whitespace-nowrap"><a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{l.state} data</a><span className="block text-xs text-muted-foreground max-w-[12rem] whitespace-normal">{l.source}</span></td>
          </tr></Fragment>))}</tbody>
      </table></div>
      <ul className="md:hidden print:hidden space-y-2" data-testid={`${testId}-cards`}>
        {rows.map((l, j) => (
          <li key={j} className="rounded-lg border p-3 text-sm space-y-1">
            <p className="font-medium">{l.businessName ?? l.principal ?? "—"}</p>
            {related && l.relatedVia && <p className="text-xs text-muted-foreground"><Link2 className="inline h-3 w-3 mr-0.5" aria-hidden="true" />Why it's here: {l.relatedVia}</p>}
            <p><span className="font-mono text-xs">{l.licenseNumber ?? "No number"}</span> · {[l.licenseType, l.specialty].filter(Boolean).join(" · ") || "—"}</p>
            <p>{l.status ?? "Status not published"}{l.expires ? ` (exp. ${l.expires})` : ""}</p>
            {(l.people?.length || l.principal) && <div className="text-xs"><People l={l} /></div>}
            {(l.address || l.city || l.phone) && <p className="text-xs text-muted-foreground">{[l.address ?? l.city, l.phone ? formatPhone(l.phone) ?? l.phone : null].filter(Boolean).join(" · ")}</p>}
            {!related && FOUND_BY[l.matchedOn] && <p className="text-xs text-muted-foreground">{FOUND_BY[l.matchedOn]}</p>}
            <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">{l.state}: {l.source}</a>
          </li>
        ))}
      </ul>
    </>
  );
}

const TIE_LABELS: Record<RelatedTie, { title: string; caveat?: string }> = {
  license: { title: "Same license number" },
  phone: { title: "Same phone number", caveat: "A phone can be shared, for example by an office or an answering service." },
  person: { title: "A person named on both", caveat: "Linked by a person's name only. It may be a different person with the same name." },
  business: { title: "The same business" },
  address: { title: "Same street address", caveat: "Businesses can share an address, for example an office building or a registered agent." },
};

/** Related licenses and businesses, grouped by the tie. None of them is the subject's own record. */
function RelatedRecords({ s, i }: { s: ResearchSubjectReport; i: number }) {
  if (!s.relatedLicenses && !s.relatedEnforcement) return null; // reports made before 2026-10-15
  const lic = s.relatedLicenses ?? [], enf = s.relatedEnforcement ?? [];
  const groups = RELATED_TIES.map((t) => ({ t, lic: lic.filter((h) => (h.relatedTie ?? "address") === t), enf: enf.filter((h) => (h.relatedTie ?? "address") === t) })).filter((g) => g.lic.length || g.enf.length);
  return (
    <div className="space-y-3" data-testid={`section-related-${i}`}>
      <h3 className="font-semibold">Related licenses and businesses ({lic.length + enf.length})</h3>
      <p className="text-sm text-muted-foreground">
        These are not {s.name}'s own records. Each one shares a license number, phone, address or person with a record above,
        and says which. Check the link before you rely on it.
      </p>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">We found no other licenses or businesses tied to these records.</p>}
      {groups.map((g) => (
        <div key={g.t} className="space-y-1.5" data-testid={`related-${g.t}-${i}`}>
          <h4 className="text-sm font-medium">{TIE_LABELS[g.t].title} ({g.lic.length + g.enf.length})</h4>
          {TIE_LABELS[g.t].caveat && <p className="text-xs text-muted-foreground">{TIE_LABELS[g.t].caveat}</p>}
          {g.lic.length > 0 && <LicenseTable rows={g.lic} related testId={`table-related-${g.t}-${i}`} />}
          {g.enf.length > 0 && <RelatedEnforcement rows={g.enf} />}
        </div>
      ))}
      {!!s.relatedNotes?.length && (
        <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">{s.relatedNotes.map((n, j) => <li key={j}>{n}</li>)}</ul>
      )}
    </div>
  );
}

function RelatedEnforcement({ rows }: { rows: EnforcementHit[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((h, j) => (
        <li key={j} className="rounded-lg border p-3 text-sm space-y-1">
          <p><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ENFORCEMENT_LABELS[h.category]}</span>{h.date ? <span className="text-xs text-muted-foreground"> · {h.date}{h.endDate ? ` to ${h.endDate}` : ""}</span> : null}</p>
          <p className="font-medium">{h.name ?? "—"}{h.city ? <span className="font-normal text-muted-foreground">, {h.city}</span> : null}</p>
          <p>{h.adverse ? <span className="text-destructive">{h.status ?? "—"}</span> : (h.status ?? "—")}{h.amount != null ? ` · ${money(h.amount)}` : ""}</p>
          {h.detail && <p className="text-xs text-muted-foreground">{h.detail}</p>}
          {h.relatedVia && <p className="text-xs text-muted-foreground"><Link2 className="inline h-3 w-3 mr-0.5" aria-hidden="true" />Why it's here: {h.relatedVia}</p>}
          <ExtA href={h.sourceUrl}>{h.state}{h.id ? ` #${h.id}` : ""}: {h.source}</ExtA>
        </li>
      ))}
    </ul>
  );
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
          <p key={j} className="text-xs text-muted-foreground">{src.state}: {src.source}: {src.note}</p>
        ))}
        {!!s.identifierSearches?.length && (
          <p className="text-xs text-muted-foreground" data-testid="text-identifier-searches">Also searched by {s.identifierSearches.map((x) => `${x.query} (${x.found} found; ${x.note})`).join("; ")}.</p>
        )}
        {s.licenses.length > 0 && <LicenseTable rows={s.licenses} testId={`table-licenses-${i}`} />}
      </div>

      <RelatedRecords s={s} i={i} />

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

      <SubjectRecords s={s} />

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
  const { data: me } = useQuery<{ isPlatformAdmin?: boolean } | null>({ queryKey: ["/api/auth/me"] });
  const adminRun = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/research-reports/orders/${id}/run`, {})).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/research-reports/orders/${id}`] }),
    onError: (err) => toast({ title: "Couldn't start the research", description: apiErrorMessage(err), variant: "destructive" }),
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
              {o.input.subjects.filter((s) => s.licenseNumbers?.length || s.phones?.length || s.addresses?.length).map((s, j) => (
                <p key={j} className="text-xs text-muted-foreground mt-0.5">{s.name}, also by: {[...(s.licenseNumbers ?? []).map((v) => `license ${v}`), ...(s.phones ?? []), ...(s.addresses ?? [])].join(" · ")}</p>
              ))}
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
                    ? <p>{o.preview.licenseMatches} license record(s) match in {o.preview.licenseSourceStates.join(", ")} state license data{o.preview.identifierMatches ? `, ${o.preview.identifierMatches} of them found by a license number, phone or address you gave` : ""}.</p>
                    : <p>We don't search state license records for {o.input.states.join(", ")} yet. The report covers permit portals only there.</p>}
                  {Object.entries(o.preview.portalsByState).map(([st, n]) => <p key={st}>The report will search {n} live permit portal(s) in {stateName(st)} by name.</p>)}
                  {o.preview.records && (o.preview.records.complaints > 0 || o.preview.records.courtCases > 0 || o.preview.records.osha > 0 || (o.preview.records.enforcement ?? 0) > 0) && (
                    <p data-testid="text-preview-records">Records on file: {o.preview.records.complaints} consumer complaint(s){o.preview.records.enforcement ? `, ${o.preview.records.enforcement} state enforcement or standing record(s)` : ""}, about {o.preview.records.courtCases} federal court docket(s){o.preview.records.osha ? ` and ${o.preview.records.osha} OSHA inspection(s)` : ""}.</p>
                  )}
                  <p className="text-muted-foreground">Details, permit matches, related licenses and businesses, and sources come with the full report.</p>
                </div>
              )}
              <Terms />
              <Button onClick={() => pay.mutate()} disabled={pay.isPending} data-testid="button-pay">
                {pay.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Pay {formatUsd(o.priceCents)} and start the research
              </Button>
              {me?.isPlatformAdmin === true && (
                <Button variant="outline" className="sm:ml-2" onClick={() => adminRun.mutate()} disabled={adminRun.isPending} data-testid="button-admin-run">
                  {adminRun.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  Admin: run without paying
                </Button>
              )}
            </div>
          )}
          {(o.status === "paid" || o.status === "researching") && (
            <p className="rounded-lg border p-4 text-sm inline-flex items-center gap-2" data-testid="text-researching"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Paid. The research bot is {o.status === "paid" ? "about to start" : "searching now"}. Big states can take a few hours; we'll email you when the report is ready.</p>
          )}
          {o.status === "failed" && <p className="rounded-lg border border-destructive p-4 text-sm">Something went wrong while researching. Our team has been told and will rerun it; you don't need to do anything.</p>}
          {o.status === "complete" && o.report && (
            <div className="space-y-10">
              <p className="text-sm">Found {o.report.totals.licenses} license record(s) and {o.report.totals.permits} permit(s){o.report.totals.complaints != null ? `, ${o.report.totals.complaints} consumer complaint(s)${o.report.totals.enforcement != null ? `, ${o.report.totals.enforcement} state enforcement or standing record(s)` : ""}, ${o.report.totals.courtCases ?? 0} federal court case(s) and ${o.report.totals.osha ?? 0} OSHA inspection(s)` : ""}. {o.report.totals.related ? `${o.report.totals.related} related record(s) of other licenses and businesses. ` : ""}{o.report.totals.portalsSearched} portal search(es) ran; {o.report.totals.portalsNotSearched} could not. Generated {new Date(o.report.generatedAt).toLocaleString()}.</p>
              {o.report.subjects.map((s, i) => <SubjectReport key={i} s={s} i={i} />)}
              <div className="border-t pt-4"><Terms /></div>
            </div>
          )}
        </div>
      )}
    </ComplianceFrame>
  );
}
