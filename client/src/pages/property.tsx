import { governmentLinkNotice, governmentLinksAvailable } from "@shared/government-links";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { readQueryInt, readQueryParam, replaceQueryParams } from "@/lib/url-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppPage, PageHeader, Toolbar, EmptyState } from "@/components/app-ui";
import {
  Building,
  MapPin,
  Search,
  ArrowUpRight,
  Phone,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { County } from "@shared/schema";

interface PropertyAppraiser {
  id: number;
  name: string;
  countyId: number;
  portalUrl: string | null;
  searchUrl: string | null;
  platform: string | null;
  linkStatus: string | null;
  lastVerifiedAt?: string | null;
  phone: string | null;
  address: string | null;
  searchableFields: string[] | null;
  isActive: boolean;
  notes: string | null;
  county?: County;
}

export default function PropertyPage() {
  const { data: appraisers, isLoading } = useQuery<PropertyAppraiser[]>({
    queryKey: ["/api/property-appraisers"],
  });

  // Filters live in the address bar (?state=WA&countyId=12&q=…&page=2); ?countyId= is
  // also the deep link the Search page's "Property lookup" uses.
  const [stateFilter, setStateFilter] = useState<string>(() => readQueryParam("state")?.toUpperCase() || "all");
  const [countyFilter, setCountyFilter] = useState<string>(() => String(readQueryInt("countyId") ?? "all"));
  const [searchQuery, setSearchQuery] = useState(() => readQueryParam("q") ?? "");
  const [page, setPage] = useState(() => readQueryInt("page") ?? 1);

  // A county deep link selects its state so the county filter is visible (and
  // clearable); an id with no office on record, or an unknown state, falls back to all.
  useEffect(() => {
    if (!appraisers) return;
    if (countyFilter !== "all") {
      const county = appraisers.find(a => String(a.countyId) === countyFilter)?.county;
      if (!county) setCountyFilter("all");
      else if (county.stateCode !== stateFilter) setStateFilter(county.stateCode);
    } else if (stateFilter !== "all" && !appraisers.some(a => a.county?.stateCode === stateFilter)) {
      setStateFilter("all");
    }
  }, [appraisers]);

  const states = useMemo(() => {
    if (!appraisers) return [];
    const unique = new Map<string, string>();
    for (const a of appraisers) {
      if (a.county) {
        unique.set(a.county.stateCode, a.county.state);
      }
    }
    return Array.from(unique.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [appraisers]);

  const counties = useMemo(() => {
    if (!appraisers) return [];
    const unique = new Map<number, { id: number; name: string; stateCode: string }>();
    for (const a of appraisers) {
      if (a.county) {
        unique.set(a.county.id, { id: a.county.id, name: a.county.name, stateCode: a.county.stateCode });
      }
    }
    let list = Array.from(unique.values());
    if (stateFilter !== "all") {
      list = list.filter(c => c.stateCode === stateFilter);
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [appraisers, stateFilter]);

  const filtered = useMemo(() => {
    if (!appraisers) return [];
    const q = searchQuery.toLowerCase().trim();
    return appraisers.filter(a => {
      if (stateFilter !== "all" && a.county?.stateCode !== stateFilter) return false;
      if (countyFilter !== "all" && a.countyId !== parseInt(countyFilter)) return false;
      if (q) {
        const haystack = [
          a.name,
          a.county?.name,
          a.county?.state,
          a.county?.stateCode,
          a.address,
          a.notes,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [appraisers, stateFilter, countyFilter, searchQuery]);

  const perPage = 25;
  const totalPages = Math.ceil(filtered.length / perPage);
  // A page number past the end (stale link, narrower filter) shows the last page.
  const currentPage = Math.min(page, Math.max(1, totalPages));
  const paginated = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  useEffect(() => {
    if (!appraisers) return;
    replaceQueryParams({
      state: stateFilter !== "all" ? stateFilter : null,
      countyId: countyFilter !== "all" ? countyFilter : null,
      q: searchQuery.trim() || null,
      page: currentPage > 1 ? currentPage : null,
    });
  }, [appraisers, stateFilter, countyFilter, searchQuery, currentPage]);

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), Math.max(1, totalPages)));
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStateChange = (val: string) => {
    setStateFilter(val);
    setCountyFilter("all");
    setPage(1);
  };

  const clearFilters = () => {
    setStateFilter("all");
    setCountyFilter("all");
    setSearchQuery("");
    setPage(1);
  };

  const handleCountyChange = (val: string) => {
    setCountyFilter(val);
    setPage(1);
  };

  const handleSearchChange = (e: any) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

  const hasFilters = stateFilter !== "all" || countyFilter !== "all" || searchQuery.trim() !== "";
  const activeFilters = (stateFilter !== "all" ? 1 : 0) + (countyFilter !== "all" ? 1 : 0);

  return (
    <AppPage width="narrow" testId="page-property">
      <PageHeader
        title={<span data-testid="text-property-title">Property records</span>}
        description="County appraiser portals for ownership, values, construction history and tax records."
      />

      <Toolbar
        search={{ value: searchQuery, onChange: handleSearchChange, placeholder: "Search by office, county, or state…", testId: "input-property-search" }}
        activeFilters={activeFilters}
        actions={hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            Clear filters
          </Button>
        ) : undefined}
        filters={(
          <>
            <Select value={stateFilter} onValueChange={handleStateChange}>
              <SelectTrigger className="h-10 w-full sm:w-[180px]" data-testid="select-state-filter">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {states.map(s => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stateFilter !== "all" && (
              <Select value={countyFilter} onValueChange={handleCountyChange}>
                <SelectTrigger className="h-10 w-full sm:w-[180px]" data-testid="select-county-filter">
                  <SelectValue placeholder="All counties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All counties</SelectItem>
                  {counties.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name} County</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
      />

      {isLoading ? (
        <div className="space-y-3" data-testid="property-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building}
          title={appraisers && appraisers.length > 0 ? "No offices match your filters" : "No offices on record yet"}
          description={appraisers && appraisers.length > 0 ? "Try a different search or state." : "Appraiser portals appear here as they are verified."}
          action={hasFilters ? (
            <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-clear-empty">
              Clear filters
            </Button>
          ) : undefined}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="text-result-count">
            {filtered.length > perPage
              ? `Showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, filtered.length)} of ${filtered.length.toLocaleString()} offices`
              : `${filtered.length} office${filtered.length !== 1 ? "s" : ""}`}
          </p>
          <div className="space-y-3">
            {paginated.map((appraiser) => (
              <div
                key={appraiser.id}
                className="rounded-xl border bg-card p-4 sm:p-5"
                data-testid={`card-appraiser-${appraiser.id}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold">{appraiser.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {appraiser.county?.name} County, {appraiser.county?.state}
                    </p>

                    {appraiser.address && (
                      <p className="text-xs text-muted-foreground mt-1 pl-4">
                        {appraiser.address}
                      </p>
                    )}

                    {/* The official site opens from "Visit"; no second inline link to the same URL. */}
                    {appraiser.phone && (
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <a
                          href={`tel:${appraiser.phone}`}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                          data-testid={`link-phone-${appraiser.id}`}
                        >
                          <Phone className="h-3 w-3" />
                          {appraiser.phone}
                        </a>
                      </div>
                    )}

                    {governmentLinksAvailable(appraiser) && governmentLinkNotice(appraiser) && <p className="text-xs text-muted-foreground mt-2">{governmentLinkNotice(appraiser)}</p>}

                    {appraiser.searchableFields && appraiser.searchableFields.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {appraiser.searchableFields.map((field) => (
                          <span key={field} className="text-[11px] px-2 py-0.5 rounded-md bg-muted capitalize text-muted-foreground">
                            {field}
                          </span>
                        ))}
                      </div>
                    )}

                    {appraiser.notes && (
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{appraiser.notes}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      {appraiser.county?.stateCode}
                    </Badge>
                    {governmentLinksAvailable(appraiser) && appraiser.searchUrl && appraiser.searchUrl !== appraiser.portalUrl && <Button
                      size="sm"
                      variant="outline"
                      asChild
                      data-testid={`button-search-appraiser-${appraiser.id}`}
                    >
                      <a href={appraiser.searchUrl} target="_blank" rel="noopener noreferrer">
                        <Search className="h-3.5 w-3.5 mr-1.5" />
                        Search
                      </a>
                    </Button>}
                    {governmentLinksAvailable(appraiser) && appraiser.portalUrl && <Button
                      size="sm"
                      variant="outline"
                      asChild
                      data-testid={`button-visit-appraiser-${appraiser.id}`}
                    >
                      <a href={appraiser.portalUrl} target="_blank" rel="noopener noreferrer">
                        Visit
                        <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                      </a>
                    </Button>}
                    {(!governmentLinksAvailable(appraiser) || (!appraiser.portalUrl && !appraiser.searchUrl)) && (
                      <a className="text-xs text-muted-foreground hover:underline" target="_blank" rel="noopener noreferrer"
                        data-testid={`link-appraiser-fallback-${appraiser.id}`}
                        href={`https://www.google.com/search?q=${encodeURIComponent(`${appraiser.county?.name || appraiser.name} ${appraiser.county?.stateCode || ""} assessor property records`)}`}>
                        Find property records
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 py-4" data-testid="pagination">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-page-status">
                Page {currentPage} of {totalPages.toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
                data-testid="button-next-page"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </AppPage>
  );
}
