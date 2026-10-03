import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { readQueryParam, replaceQueryParams } from "@/lib/url-query";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { AppPage, PageHeader, StatusPill, EmptyState } from "@/components/app-ui";
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
  Globe,
} from "lucide-react";
import type { PermitDatabase, County } from "@shared/schema";

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
  { value: "company", label: "Company name", icon: Building2 },
  { value: "license", label: "License #", icon: FileText },
  { value: "permit", label: "Permit #", icon: FileText },
];

// Search history and Databases record some searches under their scraper's names.
const SEARCH_TYPE_ALIASES: Record<string, string> = { permit_number: "permit", company_name: "company" };

function initialSearchType(): string {
  const raw = readQueryParam("type");
  const type = raw ? SEARCH_TYPE_ALIASES[raw] ?? raw : null;
  return type && searchTypes.some((t) => t.value === type) ? type : "address";
}

/** A portal the live search actually queries: a usable official link plus a supported scraper. */
const isLiveSearchable = (db: PermitDatabase) => governmentLinksAvailable(db) && canScrapeGovernmentPortal(db);

const portalCount = (n: number) => `${n.toLocaleString()} searchable portal${n === 1 ? "" : "s"}`;

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
  // The form (and the running search's id) live in the address bar, so a refresh or a
  // "Search again" link from History reopens the same search: ?state=&loc=&type=&q=&sid=
  const [searchType, setSearchType] = useState(initialSearchType);
  const [searchValue, setSearchValue] = useState(() => readQueryParam("q") ?? "");
  const [scopeLocation, setScopeLocation] = useState<string>(() => {
    const loc = readQueryParam("loc");
    return loc && /^(county|city)-\d+$/.test(loc) ? loc : "all";
  });
  const [scopeState, setScopeState] = useState<string>(() => readQueryParam("state")?.toUpperCase() || "all");
  const [locationSearch, setLocationSearch] = useState("");
  const [searchId, setSearchId] = useState<string | null>(() => {
    const sid = readQueryParam("sid");
    return sid && /^[A-Za-z0-9-]{1,40}$/.test(sid) ? sid : null;
  });
  // True while showing a search reopened from the URL rather than one started here.
  const restoredSearchRef = useRef(searchId !== null);
  // The form the search in the address bar (sid) was run with: set by handleSearch, or read from the
  // URL when a search is reopened. While a sid is present the URL keeps these instead of the live
  // inputs, so a reload never pairs an old search's results with a query or area typed since.
  const [submitted, setSubmitted] = useState(() => ({ state: scopeState, loc: scopeLocation, type: searchType, q: searchValue.trim() }));
  const [liveStatus, setLiveStatus] = useState<LiveSearchStatus | null>(null);
  const [initialResults, setInitialResults] = useState<any[] | null>(null);
  // Set when nothing in the chosen area can be searched live: nothing ran, so there is no search to poll.
  const [noPortalsMessage, setNoPortalsMessage] = useState<string | null>(null);
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

  // `searchable` (nationwide live-searchable portals) is used when the server reports it.
  const { data: dbCounts } = useQuery<{ total: number; county: number; city: number; searchable?: number }>({
    queryKey: ["/api/databases/counts"],
  });

  const { data: databases, isLoading: databasesLoading } = useQuery<PermitDatabase[]>({
    queryKey: ["/api/databases/county-state", scopeState],
    queryFn: async () => {
      if (scopeState === "all") return [];
      // Only the state's live-searchable portals (the same set the search runs
      // against). The paged directory list stops at 100 rows, which cut the
      // count and the city picker short in states with more portals.
      const res = await fetch(`/api/databases?searchable=true&stateCode=${encodeURIComponent(scopeState)}`);
      if (!res.ok) return [];
      return res.json();
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
    const list = scopeState === "all" ? counties : counties.filter(c => c.stateCode === scopeState);
    return [...list].sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  }, [counties, scopeState]);

  // One definition everywhere (picker, counts, footer): portals the live search can query.
  const searchableDbs = useMemo(() => (databases ?? []).filter(isLiveSearchable), [databases]);

  // Values from the URL: a county selects its state; unknown counties/states/portals reset.
  useEffect(() => {
    if (!counties) return;
    if (scopeLocation.startsWith("county-")) {
      const county = counties.find(c => `county-${c.id}` === scopeLocation);
      if (!county) setScopeLocation("all");
      else if (county.stateCode !== scopeState) setScopeState(county.stateCode);
    } else if (scopeState !== "all" && !counties.some(c => c.stateCode === scopeState)) {
      setScopeState("all");
      setScopeLocation("all");
    }
  }, [counties]);

  useEffect(() => {
    if (!databases || !scopeLocation.startsWith("city-")) return;
    if (!searchableDbs.some(d => `city-${d.id}` === scopeLocation)) setScopeLocation("all");
  }, [databases]);

  useEffect(() => {
    const form = searchId ? submitted : { state: scopeState, loc: scopeLocation, type: searchType, q: searchValue.trim() };
    replaceQueryParams({
      state: form.state !== "all" ? form.state : null,
      loc: form.loc !== "all" ? form.loc : null,
      type: form.type !== "address" ? form.type : null,
      q: form.q || null,
      sid: searchId,
    });
  }, [scopeState, scopeLocation, searchType, searchValue, searchId, submitted]);

  const filteredLocationOptions = useMemo(() => {
    const search = locationSearch.toLowerCase().trim();
    const stateFilteredCounties = stateCounties;
    const stateFilteredDbs = searchableDbs;

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
  }, [stateCounties, searchableDbs, locationSearch]);

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

  // null = not known yet (still loading, or the server doesn't report a nationwide count).
  const scopedDbCount = useMemo<number | null>(() => {
    if (scopeState === "all") return typeof dbCounts?.searchable === "number" ? dbCounts.searchable : null;
    if (!databases) return null;
    if (scopeCountyId) return searchableDbs.filter(d => d.countyId === scopeCountyId).length;
    return searchableDbs.length;
  }, [scopeState, dbCounts, databases, searchableDbs, scopeCountyId]);

  const scopePlace = useMemo(() => {
    if (scopeState === "all") return "nationwide";
    const county = scopeCountyId ? counties?.find(c => c.id === scopeCountyId) : null;
    return county ? `in ${county.name} County, ${selectedStateName}` : `in ${selectedStateName}`;
  }, [scopeState, scopeCountyId, counties, selectedStateName]);

  const searchMutation = useMutation({
    mutationFn: async (payload: { searchType: string; searchValue: string; scopeCountyId: number | null; scopeState?: string }) => {
      const res = await apiRequest("POST", "/api/search", payload);
      return res.json();
    },
    onSuccess: (data) => {
      setLiveStatus(null);
      if (data.noSearchablePortals) {
        setInitialResults(null);
        setNoPortalsMessage(data.message || "No permit portal in this area supports live search yet.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
      setNoPortalsMessage(null);
      setInitialResults(data.results);
      setSearchId(data.searchId);
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
        if (res.status === 404) {
          // Live searches are kept in server memory; an old link (or a restart) loses them.
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          if (restoredSearchRef.current) {
            restoredSearchRef.current = false;
            setSearchId(null);
            toast({ title: "That search is no longer available", description: "Run it again to get fresh results." });
          }
          return;
        }
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
    restoredSearchRef.current = false;
    setSubmitted({ state: scopeState, loc: scopeLocation, type: searchType, q: searchValue.trim() });
    setSearchId(null);
    setLiveStatus(null);
    setInitialResults(null);
    setNoPortalsMessage(null);
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

  const dateRangeInverted = !!filterDateFrom && !!filterDateTo && filterDateFrom > filterDateTo;

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

  const selectedIcon = searchTypes.find((t) => t.value === searchType)?.icon ?? Search;
  const IconComponent = selectedIcon;

  const isSearching = searchMutation.isPending || (liveStatus?.status === "running");
  const isComplete = liveStatus?.status === "completed";

  // A portal is finished whether it was searched or failed; only "completed"
  // means it was actually searched. Failed portals are counted and named, so
  // an empty result never reads as "no permits exist" when nothing was queried.
  const finishedDbs = liveStatus?.databases.filter(d => d.status === "completed" || d.status === "error" || d.status === "skipped").length ?? 0;
  const failedDbs = liveStatus?.databases.filter(d => d.status === "error").length ?? 0;
  const searchedDbs = liveStatus?.databases.filter(d => d.status === "completed").length ?? 0;
  const totalDbs = liveStatus?.databases.length ?? 0;
  const portalWord = (n: number) => `${n} portal${n === 1 ? "" : "s"}`;

  return (
    <AppPage width="narrow" testId="page-search">
      <PageHeader
        title={<span data-testid="text-page-title">Search permits</span>}
        description="Search live permit portals by address, name, company or permit number."
      />

      <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Search area</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="select-state-all">All states</SelectItem>
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
                // Picking a county under "All states" narrows to its state so its portals load.
                if (val.startsWith("county-") && scopeState === "all") {
                  const county = counties?.find(c => `county-${c.id}` === val);
                  if (county) setScopeState(county.stateCode);
                }
              }}
            >
              <SelectTrigger data-testid="select-scope-location" className="w-full">
                <SelectValue placeholder="All counties & cities" />
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
                  {scopeState === "all" ? "All counties & cities" : `All ${selectedStateName} counties & cities`}
                </SelectItem>
                {filteredLocationOptions.counties.map((county) => {
                  // Counties here already matched the filter (by name, state or one of their portals).
                  const countyDbs = filteredLocationOptions.databases.filter(d => d.countyId === county.id);
                  return (
                    <SelectGroup key={county.id}>
                      <SelectItem value={`county-${county.id}`}>
                        <span className="font-medium">{county.name} County{scopeState === "all" ? `, ${county.stateCode}` : ""}</span>
                        {/* Per-county counts need the state's portals; under All states they aren't loaded. */}
                        {scopeState !== "all" && databases && (
                          <span className="text-muted-foreground ml-1">({portalCount(countyDbs.length)})</span>
                        )}
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
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search by</label>
            <Select value={searchType} onValueChange={setSearchType}>
              <SelectTrigger data-testid="select-search-type" className="w-full">
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
          <div className="space-y-3 pt-1 border-t border-border/40">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3" />
                  Date from
                </label>
                <Input
                  type="date"
                  value={filterDateFrom}
                  max={filterDateTo || undefined}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  aria-invalid={dateRangeInverted}
                  className="h-9 text-xs"
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
                  min={filterDateFrom || undefined}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  aria-invalid={dateRangeInverted}
                  className="h-9 text-xs"
                  data-testid="input-filter-date-to"
                />
              </div>
            </div>
            {dateRangeInverted && (
              <p className="text-xs text-destructive" role="alert" data-testid="text-date-range-error">
                End date is before start date, so no permits can match. Adjust one of the dates.
              </p>
            )}

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

        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground" data-testid="text-scope-count">
            {scopedDbCount !== null
              ? `${portalCount(scopedDbCount)} ${scopePlace}`
              : scopeState !== "all" && databasesLoading
                ? `Counting searchable portals ${scopePlace}…`
                : "Searches every live-searchable portal nationwide"}
          </p>
          <Button
            onClick={handleSearch}
            disabled={searchMutation.isPending || !searchValue.trim()}
            className="w-full sm:w-auto"
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
      </section>

      {(searchId || searchMutation.isPending) && (
        <div className="space-y-5">
          {liveStatus && (
            <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : failedDbs === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : searchedDbs === 0 ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="text-sm font-semibold" role="status" data-testid="text-search-status">
                    {isSearching
                      ? "Searching databases..."
                      : failedDbs === 0
                        ? "Search complete"
                        : searchedDbs === 0
                          ? `Search failed: ${failedDbs === 1 ? "the portal could not be searched" : `none of the ${portalWord(failedDbs)} could be searched`}`
                          : `Search finished: ${portalWord(failedDbs)} of ${totalDbs} could not be searched`}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums" title="Portals finished">{finishedDbs}/{totalDbs}</span>
                  {liveStatus.elapsedMs > 0 && (
                    <span className="tabular-nums">{(liveStatus.elapsedMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>

              <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                <div
                  className="bg-foreground h-full rounded-full transition-all duration-500"
                  style={{ width: `${totalDbs > 0 ? (finishedDbs / totalDbs) * 100 : 0}%` }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-0.5">
                {liveStatus.databases.map((db) => (
                  <div
                    key={db.id}
                    className="flex items-start gap-2 px-2 py-1.5 rounded text-xs"
                    data-testid={`status-db-${db.id}`}
                    data-status={db.status}
                  >
                    {db.status === "completed" && (
                      <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" aria-label="Searched" />
                    )}
                    {db.status === "running" && (
                      <Loader2 className="h-3 w-3 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" aria-label="Searching" />
                    )}
                    {db.status === "pending" && (
                      <Database className="h-3 w-3 mt-0.5 text-muted-foreground/30 flex-shrink-0" aria-label="Waiting" />
                    )}
                    {db.status === "error" && (
                      <XCircle className="h-3 w-3 mt-0.5 text-destructive flex-shrink-0" aria-label="Not searched" />
                    )}
                    {db.status === "skipped" && (
                      <SkipForward className="h-3 w-3 mt-0.5 text-muted-foreground/30 flex-shrink-0" aria-label="Skipped" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className={`block truncate ${db.status === "running" ? "font-medium" : db.status === "pending" || db.status === "skipped" ? "text-muted-foreground/60" : ""}`}>
                        {db.name}
                      </span>
                      {db.status === "error" && db.message && (
                        <span className="block text-destructive break-words" data-testid={`status-db-message-${db.id}`}>{db.message}</span>
                      )}
                    </div>
                    {(db.status === "completed" || db.status === "error") && db.resultsFound > 0 && (
                      <span className="ml-auto font-semibold tabular-nums flex-shrink-0">{db.resultsFound}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!liveStatus && searchMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Starting search...</p>
            </div>
          )}

          {rawResults.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-base font-semibold" data-testid="text-results-header">
                  Results
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-result-count">
                  {filteredResults.length === rawResults.length
                    ? `${rawResults.length} result${rawResults.length !== 1 ? "s" : ""}`
                    : `${filteredResults.length} of ${rawResults.length}`}
                </span>
              </div>

              {availableStatuses.length > 0 && (
                <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
                  <div className="flex w-max items-center gap-x-3 gap-y-1 pb-1">
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
                </div>
              )}

              <div className="space-y-3">
                {filteredResults.length === 0 && activeFilterCount > 0 ? (
                  <EmptyState
                    compact
                    icon={SlidersHorizontal}
                    title="No results match your filters"
                    action={
                      <Button variant="outline" size="sm" onClick={clearFilters} className="text-xs" data-testid="button-clear-filters-empty">
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  filteredResults.map((result: any) => (
                    <div
                      key={result.id}
                      className="rounded-xl border bg-card p-4"
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
                          {result.countyId && (
                            <a
                              href={`/property?countyId=${result.countyId}`}
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
                          <div className="border-t border-border/40 pt-3 mt-1">
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
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {isComplete && rawResults.length === 0 && (
            <div data-testid="empty-search-results">
              {searchedDbs === 0 && failedDbs > 0 ? (
                <EmptyState
                  icon={AlertCircle}
                  title="No portal could be searched"
                  description="The live search didn't reach any portal, so there may be permits it couldn't see. Try again later, or open a portal directly from the Directory."
                  action={
                    <Button asChild variant="outline" size="sm">
                      <Link href="/databases" data-testid="link-browse-directory-failed">Browse the Directory</Link>
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={AlertCircle}
                  title="No results found"
                  description={failedDbs > 0
                    ? `${portalWord(searchedDbs)} searched with no matches; ${portalWord(failedDbs)} could not be searched, so results may be incomplete.`
                    : "Try a different search term or search type."}
                />
              )}
            </div>
          )}
        </div>
      )}

      {!searchId && !searchMutation.isPending && noPortalsMessage && (
        <div role="status" data-testid="empty-no-searchable-portals">
          <EmptyState
            icon={Database}
            title="Nothing to search here yet"
            description={noPortalsMessage}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/databases" data-testid="link-browse-directory">Browse the Directory</Link>
              </Button>
            }
          />
        </div>
      )}

      {!searchId && !searchMutation.isPending && !noPortalsMessage && (
        <EmptyState
          icon={Search}
          title="Ready to search"
          description="Enter a search term above. Results from each portal appear as they're found."
        />
      )}
    </AppPage>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("issued") || s.includes("approved") || s.includes("complete") || s.includes("closed")) {
    return <StatusPill tone="success" className="text-[11px]">{status}</StatusPill>;
  }
  if (s.includes("pending") || s.includes("review") || s.includes("applied")) {
    return <StatusPill tone="warning" className="text-[11px]">{status}</StatusPill>;
  }
  if (s.includes("expired") || s.includes("denied") || s.includes("cancel") || s.includes("void")) {
    return <StatusPill tone="danger" className="text-[11px]">{status}</StatusPill>;
  }
  return <StatusPill tone="neutral" className="text-[11px]">{status}</StatusPill>;
}
