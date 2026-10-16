import { readSearchUpdate, SEARCH_PAGE_SIZE } from "./permit-search-poll";
import { planRequiredFrom } from "@/components/plan-required";
import { Skeleton } from "@/components/ui/skeleton";
import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
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
import { AppPage, StatusPill, EmptyState, Notice } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { SamplePreview } from "@/components/sample-preview";
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
  Globe,
  Map as MapIcon,
} from "lucide-react";
import type { PermitDatabase, County } from "@shared/schema";
import { PermitMap, type MapPortal } from "@/components/permit-map";

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

/** One page of stored matches in the search's area (server/search-page.ts): newest first, 50 at a time. */
interface ResultPage {
  results: any[];
  /** Every stored match in scope, not only this page. */
  totalResults: number;
  /** `before` for the next (older) page; null on the last page. */
  nextCursor: number | null;
}
interface LiveSearchStatus extends ResultPage {
  status: "running" | "completed";
  databases: LiveDatabase[];
  totalResultsScraped: number;
  elapsedMs: number;
}
/** The county a scope location (`county-N` / `city-N`) stands for; null for a state or nationwide. */
function countyIdForLocation(loc: string, databases: Array<{ id: number; countyId: number }> | undefined) {
  if (loc.startsWith("county-")) return parseInt(loc.replace("county-", ""));
  if (loc.startsWith("city-")) return databases?.find(d => d.id === parseInt(loc.replace("city-", "")))?.countyId ?? null;
  return null;
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
  const searchBoxRef = useRef<HTMLDivElement>(null);
  // A dot on the coverage map prefills the search scope for that jurisdiction, then
  // brings the search box into view — the owner's "find them manually" path.
  const handlePickFromMap = (p: MapPortal) => {
    if (p.state) setScopeState(p.state);
    setScopeLocation(p.jurisdictionType === "county" ? `county-${p.countyId}` : `city-${p.databaseId}`);
    requestAnimationFrame(() => searchBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
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
  // The form the search in the address bar (sid) was run with: set by handleSearch, or read from the
  // URL when a search is reopened. While a sid is present the URL keeps these instead of the live
  // inputs, so a reload never pairs an old search's results with a query or area typed since.
  const [submitted, setSubmitted] = useState(() => ({ state: scopeState, loc: scopeLocation, type: searchType, q: searchValue.trim() }));
  const [liveStatus, setLiveStatus] = useState<LiveSearchStatus | null>(null);
  const [initialResults, setInitialResults] = useState<ResultPage | null>(null);
  // Older pages of stored matches (GET /api/search/results), each read from the previous page's cursor.
  const [olderPages, setOlderPages] = useState<(ResultPage & { before: number })[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchGeneration = useRef(0);
  const olderRequest = useRef<number | null>(null);
  const olderController = useRef<AbortController | null>(null);
  useEffect(() => () => {
    searchGeneration.current += 1;
    olderController.current?.abort();
  }, []);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  // Set when nothing in the chosen area can be searched live: nothing ran, so there is no search to poll.
  const [noPortalsMessage, setNoPortalsMessage] = useState<string | null>(null);
  const [pollError, setPollError] = useState<Error | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [retryPoll, setRetryPoll] = useState(0);
  const [resultPage, setResultPage] = useState(1);

  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());
  const [permitDetails, setPermitDetails] = useState<Record<number, any>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<number>>(new Set());

  const [showFilters, setShowFilters] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCounty, setFilterCounty] = useState<string>("all");
  const [filterJurisdiction, setFilterJurisdiction] = useState<string>("all");
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());

  const { data: counties, error: countiesError, refetch: retryCounties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  // `searchable` (nationwide live-searchable portals) is used when the server reports it.
  const { data: dbCounts, error: countsError, refetch: retryCounts } = useQuery<{ total: number; county: number; city: number; searchable?: number; searchableCounty?: number; searchableCity?: number; searchableStates?: number }>({
    queryKey: ["/api/databases/counts"],
  });

  const { data: databases, isLoading: databasesLoading, error: databasesError, refetch: retryDatabases } = useQuery<PermitDatabase[]>({
    queryKey: ["/api/databases/county-state", scopeState],
    queryFn: async () => {
      if (scopeState === "all") return [];
      // Only the state's live-searchable portals (the same set the search runs
      // against). The paged directory list stops at 100 rows, which cut the
      // count and the city picker short in states with more portals.
      const res = await fetch(`/api/databases?searchable=true&stateCode=${encodeURIComponent(scopeState)}`);
      if (!res.ok) throw new Error("Could not load searchable portals");
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

  const scopeCountyId = useMemo(() => countyIdForLocation(scopeLocation, databases), [scopeLocation, databases]);

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
      const res = await apiRequest("POST", "/api/search", { ...payload, limit: SEARCH_PAGE_SIZE });
      return res.json();
    },
    onSuccess: (data) => {
      setLiveStatus(null);
      setOlderPages([]);
      if (data.noSearchablePortals) {
        setInitialResults(null);
        setNoPortalsMessage(data.message || "No permit portal in this area supports live search yet.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
      setNoPortalsMessage(null);
      setInitialResults({ results: data.results ?? [], totalResults: data.totalResults ?? (data.results?.length ?? 0), nextCursor: data.nextCursor ?? null });
      setSearchId(data.searchId);
    },
    onError: (err: Error) => {
      toast({ title: "Search failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!searchId) return;
    let cancelled = false, inFlight = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await readSearchUpdate<LiveSearchStatus>(searchId, controller.signal, stop);
        if (cancelled) return;
        setLiveStatus(data); setPollError(null); setLastUpdate(new Date());
        if (data.status === 'completed') stop();
      } catch (error) {
        if (!cancelled) setPollError(error instanceof Error ? error : new Error('Connection lost'));
      } finally { inFlight = false; }
    };
    timer = setInterval(poll, 4000);
    void poll();
    return () => { cancelled = true; controller.abort(); stop(); };
  }, [searchId, retryPoll]);

  const handleSearch = () => {
    if (!searchValue.trim()) {
      toast({ title: "Enter a search value", variant: "destructive" });
      return;
    }
    searchGeneration.current += 1;
    olderController.current?.abort();
    olderController.current = null;
    olderRequest.current = null;
    setLoadingMore(false);
    setPollError(null); setLastUpdate(null); setResultPage(1);
    setSubmitted({ state: scopeState, loc: scopeLocation, type: searchType, q: searchValue.trim() });
    setSearchId(null);
    setLiveStatus(null);
    setInitialResults(null);
    setOlderPages([]); setLoadMoreError(null);
    setNoPortalsMessage(null);
    searchMutation.mutate({
      searchType,
      searchValue: searchValue.trim(),
      scopeCountyId,
      scopeState: scopeState !== "all" ? scopeState : undefined,
    });
  };

  // The newest page: the poll's while a search is open (it refreshes as portals answer), else the
  // first answer. Older pages hang off its cursor; if that cursor moves (newer matches arrived after
  // older pages were read) the older pages no longer join up and are dropped to be read again.
  const firstPage: ResultPage | null = liveStatus ?? initialResults;
  const firstCursor = firstPage?.nextCursor ?? null;
  useEffect(() => {
    if (olderPages.length && olderPages[0].before !== firstCursor) setOlderPages([]);
  }, [firstCursor]);
  const rawResults = useMemo(() => {
    const seen = new Set<number>();
    const rows: any[] = [];
    for (const r of [...(firstPage?.results ?? []), ...olderPages.flatMap(p => p.results)]) {
      if (r?.id == null || !seen.has(r.id)) { if (r?.id != null) seen.add(r.id); rows.push(r); }
    }
    return rows;
  }, [firstPage, olderPages]);
  // null until the server has answered; never shown as 0 before then.
  const totalResults: number | null = firstPage ? firstPage.totalResults : null;
  const nextCursor = olderPages.length ? olderPages[olderPages.length - 1].nextCursor : firstCursor;
  const olderCount = totalResults == null ? 0 : Math.max(0, totalResults - rawResults.length);
  const hasOlder = nextCursor !== null && olderCount > 0;

  // The next 50 older matches, in the area the search ran with (submitted, not the live form).
  const loadMore = async () => {
    if (nextCursor === null || olderRequest.current !== null) return;
    const generation = searchGeneration.current;
    olderRequest.current = generation;
    const controller = new AbortController();
    olderController.current = controller;
    setLoadingMore(true); setLoadMoreError(null);
    const before = nextCursor;
    const scopeCounty = countyIdForLocation(submitted.loc, databases);
    const params = new URLSearchParams({ searchType: submitted.type, searchValue: submitted.q, limit: String(SEARCH_PAGE_SIZE), before: String(before) });
    if (scopeCounty) params.set("scopeCountyId", String(scopeCounty));
    if (submitted.state !== "all") params.set("scopeState", submitted.state);
    try {
      const response = await fetch(`/api/search/results?${params}`, {
        credentials: "include", cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      const data: ResultPage = await response.json();
      if (generation !== searchGeneration.current) return;
      setOlderPages(pages => [...pages, { results: data.results ?? [], totalResults: data.totalResults, nextCursor: data.nextCursor ?? null, before }]);
      // Land on the page the new rows start (exact without client-side filters; clamped otherwise).
      setResultPage(Math.floor(rawResults.length / SEARCH_PAGE_SIZE) + 1);
    } catch (e) {
      if (generation !== searchGeneration.current) return;
      setLoadMoreError(e instanceof Error ? e : new Error("Could not load more results"));
    } finally {
      if (generation === searchGeneration.current) {
        olderRequest.current = null;
        olderController.current = null;
        setLoadingMore(false);
      }
    }
  };

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

  useEffect(() => { setResultPage(1); }, [filterDateFrom, filterDateTo, filterCounty, filterJurisdiction, filterStatuses]);
  const resultPages = Math.max(1, Math.ceil(filteredResults.length / 50));
  const visiblePage = Math.min(resultPage, resultPages);
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

  const isSearching = searchMutation.isPending || (!!searchId && !pollError && (!liveStatus || liveStatus.status === "running"));
  const isComplete = liveStatus?.status === "completed" && !pollError;

  // A portal is finished whether it was searched or failed; only "completed"
  // means it was actually searched. Failed portals are counted and named, so
  // an empty result never reads as "no permits exist" when nothing was queried.
  const finishedDbs = liveStatus?.databases.filter(d => d.status === "completed" || d.status === "error" || d.status === "skipped").length ?? 0;
  const failedDbs = liveStatus?.databases.filter(d => d.status === "error").length ?? 0;
  const searchedDbs = liveStatus?.databases.filter(d => d.status === "completed").length ?? 0;
  const totalDbs = liveStatus?.databases.length ?? 0;
  const portalWord = (n: number) => `${n} portal${n === 1 ? "" : "s"}`;

  return (
    <AppPage width="narrow" className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-search">
      {/* Google's search format (owner, 2026-10-07): a quiet header, search-type pills, the rounded search box. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="Search permits"
        description="Type an address, a name, a company, a license or a permit number and we search the real city and county permit portals in the area you pick."
        flush
      />

      {/* The nationwide picture (the SEO Suite's number strip): the portals the live search can query today, from
          /api/databases/counts. Shown only when the server reports the figures; never a typed-in number. */}
      {dbCounts && !countsError && typeof dbCounts.searchable === "number" && (
        <GoogleStatGrid cols={3}>
          <GoogleStat label="Searchable portals" value={dbCounts.searchable.toLocaleString()} hint="Portals with a checked link and a search adapter" testId="stat-search-portals" />
          <GoogleStat label="States covered" value={dbCounts.searchableStates != null ? dbCounts.searchableStates.toLocaleString() : "—"} testId="stat-search-states" />
          <GoogleStat label="Counties with a searchable portal" value={dbCounts.searchableCounty != null ? dbCounts.searchableCounty.toLocaleString() : "—"} testId="stat-search-counties" />
        </GoogleStatGrid>
      )}

      <section className="space-y-4" aria-label="Search form">
        {/* US coverage map (owner request): states fill blue where county permits are
            searchable; every searchable portal is a clickable orange dot. Collapsible so it
            never breaks the page on mobile; lazy-rendered so it only loads when opened. */}
        <div className="space-y-2">
          
          <PermitMap onPick={handlePickFromMap} />
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Search by" data-testid="select-search-type">
          {searchTypes.map((type) => (
            <GooglePill
              key={type.value}
              icon={type.icon}
              label={type.label}
              role="radio"
              ariaPressed={searchType === type.value}
              selected={searchType === type.value}
              onClick={() => setSearchType(type.value)}
              testId={`button-search-type-${type.value}`}
            />
          ))}
        </div>

        <div className="g-search" role="search" ref={searchBoxRef}>
          <IconComponent aria-hidden="true" />
          <input
            type="search"
            placeholder={
              searchType === "address" ? "e.g. 3520 Blake St, Denver" :
              searchType === "keyword" ? "siding, roofing, electrical, plumbing..." :
              "Enter search value..."
            }
            aria-label="Search value"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            data-testid="input-search-value"
          />
          <GooglePill
            icon={searchMutation.isPending ? Loader2 : Search}
            variant="solid"
            label="Search"
            onClick={handleSearch}
            disabled={searchMutation.isPending || !searchValue.trim()}
            className={searchMutation.isPending ? "[&>svg]:animate-spin" : undefined}
            testId="button-search"
          />
        </div>
        <p className="g-text-2 text-sm" data-testid="text-scope-count">
          {countsError || databasesError ? "Portal counts are unavailable" : scopeState === "all"
            ? (typeof dbCounts?.searchable === "number"
                ? `${dbCounts.searchable.toLocaleString()} searchable portals${dbCounts.searchableStates != null ? ` in ${dbCounts.searchableStates} states` : ""}${dbCounts.searchableCounty != null ? ` (${dbCounts.searchableCounty.toLocaleString()} counties)` : ""}`
                : "Searches every live-searchable portal nationwide")
            : scopedDbCount !== null
              ? `${portalCount(scopedDbCount)} ${scopePlace}`
              : databasesLoading
                ? `Counting searchable portals ${scopePlace}…`
                : "Searches every live-searchable portal nationwide"}
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium g-text-2">Search area</label>
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

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-sm font-medium g-text-2 hover:text-foreground transition-colors w-full max-sm:min-h-11"
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
          <div className="space-y-3 pt-3 g-divider">
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

      </section>

      {countiesError && <Notice tone="danger">County filters are unavailable. <Button onClick={() => void retryCounties()}>Retry</Button></Notice>}
      {countsError && <Notice tone="danger">Portal counts are unavailable. <Button onClick={() => void retryCounts()}>Retry</Button></Notice>}
      {databasesError && <Notice tone="danger">Searchable portals are unavailable. <Button onClick={() => void retryDatabases()}>Retry</Button></Notice>}
      {planRequiredFrom(searchMutation.error || pollError) ? <Notice tone="info">{apiErrorMessage(searchMutation.error || pollError)} <Button asChild variant="outline"><a href="/pricing">View plans</a></Button></Notice> : pollError && <Notice tone="danger">
        {/^401:/.test(pollError.message) ? <span>Your session has ended. <a className="underline focus-visible:outline" href="/auth">Sign in</a> to continue.</span> : /^(404):/.test(pollError.message) ? "This search was interrupted or has expired." : "Search updates are unavailable. We'll keep your partial results while reconnecting."}
        {lastUpdate && <span> Last updated {lastUpdate.toLocaleTimeString()}.</span>}
        <div className="flex flex-wrap gap-2 mt-2"><Button variant="outline" onClick={() => setRetryPoll(n => n + 1)}>Retry updates</Button><Button onClick={handleSearch}>Run again</Button></div>
      </Notice>}
      {(searchId || searchMutation.isPending) && (
        <div className="space-y-5">
          {!liveStatus && !pollError && <Skeleton className="h-24 w-full" />}
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
                    {pollError ? "Search updates interrupted" : isSearching
                      ? "Searching databases..."
                      : searchedDbs === 0
                        ? "No portal returned searchable data"
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
                      {db.status === "running" && (liveStatus?.elapsedMs ?? 0) > 15000 && (
                        <span className="block text-xs text-muted-foreground">Slow portal — still trying (gives up at 75 s)</span>
                      )}
                      {db.status === "error" && db.message && (
                        <details className="text-destructive break-words" data-testid={`status-db-message-${db.id}`}><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">This portal could not be searched. View details</summary>{db.message}</details>
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
              <GoogleSectionHeader
                flush
                titleTestId="text-results-header"
                title="Results"
                actions={(
                  <span className="g-text-2 text-sm tabular-nums" data-testid="text-result-count">
                    {filteredResults.length !== rawResults.length
                      ? `${filteredResults.length} of ${rawResults.length} loaded`
                      : totalResults != null && totalResults > rawResults.length
                        ? `${rawResults.length} of ${totalResults.toLocaleString()} results loaded`
                        : `${rawResults.length} result${rawResults.length !== 1 ? "s" : ""}`}
                  </span>
                )}
              />

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

              <GoogleList testId="list-results">
                {filteredResults.length === 0 && activeFilterCount > 0 ? (
                  <EmptyState
                    compact
                    icon={SlidersHorizontal}
                    title="No results match your filters"
                    action={<GooglePill label="Clear filters" onClick={clearFilters} testId="button-clear-filters-empty" />}
                  />
                ) : (
                  filteredResults.slice((visiblePage - 1) * 50, visiblePage * 50).map((result: any) => (
                    <GoogleListRow
                      key={result.id}
                      testId={`card-result-${result.id}`}
                      title={result.address || result.permitNumber || "Permit"}
                      badges={<>
                        {result.permitType && <span className="g-chip g-chip--sm">{result.permitType}</span>}
                        <StatusBadge status={result.status} />
                      </>}
                      meta={[
                        result.permitNumber ? <span key="number" data-testid={`text-permit-number-${result.id}`}>{result.permitNumber}</span> : null,
                        result.issuedDate ? <span key="issued" className="tabular-nums">Issued {result.issuedDate}</span> : null,
                        result.jurisdiction || result.databaseName || null,
                      ]}
                      actions={<>
                        <GooglePill
                          icon={Eye}
                          label={<>
                            {loadingDetails.has(result.id) && <Loader2 className="inline h-4 w-4 animate-spin mr-1.5" aria-hidden="true" />}
                            {expandedResults.has(result.id) ? "Hide details" : "View details"}
                          </>}
                          onClick={() => toggleDetails(result.id)}
                          ariaPressed={expandedResults.has(result.id)}
                          testId={`button-details-${result.id}`}
                        />
                        {result.countyId && (
                          <GooglePill
                            icon={Building}
                            label="Property lookup"
                            href={`/property?countyId=${result.countyId}`}
                            external
                            testId={`button-property-lookup-${result.id}`}
                          />
                        )}
                      </>}
                    >
                      {result.description && (
                        <p className="g-card__line line-clamp-2">{result.description}</p>
                      )}

                      {(result.applicantName || result.contractorName || result.parcelNumber || result.district) && (
                        <p className="g-card__meta flex flex-wrap items-center gap-x-4 gap-y-1">
                          {result.applicantName && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              {result.applicantName}
                            </span>
                          )}
                          {result.contractorName && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              {result.contractorName}
                            </span>
                          )}
                          {result.parcelNumber && (
                            <span className="flex items-center gap-1">
                              <Hash className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              {result.parcelNumber}
                            </span>
                          )}
                          {result.district && (
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              {result.district}
                            </span>
                          )}
                        </p>
                      )}

                      {(result.expirationDate || result.finalizedDate) && (
                        <p className="g-card__meta flex flex-wrap items-center gap-x-4 gap-y-1">
                          {result.expirationDate && (
                            <span className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              Expires {result.expirationDate}
                            </span>
                          )}
                          {result.finalizedDate && (
                            <span className="flex items-center gap-1">
                              <CalendarDays className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                              Finalized {result.finalizedDate}
                            </span>
                          )}
                        </p>
                      )}

                      {result.contacts && Array.isArray(result.contacts) && result.contacts.length > 0 && (
                        <div className="mt-3 pt-3 g-divider">
                          <p className="g-card__meta flex items-center gap-1 mb-2">
                            <Users className="h-3 w-3" aria-hidden="true" />
                            Contacts ({result.contacts.length})
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {(result.contacts as any[]).map((contact: any, ci: number) => (
                              <div key={ci} className="flex items-start gap-2 text-xs px-2.5 py-2 rounded-lg bg-muted/40">
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
                                        <Phone className="h-2.5 w-2.5" aria-hidden="true" />
                                        {contact.phone}
                                      </span>
                                    )}
                                    {contact.email && (
                                      <span className="flex items-center gap-1">
                                        <Mail className="h-2.5 w-2.5" aria-hidden="true" />
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

                      {expandedResults.has(result.id) && (
                        <div className="mt-3 pt-3 g-divider">
                          {loadingDetails.has(result.id) ? (
                            <div className="flex items-center gap-2 py-4 justify-center text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
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
                    </GoogleListRow>
                  ))
                )}
              </GoogleList>
              {resultPages > 1 && <div className="flex flex-wrap items-center justify-center gap-3 py-4"><Button variant="outline" disabled={visiblePage === 1} onClick={() => setResultPage(visiblePage - 1)}>Previous results</Button><span aria-live="polite">Page {visiblePage} of {resultPages} · {filteredResults.length} results</span><Button variant="outline" disabled={visiblePage === resultPages} onClick={() => setResultPage(visiblePage + 1)}>Next results</Button></div>}
              {hasOlder && (
                <div className="flex flex-col items-center gap-2 py-2 text-center text-sm g-text-2" data-testid="load-more-results">
                  <span aria-live="polite">{rawResults.length.toLocaleString()} of {totalResults!.toLocaleString()} stored matches in this area loaded, newest first.</span>
                  {isSearching
                    ? <span>Older matches can be loaded once the live search finishes.</span>
                    : <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()} data-testid="button-load-more-results">{loadingMore ? "Loading…" : `Load ${Math.min(SEARCH_PAGE_SIZE, olderCount)} older matches`}</Button>}
                </div>
              )}
              {loadMoreError && <Notice tone="danger">{apiErrorMessage(loadMoreError, "Could not load more results")} <Button variant="outline" onClick={() => void loadMore()}>Retry</Button></Notice>}
            </div>
          )}

          {isComplete && hasOlder && <Notice tone="info">{totalResults!.toLocaleString()} stored matches in this area; the newest {rawResults.length.toLocaleString()} are shown. Load older matches above, or narrow the search.</Notice>}
          {isComplete && rawResults.length === 0 && (
            <div data-testid="empty-search-results">
              {searchedDbs === 0 ? (
                <EmptyState
                  icon={AlertCircle}
                  title="No portal could be searched"
                  description="The live search didn't reach any portal, so there may be permits it couldn't see. Try again later, or open a portal directly from the Directory."
                  action={<GooglePill label="Browse the Directory" href="/databases" testId="link-browse-directory-failed" />}
                />
              ) : (
                <EmptyState
                  icon={AlertCircle}
                  title="No matches returned"
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
            action={<GooglePill label="Browse the Directory" href="/databases" testId="link-browse-directory" />}
          />
        </div>
      )}

      {/* Before the first search: how it works, what will appear and where it comes from, and the SHAPE of a result.
          Government data is never invented here (CLAUDE.md): the preview carries field labels only, no values. */}
      {!searchId && !searchMutation.isPending && !noPortalsMessage && (
        <section className="space-y-4" data-testid="empty-search-ready" aria-label="Before you search">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="g-callout">
              <h3>How this works</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Pick a place: a state, and a county or city if you want to narrow it (or click a dot on the map).</li>
                <li>Type an address, a name, a company, a license number or a permit number and press Search.</li>
                <li>We search the live portal in each place, show every portal's progress, and keep the search in History so you can run it again.</li>
              </ol>
            </div>
            <div className="g-callout">
              <h3>What will appear here</h3>
              <p>One row per permit, exactly as the city or county portal lists it: the address, permit number, type, status, issue date and which portal it came from, with contacts and details when the portal publishes them.</p>
              <p className="mt-2">Results come only from the {typeof dbCounts?.searchable === "number" ? `${dbCounts.searchable.toLocaleString()} ` : ""}portals the live search can query (a checked official link plus a search adapter) and from matches saved by earlier searches. A portal that could not be searched is named, so an empty list never means no permit exists.</p>
            </div>
          </div>
          <SamplePreview what="the shape of one result, labels only (no real permit)" testId="sample-search-result">
            <GoogleList>
              <GoogleListRow
                title="Street address"
                badges={<><span className="g-chip g-chip--sm">Permit type</span><span className="g-chip g-chip--sm">Status</span></>}
                meta={["Permit number", "Issued date", "City or county portal"]}
                actions={<><GooglePill icon={Eye} label="View details" /><GooglePill icon={Building} label="Property lookup" /></>}
              >
                <p className="g-card__line">Work description</p>
                <p className="g-card__meta">Applicant · Contractor · Parcel number</p>
              </GoogleListRow>
            </GoogleList>
          </SamplePreview>
        </section>
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
