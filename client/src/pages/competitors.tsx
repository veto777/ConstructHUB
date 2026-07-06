import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Search, Loader2, Trash2, AlertTriangle, Shield, TrendingUp,
  Star, MapPin, Globe, Phone, ChevronDown, ChevronUp, Lock,
  Eye, BarChart3, ExternalLink, RefreshCw, Users, Bot,
  ThumbsUp, ThumbsDown, Camera, UserCheck, UserX, Clock,
  MessageSquare, Ban, CheckCircle2, XCircle, Megaphone,
  Plus, Smartphone, Monitor, Flag, Crosshair
} from "lucide-react";

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
  if (score >= 30) return "text-yellow-500";
  return "text-green-500";
}

function getBsBadge(score: number) {
  if (score >= 60) return { label: "High Risk", variant: "destructive" as const, color: "bg-red-500/10 text-red-500 border-red-500/20" };
  if (score >= 30) return { label: "Moderate", variant: "outline" as const, color: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" };
  return { label: "Organic", variant: "outline" as const, color: "bg-green-500/10 text-green-500 border-green-500/20" };
}

function BsMeter({ score }: { score: number }) {
  const color = score >= 60 ? "bg-red-500" : score >= 30 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">BS Meter</span>
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

  const { data: subscription } = useQuery<{ plan: string; status: string }>({
    queryKey: ["/api/stripe/subscription"],
  });

  const isPlatinum = subscription?.plan === "platinum" && (subscription?.status === "active" || subscription?.status === "trialing");
  const isDev = import.meta.env.DEV;

  const { data: scans, isLoading: scansLoading } = useQuery<any[]>({
    queryKey: ["/api/competitors/scans"],
    enabled: isPlatinum || isDev,
  });

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
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
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
    },
  });

  const handleScan = () => {
    if (!industry) { toast({ title: "Select an industry", variant: "destructive" }); return; }
    if (!location) { toast({ title: "Enter a location", variant: "destructive" }); return; }
    scanMutation.mutate({ industry, location, radius: parseInt(radius) });
  };

  if (!isPlatinum && !isDev) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto">
            <Lock className="w-10 h-10 text-yellow-500" />
          </div>
          <h1 className="text-3xl font-extrabold" data-testid="text-locked-title">Competitor Intelligence</h1>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">
            Index every competitor in your market, track their rankings, and see who's playing fair with our BS Meter.
          </p>
          <p className="text-muted-foreground">
            This feature is exclusively available for <span className="text-yellow-500 font-bold">Platinum</span> members.
          </p>
          <Button
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-8"
            onClick={() => window.location.href = "/pricing"}
            data-testid="button-upgrade-platinum"
          >
            <Shield className="w-4 h-4 mr-2" />
            Upgrade to Platinum — $995/mo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-competitors-title">
            <Eye className="w-6 h-6 text-yellow-500" />
            Competitor Intelligence
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316] mt-1" />
          <p className="text-muted-foreground text-sm max-w-lg">
            Know exactly who you're competing against. Index every competitor in your market, track their rankings and reviews, and spy on their Google Ads.
          </p>
        </div>

        <Tabs defaultValue="market-scan" className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="market-scan" className="flex items-center gap-1.5" data-testid="tab-market-scan">
              <Search className="w-4 h-4" />
              Market Scan
            </TabsTrigger>
            <TabsTrigger value="ad-spy" className="flex items-center gap-1.5" data-testid="tab-ad-spy">
              <Megaphone className="w-4 h-4" />
              Ad Spy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="market-scan" className="space-y-6">
            <Card data-testid="card-new-scan">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="w-5 h-5" />
                  New Market Scan
                </CardTitle>
                <CardDescription>Find and analyze all competitors in a specific industry and location.</CardDescription>
              </CardHeader>
              <CardContent>
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
                  <div className="flex items-end">
                    <Button
                      className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-semibold"
                      onClick={handleScan}
                      disabled={scanMutation.isPending}
                      data-testid="button-start-scan"
                    >
                      {scanMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                      Scan Market
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {scansLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
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
              />
            ))}
          </TabsContent>

          <TabsContent value="ad-spy" className="space-y-6">
            <AdSpyTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AdSpyTab() {
  const { toast } = useToast();
  const [newKeyword, setNewKeyword] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newDevice, setNewDevice] = useState("mobile");
  const [expandedKeyword, setExpandedKeyword] = useState<number | null>(null);

  const { data: keywords, isLoading } = useQuery<any[]>({
    queryKey: ["/api/ad-spy/keywords"],
  });

  const addMutation = useMutation({
    mutationFn: async (params: { keyword: string; location: string; device: string }) => {
      const res = await apiRequest("POST", "/api/ad-spy/keywords", params);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-spy/keywords"] });
      setNewKeyword("");
      setNewLocation("");
      toast({ title: "Keyword added", description: "Scanning for advertisers now..." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add keyword", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/ad-spy/keywords/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-spy/keywords"] });
      toast({ title: "Keyword removed" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/ad-spy/keywords/${id}/refresh`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ad-spy/keywords"] });
      toast({ title: "Scan refreshed", description: "Advertiser data updated." });
    },
  });

  const handleAdd = () => {
    if (!newKeyword.trim()) { toast({ title: "Enter a keyword", variant: "destructive" }); return; }
    if (!newLocation.trim()) { toast({ title: "Enter a location", variant: "destructive" }); return; }
    addMutation.mutate({ keyword: newKeyword, location: newLocation, device: newDevice });
  };

  const keywordCount = keywords?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-orange-500" />
            AdSpy
          </h2>
          <p className="text-sm text-muted-foreground">Track who's advertising on Google for your target keywords.</p>
        </div>
        <Badge variant="outline" className="text-xs" data-testid="text-keyword-count">
          {keywordCount}/10 keywords used
        </Badge>
      </div>

      <Card data-testid="card-add-keyword">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <Label htmlFor="spy-keyword">Keyword</Label>
              <Input
                id="spy-keyword"
                placeholder="e.g. roofers, siding, plumber"
                value={newKeyword}
                onChange={e => setNewKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                data-testid="input-spy-keyword"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="spy-location">Location</Label>
              <Input
                id="spy-location"
                placeholder="e.g. Bellingham"
                value={newLocation}
                onChange={e => setNewLocation(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                data-testid="input-spy-location"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="spy-device">Device</Label>
              <Select value={newDevice} onValueChange={setNewDevice}>
                <SelectTrigger id="spy-device" data-testid="select-spy-device">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile">Mobile</SelectItem>
                  <SelectItem value="desktop">Desktop</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                onClick={handleAdd}
                disabled={addMutation.isPending || keywordCount >= 10}
                data-testid="button-add-keyword"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Add Keyword
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {keywords && keywords.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <Megaphone className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No keywords tracked yet. Add a keyword above to start spying on competitor ads.</p>
        </div>
      )}

      {keywords && keywords.length > 0 && (
        <Card>
          <CardContent className="pt-6 p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground">KEYWORD</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground">LOCATION</th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground">DEVICE</th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground">
                      <span className="flex items-center justify-center gap-1">1 DAY</span>
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground">
                      <span className="flex items-center justify-center gap-1">7 DAY</span>
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground">
                      <span className="flex items-center justify-center gap-1">30 DAY</span>
                    </th>
                    <th className="text-center py-3 px-4 font-semibold text-muted-foreground">30 DAY ADVERTISERS</th>
                    <th className="text-right py-3 px-4 font-semibold text-muted-foreground">ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((kw: any) => (
                    <AdSpyKeywordRow
                      key={kw.id}
                      keyword={kw}
                      expanded={expandedKeyword === kw.id}
                      onToggle={() => setExpandedKeyword(expandedKeyword === kw.id ? null : kw.id)}
                      onDelete={() => deleteMutation.mutate(kw.id)}
                      onRefresh={() => refreshMutation.mutate(kw.id)}
                      deleting={deleteMutation.isPending}
                      refreshing={refreshMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AdSpyKeywordRow({ keyword, expanded, onToggle, onDelete, onRefresh, deleting, refreshing }: {
  keyword: any;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  deleting: boolean;
  refreshing: boolean;
}) {
  const { data: advertisers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/ad-spy/keywords", keyword.id, "advertisers"],
    enabled: expanded,
  });

  return (
    <>
      <tr className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-keyword-${keyword.id}`}>
        <td className="py-3 px-4 font-medium">{keyword.keyword}</td>
        <td className="py-3 px-4">
          <span className="flex items-center gap-1.5">
            <Flag className="w-3 h-3 text-muted-foreground" />
            {keyword.location}
          </span>
        </td>
        <td className="py-3 px-4 text-center">
          <span className="flex items-center justify-center gap-1 text-muted-foreground">
            {keyword.device === "mobile" ? <Smartphone className="w-3.5 h-3.5" /> : <Monitor className="w-3.5 h-3.5" />}
            {keyword.device === "mobile" ? "Mobile" : "Desktop"}
          </span>
        </td>
        <td className="py-3 px-4 text-center font-medium">{keyword.advertisers1Day || "—"}</td>
        <td className="py-3 px-4 text-center font-medium">{keyword.advertisers7Day || "—"}</td>
        <td className="py-3 px-4 text-center font-medium">{keyword.advertisers30Day || "—"}</td>
        <td className="py-3 px-4 text-center">
          <span className="font-bold text-orange-500">{keyword.totalAdvertisers || 0}</span>
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
              onClick={onToggle}
              data-testid={`button-detailed-view-${keyword.id}`}
            >
              {expanded ? "Hide" : "Detailed View"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRefresh}
              disabled={refreshing}
              data-testid={`button-refresh-keyword-${keyword.id}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
              onClick={onDelete}
              disabled={deleting}
              data-testid={`button-delete-keyword-${keyword.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="bg-muted/20 border-b p-4 space-y-3">
              {isLoading && (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {advertisers && advertisers.length === 0 && !isLoading && (
                <p className="text-sm text-muted-foreground text-center py-4">No advertisers found for this keyword yet.</p>
              )}
              {advertisers && advertisers.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {advertisers.length} Advertisers Found
                  </p>
                  <div className="grid gap-2">
                    {advertisers.map((adv: any, idx: number) => (
                      <div key={idx} className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border/50 bg-background" data-testid={`card-advertiser-${idx}`}>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{adv.advertiserName}</p>
                            {adv.advertiserDomain && (
                              <Badge variant="outline" className="text-[10px] px-1.5">
                                <Globe className="w-2.5 h-2.5 mr-0.5" />
                                {adv.advertiserDomain}
                              </Badge>
                            )}
                          </div>
                          {adv.ads && adv.ads.length > 0 && (
                            <div className="space-y-1.5 mt-2">
                              {adv.ads.slice(0, 2).map((ad: any, ai: number) => (
                                <div key={ai} className="pl-3 border-l-2 border-orange-500/30 text-xs space-y-0.5">
                                  {ad.headline && <p className="text-blue-500 font-medium">{ad.headline}</p>}
                                  {ad.displayUrl && (
                                    <p className="text-green-600 dark:text-green-400 text-[11px]">{ad.displayUrl}</p>
                                  )}
                                  {ad.description && <p className="text-muted-foreground">{ad.description}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Seen <span className="font-semibold text-foreground">{adv.totalAppearances}x</span>
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            First: {new Date(adv.firstSeen).toLocaleDateString()}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Last: {new Date(adv.lastSeen).toLocaleDateString()}
                          </p>
                          {adv.advertiserDomain && (
                            <a
                              href={`https://${adv.advertiserDomain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-blue-500 hover:underline mt-1"
                            >
                              <ExternalLink className="w-2.5 h-2.5" /> Visit
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
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
        <Eye className="w-3.5 h-3.5 text-yellow-500" /> Review Deep Analysis ({total} reviews sampled)
      </p>

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
        <div className="p-2 rounded border border-purple-500/20 bg-purple-500/5 text-center">
          <div className="flex items-center justify-center gap-1">
            <Bot className="w-3 h-3 text-purple-500" />
            <span className="text-sm font-bold text-purple-500">{analysis.reviewsLookingAi}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">AI-Looking ({aiPct}%)</p>
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
          <Camera className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="text-muted-foreground">Photos: <strong className="text-foreground">{photoPct}%</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-muted-foreground">Real Names: <strong className="text-foreground">{realNamePct}%</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <UserX className="w-3 h-3 text-red-400 shrink-0" />
          <span className="text-muted-foreground">Blocked: <strong className="text-foreground">{analysis.blockedProfiles}</strong></span>
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded border border-border/30">
          <Clock className="w-3 h-3 text-orange-400 shrink-0" />
          <span className="text-muted-foreground">Oldest: <strong className="text-foreground">{analysis.oldestReviewAge || "N/A"}</strong></span>
        </div>
      </div>

      {analysis.reviewVelocityFlag && analysis.reviewVelocityNote && (
        <div className="p-2 rounded border border-red-500/30 bg-red-500/5">
          <p className="text-xs flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
            <span className="text-red-600 dark:text-red-400">{analysis.reviewVelocityNote}</span>
          </p>
        </div>
      )}

      {analysis.aiSuspectReviews && analysis.aiSuspectReviews.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-purple-500 uppercase tracking-wide flex items-center gap-1">
            <Bot className="w-3 h-3" /> AI-Suspected Reviews
          </p>
          {analysis.aiSuspectReviews.map((r: any, i: number) => (
            <div key={i} className="p-2 rounded border border-purple-500/10 bg-purple-500/5 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{r.author}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: r.rating }).map((_, j) => (
                    <Star key={j} className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400" />
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
          <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide flex items-center gap-1">
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

function ScanCard({ scan, expanded, onToggle, onDelete, deleting }: {
  scan: any;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ scan: any; listings: any[] }>({
    queryKey: ["/api/competitors/scans", scan.id],
    enabled: expanded,
  });

  const listings = data?.listings || [];
  const isRunning = scan.status === "running";

  const highRisk = listings.filter((l: any) => (l.bsScore || 0) >= 60).length;
  const moderate = listings.filter((l: any) => (l.bsScore || 0) >= 30 && (l.bsScore || 0) < 60).length;
  const organic = listings.filter((l: any) => (l.bsScore || 0) < 30).length;

  return (
    <Card data-testid={`card-scan-${scan.id}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <CardTitle className="text-base">{scan.industry} — {scan.location}</CardTitle>
              <CardDescription className="text-xs">
                {scan.radius} mile radius • {new Date(scan.createdAt).toLocaleDateString()} • {scan.totalFound || 0} competitors found
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isRunning && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
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
              <Badge variant="destructive">Failed</Badge>
            )}
            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); onDelete(); }} disabled={deleting} data-testid={`button-delete-scan-${scan.id}`}>
              <Trash2 className="w-4 h-4" />
            </Button>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {isRunning && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Indexing competitors and analyzing reviews...</p>
              <Progress value={30} className="h-2" />
            </div>
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
                  <p className="text-xs text-muted-foreground">Organic</p>
                </div>
                <div className="p-3 rounded-lg border border-yellow-500/20 text-center">
                  <p className="text-2xl font-bold text-yellow-500">{moderate}</p>
                  <p className="text-xs text-muted-foreground">Moderate Risk</p>
                </div>
                <div className="p-3 rounded-lg border border-red-500/20 text-center">
                  <p className="text-2xl font-bold text-red-500">{highRisk}</p>
                  <p className="text-xs text-muted-foreground">High Risk</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">All Competitors</h3>
                <div className="space-y-2 max-h-[800px] overflow-y-auto pr-1">
                  {listings.map((listing: any, idx: number) => {
                    const bsBadge = getBsBadge(listing.bsScore || 0);
                    const isExpanded = expandedListing === (listing.id || idx);
                    return (
                      <div
                        key={listing.id || idx}
                        className="p-3 rounded-lg border border-border/50 hover:border-border transition-colors"
                        data-testid={`card-competitor-${listing.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm truncate">{listing.businessName}</p>
                              {listing.isNew && (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] px-1.5">NEW</Badge>
                              )}
                              <Badge variant="outline" className={`text-[10px] px-1.5 ${bsBadge.color}`}>
                                {bsBadge.label}
                              </Badge>
                              {listing.reviewAnalysis?.reviewsLookingAi > 0 && (
                                <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20 text-[10px] px-1.5">
                                  <Bot className="w-2.5 h-2.5 mr-0.5" />{listing.reviewAnalysis.reviewsLookingAi} AI
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              {listing.address && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />{listing.address}
                                </span>
                              )}
                              {listing.rating && (
                                <span className="flex items-center gap-1">
                                  <Star className="w-3 h-3 text-yellow-500" />{listing.rating} ({listing.reviewCount || 0} reviews)
                                </span>
                              )}
                              {listing.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3 h-3" />{listing.phone}
                                </span>
                              )}
                              {listing.website && (
                                <a href={listing.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                                  <Globe className="w-3 h-3" />Website
                                </a>
                              )}
                            </div>
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
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2 mt-1"
                              onClick={() => setExpandedListing(isExpanded ? null : (listing.id || idx))}
                              data-testid={`button-review-analysis-${listing.id}`}
                            >
                              <Eye className="w-3 h-3 mr-1" />
                              {isExpanded ? "Hide" : "View"} Review Analysis
                              {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                            </Button>
                            {isExpanded && <ReviewAnalysisPanel analysis={listing.reviewAnalysis} />}
                          </div>
                          <div className="w-28 shrink-0">
                            <BsMeter score={listing.bsScore || 0} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {!isLoading && !isRunning && listings.length === 0 && (
            <p className="text-center text-muted-foreground py-4">No competitors found in this scan.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
