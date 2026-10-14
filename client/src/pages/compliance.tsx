/**
 * Compliance Dept (/compliance): for every state, who licenses contractors and trades and who issues electrical
 * permits (the Washington L&I equivalents), with each agency's official lookup pages (shared/compliance), plus the
 * paid Permit & License Research Reports (/compliance/research, compliance-research.tsx).
 *
 * Signed out: the public marketing chrome (prerendered for SEO). Signed in: the app frame. The iPhone apps sell
 * nothing (App Store 3.1.3(f)), so they show the directory without the report offer.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Building2, ClipboardCheck, FileSearch, Phone, Search, Zap } from "lucide-react";
import { AppPage } from "@/components/app-ui";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inNativeApp } from "@/lib/app-shell";
import { US_STATES } from "@/lib/voice-studio";
import { formatUsd } from "@shared/plan-copy";
import { RESEARCH_STANDARD_CENTS, RESEARCH_EXTENDED_CENTS } from "@shared/plans";
import { RESEARCH_PATH } from "@shared/research-reports";
import {
  STATE_COMPLIANCE, ROLE_LABELS, ELECTRICAL_ISSUER_LABELS, type ComplianceAgency, type StateCompliance,
} from "@shared/compliance";

/** Signed out: public header + footer around a centered column. Signed in: the app page. */
export function ComplianceFrame({ next, testId, children }: { next: string; testId: string; children: ReactNode }) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  if (user) return <AppPage width="wide" testId={testId}>{children}</AppPage>;
  return (
    <div className="h-full overflow-y-auto">
      <PublicPageHeader next={next} />
      <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 sm:py-12 space-y-8" data-testid={testId}>{children}</main>
      <PublicPageFooter />
    </div>
  );
}

/** `unconfirmed`: the agency's site blocks automated link checks, so the link is listed but marked. */
function ExtLink({ href, children, testId, unconfirmed = false }: { href: string; children: ReactNode; testId?: string; unconfirmed?: boolean }) {
  return (<span className="inline-flex flex-wrap items-center gap-x-1.5">
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline break-all">
      {children} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
    {unconfirmed && <span className="text-[11px] text-muted-foreground" title="This agency's site blocks automated link checks, so we couldn't confirm it today.">(unconfirmed)</span>}
  </span>);
}

function AgencyCard({ a, i, unconfirmed }: { a: ComplianceAgency; i: number; unconfirmed: Set<string> }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3" data-testid={`card-agency-${i}`}>
      <div>
        <p className="font-semibold leading-snug">{a.name}{a.acronym ? <span className="text-muted-foreground font-normal"> ({a.acronym})</span> : null}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.roles.map((r) => <Badge key={r} variant="secondary" className="font-normal">{ROLE_LABELS[r] ?? r}</Badge>)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {a.licenseLookupUrl && <ExtLink href={a.licenseLookupUrl} unconfirmed={unconfirmed.has(a.licenseLookupUrl)}>Look up a license</ExtLink>}
        {a.permitLookupUrl && <ExtLink href={a.permitLookupUrl} unconfirmed={unconfirmed.has(a.permitLookupUrl)}>Look up a permit</ExtLink>}
        {a.openDataUrl && <ExtLink href={a.openDataUrl} unconfirmed={unconfirmed.has(a.openDataUrl)}>Open data</ExtLink>}
        {a.website && <ExtLink href={a.website} unconfirmed={unconfirmed.has(a.website)}>Agency website</ExtLink>}
        {a.phone && <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{a.phone}</span>}
      </div>
      {a.notes && <p className="text-xs text-muted-foreground leading-relaxed">{a.notes}</p>}
    </div>
  );
}

