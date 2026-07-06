import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  MapPin,
  User,
  Building2,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Navigation,
  SkipForward,
  Database,
  SlidersHorizontal,
  CalendarDays,
  X,
  Tag,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  Hash,
  Users,
  Eye,
  Building,
  ExternalLink,
  Info,
  Globe,
} from "lucide-react";
import type { PermitDatabase, County } from "@shared/schema";

const propertyAppraiserUrls: Record<number, string> = {
  5: "https://www.pcpao.gov/quick-search",
  6: "https://gis.hcpafl.org/propertysearch/#/nav/Basic%20Search",
  7: "https://www.manateepao.gov/search/",
  8: "https://www.sc-pa.com/propertysearch",
};

function getPropertyLookupUrl(countyId: number, address: string): string {
  return propertyAppraiserUrls[countyId] || "#";
}

function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "Unknown";
  const s = status.toLowerCase().trim();
  if (s.includes("expired")) return "Expired";
  if (s.includes("complete") || s.includes("closed")) return "Complete";
  if (s.includes("final") || s.includes("finaled")) return "Final";
  if (s.includes("pending") || s.includes("applied") || s.includes("in progress") || s.includes("review") || s.includes("submitted")) return "Pending";
  if (s.includes("issued") || s.includes("approved") || s.includes("active")) return "Issued";
  if (s.includes("denied") || s.includes("cancelled") || s.includes("void") || s.includes("revoked")) return "Denied/Cancelled";
  if (s.includes("fee") || s.includes("owed")) return "Fees Owed";
  const trimmed = status.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

const searchTypes = [
  { value: "address", label: "Address", icon: MapPin },
  { value: "keyword", label: "Keyword", icon: Tag },
  { value: "name", label: "Name", icon: User },
  { value: "company", label: "Company Name", icon: Building2 },
  { value: "license", label: "License #", icon: FileText },
  { value: "permit", label: "Permit #", icon: FileText },
];

interface LiveDatabase {
  id: number;
  name: string;
  jurisdiction: string | null;
  countyId: number;
  platform: string | null;
  status: "pending" | "running" | "completed" | "error" | "skipped";
  message: string;
  resultsFound: number;
}

interface LiveSearchStatus {
  status: "running" | "completed";
  databases: LiveDatabase[];
  results: any[];
  totalResults: number;
  totalResultsScraped: number;
  elapsedMs: number;
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const parts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (parts) {
    return new Date(parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  const iso = new Date(dateStr);
  return isNaN(iso.getTime()) ? null : iso;
}

export default function SearchPage() {
  const { toast } = useToast();
  const [searchType, setSearchType] = useState("address");
  const [searchValue, setSearchValue] = useState("");
  const [scopeLocation, setScopeLocation] = useState<string>("all");
  const [scopeState, setScopeState] = useState<string>("all");
  const [locationSearch, setLocationSearch] = useState("");
  const [searchId, setSearchId] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveSearchStatus | null>(null);
  const [initialResults, setInitialResults] = useState<any[] | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
  const [permitDetails, setPermitDetails] = useState<Record<number, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<number>>(new Set());

  const [showFilters, setShowFilters] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCounty, setFilterCounty] = useState<string>("all");
  const [filterJurisdiction, setFilterJurisdiction] = useState<string>("all");
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());

  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const { data: dbCounts } = useQuery<{ total: number; county: number; city: number }>({
    queryKey: ["/api/databases/counts"],
  });

  const { data: databases } = useQuery<PermitDatabase[]>({
    queryKey: ["/api/databases/county-state", scopeState],
    queryFn: async () => {
      if (scopeState === "all") return [];
      const res = await fetch(`/api/databases?filtered=true&stateCode=${scopeState}&limit=5000`);
      if (!res.ok) return [];
      const result = await res.json();
      return result.databases;
    },
    enabled: scopeState !== "all",
  });

