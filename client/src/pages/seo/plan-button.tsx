/** "Add to plan": send one or more findings to the site's action plan (/seo/plan). Free; a finding already there is not added twice. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api } from "./shell";

export type PlanTask = { kind: "keyword" | "page" | "link_reclaim" | "link_prospect" | "audit" | "other"; title: string; target?: string | null; facts?: Record<string, string | number | boolean | null>; source?: string | null };

/** A finding made to fit a task: long keywords and addresses are shortened for display; `source` stays what identifies it. */
export function fitTask(t: PlanTask): PlanTask {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const facts = Object.fromEntries(Object.entries(t.facts ?? {}).slice(0, 12).map(([k, v]) => [k, typeof v === "string" ? cut(v, 300) : v]));
  return { kind: t.kind, title: cut(t.title.trim(), 200), target: t.target ? cut(t.target, 500) : null, facts, source: t.source ? t.source.slice(0, 200) : null };
}

export function AddToPlan({ siteId, tasks, label = "Add to plan", onDone, testId = "button-add-to-plan" }: { siteId: number; tasks: PlanTask[]; label?: string; onDone?: () => void; testId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: (v: { siteId: number; tasks: PlanTask[] }) => api("POST", `/api/seo/sites/${v.siteId}/tasks`, { tasks: v.tasks.slice(0, 50).map(fitTask) }),
    onSuccess: (r: { added: number; already: number }, v) => {
      void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${v.siteId}/tasks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] });
      toast({
        title: r.added ? `${r.added} added to the action plan` : "Already in the action plan",
        description: <>{r.already && r.added ? `${r.already} ${r.already === 1 ? "was" : "were"} already there. ` : ""}<Link href={`/seo/plan?site=${v.siteId}`} className="underline">Open the plan</Link></>,
      });
      onDone?.();
    },
    onError: (e) => toast({ title: "Couldn't add to the plan", description: apiErrorMessage(e), variant: "destructive" }),
  });
  return (
    <button type="button" className="g-pill g-pill--sm" disabled={!tasks.length || m.isPending} onClick={() => m.mutate({ siteId, tasks })} data-testid={testId}
      aria-label={tasks.length === 1 ? `Add to the action plan: ${tasks[0].title}` : undefined}>
      {m.isPending ? <Loader2 className="animate-spin" /> : <ClipboardList />} {label}{tasks.length > 1 ? ` (${Math.min(tasks.length, 50)})` : ""}
    </button>
  );
}
