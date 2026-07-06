import { useState, useMemo } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  ExternalLink,
  Phone,
  Mail,
  CheckCircle2,
  XCircle,
  Search,
  Loader2,
  Download,
  Building2,
  Landmark,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { County, PermitDatabase } from "@shared/schema";
import { useEffect } from "react";

const PAGE_SIZE = 25;

type JurisdictionFilter = "all" | "county" | "city";

interface FilteredResult {
  databases: PermitDatabase[];
  total: number;
}

interface DbCounts {
  total: number;
  county: number;
  city: number;
}

export default function DatabasesPage() {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedState, setSelectedState] = useState("all");
  const [selectedCountyId, setSelectedCountyId] = useState<string>("all");
  const [jurisdictionFilter, setJurisdictionFilter] = useState<JurisdictionFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const { data: counts } = useQuery<DbCounts>({
    queryKey: ["/api/databases/counts"],
  });

  const stateMap = useMemo(() => {
    const map = new Map<string, string>();
    (counties ?? []).forEach(c => { if (c.stateCode && c.state) map.set(c.state, c.stateCode); });
    return map;
  }, [counties]);

  const allStates = useMemo(() =>
    Array.from(new Set((counties ?? []).map(c => c.state).filter(Boolean))).sort(),
    [counties]
  );

  const stateCountiesForDropdown = useMemo(() =>
    selectedState !== "all"
      ? (counties ?? []).filter(c => c.state === selectedState).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [selectedState, counties]
  );

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ filtered: "true", page: String(currentPage), limit: String(PAGE_SIZE) });
    if (jurisdictionFilter !== "all") p.set("jurisdictionType", jurisdictionFilter);
    if (selectedCountyId !== "all") {
      p.set("countyId", selectedCountyId);
    } else if (selectedState !== "all") {
      const sc = stateMap.get(selectedState);
      if (sc) p.set("stateCode", sc);
    }
    if (searchQuery) p.set("search", searchQuery);
    return p.toString();
  }, [currentPage, jurisdictionFilter, selectedCountyId, selectedState, searchQuery, stateMap]);

  const { data: result, isLoading, isFetching } = useQuery<FilteredResult>({
    queryKey: ["/api/databases", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/databases?${queryParams}`);
      if (!res.ok) throw new Error("Failed to fetch databases");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const databases = result?.databases ?? [];
  const totalResults = result?.total ?? 0;
  const totalPages = Math.ceil(totalResults / PAGE_SIZE);

  const countyMap = useMemo(() => {
    const map = new Map<number, County>();
    (counties ?? []).forEach(c => map.set(c.id, c));
    return map;
  }, [counties]);

  const handleFilterChange = (setter: (v: any) => void) => (val: any) => {
    setter(val);
    setCurrentPage(1);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2 animate-in">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Database Directory
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
          <p className="text-sm text-muted-foreground max-w-lg">
            Browse our nationwide directory of permit databases covering counties and cities across all 50 states.
          </p>
          {counts && (
            <p className="text-sm text-muted-foreground" data-testid="text-database-count">
              {counts.total.toLocaleString()} databases — {counts.county.toLocaleString()} counties, {counts.city.toLocaleString()} cities
            </p>
          )}
        </div>

        <div className="space-y-3 animate-in">
          <div className="flex gap-1.5 p-1 bg-muted/50 rounded-lg w-fit" data-testid="filter-jurisdiction-type">
            {([
              { key: "all" as const, label: "All", icon: Database, count: counts?.total },
              { key: "county" as const, label: "Counties", icon: Landmark, count: counts?.county },
              { key: "city" as const, label: "Cities", icon: Building2, count: counts?.city },
            ]).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => handleFilterChange(setJurisdictionFilter)(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  jurisdictionFilter === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`button-filter-${key}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {count != null && (
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4 tabular-nums">
                    {count.toLocaleString()}
                  </Badge>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by city, county, or state..."
                className="pl-9"
                data-testid="input-database-search"
              />
            </div>
            <Select
              value={selectedState}
              onValueChange={(val) => {
                handleFilterChange(setSelectedState)(val);
                setSelectedCountyId("all");
              }}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-state-filter">
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States ({allStates.length})</SelectItem>
                {allStates.map((state) => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedState !== "all" && stateCountiesForDropdown.length > 0 && (
              <Select
                value={selectedCountyId}
                onValueChange={handleFilterChange(setSelectedCountyId)}
              >
                <SelectTrigger className="w-full sm:w-[200px]" data-testid="select-county-filter">
                  <SelectValue placeholder="All Counties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Counties</SelectItem>
                  {stateCountiesForDropdown.map((county) => (
                    <SelectItem key={county.id} value={county.id.toString()}>
                      {county.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-28 rounded-md" />
            ))}
          </div>
        ) : databases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground animate-in">
            <Database className="h-6 w-6 opacity-30" />
            <p className="text-sm">No databases match your search criteria.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchInput("");
                setSearchQuery("");
                setSelectedState("all");
                setSelectedCountyId("all");
                setJurisdictionFilter("all");
                setCurrentPage(1);
              }}
              data-testid="button-clear-filters"
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="space-y-3 animate-in-delay-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(currentPage * PAGE_SIZE, totalResults).toLocaleString()} of {totalResults.toLocaleString()} results
                {isFetching && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
              </p>
            </div>
            <div className="space-y-2">
              {databases.map((db, index) => {
                const county = countyMap.get(db.countyId);
                return (
                  <DatabaseCard key={db.id} database={db} index={index} countyName={county?.name} />
                );
              })}
            </div>
            {totalPages > 1 && (
              <PaginationControls
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-center gap-1 py-4" data-testid="pagination">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        data-testid="button-prev-page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {getPageNumbers().map((page, i) =>
        page === "..." ? (
          <span key={`dots-${i}`} className="px-2 text-xs text-muted-foreground">…</span>
        ) : (
          <Button
            key={page}
            variant={page === currentPage ? "default" : "outline"}
            size="icon"
            className="h-8 w-8 text-xs"
            onClick={() => onPageChange(page)}
            data-testid={`button-page-${page}`}
          >
            {page}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        data-testid="button-next-page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function DatabaseCard({ database, index, countyName }: { database: PermitDatabase; index: number; countyName?: string }) {
  const [scrapeOpen, setScrapeOpen] = useState(false);

  return (
    <>
      <Card
        className="p-4 space-y-3 hover-elevate transition-all duration-200"
        style={{
          boxShadow: 'var(--shadow-2xs)',
          animation: `fadeSlideIn 0.3s ease-out ${index * 0.04}s both`,
        }}
        data-testid={`card-database-${database.id}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {database.jurisdictionType === "county" ? (
                <Landmark className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              ) : (
                <Building2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <h3 className="text-sm font-semibold">{database.name}</h3>
              {database.isActive ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400"></span>
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"></span>
                  Inactive
                </span>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 capitalize">
                {database.jurisdictionType}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {database.jurisdiction}
              {countyName && <span className="ml-1.5 text-border">·</span>}
              {countyName && <span className="ml-1.5">{countyName} County</span>}
              {database.platform && <span className="ml-1.5 text-border">·</span>}
              {database.platform && <span className="ml-1.5">{database.platform}</span>}
            </p>
          </div>
          {database.isActive && (database.portalUrl || database.searchUrl) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setScrapeOpen(true)}
              data-testid={`button-scrape-${database.id}`}
            >
              <Download className="h-3 w-3 mr-1.5" />
              Scrape
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {database.portalUrl && (
            <a
              href={database.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-500 hover:text-blue-400 transition-colors font-medium"
              data-testid={`link-portal-url-${database.id}`}
            >
              <ExternalLink className="h-3 w-3" />
              Portal
            </a>
          )}
          {database.searchUrl && (
            <a
              href={database.searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground transition-colors"
              data-testid={`link-search-url-${database.id}`}
            >
              <Search className="h-3 w-3" />
              Search
            </a>
          )}
          {database.phone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {database.phone}
            </span>
          )}
          {database.email && (
            <a href={`mailto:${database.email}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
              <Mail className="h-3 w-3" />
              {database.email}
            </a>
          )}
        </div>

        {database.searchableFields && database.searchableFields.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {database.searchableFields.map((field) => (
              <span key={field} className="text-[11px] px-2 py-0.5 rounded-md bg-muted capitalize text-muted-foreground">
                {field}
              </span>
            ))}
          </div>
        )}

        {database.lastScrapedAt && (
          <p className="text-[11px] text-muted-foreground">
            Last scraped {new Date(database.lastScrapedAt).toLocaleString()}
          </p>
        )}

        {database.notes && (
          <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">{database.notes}</p>
        )}
      </Card>

      <ScrapeDialog
        database={database}
        open={scrapeOpen}
        onOpenChange={setScrapeOpen}
      />
    </>
  );
}

interface ScrapeStatus {
  status: "pending" | "running" | "completed" | "error";
  message: string;
  resultsFound: number;
  currentPage: number;
  totalPages: number;
}

function getSearchOptions(platform: string | null) {
  switch (platform) {
    case "Skagit County":
      return [
        { value: "address", label: "Address" },
        { value: "name", label: "Name (Last, First)" },
        { value: "permit_number", label: "Permit Number" },
        { value: "parcel", label: "Parcel ID" },
      ];
    case "Tyler EnerGov":
      return [
        { value: "address", label: "Address" },
        { value: "permit_number", label: "Permit / Case Number" },
        { value: "name", label: "Name" },
      ];
    case "eTRAKiT":
      return [
        { value: "address", label: "Address" },
        { value: "permit_number", label: "Permit Number" },
        { value: "name", label: "Name" },
      ];
    case "SmartGov":
    default:
      return [{ value: "address", label: "Address" }];
  }
}

function getPlatformHint(platform: string | null) {
  switch (platform) {
    case "SmartGov":
      return "SmartGov only supports address search.";
    case "Skagit County":
      return "Supports address, name, permit number, or parcel ID.";
    case "Tyler EnerGov":
      return "Supports address, permit/case number, or name.";
    case "eTRAKiT":
      return "May require login for some searches.";
    default:
      return "Enter a search term to scrape permit data from this portal.";
  }
}

function ScrapeDialog({
  database,
  open,
  onOpenChange,
}: {
  database: PermitDatabase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const searchOptions = getSearchOptions(database.platform);
  const [searchType, setSearchType] = useState(searchOptions[0].value);
  const [searchTerm, setSearchTerm] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus | null>(null);
  const { toast } = useToast();

  const scrapeMutation = useMutation({
    mutationFn: async (data: { databaseId: number; searchTerm: string; searchType: string }) => {
      const res = await apiRequest("POST", "/api/scrape", data);
      return res.json();
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setScrapeStatus({ status: "running", message: "Starting scrape...", resultsFound: 0, currentPage: 1, totalPages: 1 });
    },
    onError: (err: Error) => {
      toast({ title: "Scrape failed", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!jobId || !scrapeStatus || scrapeStatus.status === "completed" || scrapeStatus.status === "error") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/scrape/status/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          setScrapeStatus(data);
          if (data.status === "completed" || data.status === "error") clearInterval(interval);
        }
      } catch {}
    }, 1500);
    return () => clearInterval(interval);
  }, [jobId, scrapeStatus?.status]);

  const handleStartScrape = () => {
    if (!searchTerm.trim()) return;
    scrapeMutation.mutate({ databaseId: database.id, searchTerm: searchTerm.trim(), searchType });
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => { setSearchTerm(""); setSearchType(searchOptions[0].value); setJobId(null); setScrapeStatus(null); }, 300);
  };

  const getPlaceholder = () => {
    switch (searchType) {
      case "address": return "e.g., 3520 malland";
      case "name": return "e.g., Smith, John";
      case "company_name": return "e.g., CM Heating LLC";
      case "permit_number": return "e.g., BLD-2025-0791";
      case "parcel": return "e.g., P12345";
      default: return "Enter search term...";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scrape {database.name}</DialogTitle>
          <DialogDescription className="text-sm">
            Search and scrape real permit data from this portal.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          {searchOptions.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search type</label>
              <Select value={searchType} onValueChange={setSearchType} disabled={scrapeMutation.isPending || scrapeStatus?.status === "running"}>
                <SelectTrigger data-testid="select-scrape-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {searchOptions.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search term</label>
            <div className="flex gap-2">
              <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={getPlaceholder()} disabled={scrapeMutation.isPending || scrapeStatus?.status === "running"} onKeyDown={(e) => e.key === "Enter" && handleStartScrape()} data-testid="input-scrape-search" />
              <Button size="icon" onClick={handleStartScrape} disabled={!searchTerm.trim() || scrapeMutation.isPending || scrapeStatus?.status === "running"} data-testid="button-start-scrape">
                {scrapeMutation.isPending || scrapeStatus?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground pt-0.5">{getPlatformHint(database.platform)}</p>
          </div>
          {scrapeStatus && (
            <Card className="p-3 space-y-2 animate-scale-in" style={{ boxShadow: 'none' }}>
              <div className="flex items-center gap-2">
                {scrapeStatus.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {scrapeStatus.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />}
                {scrapeStatus.status === "error" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                <span className="text-sm font-medium capitalize">{scrapeStatus.status}</span>
              </div>
              <p className="text-xs text-muted-foreground">{scrapeStatus.message}</p>
              {scrapeStatus.resultsFound > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold tabular-nums">{scrapeStatus.resultsFound} permits found</span>
                  {scrapeStatus.totalPages > 1 && <span className="text-muted-foreground">Page {scrapeStatus.currentPage} of {scrapeStatus.totalPages}</span>}
                </div>
              )}
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
