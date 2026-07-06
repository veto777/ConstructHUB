import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
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
import {
  Building,
  MapPin,
  Search,
  ArrowUpRight,
  Filter,
  Phone,
  Globe,
} from "lucide-react";
import type { County } from "@shared/schema";

interface PropertyAppraiser {
  id: number;
  name: string;
  countyId: number;
  portalUrl: string;
  searchUrl: string;
  platform: string;
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

  const [stateFilter, setStateFilter] = useState<string>("all");
  const [countyFilter, setCountyFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

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

  const handleStateChange = (val: string) => {
    setStateFilter(val);
    setCountyFilter("all");
  };

  const [page, setPage] = useState(1);
  const perPage = 25;
  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const handleStateChange2 = (val: string) => {
    handleStateChange(val);
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

  return (
    <div className="h-full overflow-auto" data-testid="page-property">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <div className="space-y-2 animate-in">
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-property-title">
            Property Records
          </h1>
          <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
          <p className="text-sm text-muted-foreground max-w-lg">
            Access county property appraiser records nationwide. Look up ownership details, assessed values, construction history, and tax records — direct links to official government portals.
          </p>
        </div>

        <div className="animate-in-delay-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available data</p>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {["Owner info", "LLC status", "Property values", "Construction history", "Lot size", "Sales records", "Tax details", "Exemptions"].map((item) => (
              <span
                key={item}
                className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-3 animate-in-delay-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by city, county, or state..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-9 h-9 text-sm"
              data-testid="input-property-search"
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            </div>
            <Select value={stateFilter} onValueChange={handleStateChange2}>
              <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-state-filter">
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {states.map(s => (
                  <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stateFilter !== "all" && (
              <Select value={countyFilter} onValueChange={handleCountyChange}>
                <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-county-filter">
                  <SelectValue placeholder="All Counties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Counties</SelectItem>
                  {counties.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name} County</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setStateFilter("all"); setCountyFilter("all"); setSearchQuery(""); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-clear-filters"
              >
                Clear filters
              </button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length > perPage
                ? `Showing ${(page - 1) * perPage + 1}–${Math.min(page * perPage, filtered.length)} of ${filtered.length.toLocaleString()} results`
                : `${filtered.length} result${filtered.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>

        <div className="space-y-3 animate-in-delay-2">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Building className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {appraisers && appraisers.length > 0
                  ? "No property appraiser portals match your filters."
                  : "No property appraiser portals configured yet."}
              </p>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => { setStateFilter("all"); setCountyFilter("all"); setSearchQuery(""); }}
                  className="text-xs text-primary mt-2 hover:underline"
                  data-testid="button-clear-empty"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            paginated.map((appraiser) => (
              <Card
                key={appraiser.id}
                className="p-5 hover-elevate transition-all duration-200"
                style={{ boxShadow: 'var(--shadow-2xs)' }}
                data-testid={`card-appraiser-${appraiser.id}`}
              >
                <div className="flex items-start justify-between gap-4">
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

                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      {appraiser.phone && (
                        <a
                          href={`tel:${appraiser.phone}`}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                          data-testid={`link-phone-${appraiser.id}`}
                        >
                          <Phone className="h-3 w-3" />
                          {appraiser.phone}
                        </a>
                      )}
                      {appraiser.portalUrl && (
                        <a
                          href={appraiser.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                          data-testid={`link-website-${appraiser.id}`}
                        >
                          <Globe className="h-3 w-3" />
                          Website
                        </a>
                      )}
                    </div>

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

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                      {appraiser.county?.stateCode}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                      data-testid={`button-search-appraiser-${appraiser.id}`}
                    >
                      <a href={appraiser.searchUrl} target="_blank" rel="noopener noreferrer">
                        <Search className="h-3.5 w-3.5 mr-1.5" />
                        Search
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      asChild
                      data-testid={`button-visit-appraiser-${appraiser.id}`}
                    >
                      <a href={appraiser.portalUrl} target="_blank" rel="noopener noreferrer">
                        Visit
                        <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                      </a>
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="border-t pt-8 animate-in-delay-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">How it works</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-semibold mb-1">1. Search permits</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Find permits on the Search page. Results include a Property Lookup link.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">2. Open appraiser</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Click Property Lookup to jump to the county appraiser portal, or visit directly above.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">3. View details</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                See owner info, LLC status, property values, construction history, lot size, and more.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
