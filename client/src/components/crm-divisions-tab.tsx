/**
 * Team & Company → Divisions (/crm/team?tab=divisions).
 *
 * Sections, in order: "All divisions — Overview", then one tab per division by
 * code ("FL · Florida", "WA · Washington"). The overview puts every division's
 * own dashboard numbers side by side — never summed into one another; the only
 * cross-division sum is the row explicitly labelled "Company total" — plus the
 * Unassigned records and the tool that sorts them. Each division tab shows that
 * division's numbers and details and opens its workspace.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowRight, Layers, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { SegmentedTabsList } from "@/components/tool";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle, EmptyState, ErrorCard } from "@/components/crm-ui";
import { confirmAction } from "@/components/confirm-dialog";
import { CrmDivisionsManager } from "@/components/crm-divisions-manager";
import { resetCrmData, switchDivisionWorkspace, useActiveDivision } from "@/components/crm-division-switcher";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { divisionLabel } from "@shared/divisions";

type Kpi = { count: number; totalCents?: number };
type Kpis = {
  openEstimates: Kpi; wonThisMonth: Kpi; wonLastMonth: Kpi; wonThisYear: Kpi; wonAllTime: Kpi;
  invoicedThisMonth: Kpi; collectedThisMonth: Kpi;
  outstanding: Kpi; activeProjects: Kpi; clients: { count: number };
  records: { customers: number; projects: number; estimates: number; invoices: number };
};
type Overview = {
  monthStart: string;
  activeDivisionId: string | null;
  divisions: { id: string; name: string; code: string; city: string | null; state: string | null; isHeadquarters: boolean; label: string; kpis: Kpis }[];
  unassigned: Kpis;
  companyTotal: Kpis;
};
type Preview = {
  divisions: { id: string; code: string; name: string; state: string | null; label: string }[];
  byDivision: Record<string, { customers: number; projects: number; estimates: number }>;
  noSuggestion: { customers: number; projects: number; estimates: number };
  reasons: Record<string, number>;
  reasonText: Record<string, string>;
  invoicesUnassigned: number;
  records: { kind: "customer" | "project" | "estimate"; id: string; label: string; customerName: string | null; state: string | null; suggestedDivisionId: string | null; reason: string | null }[];
};

const money = (c?: number) =>
  c == null ? null : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

type KpiKey = keyof Omit<Kpis, "clients" | "records">;

/** One comparison table: rows are metrics in three groups, columns are divisions. Plain and neutral on purpose. */
const KPI_GROUPS: { title: string; rows: { key: KpiKey | "clients"; label: string }[] }[] = [
  { title: "Revenue (won contracts)", rows: [
    { key: "wonThisMonth", label: "This month" },
    { key: "wonLastMonth", label: "Last month" },
    { key: "wonThisYear", label: "This year" },
    { key: "wonAllTime", label: "All time" },
  ] },
  { title: "Pipeline", rows: [
    { key: "openEstimates", label: "Open estimates" },
    { key: "activeProjects", label: "Active projects" },
  ] },
  { title: "Cash", rows: [
    { key: "invoicedThisMonth", label: "Invoiced this month" },
    { key: "collectedThisMonth", label: "Collected this month" },
    { key: "outstanding", label: "Outstanding invoices" },
  ] },
  { title: "Clients", rows: [{ key: "clients", label: "Active clients" }] },
];

type KpiColumn = { id: string; title: string; subtitle?: string | null; k: Kpis; emphasis?: boolean; action?: ReactNode };

function KpiCell({ k, rowKey }: { k: Kpis; rowKey: KpiKey | "clients" }) {
  // Counts-only rows keep the amount column's right edge (an empty count slot beside them).
  const spacer = <span className="ml-2 inline-block w-8" aria-hidden="true" />;
  if (rowKey === "clients") return <span className="whitespace-nowrap"><span className="font-medium">{k.clients.count.toLocaleString()}</span>{spacer}</span>;
  const v = k[rowKey];
  const amount = money(v?.totalCents);
  // A price-blind seat gets counts only.
  if (amount == null) return <span className="whitespace-nowrap"><span className="font-medium">{(v?.count ?? 0).toLocaleString()}</span>{spacer}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium">{amount}</span>
      <span className="ml-2 inline-block w-8 text-right text-xs text-muted-foreground">{(v?.count ?? 0).toLocaleString()}</span>
    </span>
  );
}

