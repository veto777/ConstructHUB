import { AppPage, PageHeader, AppTabsList, appTableCards } from "@/components/app-ui";
import { AgencyWorkspace, Pager, fullAddress, useAgencyFilter } from "@/components/agency-workspace";
import { inNativeApp } from "@/lib/app-shell";
import { STARTING_MONTHLY_CENTS, formatUsd } from "@shared/plan-copy";
import { LocationSearchSummary } from "./site-connections";
import { ProfileGuard, GuardStatus, GoogleReport, GOOGLE_REPORT_REVIEW_HELP } from "@/components/profile-guard";
import { GbpConnection } from "@/components/gbp-connection";
import { startGbpConnect } from "@/components/recent-auth";
import { InfoTip } from "@/components/info-tip";
import { SamplePreview } from "@/components/sample-preview";
import { GoogleSurface } from "@/components/google";
import { useEffect, useRef, useState } from "react";
import { cleanSocialLink } from "@shared/social-profile-links";
import { useUrlParam } from "@/hooks/use-url-param";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BusinessLocation, CitationCampaign, Citation } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, Plus, Search, ArrowLeft, Settings, Image, Users, Link2, Globe,
  Phone, Mail, Lock, Loader2, Trash2, RefreshCw, ExternalLink, Check, X,
  ChevronDown, Building2, Tag, BarChart3, Star, TrendingUp, TrendingDown,
  Eye, MousePointerClick, Smartphone, Monitor, Megaphone, Upload, Download, FileSpreadsheet, ScanSearch,
} from "lucide-react";
import { GbpContentEditor } from "@/pages/gbp-content";
import { GbpLinkCell } from "@/components/gbp-connection";
import {
  SiFacebook, SiInstagram, SiLinkedin, SiPinterest, SiTiktok, SiX, SiYoutube,
} from "react-icons/si";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

const SOCIAL_PLATFORMS = [
  { key: "facebook", label: "Facebook", Icon: SiFacebook },
  { key: "instagram", label: "Instagram", Icon: SiInstagram },
  { key: "linkedin", label: "LinkedIn", Icon: SiLinkedin },
  { key: "pinterest", label: "Pinterest", Icon: SiPinterest },
  { key: "tiktok", label: "TikTok", Icon: SiTiktok },
  { key: "twitter", label: "X (Twitter)", Icon: SiX },
  { key: "youtube", label: "YouTube", Icon: SiYoutube },
];


/** Per-location view state kept in the URL; it belongs to one location and never carries over to the next. */
const DETAIL_PARAMS = ["tab", "campaign", "range", "group"];
function showLocation(id: string | null) {
  const url = new URL(window.location.href);
  for (const key of DETAIL_PARAMS) url.searchParams.delete(key);
  if (id) url.searchParams.set("location", id); else url.searchParams.delete("location");
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event("urlparamchange"));
}
const refreshLocationLists = () => ["/api/locations", "/api/agency/locations", "/api/agency/dashboard", "/api/gbp/linkage", "/api/gbp/status"]
  .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

export default function LocationsPage() {
  const { toast } = useToast();
  const [locationParam] = useUrlParam("location");
  const [gbpParam, setGbpParam] = useUrlParam("gbp");
  const [importParam,setImportParam]=useUrlParam("import");
  const [addDialogOpen,setAddDialogOpen]=useState(importParam==="gbp");
  // "View profiles" (Connected Google accounts) and the empty-list prompt land here with ?import=gbp.
  useEffect(()=>{ if(importParam==="gbp") setAddDialogOpen(true); },[importParam]);
  const [notFound,setNotFound]=useState<string|null>(null);
  const {data:selectedLocation,error}=useQuery<BusinessLocation>({queryKey:["/api/locations",locationParam],enabled:!!locationParam});
  // A stale or foreign ?location= says so and returns to a clean list URL (its ?tab must not stick to the next location).
  useEffect(()=>{ if(locationParam&&error){ setNotFound(locationParam); showLocation(null); } },[locationParam,error]);
  // /api/gbp/connect opened as a page (new tab, typed URL) lands here when identity must be verified first.
  const connectStarted=useRef(false);
  useEffect(()=>{
    if(gbpParam!=="reauth"||connectStarted.current)return;
    connectStarted.current=true;setGbpParam(null);
    void startGbpConnect(message=>toast({title:"Google connection",description:message,variant:"destructive"})).finally(()=>{connectStarted.current=false;});
  },[gbpParam]);
  if(locationParam&&selectedLocation)return <GoogleSurface page><LocationDetail location={selectedLocation} onBack={()=>showLocation(null)} onDeleted={()=>{showLocation(null);queryClient.removeQueries({queryKey:["/api/locations",locationParam],exact:true});refreshLocationLists();}} isPremiumPlus={true}/></GoogleSurface>;
  // Google look (owner, 2026-10-06): the whole page sits on a GoogleSurface; the list is a local pack.
  return <GoogleSurface page><AppPage className="before:hidden">
    <PageHeader title={<span data-testid="text-locations-title">Business Profile Locations</span>} description="Manage your locations and their connection to Google." actions={<Button data-testid="button-add-location" onClick={()=>setAddDialogOpen(true)}>Add location</Button>}/>
    <Dialog open={addDialogOpen} onOpenChange={o=>{setAddDialogOpen(o);if(!o&&importParam)setImportParam(null);}}>
      <DialogContent><DialogHeader><DialogTitle>Add location</DialogTitle></DialogHeader><AddLocationDialog initialTab={importParam==="gbp"?"gbp":undefined} onCreated={()=>{setAddDialogOpen(false);setImportParam(null);refreshLocationLists();}}/></DialogContent>
    </Dialog>
    {notFound&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm" data-testid="alert-location-not-found">
      <span>Location #{notFound} was not found, or you don't have access to it.</span>
      <Button size="sm" variant="ghost" onClick={()=>setNotFound(null)}>Dismiss</Button>
    </div>}
    <AgencyWorkspace onOpen={id=>{setNotFound(null);showLocation(String(id));}}/>
    <GbpConnection context="locations"/>
  </AppPage></GoogleSurface>;
}

