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
import { AppPage, Notice } from "@/components/app-ui";
import { GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import type { ScrapeSchedule, PermitDatabase } from "@shared/schema";
import { SCHEDULE_MAX_EVERY_HOURS, SCHEDULE_TICK_MINUTES, customEveryHours, describeScheduleFrequency } from "@shared/scrape-schedules";

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
      <AppPage width="narrow" className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11">
        <GoogleSectionHeader as="h1" title="Scrape schedules" description="Automatic permit refreshes for live-searchable portals." flush />
        <Notice tone={String(error).includes("403") ? "info" : "danger"} testId="notice-schedules-error">
          {String(error).includes("403") ? "Administrator access is required to manage these shared schedules." : "Schedules could not be loaded. Please sign in or try again later."}
        </Notice>
      </AppPage>
    );
  }

  return (
    <AppPage width="narrow" className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-schedules">
      {/* Google's list format (owner, 2026-10-07): a quiet header, hairline rows, pill actions. */}
      <GoogleSectionHeader
        as="h1"
        titleTestId="text-page-title"
        title="Scrape schedules"
        description="Repeating permit searches that keep the shared permit cache fresh on portals that support live search; administrators only."
        flush
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            {/* GooglePill takes no ref, so it opens the (controlled) dialog itself rather than through DialogTrigger asChild. */}
            <GooglePill icon={Plus} variant="solid" label="Add schedule" testId="button-add-schedule" onClick={() => setDialogOpen(true)} />
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

      {schedules && (
        <GoogleStatGrid cols={3}>
          <GoogleStat label="Schedules" value={schedules.length.toLocaleString()} testId="stat-schedules-total" />
          <GoogleStat label="Active" value={schedules.filter((s) => s.isActive).length.toLocaleString()} hint="Run when due, every 15 minutes" testId="stat-schedules-active" />
          <GoogleStat label="Portals a schedule can target" value={databasesLoading ? "…" : databases.length.toLocaleString()} hint="One per portal address: a checked link plus a search adapter (places that share a portal count once)" testId="stat-schedules-portals" />
        </GoogleStatGrid>
      )}

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
                <span key="freq">{describeScheduleFrequency(schedule)}</span>,
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
                  className="relative max-sm:after:absolute max-sm:after:-inset-2.5 max-sm:after:content-['']"
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
        /* No schedule yet: what a row will show and where its data comes from. No sample schedules (CLAUDE.md). */
        <div className="g-callout" data-testid="empty-schedules">
          <h2 className="inline-flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden="true" /> No schedules yet</h2>
          <p>Each schedule will be listed here with its portal, whether it is active, how often it runs (daily, weekly, monthly, or your own number of hours or days), what it searches for and when it last ran, with a switch to pause it and a bin to delete it.</p>
          <p className="mt-2">Every 15 minutes the server runs the schedules that are due and saves what each portal returns into the shared permit cache, the same stored matches Search permits shows first. A schedule can only target one of the {databasesLoading ? "" : `${databases.length.toLocaleString()} `}portal addresses the live search can query (a checked official link plus a search adapter for its platform; places that share one portal count once).</p>
          <div className="mt-3"><GooglePill icon={Plus} variant="solid" label="Add schedule" onClick={() => setDialogOpen(true)} testId="button-empty-add-schedule" /></div>
        </div>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${getDatabaseName(pendingDelete.databaseId)} — ${pendingDelete.searchType}: "${pendingDelete.searchValue}" (${describeScheduleFrequency(pendingDelete).toLowerCase()}). It stops refreshing and can't be restored.`
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
  // "Custom": run every N hours or days (1 hour to 30 days); the server checks the same limits.
  const [everyAmount, setEveryAmount] = useState("6");
  const [everyUnit, setEveryUnit] = useState<"hours" | "days">("hours");
  const everyHours = customEveryHours(everyAmount, everyUnit);
  const customInvalid = frequency === "custom" && everyHours === null;
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
    if (!databaseId || !searchValue.trim() || customInvalid) return;
    createMutation.mutate({
      databaseId: parseInt(databaseId),
      searchType,
      searchValue: searchValue.trim(),
      frequency,
      everyHours: frequency === "custom" ? everyHours : null,
      isActive: true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-1">
      <div className="space-y-1.5">
        <Label htmlFor="select-schedule-database" className="text-xs font-medium text-muted-foreground">Portal</Label>
        <Select value={databaseId} onValueChange={setDatabaseId} disabled={loading || databases.length === 0}>
          <SelectTrigger id="select-schedule-database" data-testid="select-schedule-database">
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
          <Label htmlFor="select-schedule-search-type" className="text-xs font-medium text-muted-foreground">Search type</Label>
          <Select value={searchType} onValueChange={setSearchType}>
            <SelectTrigger id="select-schedule-search-type" data-testid="select-schedule-search-type">
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
          <Label htmlFor="select-schedule-frequency" className="text-xs font-medium text-muted-foreground">Frequency</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger id="select-schedule-frequency" data-testid="select-schedule-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="custom">Custom — every N hours or days…</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {frequency === "custom" && (
        <div className="space-y-1.5" data-testid="section-schedule-custom">
          <Label className="text-xs font-medium text-muted-foreground" htmlFor="schedule-every">Run every</Label>
          <div className="flex gap-2">
            <Input
              id="schedule-every"
              type="number"
              inputMode="numeric"
              min={1}
              max={everyUnit === "days" ? SCHEDULE_MAX_EVERY_HOURS / 24 : SCHEDULE_MAX_EVERY_HOURS}
              value={everyAmount}
              onChange={(e) => setEveryAmount(e.target.value)}
              className="w-28"
              aria-invalid={customInvalid}
              data-testid="input-schedule-every"
            />
            <Select value={everyUnit} onValueChange={(v) => setEveryUnit(v as "hours" | "days")}>
              <SelectTrigger className="w-32" aria-label="Unit: hours or days" data-testid="select-schedule-every-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">hours</SelectItem>
                <SelectItem value="days">days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground" data-testid="text-schedule-custom-help">
            {everyHours !== null
              ? `Runs ${describeScheduleFrequency({ frequency: "custom", everyHours }).toLowerCase()}. The server looks for due schedules every ${SCHEDULE_TICK_MINUTES} minutes, so a run can start up to ${SCHEDULE_TICK_MINUTES} minutes after it is due.`
              : `Enter a whole number from 1 to ${SCHEDULE_MAX_EVERY_HOURS} hours (1 to ${SCHEDULE_MAX_EVERY_HOURS / 24} days).`}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="input-schedule-search-value" className="text-xs font-medium text-muted-foreground">Search value</Label>
        <Input
          id="input-schedule-search-value"
          placeholder="Enter the value to search for..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          data-testid="input-schedule-search-value"
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={createMutation.isPending || !databaseId || !searchValue.trim() || customInvalid}
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
