/**
 * Compliance Dept (/compliance): for every state, who licenses contractors and trades and who issues electrical
 * permits (the Washington L&I equivalents), with each agency's official lookup pages (shared/compliance), plus the
 * paid Permit & License Research Reports (/compliance/research, compliance-research.tsx).
 *
 * Signed out: the public marketing chrome (prerendered for SEO). Signed in: the app frame. The iPhone apps sell
 * nothing (App Store 3.1.3(f)), so they show the directory without the report offer.
 *
 * Facelift (owner, 2026-10-15: "bad UI, clean it up and add an 'i'"): the SEO Suite dashboard look — a quiet title
 * row with the "i", a number strip, one compact report card, a search + state pills picker, and one card per state
 * whose agencies are hairline rows with pill links. Every link, phone, note and "Links checked" date is rendered
 * exactly as shared/compliance provides it; nothing here is generated.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Building2, ChevronDown, ChevronUp, Database, ExternalLink, FileSearch, Globe, Phone, Search, Zap } from "lucide-react";
import { AppPage } from "@/components/app-ui";
import { GoogleList, GoogleListRow, GooglePill, GoogleSectionHeader, GoogleStat, GoogleStatGrid, GoogleSurface } from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { inNativeApp } from "@/lib/app-shell";
import { US_STATES } from "@/lib/voice-studio";
import { formatUsd } from "@shared/plan-copy";
import { RESEARCH_STANDARD_CENTS, RESEARCH_EXTENDED_CENTS } from "@shared/plans";
import { RESEARCH_PATH } from "@shared/research-reports";
import { RESEARCH_COVERAGE_PATH, runtimeRecordsPhrase, type CoverageRuntime } from "@shared/research-coverage";
import {
  STATE_COMPLIANCE, ROLE_LABELS, ELECTRICAL_ISSUER_LABELS, type ComplianceAgency, type StateCompliance,
} from "@shared/compliance";

/**
 * Signed out: public header + footer around a centered column, on a brand `g-surface` so the Google-style
 * blocks (pills, stat tiles, hairline rows) have their tokens. Signed in: the app page, which already sits on one.
 */
export function ComplianceFrame({ next, testId, children }: { next: string; testId: string; children: ReactNode }) {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  if (user) return <AppPage width="wide" testId={testId}>{children}</AppPage>;
  return (
    <div className="h-full overflow-y-auto">
      <PublicPageHeader next={next} />
      <GoogleSurface accent="brand">
        <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8 sm:py-12 space-y-5 sm:space-y-6" data-testid={testId}>{children}</main>
      </GoogleSurface>
      <PublicPageFooter />
    </div>
  );
}

const UNCONFIRMED_TITLE = "This agency's site blocks automated link checks, so we couldn't confirm it today.";

/** `unconfirmed`: the agency's site blocks automated link checks, so the link is listed but marked. */
function ExtLink({ href, children, testId, unconfirmed = false }: { href: string; children: ReactNode; testId?: string; unconfirmed?: boolean }) {
  return (<span className="inline-flex flex-wrap items-center gap-x-1.5">
    <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId} className="g-link inline-flex items-center gap-1 text-sm font-medium break-all">
      {children} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
    {unconfirmed && <span className="g-text-2 text-[11px]" title={UNCONFIRMED_TITLE}>(unconfirmed)</span>}
  </span>);
}

/** One agency's link as a pill; an unconfirmed link says so in its label and title. */
function LinkPill({ href, label, unconfirmed, icon, testId }: { href: string; label: string; unconfirmed: Set<string>; icon: typeof ExternalLink; testId?: string }) {
  const flagged = unconfirmed.has(href);
  return <GooglePill icon={icon} label={flagged ? `${label} (unconfirmed)` : label} href={href} external size="sm" variant={flagged ? "grey" : "outline"} title={flagged ? UNCONFIRMED_TITLE : undefined} testId={testId} />;
}

