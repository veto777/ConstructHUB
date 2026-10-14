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
  DIRECTORY_LABELS,
  DIRECTORY_STATUSES,
  TIER_LABELS,
  type Directory,
  type DirectoryProfileRow,
  type DirectorySummary,
} from "@shared/directories";

export const selectClass =
  "h-10 rounded-md border border-input bg-background px-3 text-sm w-full";
export const label = (value: string) =>
  DIRECTORY_LABELS[value] ?? value.replaceAll("_", " ");
export const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-US") : "Not checked";
export const getJson = async <T,>(url: string): Promise<T> =>
  (await apiRequest("GET", url)).json();
export function refreshDirectories() {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      String(query.queryKey[0]).startsWith("/api/directories"),
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
  const url = `/api/directories/summary?location_id=${locationId}`;
  const query = useQuery<DirectorySummary>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  if (query.error)
    return <LoadError error={query.error} retry={() => void query.refetch()} />;
  if (!query.data)
    return <p role="status">Loading directory profile counts…</p>;
  return (
    <div className="space-y-4">
      <StatGrid>
        {(
          [
            ["total", "Total directory profiles"],
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
        Verified counts only directory profiles our checker found live with
        matching name, address, and phone.
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
export function DirectoryProfilesTable({
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
  const url = `/api/directories?${params}`;
  const query = useQuery<DirectoryProfileRow[]>({
    queryKey: [url],
    queryFn: () => getJson(url),
  });
  const recheck = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/directories/${id}/recheck`),
    onSuccess: async () => {
      await refreshDirectories();
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
          {DIRECTORY_STATUSES.map((value) => (
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
                      <SafeLink url={row.listing_url}>
                        Open directory profile
                      </SafeLink>
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
                No directory profiles
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
export { Catalogue } from "./catalogue";
