import { AgencyWorkspace, Pager, useAgencyFilter } from "@/components/agency-workspace";
import { LocationSearchSummary } from "./site-connections";
import { ProfileGuard, GuardStatus } from "@/components/profile-guard";
import { GbpConnection } from "@/components/gbp-connection";
import { startGbpConnect } from "@/components/recent-auth";
import { InfoTip } from "@/components/info-tip";
import { useEffect, useRef, useState } from "react";
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
  Eye, MousePointerClick, Smartphone, Monitor,
} from "lucide-react";
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
/** Street line plus city, state and ZIP. New locations store only the street line in `address`; older rows
 *  (and Places text-search adds) hold Google's full formatted address, so don't append the locality twice. */
function fullAddress(l: Pick<BusinessLocation, "address" | "city" | "state" | "zipCode">): string {
  const street = l.address?.trim() || "";
  if (street && l.city && l.state && street.includes(`${l.city}, ${l.state}`)) return street;
  return [street, l.city, [l.state, l.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

const refreshLocationLists = () => ["/api/locations", "/api/agency/locations", "/api/agency/dashboard", "/api/gbp/linkage", "/api/gbp/status"]
  .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

export default function LocationsPage() {
  const { toast } = useToast();
  const [locationParam] = useUrlParam("location");
  const [gbpParam, setGbpParam] = useUrlParam("gbp");
  const [addDialogOpen,setAddDialogOpen]=useState(false);
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
  if(locationParam&&selectedLocation)return <LocationDetail location={selectedLocation} onBack={()=>showLocation(null)} onDeleted={()=>{showLocation(null);queryClient.removeQueries({queryKey:["/api/locations",locationParam],exact:true});refreshLocationLists();}} isPremiumPlus={true}/>;
  return <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold" data-testid="text-locations-title">Business Profile Locations</h1>
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}><DialogTrigger asChild><Button data-testid="button-add-location">Add Location(s)</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>Add Location</DialogTitle></DialogHeader><AddLocationDialog onCreated={()=>{setAddDialogOpen(false);refreshLocationLists();}}/></DialogContent></Dialog>
    </div>
    {notFound&&<div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm" data-testid="alert-location-not-found">
      <span>Location #{notFound} was not found, or you don't have access to it.</span>
      <Button size="sm" variant="ghost" onClick={()=>setNotFound(null)}>Dismiss</Button>
    </div>}
    <AgencyWorkspace onOpen={id=>{setNotFound(null);showLocation(String(id));}}/>
    <GbpConnection context="locations"/>
  </main>;
}

function AddLocationDialog({ onCreated, hasGbpAccess }: { onCreated: () => void; hasGbpAccess?: boolean }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("search");
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
        if (data.locations.length === 0) {
          setGbpError("No business locations found in your Google account.");
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

  return (
    <Tabs value={tab} onValueChange={v => { setTab(v); if (v === "gbp" && gbpLocations.length === 0 && !gbpLoading) fetchGbpLocations(); }} className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="search" className="flex-1" data-testid="tab-search-google">Search Google</TabsTrigger>
        <TabsTrigger value="gbp" className="flex-1" data-testid="tab-import-gbp">Import from GBP</TabsTrigger>
      </TabsList>
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
        {gbpLoading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading your Google Business Profiles...</p>
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
            <Button onClick={importGbpLocations} disabled={selectedGbp.size === 0} className="w-full gap-2" data-testid="button-import-gbp">
              <Plus className="w-4 h-4" />
              Import {selectedGbp.size > 0 ? `${selectedGbp.size} Location${selectedGbp.size !== 1 ? "s" : ""}` : "Selected"}
            </Button>
          </div>
        )}
        {!gbpLoading && !gbpError && gbpLocations.length === 0 && !hasGbpAccess && (
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

  const tabItems = [
    { value: "insights", label: "Insights", icon: BarChart3 },
    { value: "guard", label: "Profile Guard", icon: Lock },
    { value: "info", label: "Location Info", icon: Building2 },
    { value: "services", label: "Services", icon: Tag },
    { value: "photos", label: "Photos & Videos", icon: Image },
    { value: "social", label: "Social Profiles", icon: Link2 },
    { value: "settings", label: "Settings", icon: Settings },
    { value: "citations", label: "Citations", icon: Globe },
  ];
  // An unknown (?tab=reviews) or locked tab falls back to Insights instead of an empty pane.
  const validTab = tabItems.some((t) => t.value === tabParam && !(t.value === "citations" && !isPremiumPlus));
  const activeTab = validTab ? tabParam! : "insights";
  useEffect(() => { if (tabParam && !validTab) setTabParam(null); }, [tabParam, validTab]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <AgencyWorkspace compact/>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-detail-name">{location.businessName}</h1>
            {location.address && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {fullAddress(location)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:block md:w-48 shrink-0 gap-1 md:space-y-1">
            {tabItems.map(item => {
              const isLocked = item.value === "citations" && !isPremiumPlus;
              return (
                <Button
                  key={item.value}
                  variant={activeTab === item.value ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2 text-sm"
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
            {activeTab === "insights" && <div className="space-y-4"><LocationSearchSummary locationId={location.id}/><InsightsTab location={location} /></div>}
            {activeTab === "guard" && <ProfileGuard locationId={location.id} linked={!!location.gbpLocationName} />}
            {activeTab === "info" && <LocationInfoTab location={location} />}
            {activeTab === "services" && <ServicesTab location={location} />}
            {activeTab === "photos" && <PhotosTab location={location} />}
            {activeTab === "social" && <SocialProfilesTab location={location} />}
            {activeTab === "settings" && <SettingsTab location={location} onDeleted={onDeleted} />}
            {activeTab === "citations" && <CitationsTab location={location} />}
          </div>
        </div>
      </div>
    </div>
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
        <p>Performance unavailable. Link this location to Google and sync to retrieve real metrics.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-performance">
            <thead><tr>
              <th className="p-2 text-left">{group === "day" ? "Date" : group === "week" ? "Week" : "Month"}</th>
              {data.metrics.map((m) => <th className="p-2" key={m}>{PERF_LABELS[m] || m}</th>)}
            </tr></thead>
            <tbody>
              <tr className="border-b font-semibold bg-muted/40" data-testid="row-performance-total">
                <td className="p-2">Total</td>
                {data.metrics.map((m) => <td className="p-2 text-center" key={m}>{total(m).toLocaleString()}</td>)}
              </tr>
              {periods.map((p) => (
                <tr key={p} className={pending(p) ? "text-muted-foreground" : ""}>
                  <td className="p-2 whitespace-nowrap">{label(p)}{pending(p) && <span className="ml-2 text-[10px] rounded bg-muted px-1.5 py-0.5" title="Google reports with a delay of a few days">not final yet</span>}</td>
                  {data.metrics.map((m) => <td className="p-2 text-center" key={m}>{cell(p, m) ? Number(cell(p, m)!.value).toLocaleString() : "—"}</td>)}
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
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-blue-500/10 text-[9px] font-bold text-blue-500 shrink-0">G</span>
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

function PhotosTab({ location }: { location: BusinessLocation }) {
  const [source, setSource] = useState<"business" | "customer">("business");
  const [limit, setLimit] = useState(60);
  const linked = !!location.gbpLocationName;
  const { data, isLoading } = useQuery<{ total: number; syncedAt: string | null; items: any[] }>({
    queryKey: [`/api/gbp/locations/${location.id}/media?source=${source}&limit=${limit}`],
    enabled: linked,
  });
  // Photo counts come only from a Business Profile sync. Unlinked, the stored value is the schema default (0)
  // or an old capped Places value, so show unknown instead of a number. A linked count Google never
  // reported (null) is unknown too, never 0.
  const tile = (n: number | null | undefined, label: string, which: "business" | "customer") => (
    <button type="button" onClick={() => { setSource(which); setLimit(60); }}
      className={`rounded-lg border p-4 text-center transition-colors ${source === which ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
      data-testid={`tab-photos-${which}`}>
      <p className="text-2xl font-bold" data-testid={`text-${which}-photo-count`}>{linked && n != null ? n : "—"}</p>
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
          No {source} photos synced yet. Use <strong>Sync now</strong> on the Locations page — photos sync along with reviews and performance.
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

      <Button variant="outline" className="w-full gap-2" onClick={() => (window.location.href = "/gbp-content")} data-testid="button-posts-photos">
        <Image className="w-4 h-4" /> Add or schedule photos in Posts &amp; Photos
      </Button>
    </div>
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
  // Mirrors the server: each link is blank or a full https:// URL.
  const invalid = new Set(SOCIAL_PLATFORMS.map(p => p.key).filter(k => values[k].trim() !== "" && !isHttpsLink(values[k].trim())));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      const res = await apiRequest("PUT", `/api/locations/${location.id}`, { socialProfiles: trimmed });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Social profiles saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Social Profiles</CardTitle>
        <CardDescription>Add your social media URLs</CardDescription>
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
                Enter the full link, starting with https://
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
function isHttpsLink(v: string): boolean {
  try { return new URL(v).protocol === "https:"; } catch { return false; }
}

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
      toast({ title: "Location deleted", description: `${location.businessName} was removed from ConstructHUB. Your Google listing is unchanged.` });
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
                <p>Your listing on Google is not changed. ConstructHUB permanently removes its own copy:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>synced Google reviews, photos and performance stats</li>
                  <li>Profile Guard settings and history</li>
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
          <p className="text-xs text-muted-foreground max-w-xl">A citation is any website that lists your business name, address and phone number — Yelp, BBB, Angi, Apple Maps and so on. Being listed, with the same details everywhere, helps you show up in Google Maps.</p>
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

function CampaignDetail({ campaign, location, onBack }: { campaign: CitationCampaign; location: BusinessLocation; onBack: () => void }) {
  const { toast } = useToast();
  const key = ["/api/citations/campaigns", campaign.id, "results"];
  const { data, isLoading } = useQuery<{ campaign: CitationCampaign; citations: Citation[] }>({ queryKey: key });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    invalidateCampaigns();
  };

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
        <div className="ml-auto">
          <Button size="sm" onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending} data-testid="button-run-scan">
            {buildMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            {rows.length ? "Update checklist" : "Build checklist"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        For each site, click <strong>Search</strong> — it looks for your business on that site through Google. Then mark what you
        found. ConstructHUB doesn't guess: a site stays “Not checked” until you mark it.
      </p>

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
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Find it</TableHead>
                <TableHead>What you found</TableHead>
                <TableHead>Your listing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id} data-testid={`row-citation-${c.id}`}>
                  <TableCell>
                    <p className="text-sm font-medium">{c.siteName}</p>
                    <p className="text-[10px] text-muted-foreground">{c.category}</p>
                  </TableCell>
                  <TableCell>
                    <a href={searchUrl(c)} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs inline-flex items-center gap-1" data-testid={`link-search-${c.id}`}>
                      Search <ExternalLink className="w-3 h-3" />
                    </a>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
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
                            <a href={c.listingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs inline-flex items-center gap-1 shrink-0" data-testid={`link-listing-${c.id}`}>
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
