import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusPill } from "@/components/crm-ui";
import {
  DIRECTORY_CATEGORIES,
  DIRECTORY_KINDS,
  TIER_LABELS,
  type Directory,
  type CataloguePage,
  type CatalogueFacets,
} from "@shared/directories";
import { getJson, label, LoadError, SafeLink, selectClass } from "./common";

const filterKeys = [
  "q",
  "category",
  "tier",
  "kind",
  "grade",
  "dr_min",
  "dr_max",
  "state",
  "trade",
  "link",
  "paid",
  "active",
  "sort",
  "dir",
  "limit",
  "offset",
];
const states =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  );
const pageSizes = [10, 25, 50, 100, 250];

export function Catalogue({
  adminActions,
}: {
  adminActions?: (directory: Directory) => React.ReactNode;
}) {
  const [filtersOpen, setFiltersOpen] = useState(
    () => window.matchMedia("(min-width: 640px)").matches,
  );
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    const events = ["popstate", "pushState", "replaceState", "urlparamchange"];
    events.forEach((event) => window.addEventListener(event, sync));
    return () =>
      events.forEach((event) => window.removeEventListener(event, sync));
  }, []);
  const params = new URLSearchParams(search);
  const value = (key: string) => params.get(key) ?? "";
  const limit = pageSizes.includes(Number(value("limit")))
    ? Number(value("limit"))
    : 25;
  const offset = /^\d+$/.test(value("offset")) ? Number(value("offset")) : 0;
  const update = (changes: Record<string, string>, resetPage = true) => {
    const url = new URL(window.location.href);
    if (resetPage) url.searchParams.delete("offset");
    for (const [key, next] of Object.entries(changes)) {
      if (next) url.searchParams.set(key, next);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event("urlparamchange"));
  };
  const clear = () =>
    update(
      Object.fromEntries(
        filterKeys.filter((key) => key !== "limit").map((key) => [key, ""]),
      ),
    );
  const queryParams = new URLSearchParams();
  for (const key of filterKeys)
    if (value(key)) queryParams.set(key, value(key));
  queryParams.set("limit", String(limit));
  queryParams.set("offset", String(offset));
  const url = `/api/directories/directories?${queryParams}`;
  const query = useQuery<CataloguePage>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  const facetParams = new URLSearchParams(queryParams);
  for (const key of [
    "category",
    "tier",
    "kind",
    "grade",
    "dr_min",
    "dr_max",
    "limit",
    "offset",
    "sort",
    "dir",
  ])
    facetParams.delete(key);
  const facetUrl = `/api/directories/directories/facets?${facetParams}`;
  const facets = useQuery<CatalogueFacets>({
    queryKey: [facetUrl],
    queryFn: () => getJson(facetUrl),
  });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((number) => number >= 1 && number <= pages)
    .sort((a, b) => a - b);
  const sort = (key: string) =>
    update({
      sort: key,
      dir:
        (value("sort") || "tier") === key && value("dir") !== "desc"
          ? "desc"
          : "asc",
    });
  const heading = (key: string, title: string) => (
    <th
      className="p-3 font-medium"
      aria-sort={
        (value("sort") || "tier") === key
          ? value("dir") === "desc"
            ? "descending"
            : "ascending"
          : "none"
      }
    >
      <button
        type="button"
        className="whitespace-nowrap hover:text-primary"
        onClick={() => sort(key)}
      >
        {title}{" "}
        {(value("sort") || "tier") === key
          ? value("dir") === "desc"
            ? "↓"
            : "↑"
          : "↕"}
      </button>
    </th>
  );
  const multiSelect = (
    key: string,
    title: string,
    options: readonly string[],
  ) => {
    const selected = value(key).split(",").filter(Boolean);
    return (
      <div className="space-y-1">
        <p className="text-sm">{title}</p>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
              aria-label={title}
            >
              {selected.length
                ? `${selected.length} selected`
                : {
                    category: "All categories",
                    tier: "All tiers",
                    kind: "All API types",
                    grade: "All grades",
                  }[key]}{" "}
              <span>⌄</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 max-h-80 overflow-y-auto"
            align="start"
          >
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">{title}</legend>
              {options.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(event) =>
                      update({
                        [key]: (event.target.checked
                          ? [...selected, option]
                          : selected.filter((item) => item !== option)
                        ).join(","),
                      })
                    }
                  />
                  <span className="flex-1">
                    {key === "tier"
                      ? `Tier ${option} · ${TIER_LABELS[option]}`
                      : label(option)}
                  </span>
                  <span className="text-muted-foreground">
                    {facets.data?.[key]?.[option] ?? 0}
                  </span>
                </label>
              ))}
            </fieldset>
          </PopoverContent>
        </Popover>
      </div>
    );
  };
  const select = (key: string, title: string, options: [string, string][]) => (
    <label className="space-y-1 text-sm">
      <span>{title}</span>
      <select
        className={selectClass}
        value={value(key)}
        onChange={(event) => update({ [key]: event.target.value })}
      >
        <option value="">All</option>
        {options.map(([key, title]) => (
          <option key={key} value={key}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div
      className="min-w-0 max-w-full space-y-4"
      data-testid="directory-catalogue"
    >
      <p className="text-sm text-muted-foreground">
        Explore researched directories. Coverage and requirements may still need
        confirmation.
      </p>
      <label className="block text-sm">
        Search directories
        <Input
          placeholder="Search name or domain"
          value={value("q")}
          onChange={(event) => update({ q: event.target.value })}
        />
      </label>
      <details
        open={filtersOpen}
        onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        className="group rounded-lg border p-3"
      >
        <summary className="cursor-pointer text-sm font-medium">
          Filters
          {filterKeys.filter(
            (key) =>
              !["limit", "offset", "sort", "dir"].includes(key) && value(key),
          ).length > 0 && " · Applied"}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {multiSelect("category", "Category", DIRECTORY_CATEGORIES)}
          {multiSelect("tier", "Tier", ["1", "2", "3", "4"])}
          {multiSelect("kind", "API type", DIRECTORY_KINDS)}
          {multiSelect("grade", "Grade", ["A", "B", "C", "X", "ungraded"])}
          <fieldset className="text-sm">
            <legend>DR range</legend>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                aria-label="Minimum DR"
                placeholder="Min"
                value={value("dr_min")}
                onChange={(event) => update({ dr_min: event.target.value })}
              />
              <Input
                type="number"
                min={0}
                max={100}
                aria-label="Maximum DR"
                placeholder="Max"
                value={value("dr_max")}
                onChange={(event) => update({ dr_max: event.target.value })}
              />
            </div>
          </fieldset>
          {select(
            "state",
            "State",
            states.map((state) => [state, state]),
          )}
          <label className="space-y-1 text-sm">
            <span>Trade</span>
            <Input
              placeholder="e.g. roofing"
              value={value("trade")}
              onChange={(event) => update({ trade: event.target.value })}
            />
          </label>
          {select("link", "Link status", [
            ["verified", "Verified"],
            ["unconfirmed", "Unconfirmed"],
          ])}
          {select("paid", "Paid", [
            ["true", "Paid"],
            ["false", "Free"],
            ["unknown", "Unknown"],
          ])}
          {select("active", "Status", [
            ["true", "Active"],
            ["false", "Inactive"],
          ])}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          DR bands:{" "}
          {["0–20", "21–40", "41–60", "61–80", "81–100", "unknown"]
            .map((band) => `${band}: ${facets.data?.dr?.[band] ?? 0}`)
            .join(" · ")}
        </p>
      </details>
      <Button variant="outline" size="sm" onClick={clear}>
        Clear filters
      </Button>
      <LoadError error={facets.error} retry={() => void facets.refetch()} />
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status">Loading directories…</p>}
      <div className="max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {heading("name", "Directory")}
              {heading("dr", "DR")}
              <th className="p-3 font-medium">Grade</th>
              <th className="p-3 font-medium">
                <button onClick={() => sort("tier")}>Tier ↕</button> /{" "}
                <button onClick={() => sort("category")}>Category ↕</button>
              </th>
              <th className="p-3 font-medium whitespace-nowrap">API type</th>
              {heading("state", "Coverage")}
              <th className="p-3 font-medium">Status</th>
              {adminActions && <th className="p-3 font-medium">Manage</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((directory) => (
              <tr key={directory.id}>
                <td className="p-3 min-w-48">
                  <p className="font-medium">{directory.name}</p>
                  <p className="text-muted-foreground">
                    {directory.domain ?? "Domain unconfirmed"}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-primary">
                      Details & source
                    </summary>
                    <div className="mt-2 space-y-1 max-w-md">
                      <p>{label(directory.kind)}</p>
                      <p>{directory.notes || "No research notes yet."}</p>
                      <p>
                        Street address:{" "}
                        {directory.requires_street_address === null
                          ? "Unknown"
                          : directory.requires_street_address
                            ? "Required"
                            : "Not required"}
                      </p>
                      <p>
                        Phone verification:{" "}
                        {directory.requires_phone_verification === null
                          ? "Unknown"
                          : directory.requires_phone_verification
                            ? "Required"
                            : "Not required"}
                      </p>
                      <p>
                        Postcard:{" "}
                        {directory.requires_postcard === null
                          ? "Unknown"
                          : directory.requires_postcard
                            ? "Required"
                            : "Not required"}
                      </p>
                      <SafeLink url={directory.source}>
                        {directory.source}
                      </SafeLink>
                    </div>
                  </details>
                </td>
                <td className="p-3 font-medium tabular-nums">
                  {directory.dr ?? "—"}
                </td>
                <td className="p-3">
                  {directory.grade ? (
                    <StatusPill
                      tone={directory.grade === "A" ? "success" : "neutral"}
                    >
                      {directory.grade}
                    </StatusPill>
                  ) : (
                    <span
                      title={["maps_nav", "social", "ai"].includes(directory.category)
                        ? "Not graded: maps, social and AI platforms are not backlink sources"
                        : "Not graded yet"}
                    >
                      —
                    </span>
                  )}
                </td>
                <td className="p-3">
                  Tier {directory.tier}
                  <br />
                  {label(directory.category)}
                </td>
                <td className="p-3">{label(directory.kind)}</td>
                <td className="p-3 min-w-48">
                  Trades: {directory.trades?.join(", ") || "Unresearched"}
                  <br />
                  States: {directory.states?.join(", ") || "Unresearched"}
                </td>
                <td className="p-3">
                  <StatusPill tone={directory.active ? "success" : "neutral"}>
                    {directory.active ? "Active" : "Inactive"}
                  </StatusPill>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Link {directory.link_status ?? "unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {directory.paid === null
                      ? "Cost unknown"
                      : directory.paid
                        ? "Paid"
                        : "Free"}
                  </p>
                </td>
                {adminActions && (
                  <td className="p-3">{adminActions(directory)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {query.isSuccess && !rows.length && (
          <p className="p-8 text-center text-muted-foreground">
            No directories match these filters.{" "}
            <button className="text-primary underline" onClick={clear}>
              Clear filters
            </button>
          </p>
        )}
      </div>
      {query.isSuccess && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p aria-live="polite">
            Showing {rows.length ? (offset + 1).toLocaleString() : "0"}–
            {Math.min(offset + rows.length, total).toLocaleString()} of{" "}
            {total.toLocaleString()}
          </p>
          <label className="flex items-center gap-2">
            Per page
            <select
              aria-label="Directories per page"
              className={selectClass + " w-24"}
              value={limit}
              onChange={(event) => update({ limit: event.target.value })}
            >
              {pageSizes.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
          <nav
            aria-label="Directory pages"
            className="flex flex-wrap items-center gap-1"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!offset}
              onClick={() =>
                update({ offset: String(Math.max(0, offset - limit)) }, false)
              }
            >
              Previous
            </Button>
            {pageNumbers.map((number, index) => (
              <span key={number} className="inline-flex items-center gap-1">
                {index > 0 && number > pageNumbers[index - 1] + 1 && (
                  <span>…</span>
                )}
                <Button
                  variant={number === page ? "default" : "outline"}
                  size="sm"
                  aria-current={number === page ? "page" : undefined}
                  onClick={() =>
                    update({ offset: String((number - 1) * limit) }, false)
                  }
                >
                  {number}
                </Button>
              </span>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => update({ offset: String(offset + limit) }, false)}
            >
              Next
            </Button>
          </nav>
        </div>
      )}
    </div>
  );
}
