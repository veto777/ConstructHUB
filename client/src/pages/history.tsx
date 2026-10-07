import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AppPage, EmptyState } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Search,
  MapPin,
  User,
  Building2,
  Trash2,
  X,
  RotateCcw,
} from "lucide-react";
import type { SearchQuery } from "@shared/schema";

const typeIcons: Record<string, typeof Search> = {
  address: MapPin,
  name: User,
  company: Building2,
  license: FileText,
  permit: FileText,
};

/** Opens the Search page with this query's type, value and county filled in (it does not run it). */
function searchAgainHref(query: SearchQuery): string {
  const params = new URLSearchParams({ type: query.searchType, q: query.searchValue });
  if (query.countyId) params.set("loc", `county-${query.countyId}`);
  return `/search?${params.toString()}`;
}

export default function HistoryPage() {
  const { toast } = useToast();
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const { data: queries, isLoading } = useQuery<SearchQuery[]>({
    queryKey: ["/api/search-queries"],
  });

  const deleteOneMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/search-queries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
    },
    onError: (err) => {
      toast({ title: "Could not delete search", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/search-queries");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
      toast({ title: "History cleared" });
    },
    onError: (err) => {
      toast({ title: "Could not clear history", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const count = queries?.length ?? 0;

  return (
    <AppPage width="narrow" testId="page-history">
      {/* Google's list format (owner, 2026-10-07): a quiet header, hairline rows, pill actions. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="Search history"
        count={count > 0 ? count : null}
        description="Rerun a recent permit search with one tap."
        flush
        actions={count > 0 ? (
          <GooglePill
            icon={Trash2}
            variant="quiet"
            label="Clear all"
            onClick={() => setConfirmClearAll(true)}
            disabled={deleteAllMutation.isPending}
            testId="button-clear-all-history"
          />
        ) : undefined}
      />

      {isLoading ? (
        <div className="space-y-2" data-testid="history-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 animate-pulse g-divider" />
          ))}
        </div>
      ) : count > 0 ? (
        <GoogleList testId="list-history">
          {queries!.map((query) => {
            const Icon = typeIcons[query.searchType] ?? Search;
            return (
              <GoogleListRow
                key={query.id}
                size="md"
                testId={`card-query-${query.id}`}
                leading={<Icon aria-hidden="true" />}
                title={query.searchValue}
                href={searchAgainHref(query)}
                titleTestId={`link-search-again-${query.id}`}
                meta={[
                  <span key="type" className="capitalize">{query.searchType.replace(/_/g, " ")}</span>,
                  new Date(query.createdAt).toLocaleString(),
                ]}
                trailing={(
                  <GooglePill
                    icon={X}
                    variant="quiet"
                    size="sm"
                    label={<span className="sr-only">Delete</span>}
                    className="px-2"
                    onClick={() => deleteOneMutation.mutate(query.id)}
                    disabled={deleteOneMutation.isPending}
                    ariaLabel={`Delete search "${query.searchValue}"`}
                    title="Delete search"
                    testId={`button-delete-query-${query.id}`}
                  />
                )}
                actions={(
                  <GooglePill icon={RotateCcw} label="Search again" href={searchAgainHref(query)} title="Open this search on the Search page" testId={`button-search-again-${query.id}`} />
                )}
              />
            );
          })}
        </GoogleList>
      ) : (
        <EmptyState
          icon={FileText}
          title="No searches yet"
          description="Run a permit search and it shows up here, ready to rerun."
          action={<GooglePill icon={Search} variant="solid" label="Search permits" href="/search" testId="link-history-search" />}
        />
      )}

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* The list shows the latest 50; "Clear all" removes every one, so only quote a count we know. */}
            <AlertDialogTitle>
              {count < 50 ? `Delete all ${count} ${count === 1 ? "search" : "searches"}?` : "Delete your entire search history?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes your whole search history, including the results saved with each search. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-history">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAllMutation.mutate()}
              data-testid="button-confirm-clear-history"
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppPage>
  );
}
