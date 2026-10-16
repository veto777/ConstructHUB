/**
 * /competitors — Competitor Intel: a market scan of the businesses Google lists for a trade around a place.
 *
 * Facelift (owner, 2026-10-15: "very boring and needs a face lift"): the SEO Suite dashboard look — a summary strip
 * across every saved scan, one panel per scan with its key numbers and action buttons (Open · Re-run · Delete), and an
 * opened scan read as a market report: the leaders, the rating and review-count distribution, then every listing with
 * its rating and review count up front and its review signals explained in one plain line. The server already lists
 * a scan's findings best-rated first (most-reviewed among equals); nothing here re-sorts them.
 *
 * Every API call is unchanged: GET/POST /api/competitors/scans, GET /api/competitors/scans/:id, POST …/:id/cancel,
 * DELETE …/:id. Industry is a free string server-side (1–120 chars) and radius an integer from 1 to 100 miles, so the
 * form offers a list AND a typed value for both (owner: "all advanced searches or filters … better have a custom
 * section where you can write your own request").
 */
import { AppPage, PageHeader, Section, Notice } from "@/components/app-ui";
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import {
  Search, Loader2, Trash2, AlertTriangle, Shield, Star, MapPin, Globe, Phone, ChevronDown, ChevronUp,
  Eye, RefreshCw, Repeat, ThumbsUp, ThumbsDown, Camera, UserCheck, UserX, Clock, MessageSquare, Ban, XCircle, Trophy,
} from "lucide-react";
import { PLANS, PLAN_KEYS, type PlanKey } from "@shared/plans";
import { COMPETITOR_INTEL_PLANS } from "@shared/plan-copy";
import { COMPETITOR_RADIUS_MAX, COMPETITOR_RADIUS_MIN } from "@shared/competitor-scan";
import { AppLocked } from "@/components/app-locked";
import { inNativeApp } from "@/lib/app-shell";
import { GoogleSurface, GoogleLocalCard, GooglePill, GoogleMoreButton, GoogleAiOverview, AiEntity, GoogleSectionHeader, formatCount } from "@/components/google";
import { MetricStrip, StatCell, StatusBadge, type Tone } from "@/components/tool";
import { DistributionBar } from "@/pages/seo/viz";
import { SAMPLE_BUSINESS, SamplePreview, showSample } from "@/components/sample-preview";
import { usageLine, type EntitlementsInfo } from "@/lib/pricing-display";
import { COMPETITORS_SUBTITLE, commonPhrasesBadge } from "@/components/competitors/review-signals";
import { topRatedPicks } from "@/components/competitors/top-rated";

/**
 * The server decides who may use Competitor Intel (server/entitlements.ts):
 * a plan without it answers 402 { code: "plan_required", requiredPlan, message }.
 * apiRequest/getQueryFn errors read "402: <json body>".
 */
function planRequiredFrom(err: unknown): { requiredPlan: PlanKey | null; message: string } | null {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const match = /^402:\s*(.*)$/s.exec(raw);
  if (!match) return null;
  try {
    const body = JSON.parse(match[1]);
    if (body?.code !== "plan_required") return null;
    const requiredPlan = (PLAN_KEYS as readonly string[]).includes(body.requiredPlan) ? body.requiredPlan as PlanKey : null;
    return { requiredPlan, message: typeof body.message === "string" ? body.message : "" };
  } catch {
    return null;
  }
}

/** Suggested trades. The server takes any text (1–120 characters), so "Something else" opens a typed field. */
const INDUSTRIES = [
  "Roofing Contractor",
  "Siding Contractor",
  "Painting Contractor",
  "Window Installation",
  "Gutter Installation",
  "Deck Builder",
  "General Contractor",
  "Plumber",
  "Electrician",
  "HVAC Contractor",
  "Landscaping",
  "Fencing Contractor",
  "Flooring Contractor",
  "Kitchen Remodeling",
  "Bathroom Remodeling",
  "Concrete Contractor",
  "Masonry Contractor",
  "Tree Service",
  "Pressure Washing",
  "Pest Control",
];
const CUSTOM_INDUSTRY = "__custom__";
/** Radius presets (miles); any whole number from 1 to 100 can be typed as well (the server's range). */
const RADIUS_PRESETS = [10, 25, 50, 100];
const RADIUS_MIN = COMPETITOR_RADIUS_MIN, RADIUS_MAX = COMPETITOR_RADIUS_MAX;

/** A scan that has not reached a terminal state yet: queued or indexing. */
const ACTIVE_STATUSES = ["pending", "running"];

type Listing = {
  id?: number; placeId?: string | null; businessName: string; address?: string | null; phone?: string | null; website?: string | null;
  rating?: string | number | null; reviewCount?: number | null; category?: string | null; isNew?: boolean;
  bsScore?: number | null; bsReasons?: string[] | null; reviewAnalysis?: any;
};

/* ── Review signals: the band, its colour, and one plain line ──────────────────────────────────────────────── */

type Band = { key: "few" | "some" | "more"; label: string; tone: Tone; color: string; badge: string };
/**
 * A band's colour is its StatusBadge tone (tool.css --tool-*-bg). Its outlined badge uses theme tokens: good news is
 * a neutral chip (the platform pill rule in index.css, "three colors only"), a warning is muted, more signals is red.
 */
