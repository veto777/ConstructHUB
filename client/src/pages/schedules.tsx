import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Plus,
  Trash2,
  Loader2,
  Calendar,
} from "lucide-react";
import type { ScrapeSchedule, PermitDatabase } from "@shared/schema";

export default function SchedulesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: schedules, isLoading } = useQuery<ScrapeSchedule[]>({
    queryKey: ["/api/scrape-schedules"],
  });

  const { data: databases } = useQuery<PermitDatabase[]>({
    queryKey: ["/api/databases"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/scrape-schedules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrape-schedules"] });
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
  });

  const getDatabaseName = (dbId: number) =>
    databases?.find((d) => d.id === dbId)?.name ?? `Database #${dbId}`;

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
              Set up automated daily searches across any permit database. Get fresh permit data delivered without lifting a finger — never miss a new project in your area.
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
              </DialogHeader>
              <AddScheduleForm
                databases={databases ?? []}
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
                      onClick={() => deleteMutation.mutate(schedule.id)}
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
                Create automated scrape schedules to monitor permit databases daily.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddScheduleForm({
  databases,
  onSuccess,
}: {
  databases: PermitDatabase[];
  onSuccess: () => void;
}) {
  const [databaseId, setDatabaseId] = useState("");
  const [searchType, setSearchType] = useState("address");
  const [searchValue, setSearchValue] = useState("");
  const [frequency, setFrequency] = useState("daily");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/scrape-schedules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scrape-schedules"] });
      onSuccess();
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
        <Label className="text-xs font-medium text-muted-foreground">Database</Label>
        <Select value={databaseId} onValueChange={setDatabaseId}>
          <SelectTrigger data-testid="select-schedule-database">
            <SelectValue placeholder="Select a database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.id} value={db.id.toString()}>
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