function AddLocationDialog({ onCreated, hasGbpAccess, initialTab }: { onCreated: () => void; hasGbpAccess?: boolean; initialTab?: "gbp" }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<string>(initialTab ?? "search");
  // The connected account's profiles are being looked up (a new connection): retry until they arrive.
  const [gbpLookup, setGbpLookup] = useState(0);
  // Importing needs a plan: say so before they pick profiles, not after the import fails (owner, 2026-10-02).
  const { data: ent } = useQuery<{ accessPlan: string | null }>({ queryKey: ["/api/entitlements"] });
  const needsPlan = !!ent && !ent.accessPlan;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [gbpLocations, setGbpLocations] = useState<any[]>([]);
  const [gbpLoading, setGbpLoading] = useState(false);
  const [gbpWarnings, setGbpWarnings] = useState<string[]>([]);
  const [gbpError, setGbpError] = useState<string | null>(null);
  const [selectedGbp, setSelectedGbp] = useState<Set<number>>(new Set());


  const handleGoogleSearch = async () => {
    if (searchQuery.trim().length < 2) {
      toast({ title: "Type at least 2 characters", description: "Search by business name, address or a Google Maps link." });
      return;
    }
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await apiRequest("POST", "/api/locations/search-google", { query: searchQuery });
      const data = await res.json();
      setSearchResults(data.results || []);
      if (!data.results?.length) {
        toast({ title: "No results found", description: "Try a different search term." });
      }
    } catch (err) {
      toast({ title: "Search failed", description: apiErrorMessage(err), variant: "destructive" });
    } finally {
      setIsSearching(false);
    }
  };

  const selectResult = useMutation({
    mutationFn: async (result: any) => {
      const res = await apiRequest("POST", "/api/locations", {
        businessName: result.companyName || result.name || result.businessName,
        placeId: result.placeId,
        address: result.address,
        phone: result.phone,
        website: result.website,
        city: result.city,
        state: result.state,
        zipCode: result.zipCode,
        categories: result.category ? [result.category] : [],
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Location added" });
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add location", description: apiErrorMessage(err), variant: "destructive" });
    },
  });


  const fetchGbpLocations = async () => {
    setGbpLoading(true);
    setGbpError(null);
    try {
      const res = await apiRequest("GET", "/api/gbp/locations");
      const data = await res.json();
      setGbpWarnings((data.errors || []).map((e: any) => `${e.account}: ${e.message}`));
      if (data.locations) {
        setGbpLocations(data.locations);
        if (data.locations.length === 0 && data.refreshing && gbpLookup < 8) {
          // Looked up in the background within a minute; check again shortly instead of saying "none".
          setGbpLookup(n => n + 1);
          setTimeout(() => { void fetchGbpLocations(); }, 12000);
          return;
        }
        if (data.locations.length > 0) setGbpLookup(0);
        if (data.locations.length === 0) {
          setGbpError("No Business Profile locations were found in your connected Google account. If another Google login manages your listing, connect that one too.");
        }
      }
    } catch (err: any) {
      const msg = err.message || "Failed to fetch locations";
      if (msg.includes("needsAuth") || msg.includes("not connected") || msg.includes("expired")) {
        setGbpError("connect");
      } else {
        setGbpError(apiErrorMessage(err, "Failed to fetch locations"));
      }
    } finally {
      setGbpLoading(false);
    }
  };

  const importGbpLocations = async () => {
    const toImport = Array.from(selectedGbp).map(i => gbpLocations[i]);
    if (toImport.length === 0) {
      toast({ title: "Select at least one location", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/gbp/import", { locations: toImport });
      const data = await res.json();
      toast({ title: `Imported ${data.imported} location${data.imported !== 1 ? "s" : ""}` });
      onCreated();
    } catch (err: any) {
      toast({ title: "Import failed", description: apiErrorMessage(err), variant: "destructive" });
    }
  };

  const toggleGbpSelect = (i: number) => {
    setSelectedGbp(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  useEffect(() => { if (initialTab === "gbp") void fetchGbpLocations(); }, []);

  return (
    <Tabs value={tab} onValueChange={v => { setTab(v); if (v === "gbp" && gbpLocations.length === 0 && !gbpLoading) fetchGbpLocations(); }} className="w-full">
      <AppTabsList>
        <TabsTrigger value="search" className="flex-1" data-testid="tab-search-google">Search Google</TabsTrigger>
        <TabsTrigger value="gbp" className="flex-1" data-testid="tab-import-gbp">Import from GBP</TabsTrigger>
      </AppTabsList>
      <TabsContent value="search" className="space-y-3 mt-4">
        <div className="flex gap-2">
          <Input
            placeholder="Business name, address, or Google Maps URL..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleGoogleSearch()}
            data-testid="input-google-search"
          />
          <Button onClick={handleGoogleSearch} disabled={isSearching} data-testid="button-google-search">
            {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>
        {searchResults.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {searchResults.map((r: any, i: number) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 p-3 rounded-md border border-border/40 cursor-pointer hover-elevate"
                onClick={() => selectResult.mutate(r)}
                data-testid={`search-result-${i}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.companyName || r.name || r.businessName}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.formattedAddress || r.address}</p>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0 text-xs gap-1">
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
            ))}
          </div>
        )}
        {selectResult.isPending && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </TabsContent>
      <TabsContent value="gbp" className="space-y-3 mt-4">
        {gbpWarnings.map(w => <p role="alert" key={w} className="text-destructive">{w}</p>)}
        {(gbpLoading || (gbpLookup > 0 && !gbpError && gbpLocations.length === 0)) && (
          <div className="flex flex-col items-center justify-center py-8 gap-2" data-testid="gbp-lookup">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground text-center">
              {gbpLookup > 0
                ? "Looking up the Business Profiles in your connected Google account — this takes up to a minute."
                : "Loading your Google Business Profiles..."}
            </p>
          </div>
        )}
        {gbpError === "connect" && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Building2 className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">Connect your Google account to import your business locations automatically.</p>
            <a href="/api/gbp/connect" data-testid="button-connect-gbp">
              <Button className="gap-2">
                <Globe className="w-4 h-4" />
                Connect Google Business
              </Button>
            </a>
          </div>
        )}
        {gbpError && gbpError !== "connect" && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <p className="text-sm text-destructive text-center">{gbpError}</p>
            <Button variant="outline" size="sm" onClick={fetchGbpLocations} data-testid="button-retry-gbp">
              <RefreshCw className="w-4 h-4 mr-1" /> Retry
            </Button>
          </div>
        )}
        {!gbpLoading && !gbpError && gbpLocations.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Found {gbpLocations.length} location{gbpLocations.length !== 1 ? "s" : ""} across your connected Google accounts</p>
              <Button size="sm" onClick={() => {
                if (selectedGbp.size === gbpLocations.length) {
                  setSelectedGbp(new Set());
                } else {
                  setSelectedGbp(new Set(gbpLocations.map((_: any, i: number) => i)));
                }
              }} variant="ghost" className="text-xs" data-testid="button-select-all-gbp">
                {selectedGbp.size === gbpLocations.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {gbpLocations.map((loc: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${selectedGbp.has(i) ? "border-primary bg-primary/5" : "border-border/40 hover:border-border"}`}
                  onClick={() => toggleGbpSelect(i)}
                  data-testid={`gbp-location-${i}`}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${selectedGbp.has(i) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                    {selectedGbp.has(i) && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{loc.businessName}</p>
                    <p className="text-xs text-muted-foreground truncate">{loc.address}</p>
                    {loc.phone && <p className="text-xs text-muted-foreground">{loc.phone}</p>}
                    {loc.grantEmail && <p className="text-xs text-muted-foreground">Managed by {loc.grantEmail}</p>}
                  </div>
                </div>
              ))}
            </div>
            {needsPlan ? (
              inNativeApp() ? (
                /* The iPhone apps sell nothing (App Store 3.1.3(f)): no "from $X/month", no plans link. */
                <div className="rounded-md border border-dashed bg-muted/40 p-3" data-testid="gbp-import-needs-plan">
                  <p className="text-sm text-muted-foreground">Importing your Google profiles into ConstructHUB isn't on this account.</p>
                </div>
              ) : (
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2" data-testid="gbp-import-needs-plan">
                <p className="text-sm">
                  <strong>Your Google profile{gbpLocations.length !== 1 ? "s were" : " was"} found.</strong> Importing {gbpLocations.length !== 1 ? "them" : "it"} into
                  ConstructHUB — and opening {gbpLocations.length !== 1 ? "their" : "its"} profile page with insights, reviews, posts and Profile Watch — needs a plan,
                  from {formatUsd(STARTING_MONTHLY_CENTS)}/month.
                </p>
                <Button asChild className="w-full gap-2" data-testid="button-gbp-see-plans"><a href="/pricing">See plans to import</a></Button>
              </div>
              )
            ) : (
              <Button onClick={importGbpLocations} disabled={selectedGbp.size === 0} className="w-full gap-2" data-testid="button-import-gbp">
                <Plus className="w-4 h-4" />
                Import {selectedGbp.size > 0 ? `${selectedGbp.size} Location${selectedGbp.size !== 1 ? "s" : ""}` : "Selected"}
              </Button>
            )}
          </div>
        )}
        {!gbpLoading && !gbpError && gbpLocations.length === 0 && gbpLookup === 0 && !hasGbpAccess && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Building2 className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">Connect your Google account to import your business locations automatically.</p>
            <a href="/api/gbp/connect" data-testid="button-connect-gbp-initial">
              <Button className="gap-2">
                <Globe className="w-4 h-4" />
                Connect Google Business
              </Button>
            </a>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function LocationDetail({ location, onBack, onDeleted, isPremiumPlus }: {
  location: BusinessLocation;
  onBack: () => void;
  onDeleted: () => void;
  isPremiumPlus: boolean;
}) {
  const [tabParam, setTabParam] = useUrlParam("tab");
  const setActiveTab = (tab: string) => setTabParam(tab);

  // Each tab names its own help entry (shared/help/registry.ts), so the "i" beside the title explains the open tab.
  const tabItems = [
    { value: "insights", label: "Insights", icon: BarChart3, helpKey: "locations.google-performance-kept" },
    { value: "reviews", label: "Reviews", icon: Star, helpKey: "locations.reviews" },
    { value: "guard", label: "Profile Watch", icon: Lock, helpKey: "locations.profile-guard-built-in" },
    { value: "info", label: "Location Info", icon: Building2, helpKey: "locations.profile-details-at-a-glance" },
    { value: "services", label: "Services", icon: Tag, helpKey: "locations.services-and-categories" },
    { value: "photos", label: "Photos & Videos", icon: Image, helpKey: "locations.photos-and-videos" },
    { value: "posts", label: "Posts & Updates", icon: Megaphone, helpKey: "locations.posts-and-updates" },
    { value: "social", label: "Social Profiles", icon: Link2, helpKey: "locations.social-profiles" },
    { value: "settings", label: "Settings", icon: Settings, helpKey: "locations.settings" },
    { value: "citations", label: "Citations", icon: Globe, helpKey: "locations.citation-checklist" },
  ];
  // An unknown (?tab=reviews) or locked tab falls back to Insights instead of an empty pane.
  const validTab = tabItems.some((t) => t.value === tabParam && !(t.value === "citations" && !isPremiumPlus));
  const activeTab = validTab ? tabParam! : "insights";
  const helpKey = tabItems.find((t) => t.value === activeTab)?.helpKey;
  useEffect(() => { if (tabParam && !validTab) setTabParam(null); }, [tabParam, validTab]);
  // The header chip: the uploaded logo, else the listing's profile photo from the last Google sync, else the icon.
  const { data: headerMedia } = useQuery<{ items: { category?: string | null; thumbnail_url?: string | null; google_url?: string | null }[] }>({
    queryKey: [`/api/gbp/locations/${location.id}/media?source=business&limit=60`],
    enabled: !!location.gbpLocationName, staleTime: 5 * 60 * 1000,
  });
  const profilePhoto = headerMedia?.items?.find((m) => m.category === "PROFILE" || m.category === "LOGO");
  const logo = location.logoUrl || profilePhoto?.thumbnail_url || profilePhoto?.google_url || null;

  return (
    <AppPage className="before:hidden">
        <Button variant="ghost" onClick={onBack} data-testid="button-back-to-list"><ArrowLeft className="mr-2 h-4 w-4"/>All locations</Button>
        <PageHeader title={<span data-testid="text-detail-name">{location.businessName}</span>} description={fullAddress(location)||'Manage this Google Business Profile.'} image={logo} helpKey={helpKey} actions={<LogoButton location={location} />}/>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex overflow-x-auto scrollbar-none md:overflow-visible md:block md:w-48 shrink-0 gap-1 md:space-y-1">
            {tabItems.map(item => {
              const isLocked = item.value === "citations" && !isPremiumPlus;
              return (
                <Button
                  key={item.value}
                  variant={activeTab === item.value ? "secondary" : "ghost"}
                  className="shrink-0 md:w-full justify-start gap-2 text-sm"
                  onClick={() => !isLocked && setActiveTab(item.value)}
                  disabled={isLocked}
                  data-testid={`tab-${item.value}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                  {isLocked && <Lock className="w-3 h-3 ml-auto" />}
                </Button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0">
            {activeTab === "insights" && <div className="space-y-4"><LocationSearchSummary locationId={location.id} businessName={location.businessName}/><InsightsTab location={location} /></div>}
            {activeTab === "reviews" && <ReviewsTab location={location} />}
            {activeTab === "guard" && <ProfileGuard locationId={location.id} linked={!!location.gbpLocationName} />}
            {activeTab === "info" && <LocationInfoTab location={location} />}
            {activeTab === "services" && <ServicesTab location={location} />}
            {activeTab === "photos" && <PhotosTab location={location} />}
            {activeTab === "posts" && <PostsTab location={location} />}
            {activeTab === "social" && <SocialProfilesTab location={location} />}
            {activeTab === "settings" && <SettingsTab location={location} onDeleted={onDeleted} />}
            {activeTab === "citations" && <CitationsTab location={location} />}
          </div>
        </div>
    </AppPage>
  );
}

function ChangeBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-muted-foreground">0%</span>;
  const isPositive = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? "text-green-600" : "text-red-500"}`}
      data-testid={`badge-change-${value}`}
    >
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isPositive ? "+" : ""}{value}%
    </span>
  );
}

const PERF_LABELS: Record<string, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Maps desktop", BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Search desktop",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Maps mobile", BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Search mobile",
  WEBSITE_CLICKS: "Website clicks", CALL_CLICKS: "Call clicks", BUSINESS_DIRECTION_REQUESTS: "Directions",
};
type PerfData = { available: boolean; metrics: string[]; rows: { date: string; metric: string; value: string; last_day: string }[];
  firstDate: string | null; lastDate: string | null; pendingAfter: string };

/** The sample table shown while Google has sent no performance numbers yet: made-up figures, never stored or sent anywhere. */
const SAMPLE_PERF_METRICS = ["BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "WEBSITE_CLICKS", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
const SAMPLE_PERF_ROWS: { date: string; values: Record<string, number> }[] = [
  { date: "2026-01-03", values: { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 42, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 31, WEBSITE_CLICKS: 4, CALL_CLICKS: 2, BUSINESS_DIRECTION_REQUESTS: 1 } },
  { date: "2026-01-02", values: { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 38, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 27, WEBSITE_CLICKS: 3, CALL_CLICKS: 1, BUSINESS_DIRECTION_REQUESTS: 2 } },
  { date: "2026-01-01", values: { BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 25, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 19, WEBSITE_CLICKS: 2, CALL_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 1 } },
];
const PERF_RANGES = ["30d", "90d", "6m", "12m", "18m", "all"];
const PERF_GROUPS = ["day", "week", "month"] as const;
function InsightsTab({ location }: { location: BusinessLocation }) {
  const [rangeParam, setRangeParam] = useUrlParam("range");
  const [groupParam, setGroupParam] = useUrlParam("group");
  const range = rangeParam && PERF_RANGES.includes(rangeParam) ? rangeParam : "90d";
  const group: (typeof PERF_GROUPS)[number] = PERF_GROUPS.find((g) => g === groupParam) ?? "day";
  const setRange = (v: string) => setRangeParam(v === "90d" ? null : v);
  const setGroup = (v: string) => setGroupParam(v === "day" ? null : v);
  const { data, error, isLoading } = useQuery<PerfData>({
    queryKey: [`/api/gbp/locations/${location.id}/performance?range=${range}&group=${group}`],
  });
  const periods = [...new Set(data?.rows.map((r) => r.date) || [])].reverse();
  const cell = (period: string, metric: string) => data?.rows.find((r) => r.date === period && r.metric === metric);
  const total = (metric: string) => (data?.rows || []).filter((r) => r.metric === metric).reduce((n, r) => n + Number(r.value), 0);
  const label = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    if (group === "month") return dt.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
    if (group === "week") return `Week of ${dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
    return d;
  };
  const pending = (period: string) => !!data && (data.rows.find((r) => r.date === period)?.last_day ?? period) > data.pendingAfter;
  const rangeLabel: Record<string, string> = { "30d": "Last 30 days", "90d": "Last 90 days", "6m": "Last 6 months", "12m": "Last 12 months", "18m": "Last 18 months", all: "All stored history" };
  const select = "border rounded-md px-2 py-1.5 text-sm bg-background";
  return (
    <div className="space-y-4">
      <GbpConnection locationId={location.id} context="locations" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">Google performance — {rangeLabel[range].toLowerCase()}, by {group}</h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Values reported by Google. Google keeps about 18 months of history; ConstructHUB keeps every day it syncs, so your history grows past that over time.
            {data?.firstDate ? ` Stored: ${data.firstDate} → ${data.lastDate}.` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <select className={select} value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range" data-testid="select-perf-range">
            {Object.entries(rangeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={select} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by" data-testid="select-perf-group">
            <option value="day">By day</option><option value="week">By week</option><option value="month">By month</option>
          </select>
        </div>
      </div>
      {isLoading ? <p>Loading performance…</p> : error ? <p role="alert">Unable to load performance.</p> : !data?.available ? (
        <div className="space-y-3">
          {location.gbpLocationName
            ? <p>No performance data yet. Metrics appear after the first successful Google sync.</p>
            : <p>Performance unavailable. Link this location to Google and sync to retrieve real metrics.</p>}
          <SamplePreview what="what this table shows once Google has sent performance numbers" cta={!location.gbpLocationName ? <GbpLinkCell locationId={location.id} /> : undefined} testId="sample-performance">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={appTableCards.thead}><tr><th className="p-2 text-left">Date</th>{SAMPLE_PERF_METRICS.map((m) => <th className="p-2 whitespace-nowrap" key={m}>{PERF_LABELS[m]}</th>)}</tr></thead>
                <tbody>
                  <tr className={`${appTableCards.tr} border-b font-semibold bg-muted/40`}><td className={`${appTableCards.td} !text-foreground`}>Total</td>{SAMPLE_PERF_METRICS.map((m) => <td className={`${appTableCards.td} !text-foreground`} key={m}>{SAMPLE_PERF_ROWS.reduce((n, r) => n + r.values[m], 0).toLocaleString()}</td>)}</tr>
                  {SAMPLE_PERF_ROWS.map((r) => <tr key={r.date} className={`${appTableCards.tr} border-b`}><td className={`${appTableCards.td} !text-foreground`}>{r.date}</td>{SAMPLE_PERF_METRICS.map((m) => <td className={`${appTableCards.td} !text-foreground`} key={m}>{r.values[m].toLocaleString()}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          </SamplePreview>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-performance">
            <thead className={appTableCards.thead}><tr>
              <th className="p-2 text-left">{group === "day" ? "Date" : group === "week" ? "Week" : "Month"}</th>
              {data.metrics.map((m) => <th className="p-2 whitespace-nowrap" key={m}>{PERF_LABELS[m] || m}</th>)}
            </tr></thead>
            <tbody>
              <tr className={`${appTableCards.tr} border-b font-semibold bg-muted/40`} data-testid="row-performance-total">
                <td className={`${appTableCards.td} !text-foreground`}>Total</td>
                {data.metrics.map((m) => <td className={`${appTableCards.td} !text-foreground`} key={m}><span className="sm:hidden text-muted-foreground mr-2">{PERF_LABELS[m] || m}:</span>{total(m).toLocaleString()}</td>)}
              </tr>
              {periods.map((p) => (
                <tr key={p} className={`${appTableCards.tr} border-b ${pending(p) ? "text-muted-foreground" : ""}`}>
                  <td className={`${appTableCards.td} !text-foreground`}>{label(p)}{pending(p) && <span className="ml-2 text-[10px] rounded bg-muted px-1.5 py-0.5" title="Google reports with a delay of a few days">not final yet</span>}</td>
                  {data.metrics.map((m) => <td className={`${appTableCards.td} !text-foreground`} key={m}><span className="sm:hidden text-muted-foreground mr-2">{PERF_LABELS[m] || m}:</span>{cell(p, m) ? Number(cell(p, m)!.value).toLocaleString() : "—"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-muted text-[9px] font-bold text-muted-foreground shrink-0">G</span>
  );
}

function InfoRow({ label, value, fromGoogle, href }: { label: string; value: string | null | undefined; fromGoogle?: boolean; href?: string | null }) {
  return (
    <div className="flex items-start gap-2 py-2.5 border-b border-border/30 last:border-0">
      <div className="w-28 sm:w-44 shrink-0 text-sm text-muted-foreground flex items-center gap-1.5">
        {fromGoogle && <GoogleIcon />}
        {label}
      </div>
      <div className="flex-1 min-w-0 text-sm break-words [overflow-wrap:anywhere]" data-testid={`info-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {!value ? <span className="text-muted-foreground italic">Not set</span>
          : href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{value}</a>
          : value}
      </div>
    </div>
  );
}

function LocationInfoTab({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const hasGoogle = !!(location.placeId || location.gbpLocationName);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/locations/${location.id}/import-google`);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gbp/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gbp/linkage"] });
      toast({ title: result.syncWarnings?.length ? "Google data partially imported" : "Google data imported",
        description: result.syncWarnings?.join('; '), variant: result.syncWarnings?.length ? 'destructive' : 'default' });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const hoursDisplay = formatHours(location.hours);
  // google_cid holds the Maps link Google returns (Places `url`, Business Profile `metadata.mapsUri`).
  const mapsLink = location.googleCid && /^https:\/\//i.test(location.googleCid) ? location.googleCid : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Location Information</CardTitle>
        {hasGoogle && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            data-testid="button-import-google"
          >
            {importMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Import from Google
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-0">
        <InfoRow label="Google Place ID" value={location.placeId} fromGoogle={hasGoogle} />
        {mapsLink || !location.googleCid
          ? <InfoRow label="Google Maps link" value={mapsLink} href={mapsLink} fromGoogle={hasGoogle} />
          : <InfoRow label="Google CID" value={location.googleCid} fromGoogle={hasGoogle} />}
        <InfoRow label="Business Name" value={location.businessName} fromGoogle={hasGoogle} />
        <InfoRow label="Description" value={location.description} />
        <InfoRow label="Address" value={fullAddress(location)} fromGoogle={hasGoogle} />
        <InfoRow label="Service Areas" value={location.serviceAreas?.join(", ")} />
        <InfoRow label="Phone" value={location.phone} fromGoogle={hasGoogle} />
        <InfoRow
          label="Categories"
          value={location.categories?.length ? `${location.categories.join(", ")} (${location.categories.length}/100)` : null}
          fromGoogle={hasGoogle}
        />
        <InfoRow
          label="Services"
          value={location.services?.length ? `${location.services.length} services` : null}
        />
        <InfoRow label="Website" value={location.website} fromGoogle={hasGoogle} />
        <InfoRow label="Hours" value={hoursDisplay} fromGoogle={hasGoogle} />
        <InfoRow label="Opening Date" value={location.openingDate} />
        {/* Only a Google Business Profile sync reports open/closed; anything else would be a guess. */}
        <InfoRow label="Open Status" value={location.gbpLocationName ? location.openStatus : null} fromGoogle={!!location.gbpLocationName} />
      </CardContent>
    </Card>
  );
}

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Google hours are stored per day ({Monday: "8:00 AM – 5:00 PM"}); JSON storage loses key order. Legacy
 *  Places imports stored {weekday_text: ["Monday: …", …]}. */
function formatHours(hours: unknown): string | null {
  if (!hours) return null;
  if (typeof hours !== "object") return String(hours);
  if (Array.isArray(hours)) return hours.map(String).join(" · ");
  const h = hours as Record<string, unknown>;
  if (Array.isArray(h.weekday_text)) return (h.weekday_text as string[]).join(" · ");
  const days = WEEK.filter((d) => typeof h[d] === "string");
  if (!days.length) return null;
  const values = days.map((d) => h[d] as string);
  if (days.length === 7 && values.every((v) => v === values[0])) return `${values[0]}, every day`;
  return days.map((d, i) => `${d.slice(0, 3)}: ${values[i]}`).join(" · ");
}

function ServicesTab({ location }: { location: BusinessLocation }) {
  const [filter, setFilter] = useState("");
  const categories = location.categories || [];
  const services = location.services || [];
  const shown = filter ? services.filter((s) => s.toLowerCase().includes(filter.toLowerCase())) : services;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Services on your Google profile
          <Badge variant="outline" className="text-xs" data-testid="badge-service-count">{services.length}</Badge>
        </CardTitle>
        <CardDescription>
          {location.gbpLocationName ? "Synced from your Google Business Profile. Edit services in Google Business Profile; they update here on the next sync." : "Link this location to your Google Business Profile to sync its services."}
        </CardDescription>
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2" data-testid="service-categories">
            {categories.map((c, i) => (
              <Badge key={c} variant={i === 0 ? "default" : "secondary"} className="text-[11px]">{c}{i === 0 ? " · primary" : ""}</Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No services synced yet.</p>
        ) : (
          <>
            {services.length > 12 && (
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${services.length} services…`} className="mb-3 h-8 text-sm" data-testid="input-service-filter" />
            )}
            <div className="grid sm:grid-cols-2 gap-x-6">
              {shown.map((svc, i) => (
                <div key={svc + i} className="flex items-center gap-2 py-1.5 border-b border-border/30" data-testid={`service-row-${i}`}>
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm">{svc}</span>
                </div>
              ))}
            </div>
            {filter && shown.length === 0 && <p className="text-sm text-muted-foreground py-3 text-center">No services match “{filter}”.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ReviewRow = { id: number; reviewer_name: string | null; reviewer_photo_url: string | null; rating: number | null; comment: string | null; review_date: string | null; reply_comment: string | null; reply_status: string | null; reply_date: string | null; google_deleted: boolean; deleted_at: string | null; edited_at: string | null; edit_count: number; previous: { reviewer_name?: string | null; rating?: number | null; comment?: string | null } | null };
type ReviewEventRow = { id: number; review_id: number | null; kind: "added" | "edited" | "removed" | "restored"; before: { reviewer_name?: string | null; rating?: number | null; comment?: string | null; review_date?: string | null } | null; after: { reviewer_name?: string | null; rating?: number | null; comment?: string | null; review_date?: string | null } | null; created_at: string };
/** Google's own pages about reviews that disappear (verified 2026-10-15; no tracking parameters). The support form needs the Google sign-in that manages the listing. */
const GOOGLE_MISSING_REVIEWS_HELP = "https://support.google.com/business/answer/10313341";
const GOOGLE_BUSINESS_SUPPORT_FORM = "https://support.google.com/business/gethelp";
const fmtDay = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const fmtWhen = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
function Stars({ n }: { n: number | null | undefined }) {
  return <span className="inline-flex items-center gap-0.5 text-amber-500" aria-label={n ? `${n} stars` : "unrated"}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-3.5 w-3.5 ${n && i <= n ? "fill-current" : "opacity-25"}`} />)}</span>;
}

/** Reviews: every review Google returns, saved here; the ones Google stopped returning, with their full text; and the
 * change log — so "107 yesterday, 106 today" always has a name attached (owner 2026-10-15). */
function ReviewsTab({ location }: { location: BusinessLocation }) {
  const linked = !!location.gbpLocationName;
  const { data, isLoading, error } = useQuery<{ live: ReviewRow[]; removed: ReviewRow[]; events: ReviewEventRow[]; syncedAt: string | null; syncError: string | null; edited: number }>({
    queryKey: [`/api/gbp/locations/${location.id}/reviews`], enabled: linked, refetchInterval: 60_000,
  });
  const [view, setView] = useState<"changes" | "removed" | "all">("changes");
  const [copied, setCopied] = useState<number | null>(null);
  const [copiedReport, setCopiedReport] = useState<number | null>(null);
  const copy = async (r: ReviewRow) => {
    const txt = `${r.rating ?? "?"}-star review by ${r.reviewer_name || "a reviewer"}${r.review_date ? ` on ${fmtDay(r.review_date)}` : ""}:
${r.comment || "(no text)"}`;
    try { await navigator.clipboard.writeText(txt); setCopied(r.id); setTimeout(() => setCopied(null), 2000); } catch { /* clipboard blocked: the text is on screen */ }
  };
  // What Google's support form asks for about a missing review, assembled from what is saved here — nothing guessed.
  const listingLink = location.googleCid && /^https:\/\//i.test(location.googleCid) ? location.googleCid : location.placeId ? `https://www.google.com/maps/place/?q=place_id:${location.placeId}` : null;
  const copyReport = async (r: ReviewRow, liveCount: number, removedCount: number) => {
    const lines = [
      `Business: ${location.businessName}`,
      `Listing: ${listingLink ?? "(no Google link on file)"}`,
      `Reviewer: ${r.reviewer_name || "(name not recorded)"}`,
      `Review date: ${r.review_date ? fmtDay(r.review_date) : "(not recorded)"}`,
      `Rating: ${r.rating ?? "?"} star(s)`,
      `Review text: ${r.comment || "(no text)"}`,
      r.reply_comment ? `Our reply: ${r.reply_comment}` : null,
      `Last seen on Google: ${r.deleted_at ? `gone since ${fmtWhen(r.deleted_at)}` : "gone since an earlier sync"}`,
      `Reviews the listing shows now: ${liveCount}. Reviews saved by us that Google no longer shows: ${removedCount}.`,
    ].filter((l): l is string => !!l);
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopiedReport(r.id); setTimeout(() => setCopiedReport(null), 2000); } catch { /* clipboard blocked: the text is on screen */ }
  };
  if (!linked) return <Card><CardContent className="p-4 space-y-3 text-sm text-muted-foreground"><p>Link this location to its Google Business Profile and its reviews are saved here on every sync, with an alert the moment one disappears or changes.</p><GbpLinkCell locationId={location.id} /></CardContent></Card>;
  const kindLabel: Record<ReviewEventRow["kind"], string> = { added: "New review", edited: "Edited", removed: "Removed by Google", restored: "Back on Google" };
  const kindClass: Record<ReviewEventRow["kind"], string> = { added: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", edited: "bg-amber-500/10 text-amber-700 dark:text-amber-300", removed: "bg-red-500/10 text-red-700 dark:text-red-300", restored: "bg-sky-500/10 text-sky-700 dark:text-sky-300" };
  const live = data?.live ?? [], removed = data?.removed ?? [], events = data?.events ?? [];
  return (
    <div className="space-y-4" data-testid="tab-reviews">
      <div>
        <div className="flex items-center gap-1"><h3 className="text-base font-semibold">Reviews</h3><InfoTip k="location-reviews" /></div>
        <p className="text-xs text-muted-foreground max-w-xl">Every review on your Google listing is saved here on each sync. When one disappears, is edited or comes back, it is logged with its full text and you get an alert, so a review a competitor reported never just vanishes without a name.</p>
        <p className="text-xs text-muted-foreground max-w-xl">A review that breaks Google's rules (spam, a fake, a conflict of interest, off-topic or offensive) can be reported from the list below. <a className="underline" href={GOOGLE_REPORT_REVIEW_HELP} target="_blank" rel="noopener noreferrer" data-testid="link-google-report-review-help">How Google handles review reports ↗</a></p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <button type="button" onClick={() => setView("all")} className={`rounded-lg border p-3 text-center ${view === "all" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} data-testid="reviews-count-live"><p className="text-2xl font-bold">{data ? live.length : "—"}</p><p className="text-xs text-muted-foreground">On Google now{location.avgRating ? ` · ${location.avgRating}★` : ""}</p></button>
        <button type="button" onClick={() => setView("removed")} className={`rounded-lg border p-3 text-center ${view === "removed" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} data-testid="reviews-count-removed"><p className={`text-2xl font-bold ${removed.length ? "text-destructive" : ""}`}>{data ? removed.length : "—"}</p><p className="text-xs text-muted-foreground">Removed (text saved)</p></button>
        <button type="button" onClick={() => setView("changes")} className={`rounded-lg border p-3 text-center ${view === "changes" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`} data-testid="reviews-count-changes"><p className="text-2xl font-bold">{data ? events.length : "—"}</p><p className="text-xs text-muted-foreground">Changes logged</p></button>
      </div>
      <p className="text-xs text-muted-foreground">{data?.syncedAt ? `Last checked ${fmtWhen(data.syncedAt)} · checked again every few hours` : "Not checked yet"}{data?.syncError ? ` · ${data.syncError}` : ""}</p>
      {error && <p role="alert" className="text-sm text-destructive">Could not load the reviews.</p>}
      {isLoading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}

      {data && view === "changes" && (
        <Card><CardContent className="p-0">
          {!events.length ? <p className="p-4 text-sm text-muted-foreground">No changes since the reviews were first saved. The first sync is history, not news; from here on every new, edited, removed or restored review shows up on this list and in your alerts.</p> : (
            <ul className="divide-y">{events.map((e) => { const r = e.kind === "removed" ? e.before : e.after; return (
              <li key={e.id} className="p-3 text-sm space-y-1" data-testid={`review-event-${e.id}`}>
                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${kindClass[e.kind]}`}>{kindLabel[e.kind]}</span><span className="text-xs text-muted-foreground">{fmtWhen(e.created_at)}</span><span className="font-medium">{r?.reviewer_name || "A reviewer"}</span><Stars n={r?.rating} />{r?.review_date && <span className="text-xs text-muted-foreground">reviewed {fmtDay(r.review_date)}</span>}</div>
                {e.kind === "edited" && e.before && e.after && (e.before.rating !== e.after.rating) && <p className="text-xs">Rating: <Stars n={e.before.rating} /> → <Stars n={e.after.rating} /></p>}
                {e.kind === "edited" && e.before?.comment !== e.after?.comment && <p className="text-xs text-muted-foreground line-through whitespace-pre-wrap">{e.before?.comment || "(no text)"}</p>}
                <p className="whitespace-pre-wrap">{r?.comment || "(no text)"}</p>
              </li>); })}</ul>
          )}
        </CardContent></Card>
      )}

      {data && view === "removed" && (
        <Card><CardContent className="p-0">
          <div className="p-4 border-b space-y-2" data-testid="reviews-removed-intro">
            <div className="flex items-center gap-1"><h4 className="text-sm font-semibold">Reviews Google no longer shows</h4><InfoTip k="location-reviews-removed" /></div>
            <p className="text-xs text-muted-foreground max-w-xl">A review that was on the listing at one sync and gone at the next is kept here with its full text. Google checks every review against its policies and does not restore one removed for breaking them; it can also take a few days to show a new review, or hide reviews for a while. You can ask Google about a missing review through its Business Profile support form, signed in with the Google account that manages the listing. <a className="underline" href={GOOGLE_MISSING_REVIEWS_HELP} target="_blank" rel="noopener noreferrer" data-testid="link-google-missing-reviews-help">What Google says about missing reviews ↗</a></p>
            <Button asChild size="sm" variant="outline"><a href={GOOGLE_BUSINESS_SUPPORT_FORM} target="_blank" rel="noopener noreferrer" data-testid="link-google-report-missing-review">Report a missing review to Google ↗</a></Button>
          </div>
          {!removed.length ? <p className="p-4 text-sm text-muted-foreground">Nothing has been removed. If Google ever drops one, its full text stays here, you are alerted, and “Copy for Google” on the review assembles what Google’s support form asks for.</p> : (
            <ul className="divide-y">{removed.map((r) => (
              <li key={r.id} className="p-3 text-sm space-y-1" data-testid={`review-removed-${r.id}`}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.reviewer_name || "A reviewer"}</span><Stars n={r.rating} />{r.review_date && <span className="text-xs text-muted-foreground">reviewed {fmtDay(r.review_date)}</span>}<span className="text-xs text-destructive">gone since {fmtWhen(r.deleted_at) || "an earlier sync"}</span></div>
                <p className="whitespace-pre-wrap">{r.comment || "(no text)"}</p>
                {r.reply_comment && <p className="text-xs text-muted-foreground">Your reply: {r.reply_comment}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void copy(r)}>{copied === r.id ? "Copied" : "Copy the text"}</Button>
                  <Button size="sm" variant="outline" onClick={() => void copyReport(r, live.length, removed.length)} data-testid={`button-copy-report-${r.id}`}>{copiedReport === r.id ? "Copied" : "Copy for Google"}</Button>
                  <Button asChild size="sm" variant="outline"><a href={GOOGLE_BUSINESS_SUPPORT_FORM} target="_blank" rel="noopener noreferrer">Report a missing review to Google ↗</a></Button>
                </div>
              </li>))}</ul>
          )}
        </CardContent></Card>
      )}

      {data && view === "all" && (
        <Card><CardContent className="p-0">
          {!live.length ? <p className="p-4 text-sm text-muted-foreground">No reviews on the listing yet.</p> : (
            <ul className="divide-y">{live.map((r) => (
              <li key={r.id} className="p-3 text-sm space-y-1" data-testid={`review-${r.id}`}>
                <div className="flex flex-wrap items-center gap-2">{r.reviewer_photo_url && <img src={r.reviewer_photo_url} alt="" className="h-6 w-6 rounded-full" loading="lazy" />}<span className="font-medium">{r.reviewer_name || "A reviewer"}</span><Stars n={r.rating} /><span className="text-xs text-muted-foreground">{fmtDay(r.review_date)}</span>{r.edit_count > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">edited {r.edit_count}×</span>}{r.reply_comment ? <span className="text-[11px] text-muted-foreground">replied</span> : <span className="text-[11px] text-destructive">no reply</span>}</div>
                <p className="whitespace-pre-wrap">{r.comment || "(no text)"}</p>
                {r.previous && (r.previous.comment !== r.comment || r.previous.rating !== r.rating) && <p className="text-xs text-muted-foreground">Before the edit: <Stars n={r.previous.rating} /> {r.previous.comment || "(no text)"}</p>}
                <div className="flex flex-wrap gap-2 pt-1" data-testid={`review-actions-${r.id}`}>
                  <GoogleReport type="reviews" id={r.id} />
                  <Button size="sm" variant="outline" onClick={() => void copy(r)}>{copied === r.id ? "Copied" : "Copy the text"}</Button>
                </div>
              </li>))}</ul>
          )}
          <div className="p-3 border-t"><Button asChild size="sm" variant="outline"><a href={`/google-reviews/reviews?location=${location.id}`}>Reply to reviews</a></Button></div>
        </CardContent></Card>
      )}
    </div>
  );
}

/** Posts & Updates: the Posts & Photos tool scoped to this location — write or AI-draft Google updates, upload photos,
 * set the style the drafts follow, schedule a batch on a cadence, and watch the queue and history. */
function PostsTab({ location }: { location: BusinessLocation }) {
  if (!location.gbpLocationName) {
    return (
      <Card><CardContent className="p-4 space-y-3 text-sm text-muted-foreground">
        <p>Link this location to your Google Business Profile first. Posts and photos publish to the linked listing.</p>
        <GbpLinkCell locationId={location.id} />
      </CardContent></Card>
    );
  }
  return (
    <div className="space-y-4" data-testid="tab-posts">
      <div>
        <div className="flex items-center gap-1">
          <h3 className="text-base font-semibold">Posts &amp; Updates</h3>
          <InfoTip k="location-posts" />
        </div>
        <p className="text-xs text-muted-foreground max-w-xl">Write an update or let the AI draft one in your style, pick when it goes out, and approve. Automation lives here too: a batch of drafts spaced out by day or week, business hours only, and the queue that publishes them to Google on time. Photos have their own tab.</p>
      </div>
      <GbpContentEditor key={location.id} location={String(location.id)} mode="posts" />
    </div>
  );
}

function PhotosTab({ location }: { location: BusinessLocation }) {
  const [source, setSource] = useState<"business" | "customer">("business");
  const [limit, setLimit] = useState(60);
  const linked = !!location.gbpLocationName;
  const { data, isLoading } = useQuery<{ total: number; syncedAt: string | null; items: any[] }>({
    queryKey: [`/api/gbp/locations/${location.id}/media?source=${source}&limit=${limit}`],
    enabled: linked,
  });
  // The stored count is written only by a successful profile sync (server/gbp/service.ts), but the column
  // defaults to 0, which reads identically to "Google reported zero". A sync that never succeeded is the
  // distinguishable signal: counts stay hidden ("—") until Google has actually reported them.
  const { data: syncStatus } = useQuery<{ locations: { id: number; kind: string; last_success: string | null }[] }>({
    queryKey: [`/api/gbp/status?locationId=${location.id}`],
    enabled: linked,
  });
  const countsReported = !!syncStatus?.locations?.some((s) => s.kind === "profile" && !!s.last_success);
  // Photo counts come only from a Business Profile sync. Unlinked, the stored value is the schema default (0)
  // or an old capped Places value, so show unknown instead of a number. A linked count Google never
  // reported is unknown too, never 0.
  const tile = (n: number | null | undefined, label: string, which: "business" | "customer") => (
    <button type="button" onClick={() => { setSource(which); setLimit(60); }}
      className={`rounded-lg border p-4 text-center transition-colors ${source === which ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
      data-testid={`tab-photos-${which}`}>
      <p className="text-2xl font-bold" data-testid={`text-${which}-photo-count`}>{linked && countsReported && n != null ? n : "—"}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {!linked && <p className="text-[11px] text-muted-foreground mt-1">Link to Google Business Profile to see photo counts</p>}
    </button>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {tile(location.businessPhotoCount, "Business photos & videos", "business")}
        {tile(location.customerPhotoCount, "Customer photos & videos", "customer")}
      </div>

      {!linked ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          Link this location to your Google Business Profile (Locations → Link &amp; sync) to see every photo on your listing here.
        </CardContent></Card>
      ) : isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : !data?.items.length ? (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">
          No {source} photos synced yet. Sync from the Locations page — connect your Google account if prompted, then use <strong>Sync now</strong>. Photos sync along with reviews and performance.
        </CardContent></Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {data.items.length} of {data.total} {source} photos and videos from Google{data.syncedAt ? ` · synced ${new Date(data.syncedAt).toLocaleString()}` : ""}. Click one to open it on Google.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-testid="gbp-media-grid">
            {data.items.map((m) => (
              <a key={m.name} href={m.google_url || undefined} target="_blank" rel="noopener noreferrer"
                className="group relative block aspect-square overflow-hidden rounded-md border bg-muted" title={m.description || m.attribution || m.category || ""}>
                {m.thumbnail_url || m.google_url
                  ? <img src={m.thumbnail_url || m.google_url} alt={m.description || `${source} photo`} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  : <span className="flex h-full items-center justify-center text-xs text-muted-foreground">{m.media_format || "Media"}</span>}
                {(m.category || m.media_format === "VIDEO") && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {m.media_format === "VIDEO" ? "Video" : String(m.category).toLowerCase().replace(/_/g, " ")}
                  </span>
                )}
              </a>
            ))}
          </div>
          {data.items.length < data.total && (
            <Button variant="outline" className="w-full" onClick={() => setLimit((l) => Math.min(l + 120, 600))} data-testid="button-more-photos">
              Show more ({data.total - data.items.length} more)
            </Button>
          )}
        </>
      )}

      {linked && (
        <details className="rounded-xl border bg-card p-4" data-testid="photos-upload-schedule">
          <summary className="cursor-pointer py-2 min-h-10 font-medium">Upload &amp; schedule photos</summary>
          <p className="text-xs text-muted-foreground mb-3">Upload photos, let the AI caption them, pick a category and when they go onto the listing. Nothing publishes until you approve.</p>
          <GbpContentEditor key={location.id} location={String(location.id)} mode="photos" />
        </details>
      )}
    </div>
  );
}

/** "Set logo" in the location header: upload → library photo → the location's logo, and the listing's profile photo on Google. */
function LogoButton({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("pattern", "{business}-logo");
      fd.append("title", `${location.businessName} logo`);
      const up = await fetch(`/api/gbp/content/${location.id}/upload`, { method: "POST", body: fd, credentials: "include" });
      if (!up.ok) throw new Error((await up.json().catch(() => ({}))).message || "Upload failed");
      const photo = await up.json();
      const r = await (await apiRequest("PUT", `/api/locations/${location.id}/logo`, { photoId: photo.id })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (r.google?.error) toast({ title: "Logo saved here, but not on Google", description: r.google.error, variant: "destructive" });
      else if (r.google?.queued) toast({ title: "Logo saved", description: "It is being sent to your Google Business Profile now. Google can take a few minutes to show it." });
      else toast({ title: "Logo saved" });
    } catch (e) {
      toast({ title: "Could not set the logo", description: apiErrorMessage(e as Error), variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} data-testid="input-location-logo" />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()} data-testid="button-set-logo">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Image className="mr-2 h-4 w-4" />}{location.logoUrl ? "Change logo" : "Set logo"}
      </Button>
    </>
  );
}

function SocialProfilesTab({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const profiles = (location.socialProfiles as Record<string, string>) || {};
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    SOCIAL_PLATFORMS.forEach(p => { init[p.key] = profiles[p.key] || ""; });
    return init;
  });
  // Mirrors the server (shared/social-links.ts): one full https link per platform, on that platform's own domain.
  const checks = Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p.key, cleanSocialLink(p.key, values[p.key])])) as Record<string, ReturnType<typeof cleanSocialLink>>;
  const invalid = new Set(SOCIAL_PLATFORMS.map(p => p.key).filter(k => !!checks[k].error));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      const res = await apiRequest("PUT", `/api/locations/${location.id}`, { socialProfiles: trimmed });
      return res.json();
    },
    onSuccess: (r: { socialProfiles?: Record<string, string>; google?: { pushed: string[]; error?: string } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      // The boxes take the server's cleaned links (a short link comes back as the full profile link).
      if (r?.socialProfiles) setValues(v => Object.fromEntries(SOCIAL_PLATFORMS.map(p => [p.key, r.socialProfiles![p.key] ?? (v[p.key].trim() ? "" : v[p.key])])));
      if (r?.google?.error) toast({ title: "Saved here, but not on Google", description: r.google.error, variant: "destructive" });
      else if (r?.google) toast({ title: "Social profiles saved to your Google Business Profile", description: "Google can take a few minutes to show them on the listing." });
      else toast({ title: "Social profiles saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Social Profiles</CardTitle>
        <CardDescription>{location.gbpLocationName ? "Add your social media URLs. They are written to your Google Business Profile as well, so the listing shows them." : "Add your social media URLs."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {SOCIAL_PLATFORMS.map(platform => (
          <div key={platform.key} className="space-y-1">
            <div className="flex items-center gap-3">
              <platform.Icon className="w-5 h-5 shrink-0 text-muted-foreground" />
              <Label className="w-24 shrink-0 text-sm" htmlFor={`input-social-${platform.key}`}>{platform.label}</Label>
              <Input
                id={`input-social-${platform.key}`}
                type="url"
                inputMode="url"
                className="flex-1"
                placeholder={`https://${platform.key}.com/...`}
                value={values[platform.key]}
                onChange={e => setValues(v => ({ ...v, [platform.key]: e.target.value }))}
                aria-invalid={invalid.has(platform.key)}
                aria-describedby={invalid.has(platform.key) ? `error-social-${platform.key}` : undefined}
                data-testid={`input-social-${platform.key}`}
              />
            </div>
            {invalid.has(platform.key) && (
              <p id={`error-social-${platform.key}`} className="text-xs text-destructive sm:pl-[8.5rem]" data-testid={`text-social-error-${platform.key}`}>
                {checks[platform.key].error}
              </p>
            )}
            {!invalid.has(platform.key) && checks[platform.key].short && (
              <p className="text-xs text-muted-foreground sm:pl-[8.5rem]" data-testid={`text-social-short-${platform.key}`}>
                Short link — it will be expanded to the full profile link when you save.
              </p>
            )}
          </div>
        ))}
        <Button
          className="w-full mt-2"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || invalid.size > 0}
          data-testid="button-save-social"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          Save Social Profiles
        </Button>
      </CardContent>
    </Card>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SettingsTab({ location, onDeleted }: { location: BusinessLocation; onDeleted: () => void }) {
  const { toast } = useToast();
  const savedEmail = location.notificationEmail || "";
  // The switch mirrors what is saved: no location email means the account email is used.
  const [useAccountSettings, setUseAccountSettings] = useState(!savedEmail);
  const [notificationEmail, setNotificationEmail] = useState(savedEmail);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const nextEmail = useAccountSettings ? null : notificationEmail.trim();
  const emailInvalid = nextEmail !== null && !EMAIL_RE.test(nextEmail);
  const dirty = (nextEmail ?? "") !== savedEmail;
  // Only a location tied to Google (Place ID or a linked Business Profile) has a listing to reassure about.
  const hasGoogleListing = !!(location.placeId || location.gbpLocationName);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/locations/${location.id}`, { notificationEmail: nextEmail });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/locations/${location.id}`);
    },
    onSuccess: () => {
      setConfirmOpen(false);
      const googleNote = hasGoogleListing ? " Your Google listing is unchanged." : "";
      toast({ title: "Location deleted", description: `${location.businessName} was removed from ConstructHUB.${googleNote}` });
      onDeleted();
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // A location linked to Google carries synced history; make that delete deliberate.
  const mustTypeName = !!location.gbpLocationName;
  const confirmReady = !mustTypeName || confirmName.trim() === location.businessName.trim();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notification email</CardTitle>
          <p className="text-sm text-muted-foreground">ConstructHUB does not send location notifications yet, so nothing is emailed to this address today. You can save one here for this location. Imported Google locations sync automatically every six hours while connected.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm" htmlFor="switch-account-settings">Use account-level settings</Label>
            <Switch
              id="switch-account-settings"
              checked={useAccountSettings}
              onCheckedChange={setUseAccountSettings}
              data-testid="switch-account-settings"
            />
          </div>
          {!useAccountSettings && (
            <div className="space-y-1.5">
              <Label className="text-sm" htmlFor="input-notification-email">Email for this location</Label>
              <Input
                id="input-notification-email"
                type="email"
                value={notificationEmail}
                onChange={e => setNotificationEmail(e.target.value)}
                placeholder="email@example.com"
                aria-invalid={emailInvalid && notificationEmail.trim() !== ""}
                data-testid="input-notification-email"
              />
              {emailInvalid && notificationEmail.trim() !== "" && (
                <p className="text-xs text-destructive" data-testid="text-notification-email-error">Enter a full email address, like name@company.com.</p>
              )}
            </div>
          )}
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || emailInvalid || !dirty}
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <p className="text-sm font-medium text-destructive">Delete Location</p>
                <InfoTip k="delete-location" />
              </div>
              <p className="text-xs text-muted-foreground">Removes it from ConstructHUB only — your Google Business Profile listing is not affected. This cannot be undone.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setConfirmName(""); setConfirmOpen(true); }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-location"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!deleteMutation.isPending) setConfirmOpen(open); }}>
        <AlertDialogContent data-testid="dialog-delete-location">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {location.businessName} from ConstructHUB?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{hasGoogleListing
                  ? "Your listing on Google is not changed. ConstructHUB permanently removes its own copy:"
                  : "ConstructHUB permanently removes this location and its data:"}</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>synced Google reviews, photos and performance stats</li>
                  <li>Profile Watch settings and history</li>
                  <li>AI reply settings, scheduled Google posts and photos</li>
                  <li>Social Media connections, settings and posts for this business</li>
                  <li>citation campaigns and their checklist marks</li>
                </ul>
                <p>This cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mustTypeName && (
            <div className="space-y-1.5">
              <Label htmlFor="input-confirm-location-name" className="text-sm">Type <strong>{location.businessName}</strong> to confirm</Label>
              <Input id="input-confirm-location-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" data-testid="input-confirm-location-name" />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending} data-testid="button-cancel-delete-location">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!confirmReady || deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (confirmReady) deleteMutation.mutate(); }}
              data-testid="button-confirm-delete-location"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Campaign lists are keyed by their full URL (with the agency filter), so refresh every key under the path. */
