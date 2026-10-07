import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { governmentLinksAvailable, canScrapeGovernmentPortal } from "@shared/government-links";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { AppPage, EmptyState } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Plus,
  Trash2,
  Loader2,
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

  if (error) {
    return (
      <AppPage width="narrow">
        <div className="rounded-xl border bg-card p-5" role="alert">
          <h1 className="g-header__title">Scrape schedules</h1>
          <p className="mt-2 g-text-2">
            {String(error).includes("403") ? "Administrator access is required to manage these shared schedules." : "Schedules could not be loaded. Please sign in or try again later."}
          </p>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage width="narrow" testId="page-schedules">
      {/* Google's list format (owner, 2026-10-07): a quiet header, hairline rows, pill actions. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="Scrape schedules"
        description="Automatic permit refreshes for live-searchable portals. Admins only."
        flush
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <GooglePill icon={Plus} variant="solid" label="Add schedule" testId="button-add-schedule" />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create scrape schedule</DialogTitle>
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
        }
      />

      {isLoading ? (
        <div className="space-y-2" data-testid="schedules-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse g-divider" />
          ))}
        </div>
      ) : schedules && schedules.length > 0 ? (
        <GoogleList testId="list-schedules">
          {schedules.map((schedule) => (
            <GoogleListRow
              key={schedule.id}
              size="md"
              testId={`card-schedule-${schedule.id}`}
              title={getDatabaseName(schedule.databaseId)}
              meta={[
                schedule.isActive ? <span key="state" className="g-open">Active</span> : <span key="state">Paused</span>,
                <span key="freq" className="capitalize">{schedule.frequency}</span>,
                <span key="query"><span className="capitalize">{schedule.searchType}</span>: "{schedule.searchValue}"</span>,
                schedule.lastRunAt ? `Last run ${new Date(schedule.lastRunAt).toLocaleDateString()}` : null,
              ]}
              trailing={<>
                <Switch
                  checked={schedule.isActive}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({ id: schedule.id, isActive: checked })
                  }
                  aria-label={schedule.isActive ? "Pause schedule" : "Resume schedule"}
                  data-testid={`switch-schedule-${schedule.id}`}
                />
                <GooglePill
                  icon={Trash2}
                  variant="quiet"
                  size="sm"
                  className="px-2"
                  label={<span className="sr-only">Delete schedule</span>}
                  onClick={() => setPendingDelete(schedule)}
                  disabled={deleteMutation.isPending}
                  ariaLabel="Delete schedule"
                  title="Delete schedule"
                  testId={`button-delete-schedule-${schedule.id}`}
                />
              </>}
            />
          ))}
        </GoogleList>
      ) : (
        <EmptyState
          icon={Clock}
          title="No schedules yet"
          description="Schedules run automatically on their frequency against portals that support live search."
          action={<GooglePill icon={Plus} label="Add schedule" onClick={() => setDialogOpen(true)} testId="button-empty-add-schedule" />}
        />
      )}

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
    </AppPage>
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
        Create schedule
      </Button>
    </form>
  );
}