const TONE_COLOR: Record<Exclude<Tone, "none">, string> = { good: "var(--tool-good-bg)", warn: "var(--tool-warn-bg)", bad: "var(--tool-bad-bg)" };
const TONE_BADGE: Record<Exclude<Tone, "none">, string> = {
  // `!`: the outline Badge sets its own faint border colour; the neutral chip keeps the theme's visible --border.
  good: "bg-muted text-foreground !border-[hsl(var(--border))]",
  warn: "bg-muted text-muted-foreground border-border",
  bad: "bg-destructive/10 text-destructive border-destructive/20",
};
const makeBand = (key: Band["key"], label: string, tone: Exclude<Tone, "none">): Band => ({ key, label, tone, color: TONE_COLOR[tone], badge: TONE_BADGE[tone] });
const BANDS: Record<Band["key"], Band> = {
  few: makeBand("few", "Few signals", "good"),
  some: makeBand("some", "Some signals", "warn"),
  more: makeBand("more", "More signals", "bad"),
};
const bandOf = (score: number): Band => (score >= 60 ? BANDS.more : score >= 30 ? BANDS.some : BANDS.few);
const scoreOf = (l: Listing) => l.bsScore || 0;
const ratingOf = (l: Listing) => { const r = Number(l.rating); return Number.isFinite(r) && r > 0 ? r : null; };

/** The signals in one sentence a contractor can read: the band, the score, and the first reason the scan gave. */
function signalLine(l: Listing): string {
  const score = scoreOf(l), band = bandOf(score);
  const reasons = (l.bsReasons ?? []).filter(Boolean);
  const first = reasons[0];
  if (score === 0 || !first) return `${band.label} (${score}/100): nothing unusual in the sampled reviews.`;
  const more = reasons.length > 1 ? ` +${reasons.length - 1} more` : "";
  return `${band.label} (${score}/100): ${first.replace(/\.?$/, "")}${more}.`;
}

/** How the listings spread across rating bands and review-count bands. */
const RATING_BANDS: [string, (r: number | null) => boolean, string][] = [
  ["5.0", (r) => r != null && r >= 5, "var(--tool-good-bg)"],
  ["4.5–4.9", (r) => r != null && r >= 4.5 && r < 5, "color-mix(in srgb, var(--g-green) 75%, var(--g-surface))"],
  ["4.0–4.4", (r) => r != null && r >= 4 && r < 4.5, "var(--g-star)"],
  ["Below 4.0", (r) => r != null && r < 4, "var(--g-red)"],
  ["No rating", (r) => r == null, "var(--g-divider)"],
];
const REVIEW_BANDS: [string, (n: number) => boolean, string][] = [
  ["100+ reviews", (n) => n >= 100, "var(--g-blue)"],
  ["25–99", (n) => n >= 25 && n < 100, "color-mix(in srgb, var(--g-blue) 65%, var(--g-surface))"],
  ["1–24", (n) => n >= 1 && n < 25, "color-mix(in srgb, var(--g-blue) 35%, var(--g-surface))"],
  ["None yet", (n) => n < 1, "var(--g-divider)"],
];

