/**
 * What a research report searches, state by state (/compliance/research/coverage). Every source listed comes from the
 * build-time manifest (virtual:research-coverage, generated from the research bot's own registry), so this page can't
 * promise a source the bot doesn't search. The daily files' identifiers come from their loaded rows when the facets
 * endpoint answers (it doesn't while the page is prerendered; the build-time list shows then).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, FileSearch, MapPin } from "lucide-react";
import manifest from "virtual:research-coverage";
import { Button } from "@/components/ui/button";
import { stateName } from "@/lib/voice-studio";
import { COMPLIANCE_PATH, RESEARCH_PATH } from "@shared/research-reports";
import {
  COVERAGE_ID_LABELS, COVERAGE_KIND_LABELS, COVERAGE_KIND_ORDER, RESEARCH_COVERAGE_PATH, coverageNote, nationwideNow, withFacets,
  type CoverageFacets, type CoverageRuntime, type CoverageSource, type CoverageState,
} from "@shared/research-coverage";
import { ComplianceFrame } from "./compliance";

const licenseCount = (s: CoverageState) => s.sources.filter((x) => x.kinds.includes("licenses")).length;
const recordCount = (s: CoverageState) => s.sources.filter((x) => !x.kinds.includes("licenses")).length;

/** The state in the address bar (#FL), so a link can open one state. */
function useHashState(): [string | null, (s: string | null) => void] {
  const read = () => {
    if (typeof window === "undefined") return null;
    const h = window.location.hash.replace(/^#/, "").toUpperCase();
    return manifest.states.some((s) => s.state === h) ? h : null;
  };
  const [state, setState] = useState<string | null>(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const set = (s: string | null) => {
    history.replaceState(null, "", s ? `#${s}` : window.location.pathname);
    setState(s);
    if (s) requestAnimationFrame(() => document.getElementById("state-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return [state, set];
}

function refreshText(hours?: number): string {
  if (!hours) return "Official file, downloaded on a schedule";
  if (hours <= 24) return "Official file, downloaded daily";
  if (hours <= 24 * 7) return "Official file, downloaded weekly";
  return "Official file, downloaded monthly";
}

function SourceRow({ src }: { src: CoverageSource }) {
  return (
    <li className="rounded-lg border p-3 space-y-2" data-testid="coverage-source">
      <p className="text-sm font-medium leading-snug">
        {src.url ? (
          <a href={src.url} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-start gap-1">
            {src.label} <ArrowUpRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ) : src.label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground mr-1">Found by:</span>
        {src.ids.map((id) => (
          <span key={id} className="rounded-full border bg-muted/40 px-2 py-0.5" data-testid={`chip-${id}`}>{COVERAGE_ID_LABELS[id]}</span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {src.mode === "file" ? refreshText(src.refreshHours) : "Searched live on the agency's site when your report runs"}
        {src.local ? " · City or county records" : ""}
        {src.companiesOnly ? " · Companies only" : ""}
        {src.sampled ? " · \"Found by\" read from a sample of the file until its next load" : ""}
      </p>
    </li>
  );
}

function StateDetail({ s, facets }: { s: CoverageState; facets: CoverageFacets | undefined }) {
  const sources = s.sources.map((x) => withFacets(x, facets));
  const note = coverageNote(s);
  const groups = COVERAGE_KIND_ORDER.map((k) => [k, sources.filter((x) => x.kinds[0] === k)] as const).filter(([, l]) => l.length);
  return (
    <section id="state-detail" className="space-y-5 scroll-mt-20" data-testid={`coverage-state-${s.state}`}>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">What a report searches in {stateName(s.state)}</h2>
        <p className="text-sm text-muted-foreground">
          {s.sources.length === 0 ? `Not searched by ConstructHUB: ${s.unavailableCount ? `we checked ${s.unavailableCount} of this state's sources and couldn't use them (blocked to automated searches, behind an account, paid, or not searchable by name)` : "we have no source for this state yet"}` : <>
            {licenseCount(s) || "No"} license source{licenseCount(s) === 1 ? "" : "s"} and {recordCount(s) || "no"} enforcement or record source{recordCount(s) === 1 ? "" : "s"}
          </>}{s.checked ? `, last checked ${s.checked}` : ""}.
        </p>
      </div>
      {note && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="text-coverage-note">{note}</p>}
      {s.noStatewideGcLicense && <p className="text-sm"><span className="font-medium">No statewide general contractor license: </span>{s.noStatewideGcLicense.replace(/ and are searched above$/, "")}.</p>}
      {groups.map(([kind, list]) => (
        <div key={kind} className="space-y-2">
          <h3 className="font-semibold">{COVERAGE_KIND_LABELS[kind]} <span className="font-normal text-muted-foreground">({list.length})</span></h3>
          <ul className="grid gap-2 md:grid-cols-2">{list.map((src, i) => <SourceRow key={i} src={src} />)}</ul>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        Plus every city and county permit portal we can reach in {stateName(s.state)}, and the nationwide records below.
      </p>
    </section>
  );
}

export default function ResearchCoveragePage() {
  const [picked, setPicked] = useHashState();
  // The loaded files' real identifiers. Optional: the page reads fine without them (and is prerendered without them).
  const { data: facets } = useQuery<CoverageFacets>({ queryKey: ["/api/research-reports/coverage-facets"], retry: false, staleTime: 3600_000 });
  const { data: runtime } = useQuery<CoverageRuntime>({ queryKey: ["/api/research-reports/coverage-runtime"], retry: false, staleTime: 600_000 });
  const states = useMemo(() => [...manifest.states].sort((a, b) => stateName(a.state).localeCompare(stateName(b.state))), []);
  const current = picked ? manifest.states.find((s) => s.state === picked) ?? null : null;
  const totals = useMemo(() => ({
    sources: manifest.states.reduce((n, s) => n + s.sources.length, 0),
    withLicenses: manifest.states.filter((s) => licenseCount(s) > 0).length,
  }), []);

  return (
    <ComplianceFrame next={RESEARCH_COVERAGE_PATH} testId="page-research-coverage">
      <header className="space-y-3 max-w-3xl">
        <p><Link href={RESEARCH_PATH} className="text-sm text-muted-foreground hover:underline">← Research reports</Link></p>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FileSearch className="h-4 w-4" aria-hidden="true" /> What we search</p>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-coverage-title">What a research report searches, state by state</h1>
        <p className="text-muted-foreground leading-relaxed">
          Pick a state to see every official source a report checks there: license boards, discipline and complaint records,
          stop-work orders, debarments and business filings, and whether each one can be searched by business name, owner,
          license number, phone or address. This list is built from the same source list the reports use, so it changes when
          they do. Right now that's {totals.sources} state and local sources, with license records in {totals.withLicenses} of
          the 50 states and DC.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="pick-state">
        <h2 id="pick-state" className="font-semibold inline-flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden="true" /> Pick a state</h2>
        <label className="block sm:hidden">
          <span className="sr-only">State</span>
          <select className="w-full rounded-md border bg-background px-3 py-2 text-base" value={picked ?? ""} onChange={(e) => setPicked(e.target.value || null)} data-testid="select-coverage-state">
            <option value="">Choose a state…</option>
            {states.map((s) => <option key={s.state} value={s.state}>{stateName(s.state)} ({s.sources.length} sources)</option>)}
          </select>
        </label>
        <ul className="hidden sm:grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5" data-testid="grid-coverage-states">
          {states.map((s) => (
            <li key={s.state}>
              <button type="button" onClick={() => setPicked(s.state)} aria-pressed={picked === s.state}
                className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors hover:border-primary ${picked === s.state ? "border-primary bg-primary/5 ring-1 ring-primary" : ""}`}
                data-testid={`button-coverage-${s.state}`}>
                <span className="font-medium">{stateName(s.state)}</span>
                <span className="block text-xs text-muted-foreground">{s.sources.length ? `${s.sources.length} source${s.sources.length === 1 ? "" : "s"}` : "Permit portals only"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {current && <StateDetail s={current} facets={facets} />}

      <section className="space-y-3 max-w-3xl" data-testid="section-coverage-nationwide">
        <h2 className="text-xl font-semibold">In every state</h2>
        <ul className="space-y-1.5 text-sm list-disc pl-5">
          <li>Every city and county permit portal we can reach in the states you pick, searched by name.</li>
          {nationwideNow(manifest.nationwide, runtime).map((n) => <li key={n.label}>{n.label}, for companies.</li>)}
          <li>
            A cross-reference of what we find: the license numbers, phones, addresses and people on a contractor's licenses are
            searched again, so other licenses and businesses tied to them show up in the report, each with the link that ties it.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Complaints, enforcement and court records are searched for companies only, never for individual people. Some agency
          sites are down or block searches on the day a report runs; the report says which ones it couldn't search.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild data-testid="link-coverage-order"><Link href={RESEARCH_PATH}>Order a report <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" /></Link></Button>
        <Link href={COMPLIANCE_PATH} className="text-sm text-muted-foreground hover:underline">Who licenses contractors in each state</Link>
      </div>
    </ComplianceFrame>
  );
}
