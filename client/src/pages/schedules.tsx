import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Clock,
  Plus,
  Trash2,
  Loader2,
  Calendar,
} from "lucide-react";
import type { ScrapeSchedule, PermitDatabase } from "@shared/schema";

/** A schedule can only refresh a portal the live scraper supports and whose link is usable. */
const isLiveSearchable = (db: PermitDatabase) => governmentLinksAvailable(db) && canScrapeGovernmentPortal(db);

export default function SchedulesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScrapeSchedule | null>(null);

  const { data: schedules, isLoading, error } = useQuery<ScrapeSchedule[]>({
    queryKey: ["/api/scrape-schedules"],
  });

  // ?searchable=true returns only the portals a schedule can run against (verified live link
  // plus a live-search adapter); the filter below re-checks whichever list comes back.
  const { data: databaseRows, isLoading: databasesLoading } = useQuery<PermitDatabase[]>({
    queryKey: ["/api/databases?searchable=true"],
    enabled: !!schedules,
  });

  // One option per scrape target: rows for a place that spans counties share a portal,
  // and a schedule on any of them would scrape the same URL.
  const databases = useMemo(() => {
    const seen = new Set<string>();
    return (databaseRows ?? []).filter(isLiveSearchable)
      .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.name.localeCompare(b.name) || a.id - b.id)
      .filter((db) => {
        const target = `${db.platform}|${db.searchUrl || db.portalUrl}`;
        if (seen.has(target)) return false;
        seen.add(target);
        return true;
      });
  }, [databaseRows]);
  const databaseById = useMemo(() => new Map((databaseRows ?? []).map((d) => [d.id, d])), [databaseRows]);

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/scrape-schedules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrape-schedules"] });
    },
    onError: (err, vars) => {
      toast({ title: vars.isActive ? "Could not resume schedule" : "Could not pause schedule", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/scrape-schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrape-schedules"] });
      toast({ title: "Schedule deleted" });
    },
    onError: (err) => {
      toast({ title: "Could not delete schedule", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const getDatabaseName = (dbId: number) => {
    const db = databaseById.get(dbId);
    if (db) return databaseLabel(db);
    return databaseRows ? `Database #${dbId} (not a live-searchable portal)` : `Database #${dbId}`;
  };

  if (error) return <div className="p-6"><Card className="p-6" role="alert">
    <h1 className="text-xl font-semibold">System permit-refresh schedules</h1>
    <p className="mt-2 text-muted-foreground">{String(error).includes("403") ? "Administrator access is required to manage these shared schedules." : "Schedules could not be loaded. Please sign in or try again later."}</p>
  </Card></div>;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-md" />
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
              Scrape Schedules
            </h1>
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-[#4A6CF7] to-[#F97316]" />
            <p className="text-sm text-muted-foreground max-w-lg">
              Manage system-wide permit-refresh schedule settings. Administrator access is required.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-schedule">
                <Plus className="h-4 w-4 mr-2" />
                Add Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Scrape Schedule</DialogTitle>
                <DialogDescription>
                  Choose a live-searchable permit portal and what to search it for.
                </DialogDescription>
              </DialogHeader>
              <AddScheduleForm
                databases={databases}
                loading={databasesLoading}
                onSuccess={() => {
                  setDialogOpen(false);
                  toast({ title: "Schedule created" });
                }}
              />
            </DialogContent>
          </Dialog>
        </div>

        {schedules && schedules.length > 0 ? (
          <div className="space-y-2">
            {schedules.map((schedule, index) => (
              <Card
                key={schedule.id}
                className="p-4 hover-elevate transition-all duration-200"
                style={{
                  boxShadow: 'var(--shadow-2xs)',
                  animation: `fadeSlideIn 0.3s ease-out ${index * 0.04}s both`,
                }}
                data-testid={`card-schedule-${schedule.id}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{getDatabaseName(schedule.databaseId)}</span>
                      <span className="text-xs text-muted-foreground capitalize">{schedule.frequency}</span>
                      {schedule.isActive ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-700 dark:text-green-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 dark:bg-green-400"></span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"></span>
                          Paused
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="capitalize">{schedule.searchType}</span>: "{schedule.searchValue}"
                      {schedule.lastRunAt && (
                        <>
                          <span className="mx-1.5 text-border">·</span>
                          Last run {new Date(schedule.lastRunAt).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Switch
                      checked={schedule.isActive}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: schedule.id, isActive: checked })
                      }
                      data-testid={`switch-schedule-${schedule.id}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPendingDelete(schedule)}
                      disabled={deleteMutation.isPending}
                      aria-label="Delete schedule"
                      title="Delete schedule"
                      data-testid={`button-delete-schedule-${schedule.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in-delay-1">
            <Clock className="h-8 w-8 text-muted-foreground/20" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-muted-foreground">No schedules yet</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Schedules run automatically on their frequency against portals that support live search.
              </p>
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${getDatabaseName(pendingDelete.databaseId)} — ${pendingDelete.searchType}: "${pendingDelete.searchValue}" (${pendingDelete.frequency}). It stops refreshing and can't be restored.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-schedule">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); }}
              data-testid="button-confirm-delete-schedule"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function databaseLabel(db: PermitDatabase) {
  return db.name === db.jurisdiction ? db.name : `${db.name} — ${db.jurisdiction}`;
}

function AddScheduleForm({
  databases,
  loading,
  onSuccess,
}: {
  databases: PermitDatabase[];
  loading: boolean;
  onSuccess: () => void;
}) {
  const [databaseId, setDatabaseId] = useState("");
  const [searchType, setSearchType] = useState("address");
  const [searchValue, setSearchValue] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/scrape-schedules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrape-schedules"] });
      onSuccess();
    },
    onError: (err) => {
      toast({ title: "Could not create schedule", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!databaseId || !searchValue.trim()) return;
    createMutation.mutate({
      databaseId: parseInt(databaseId),
      searchType,
      searchValue: searchValue.trim(),
      frequency,
      isActive: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-1">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Portal</Label>
        <Select value={databaseId} onValueChange={setDatabaseId} disabled={loading || databases.length === 0}>
          <SelectTrigger data-testid="select-schedule-database">
            <SelectValue placeholder={loading ? "Loading portals…" : databases.length ? `Select one of ${databases.length} live-searchable portals` : "No live-searchable portals available"} />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.id} value={db.id.toString()}>
                {databaseLabel(db)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Only portals our scraper can search automatically are listed.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Search type</Label>
          <Select value={searchType} onValueChange={setSearchType}>
            <SelectTrigger data-testid="select-schedule-search-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="address">Address</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="company">Company</SelectItem>
              <SelectItem value="license">License #</SelectItem>
              <SelectItem value="permit">Permit #</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Frequency</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger data-testid="select-schedule-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Search value</Label>
        <Input
          placeholder="Enter the value to search for..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          data-testid="input-schedule-search-value"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={createMutation.isPending || !databaseId || !searchValue.trim()}
        data-testid="button-create-schedule"
      >
        {createMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Plus className="h-4 w-4 mr-2" />
        )}
        Create Schedule
      </Button>
    </form>
  );
}