/** One licensing board or permit agency: a hairline row with its roles, its official links as pills, and its note. */
function AgencyRow({ a, i, unconfirmed }: { a: ComplianceAgency; i: number; unconfirmed: Set<string> }) {
  return (
    <GoogleListRow
      size="md"
      testId={`card-agency-${i}`}
      title={<>{a.name}{a.acronym ? <span className="g-text-2 font-normal"> ({a.acronym})</span> : null}</>}
      meta={[a.roles.map((r) => <span key={r} className="g-chip g-chip--sm mr-1">{ROLE_LABELS[r] ?? r}</span>)]}
      line={a.notes || undefined}
      actions={<>
        {a.licenseLookupUrl && <LinkPill href={a.licenseLookupUrl} label="Look up a license" icon={Search} unconfirmed={unconfirmed} testId={`link-license-lookup-${i}`} />}
        {a.permitLookupUrl && <LinkPill href={a.permitLookupUrl} label="Look up a permit" icon={Search} unconfirmed={unconfirmed} testId={`link-permit-lookup-${i}`} />}
        {a.openDataUrl && <LinkPill href={a.openDataUrl} label="Open data" icon={Database} unconfirmed={unconfirmed} />}
        {a.website && <LinkPill href={a.website} label="Agency website" icon={Globe} unconfirmed={unconfirmed} />}
        {a.phone && <GooglePill icon={Phone} label={a.phone} href={`tel:${a.phone.replace(/[^\d+]/g, "")}`} size="sm" title={`Call ${a.name}`} />}
      </>}
    />
  );
}

/** One state: a card with the summary, who issues electrical permits, and the agencies as a list. */
function StateSection({ s }: { s: StateCompliance }) {
  const unconfirmed = new Set(s.unconfirmedUrls ?? []);
  return (
    <section id={`state-${s.state}`} className="scroll-mt-20 rounded-xl border p-4 sm:p-5" style={{ borderColor: "var(--g-divider)" }} data-testid={`section-state-${s.state}`}>
      <GoogleSectionHeader
        as="h2"
        title={s.stateName}
        count={s.agencies.length}
        flush
        actions={<span className="g-text-2 text-[12px]">Links checked {s.checkedAt}</span>}
      />
      <p className="g-text my-3 max-w-3xl text-[14px] leading-5">{s.summary}</p>
      <div className="g-callout mb-3" data-testid={`callout-electrical-${s.state}`}>
        <h3 className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4" aria-hidden="true" /> {ELECTRICAL_ISSUER_LABELS[s.electricalPermits.issuer] ?? "Electrical permits"}</h3>
        {s.electricalPermits.program && <p>{s.electricalPermits.program}</p>}
        {s.electricalPermits.notes && <p>{s.electricalPermits.notes}</p>}
        {s.electricalPermits.permitLookupUrl && <div className="mt-2"><ExtLink href={s.electricalPermits.permitLookupUrl} unconfirmed={unconfirmed.has(s.electricalPermits.permitLookupUrl)}>Search state electrical permits</ExtLink></div>}
      </div>
      <GoogleList testId={`list-agencies-${s.state}`}>
        {s.agencies.map((a, i) => <AgencyRow key={`${a.name}-${i}`} a={a} i={i} unconfirmed={unconfirmed} />)}
      </GoogleList>
    </section>
  );
}

/**
 * The research-report offer as one compact card: what it is, the price line and the Order pill. The long
 * explanation lives behind "What the report covers" (and in the page's "i").
 */