function KpiTable({ columns, testId }: { columns: KpiColumn[]; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card" data-testid={testId}>
      <table className="w-full text-sm tabular-nums" style={{ minWidth: 200 + columns.length * 150 }}>
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 z-10 w-52 min-w-52 bg-card px-4 py-3 text-left font-medium text-muted-foreground" />
            {columns.map((c) => (
              <th key={c.id} className={`whitespace-nowrap px-4 py-3 text-right align-bottom font-medium ${c.emphasis ? "bg-muted/40" : ""}`}>
                <div className="text-foreground">{c.title}</div>
                {c.subtitle && <div className="text-xs font-normal text-muted-foreground">{c.subtitle}</div>}
              </th>
            ))}
          </tr>
        </thead>
        {KPI_GROUPS.map((g) => (
          <tbody key={g.title} className="border-b last:border-b-0">
            <tr>
              <th colSpan={columns.length + 1} className="whitespace-nowrap px-4 pb-1 pt-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.title}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.key} className="hover:bg-muted/30">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-4 py-1.5 text-muted-foreground">{r.label}</td>
                {columns.map((c) => (
                  <td key={c.id} className={`px-4 py-1.5 text-right ${c.emphasis ? "bg-muted/40" : ""}`} data-testid={`${testId}-${c.id}-${r.key}`}>
                    <KpiCell k={c.k} rowKey={r.key} />
                  </td>
                ))}
              </tr>
            ))}
            <tr><td colSpan={columns.length + 1} className="h-2" /></tr>
          </tbody>
        ))}
        {columns.some((c) => c.action) && (
          <tfoot>
            <tr className="border-t">
              <td className="px-4 py-3" />
              {columns.map((c) => <td key={c.id} className={`px-4 py-3 text-right ${c.emphasis ? "bg-muted/40" : ""}`}>{c.action}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function CrmDivisionsTab() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const { me, divisions, canSwitch, activeId } = useActiveDivision();
  const canManage = me?.permissions?.manageSettings === true;
  const canReport = me?.permissions?.seeReporting === true && me?.permissions?.viewAllJobs === true;
  const section = new URLSearchParams(search).get("d") || "overview";
  const goSection = (d: string) => navigate(`/crm/team?tab=divisions${d === "overview" ? "" : `&d=${encodeURIComponent(d)}`}`, { replace: true });

  const overview = useQuery<Overview>({ queryKey: ["/api/crm/divisions/overview"], enabled: canSwitch && canReport && divisions.length > 0 });

  const open = async (id: string) => {
    try {
      if (id !== activeId) await switchDivisionWorkspace(id);
      navigate("/crm");
    } catch (e) {
      toast({ title: "Couldn't open that division", description: apiErrorMessage(e), variant: "destructive" });
    }
  };

  if (!canSwitch) {
    return <EmptyState icon={Layers} title="Your seat works inside one division" description="Ask the account owner if you need another division's work." />;
  }

  const current = divisions.find((d) => d.code === section || d.id === section);
  const tabValue = current ? current.code : "overview";

  return (
    <div className="space-y-4" data-testid="divisions-tab">
      {divisions.length === 0 ? (
        <>
          <EmptyState icon={Layers} title="No divisions yet"
            description="Add your company's divisions (for example a Washington headquarters and a Florida division). Each one gets its own workspace and dashboard." />
          {canManage && <CrmDivisionsManager />}
        </>
      ) : (
        <Tabs value={tabValue} onValueChange={goSection}>
          <SegmentedTabsList>
            <TabsTrigger value="overview" data-testid="tab-division-overview">All divisions — Overview</TabsTrigger>
            {divisions.map((d) => (
              <TabsTrigger key={d.id} value={d.code} data-testid={`tab-division-${d.code}`}>
                {divisionLabel(d)}
              </TabsTrigger>
            ))}
          </SegmentedTabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            {!canReport ? (
              <p className="text-sm text-muted-foreground">The side-by-side numbers need “See reporting” and “See all jobs”.</p>
            ) : overview.isError ? (
              <ErrorCard title="Couldn't load the overview" description={apiErrorMessage(overview.error)} />
            ) : !overview.data ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading every division's numbers…</div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Each column is one division on its own; only the last column adds them up. Amounts show the number of
                  records beside them. “This month” is since{" "}
                  {new Date(overview.data.monthStart).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
                </p>
                <KpiTable testId="table-division-overview" columns={[
                  ...overview.data.divisions.map((d) => ({
                    id: d.code, title: d.label,
                    subtitle: [d.isHeadquarters ? "HQ" : null, activeId === d.id ? "You are here" : null].filter(Boolean).join(" · ") || null,
                    k: d.kpis,
                    action: (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void open(d.id)} data-testid={`button-open-division-${d.code}`}>
                        Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    ),
                  })),
                  {
                    id: "unassigned", title: "Unassigned",
                    subtitle: `${overview.data.unassigned.records.customers.toLocaleString()} clients · ${overview.data.unassigned.records.estimates.toLocaleString()} estimates`,
                    k: overview.data.unassigned,
                  },
                  { id: "total", title: "Company total", subtitle: "All columns added", k: overview.data.companyTotal, emphasis: true },
                ]} />

                {canManage && <SortUnassigned onDone={() => overview.refetch()} />}
              </>
            )}
            {canManage && <CrmDivisionsManager title="Manage divisions" onOpenWorkspace={(id) => void open(id)} />}
          </TabsContent>

          {divisions.map((d) => {
            const card = overview.data?.divisions.find((x) => x.id === d.id);
            return (
              <TabsContent key={d.id} value={d.code} className="mt-4 space-y-4" data-testid={`panel-division-${d.code}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{divisionLabel(d)}</h3>
                    <p className="text-sm text-muted-foreground">
                      {[d.name, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")} — only this division's estimates, invoices, projects and payments.
                    </p>
                  </div>
                  <Button onClick={() => void open(d.id)} data-testid={`button-open-workspace-tab-${d.code}`}>
                    {activeId === d.id ? "Go to this division's dashboard" : `Open ${d.code} workspace`} <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
                {card ? <KpiTable testId={`table-division-${d.code}`} columns={[{ id: d.code, title: divisionLabel(d), k: card.kpis }]} />
                  : canReport ? <div className="text-sm text-muted-foreground">Loading…</div> : null}
                {canManage && <CrmDivisionsManager onlyId={d.id} title={`${divisionLabel(d)} — details`} />}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}

/** Preview → confirm → apply. Suggestions come only from real links (the server recomputes them on apply). */
function SortUnassigned({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  const [filter, setFilter] = useState<string>("none");
  const preview = useQuery<Preview>({ queryKey: ["/api/crm/divisions/unassigned"], enabled: show });
  const label = useMemo(() => new Map((preview.data?.divisions ?? []).map((d) => [d.id, d.label])), [preview.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/crm/divisions/unassigned"] });
    resetCrmData();
    onDone();
  };
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/divisions/unassigned/apply", {})).json(),
    onSuccess: (r: any) => {
      toast({ title: "Records sorted", description: `${r.customers} clients, ${r.projects} projects and ${r.estimates} estimates now have a division. ${r.leftUnassigned} stay unassigned.` });
      refresh();
    },
    onError: (e) => toast({ title: "Couldn't sort the records", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const assign = useMutation({
    mutationFn: async (v: { kind: string; id: string; divisionId: string }) =>
      (await apiRequest("POST", "/api/crm/divisions/assign", v)).json(),
    onSuccess: () => { toast({ title: "Division set" }); refresh(); },
    onError: (e) => toast({ title: "Couldn't set the division", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const p = preview.data;
  const total = (x: { customers: number; projects: number; estimates: number }) => x.customers + x.projects + x.estimates;
  const suggested = p ? Object.values(p.byDivision).reduce((n, x) => n + total(x), 0) : 0;
  const rows = (p?.records ?? []).filter((r) => filter === "all" ? true : filter === "none" ? !r.suggestedDivisionId : r.suggestedDivisionId === filter);
  const KIND = { customer: "Client", project: "Project", estimate: "Estimate" } as const;

  return (
    <Card data-testid="card-sort-unassigned">
      <CardHeader className="pb-2">
        <SectionTitle icon={Wand2} title="Sorted by address automatically"
          description="Every hour, each unassigned client, project and estimate goes to the division that covers its address — the client record, its projects, HOVER captures and website form submissions — or to its project's division. New clients are placed the moment they're created. What's left below has no address anywhere: assign it by hand, or sort now." />
      </CardHeader>
      <CardContent className="space-y-3">
        {!show ? (
          <Button variant="outline" onClick={() => setShow(true)} data-testid="button-preview-sort"><Sparkles className="mr-2 h-4 w-4" /> Preview suggestions</Button>
        ) : preview.isError ? (
          <ErrorCard title="Couldn't build the preview" description={apiErrorMessage(preview.error)} />
        ) : !p ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking every unassigned record…</div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="sort-summary">
              {p.divisions.map((d) => (
                <div key={d.id} className="rounded-md border px-3 py-2 text-sm" data-testid={`sort-to-${d.code}`}>
                  <div className="font-medium">→ {d.label}</div>
                  <div className="text-muted-foreground tabular-nums">
                    {p.byDivision[d.id].customers} clients · {p.byDivision[d.id].projects} projects · {p.byDivision[d.id].estimates} estimates
                  </div>
                </div>
              ))}
              <div className="rounded-md border border-dashed px-3 py-2 text-sm" data-testid="sort-no-suggestion">
                <div className="font-medium">No suggestion — stays unassigned</div>
                <div className="text-muted-foreground tabular-nums">
                  {p.noSuggestion.customers} clients · {p.noSuggestion.projects} projects · {p.noSuggestion.estimates} estimates
                </div>
              </div>
            </div>
            {Object.keys(p.reasons).length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="sort-reasons">
                Based on: {Object.entries(p.reasons).map(([k, n]) => `${p.reasonText[k] ?? k} (${n})`).join(" · ")}.
                {p.invoicesUnassigned > 0 && ` ${p.invoicesUnassigned} unassigned invoice${p.invoicesUnassigned === 1 ? "" : "s"} follow their estimate, project or client.`}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={suggested === 0 || apply.isPending} data-testid="button-apply-sort"
                onClick={() => confirmAction({
                  id: "apply-division-sort",
                  title: `Assign ${suggested.toLocaleString()} records to divisions?`,
                  description: `${p.divisions.map((d) => `${total(p.byDivision[d.id])} to ${d.label}`).join(", ")}. ${total(p.noSuggestion)} records with no suggestion stay unassigned. Each record's estimates and invoices then print under that division's letterhead, and the change is recorded in the activity log. You can move any record back by hand.`,
                  confirmLabel: "Assign divisions",
                  destructive: false,
                  onConfirm: () => apply.mutate(),
                })}>
                {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Apply {suggested.toLocaleString()} suggestions
              </Button>
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-64" data-testid="select-sort-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Show: no suggestion ({total(p.noSuggestion)})</SelectItem>
                  {p.divisions.map((d) => <SelectItem key={d.id} value={d.id}>Show: suggested {d.label} ({total(p.byDivision[d.id])})</SelectItem>)}
                  <SelectItem value="all">Show: everything ({p.records.length})</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-96 overflow-auto rounded-md border" data-testid="sort-records">
              {rows.length === 0 ? <p className="p-3 text-sm text-muted-foreground">Nothing here.</p> : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-1.5">Record</th><th className="px-3 py-1.5">Client · state</th><th className="px-3 py-1.5">Suggestion</th><th className="px-3 py-1.5">Assign by hand</th></tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 300).map((r) => (
                      <tr key={`${r.kind}:${r.id}`} className="border-t" data-testid={`sort-row-${r.kind}-${r.id}`}>
                        <td className="px-3 py-1.5"><span className="text-muted-foreground">{KIND[r.kind]}</span> {r.label}</td>
                        <td className="px-3 py-1.5">{r.customerName ?? "—"}{r.state ? ` · ${r.state}` : ""}</td>
                        <td className="px-3 py-1.5">{r.suggestedDivisionId ? `${label.get(r.suggestedDivisionId)} (${p.reasonText[r.reason!]})` : <span className="text-muted-foreground">none</span>}</td>
                        <td className="px-3 py-1">
                          <Select value="" onValueChange={(v) => assign.mutate({ kind: r.kind, id: r.id, divisionId: v })}>
                            <SelectTrigger className="h-8 w-44" data-testid={`select-assign-${r.id}`}><SelectValue placeholder="Choose…" /></SelectTrigger>
                            <SelectContent>{p.divisions.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {rows.length > 300 && <p className="p-2 text-xs text-muted-foreground">Showing 300 of {rows.length.toLocaleString()}.</p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
