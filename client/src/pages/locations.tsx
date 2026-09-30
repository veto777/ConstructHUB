import { ProfileGuard, GuardStatus } from "@/components/profile-guard";
import { GbpConnection, GbpLinkCell } from "@/components/gbp-connection";
import { InfoTip } from "@/components/info-tip";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BusinessLocation, CitationCampaign, Citation } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
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


export default function LocationsPage() {
  const { toast } = useToast();
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { data: subscription } = useQuery<{ plan: string; status: string }>({
    queryKey: ["/api/stripe/subscription"],
  });

  const isPlatinum = subscription?.plan === "platinum" && (subscription?.status === "active" || subscription?.status === "trialing");
  const isPremiumPlus = (subscription?.plan === "premium" || subscription?.plan === "platinum") && (subscription?.status === "active" || subscription?.status === "trialing");
  const isDev = import.meta.env.DEV;

  const { data: locations, isLoading } = useQuery<BusinessLocation[]>({
    queryKey: ["/api/locations"],
  });

  const selectedLocation = locations?.find(l => l.id === selectedLocationId) ?? null;

  if (selectedLocation) {
    return (
      <LocationDetail
        location={selectedLocation}
        onBack={() => setSelectedLocationId(null)}
        isPremiumPlus={isPremiumPlus || isDev}
      />
    );
  }

  const filtered = locations?.filter(l =>
    !searchFilter ||
    l.businessName.toLowerCase().includes(searchFilter.toLowerCase()) ||
    (l.address && l.address.toLowerCase().includes(searchFilter.toLowerCase()))
  ) ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <GbpConnection />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-locations-title">
              <MapPin className="w-6 h-6 text-primary" />
              GMB Locations
            </h1>
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316] mt-1" />
            <p className="text-muted-foreground text-sm mt-1 max-w-lg">
              Manage business locations, sync Google reviews and performance, and run citation campaigns.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 w-56"
                placeholder="Search locations..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                data-testid="input-search-locations"
              />
            </div>
            {(isPlatinum || isDev) ? (
              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-location">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Location(s)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto top-[5%] translate-y-0">
                  <DialogHeader>
                    <DialogTitle>Add Location</DialogTitle>
                  </DialogHeader>
                  <AddLocationDialog
                    onCreated={() => {
                      setAddDialogOpen(false);
                      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
                    }}
                  />
                </DialogContent>
              </Dialog>
            ) : (
              <Button variant="outline" disabled data-testid="button-add-location-locked">
                <Lock className="w-4 h-4 mr-2" />
                Platinum Required
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground space-y-3">
            <Building2 className="w-12 h-12 mx-auto opacity-40" />
            <p className="text-lg font-medium">No locations yet</p>
            <p className="text-sm">Add your first business location to get started.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-center">Listings</TableHead>
                  <TableHead className="text-center">Reviews</TableHead>
                  <TableHead className="text-center">Performance</TableHead>
                  <TableHead className="text-center">Avg. Rank</TableHead>
                  <TableHead>Google account</TableHead>
                  <TableHead>Date Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(loc => (
                  <TableRow
                    key={loc.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedLocationId(loc.id)}
                    data-testid={`row-location-${loc.id}`}
                  >
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-medium text-sm" data-testid={`text-location-name-${loc.id}`}>{loc.businessName}</p>
                        {loc.placeId && (
                          <p className="text-[10px] text-muted-foreground font-mono truncate max-w-xs">{loc.placeId}</p>
                        )}
                        {loc.address && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {loc.address}{loc.city ? `, ${loc.city}` : ""}{loc.state ? `, ${loc.state}` : ""} {loc.zipCode || ""}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium" data-testid={`text-listings-${loc.id}`}>
                        Unavailable
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-reviews-${loc.id}`}>
                          See reviews
                        </span>

                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium" data-testid={`text-monthly-views-${loc.id}`}>
                        Open insights
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm">Unavailable</span>
                    </TableCell>
                    <TableCell>
                      <GbpLinkCell locationId={loc.id} /><GuardStatus id={loc.id} />
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground" data-testid={`text-date-${loc.id}`}>
                        {loc.createdAt ? new Date(loc.createdAt).toLocaleDateString() : "-"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  );
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
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await apiRequest("POST", "/api/locations/search-google", { query: searchQuery });
      const data = await res.json();
      setSearchResults(data.results || []);
      if (!data.results?.length) {
        toast({ title: "No results found", description: "Try a different search term." });
      }
    } catch {
      toast({ title: "Search failed", variant: "destructive" });
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
      toast({ title: "Failed to add location", description: err.message, variant: "destructive" });
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
        setGbpError(msg);
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
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
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
                  <p className="text-xs text-muted-foreground truncate">{r.address}</p>
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

function LocationDetail({ location, onBack, isPremiumPlus }: {
  location: BusinessLocation;
  onBack: () => void;
  isPremiumPlus: boolean;
}) {
  const [activeTab, setActiveTab] = useState("insights");

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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-detail-name">{location.businessName}</h1>
            {location.address && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {location.address}{location.city ? `, ${location.city}` : ""}{location.state ? `, ${location.state}` : ""} {location.zipCode || ""}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-6">
          <div className="w-48 shrink-0 space-y-1">
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
            {activeTab === "insights" && <InsightsTab location={location} />}
            {activeTab === "guard" && <ProfileGuard locationId={location.id} linked={!!location.gbpLocationName} />}
            {activeTab === "info" && <LocationInfoTab location={location} />}
            {activeTab === "services" && <ServicesTab location={location} />}
            {activeTab === "photos" && <PhotosTab location={location} />}
            {activeTab === "social" && <SocialProfilesTab location={location} />}
            {activeTab === "settings" && <SettingsTab location={location} />}
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

function InsightsTab({ location }: { location: BusinessLocation }) {
  const {data,error,isLoading}=useQuery<{available:boolean;source:string;metrics:string[];rows:{date:string;metric:string;value:string}[]}>({queryKey:['/api/gbp/locations',location.id,'performance']});
  const dates=[...new Set(data?.rows.map(r=>r.date)||[])].reverse();
  const labels:Record<string,string>={BUSINESS_IMPRESSIONS_DESKTOP_MAPS:'Maps desktop',BUSINESS_IMPRESSIONS_DESKTOP_SEARCH:'Search desktop',BUSINESS_IMPRESSIONS_MOBILE_MAPS:'Maps mobile',BUSINESS_IMPRESSIONS_MOBILE_SEARCH:'Search mobile',WEBSITE_CLICKS:'Website clicks',CALL_CLICKS:'Call clicks',BUSINESS_DIRECTION_REQUESTS:'Directions'};
  return <div className="space-y-4"><GbpConnection locationId={location.id} />
    <h3 className="font-semibold">Google performance — last 90 days</h3>
    <p className="text-sm text-muted-foreground">Daily values reported by Google. Missing metrics are unavailable; zero means Google reported zero. Recent days may be delayed.</p>
    {isLoading?<p>Loading performance…</p>:error?<p role="alert">Unable to load performance.</p>:!data?.available?<p>Performance unavailable. Import a Google location and sync to retrieve real metrics.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Date</th>{data.metrics.map(m=><th className="p-2" key={m}>{labels[m]||m}</th>)}</tr></thead><tbody>{dates.map(date=><tr key={date}><td className="p-2">{date}</td>{data.metrics.map(metric=><td className="p-2 text-center" key={metric}>{data.rows.find(r=>r.date===date&&r.metric===metric)?.value??'Unavailable'}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}

function GoogleIcon() {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-blue-500/10 text-[9px] font-bold text-blue-500 shrink-0">G</span>
  );
}

function InfoRow({ label, value, fromGoogle }: { label: string; value: string | null | undefined; fromGoogle?: boolean }) {
  return (
    <div className="flex items-start py-2.5 border-b border-border/30 last:border-0">
      <div className="w-44 shrink-0 text-sm text-muted-foreground flex items-center gap-1.5">
        {fromGoogle && <GoogleIcon />}
        {label}
      </div>
      <div className="flex-1 text-sm" data-testid={`info-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value || <span className="text-muted-foreground italic">Not set</span>}
      </div>
    </div>
  );
}

function LocationInfoTab({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const hasGoogle = !!location.placeId;

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/locations/${location.id}/import-google`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Google data imported" });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  const hoursDisplay = location.hours
    ? (typeof location.hours === "object"
      ? Object.entries(location.hours as Record<string, string>).map(([day, hrs]) => `${day}: ${hrs}`).join(", ")
      : String(location.hours))
    : null;

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
        <InfoRow label="Google Business Profile ID" value={location.placeId} fromGoogle={hasGoogle} />
        <InfoRow label="Google CID" value={location.googleCid} fromGoogle={hasGoogle} />
        <InfoRow label="Business Name" value={location.businessName} fromGoogle={hasGoogle} />
        <InfoRow label="Description" value={location.description} />
        <InfoRow label="Address" value={[location.address, location.city, location.state, location.zipCode].filter(Boolean).join(", ")} fromGoogle={hasGoogle} />
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
        <InfoRow label="Open Status" value={location.openStatus} />
      </CardContent>
    </Card>
  );
}

function ServicesTab({ location }: { location: BusinessLocation }) {
  const primaryCategory = location.categories?.[0] || "Uncategorized";
  const services = location.services || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {primaryCategory}
          <Badge variant="outline" className="text-xs">{services.length}/100</Badge>
        </CardTitle>
        <CardDescription>Services already added to your GBP</CardDescription>
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No services added yet.</p>
        ) : (
          <div className="space-y-1">
            {services.map((svc, i) => (
              <div key={i} className="flex items-center gap-2 py-2 border-b border-border/30 last:border-0" data-testid={`service-row-${i}`}>
                <Check className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-sm">{svc}</span>
              </div>
            ))}
          </div>
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
  const tile = (n: number | null | undefined, label: string, which: "business" | "customer") => (
    <button type="button" onClick={() => { setSource(which); setLimit(60); }}
      className={`rounded-lg border p-4 text-center transition-colors ${source === which ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
      data-testid={`tab-photos-${which}`}>
      <p className="text-2xl font-bold" data-testid={`text-${which}-photo-count`}>{n || 0}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/locations/${location.id}`, { socialProfiles: values });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Social profiles saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
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
          <div key={platform.key} className="flex items-center gap-3">
            <platform.Icon className="w-5 h-5 shrink-0 text-muted-foreground" />
            <Label className="w-24 shrink-0 text-sm">{platform.label}</Label>
            <Input
              className="flex-1"
              placeholder={`https://${platform.key}.com/...`}
              value={values[platform.key]}
              onChange={e => setValues(v => ({ ...v, [platform.key]: e.target.value }))}
              data-testid={`input-social-${platform.key}`}
            />
          </div>
        ))}
        <Button
          className="w-full mt-2"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-social"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
          Save Social Profiles
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const [useAccountSettings, setUseAccountSettings] = useState(true);
  const [notificationEmail, setNotificationEmail] = useState(location.notificationEmail || "");
  const [gbpEnabled, setGbpEnabled] = useState(location.gbpManagementEnabled || false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/locations/${location.id}`, {
        notificationEmail,
        gbpManagementEnabled: gbpEnabled,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/locations/${location.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location deleted" });
      window.location.href = "/locations";
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Local management preferences</CardTitle>
          <p className="text-sm text-muted-foreground">These preferences are saved in ConstructHUB. Notification delivery and Google profile edits are not enabled here. Imported Google locations sync automatically every six hours while connected.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Use account-level settings</Label>
            <Switch
              checked={useAccountSettings}
              onCheckedChange={setUseAccountSettings}
              data-testid="switch-account-settings"
            />
          </div>
          {!useAccountSettings && (
            <>
              <div className="space-y-1.5">
                <Label className="text-sm">Notification Email</Label>
                <Input
                  value={notificationEmail}
                  onChange={e => setNotificationEmail(e.target.value)}
                  placeholder="email@example.com"
                  data-testid="input-notification-email"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Only fields: {location.notifyFields?.join(", ") || "All fields"}
                </p>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <Label className="text-sm">GBP Management Enabled</Label>
            <Switch
              checked={gbpEnabled}
              onCheckedChange={setGbpEnabled}
              data-testid="switch-gbp-management"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1">
                <p className="text-sm font-medium text-destructive">Delete Location</p>
                <InfoTip k="delete-location" />
              </div>
              <p className="text-xs text-muted-foreground">Removes it from ConstructHUB only — your Google Business Profile listing is not affected. This cannot be undone.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-location"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CitationsTab({ location }: { location: BusinessLocation }) {
  const { toast } = useToast();
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  const { data: campaigns, isLoading } = useQuery<CitationCampaign[]>({
    queryKey: ["/api/citations/campaigns"],
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
      queryClient.invalidateQueries({ queryKey: ["/api/citations/campaigns"] });
      setCampaignName("");
      setShowNewCampaign(false);
      toast({ title: "Campaign created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/citations/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/citations/campaigns"] });
      setSelectedCampaignId(null);
      toast({ title: "Campaign deleted" });
    },
  });

  if (selectedCampaignId) {
    const campaign = locationCampaigns.find(c => c.id === selectedCampaignId);
    if (campaign) {
      return <CampaignDetail campaign={campaign} onBack={() => setSelectedCampaignId(null)} />;
    }
  }

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
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label>Campaign Name</Label>
              <Input
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g. Spring 2026 listings check"
                data-testid="input-campaign-name"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                data-testid="button-create-campaign"
              >
                {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                Create
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewCampaign(false)} data-testid="button-cancel-campaign">
                Cancel
              </Button>
            </div>
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
                      onClick={e => { e.stopPropagation(); deleteMutation.mutate(campaign.id); }}
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
    </div>
  );
}

function CampaignDetail({ campaign, onBack }: { campaign: CitationCampaign; onBack: () => void }) {
  const { toast } = useToast();
  const key = ["/api/citations/campaigns", campaign.id, "results"];
  const { data, isLoading } = useQuery<{ campaign: CitationCampaign; citations: Citation[] }>({ queryKey: key });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/citations/campaigns"] });
  };

  const buildMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/citations/campaigns/${campaign.id}/run`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Checklist ready", description: "Use Search on each site, then mark what you find." }); },
    onError: (err: Error) => toast({ title: "Could not build checklist", description: err.message, variant: "destructive" }),
  });
  type Status = "listed" | "wrong" | "missing" | "unchecked";
  const markMutation = useMutation({
    mutationFn: async (v: { id: number; status: Status; listingUrl?: string | null }) =>
      (await apiRequest("PATCH", `/api/citations/${v.id}`, { status: v.status, ...(v.listingUrl !== undefined ? { listingUrl: v.listingUrl } : {}) })).json(),
    onSuccess: refresh,
    onError: (err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }),
  });

  const rows = data?.citations ?? [];
  const statusOf = (c: Citation): Status =>
    c.isFound === true ? (c.napConsistent === false ? "wrong" : "listed") : c.isFound === false ? "missing" : "unchecked";
  const count = (st: Status) => rows.filter((r) => statusOf(r) === st).length;
  const city = campaign.address?.split(",")[1]?.trim() ?? "";
  const searchUrl = (c: Citation) => {
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
                      onChange={(e) => markMutation.mutate({ id: c.id, status: e.target.value as Status })}
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
                    {c.listingUrl ? (
                      <a href={c.listingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs inline-flex items-center gap-1" data-testid={`link-listing-${c.id}`}>
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : statusOf(c) === "listed" || statusOf(c) === "wrong" ? (
                      <Input
                        className="h-7 text-xs"
                        placeholder="Paste listing link (https://…)"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v) markMutation.mutate({ id: c.id, status: statusOf(c), listingUrl: v });
                        }}
                        data-testid={`input-listing-${c.id}`}
                      />
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