const invalidateCampaigns = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/citations/campaigns") });

function CitationsTab({ location }: { location: BusinessLocation }) {
  const f=useAgencyFilter();
  const { toast } = useToast();
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignParam, setCampaignParam] = useUrlParam("campaign");
  const selectedCampaignId = campaignParam && /^\d+$/.test(campaignParam) ? Number(campaignParam) : null;
  const setSelectedCampaignId = (id: number | null) => setCampaignParam(id === null ? null : String(id));
  const [pendingDelete, setPendingDelete] = useState<CitationCampaign | null>(null);

  const { data: campaigns, isLoading } = useQuery<CitationCampaign[]>({
    queryKey: [`/api/citations/campaigns?locationId=${location.id}&${f.params}`],
  });

  const locationCampaigns = campaigns?.filter(c => c.locationId === location.id) ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!campaignName.trim()) throw new Error("Campaign name is required");
      const res = await apiRequest("POST", "/api/citations/campaigns", {
        locationId: location.id,
        campaignName,
        businessName: location.businessName,
        address: location.address,
        phone: location.phone,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateCampaigns();
      setCampaignName("");
      setShowNewCampaign(false);
      toast({ title: "Campaign created" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not create campaign", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/citations/campaigns/${id}`);
    },
    onSuccess: () => {
      invalidateCampaigns();
      setPendingDelete(null);
      setSelectedCampaignId(null);
      toast({ title: "Campaign deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // A ?campaign= that isn't one of this location's campaigns (deleted, or from another location) falls back to the list.
  useEffect(() => {
    if (selectedCampaignId !== null && campaigns && !locationCampaigns.some(c => c.id === selectedCampaignId)) setSelectedCampaignId(null);
    else if (campaignParam && selectedCampaignId === null) setSelectedCampaignId(null);
  }, [campaigns, selectedCampaignId, campaignParam]);

  if (selectedCampaignId) {
    const campaign = locationCampaigns.find(c => c.id === selectedCampaignId);
    if (campaign) {
      return <CampaignDetail campaign={campaign} location={location} onBack={() => setSelectedCampaignId(null)} />;
    }
  }

  const pendingMarks = pendingDelete ? (pendingDelete.citationsFound || 0) + (pendingDelete.opportunitiesFound || 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1">
            <h3 className="text-base font-semibold">Citation Campaigns</h3>
            <InfoTip k="citations" />
          </div>
          <p className="text-xs text-muted-foreground max-w-xl">A citation is a listing of your business on another site — Yelp, BBB, Angi, Apple Maps, Bing and about 25 more. Google trusts a business more when the same name, address and phone show up on all of them, and that moves you up in Maps. A campaign is a checklist of those sites for this location. Run the audit and ConstructHUB reads each site and records what it actually found; mark the rest by hand or import a spreadsheet; then fix anything wrong on the site itself. Press the ⓘ for the full walkthrough.</p>
        </div>
        <Button size="sm" onClick={() => setShowNewCampaign(true)} data-testid="button-new-campaign">
          <Plus className="w-4 h-4 mr-1" /> New Campaign
        </Button>
      </div>

      {showNewCampaign && (
        <Card>
          <CardContent className="p-4">
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!createMutation.isPending) createMutation.mutate(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="input-campaign-name">Campaign Name</Label>
              <Input
                id="input-campaign-name"
                autoFocus
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g. Spring 2026 listings check"
                data-testid="input-campaign-name"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending}
                data-testid="button-create-campaign"
              >
                {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                Create
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowNewCampaign(false)} data-testid="button-cancel-campaign">
                Cancel
              </Button>
            </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : locationCampaigns.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Globe className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No citation campaigns yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locationCampaigns.map(campaign => (
            <Card
              key={campaign.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedCampaignId(campaign.id)}
              data-testid={`card-campaign-${campaign.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium" data-testid={`text-campaign-name-${campaign.id}`}>{campaign.campaignName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {campaign.citationsFound || 0} listed &middot; {campaign.opportunitiesFound || 0} to add
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={campaign.status === "active" ? "default" : "outline"} className="text-[10px]">
                      {campaign.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete campaign ${campaign.campaignName}`}
                      onClick={e => { e.stopPropagation(); setPendingDelete(campaign); }}
                      data-testid={`button-delete-campaign-${campaign.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setPendingDelete(null); }}>
        <AlertDialogContent data-testid="dialog-delete-campaign">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign “{pendingDelete?.campaignName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the campaign and its whole checklist{pendingMarks ? `, including ${pendingMarks} marked site${pendingMarks === 1 ? "" : "s"}` : ""} and any listing links you saved. Your listings on those sites are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={(e) => { e.preventDefault(); if (pendingDelete) deleteMutation.mutate(pendingDelete.id); }}
              data-testid="button-confirm-delete-campaign"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function summaryLine(s: Record<string, number> | undefined): string {
  if (!s) return "";
  const parts: [number | undefined, string][] = [[s.match, "listed"], [s.mismatch, "listed with wrong details"], [s.not_found, "not found"], [s.unconfirmed, "to check by hand"], [s.unsupported, "manual sites"]];
  return parts.filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(" · ");
}
const AUDIT_LABEL: Record<string, [string, string]> = {
  match: ["Listed ✓", "text-green-600"], mismatch: ["Listed, wrong details", "text-yellow-600"], not_found: ["Not found", "text-red-600"],
  unconfirmed: ["Check by hand", "text-muted-foreground"], unsupported: ["Manual site", "text-muted-foreground"],
};
type AuditEvidence = { how?: string; partial?: boolean; fields?: Record<string, { result: string; expected: string | null; observed: string | null }> | null; candidates?: string[]; searchUrl?: string | null };
type AuditInfo = {
  audit: { id: number; status: string; total: number; done: number; currentSite: string | null; summary: Record<string, number>; error: string | null; startedAt: string | null; finishedAt: string | null } | null;
  quota: { used: number; limit: number }; ready: boolean; readyReason: string | null; capabilities: { webSearch: boolean };
};

/** What the audit saw on one site: result, the reason in plain words, each field that differs, the likely listing. */
function AuditCell({ c }: { c: Citation }) {
  const r = c.auditResult, reason = c.auditReason, ev = (c.auditEvidence ?? null) as AuditEvidence | null, at = c.auditCheckedAt;
  if (!r) return <span className="text-xs text-muted-foreground">—</span>;
  const [label, color] = AUDIT_LABEL[r] ?? [r, ""];
  const diffs = ev?.fields ? Object.entries(ev.fields).filter(([, f]) => f.result === "differs") : [];
  const candidate = !c.listingUrl && ev?.candidates?.[0];
  return (
    <div className="space-y-0.5" data-testid={`audit-${c.id}`}>
      <p className={`text-xs font-medium ${color}`}>{label}{ev?.partial ? " (address unread)" : ""}</p>
      {reason && <p className="text-[11px] text-muted-foreground leading-snug">{reason}</p>}
      {diffs.map(([k, f]) => (
        <p key={k} className="text-[11px] leading-snug"><span className="capitalize">{k.replace(/_/g, " ")}</span> on the site: <span className="text-yellow-700 dark:text-yellow-500">{f.observed ?? "—"}</span> · yours: {f.expected ?? "—"}</p>
      ))}
      {candidate && <a href={candidate} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1 text-foreground" data-testid={`link-candidate-${c.id}`}>Open the likely listing <ExternalLink className="w-3 h-3" /></a>}
      {at && <p className="text-[10px] text-muted-foreground">Checked {new Date(at as any).toLocaleDateString()}</p>}
    </div>
  );
}

function CampaignDetail({ campaign, location, onBack }: { campaign: CitationCampaign; location: BusinessLocation; onBack: () => void }) {
  const { toast } = useToast();
  const key = ["/api/citations/campaigns", campaign.id, "results"];
  const { data, isLoading } = useQuery<{ campaign: CitationCampaign; citations: Citation[] }>({ queryKey: key });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    invalidateCampaigns();
  };

  // The audit (server/citations): progress polled while it runs, rows refreshed as it fills them in.
  const auditKey = [`/api/citations/campaigns/${campaign.id}/audit`];
  const auditQ = useQuery<AuditInfo>({ queryKey: auditKey, refetchInterval: (q) => { const s = (q.state.data as AuditInfo | undefined)?.audit?.status; return s === "queued" || s === "running" ? 2500 : false; } });
  const audit = auditQ.data?.audit ?? null;
  const auditRunning = audit?.status === "queued" || audit?.status === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (auditRunning) queryClient.invalidateQueries({ queryKey: key });
    if (wasRunning.current && !auditRunning) {
      refresh();
      if (audit?.status === "done") toast({ title: "Audit finished", description: summaryLine(audit.summary) || "Nothing could be read." });
      if (audit?.status === "failed") toast({ title: "Audit failed", description: audit.error ?? "", variant: "destructive" });
    }
    wasRunning.current = !!auditRunning;
  }, [auditRunning, audit?.done]);
  const auditMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/citations/campaigns/${campaign.id}/audit`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: auditKey }); refresh(); toast({ title: "Audit started", description: "Reading each directory. This takes a few minutes; rows fill in as it goes." }); },
    onError: (err: Error) => toast({ title: "Could not start the audit", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const res = await fetch(`/api/citations/campaigns/${campaign.id}/import`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text(), credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
      return res.json() as Promise<{ updated: number; skipped: { line: number; reason: string }[] }>;
    },
    onSuccess: (r) => { refresh(); toast({ title: `${r.updated} row${r.updated === 1 ? "" : "s"} updated from the spreadsheet`, description: r.skipped.length ? `${r.skipped.length} skipped — ${r.skipped.slice(0, 3).map((s) => `line ${s.line}: ${s.reason}`).join(" ")}` : undefined }); },
    onError: (err: Error) => toast({ title: "Import failed", description: apiErrorMessage(err), variant: "destructive" }),
  });

  const buildMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/citations/campaigns/${campaign.id}/run`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Checklist ready", description: "Use Search on each site, then mark what you find." }); },
    onError: (err: Error) => toast({ title: "Could not build checklist", description: apiErrorMessage(err), variant: "destructive" }),
  });
  type Status = "listed" | "wrong" | "missing" | "unchecked";
  const markMutation = useMutation({
    mutationFn: async (v: { id: number; status: Status; listingUrl?: string | null }) =>
      (await apiRequest("PATCH", `/api/citations/${v.id}`, { status: v.status, ...(v.listingUrl !== undefined ? { listingUrl: v.listingUrl } : {}) })).json(),
    onSuccess: refresh,
    onError: (err: Error) => toast({ title: "Could not save", description: apiErrorMessage(err), variant: "destructive" }),
  });
  const hasListing = (st: Status) => st === "listed" || st === "wrong";
  // A link only means something for a site where the business is listed.
  const setStatus = (c: Citation, status: Status) =>
    markMutation.mutate({ id: c.id, status, ...(!hasListing(status) && c.listingUrl ? { listingUrl: null } : {}) });
  const saveLink = (c: Citation, raw: string) => {
    const v = raw.trim();
    if (v === (c.listingUrl ?? "")) return;
    if (!v) return markMutation.mutate({ id: c.id, status: statusOf(c), listingUrl: null });
    let ok = false;
    try { ok = new URL(v).protocol === "https:"; } catch { /* not a URL */ }
    if (!ok) return toast({ title: "Check the link", description: "Enter the full link to your listing, starting with https://", variant: "destructive" });
    markMutation.mutate({ id: c.id, status: statusOf(c), listingUrl: v });
  };

  const rows = data?.citations ?? [];
  const statusOf = (c: Citation): Status =>
    c.isFound === true ? (c.napConsistent === false ? "wrong" : "listed") : c.isFound === false ? "missing" : "unchecked";
  const count = (st: Status) => rows.filter((r) => statusOf(r) === st).length;
  // Locations store the street line in `address` and the city separately. Only a legacy row with no city
  // holds Google's full "street, city, ST zip" string, where the city is the second part.
  const city = location.city?.trim() || campaign.address?.split(",")[1]?.trim() || "";
  const searchUrl = (c: Citation) => {
    // A Business Profile lives on Google Maps, not at a crawlable google.com URL.
    if (c.siteName === "Google Business Profile") {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${campaign.businessName} ${city}`.trim())}`;
    }
    const site = (c.siteUrl || "").replace(/^https?:\/\//, "");
    return `https://www.google.com/search?q=${encodeURIComponent(`site:${site} "${campaign.businessName}" ${city}`.trim())}`;
  };
  const tiles: [Status, string, string][] = [
    ["listed", "Listed & correct", "text-green-600"],
    ["wrong", "Listed, wrong info", "text-yellow-600"],
    ["missing", "Not listed", "text-red-600"],
    ["unchecked", "Not checked yet", "text-muted-foreground"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-campaigns">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h3 className="text-base font-semibold" data-testid="text-campaign-detail-name">{campaign.campaignName}</h3>
          <p className="text-xs text-muted-foreground">{campaign.businessName}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending || auditRunning || auditQ.data?.ready === false} title={auditQ.data?.readyReason ?? undefined} data-testid="button-run-audit">
            {auditRunning || auditMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ScanSearch className="w-4 h-4 mr-1" />}
            {auditRunning ? `Auditing ${audit?.done ?? 0}/${audit?.total ?? 0}` : rows.length ? "Run audit" : "Build & audit"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending} data-testid="button-run-scan">
            {buildMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            {rows.length ? "Update checklist" : "Build checklist"}
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importMutation.mutate(f); e.target.value = ""; }} data-testid="input-import-csv" />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={importMutation.isPending || !rows.length} data-testid="button-import-csv">
            {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />} Import CSV
          </Button>
          {rows.length > 0 && (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/citations/campaigns/${campaign.id}/export.csv`} download data-testid="link-export-csv"><Download className="w-4 h-4 mr-1" /> Export</a>
            </Button>
          )}
          <a href="/api/citations/template.csv" download className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="link-csv-template"><FileSpreadsheet className="w-3.5 h-3.5" /> Template</a>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Run audit</strong> reads each directory for you and records what it actually saw: listed and matching, listed with wrong
        details, not found, or “check by hand” when a site blocks programs. Those rows keep the <strong>Search</strong> link — look, then mark
        the row. <strong>Import CSV</strong> takes a spreadsheet of your listings (download the Template; in Excel use File → Save As → CSV).
        ConstructHUB never guesses: a site it could not read stays “Not checked”.
        {auditQ.data?.quota && auditQ.data.quota.limit !== 0 && (
          <> {auditQ.data.quota.limit < 0 ? "Audits: unlimited on your plan." : `Audits this month: ${auditQ.data.quota.used} of ${auditQ.data.quota.limit} used.`}</>
        )}
      </p>
      {audit && (
        <Card data-testid="card-audit-status">
          <CardContent className="p-3 text-xs space-y-1.5">
            {auditRunning ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading {audit.currentSite ?? "…"}</span>
                  <span>{audit.done} / {audit.total}</span>
                </div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${audit.total ? Math.round((audit.done / audit.total) * 100) : 0}%` }} /></div>
              </>
            ) : audit.status === "failed" ? (
              <p className="text-destructive">The last audit failed: {audit.error}</p>
            ) : (
              <p>Last audit {audit.finishedAt ? new Date(audit.finishedAt).toLocaleString() : ""}: {summaryLine(audit.summary) || "nothing could be read"}.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(([st, label, color]) => (
          <Card key={st}>
            <CardContent className="p-3 text-center">
              <p className={`text-xl font-bold ${color}`} data-testid={`text-citations-${st}`}>{count(st)}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">Click “Build checklist” to list the 30 sites contractors should be on.</p>
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader className={appTableCards.thead}>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Find it</TableHead>
                <TableHead>What you found</TableHead>
                <TableHead>Audit</TableHead>
                <TableHead>Your listing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow className={appTableCards.tr} key={c.id} data-testid={`row-citation-${c.id}`}>
                  <TableCell className={`${appTableCards.td} !text-foreground`}>
                    <p className="text-sm font-medium">{c.siteName}</p>
                    <p className="text-[10px] text-muted-foreground">{c.category}</p>
                  </TableCell>
                  <TableCell className={`${appTableCards.td} !text-foreground`}>
                    <a href={searchUrl(c)} target="_blank" rel="noopener noreferrer" className="text-foreground text-xs inline-flex items-center gap-1" data-testid={`link-search-${c.id}`}>
                      Search <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                  <TableCell className={`${appTableCards.td} !text-foreground`}>
                    <select
                      className="border rounded px-2 py-1 text-xs bg-background"
                      value={statusOf(c)}
                      disabled={markMutation.isPending}
                      onChange={(e) => setStatus(c, e.target.value as Status)}
                      data-testid={`select-citation-${c.id}`}
                      aria-label={`Status on ${c.siteName}`}
                    >
                      <option value="unchecked">Not checked</option>
                      <option value="listed">Listed ✓ (details correct)</option>
                      <option value="wrong">Listed — wrong name/address/phone</option>
                      <option value="missing">Not listed</option>
                    </select>
                    {c.checkSource && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{c.checkSource === "audit" ? "Set by the audit" : c.checkSource === "import" ? "From your spreadsheet" : "Your mark"}</p>
                    )}
                  </TableCell>
                  <TableCell className={`${appTableCards.td} !text-foreground max-w-[20rem]`}>
                    <AuditCell c={c} />
                  </TableCell>
                  <TableCell className={`${appTableCards.td} !text-foreground`}>
                    {hasListing(statusOf(c)) ? (
                      <div className="flex items-center gap-1.5 min-w-[12rem]">
                        <Input
                          key={`${c.id}:${c.listingUrl ?? ""}`}
                          type="url"
                          inputMode="url"
                          className="h-7 text-xs"
                          placeholder="Paste listing link (https://…)"
                          defaultValue={c.listingUrl ?? ""}
                          aria-label={`Your listing on ${c.siteName}`}
                          onBlur={(e) => saveLink(c, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                          data-testid={`input-listing-${c.id}`}
                        />
                        {c.listingUrl && (
                          <>
                            <a href={c.listingUrl} target="_blank" rel="noopener noreferrer" className="text-foreground text-xs inline-flex items-center gap-1 shrink-0" data-testid={`link-listing-${c.id}`}>
                              View <ExternalLink className="w-3 h-3" />
                            </a>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={markMutation.isPending}
                              aria-label={`Clear the ${c.siteName} link`} onClick={() => markMutation.mutate({ id: c.id, status: statusOf(c), listingUrl: null })}
                              data-testid={`button-clear-listing-${c.id}`}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
