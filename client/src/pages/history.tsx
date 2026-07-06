import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Search,
  MapPin,
  User,
  Building2,
  Trash2,
  X,
} from "lucide-react";
import type { SearchQuery } from "@shared/schema";

const typeIcons: Record<string, typeof Search> = {
  address: MapPin,
  name: User,
  company: Building2,
  license: FileText,
  permit: FileText,
};

export default function HistoryPage() {
  const { toast } = useToast();

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
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/search-queries");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/search-queries"] });
      toast({ title: "History cleared" });
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
              Review all your past permit searches, results, and saved data. Quickly re-run previous searches or export results.
            </p>
          </div>
          {queries && queries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => deleteAllMutation.mutate()}
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
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{query.searchValue}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                      <span className="capitalize">{query.searchType}</span>
                      <span className="text-border">·</span>
                      {new Date(query.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteOneMutation.mutate(query.id)}
                    disabled={deleteOneMutation.isPending}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
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
    </div>
  );
}