function StateSection({ s }: { s: StateCompliance }) {
  const unconfirmed = new Set(s.unconfirmedUrls ?? []);
  return (
    <section id={`state-${s.state}`} className="scroll-mt-20 space-y-4" data-testid={`section-state-${s.state}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">{s.stateName}</h2>
        <span className="text-xs text-muted-foreground">Links checked {s.checkedAt}</span>
      </div>
      <p className="text-sm leading-relaxed max-w-3xl">{s.summary}</p>
      <div className="rounded-lg border-l-4 border-primary bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium inline-flex items-center gap-1.5"><Zap className="h-4 w-4" aria-hidden="true" /> {ELECTRICAL_ISSUER_LABELS[s.electricalPermits.issuer] ?? "Electrical permits"}</p>
        {s.electricalPermits.program && <p className="mt-1 text-muted-foreground">{s.electricalPermits.program}</p>}
        {s.electricalPermits.notes && <p className="mt-1 text-muted-foreground">{s.electricalPermits.notes}</p>}
        {s.electricalPermits.permitLookupUrl && <div className="mt-2"><ExtLink href={s.electricalPermits.permitLookupUrl} unconfirmed={unconfirmed.has(s.electricalPermits.permitLookupUrl)}>Search state electrical permits</ExtLink></div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {s.agencies.map((a, i) => <AgencyCard key={`${a.name}-${i}`} a={a} i={i} unconfirmed={unconfirmed} />)}
      </div>
    </section>
  );
}

export function ResearchOffer({ compact = false }: { compact?: boolean }) {
  if (inNativeApp()) return null;
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6 flex flex-col sm:flex-row gap-5 sm:items-center justify-between" data-testid="card-research-offer">
      <div className="space-y-2 max-w-2xl">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FileSearch className="h-4 w-4" aria-hidden="true" /> Permit &amp; License Research Report</p>
        <p className={compact ? "font-semibold" : "text-lg font-semibold"}>Let our research bot search every permit portal in a state for you.</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Give us names of people or companies, the states and the trades you care about. We search the state license
          records and every city and county permit portal we can reach there, and send you a sourced report.
          {" "}{formatUsd(RESEARCH_STANDARD_CENTS)} for one name in one state, {formatUsd(RESEARCH_EXTENDED_CENTS)} for up to five names in up to three states.
          Paid up front and non-refundable. Nothing is guaranteed.
        </p>
      </div>
      <Button asChild className="shrink-0" data-testid="link-order-research">
        <Link href={RESEARCH_PATH}>Order a report <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link>
      </Button>
    </div>
  );
}

export default function CompliancePage() {
  const [q, setQ] = useState("");
  const states = useMemo(() => {
    const t = q.trim().toLowerCase();
    return STATE_COMPLIANCE.filter((s) => !t || s.stateName.toLowerCase().includes(t) || s.state.toLowerCase() === t ||
      s.agencies.some((a) => a.name.toLowerCase().includes(t) || (a.acronym ?? "").toLowerCase() === t));
  }, [q]);
  const listed = new Set(STATE_COMPLIANCE.map((s) => s.state));

  return (
    <ComplianceFrame next="/compliance" testId="page-compliance">
      <header className="space-y-3">
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Compliance Dept</p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" data-testid="text-compliance-title">Who licenses contractors and issues electrical permits, state by state</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          Every state splits construction compliance differently. In Washington, Labor &amp; Industries licenses contractors and
          electricians and issues most electrical permits. In other states it's a licensing board, a fire marshal, or the city.
          Here is who does what in each state, with links to their official license and permit lookups.
        </p>
      </header>

      <ResearchOffer />

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a state or agency" className="pl-9" aria-label="Find a state or agency" data-testid="input-compliance-search" />
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="States">
          {US_STATES.filter((s) => listed.has(s.code)).map((s) => (
            <a key={s.code} href={`#state-${s.code}`} className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">{s.code}</a>
          ))}
        </nav>
      </div>

      {STATE_COMPLIANCE.length === 0 ? (
        <p className="rounded-lg border p-6 text-sm text-muted-foreground inline-flex items-center gap-2" data-testid="text-compliance-empty"><Building2 className="h-4 w-4" aria-hidden="true" /> The state directory is being checked and will appear here shortly.</p>
      ) : states.length === 0 ? (
        <p className="text-sm text-muted-foreground">No state or agency matches “{q}”.</p>
      ) : (
        <div className="space-y-12">{states.map((s) => <StateSection key={s.state} s={s} />)}</div>
      )}

      <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
        Agencies reorganize and move their websites. Every link here was opened and checked on the date shown; if one has
        changed, tell us at support@constructhub.us. This directory is information, not legal advice. Confirm license
        requirements with the agency before you bid or hire.
      </p>
    </ComplianceFrame>
  );
}
