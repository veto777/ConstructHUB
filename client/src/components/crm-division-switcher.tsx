/**
 * The division workspace switcher (CRM top bar / phone sidebar) and the
 * coloured badge that says which division you are in.
 *
 * Shown only to seats that may switch (the owner, division-less admins) in an
 * org that has divisions. Entries, in order: "All divisions — Overview", then
 * each division by code ("FL · Florida", "WA · Washington" — both of Alpine's
 * divisions are named "Alpine Exteriors", so the code + region is the label).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Check, ChevronDown, Layers } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  ALL_DIVISIONS, getDivisionWorkspace, setDivisionSwitchable, setDivisionWorkspaceLocal, useDivisionWorkspace,
} from "@/lib/division-workspace";
import { divisionLabel, sortDivisions } from "@shared/divisions";

export type WorkspaceDivision = { id: string; name: string; code: string; state: string | null; city?: string | null; isHeadquarters?: boolean };

/** Distinct, stable colours per division (by tab order) — the badge must be unmistakable. */
const TONES = [
  { chip: "bg-teal-500 text-white", soft: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/40", dot: "bg-teal-500" },
  { chip: "bg-indigo-500 text-white", soft: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/40", dot: "bg-indigo-500" },
  { chip: "bg-amber-500 text-black", soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40", dot: "bg-amber-500" },
  { chip: "bg-rose-500 text-white", soft: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/40", dot: "bg-rose-500" },
  { chip: "bg-emerald-600 text-white", soft: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/40", dot: "bg-emerald-600" },
];

export function divisionTone(divisions: WorkspaceDivision[] | undefined, id: string | null | undefined) {
  const sorted = sortDivisions(divisions ?? []);
  const i = sorted.findIndex((d) => d.id === id);
  return TONES[(i < 0 ? 0 : i) % TONES.length];
}

/** Every CRM query except who-am-I: dropped and refetched on a switch, so nothing bleeds between divisions. */
export function resetCrmData() {
  void queryClient.resetQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return k.startsWith("/api/") && k !== "/api/auth/me";
    },
  });
}

/** Switch workspace: remember it server-side (follows the owner to other devices), then reload every list. */
export async function switchDivisionWorkspace(next: string): Promise<void> {
  await apiRequest("PUT", "/api/crm/divisions/workspace", { workspace: next });
  setDivisionWorkspaceLocal(next);
  resetCrmData();
}

/**
 * Keep the client's workspace in step with /api/crm/me (asked without the
 * header, so it reports the SAVED pick) and stop sending the header for a
 * pinned seat.
 */
export function useCrmDivisionSync(me: any) {
  const ws = me?.divisionWorkspace;
  useEffect(() => {
    if (!ws) return;
    setDivisionSwitchable(ws.canSwitch === true);
    if (ws.canSwitch !== true) return;
    if (setDivisionWorkspaceLocal(ws.activeDivisionId ?? ALL_DIVISIONS)) resetCrmData();
  }, [ws?.canSwitch, ws?.activeDivisionId]);
}

/** The divisions + the active one, for pages (null = All divisions or a seat that can't switch). */
export function useActiveDivision() {
  const workspace = useDivisionWorkspace();
  const { data: me } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: divisions } = useQuery<WorkspaceDivision[]>({ queryKey: ["/api/crm/divisions"], enabled: !!me });
  const canSwitch = me?.divisionWorkspace?.canSwitch === true;
  const pinnedId: string | null = me?.divisionWorkspace?.pinnedDivisionId ?? null;
  const activeId = canSwitch ? (workspace === ALL_DIVISIONS ? null : workspace) : pinnedId;
  const active = activeId ? divisions?.find((d) => d.id === activeId) ?? null : null;
  return { me, divisions: sortDivisions(divisions ?? []), canSwitch, active, activeId };
}

/** The coloured "you are in FL · Florida" pill. */
export function DivisionBadge({ className = "", testId = "badge-active-division" }: { className?: string; testId?: string }) {
  const { divisions, active } = useActiveDivision();
  if (!active) return null;
  const tone = divisionTone(divisions, active.id);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone.chip} ${className}`}
      data-testid={testId} title={`You are in the ${divisionLabel(active)} division. Numbers and lists show this division only.`}>
      <Layers className="h-3.5 w-3.5" aria-hidden="true" /> {divisionLabel(active)}
    </span>
  );
}

export function CrmDivisionSwitcher({ variant = "topbar" }: { variant?: "topbar" | "sidebar" }) {
  const { me, divisions, canSwitch, active } = useActiveDivision();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  useCrmDivisionSync(me);
  if (!canSwitch || divisions.length === 0) return null;

  const tone = active ? divisionTone(divisions, active.id) : null;
  const pick = async (next: string) => {
    if (next === getDivisionWorkspace()) return;
    try {
      await switchDivisionWorkspace(next);
      const d = divisions.find((x) => x.id === next);
      toast({ title: d ? `Now in ${divisionLabel(d)}` : "Now in All divisions", description: d ? "Lists, totals and new records are this division's only." : "The overview shows every division side by side." });
    } catch (e) {
      toast({ title: "Couldn't switch division", description: apiErrorMessage(e), variant: "destructive" });
    }
  };

  const trigger = variant === "topbar"
    ? (
      <button type="button" data-testid="button-division-switcher" aria-label="Switch division"
        className={`inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ${active ? tone!.chip : "bg-white/10 text-white/85 hover:bg-white/15"}`}>
        <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" data-testid="text-division-switcher">{active ? divisionLabel(active) : "All divisions"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden="true" />
      </button>
    )
    : (
      <button type="button" data-testid="button-division-switcher" aria-label="Switch division"
        className={`mt-2 flex h-8 w-full items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold ${active ? tone!.soft : "border-sidebar-border text-sidebar-foreground/80"}`}>
        <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" data-testid="text-division-switcher">{active ? divisionLabel(active) : "All divisions"}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" data-testid="menu-division-switcher">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Division workspace</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => { void pick(ALL_DIVISIONS); }} data-testid="option-division-all">
          <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/60" aria-hidden="true" />
          <span className="flex-1">All divisions — Overview</span>
          {!active && <Check className="h-4 w-4" aria-hidden="true" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {divisions.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => { void pick(d.id); }} data-testid={`option-division-${d.code}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${divisionTone(divisions, d.id).dot}`} aria-hidden="true" />
            <span className="flex-1">{divisionLabel(d)}</span>
            {active?.id === d.id && <Check className="h-4 w-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/crm/team?tab=divisions")} data-testid="option-division-manage">
          <span className="flex-1 text-muted-foreground">Divisions overview &amp; settings…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
