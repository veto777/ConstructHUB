import { AppPage, PageHeader, Section, StatGrid, Stat, AppTabsList, Toolbar, Notice } from "@/components/app-ui";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import {
  Search, Loader2, Trash2, AlertTriangle, Shield, TrendingUp,
  Star, MapPin, Globe, Phone, ChevronDown, ChevronUp, Lock,
  Eye, BarChart3, RefreshCw, Users, Bot,
  ThumbsUp, ThumbsDown, Camera, UserCheck, UserX, Clock,
  MessageSquare, Ban, CheckCircle2, XCircle,
} from "lucide-react";
import { PLANS, PLAN_KEYS, type PlanKey } from "@shared/plans";
import { COMPETITOR_INTEL_PLANS } from "@shared/plan-copy";
import { AppLocked } from "@/components/app-locked";
import { inNativeApp } from "@/lib/app-shell";
import { GoogleSurface, GoogleLocalCard, GooglePill, GoogleMoreButton, GoogleAiOverview, AiEntity } from "@/components/google";
import { usageLine, type EntitlementsInfo } from "@/lib/pricing-display";
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

function getBsColor(score: number) {
  if (score >= 60) return "text-red-500";
  if (score >= 30) return "text-muted-foreground";
  return "text-green-500";
}

function getBsBadge(score: number) {
  if (score >= 60) return { label: "More signals", variant: "destructive" as const, color: "bg-red-500/10 text-red-500 border-red-500/20" };
  if (score >= 30) return { label: "Some signals", variant: "outline" as const, color: "bg-muted text-muted-foreground border-border" };
  return { label: "Few signals", variant: "outline" as const, color: "bg-green-500/10 text-green-500 border-green-500/20" };
}

