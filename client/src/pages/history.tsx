import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
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
import { AppPage, PageHeader, EmptyState } from "@/components/app-ui";
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
      <PageHeader
        title={<span data-testid="text-page-title">Search history</span>}
        description="Rerun a recent permit search with one tap."
        actions={count > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmClearAll(true)}
            disabled={deleteAllMutation.isPending}
            data-testid="button-clear-all-history"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Clear all
          </Button>
        ) : undefined}
      />

      {isLoading ? (
        <div className="space-y-2" data-testid="history-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      ) : count > 0 ? (
        <div className="rounded-xl border bg-card divide-y" data-testid="list-history">
          {queries!.map((query) => {
            const Icon = typeIcons[query.searchType] ?? Search;
            return (
              <div
                key={query.id}
                className="flex items-center gap-3 px-4 py-3 group"
                data-testid={`card-query-${query.id}`}
              >
                <Link
                  href={searchAgainHref(query)}
                  className="flex flex-1 min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Open this search on the Search page"
                  data-testid={`link-search-again-${query.id}`}
                >
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{query.searchValue}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span className="capitalize">{query.searchType.replace(/_/g, " ")}</span>
                      <span className="text-border">·</span>
                      {new Date(query.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground flex-shrink-0">
                    <RotateCcw className="h-3 w-3" />
                    Search again
                  </span>
                </Link>
                {/* Always visible on touch screens (no hover); revealed on hover/focus with a mouse. */}
                <button
                  type="button"
                  onClick={() => deleteOneMutation.mutate(query.id)}
                  disabled={deleteOneMutation.isPending}
                  aria-label={`Delete search "${query.searchValue}"`}
                  title="Delete search"
                  className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                  data-testid={`button-delete-query-${query.id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={FileText}
          title="No searches yet"
          description="Run a permit search and it shows up here, ready to rerun."
          action={
            <Button asChild>
              <Link href="/search" data-testid="link-history-search">Search permits</Link>
            </Button>
          }
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