  const allStates = useMemo(() => {
    if (!counties) return [];
    const stateMap = new Map<string, string>();
    counties.forEach(c => {
      if (!stateMap.has(c.stateCode)) {
        stateMap.set(c.stateCode, c.state);
      }
    });
    return Array.from(stateMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [counties]);

  const selectedStateName = useMemo(() => {
    if (scopeState === "all") return null;
    return allStates.find(s => s.code === scopeState)?.name ?? scopeState;
  }, [scopeState, allStates]);

  const stateCounties = useMemo(() => {
    if (!counties) return [];
    if (scopeState === "all") return counties;
    return counties.filter(c => c.stateCode === scopeState);
  }, [counties, scopeState]);

  const filteredLocationOptions = useMemo(() => {
    const search = locationSearch.toLowerCase().trim();
    const stateFilteredCounties = stateCounties;
    const stateFilteredDbs = databases?.filter(d => {
      const county = counties?.find(c => c.id === d.countyId);
      if (!county) return false;
      if (scopeState !== "all" && county.stateCode !== scopeState) return false;
      return d.isActive;
    }) ?? [];

    if (!search) {
      return { counties: stateFilteredCounties, databases: stateFilteredDbs };
    }

    const matchedCounties = stateFilteredCounties.filter(c =>
      c.name.toLowerCase().includes(search) || c.state.toLowerCase().includes(search)
    );
    const matchedCountyIds = new Set(matchedCounties.map(c => c.id));

    const matchedDbs = stateFilteredDbs.filter(d =>
      d.jurisdiction?.toLowerCase().includes(search) ||
      d.name.toLowerCase().includes(search) ||
      matchedCountyIds.has(d.countyId)
    );

    const dbCountyIds = new Set(matchedDbs.map(d => d.countyId));
    const allMatchedCounties = stateFilteredCounties.filter(c =>
      matchedCountyIds.has(c.id) || dbCountyIds.has(c.id)
    );

    return { counties: allMatchedCounties, databases: matchedDbs };
  }, [stateCounties, databases, counties, scopeState, locationSearch]);

  const scopeCountyId = useMemo(() => {
    if (scopeLocation === "all") return null;
    if (scopeLocation.startsWith("state-")) return null;
    if (scopeLocation.startsWith("county-")) return parseInt(scopeLocation.replace("county-", ""));
    if (scopeLocation.startsWith("city-")) {
      const dbId = parseInt(scopeLocation.replace("city-", ""));
      const db = databases?.find(d => d.id === dbId);
      return db?.countyId ?? null;
    }
    return null;
  }, [scopeLocation, databases]);

  const scopeLabel = useMemo(() => {
    if (scopeLocation === "all") return null;
    if (scopeLocation.startsWith("county-")) {
      const id = parseInt(scopeLocation.replace("county-", ""));
      return counties?.find(c => c.id === id)?.name + " County";
    }
    if (scopeLocation.startsWith("city-")) {
      const dbId = parseInt(scopeLocation.replace("city-", ""));
      const db = databases?.find(d => d.id === dbId);
      if (!db) return null;
      const county = counties?.find(c => c.id === db.countyId);
      return `${db.jurisdiction} (${county?.name} County)`;
    }
    return null;
  }, [scopeLocation, databases, counties]);

  const scopedDbCount = useMemo(() => {
    if (!databases) return 0;
    const active = databases.filter(d => d.isActive);
    if (scopeLocation === "all" && scopeState === "all") return active.length;
    if (scopeLocation === "all" && scopeState !== "all") {
      const stateCountyIds = new Set(counties?.filter(c => c.stateCode === scopeState).map(c => c.id) ?? []);
      return active.filter(d => stateCountyIds.has(d.countyId)).length;
    }
    if (!scopeCountyId) return active.length;
    return active.filter(d => d.countyId === scopeCountyId).length;
  }, [databases, scopeCountyId, scopeState, scopeLocation, counties]);

  const searchMutation = useMutation({
    mutationFn: async (payload: { searchType: string; searchValue: string; scopeCountyId: number | null; scopeState?: string }) => {
      const res = await apiRequest("POST", "/api/search", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
      setInitialResults(data.results);
      setSearchId(data.searchId);
      setLiveStatus(null);
    },
    onError: (err: Error) => {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!searchId) return;

    if (pollingRef.current) clearInterval(pollingRef.current);

    const poll = async () => {
      try {
        const res = await fetch(`/api/search/live/${searchId}`);
        if (res.ok) {
          const data: LiveSearchStatus = await res.json();
          setLiveStatus(data);
          if (data.status === "completed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {}
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [searchId]);

  const handleSearch = () => {
    if (!searchValue.trim()) {
      toast({ title: "Enter a search value", variant: "destructive" });
      return;
    }
    setSearchId(null);
    setLiveStatus(null);
    setInitialResults(null);
    searchMutation.mutate({
      searchType,
      searchValue: searchValue.trim(),
      scopeCountyId,
      scopeState: scopeState !== "all" ? scopeState : undefined,
    });
  };

  const rawResults = liveStatus?.results ?? initialResults ?? [];

  const availableStatuses = useMemo(() => {
    const counts = new Map<string, number>();
    rawResults.forEach((r: any) => {
      const normalized = normalizeStatus(r.status);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));
  }, [rawResults]);

  const isAllStatuses = filterStatuses.size === 0;

  const toggleStatus = (status: string) => {
    setFilterStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const toggleAllStatuses = () => {
    setFilterStatuses(new Set());
  };

  const jurisdictions = useMemo(() => {
    const set = new Set<string>();
    let source = rawResults;
    if (filterCounty !== "all") {
      const countyId = parseInt(filterCounty);
      const countyObj = counties?.find(c => c.id === countyId);
      const countyName = countyObj?.name;
      source = rawResults.filter((r: any) =>
        r.countyId === countyId || (countyName && r.countyName?.includes(countyName))
      );
    }
    source.forEach((r: any) => {
      const j = r.jurisdiction || r.databaseName;
      if (j) set.add(j);
    });
    return Array.from(set).sort();
  }, [rawResults, filterCounty, counties]);

  const filteredResults = useMemo(() => {
    let results = rawResults;

    if (filterDateFrom) {
      const from = new Date(filterDateFrom);
      results = results.filter((r: any) => {
        const d = parseDate(r.issuedDate);
        return d ? d >= from : false;
      });
    }
    if (filterDateTo) {
      const to = new Date(filterDateTo);
      to.setHours(23, 59, 59, 999);
      results = results.filter((r: any) => {
        const d = parseDate(r.issuedDate);
        return d ? d <= to : false;
      });
    }

    if (filterCounty !== "all") {
      const countyId = parseInt(filterCounty);
      const countyObj = counties?.find(c => c.id === countyId);
      const countyName = countyObj?.name;
      results = results.filter((r: any) =>
        r.countyId === countyId || (countyName && r.countyName?.includes(countyName))
      );
    }

    if (filterJurisdiction !== "all") {
      results = results.filter((r: any) => (r.jurisdiction || r.databaseName) === filterJurisdiction);
    }

    if (filterStatuses.size > 0) {
      results = results.filter((r: any) => filterStatuses.has(normalizeStatus(r.status)));
    }

    return results;
  }, [rawResults, filterDateFrom, filterDateTo, filterCounty, filterJurisdiction, filterStatuses, counties]);

  const activeFilterCount = [
    filterDateFrom, filterDateTo,
    filterCounty !== "all" ? filterCounty : "",
    filterJurisdiction !== "all" ? filterJurisdiction : "",
    filterStatuses.size > 0 ? "status" : "",
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterCounty("all");
    setFilterJurisdiction("all");
    setFilterStatuses(new Set());
  };

  const toggleDetails = async (resultId: number) => {
    const next = new Set(expandedResults);
    if (next.has(resultId)) {
      next.delete(resultId);
      setExpandedResults(next);
      return;
    }
    next.add(resultId);
    setExpandedResults(next);

    if (permitDetails[resultId]) return;

    setLoadingDetails(prev => new Set(prev).add(resultId));
    try {
      const res = await apiRequest("POST", `/api/permit-details/${resultId}`);
      const data = await res.json();
      setPermitDetails(prev => ({ ...prev, [resultId]: data.details }));
    } catch (err: any) {
      toast({ title: "Could not load details", description: err.message, variant: "destructive" });
    } finally {
      setLoadingDetails(prev => {
        const n = new Set(prev);
        n.delete(resultId);
        return n;
      });
    }
  };

  const activeDbCount = dbCounts?.total ?? 0;
  const selectedIcon = searchTypes.find((t) => t.value === searchType)?.icon ?? Search;
  const IconComponent = selectedIcon;

  const isSearching = searchMutation.isPending || (liveStatus?.status === "running");
  const isComplete = liveStatus?.status === "completed";

  const completedDbs = liveStatus?.databases.filter(d => d.status === "completed").length ?? 0;
  const totalDbs = liveStatus?.databases.length ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <div className="space-y-2 animate-in">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Search Permits
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
          <p className="text-sm text-muted-foreground max-w-lg">
            Search 32,864+ permit databases across all 50 states in real time. Find who's pulling permits in your area, track competitor activity, and discover new leads — all from government portals scraped live.
          </p>
        </div>

        <Card className="p-5 space-y-5 animate-in-delay-1" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Search area</label>
            <Select
              value={scopeState}
              onValueChange={(val) => {
                setScopeState(val);
                setScopeLocation("all");
                setLocationSearch("");
              }}
            >
              <SelectTrigger data-testid="select-scope-state" className="w-full">
                <Globe className="h-3.5 w-3.5 text-muted-foreground mr-1.5" />
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-state-all">All States</SelectItem>
                {allStates.map((state) => (
                  <SelectItem key={state.code} value={state.code} data-testid={`select-state-${state.code.toLowerCase()}`}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={scopeLocation}
              onValueChange={(val) => {
                setScopeLocation(val);
                setLocationSearch("");
              }}
            >
              <SelectTrigger data-testid="select-scope-location" className="w-full">
                <SelectValue placeholder="All Counties & Cities" />
              </SelectTrigger>
              <SelectContent>
                <div className="px-2 pb-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search cities or counties..."
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-sm rounded-md border bg-background outline-none focus:ring-1 focus:ring-ring"
                      data-testid="input-location-search"
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
                <SelectItem value="all">
                  {scopeState === "all" ? "All Counties & Cities" : `All ${selectedStateName} Counties & Cities`}
                </SelectItem>
                {filteredLocationOptions.counties.map((county) => {
                  const countyDbs = filteredLocationOptions.databases.filter(d => d.countyId === county.id);
                  if (countyDbs.length === 0 && locationSearch) return null;
                  return (
                    <SelectGroup key={county.id}>
                      <SelectItem value={`county-${county.id}`}>
                        <span className="font-medium">{county.name} County</span>
                        <span className="text-muted-foreground ml-1">({countyDbs.length} databases)</span>
                      </SelectItem>
                      {countyDbs.map(db => (
                        <SelectItem key={db.id} value={`city-${db.id}`} className="pl-8">
                          {db.jurisdiction}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search by</label>
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger data-testid="select-search-type" className="w-full md:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {searchTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <span className="flex items-center gap-2">
                        <type.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {type.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search value</label>
              <div className="relative">
                <IconComponent className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={
                    searchType === "address" ? "911, 3520 malland, etc." :
                    searchType === "keyword" ? "siding, roofing, electrical, plumbing..." :
                    "Enter search value..."
                  }
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-9"
                  data-testid="input-search-value"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
            data-testid="button-toggle-filters"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filters
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-foreground text-background text-[10px] leading-none font-semibold">
                {activeFilterCount}
              </span>
            )}
            {showFilters ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>

          {showFilters && (
            <div className="space-y-3 pt-1 border-t border-border/40" style={{ animation: 'fadeSlideIn 0.2s ease-out both' }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <CalendarDays className="h-3 w-3" />
                    Date from
                  </label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="input-filter-date-from"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <CalendarDays className="h-3 w-3" />
                    Date to
                  </label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="input-filter-date-to"
                  />
                </div>
              </div>

              {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {filterDateFrom && (
                    <Badge variant="secondary" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate">
                      From: {filterDateFrom}
                      <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setFilterDateFrom("")} />
                    </Badge>
                  )}
                  {filterDateTo && (
                    <Badge variant="secondary" className="text-xs gap-1 no-default-hover-elevate no-default-active-elevate">
                      To: {filterDateTo}
                      <X className="h-2.5 w-2.5 cursor-pointer" onClick={() => setFilterDateTo("")} />
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-5 text-[10px] gap-1 text-muted-foreground px-1.5" data-testid="button-clear-filters">
                    <X className="h-2.5 w-2.5" />
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-1">
            <p className="text-xs text-muted-foreground">
              {scopedDbCount} database{scopedDbCount !== 1 ? "s" : ""}
              {scopeState !== "all" ? ` in ${scopeState === "WA" ? "Washington" : "Florida"}` : ""}
            </p>
            <Button
              onClick={handleSearch}
              disabled={searchMutation.isPending || !searchValue.trim()}
              className="px-6"
              data-testid="button-search"
            >
              {searchMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Search
            </Button>
          </div>
        </Card>

        {(searchId || searchMutation.isPending) && (
          <div className="space-y-5">
            {liveStatus && (
              <Card className="p-5 space-y-4 animate-scale-in" style={{ boxShadow: 'var(--shadow-2xs)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {isSearching ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                    <span className="text-sm font-semibold">
                      {isSearching ? "Searching databases..." : "Search complete"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">{completedDbs}/{totalDbs}</span>
                    {liveStatus.elapsedMs > 0 && (
                      <span className="tabular-nums">{(liveStatus.elapsedMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                </div>

                <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                  <div
                    className="bg-foreground h-full rounded-full transition-all duration-500"
                    style={{ width: `${totalDbs > 0 ? (completedDbs / totalDbs) * 100 : 0}%` }}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                  {liveStatus.databases.map((db) => (
                    <div
                      key={db.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                      data-testid={`status-db-${db.id}`}
                    >
                      {db.status === "completed" && (
                        <CheckCircle2 className="h-3 w-3 text-green-600 dark:text-green-400 flex-shrink-0" />
                      )}
                      {db.status === "running" && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                      )}
                      {db.status === "pending" && (
                        <Database className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                      )}
                      {db.status === "error" && (
                        <XCircle className="h-3 w-3 text-destructive flex-shrink-0" />
                      )}
                      {db.status === "skipped" && (
                        <SkipForward className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                      )}
                      <span className={`truncate ${db.status === "running" ? "font-medium" : db.status === "pending" || db.status === "skipped" ? "text-muted-foreground/60" : ""}`}>
                        {db.name}
                      </span>
                      {db.status === "completed" && db.resultsFound > 0 && (
                        <span className="ml-auto font-semibold tabular-nums flex-shrink-0">{db.resultsFound}</span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {!liveStatus && searchMutation.isPending && (
              <div className="flex flex-col items-center justify-center py-12 gap-4 animate-fade-in">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Starting search...</p>
              </div>
            )}

            {rawResults.length > 0 && (
              <div className="space-y-4 animate-in">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold" data-testid="text-results-header">
                    Results
                  </h2>
                  <div className="flex items-center gap-3">
                    {availableStatuses.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                        <label className="flex items-center gap-1.5 cursor-pointer" data-testid="checkbox-status-all">
                          <Checkbox
                            checked={isAllStatuses}
                            onCheckedChange={toggleAllStatuses}
                            className="h-3.5 w-3.5"
                          />
                          <span className="text-xs font-medium">All</span>
                        </label>
                        {availableStatuses.map(({ status, count }) => (
                          <label key={status} className="flex items-center gap-1.5 cursor-pointer" data-testid={`checkbox-status-${status.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                            <Checkbox
                              checked={filterStatuses.has(status)}
                              onCheckedChange={() => toggleStatus(status)}
                              className="h-3.5 w-3.5"
                            />
                            <span className="text-xs">{status}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">({count})</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-result-count">
                      {filteredResults.length === rawResults.length
                        ? `${rawResults.length} result${rawResults.length !== 1 ? "s" : ""}`
                        : `${filteredResults.length} of ${rawResults.length}`}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {filteredResults.length === 0 && activeFilterCount > 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                      <SlidersHorizontal className="h-6 w-6 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No results match your filters</p>
                      <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs" data-testid="button-clear-filters-empty">
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                    filteredResults.map((result: any, index: number) => (
                      <Card
                        key={result.id}
                        className="p-4 hover-elevate transition-all duration-200"
                        style={{
                          boxShadow: 'var(--shadow-2xs)',
                          animation: `fadeSlideIn 0.3s ease-out ${Math.min(index * 0.02, 0.3)}s both`,
                        }}
                        data-testid={`card-result-${result.id}`}
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                {result.permitNumber && (
                                  <span className="text-sm font-semibold" data-testid={`text-permit-number-${result.id}`}>{result.permitNumber}</span>
                                )}
                                {result.permitType && (
                                  <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">{result.permitType}</Badge>
                                )}
                                <StatusBadge status={result.status} />
                              </div>
                              {result.address && (
                                <p className="text-sm flex items-center gap-1.5">
                                  <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                  {result.address}
                                </p>
                              )}
                              {result.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{result.description}</p>
                              )}
                            </div>
                            <div className="text-right shrink-0 space-y-1">
                              {result.issuedDate && (
                                <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums block">{result.issuedDate}</span>
                              )}
                              {result.databaseName && (
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap block">
                                  {result.jurisdiction || result.databaseName}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground">
                            {result.applicantName && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3 flex-shrink-0" />
                                {result.applicantName}
                              </span>
                            )}
                            {result.contractorName && (
                              <span className="flex items-center gap-1">
                                <Building2 className="h-3 w-3 flex-shrink-0" />
                                {result.contractorName}
                              </span>
                            )}
                            {result.parcelNumber && (
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3 flex-shrink-0" />
                                {result.parcelNumber}
                              </span>
                            )}
                            {result.district && (
                              <span className="flex items-center gap-1">
                                <Globe className="h-3 w-3 flex-shrink-0" />
                                {result.district}
                              </span>
                            )}
                          </div>

                          {(result.expirationDate || result.finalizedDate) && (
                            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground">
                              {result.expirationDate && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3 flex-shrink-0" />
                                  Expires {result.expirationDate}
                                </span>
                              )}
                              {result.finalizedDate && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="h-3 w-3 flex-shrink-0" />
                                  Finalized {result.finalizedDate}
                                </span>
                              )}
                            </div>
                          )}

                          {result.contacts && Array.isArray(result.contacts) && result.contacts.length > 0 && (
                            <div className="border-t border-border/40 pt-2.5 mt-1">
                              <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mb-2">
                                <Users className="h-3 w-3" />
                                Contacts ({result.contacts.length})
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                {(result.contacts as any[]).map((contact: any, ci: number) => (
                                  <div key={ci} className="flex items-start gap-2 text-xs px-2.5 py-2 rounded-md bg-muted/40">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-muted-foreground">{contact.type}</span>
                                        <span className="font-medium truncate">
                                          {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
                                        </span>
                                      </div>
                                      {contact.company && (
                                        <p className="text-muted-foreground mt-0.5 truncate">{contact.company}</p>
                                      )}
                                      <div className="flex items-center gap-2 mt-0.5 text-muted-foreground">
                                        {contact.phone && (
                                          <span className="flex items-center gap-1">
                                            <Phone className="h-2.5 w-2.5" />
                                            {contact.phone}
                                          </span>
                                        )}
                                        {contact.email && (
                                          <span className="flex items-center gap-1">
                                            <Mail className="h-2.5 w-2.5" />
                                            {contact.email}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-3 pt-1">
                            <button
                              type="button"
                              onClick={() => toggleDetails(result.id)}
                              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                              data-testid={`button-details-${result.id}`}
                            >
                              {loadingDetails.has(result.id) ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                              {expandedResults.has(result.id) ? "Hide details" : "View details"}
                              {expandedResults.has(result.id) ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>
                            {result.countyId && [5, 6, 7, 8].includes(result.countyId) && result.address && (
                              <a
                                href={getPropertyLookupUrl(result.countyId, result.address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                data-testid={`button-property-lookup-${result.id}`}
                              >
                                <Building className="h-3 w-3" />
                                Property lookup
                                <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                              </a>
                            )}
                          </div>

                          {expandedResults.has(result.id) && (
                            <div className="border-t border-border/40 pt-3 mt-1" style={{ animation: 'fadeSlideIn 0.2s ease-out both' }}>
                              {loadingDetails.has(result.id) ? (
                                <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Fetching permit details...
                                </div>
                              ) : permitDetails[result.id] && Object.keys(permitDetails[result.id]).length > 0 ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                                  {Object.entries(permitDetails[result.id]).map(([key, value]) => (
                                    <div key={key} className="flex items-baseline gap-2 text-xs py-1.5 border-b border-dashed border-border/30">
                                      <span className="font-medium text-muted-foreground min-w-[110px] flex-shrink-0">{key}</span>
                                      <span className="text-foreground break-all">{String(value || "—")}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : permitDetails[result.id] ? (
                                <p className="text-xs text-muted-foreground py-2">No additional details available.</p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}

            {isComplete && rawResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center animate-scale-in">
                <AlertCircle className="h-6 w-6 text-muted-foreground/40" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No results found</p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    Try a different search term or search type.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {!searchId && !searchMutation.isPending && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in-delay-2">
            <Search className="h-8 w-8 text-muted-foreground/20" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Ready to search</p>
              <p className="text-xs text-muted-foreground/70 max-w-xs">
                Enter a search term above. Results from each portal appear as they're found.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("issued") || s.includes("approved") || s.includes("complete") || s.includes("closed")) {
    return <Badge className="bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-200/60 dark:border-green-800/40 no-default-hover-elevate no-default-active-elevate text-[11px]">{status}</Badge>;
  }
  if (s.includes("pending") || s.includes("review") || s.includes("applied")) {
    return <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40 no-default-hover-elevate no-default-active-elevate text-[11px]">{status}</Badge>;
  }
  if (s.includes("expired") || s.includes("denied") || s.includes("cancel") || s.includes("void")) {
    return <Badge className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200/60 dark:border-red-800/40 no-default-hover-elevate no-default-active-elevate text-[11px]">{status}</Badge>;
  }
  return <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[11px]">{status}</Badge>;
}
