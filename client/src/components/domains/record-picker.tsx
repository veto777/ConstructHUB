import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Search, Trash2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/app-ui";
import { GooglePill } from "@/components/google";
import type { DnsRecordLike } from "./dns-diff";

/**
 * The current DNS records of the one selected domain, read live from its registrar
 * (GET /api/domains/records). Update and Delete start from a specific record here, so the
 * provider record id is carried through preview and confirmation — an ambiguous typed
 * name/type/content match is a fallback, not the workflow. DOM-1.
 */
export function RecordPicker({
  domainId,
  onPick,
}: {
  domainId: number;
  onPick: (action: "update" | "delete", record: DnsRecordLike) => void;
}) {
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch, isFetching } = useQuery<any>({
    queryKey: [`/api/domains/records?domainId=${domainId}`],
    staleTime: 30_000,
    retry: false,
  });
  const records: DnsRecordLike[] = data?.records || [];
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? records.filter((r) =>
        [r.type, r.name, r.content]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)),
      )
    : records;
  return (
    <div className="mt-3 space-y-2" data-testid="record-picker">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 g-text-2"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search current records"
            placeholder="Search records"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <span className="text-xs g-text-2">
          {isFetching && !isLoading
            ? "Refreshing from the registrar…"
            : `${shown.length} of ${records.length} records`}
        </span>
      </div>
      {isLoading ? (
        <div className="space-y-2" data-testid="record-picker-loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <Notice
          tone="danger"
          testId="record-picker-error"
          action={
            <GooglePill size="sm" onClick={() => refetch()} label="Try again" />
          }
        >
          {apiErrorMessage(error, "Could not load the domain's records.")}
        </Notice>
      ) : records.length === 0 ? (
        <p className="text-sm g-text-2">
          No records found at the registrar for this domain.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm g-text-2">No records match “{search}”.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="g-table min-w-[480px]">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Name</th>
                <th scope="col">TTL</th>
                <th scope="col">Value</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id || `${r.type}:${r.name}:${r.content}`}>
                  <td data-label="Type">{r.type}</td>
                  <td data-label="Name" className="break-all">{r.name}</td>
                  <td data-label="TTL" className="num">{r.ttl ?? 600}</td>
                  <td data-label="Value" className="min-w-0 max-w-[280px] break-all">
                    {r.type === "MX" && r.priority
                      ? `${r.priority} ${r.content}`
                      : r.content}
                  </td>
                  <td data-label="Actions" className="whitespace-nowrap text-right">
                    <span className="inline-flex gap-1">
                      <GooglePill
                        variant="quiet"
                        size="sm"
                        icon={Pencil}
                        ariaLabel={`Update ${r.name} ${r.type} record`}
                        onClick={() => onPick("update", r)}
                        label="Update"
                      />
                      <GooglePill
                        variant="quiet"
                        size="sm"
                        icon={Trash2}
                        ariaLabel={`Delete ${r.name} ${r.type} record`}
                        onClick={() => onPick("delete", r)}
                        label="Delete"
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
