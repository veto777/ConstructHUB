import { governmentLinkNotice, governmentLinksAvailable } from "@shared/government-links";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { readQueryInt, readQueryParam, replaceQueryParams } from "@/lib/url-query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppPage, Toolbar, EmptyState } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import {
  Building,
  Search,
  ExternalLink,
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

  // Toolbar hands its search box's text, not the input event (components/app-ui.tsx).
  // This was typed `(e: any)` and read e.target.value: every keystroke threw
  // "Cannot read properties of undefined (reading 'value')". Typed, tsc refuses that.
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(1);
  };

  const hasFilters = stateFilter !== "all" || countyFilter !== "all" || searchQuery.trim() !== "";
  const activeFilters = (stateFilter !== "all" ? 1 : 0) + (countyFilter !== "all" ? 1 : 0);

  return (
    <AppPage width="narrow" testId="page-property">
      {/* Google's local-pack format (owner, 2026-10-07): a quiet header, hairline rows, pill actions. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-property-title"
        title="Property records"
        description="County appraiser portals for ownership, values, construction history and tax records."
        flush
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
            <div key={i} className="h-24 animate-pulse g-divider" />
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
          <p className="g-text-2 text-sm tabular-nums" data-testid="text-result-count">
            {filtered.length > perPage
              ? `Showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, filtered.length)} of ${filtered.length.toLocaleString()} offices`
              : `${filtered.length} office${filtered.length !== 1 ? "s" : ""}`}
          </p>
          <GoogleList testId="list-appraisers">
            {paginated.map((appraiser) => {
              const linksOk = governmentLinksAvailable(appraiser);
              const notice = linksOk ? governmentLinkNotice(appraiser) : null;
              // No usable official link on record: an honest web search, never a fabricated portal.
              const fallback = !linksOk || (!appraiser.portalUrl && !appraiser.searchUrl);
              return (
                <GoogleListRow
                  key={appraiser.id}
                  testId={`card-appraiser-${appraiser.id}`}
                  title={appraiser.name}
                  meta={[
                    appraiser.county ? `${appraiser.county.name} County, ${appraiser.county.state}` : null,
                    appraiser.address,
                  ]}
                  line={notice || appraiser.notes ? (
                    <>
                      {notice && <span>{notice}</span>}
                      {notice && appraiser.notes && <span aria-hidden="true"> · </span>}
                      {appraiser.notes && <span>{appraiser.notes}</span>}
                    </>
                  ) : undefined}
                  actions={<>
                    {linksOk && appraiser.portalUrl && (
                      <GooglePill icon={ExternalLink} label="Open portal" href={appraiser.portalUrl} external testId={`button-visit-appraiser-${appraiser.id}`} />
                    )}
                    {linksOk && appraiser.searchUrl && appraiser.searchUrl !== appraiser.portalUrl && (
                      <GooglePill icon={Search} label="Search records" href={appraiser.searchUrl} external testId={`button-search-appraiser-${appraiser.id}`} />
                    )}
                    {fallback && (
                      <GooglePill
                        icon={Search}
                        variant="quiet"
                        label="Find property records"
                        external
                        testId={`link-appraiser-fallback-${appraiser.id}`}
                        title="No official portal on record — search the web for this county's property records"
                        href={`https://www.google.com/search?q=${encodeURIComponent(`${appraiser.county?.name || appraiser.name} ${appraiser.county?.stateCode || ""} assessor property records`)}`}
                      />
                    )}
                    {appraiser.phone && (
                      <GooglePill icon={Phone} label="Call" href={`tel:${appraiser.phone.replace(/[^\d+]/g, "")}`} title={appraiser.phone} testId={`link-phone-${appraiser.id}`} />
                    )}
                  </>}
                >
                  {appraiser.searchableFields && appraiser.searchableFields.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {appraiser.searchableFields.map((field) => (
                        <span key={field} className="g-chip g-chip--sm">{field}</span>
                      ))}
                    </div>
                  )}
                </GoogleListRow>
              );
            })}
          </GoogleList>
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
              <span className="g-text-2 text-sm tabular-nums" data-testid="text-page-status">
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
