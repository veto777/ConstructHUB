import { governmentLinkNotice, governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { countyLabel } from "@shared/county-labels";
import { useState, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CheckCircle2,
  XCircle,
  Search,
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
  Building,
} from "lucide-react";
import { AppPage, Toolbar, EmptyState } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { apiRequest } from "@/lib/queryClient";
import { readQueryInt, readQueryParam, replaceQueryParams } from "@/lib/url-query";
import { useToast } from "@/hooks/use-toast";
import { HelpButton } from "@/components/help-button";
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
  /** Rows with a usable official portal link — shown only when the server reports it. */
  withPortal?: number;
  viaCounty?: number;
}

/** Old seeders wrote this line into every placeholder row; it is a template, not a source. */
const SEEDED_PLACEHOLDER_NOTE = /^Contact .+ Building Department for permit information\./;

export default function DatabasesPage() {
  // Filters live in the address bar (?state=WA&county=12&type=city&q=…&page=2) so a
  // refresh or shared link reopens the same view.
  const [searchInput, setSearchInput] = useState(() => readQueryParam("q") ?? "");
  const [searchQuery, setSearchQuery] = useState(() => readQueryParam("q") ?? "");
  const [selectedState, setSelectedState] = useState(() => readQueryParam("state")?.toUpperCase() || "all");
  const [selectedCountyId, setSelectedCountyId] = useState<string>(() => String(readQueryInt("county") ?? "all"));
  const [jurisdictionFilter, setJurisdictionFilter] = useState<JurisdictionFilter>(() => {
    const type = readQueryParam("type");
    return type === "county" || type === "city" ? type : "all";
  });
  const [currentPage, setCurrentPage] = useState(() => readQueryInt("page") ?? 1);

  useEffect(() => {
    if (searchInput === searchQuery) return;
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    replaceQueryParams({
      state: selectedState !== "all" ? selectedState : null,
      county: selectedCountyId !== "all" ? selectedCountyId : null,
      type: jurisdictionFilter !== "all" ? jurisdictionFilter : null,
      q: searchQuery || null,
      page: currentPage > 1 ? currentPage : null,
    });
  }, [selectedState, selectedCountyId, jurisdictionFilter, searchQuery, currentPage]);

  const { data: counties } = useQuery<County[]>({
    queryKey: ["/api/counties"],
  });

  const { data: counts } = useQuery<DbCounts>({
    queryKey: ["/api/databases/counts"],
  });

  const allStates = useMemo(() => {
    const map = new Map<string, string>();
    (counties ?? []).forEach(c => { if (c.stateCode && c.state) map.set(c.stateCode, c.state); });
    return Array.from(map, ([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [counties]);

  // A link may carry only a county (or a stale code): show the matching state so the
  // county select is visible, and drop values this directory doesn't know.
  useEffect(() => {
    if (!counties) return;
    if (selectedCountyId !== "all") {
      const county = counties.find(c => String(c.id) === selectedCountyId);
      if (!county) setSelectedCountyId("all");
      else if (county.stateCode !== selectedState) setSelectedState(county.stateCode);
    } else if (selectedState !== "all" && !counties.some(c => c.stateCode === selectedState)) {
      setSelectedState("all");
    }
  }, [counties]);

  const stateCountiesForDropdown = useMemo(() =>
    selectedState !== "all"
      ? (counties ?? []).filter(c => c.stateCode === selectedState).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [selectedState, counties]
  );

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ filtered: "true", page: String(currentPage), limit: String(PAGE_SIZE) });
    if (jurisdictionFilter !== "all") p.set("jurisdictionType", jurisdictionFilter);
    if (selectedCountyId !== "all") {
      p.set("countyId", selectedCountyId);
    } else if (selectedState !== "all") {
      p.set("stateCode", selectedState);
    }
    if (searchQuery) p.set("search", searchQuery);
    return p.toString();
  }, [currentPage, jurisdictionFilter, selectedCountyId, selectedState, searchQuery]);

  const { data: result, isLoading, isFetching, isPlaceholderData } = useQuery<FilteredResult>({
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

  // A page past the end (stale or shared link, data changed since) opens the last page
  // instead of claiming nothing matches.
  useEffect(() => {
    if (result && !isPlaceholderData && totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [result, isPlaceholderData, totalPages, currentPage]);

  const countyMap = useMemo(() => {
    const map = new Map<number, County>();
    (counties ?? []).forEach(c => map.set(c.id, c));
    return map;
  }, [counties]);

  const handleFilterChange = (setter: (v: any) => void) => (val: any) => {
    setter(val);
    setCurrentPage(1);
  };

  const resetAll = () => {
    setSearchInput("");
    setSearchQuery("");
    setSelectedState("all");
    setSelectedCountyId("all");
    setJurisdictionFilter("all");
    setCurrentPage(1);
  };

  const hasFilters = searchQuery !== "" || selectedState !== "all" || selectedCountyId !== "all";
  const activeFilters = (selectedState !== "all" ? 1 : 0) + (selectedCountyId !== "all" ? 1 : 0);

  return (
    <AppPage width="narrow" testId="page-databases">
      {/* Google's local-pack format (owner, 2026-10-07): a quiet header, number tiles, filter pills, hairline rows. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="Database directory"
        titleAfter={<HelpButton k="database-directory" />}
        description="Browse US counties and cities for permit offices — official portals where they are on record."
        flush
      />

      {counts && (
        <GoogleStatGrid cols={3}>
          <GoogleStat
            label="Jurisdictions"
            value={counts.total.toLocaleString()}
            testId="text-database-count"
            hint={typeof counts.withPortal === "number" ? (
              <span data-testid="text-portal-count">{counts.withPortal.toLocaleString()} with a permit portal on record{counts.viaCounty ? <>, {counts.viaCounty.toLocaleString()} through their county</> : null}</span>
            ) : undefined}
          />
          <GoogleStat label="Counties" value={counts.county.toLocaleString()} />
          <GoogleStat label="Cities" value={counts.city.toLocaleString()} />
        </GoogleStatGrid>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Jurisdiction type" data-testid="filter-jurisdiction-type">
          {([
            { key: "all" as const, label: "All", count: counts?.total },
            { key: "county" as const, label: "Counties", count: counts?.county },
            { key: "city" as const, label: "Cities", count: counts?.city },
          ]).map(({ key, label, count }) => (
            <GooglePill
              key={key}
              role="radio"
              ariaPressed={jurisdictionFilter === key}
              selected={jurisdictionFilter === key}
              onClick={() => handleFilterChange(setJurisdictionFilter)(key)}
              label={<>{label}{count != null && <span className="ml-1.5 text-xs font-normal tabular-nums g-text-2">{count.toLocaleString()}</span>}</>}
              testId={`button-filter-${key}`}
            />
          ))}
        </div>

        <Toolbar
          search={{ value: searchInput, onChange: setSearchInput, placeholder: "Search by city, county, or state…", testId: "input-database-search" }}
          activeFilters={activeFilters}
          actions={hasFilters ? (
            <Button variant="ghost" size="sm" onClick={resetAll} data-testid="button-clear-filters">
              Clear filters
            </Button>
          ) : undefined}
          filters={(
            <>
              <Select
                value={selectedState}
                onValueChange={(val) => {
                  handleFilterChange(setSelectedState)(val);
                  setSelectedCountyId("all");
                }}
              >
                <SelectTrigger className="h-10 w-full sm:w-[200px]" data-testid="select-state-filter">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states ({allStates.length})</SelectItem>
                  {allStates.map((state) => (
                    <SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedState !== "all" && stateCountiesForDropdown.length > 0 && (
                <Select
                  value={selectedCountyId}
                  onValueChange={handleFilterChange(setSelectedCountyId)}
                >
                  <SelectTrigger className="h-10 w-full sm:w-[200px]" data-testid="select-county-filter">
                    <SelectValue placeholder="All counties" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All counties</SelectItem>
                    {stateCountiesForDropdown.map((county) => (
                      <SelectItem key={county.id} value={county.id.toString()}>
                        {county.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : databases.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No databases match your search"
          description="Try a different city, county or state."
          action={
            <Button variant="outline" size="sm" onClick={resetAll} data-testid="button-clear-filters-empty">
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="g-text-2 text-sm tabular-nums" data-testid="text-result-count">
            Showing {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(currentPage * PAGE_SIZE, totalResults).toLocaleString()} of {totalResults.toLocaleString()} results
            {isFetching && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
          </p>
          <GoogleList testId="list-databases">
            {databases.map((db) => {
              const county = countyMap.get(db.countyId);
              return (
                <DatabaseCard key={db.id} database={db} countyName={county?.name} />
              );
            })}
          </GoogleList>
          {totalPages > 1 && (
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}
    </AppPage>
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

type IssuedByPortal = { jurisdiction: string; portalUrl: string | null; searchUrl: string | null; linkStatus: string | null };

function DatabaseCard({ database, countyName }: { database: PermitDatabase; countyName?: string }) {
  // "Acadia Parish", "Kusilvak Census Area", "City of Alexandria" — not every county-equivalent is a "County".
  const stateCode = /, ([A-Z]{2})$/.exec(database.jurisdiction)?.[1] ?? "";
  const [scrapeOpen, setScrapeOpen] = useState(false);
  // "Active", searchable fields and notes describe a portal; a jurisdiction with no
  // usable portal on record gets none of them (never a templated placeholder).
  const hasPortal = governmentLinksAvailable(database) && !!(database.portalUrl || database.searchUrl);
  // No permit office of its own, and an official page shows the county issues its permits (seed-permit-routing.ts).
  const viaCounty = !hasPortal ? (database as PermitDatabase & { issuedByPortal?: IssuedByPortal | null }).issuedByPortal ?? null : null;
  const viaCountyName = viaCounty?.jurisdiction.replace(/, [A-Z]{2}$/, "");
  const notes = database.notes && !SEEDED_PLACEHOLDER_NOTE.test(database.notes) ? database.notes : null;
  // Seeded placeholders were titled "City of X" / "X County Building Department" — an
  // office nobody verified. Without a portal, name the place itself.
  const templatedName = database.name === `City of ${database.jurisdiction.replace(/, [A-Z]{2}$/, "")}`
    || database.name === `${database.jurisdiction.replace(/, [A-Z]{2}$/, "")} Building Department`;
  const title = !hasPortal && templatedName ? database.jurisdiction : database.name;
  // What the meta line says about the link: the verify-links pipeline marks a portal live/verified, a
  // source-listed link it could not confirm stays "unconfirmed" (never shown as verified).
  const unconfirmed = hasPortal && database.linkStatus === "unconfirmed";
  const canScrape = governmentLinksAvailable(database) && canScrapeGovernmentPortal(database);
  const noPortal = !viaCounty && (!governmentLinksAvailable(database) || (!database.portalUrl && !database.searchUrl));
  const status = hasPortal
    ? <span className={unconfirmed ? "g-text-2" : "g-open"} data-testid={`status-portal-${database.id}`}>{unconfirmed ? "Official site · unconfirmed" : "Verified portal"}</span>
    : viaCounty
      ? <span className="g-open" data-testid={`status-portal-${database.id}`}>Permits issued by {viaCountyName}</span>
      : <span className="g-text-2" data-testid={`status-portal-${database.id}`}>No portal on record</span>;

  // The small grey line: the link notice, the official "issued by" source, email, last scrape — only what exists.
  const notice = governmentLinksAvailable(database) ? governmentLinkNotice(database) : null;
  const lineParts: ReactNode[] = [];
  if (notice) lineParts.push(notice);
  // The county issues this town's building permits: the official page that says so.
  if (viaCounty && database.issuedBySource) lineParts.push(
    <a
      href={database.issuedBySource}
      target="_blank"
      rel="noopener noreferrer"
      title={database.issuedByQuote ? `“${database.issuedByQuote}”` : undefined}
      data-testid={`link-county-source-${database.id}`}
    >
      Source: permits issued by {viaCountyName}
    </a>,
  );
  if (database.email) lineParts.push(<a href={`mailto:${database.email}`}>{database.email}</a>);
  if (database.lastScrapedAt) lineParts.push(`Last scraped ${new Date(database.lastScrapedAt).toLocaleString()}`);

  return (
    <>
      <GoogleListRow
        testId={`card-database-${database.id}`}
        title={title}
        badges={<span className="g-chip g-chip--sm">{database.jurisdictionType}</span>}
        meta={[
          title !== database.jurisdiction ? database.jurisdiction : null,
          database.jurisdictionType === "city" && countyName ? countyLabel(countyName, stateCode) : null,
          status,
          database.platform,
        ]}
        line={lineParts.length > 0 ? lineParts.map((part, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{part}</span>) : undefined}
        actions={<>
          {governmentLinksAvailable(database) && database.portalUrl && (
            <GooglePill icon={ExternalLink} label="Open portal" href={database.portalUrl} external testId={`link-portal-url-${database.id}`} />
          )}
          {governmentLinksAvailable(database) && database.searchUrl && (
            <GooglePill icon={Search} label="Search portal" href={database.searchUrl} external testId={`link-search-url-${database.id}`} />
          )}
          {/* The county issues this town's building permits: its portal. */}
          {viaCounty && (
            <GooglePill icon={ExternalLink} label={`${viaCountyName} permit portal`} href={(viaCounty.portalUrl || viaCounty.searchUrl)!} external testId={`link-county-portal-${database.id}`} />
          )}
          {/* No official portal on record: offer an honest web search rather than a
              fabricated link. Clearly labeled and styled as a "find", not a portal. */}
          {noPortal && (
            <GooglePill
              icon={Search}
              variant="quiet"
              label="Find permit portal"
              href={`https://www.google.com/search?q=${encodeURIComponent(`${database.jurisdiction} building permit search portal`)}`}
              external
              testId={`link-search-fallback-${database.id}`}
              title="No official portal on record — search the web for this jurisdiction's permit portal"
            />
          )}
          {database.phone && (
            <GooglePill icon={Phone} label="Call" href={`tel:${database.phone.replace(/[^\d+]/g, "")}`} title={database.phone} testId={`link-phone-${database.id}`} />
          )}
          <GooglePill icon={Building} label="Property lookup" href={`/property?countyId=${database.countyId}`} testId={`link-property-lookup-${database.id}`} />
          {canScrape && (
            <GooglePill icon={Download} label="Scrape" onClick={() => setScrapeOpen(true)} testId={`button-scrape-${database.id}`} />
          )}
        </>}
      >
        {hasPortal && database.searchableFields && database.searchableFields.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {database.searchableFields.map((field) => (
              <span key={field} className="g-chip g-chip--sm">{field}</span>
            ))}
          </div>
        )}
        {notes && <p className="g-card__meta mt-2">{notes}</p>}
      </GoogleListRow>

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
            <div className="rounded-xl border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                {scrapeStatus.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {scrapeStatus.status === "completed" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
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
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
