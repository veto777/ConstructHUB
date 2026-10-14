import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Stat, StatGrid } from "@/components/app-ui";
import { useToast } from "@/hooks/use-toast";
import { StatusPill } from "@/components/crm-ui";
import {
  DIRECTORY_CATEGORIES,
  LISTING_LABELS,
  LISTING_STATUSES,
  TIER_LABELS,
  type Directory,
  type ListingRow,
  type ListingSummary,
} from "@shared/listings";

export const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm w-full";
export const label = (value: string) =>
  LISTING_LABELS[value] ?? value.replaceAll("_", " ");
export const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-US") : "Not checked";
export const getJson = async <T,>(url: string): Promise<T> =>
  (await apiRequest("GET", url)).json();
export function refreshListings() {
  return queryClient.invalidateQueries({
    predicate: (query) => String(query.queryKey[0]).startsWith("/api/listings"),
  });
}
export function LoadError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <Notice tone="danger">
      <span role="alert">{apiErrorMessage(error)}</span>
      {retry && (
        <Button variant="outline" size="sm" className="ml-3" onClick={retry}>
          Try again
        </Button>
      )}
    </Notice>
  );
}
export function SafeLink({
  url,
  children,
}: {
  url: string | null;
  children?: React.ReactNode;
}) {
  if (!url || !/^https?:\/\//i.test(url))
    return <span>{children ?? "No URL"}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline break-all"
    >
      {children ?? url}
    </a>
  );
}
export function Summary({ locationId }: { locationId: number }) {
  const url = `/api/listings/summary?location_id=${locationId}`;
  const query = useQuery<ListingSummary>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  if (query.error)
    return <LoadError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <p role="status">Loading directory counts…</p>;
  return (
    <div className="space-y-4">
      <StatGrid>
        {(
          [
            ["total", "Directory profiles"],
            ["live", "Live"],
            ["mismatch", "Details differ"],
            ["billable", "Verified"],
          ] as const
        ).map(([key, title]) => (
          <Stat
            key={key}
            label={title}
            value={query.data[key].toLocaleString()}
            hint={
              key === "billable"
                ? "Verified live with matching details"
                : undefined
            }
          />
        ))}
      </StatGrid>
      <p className="text-sm text-muted-foreground">
        Verified counts only listings our checker found live with matching
        name, address, and phone.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(TIER_LABELS).map(([tier, title]) => {
          const counts = query.data.by_tier[tier];
          return (
            <div key={tier} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Tier {tier} · {title}
              </p>
              <p className="mt-1 text-muted-foreground">
                {counts?.total ?? 0} total · {counts?.live ?? 0} live ·{" "}
                {counts?.mismatch ?? 0} differ · {counts?.billable ?? 0}{" "}
                verified
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function Pager({
  offset,
  count,
  setOffset,
}: {
  offset: number;
  count: number;
  setOffset: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm">
      <span>Page {offset / 50 + 1}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={count < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function ListingsTable({
  locationId,
  admin = false,
}: {
  locationId?: number;
  admin?: boolean;
}) {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const { toast } = useToast();
  const params = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (locationId) params.set("location_id", String(locationId));
  if (status) params.set("status", status);
  const url = `/api/listings?${params}`;
  const query = useQuery<ListingRow[]>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  const recheck = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/listings/${id}/recheck`),
    onSuccess: async () => {
      await refreshListings();
      toast({ title: "Check complete" });
    },
    onError: (error) =>
      toast({
        title: "Could not check directory profile",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  return (
    <div className="space-y-3">
      <label className="block max-w-xs text-sm">
        Status
        <select
          className={selectClass}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          {LISTING_STATUSES.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </label>
      <LoadError error={query.error} retry={() => void query.refetch()} />
      {query.isLoading && <p role="status">Loading directory profiles…</p>}
      {query.data && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    "Directory",
                    ...(admin ? ["Account / location"] : []),
                    "Status",
                    "Last checked",
                    "Name, address, phone",
                    "Action",
                  ].map((title) => (
                    <th key={title} className="p-3 font-medium">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {query.data.map((row) => (
                  <tr key={row.id}>
                    <td className="p-3 min-w-40">
                      <p className="font-medium">{row.directory_name}</p>
                      <SafeLink url={row.listing_url}>Open listing</SafeLink>
                    </td>
                    {admin && (
                      <td className="p-3">
                        Account {row.user_id}
                        <br />
                        Location {row.location_id}
                      </td>
                    )}
                    <td className="p-3">
                      <StatusPill
                        tone={
                          row.status === "live"
                            ? "success"
                            : row.status === "mismatch"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {label(row.status)}
                      </StatusPill>
                      {row.billable && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {admin ? "Billable" : "Verified"}
                        </p>
                      )}
                    </td>
                    <td className="p-3 min-w-36">
                      {dateLabel(row.last_checked_at)}
                    </td>
                    <td className="p-3 min-w-64">
                      {row.nap_result ? (
                        <details>
                          <summary className="cursor-pointer">
                            {row.nap_result.matches
                              ? "Details match"
                              : "Review differences"}
                          </summary>
                          <dl className="mt-2 space-y-2">
                            {Object.entries(row.nap_result.fields).map(
                              ([field, result]) => (
                                <div key={field}>
                                  <dt className="font-medium capitalize">
                                    {label(field)} ·{" "}
                                    {result.result === "match"
                                      ? "Matches"
                                      : result.result === "missing"
                                        ? "Missing"
                                        : "Differs"}
                                    {!result.required ? " (optional)" : ""}
                                  </dt>
                                  <dd>
                                    Expected: {result.expected ?? "Unknown"}
                                  </dd>
                                  <dd>
                                    Observed: {result.observed ?? "Not found"}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        </details>
                      ) : (
                        <span className="text-muted-foreground">
                          No confirmed comparison yet
                        </span>
                      )}
                      {row.evidence?.reason && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {row.evidence.reason}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={recheck.isPending || !row.listing_url}
                        onClick={() => recheck.mutate(row.id)}
                      >
                        {recheck.isPending && recheck.variables === row.id
                          ? "Checking…"
                          : "Re-check"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data.length && (
              <p className="p-8 text-center text-muted-foreground">
                No listings
                {status
                  ? " match this status"
                  : " yet. Add an existing directory profile URL to start checking your details"}
                .
              </p>
            )}
          </div>
          <Pager
            offset={offset}
            count={query.data.length}
            setOffset={setOffset}
          />
        </>
      )}
    </div>
  );
}
export function Catalogue({
  directories,
  adminActions,
}: {
  directories: Directory[];
  adminActions?: (directory: Directory) => React.ReactNode;
}) {
  const [tier, setTier] = useState("");
  const [category, setCategory] = useState("");
  const [trade, setTrade] = useState("");
  const [state, setState] = useState("");
  const rows = directories.filter(
    (directory) =>
      (!tier || String(directory.tier) === tier) &&
      (!category || directory.category === category) &&
      (!trade ||
        directory.trades?.some((value) =>
          value.toLowerCase().includes(trade.toLowerCase()),
        )) &&
      (!state || directory.states?.includes(state.toUpperCase())),
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Catalogue entries are research targets, not a promise of distribution.
        Unknown coverage and requirements need research.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          Tier
          <select
            className={selectClass}
            value={tier}
            onChange={(event) => setTier(event.target.value)}
          >
            <option value="">All tiers</option>
            {Object.entries(TIER_LABELS).map(([value, title]) => (
              <option key={value} value={value}>
                Tier {value} · {title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Category
          <select
            className={selectClass}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {DIRECTORY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Trade
          <Input
            value={trade}
            onChange={(event) => setTrade(event.target.value)}
            placeholder="Filter researched trades"
          />
        </label>
        <label className="text-sm">
          State
          <Input
            value={state}
            maxLength={2}
            onChange={(event) => setState(event.target.value.toUpperCase())}
            placeholder="Two-letter state"
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        {rows.length} of {directories.length} directories
        {(trade || state) &&
          " · Unresearched coverage is excluded from these filters."}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {[
                "Directory",
                "Tier / category",
                "Coverage",
                "Status",
                ...(adminActions ? ["Manage"] : []),
              ].map((title) => (
                <th key={title} className="p-3 font-medium">
                  {title}
                </th>
              ))}
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
                <td className="p-3">
                  Tier {directory.tier}
                  <br />
                  {label(directory.category)}
                </td>
                <td className="p-3">
                  Trades: {directory.trades?.join(", ") || "Unresearched"}
                  <br />
                  States: {directory.states?.join(", ") || "Unresearched"}
                </td>
                <td className="p-3">
                  <StatusPill tone={directory.active ? "success" : "neutral"}>
                    {directory.active ? "Active" : "Inactive"}
                  </StatusPill>
                </td>
                {adminActions && (
                  <td className="p-3">{adminActions(directory)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-8 text-center text-muted-foreground">
            No directories match these filters.
          </p>
        )}
      </div>
    </div>
  );
}