export function ResearchOffer({ compact = false }: { compact?: boolean }) {
  // OSHA and SAM.gov are named only when the running server has them (A9; round 5, decision 11): not on first render.
  const { data: runtime } = useQuery<CoverageRuntime>({ queryKey: ["/api/research-reports/coverage-runtime"], retry: false, staleTime: 600_000 });
  const [open, setOpen] = useState(false);
  if (inNativeApp()) return null;
  return (
    <section className="g-callout" data-testid="card-research-offer" aria-labelledby="research-offer-title">
      <p className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide g-text-2"><FileSearch className="h-3.5 w-3.5" aria-hidden="true" /> Permit &amp; License Research Report</p>
      <h3 id="research-offer-title">Let our research bot search every permit portal in a state for you.</h3>
      {!compact && <p>Give us names of people or companies and the states you care about; you get a report where every finding links to its official source.</p>}
      <p className="mt-1" data-testid="text-research-price">
        <b className="g-text font-medium">{formatUsd(RESEARCH_STANDARD_CENTS)}</b> for one name in one state · <b className="g-text font-medium">{formatUsd(RESEARCH_EXTENDED_CENTS)}</b> for up to five names in up to three states · paid up front, non-refundable, nothing guaranteed.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <GooglePill icon={FileSearch} variant="solid" label="Order a report" href={RESEARCH_PATH} testId="link-order-research" />
        <GooglePill icon={open ? ChevronUp : ChevronDown} label="What the report covers" onClick={() => setOpen((v) => !v)} ariaPressed={open} selected={open} testId="button-research-covers" />
        <GooglePill variant="quiet" label="What we search in each state" href={RESEARCH_COVERAGE_PATH} testId="link-compliance-coverage" />
      </div>
      {open && (
        <ul className="space-y-1" data-testid="list-research-covers">
          <li>Finds contractors by name, owner, license number, phone or address in the state license records and every city and county permit portal we can reach in the states you pick.</li>
          <li>Follows the license numbers, phones, addresses and people it finds to other licenses and businesses tied to them, and says what ties each one.</li>
          <li>Adds consumer complaints, state discipline and enforcement records{runtimeRecordsPhrase(runtime)} for companies.</li>
          <li>Lists the trades you pick first, and shows which portals it searched and which it could not.</li>
        </ul>
      )}
    </section>
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
  // The number strip: counted from the directory data itself, never typed in.
  const totals = useMemo(() => ({
    states: STATE_COMPLIANCE.length,
    agencies: STATE_COMPLIANCE.reduce((n, s) => n + s.agencies.length, 0),
    lookups: STATE_COMPLIANCE.reduce((n, s) => n + s.agencies.filter((a) => a.licenseLookupUrl || a.permitLookupUrl).length, 0),
  }), []);
  const jump = (code: string) => { if (code) window.location.hash = `state-${code}`; };

  return (
    <ComplianceFrame next="/compliance" testId="page-compliance">
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-compliance-title"
        title="Compliance Dept"
        titleAfter={<HelpButton k="compliance" />}
        description="Who licenses contractors and trades, and who issues electrical permits, in every state, with each agency's official lookup links."
        flush
        actions={!inNativeApp() ? <GooglePill icon={FileSearch} variant="solid" label="Order a research report" href={RESEARCH_PATH} testId="link-order-research-top" /> : undefined}
      />

      <GoogleStatGrid cols={3}>
        <GoogleStat label="States listed" value={totals.states.toLocaleString()} hint="Including DC" testId="stat-compliance-states" />
        <GoogleStat label="Licensing boards and agencies" value={totals.agencies.toLocaleString()} testId="stat-compliance-agencies" />
        <GoogleStat label="Agencies with a lookup link" value={totals.lookups.toLocaleString()} hint="A license or permit lookup on the agency's own site" testId="stat-compliance-lookups" />
      </GoogleStatGrid>

      <ResearchOffer />

      <section className="space-y-3" aria-label="Find a state">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="g-search sm:w-96" role="search">
            <Search aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a state or agency" aria-label="Find a state or agency" data-testid="input-compliance-search" />
          </div>
          <label className="g-text-2 flex items-center gap-2 text-[13px]">Jump to
            <select className="g-input g-select !w-auto !py-1" defaultValue="" onChange={(e) => { jump(e.target.value); e.target.value = ""; }} aria-label="Jump to a state" data-testid="select-compliance-state">
              <option value="">a state…</option>
              {US_STATES.filter((s) => listed.has(s.code)).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <nav className="flex flex-wrap gap-1.5" aria-label="States">
          {US_STATES.filter((s) => listed.has(s.code)).map((s) => (
            <GooglePill key={s.code} size="sm" label={s.code} href={`#state-${s.code}`} title={s.name} ariaLabel={s.name} />
          ))}
        </nav>
      </section>

      {STATE_COMPLIANCE.length === 0 ? (
        <div className="g-callout" data-testid="text-compliance-empty">
          <h3 className="inline-flex items-center gap-2"><Building2 className="h-4 w-4" aria-hidden="true" /> The state directory is being checked</h3>
          <p>Each state's licensing boards and permit agencies appear here once their links have been opened and checked. Nothing is listed before it is confirmed.</p>
        </div>
      ) : states.length === 0 ? (
        <div className="g-callout" data-testid="text-compliance-no-match">
          <h3>No state or agency matches “{q}”</h3>
          <p>Try the state's name or two-letter code, or an agency's name or acronym. <button type="button" className="g-link" onClick={() => setQ("")}>Show every state</button></p>
        </div>
      ) : (
        <div className="space-y-5 sm:space-y-6" data-testid="list-compliance-states">{states.map((s) => <StateSection key={s.state} s={s} />)}</div>
      )}

      <p className="g-text-2 max-w-3xl text-[12px] leading-relaxed">
        Agencies reorganize and move their websites. Every link here was opened and checked on the date shown; if one has
        changed, tell us at support@constructhub.us. This directory is information, not legal advice. Confirm license
        requirements with the agency before you bid or hire. <Link href={RESEARCH_COVERAGE_PATH} className="g-link">What a research report searches in each state</Link>
      </p>
    </ComplianceFrame>
  );
}
