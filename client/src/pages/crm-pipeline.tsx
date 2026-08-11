import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  Loader2, KanbanSquare, ArrowRight, ChevronDown, ChevronUp, Plus, Pencil,
} from "lucide-react";
import { CrmPage, CrmPageHeader, EmptyState, ErrorCard } from "@/components/crm-ui";
import { Button } from "@/components/ui/button";

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Loose "$12,500" / "12500" → cents; blank → null. */
const dollarsToCents = (s: string): number | null => {
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};

/** One accent per swimlane, falling back by position for custom groups. */
const GROUP_COLORS = [
  { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
];
const GROUP_BY_NAME: Record<string, number> = { prospect: 0, sales: 1, production: 2, billing: 3 };
const groupColor = (group: string, idx: number) =>
  GROUP_COLORS[GROUP_BY_NAME[group.toLowerCase()] ?? idx % GROUP_COLORS.length];

// ── New lead ────────────────────────────────────────────────────────────────

function NewLeadDialog({
  open, onOpenChange, customers, firstStage, canSeePrices,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: any[];
  firstStage: string;
  canSeePrices: boolean;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [value, setValue] = useState("");

  const reset = () => { setName(""); setMode("new"); setCustomerId(""); setNewCustomerName(""); setValue(""); };

  const create = useMutation({
    mutationFn: async () => {
      let custId = customerId;
      if (mode === "new") {
        const c = await (await apiRequest("POST", "/api/crm/customers", {
          displayName: newCustomerName.trim(),
        })).json();
        custId = c.id;
      }
      const body: any = { customerId: custId, name: name.trim(), status: firstStage };
      const cents = dollarsToCents(value);
      if (cents !== null) body.contractValueCents = cents;
      return (await apiRequest("POST", "/api/crm/projects", body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers"] });
      toast({ title: "Lead added to the pipeline" });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast({
      title: "Could not add the lead",
      description: apiErrorMessage(e),
      variant: "destructive",
    }),
  });

  const ready = name.trim() && (mode === "existing" ? customerId : newCustomerName.trim());

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid="dialog-new-lead">
        <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="lead-name">Lead name</Label>
            <Input id="lead-name" data-testid="input-lead-name" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Smith kitchen remodel" autoFocus />
          </div>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "existing" | "new")} className="flex gap-4">
            <label className="flex items-center gap-2 text-sm" data-testid="radio-lead-new-customer">
              <RadioGroupItem value="new" /> New client
            </label>
            <label className="flex items-center gap-2 text-sm" data-testid="radio-lead-existing-customer">
              <RadioGroupItem value="existing" /> Existing client
            </label>
          </RadioGroup>
          {mode === "new" ? (
            <div>
              <Label htmlFor="lead-customer-name">Client name</Label>
              <Input id="lead-customer-name" data-testid="input-lead-customer-name" value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Jane Smith" />
            </div>
          ) : (
            <div>
              <Label>Client</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger data-testid="select-lead-customer"><SelectValue placeholder="Pick a client…" /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {canSeePrices && (
            <div>
              <Label htmlFor="lead-value">Estimated value (optional)</Label>
              <Input id="lead-value" data-testid="input-lead-value" value={value}
                onChange={(e) => setValue(e.target.value)} placeholder="$12,500" inputMode="decimal" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button data-testid="button-create-lead" onClick={() => create.mutate()}
            disabled={!ready || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add to pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit project ────────────────────────────────────────────────────────────

function EditProjectDialog({
  project, stages, members, canSeePrices, onClose,
}: {
  project: any;
  stages: any[];
  members: any[];
  canSeePrices: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(project.name ?? "");
  const [status, setStatus] = useState(project.status);
  const [owner, setOwner] = useState(project.projectManagerMemberId ?? "");
  const [value, setValue] = useState(
    project.contractValueCents != null ? String(project.contractValueCents / 100) : "",
  );

  const save = useMutation({
    mutationFn: async () => {
      const body: any = { name: name.trim(), status, projectManagerMemberId: owner || null };
      if (canSeePrices) body.contractValueCents = dollarsToCents(value);
      return (await apiRequest("PATCH", `/api/crm/projects/${project.id}`, body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      toast({ title: "Project updated" });
      onClose();
    },
    onError: (e: any) => toast({
      title: "Could not save the project",
      description: apiErrorMessage(e),
      variant: "destructive",
    }),
  });

  return (
    <>
      <DialogHeader><DialogTitle>Edit project</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input id="edit-name" data-testid="input-edit-name" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        {canSeePrices && (
          <div>
            <Label htmlFor="edit-value">Contract value</Label>
            <Input id="edit-value" data-testid="input-edit-value" value={value}
              onChange={(e) => setValue(e.target.value)} placeholder="$12,500" inputMode="decimal" />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Stage</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-edit-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((st) => <SelectItem key={st.key} value={st.key}>{st.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Owner (PM)</Label>
            <Select value={owner || "none"} onValueChange={(v) => setOwner(v === "none" ? "" : v)}>
              <SelectTrigger data-testid="select-edit-owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.displayName || m.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button data-testid="button-save-edit" onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Pipeline board. Grouped into parallel swimlanes (Prospect / Sales /
 * Production / Billing) rather than Leap's single linear rail, because real
 * construction runs sales, procurement and production at the same time.
 * Leads are created here ("+ New lead") and cards edit in place.
 */
export default function CrmPipelinePage() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data, isLoading, isError } = useQuery<any>({ queryKey: ["/api/crm/projects"] });
  const canMove = me?.permissions?.manageJobs === true;
  const canSeePrices = me?.permissions?.seePrices === true;
  // Tall columns collapse: the first few cards show, the rest sit behind an
  // explicit "Show more". MUST be declared before the loading early-returns —
  // a hook after a conditional return crashes the tree when data arrives.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const { data: customers } = useQuery<any[]>({
    queryKey: ["/api/crm/customers"], enabled: canMove,
  });
  const { data: membersData } = useQuery<any>({
    queryKey: ["/api/crm/members"], enabled: canMove,
  });

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      (await apiRequest("PATCH", `/api/crm/projects/${id}`, { status })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"] });
      toast({ title: "Stage updated" });
    },
    onError: (e: any) => toast({ title: "Could not move", description: apiErrorMessage(e), variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return (
      <ErrorCard
        title="Couldn't load the pipeline"
        description="Check your connection and refresh the page."
      />
    );
  }

  const stages: any[] = data.stages ?? [];
  const COLLAPSED_COUNT = 5;
  const projects: any[] = data.projects ?? [];
  // Server-computed per-stage totals (never capped); the loaded `projects`
  // array is bounded, so use these for the true column counts and header.
  const stageCounts: Record<string, number> = data.stageCounts ?? {};
  const totalProjects: number = data.totalProjects ?? projects.length;
  const groups = [...new Set(stages.map((s) => s.group))];
  const firstStage = stages[0]?.key ?? "lead";

  return (
    <CrmPage wide>
      <CrmPageHeader
        icon={KanbanSquare}
        title="Pipeline"
        infoKey="pipeline"
        subtitle={`${totalProjects} project${totalProjects === 1 ? "" : "s"} · drag a card to move it, or use the stage menu.`}
        actions={canMove ? (
          <Button size="sm" onClick={() => setNewLeadOpen(true)} data-testid="button-new-lead">
            <Plus className="h-4 w-4 mr-1" /> New lead
          </Button>
        ) : undefined}
      />

      {groups.map((group, gi) => {
        const color = groupColor(String(group), gi);
        const groupStages = stages.filter((s) => s.group === group);
        return (
          <div key={String(group)} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${color.dot}`} />
              <h2 className={`text-xs font-semibold uppercase tracking-widest ${color.text}`}>{String(group)}</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-proximity">
              {groupStages.map((s) => {
                const inStage = projects.filter((p) => p.status === s.key);
                const stageTotal = stageCounts[s.key] ?? inStage.length;
                const isOpen = expanded[s.key] === true;
                const visible = isOpen ? inStage : inStage.slice(0, COLLAPSED_COUNT);
                // Loaded cards may be fewer than the true stage total (row cap);
                // "+N more" reflects everything not shown, capped or collapsed.
                const hidden = stageTotal - visible.length;
                return (
                  <div key={s.key} className="min-w-[260px] w-[260px] shrink-0 snap-start"
                    onDragOver={(e) => canMove && e.preventDefault()}
                    onDrop={(e) => {
                      if (!canMove) return;
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) move.mutate({ id, status: s.key });
                    }}
                    data-testid={`stage-col-${s.key}`}>
                    <div className="flex items-center justify-between px-1.5 pb-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
                        {stageTotal}
                      </span>
                    </div>
                    <div className="space-y-2 min-h-[80px] rounded-xl border border-border/50 bg-muted/40 p-2">
                      {visible.map((p) => (
                        <div key={p.id}
                          draggable={canMove}
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                          className="rounded-lg border bg-card p-3 space-y-1.5 shadow-sm transition-all hover:shadow-md hover:border-primary/40"
                          data-testid={`card-project-${p.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <Link href={`/crm/projects/${p.id}`} className="min-w-0">
                              <div className="font-medium text-sm leading-snug hover:underline truncate">
                                {p.name}
                              </div>
                            </Link>
                            {canMove && (
                              <button
                                type="button"
                                aria-label={`Edit ${p.name}`}
                                data-testid={`button-edit-project-${p.id}`}
                                onClick={() => setEditing(p)}
                                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">{p.number}</span>
                            {canSeePrices && p.contractValueCents != null && (
                              <span className="text-sm font-semibold tabular-nums">{money(p.contractValueCents)}</span>
                            )}
                          </div>
                          {p.trades?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {p.trades.slice(0, 3).map((t: string) => (
                                <Badge key={t} variant="outline" className="text-[10px] font-normal">{t}</Badge>
                              ))}
                            </div>
                          ) : null}
                          {canMove && (
                            <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                              <Select value={p.status}
                                onValueChange={(status) => status !== p.status && move.mutate({ id: p.id, status })}>
                                <SelectTrigger className="h-7 text-xs bg-muted/40 border-transparent" data-testid={`select-stage-${p.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {stages.map((st) => (
                                    <SelectItem key={st.key} value={st.key}>{st.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      ))}
                      {hidden > 0 && (
                        <button type="button"
                          className="w-full rounded-lg border border-dashed border-border/60 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          onClick={() => setExpanded((x) => ({ ...x, [s.key]: true }))}
                          data-testid={`button-show-more-${s.key}`}>
                          Show {hidden} more <ChevronDown className="inline h-3 w-3 ml-0.5" />
                        </button>
                      )}
                      {isOpen && inStage.length > COLLAPSED_COUNT && (
                        <button type="button"
                          className="w-full rounded-lg py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setExpanded((x) => ({ ...x, [s.key]: false }))}
                          data-testid={`button-show-less-${s.key}`}>
                          Show less <ChevronUp className="inline h-3 w-3 ml-0.5" />
                        </button>
                      )}
                      {!inStage.length && (
                        <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border/60 rounded-lg">
                          Drop a project here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {!projects.length && (
        <div className="rounded-xl border bg-card">
          <EmptyState
            icon={KanbanSquare}
            title="No projects yet"
            description={canMove
              ? "Add your first lead — it lands in the first stage of the board."
              : "Projects are the jobs on your board — create one from a client's page."}
            action={canMove ? (
              <Button onClick={() => setNewLeadOpen(true)} data-testid="button-new-lead-empty">
                <Plus className="h-4 w-4 mr-1" /> New lead
              </Button>
            ) : (
              <Link href="/crm/clients">
                <Button>Go to clients <ArrowRight className="h-4 w-4 ml-1" /></Button>
              </Link>
            )}
          />
        </div>
      )}

      <NewLeadDialog
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
        customers={customers ?? []}
        firstStage={firstStage}
        canSeePrices={canSeePrices}
      />
      <Dialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-edit-project">
          {editing && (
            <EditProjectDialog
              key={editing.id}
              project={editing}
              stages={stages}
              members={membersData?.members ?? []}
              canSeePrices={canSeePrices}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </CrmPage>
  );
}