function BsMeter({ score }: { score: number }) {
  const color = score >= 60 ? "bg-red-500" : score >= 30 ? "bg-muted" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">BS Meter: signals worth a closer look</span>
        <span className={`font-bold ${getBsColor(score)}`}>{score}/100</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function CompetitorsPage() {
  const { toast } = useToast();
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [radius, setRadius] = useState("25");
  const [expandedScan, setExpandedScan] = useState<number | null>(null);

  // No client-side plan check: the scans list answers 402 plan_required when
  // the account's plan does not include Competitor Intel.
  const scansQuery = useQuery<any[]>({
    queryKey: ["/api/competitors/scans"],
    refetchInterval: query => query.state.data?.some(scan => scan.status === "running") ? 1500 : false,
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

  const scanMutation = useMutation({
    mutationFn: async (params: { industry: string; location: string; radius: number }) => {
      const res = await apiRequest("POST", "/api/competitors/scans", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans"] });
      toast({ title: "Scan started", description: "Indexing competitors in your market. This may take a moment." });
    },
    onError: (err: Error) => {
      toast({ title: "Scan failed", description: apiErrorMessage(err, "The scan could not be started. Please try again."), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scanId: number) => {
      const res = await apiRequest("DELETE", `/api/competitors/scans/${scanId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors/scans"] });
      toast({ title: "Scan deleted" });
      titleRef.current?.focus({ preventScroll: true });
    },
    onError: (err: Error) => {
      toast({ title: "Could not delete scan", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const handleScan = () => {
    if (!industry) { toast({ title: "Select an industry", variant: "destructive" }); return; }
    if (!location.trim()) { toast({ title: "Enter a location", variant: "destructive" }); return; }
    scanMutation.mutate({ industry, location: location.trim(), radius: parseInt(radius) });
  };

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
        <GoogleSurface page><AppPage width="narrow" className="before:hidden">
          <PageHeader title={<span data-testid="text-locked-title">Competitor intelligence</span>} description="Compare businesses and review signals in your local market." />
          <AppLocked name="Competitor Intel" testId="text-plan-required" />
        </AppPage></GoogleSurface>
      );
    }
    const requiredName = planRequired.requiredPlan ? PLANS[planRequired.requiredPlan].name : null;
    return (
      <GoogleSurface page><AppPage width="narrow" className="before:hidden">
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

  // Google look (owner, 2026-10-06): the page sits on a GoogleSurface; scan results are a local pack.
  return (
    <GoogleSurface page><AppPage className="before:hidden">
      <PageHeader title={<span ref={titleRef} tabIndex={-1} data-testid="text-competitors-title">Competitor intelligence</span>} description="Find competitors and compare their rankings and reviews." />
        <Tabs defaultValue="market-scan" className="space-y-6">
          <AppTabsList>
            <TabsTrigger value="market-scan" className="flex items-center gap-1.5" data-testid="tab-market-scan">
              <Search className="w-4 h-4" />
              Market scan
            </TabsTrigger>
          </AppTabsList>

          <TabsContent value="market-scan" className="space-y-6">
            <Section title="New market scan" testId="card-new-scan">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="industry">Industry</Label>
                    <Select value={industry} onValueChange={setIndustry}>
                      <SelectTrigger id="industry" data-testid="select-industry">
                        <SelectValue placeholder="Select industry" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map(ind => (
                          <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      placeholder="e.g. Tampa, FL"
                      value={location}
                      onChange={e => setLocation(e.target.value)}
                      data-testid="input-location"
                    />
                  </div>
                  <details className="space-y-2"><summary className="cursor-pointer py-2 text-sm font-medium">Advanced · Search radius</summary>
                  <div className="space-y-1.5">
                    <Label htmlFor="radius">Radius (miles)</Label>
                    <Select value={radius} onValueChange={setRadius}>
                      <SelectTrigger id="radius" data-testid="select-radius">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 miles</SelectItem>
                        <SelectItem value="25">25 miles</SelectItem>
                        <SelectItem value="50">50 miles</SelectItem>
                        <SelectItem value="100">100 miles</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  </details>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={handleScan}
                      disabled={scanMutation.isPending}
                      data-testid="button-start-scan"
                    >
                      {scanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                      Scan market
                    </Button>
                  </div>
                </div>
                {scansUsage && (
                  <p className="text-xs text-muted-foreground" data-testid="text-scan-usage">
                    {scansUsage} this month
                  </p>
                )}
            </Section>

            {scansLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* A failed list request is not an empty account: say so and retry, keeping any
                previously loaded scans on screen (react-query keeps the last good data). */}
            {!planRequired && scansError && !scansLoading && (
              <Notice tone="danger" title="Couldn't load your scans" testId="notice-scans-error"
                action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void scansQuery.refetch()} data-testid="button-retry-scans">Retry</Button>}>
                {apiErrorMessage(scansError, "The scan list could not be loaded.")}
              </Notice>
            )}

            {scans && scans.length === 0 && !scansLoading && (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>No market scans yet. Start your first scan above to index competitors.</p>
              </div>
            )}

            {scans && scans.map((scan: any) => (
              <ScanCard
                key={scan.id}
                scan={scan}
                expanded={expandedScan === scan.id}
                onToggle={() => setExpandedScan(expandedScan === scan.id ? null : scan.id)}
                onDelete={() => deleteMutation.mutate(scan.id)}
                deleting={deleteMutation.isPending}
                onRetry={() => scanMutation.mutate({ industry: scan.industry, location: scan.location, radius: scan.radius })}
                retrying={scanMutation.isPending}
              />
            ))}
          </TabsContent>
        </Tabs>
    </AppPage></GoogleSurface>
  );
}

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
  const aiPct = Math.round((analysis.reviewsLookingAi / total) * 100);
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
            <Bot className="w-3 h-3 text-muted-foreground" />
            <span className="text-sm font-bold text-muted-foreground">{analysis.reviewsLookingAi}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Common phrases ({aiPct}%)</p>
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
            <Bot className="w-3 h-3" /> Repeated common phrases
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

function ScanCard({ scan, expanded, onToggle, onDelete, deleting, onRetry, retrying }: {
  scan: any;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Google's local pack shows a few entries and a "More businesses" button; each press reveals the next batch.
  const PACK_SIZE = 5;
  const [shown, setShown] = useState(PACK_SIZE);
  const isRunning = scan.status === "running";
  const detailQuery = useQuery<{ scan: any; listings: any[] }>({
    queryKey: ["/api/competitors/scans", scan.id],
    enabled: expanded,
    // While the scan runs, keep the expanded findings in step with it; the final poll
    // lands after completion, so results never freeze at a stale partial set.
    refetchInterval: isRunning ? 1500 : false,
  });
  const { data, isLoading } = detailQuery;

  const listings = data?.listings || [];
  const detailError = detailQuery.isError && !data;

  const highRisk = listings.filter((l: any) => (l.bsScore || 0) >= 60).length;
  const moderate = listings.filter((l: any) => (l.bsScore || 0) >= 30 && (l.bsScore || 0) < 60).length;
  const organic = listings.filter((l: any) => (l.bsScore || 0) < 30).length;
  // The overview names the best-rated listings whose review profile carries no "More signals"
  // band — rating alone would crown keyword-stuffed listings the top picks.
  const topRated = topRatedPicks(listings);
  const ratedExcluded = listings.filter((l: any) => Number(l.rating) > 0 && (l.bsScore || 0) >= 60).length;

  return (
    <Section flush testId={`card-scan-${scan.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={`scan-detail-${scan.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`button-expand-scan-${scan.id}`}
          >
            <div className="w-10 h-10 rounded-lg bg-muted hidden sm:flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">{scan.industry} — {scan.location}</CardTitle>
              <CardDescription className="text-xs">
                {scan.radius} mile radius • {new Date(scan.createdAt).toLocaleDateString()} • {scan.totalFound || 0} competitors found
              </CardDescription>
            </div>
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {isRunning && (
              <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                Scanning...
              </Badge>
            )}
            {scan.status === "completed" && (
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                Completed
              </Badge>
            )}
            {scan.status === "failed" && (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">
                Failed
              </Badge>
            )}
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} disabled={deleting} aria-label="Delete scan" data-testid={`button-delete-scan-${scan.id}`}>
              <Trash2 className="w-4 h-4" />
            </Button>
            {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          </div>
        </div>
        {/* Full-width row under the title so a long provider error stays readable on phones. */}
        {scan.status === "failed" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
            <span className="text-sm text-destructive" role="alert" data-testid={`text-scan-error-${scan.id}`}>{scan.errorMessage || "Scan failed. Please try again."}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onRetry}
              disabled={retrying}
              data-testid={`button-retry-scan-${scan.id}`}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Run this scan again
            </Button>
          </div>
        )}
        {scan.status === "completed" && scan.errorMessage && (
          <p className="text-xs text-muted-foreground pt-2" data-testid={`text-scan-note-${scan.id}`}>{scan.errorMessage}</p>
        )}
      </CardHeader>

      {/* Outside the clickable header: dialog clicks bubble through the React tree. */}
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

      {expanded && (
        <CardContent className="space-y-4" id={`scan-detail-${scan.id}`}>
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {detailError && (
            <Notice tone="danger" title="Couldn't load this scan's findings" testId={`notice-scan-detail-error-${scan.id}`}
              action={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void detailQuery.refetch()} data-testid={`button-retry-scan-detail-${scan.id}`}>Retry</Button>}>
              {apiErrorMessage(detailQuery.error, "The findings could not be loaded.")} Any findings shown above are from the last successful load.
            </Notice>
          )}

          {isRunning && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Indexing competitors and analyzing reviews...</p>
              {/* Indeterminate: the scan row reports no progress, so show activity, not a fake percentage. */}
              <div className="h-2 w-full rounded-full bg-secondary overflow-hidden" role="progressbar" aria-label="Scan in progress" aria-busy="true">
                <div className="h-full w-full rounded-full bg-primary/60 animate-pulse" />
              </div>
            </div>
          )}

          {isRunning && listings.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid={`text-scan-partial-${scan.id}`}>
              Partial results — {listings.length} indexed so far. The scan is still running; the list updates as more come in.
            </p>
          )}

          {listings.length > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-border/50 text-center">
                  <p className="text-2xl font-bold">{listings.length}</p>
                  <p className="text-xs text-muted-foreground">Total Competitors</p>
                </div>
                <div className="p-3 rounded-lg border border-green-500/20 text-center">
                  <p className="text-2xl font-bold text-green-500">{organic}</p>
                  <p className="text-xs text-muted-foreground">Few signals</p>
                </div>
                <div className="p-3 rounded-lg border border-border text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{moderate}</p>
                  <p className="text-xs text-muted-foreground">Some signals</p>
                </div>
                <div className="p-3 rounded-lg border border-red-500/20 text-center">
                  <p className="text-2xl font-bold text-red-500">{highRisk}</p>
                  <p className="text-xs text-muted-foreground">More signals</p>
                </div>
              </div>

              {topRated.length > 0 && (
                <GoogleAiOverview label="Overview" testId={`text-scan-overview-${scan.id}`}
                  footnote={`Built from the ${listings.length} listings this scan indexed on ${new Date(scan.createdAt).toLocaleDateString()} — ratings and counts as Google showed them then.${ratedExcluded > 0 ? ` Highly rated listings showing more review signals are not named as top picks.` : ""}`}>
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
              )}

              <div className="space-y-0">
                <h3 className="text-sm font-medium g-text-2">All competitors</h3>
                <div data-testid={`list-competitors-${scan.id}`}>
                  {listings.slice(0, shown).map((listing: any, idx: number) => {
                    const bsBadge = getBsBadge(listing.bsScore || 0);
                    const isExpanded = expandedListing === (listing.id || idx);
                    const website = listing.website && /^https?:\/\//i.test(listing.website) ? listing.website : listing.website ? `https://${listing.website}` : null;
                    return (
                      <GoogleLocalCard
                        key={listing.id || idx}
                        testId={`card-competitor-${listing.id}`}
                        name={listing.businessName}
                        rating={listing.rating}
                        reviewCount={listing.reviewCount}
                        category={listing.category}
                        open={null}
                        address={listing.address}
                        badges={<>
                          {listing.isNew && <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] px-1.5">NEW</Badge>}
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${bsBadge.color}`}>{bsBadge.label}</Badge>
                          {listing.reviewAnalysis?.reviewsLookingAi > 0 && (
                            <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] px-1.5">
                              <Bot className="w-2.5 h-2.5 mr-0.5" />{listing.reviewAnalysis.reviewsLookingAi} AI
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
                        {listing.bsReasons && (listing.bsReasons as string[]).length > 0 && (listing.bsScore || 0) > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {(listing.bsReasons as string[]).slice(0, isExpanded ? 20 : 3).map((reason: string, ri: number) => (
                              <p key={ri} className="text-xs flex items-start gap-1.5">
                                <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${getBsColor(listing.bsScore || 0)}`} />
                                <span className="text-muted-foreground">{reason}</span>
                              </p>
                            ))}
                            {!isExpanded && (listing.bsReasons as string[]).length > 3 && (
                              <p className="text-xs text-muted-foreground/60">+ {(listing.bsReasons as string[]).length - 3} more flags</p>
                            )}
                          </div>
                        )}
                        <div className="mt-2 max-w-xs"><BsMeter score={listing.bsScore || 0} /></div>
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
            </>
          )}

          {!isLoading && scan.status === "completed" && listings.length === 0 && (
            <p className="text-center text-muted-foreground py-4">No competitors found in this scan.</p>
          )}
        </CardContent>
      )}
    </Section>
  );
}
