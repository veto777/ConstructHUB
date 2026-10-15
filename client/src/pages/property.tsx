import { PlanRequired, planRequiredFrom } from "@/components/plan-required";
import { planNamesWhere } from "@shared/plan-copy";
import { propertyJurisdictionLabel, propertyOfficeForDisplay, propertyOfficeLinks, resolvePropertyScope } from "./property-display";
import { PropertyOfficeRow, type PropertyAppraiser } from "@/components/property-office-row";
import { PropertyMap } from "@/components/property-map";
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
import { AppPage, Toolbar, EmptyState, Notice } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { Building, ChevronLeft, ChevronRight, Search } from "lucide-react";

export default function PropertyPage() {
  const { data: rawAppraisers, isLoading, error, refetch } = useQuery<PropertyAppraiser[]>({
    queryKey: ["/api/property-appraisers"],
  });

  const appraisers = useMemo(() => rawAppraisers?.map(propertyOfficeForDisplay), [rawAppraisers]);
  const [scopeNotice, setScopeNotice] = useState("");
  // Filters live in the address bar (?state=WA&countyId=12&q=…&page=2); ?countyId= is
  // also the deep link the Search page's "Property lookup" uses.
  const [stateFilter, setStateFilter] = useState<string>(() => readQueryParam("state")?.toUpperCase() || "all");
  const [countyFilter, setCountyFilter] = useState<string>(() => readQueryParam("countyId") || "all");
  const [searchQuery, setSearchQuery] = useState(() => readQueryParam("q") ?? "");
  const [page, setPage] = useState(() => readQueryInt("page") ?? 1);

  // A county deep link selects its state so the county filter is visible (and
  // clearable); an id with no office on record, or an unknown state, falls back to all.
  useEffect(() => {
    if (!appraisers) return;
    const scope = resolvePropertyScope(appraisers, stateFilter, countyFilter);
    setStateFilter(scope.state); setCountyFilter(scope.county);
    if (scope.notice) setScopeNotice(scope.notice);
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
    setScopeNotice("");
    setStateFilter("all");
    setCountyFilter("all");
    setSearchQuery("");
    setPage(1);
  };

  const scrollToList = () => requestAnimationFrame(() =>
    document.querySelector('[data-testid="text-result-count"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const showCountyInList = (countyId: number, stateCode: string) => {
    setScopeNotice("");
    setSearchQuery("");
    setStateFilter(stateCode);
    setCountyFilter(String(countyId));
    setPage(1);
    scrollToList();
  };
  const showStateInList = (stateCode: string) => {
    setScopeNotice("");
    setSearchQuery("");
    handleStateChange(stateCode);
    scrollToList();
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

  // The number strip: counted from the office rows themselves with the same rule the row and the map use
  // (propertyOfficeLinks), so a tile can never promise a link a row does not show.
  const officeTotals = useMemo(() => {
    const rows = appraisers ?? [];
    const links = rows.map(propertyOfficeLinks);
    return {
      offices: rows.length,
      states: new Set(rows.map((a) => a.county?.stateCode).filter(Boolean)).size,
      site: links.filter((l) => l.showPortal || l.showSearch).length,
      phoneOnly: links.filter((l) => !(l.showPortal || l.showSearch) && l.shade === "phone").length,
    };
  }, [appraisers]);

  const hasFilters = stateFilter !== "all" || countyFilter !== "all" || searchQuery.trim() !== "";
  const activeFilters = (stateFilter !== "all" ? 1 : 0) + (countyFilter !== "all" ? 1 : 0);

  if (error && (!rawAppraisers || planRequiredFrom(error) || /^40[123]:/.test(error.message))) return <AppPage width="narrow" testId="page-property">
    <GoogleSectionHeader as="h1" title="Property records" flush />
    {planRequiredFrom(error) ? <PlanRequired module="propertyRecords" error={error} /> : /^401:/.test(error.message) ?
      <Notice tone="info">Sign in to access Property Records. Included with {planNamesWhere(p => p.modules.propertyRecords)}. <Button asChild variant="outline"><a href={`/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>Sign in</a></Button></Notice> :
      <Notice tone="danger">Couldn't load property offices. <Button variant="outline" onClick={() => void refetch()}>Retry</Button></Notice>}
  </AppPage>;
  return (
    <AppPage width="narrow" testId="page-property">
      {error && <Notice tone="danger">Refresh failed — showing saved property offices. <Button variant="outline" onClick={() => void refetch()}>Retry</Button></Notice>}
      {/* Google's local-pack format (owner, 2026-10-07): a quiet header, hairline rows, pill actions. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-property-title"
        title="Property records"
        description="Find the county assessor or appraiser office that holds a property's ownership, value and tax records, and open its official site."
        flush
      />

      {appraisers && appraisers.length > 0 && (
        <GoogleStatGrid cols={3}>
          <GoogleStat label="Offices on record" value={officeTotals.offices.toLocaleString()} hint={`${officeTotals.states} states · from NETR Online's directory`} testId="stat-property-offices" />
          <GoogleStat label="Offices with a records site" value={officeTotals.site.toLocaleString()} hint="An official site on record that passed its check (the map counts counties)" testId="stat-property-sites" />
          <GoogleStat label="Offices with phone only" value={officeTotals.phoneOnly.toLocaleString()} hint="No usable site link on record; a web search is offered instead" testId="stat-property-phone-only" />
        </GoogleStatGrid>
      )}

      {/* County map (owner, 2026-10-14): each county shaded by what the list holds for it; a click shows
          the same office row the list shows and can filter the list to that county. */}
      {appraisers && appraisers.length > 0 && (
        <PropertyMap offices={appraisers} onShowCounty={showCountyInList} onShowState={showStateInList} />
      )}

      {page > totalPages && totalPages > 0 && <Notice tone="info">That page is no longer available. Showing the last available page.</Notice>}
      {scopeNotice && <Notice tone="info">{scopeNotice}</Notice>}
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
            <div><label htmlFor="property-state" className="text-sm">State</label><Select value={stateFilter} onValueChange={handleStateChange}>
              <SelectTrigger className="h-10 w-full sm:w-[180px]" id="property-state" data-testid="select-state-filter">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {states.map(s => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select></div>
            {stateFilter !== "all" && (
              <div><label htmlFor="property-county" className="text-sm">{stateFilter === "AK" ? "Borough / census area" : "County / jurisdiction"}</label><Select value={countyFilter} onValueChange={handleCountyChange}>
                <SelectTrigger className="h-10 w-full sm:w-[180px]" id="property-county" data-testid="select-county-filter">
                  <SelectValue placeholder="All jurisdictions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All jurisdictions</SelectItem>
                  {counties.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{propertyJurisdictionLabel(c)}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
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
      ) : filtered.length === 0 && appraisers && appraisers.length > 0 ? (
        <EmptyState
          icon={Building}
          title="No offices match your filters"
          description="Try a different search or state. Only offices on record match; nothing is guessed."
          action={hasFilters ? (
            <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-clear-empty">
              Clear filters
            </Button>
          ) : undefined}
        />
      ) : filtered.length === 0 ? (
        /* Nothing on record at all (a fresh database): say what will appear and where it comes from. No sample offices (CLAUDE.md). */
        <div className="g-callout" data-testid="empty-property-offices">
          <h3>No offices on record yet</h3>
          <p>One row per county assessor or property appraiser office will appear here: its name, county and address, with Open portal and Search records when its official site is on record, “Find property records” (a web search) when it is not, and Call when a phone number is.</p>
          <p className="mt-2">The list comes from NETR Online's directory of assessor and appraiser offices, loaded into ConstructHUB's reference data and checked link by link; it is filled when the server's reference data is seeded. Until then, search the web for the county's assessor.</p>
          <div className="mt-3"><GooglePill icon={Search} label="Find a county assessor on the web" href="https://www.google.com/search?q=county+assessor+property+records" external testId="link-property-empty-search" /></div>
        </div>
      ) : (
        <>
          <p className="g-text-2 text-sm tabular-nums" aria-live="polite" data-testid="text-result-count">
            {filtered.length > perPage
              ? `Showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, filtered.length)} of ${filtered.length.toLocaleString()} offices`
              : `${filtered.length} office${filtered.length !== 1 ? "s" : ""}`}
          </p>
          <GoogleList testId="list-appraisers">
            {paginated.map((appraiser) => <PropertyOfficeRow key={appraiser.id} appraiser={appraiser} />)}
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
