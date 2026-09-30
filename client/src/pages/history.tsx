import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const count = queries?.length ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div className="flex items-start justify-between gap-4 animate-in">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
              Search History
            </h1>
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
            <p className="text-sm text-muted-foreground max-w-lg">
              Your recent permit searches. Select one to open it on the Search page and run it again.
            </p>
          </div>
          {count > 0 && (
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
          )}
        </div>

        {queries && queries.length > 0 ? (
          <div className="space-y-1.5">
            {queries.map((query, index) => {
              const Icon = typeIcons[query.searchType] ?? Search;
              return (
                <Card
                  key={query.id}
                  className="p-3.5 flex items-center gap-3 hover-elevate transition-all duration-200 group"
                  style={{
                    boxShadow: 'var(--shadow-2xs)',
                    animation: `fadeSlideIn 0.3s ease-out ${index * 0.03}s both`,
                  }}
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
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in-delay-1">
            <FileText className="h-8 w-8 text-muted-foreground/20" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-muted-foreground">No search history</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Your searches will appear here after you run a search.
              </p>
            </div>
          </div>
        )}
      </div>

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
    </div>
  );
}