function Distribution({ title, parts, testId }: { title: string; parts: { label: string; value: number; color: string }[]; testId: string }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="tool-stat" data-testid={testId}>
      <div className="tool-stat__label">{title}</div>
      <DistributionBar testId={testId} parts={parts} />
      <p className="tool-stat__note">{total ? `${total} listing${total === 1 ? "" : "s"}` : "No listing yet"}</p>
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ── Page ─────────────────────────────────────────────────────────────────────────────────────────────────── */

export default function CompetitorsPage() {
  const { toast } = useToast();
  const [industryPick, setIndustryPick] = useState("");
  const [customIndustry, setCustomIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [radius, setRadius] = useState("25");
  const [expandedScan, setExpandedScan] = useState<number | null>(null);
  const industry = industryPick === CUSTOM_INDUSTRY ? customIndustry.trim() : industryPick;
  const radiusMiles = /^\d+$/.test(radius.trim()) ? parseInt(radius.trim(), 10) : NaN;
  const radiusOk = Number.isInteger(radiusMiles) && radiusMiles >= RADIUS_MIN && radiusMiles <= RADIUS_MAX;

  // No client-side plan check: the scans list answers 402 plan_required when
  // the account's plan does not include Competitor Intel.
  const scansQuery = useQuery<any[]>({
    queryKey: ["/api/competitors/scans"],
    refetchInterval: query => query.state.data?.some((scan: any) => ACTIVE_STATUSES.includes(scan.status)) ? 1500 : false,
  });
  const scans = scansQuery.data;
  const scansLoading = scansQuery.isLoading;
  const scansError = scansQuery.error;
  const planRequired = planRequiredFrom(scansError);
  // This month's scans, as the server counts them (same line the Ranking Grid shows under its form).
  const { data: entitlements } = useQuery<EntitlementsInfo>({ queryKey: ["/api/entitlements"] });
  const scansUsage = usageLine(entitlements?.usage?.competitorScans, entitlements?.isPlatformAdmin === true);

  // After a scan card is deleted its disclosure button is gone with it: land focus on the page
  // title so keyboard users are not dropped on the document body.
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const industryRef = useRef<HTMLButtonElement | null>(null);

  const scanMutation = useMutation({
    mutationFn: async (params: { industry: string; location: string; radius: number }) => {
      const res = await apiRequest("POST", "/api/competitors/scans", params);
      return res.json();
    },
    onSuccess: () => {
      // The scan is reserved against the monthly count the moment it starts:
      // refresh the scans and the "N of M used" line together.
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Scan started", description: "Indexing competitors in your market. This may take a moment." });
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: apiErrorMessage(err, "The scan could not be started. Please try again."), variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (scanId: number) => {
      const res = await apiRequest("POST", `/api/competitors/scans/${scanId}/cancel`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans"] });
      // A cancelled scan is not counted: bring the "N of M used" line in line.
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Scan cancelled", description: "Partial results stay on the card. This scan is not counted against your monthly limit." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not cancel scan", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scanId: number) => {
      const res = await apiRequest("DELETE", `/api/competitors/scans/${scanId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      toast({ title: "Scan deleted" });
      titleRef.current?.focus({ preventScroll: true });
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete scan", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const handleScan = () => {
    if (!industry) { toast({ title: industryPick === CUSTOM_INDUSTRY ? "Type the trade to scan for" : "Select an industry", variant: "destructive" }); return; }
    if (industry.length > 120) { toast({ title: "Keep the trade under 120 characters", variant: "destructive" }); return; }
    if (!location.trim()) { toast({ title: "Enter a location", variant: "destructive" }); return; }
    if (!radiusOk) { toast({ title: `Radius must be a whole number from ${RADIUS_MIN} to ${RADIUS_MAX} miles`, variant: "destructive" }); return; }
    scanMutation.mutate({ industry, location: location.trim(), radius: radiusMiles });
  };

  // The summary strip: every saved scan, added up (the list row carries totalFound, status, location, industry).
  const summary = useMemo(() => {
    const list = scans ?? [];
    const finished = list.filter((s) => s.status === "completed");
    const active = list.filter((s) => ACTIVE_STATUSES.includes(s.status));
    const indexed = list.reduce((n, s) => n + (s.totalFound || 0), 0);
    const markets = new Set(list.map((s) => String(s.location ?? "").trim().toLowerCase()).filter(Boolean)).size;
    const trades = new Set(list.map((s) => String(s.industry ?? "").trim().toLowerCase()).filter(Boolean)).size;
    const newest = list.map((s) => s.createdAt).filter(Boolean).sort().pop() as string | undefined;
    return { total: list.length, finished: finished.length, active: active.length, failed: list.filter((s) => s.status === "failed").length, indexed, markets, trades, newest };
  }, [scans]);

  // Wait for the server's answer so a plan without Competitor Intel never
  // flashes the scan form first.
  if (scansLoading) {
    return (
      <div className="flex justify-center py-16" data-testid="loader-competitors">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (planRequired) {
    // The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)): the locked tool only says
    // it isn't on this account — no plan names, no "See plans" button.
    if (inNativeApp()) {
      return (
        <GoogleSurface page><AppPage width="narrow" className="before:hidden max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11">
          <PageHeader title={<span data-testid="text-locked-title">Competitor intelligence</span>} description="Compare businesses and review signals in your local market." />
          <AppLocked name="Competitor Intel" testId="text-plan-required" />
        </AppPage></GoogleSurface>
      );
    }
    const requiredName = planRequired.requiredPlan ? PLANS[planRequired.requiredPlan].name : null;
    return (
      <GoogleSurface page><AppPage width="narrow" className="before:hidden max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11">
        <PageHeader title={<span data-testid="text-locked-title">Competitor intelligence</span>} description="Compare businesses and review signals in your local market." />
        <Section>
          <p className="text-muted-foreground" data-testid="text-plan-required">
            {planRequired.message || "Your plan does not include Competitor Intel."}
          </p>
          <p className="text-sm text-muted-foreground">
            Competitor Intel is included with the <span className="text-muted-foreground font-bold">{COMPETITOR_INTEL_PLANS}</span> plans.
          </p>
          <Button
            className="font-bold px-8"
            onClick={() => window.location.href = "/pricing"}
            data-testid="button-upgrade-plan"
          >
            <Shield className="w-4 h-4 mr-2" />
            {requiredName ? `See the ${requiredName} plan` : "See plans"}
          </Button>
        </Section>
      </AppPage></GoogleSurface>
    );
  }

  const noScans = showSample({ isLoading: scansLoading, isError: !!scansError, total: scans?.length });

  // Google look (owner, 2026-10-06): the page sits on a GoogleSurface; the scans are tool panels (SEO Suite's look).
  return (
    <GoogleSurface page><AppPage className="before:hidden max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11">
      <PageHeader title={<span ref={titleRef} tabIndex={-1} data-testid="text-competitors-title">Competitor intelligence</span>} description={COMPETITORS_SUBTITLE} />

      {/* ── New scan: three fields, first step clear ───────────────────────────────────────────────────── */}
      <section className="tool-panel" data-testid="card-new-scan" aria-labelledby="new-scan-title">
        <div className="tool-panel__head">
          <h2 id="new-scan-title" className="tool-panel__title">New market scan</h2>
          <span className="tool-muted text-[12px]">Pick a trade, name a place, set the radius — the scan reads Google's public listings.</span>
          {scansUsage && <span className="ml-auto tool-muted text-[12px]" data-testid="text-scan-usage">{scansUsage} this month</span>}
        </div>
        <div className="tool-panel__body">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-start">
            <div className="space-y-1.5">
              <Label htmlFor="industry">1 · Trade</Label>
              <Select value={industryPick} onValueChange={setIndustryPick}>
                <SelectTrigger id="industry" ref={industryRef} data-testid="select-industry">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map(ind => (
                    <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_INDUSTRY} data-testid="option-industry-custom">Something else — type it</SelectItem>
                </SelectContent>
              </Select>
              {industryPick === CUSTOM_INDUSTRY && (
                <Input
                  aria-label="Your own trade or search"
                  placeholder="e.g. Spray foam insulation, Pool builder"
                  maxLength={120}
                  value={customIndustry}
                  onChange={e => setCustomIndustry(e.target.value)}
                  autoFocus
                  className="max-sm:h-11"
                  data-testid="input-industry-custom"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">2 · Location</Label>
              <Input
                id="location"
                placeholder="City, ZIP or address, e.g. Tampa, FL"
                value={location}
                onChange={e => setLocation(e.target.value)}
                data-testid="input-location"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="radius">3 · Radius — miles ({RADIUS_MIN}–{RADIUS_MAX})</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {RADIUS_PRESETS.map((m) => (
                  <GooglePill key={m} size="sm" label={`${m} mi`} selected={radiusMiles === m} role="radio" ariaPressed={radiusMiles === m}
                    onClick={() => setRadius(String(m))} testId={`button-radius-${m}`} />
                ))}
                <Input
                  id="radius"
                  type="number"
                  inputMode="numeric"
                  min={RADIUS_MIN}
                  max={RADIUS_MAX}
                  step={1}
                  value={radius}
                  onChange={e => setRadius(e.target.value)}
                  aria-label="Custom radius in miles"
                  aria-invalid={radius !== "" && !radiusOk}
                  className="w-24 max-sm:h-11"
                  data-testid="input-radius"
                />
              </div>
              {radius !== "" && !radiusOk && <p className="text-xs" style={{ color: "var(--g-red)" }} role="alert">Whole miles from {RADIUS_MIN} to {RADIUS_MAX}.</p>}
            </div>
            <Button
              className="w-full md:mt-[1.625rem] md:w-auto"
              onClick={handleScan}
              disabled={scanMutation.isPending}
              data-testid="button-start-scan"
            >
              {scanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Scan market
            </Button>
          </div>
        </div>
      </section>

      {/* A failed list request is not an empty account: say so and retry, keeping any
          previously loaded scans on screen (react-query keeps the last good data). */}
      {!planRequired && scansError && !scansLoading && (
        <Notice tone="danger" title="Couldn't load your scans" testId="notice-scans-error"
          action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void scansQuery.refetch()} data-testid="button-retry-scans">Retry</Button>}>
          {apiErrorMessage(scansError, "The scan list could not be loaded.")}
        </Notice>
      )}

      {/* ── First visit: how it works, and a sample of what a finished scan looks like ────────────────────── */}
      {noScans && (
        <>
          <div className="g-callout" data-testid="card-how-it-works">
            <h2>How this works</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Pick your trade (or type one), name the city or address, and set how far out to look.</li>
              <li>Scan market reads the businesses Google lists there, with their rating, review count, phone and website. It uses one of your monthly scans.</li>
              <li>Open the scan: the leaders, how ratings and review counts spread across the market, and every listing with its review signals.</li>
            </ol>
          </div>
          <SamplePreview what="what a finished scan looks like" testId="sample-competitor-scan"
            cta={<GooglePill size="sm" label="Start your first scan" onClick={() => industryRef.current?.focus()} testId="button-sample-start-scan" />}>
            <SampleScan />
          </SamplePreview>
        </>
      )}

      {/* ── Every scan at a glance ─────────────────────────────────────────────────────────────────────────── */}
      {scans && scans.length > 0 && (
        <MetricStrip cols={[2, 4, 4]} boxed testId="competitor-portfolio">
          <StatCell label="Scans" value={String(summary.total)} testId="tile-scans"
            note={`${summary.finished} finished${summary.active ? ` · ${summary.active} running` : ""}${summary.failed ? ` · ${summary.failed} failed` : ""}`} />
          <StatCell label="Competitors indexed" value={formatCount(summary.indexed)} testId="tile-indexed" note="Across every saved scan" />
          <StatCell label="Markets" value={String(summary.markets)} testId="tile-markets" note={`${summary.trades} trade${summary.trades === 1 ? "" : "s"} scanned`} />
          <StatCell label="Newest scan" value={summary.newest ? new Date(summary.newest).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null} none="No scan yet" testId="tile-newest"
            note={scansUsage ? `${scansUsage} this month` : undefined} />
        </MetricStrip>
      )}

      <div className="space-y-4" data-testid="list-scans">
        {scans && scans.map((scan: any) => (
          <ScanCard
            key={scan.id}
            scan={scan}
            expanded={expandedScan === scan.id}
            onToggle={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
            onDelete={() => deleteMutation.mutate(scan.id)}
            deleting={deleteMutation.isPending}
            onCancel={() => cancelMutation.mutate(scan.id)}
            cancelling={cancelMutation.isPending}
            onRetry={() => scanMutation.mutate({ industry: scan.industry, location: scan.location, radius: scan.radius })}
            retrying={scanMutation.isPending}
          />
        ))}
      </div>
    </AppPage></GoogleSurface>
  );
}

/* ── A sample scan (static fixtures, shown only while the account has no scan) ─────────────────────────────── */

const SAMPLE_LISTINGS: Listing[] = [
  { id: -1, businessName: SAMPLE_BUSINESS.name, rating: "4.9", reviewCount: 212, category: "Roofing contractor", address: SAMPLE_BUSINESS.address, bsScore: 10, bsReasons: [] },
  { id: -2, businessName: "Example Exteriors LLC", rating: "4.8", reviewCount: 96, category: "Siding contractor", address: "45 Placeholder Ave, Sampletown", bsScore: 20, bsReasons: ["Perfect rating; consider the sample size and business context"] },
  { id: -3, businessName: "Demo Home Services", rating: "4.2", reviewCount: 31, category: "General contractor", address: "9 Fixture Rd, Sampletown", bsScore: 45, bsReasons: ["Several sampled reviews repeat the same phrases"] },
];

function SampleScan() {
  return (
    <section className="tool-panel">
      <div className="tool-panel__head">
        <h3 className="tool-panel__title">Sample trade — Sampletown</h3>
        <span className="tool-muted text-[12px]">25 mi · Jan 1 · 3 competitors</span>
        <StatusBadge tone="good">Completed</StatusBadge>
        <div className="ml-auto flex flex-wrap gap-1.5"><span className="tool-btn">Close report</span><span className="tool-btn">Re-run</span><span className="tool-btn">Delete</span></div>
      </div>
      <MetricStrip cols={[2, 3, 6]}>
        <StatCell label="Competitors" value="3" />
        <StatCell label="Average rating" value="4.6" note="3 rated" />
        <StatCell label="Reviews in market" value="339" note="median 96 per business" />
        <StatCell label="Few signals" value="2" />
        <StatCell label="Some signals" value="1" />
        <StatCell label="More signals" value="0" />
      </MetricStrip>
      <div className="tool-panel__body space-y-3">
        <div className="tool-stat__label"><Trophy className="h-3.5 w-3.5" aria-hidden /> Leaders</div>
        <div data-testid="sample-competitor-listings">
          {SAMPLE_LISTINGS.map((l, i) => (
            <GoogleLocalCard key={l.id} name={<><span className="tool-muted tabular-nums">#{i + 1}</span> {l.businessName}</>} rating={l.rating} reviewCount={l.reviewCount} category={l.category} open={null} address={l.address}
              badges={<Badge variant="outline" className={`text-[10px] px-1.5 ${bandOf(scoreOf(l)).badge}`}>{bandOf(scoreOf(l)).label}</Badge>}>
              <p className="g-card__meta">{signalLine(l)}</p>
            </GoogleLocalCard>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── The review-sample panel of one listing (unchanged wording: signals, never accusations) ────────────────── */

function ReviewAnalysisPanel({ analysis }: { analysis: any }) {
  if (!analysis || analysis.totalAnalyzed === 0) {
    return (
      <div className="mt-3 p-3 rounded-lg border border-border/30 bg-muted/20">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="w-3 h-3" /> No review data available for deep analysis
        </p>
      </div>
    );
  }

  const total = analysis.totalAnalyzed;
  const goodPct = Math.round((analysis.goodReviews / total) * 100);
  const badPct = Math.round((analysis.badReviews / total) * 100);
  const commonPhrasePct = Math.round((analysis.reviewsLookingAi / total) * 100);
  const genericPct = Math.round((analysis.reviewsGeneric / total) * 100);
  const photoPct = Math.round((analysis.reviewsWithPhotos / total) * 100);
  const realNamePct = Math.round((analysis.reviewsWithRealNames / total) * 100);

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <Eye className="w-3.5 h-3.5 text-muted-foreground" /> Signals worth a closer look ({total} reviews sampled)
      </p>

      <p className="text-xs text-muted-foreground">Heuristic signals from a selected sample are not proof of authorship, purchase, or authenticity. Scores are not probabilities.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-2 rounded border border-green-500/20 bg-green-500/5 text-center">
          <div className="flex items-center justify-center gap-1">
            <ThumbsUp className="w-3 h-3 text-green-500" />
            <span className="text-sm font-bold text-green-500">{analysis.goodReviews}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Good ({goodPct}%)</p>
        </div>
        <div className="p-2 rounded border border-red-500/20 bg-red-500/5 text-center">
          <div className="flex items-center justify-center gap-1">
            <ThumbsDown className="w-3 h-3 text-red-500" />
            <span className="text-sm font-bold text-red-500">{analysis.badReviews}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Bad ({badPct}%)</p>
        </div>
        <div className="p-2 rounded border border-border bg-muted text-center">
          <div className="flex items-center justify-center gap-1">
            <Repeat className="w-3 h-3 text-muted-foreground" />
            <span className="text-sm font-bold text-muted-foreground">{analysis.reviewsLookingAi}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Common phrases ({commonPhrasePct}%)</p>
        </div>
        <div className="p-2 rounded border border-amber-500/20 bg-amber-500/5 text-center">
          <div className="flex items-center justify-center gap-1">
            <MessageSquare className="w-3 h-3 text-amber-500" />
            <span className="text-sm font-bold text-amber-500">{analysis.reviewsGeneric}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Generic ({genericPct}%)</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <Camera className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Reviewer photos: <strong className="text-foreground">{photoPct}%</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-muted-foreground">Name pattern: <strong className="text-foreground">{realNamePct}%</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <UserX className="w-3 h-3 text-red-400 shrink-0" />
          <span className="text-muted-foreground">Missing links: <strong className="text-foreground">{analysis.blockedProfiles}</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <Clock className="w-3 h-3 text-orange-400 shrink-0" />
          <span className="text-muted-foreground">Oldest sampled: <strong className="text-foreground">{analysis.oldestReviewAge || "N/A"}</strong></span>
        </div>
      </div>

      {analysis.reviewVelocityNote && (
        <div className="p-2 rounded border border-red-500/30 bg-red-500/5">
          <p className="text-xs flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
            <span className="text-red-600 dark:text-red-400">{analysis.reviewVelocityNote}</span>
          </p>
        </div>
      )}

      {analysis.aiSuspectReviews && analysis.aiSuspectReviews.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground  flex items-center gap-1">
            <Repeat className="w-3 h-3" /> Repeated common phrases
          </p>
          {analysis.aiSuspectReviews.map((r: any, i: number) => (
            <div key={i} className="p-2 rounded border border-border bg-muted text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{r.author}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: r.rating }).map((_, j) => (
                    <Star key={j} className="w-2.5 h-2.5 fill-yellow-400 text-muted-foreground" />
                  ))}
                </div>
              </div>
              <p className="text-muted-foreground italic">"{r.text}"</p>
            </div>
          ))}
        </div>
      )}

      {analysis.genericReviews && analysis.genericReviews.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-amber-500  flex items-center gap-1">
            <Ban className="w-3 h-3" /> Generic Reviews (No Specific Details)
          </p>
          {analysis.genericReviews.map((r: any, i: number) => (
            <div key={i} className="p-2 rounded border border-amber-500/10 bg-amber-500/5 text-xs">
              <span className="font-medium">{r.author}</span>
              <span className="text-muted-foreground ml-1">— "{r.text}"</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── One scan: a panel with its numbers and actions; opened, a market report ───────────────────────────────── */

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Queued", tone: "none" }, running: { label: "Scanning", tone: "warn" }, completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "none" }, failed: { label: "Failed", tone: "bad" },
};

function ScanCard({ scan, expanded, onToggle, onDelete, deleting, onCancel, cancelling, onRetry, retrying }: {
  scan: any;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  onCancel: () => void;
  cancelling: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Google's local pack shows a few entries and a "More businesses" button; each press reveals the next batch.
  const PACK_SIZE = 8;
  const [shown, setShown] = useState(PACK_SIZE);
  const isActive = ACTIVE_STATUSES.includes(scan.status);
  const detailQuery = useQuery<{ scan: any; listings: Listing[] }>({
    queryKey: ["/api/competitors/scans", scan.id],
    enabled: expanded,
    // Poll while the list row or the detail itself still says active. The interval
    // stops only on a terminal DETAIL response, so the last fetch always carries
    // the final findings — the list can see completion a poll ahead of the detail,
    // which used to freeze partial results as if they were the finished set.
    refetchInterval: query => (isActive || ACTIVE_STATUSES.includes(query.state.data?.scan?.status) ? 1500 : false),
  });
  const { data, isLoading } = detailQuery;

  // The running→terminal moment: the server settles (or refunds) the scan and
  // the final findings replace the streamed partials. Fetch both explicitly —
  // invalidation alone leaves the interval's stale data in place if this row's
  // last detail poll answered while the scan was still running.
  const wasActiveRef = useRef(isActive);
  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans", scan.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      void detailQuery.refetch();
    }
    wasActiveRef.current = isActive;
  }, [isActive, scan.id]);

  // The server's order (best-rated first, most-reviewed among equals): shown as it comes.
  const listings: Listing[] = data?.listings || [];
  const detailError = detailQuery.isError && !data;

  const highRisk = listings.filter((l) => scoreOf(l) >= 60).length;
  const moderate = listings.filter((l) => scoreOf(l) >= 30 && scoreOf(l) < 60).length;
  const organic = listings.filter((l) => scoreOf(l) < 30).length;
  // The overview names the best-rated listings whose review profile carries no "More signals"
  // band — rating alone would crown keyword-stuffed listings the top picks.
  const topRated = topRatedPicks(listings);
  const ratedExcluded = listings.filter((l) => Number(l.rating) > 0 && scoreOf(l) >= 60).length;
  const rated = listings.map(ratingOf).filter((r): r is number => r != null);
  const avgRating = rated.length ? rated.reduce((n, r) => n + r, 0) / rated.length : null;
  const counts = listings.map((l) => l.reviewCount || 0);
  const totalReviews = counts.reduce((n, c) => n + c, 0);
  const sortedCounts = counts.slice().sort((a, b) => a - b);
  const medianReviews = sortedCounts.length ? sortedCounts[Math.floor(sortedCounts.length / 2)] : null;
  const mostReviewed = listings.reduce<Listing | null>((best, l) => ((l.reviewCount || 0) > (best?.reviewCount || 0) ? l : best), null);
  const status = STATUS[scan.status] ?? { label: scan.status, tone: "none" as Tone };
  const when = new Date(scan.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const title = `${scan.industry} — ${scan.location}`;

  return (
    <section className="tool-panel" data-testid={`card-scan-${scan.id}`}>
      <div className="tool-panel__head">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded text-[13px] font-semibold uppercase" style={{ color: "var(--tool-accent-ink)", background: "color-mix(in srgb, var(--tool-accent) 14%, transparent)" }} aria-hidden>{String(scan.industry || "?").trim()[0]}</span>
        <div className="min-w-0">
          <h2 className="tool-panel__title">
            <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`scan-detail-${scan.id}`} className="tool-link text-left" data-testid={`button-expand-scan-${scan.id}`}>
              {title}
            </button>
          </h2>
        </div>
        <span className="tool-muted text-[12px]">{scan.radius} mi · {when} · {isActive ? "indexing…" : `${scan.totalFound || 0} competitor${scan.totalFound === 1 ? "" : "s"}`}</span>
        <StatusBadge tone={status.tone} label={`Status: ${status.label}`} testId={`badge-scan-status-${scan.id}`}>{isActive && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}{status.label}</StatusBadge>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className="tool-btn" onClick={onToggle} aria-expanded={expanded} aria-controls={`scan-detail-${scan.id}`} data-testid={`button-open-scan-${scan.id}`}>
            {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />} {expanded ? "Close report" : "Open report"}
          </button>
          {!isActive && (
            <button type="button" className="tool-btn" onClick={onRetry} disabled={retrying} title="Runs the same trade, place and radius again — a new scan, counted this month" data-testid={`button-retry-scan-${scan.id}`}>
              <RefreshCw aria-hidden /> Re-run
            </button>
          )}
          {isActive && (
            <button type="button" className="tool-btn" onClick={() => setConfirmCancel(true)} disabled={cancelling} aria-label="Cancel scan" data-testid={`button-cancel-scan-${scan.id}`}>
              <XCircle aria-hidden /> Cancel
            </button>
          )}
          <button type="button" className="tool-btn" onClick={() => setConfirmDelete(true)} disabled={deleting} aria-label="Delete scan" data-testid={`button-delete-scan-${scan.id}`}>
            <Trash2 aria-hidden /> Delete
          </button>
        </div>
        {/* Full-width row under the title so a long provider error stays readable on phones. */}
        {scan.status === "failed" && (
          <p className="w-full text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid={`text-scan-error-${scan.id}`}>{scan.errorMessage || "Scan failed. Please try again."} Re-run starts it again.</p>
        )}
        {scan.status === "completed" && scan.errorMessage && (
          <p className="w-full tool-muted text-[12px]" data-testid={`text-scan-note-${scan.id}`}>{scan.errorMessage}</p>
        )}
      </div>

      {/* Outside the clickable header: dialog clicks bubble through the React tree. */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent data-testid={`dialog-cancel-scan-${scan.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              The {scan.industry} scan for {scan.location} stops where it is and any competitors already indexed stay on the card. A cancelled scan is not counted against your monthly limit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-dismiss-cancel-scan-${scan.id}`}>Keep scanning</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onCancel}
              data-testid={`button-confirm-cancel-scan-${scan.id}`}
            >
              Cancel scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid={`dialog-delete-scan-${scan.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the {scan.industry} scan for {scan.location} and its competitor data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-scan-${scan.id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
              data-testid={`button-confirm-delete-scan-${scan.id}`}
            >
              Delete scan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Collapsed: the key numbers from the list row. The strip opens the report, like the title. */}
      {!expanded && (
        <div role="button" tabIndex={-1} onClick={onToggle} className="cursor-pointer" aria-label={`Open the ${title} report`} data-testid={`strip-scan-${scan.id}`}>
          <MetricStrip cols={[2, 4, 4]}>
            <StatCell label="Competitors found" value={isActive ? null : String(scan.totalFound || 0)} none="Still indexing" />
            <StatCell label="Radius" value={`${scan.radius} mi`} note={`around ${scan.location}`} />
            <StatCell label="Scanned" value={when} note={fmtDate(scan.createdAt)} />
            <StatCell label="Status" value={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} />
          </MetricStrip>
        </div>
      )}

      {expanded && (
        <div id={`scan-detail-${scan.id}`}>
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {detailError && (
            <div className="tool-panel__body">
              <Notice tone="danger" title="Couldn't load this scan's findings" testId={`notice-scan-detail-error-${scan.id}`}
                action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void detailQuery.refetch()} data-testid={`button-retry-scan-detail-${scan.id}`}>Retry</Button>}>
                {apiErrorMessage(detailQuery.error, "The findings could not be loaded.")} Any findings shown above are from the last successful load.
              </Notice>
            </div>
          )}

          {isActive && (
            <div className="tool-panel__body space-y-2">
              <p className="text-sm text-muted-foreground">Indexing competitors and analyzing reviews...</p>
              {/* Indeterminate: the scan row reports no progress, so show activity, not a fake percentage. */}
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden" role="progressbar" aria-label="Scan in progress" aria-busy="true">
                <div className="h-full w-full rounded-full bg-primary/60 animate-pulse" />
              </div>
              {listings.length > 0 && (
                <p className="text-xs text-muted-foreground" data-testid={`text-scan-partial-${scan.id}`}>
                  Partial results — {listings.length} indexed so far. The scan is still running; the list updates as more come in.
                </p>
              )}
            </div>
          )}

          {listings.length > 0 && (
            <>
              {/* The market in numbers. */}
              <MetricStrip cols={[2, 3, 6]} testId={`metrics-scan-${scan.id}`}>
                <StatCell label="Competitors" value={String(listings.length)} testId={`metric-total-${scan.id}`} note={`within ${scan.radius} mi of ${scan.location}`} />
                <StatCell label="Average rating" value={avgRating == null ? null : avgRating.toFixed(1)} none="No rated listing" testId={`metric-avg-rating-${scan.id}`} note={rated.length ? `${rated.length} of ${listings.length} rated` : undefined} />
                <StatCell label="Reviews in market" value={formatCount(totalReviews)} testId={`metric-reviews-${scan.id}`}
                  note={mostReviewed && (mostReviewed.reviewCount || 0) > 0 ? `median ${medianReviews} · most: ${mostReviewed.businessName} (${formatCount(mostReviewed.reviewCount || 0)})` : "no reviews counted"} />
                <StatCell label="Few signals" value={String(organic)} testId={`metric-few-${scan.id}`} note="nothing unusual in the sample" />
                <StatCell label="Some signals" value={String(moderate)} testId={`metric-some-${scan.id}`} note="worth a look" />
                <StatCell label="More signals" value={String(highRisk)} testId={`metric-more-${scan.id}`} note="read the reasons" />
              </MetricStrip>

              <div className="tool-panel__body space-y-5">
                {/* Leaders: the best-rated listings whose review sample stays clear of the "More signals" band. */}
                {topRated.length > 0 && (
                  <div className="space-y-3" data-testid={`leaders-scan-${scan.id}`}>
                    <GoogleAiOverview label="Market overview" testId={`text-scan-overview-${scan.id}`}
                      footnote={`Built from the ${listings.length} listings this scan indexed on ${fmtDate(scan.createdAt)} — ratings and counts as Google showed them then.${ratedExcluded > 0 ? ` Highly rated listings showing more review signals are not named as top picks.` : ""}`}>
                      <p>
                        Top-rated {scan.industry.toLowerCase()} options near {scan.location} include{" "}
                        {topRated.map((l: any, i: number) => (
                          <span key={l.id || i}>
                            {i > 0 && (i === topRated.length - 1 ? ", and " : ", ")}
                            <AiEntity>{l.businessName}</AiEntity> with a <b>{Number(l.rating).toFixed(1)}/5</b> rating
                            {l.reviewCount ? <> across <b>{l.reviewCount} review{l.reviewCount === 1 ? "" : "s"}</b></> : null}
                          </span>
                        ))}.
                        {" "}Of the <b>{listings.length}</b> businesses indexed, <b>{organic}</b> show few review signals worth a closer look, <b>{moderate}</b> some, and <b>{highRisk}</b> more.
                      </p>
                    </GoogleAiOverview>
                    <div className="g-tiles !grid-cols-1 sm:!grid-cols-3">
                      {topRated.map((l, i) => (
                        <div key={l.id || i} className="g-tile" data-testid={`leader-${scan.id}-${i + 1}`}>
                          <p className="g-tile__label flex items-center gap-1"><Trophy className="h-3.5 w-3.5" aria-hidden /> Leader #{i + 1}</p>
                          <p className="mt-1 text-[15px] font-medium leading-5 g-text [overflow-wrap:anywhere]">{l.businessName}</p>
                          <p className="g-tile__value !text-[20px] !leading-7 flex items-center gap-1.5">
                            {Number(l.rating).toFixed(1)} <Star className="g-star h-4 w-4 fill-current" aria-hidden />
                            <span className="text-[14px] g-text-2">({formatCount(l.reviewCount || 0)} review{l.reviewCount === 1 ? "" : "s"})</span>
                          </p>
                          <p className="g-tile__hint">{signalLine(l)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* The distribution: where the market sits on rating and on review count. */}
                <MetricStrip cols={[1, 2, 2]} boxed testId={`distribution-scan-${scan.id}`}>
                  <Distribution title="Ratings across the market" testId={`dist-ratings-${scan.id}`}
                    parts={RATING_BANDS.map(([label, test, color]) => ({ label, color, value: listings.filter((l) => test(ratingOf(l))).length }))} />
                  <Distribution title="Review counts across the market" testId={`dist-reviews-${scan.id}`}
                    parts={REVIEW_BANDS.map(([label, test, color]) => ({ label, color, value: listings.filter((l) => test(l.reviewCount || 0)).length }))} />
                </MetricStrip>

                {/* Every listing, best-rated first (the server's order). */}
                <div>
                  <GoogleSectionHeader title="All competitors" count={listings.length} flush
                    description="Best-rated first, most-reviewed among equals. Review signals are things to look at in the sampled reviews — not proof of anything." />
                  <div data-testid={`list-competitors-${scan.id}`}>
                    {listings.slice(0, shown).map((listing, idx) => {
                      const band = bandOf(scoreOf(listing));
                      const isExpanded = expandedListing === (listing.id || idx);
                      const website = listing.website && /^https?:\/\//i.test(listing.website) ? listing.website : listing.website ? `https://${listing.website}` : null;
                      const reasons = (listing.bsReasons ?? []).filter(Boolean);
                      return (
                        <GoogleLocalCard
                          key={listing.id || idx}
                          testId={`card-competitor-${listing.id}`}
                          name={<><span className="tool-muted tabular-nums">#{idx + 1}</span> {listing.businessName}</>}
                          rating={listing.rating}
                          reviewCount={listing.reviewCount}
                          category={listing.category}
                          open={null}
                          address={listing.address}
                          badges={<>
                            {listing.isNew && <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] px-1.5">NEW</Badge>}
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${band.badge}`}>{band.label}</Badge>
                            {listing.reviewAnalysis?.reviewsLookingAi > 0 && (
                              <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] px-1.5">
                                {commonPhrasesBadge(listing.reviewAnalysis.reviewsLookingAi)}
                              </Badge>
                            )}
                          </>}
                          actions={<>
                            {listing.phone && <GooglePill icon={Phone} label="Call" href={`tel:${String(listing.phone).replace(/[^\d+]/g, "")}`} />}
                            {listing.address && <GooglePill icon={MapPin} label="Directions" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${listing.businessName} ${listing.address}`)}${listing.placeId ? `&query_place_id=${encodeURIComponent(listing.placeId)}` : ""}`} external />}
                            {website && <GooglePill icon={Globe} label="Website" href={website} external />}
                            <GooglePill
                              icon={Eye}
                              label={isExpanded ? "Hide review analysis" : "Review analysis"}
                              onClick={() => setExpandedListing(isExpanded ? null : (listing.id || idx))}
                              testId={`button-review-analysis-${listing.id}`}
                            />
                          </>}
                        >
                          {/* The signals in one line; the full list of reasons once the analysis is open. */}
                          <p className="g-card__meta mt-1.5 flex items-start gap-1.5" data-testid={`text-signals-${listing.id}`}>
                            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: band.color }} aria-hidden />
                            <span>{signalLine(listing)}</span>
                          </p>
                          {isExpanded && reasons.length > 1 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {reasons.map((reason, ri) => (
                                <li key={ri} className="text-xs flex items-start gap-1.5">
                                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: band.color }} aria-hidden />
                                  <span className="text-muted-foreground">{reason}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {isExpanded && <ReviewAnalysisPanel analysis={listing.reviewAnalysis} />}
                        </GoogleLocalCard>
                      );
                    })}
                  </div>
                  {shown < listings.length && (
                    <div className="pt-3">
                      <GoogleMoreButton label={`More businesses (${listings.length - shown} more)`} onClick={() => setShown((n) => n + PACK_SIZE)} testId={`button-more-competitors-${scan.id}`} />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {!isLoading && scan.status === "completed" && listings.length === 0 && (
            <p className="tool-panel__body text-center text-muted-foreground">No competitors found in this scan.</p>
          )}

          {!isLoading && scan.status === "cancelled" && listings.length === 0 && (
            <p className="tool-panel__body text-center text-muted-foreground" data-testid={`text-scan-cancelled-${scan.id}`}>This scan was cancelled before it indexed any competitors.</p>
          )}

          {!isLoading && scan.status === "failed" && listings.length === 0 && !detailError && (
            <p className="tool-panel__body text-center text-muted-foreground" data-testid={`text-scan-failed-${scan.id}`}>This scan did not index any competitors. Re-run it from the buttons above.</p>
          )}
        </div>
      )}
    </section>
  );
}
