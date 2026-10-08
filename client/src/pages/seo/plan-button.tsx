/** "Add to plan": send one or more findings to the site's action plan (/seo/plan). Free; a finding already there is not added twice. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api } from "./shell";

export type PlanTask = { kind: "keyword" | "page" | "link_reclaim" | "link_prospect" | "audit" | "other"; title: string; target?: string | null; facts?: Record<string, string | number | boolean | null>; source?: string | null };

/** A short, stable fingerprint of a string (FNV-1a), so two long sources that begin alike stay two sources. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
/**
 * A finding made to fit a task. The title is shortened for display. `source` — what makes it the same finding next
 * time — keeps a fingerprint of the whole when it is too long, never just its beginning. A web address too long to
 * keep is replaced by its site (a shortened address would point somewhere else).
 */
export function fitTask(t: PlanTask): PlanTask {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const facts = Object.fromEntries(Object.entries(t.facts ?? {}).slice(0, 12).map(([k, v]) => [k, typeof v === "string" ? cut(v, 300) : v]));
  let target = t.target ?? null;
  if (target && target.length > 500) { try { target = /^https?:\/\//i.test(target) ? new URL(target).origin : cut(target, 500); } catch { target = null; } }
  const source = t.source ? (t.source.length > 200 ? `${t.source.slice(0, 180)}#${fingerprint(t.source)}` : t.source) : null;
  return { kind: t.kind, title: cut(t.title.trim(), 200), target, facts, source };
}

export function AddToPlan({ siteId, tasks, label = "Add to plan", onDone, testId = "button-add-to-plan" }: { siteId: number; tasks: PlanTask[]; label?: string; onDone?: () => void; testId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const m = useMutation({
    // Fifty at a time, one request after another, until every finding has been sent; the answers are added up.
    mutationFn: async (v: { siteId: number; tasks: PlanTask[] }) => {
      let added = 0, already = 0;
      for (let i = 0; i < v.tasks.length; i += 50) {
        const r: { added: number; already: number } = await api("POST", `/api/seo/sites/${v.siteId}/tasks`, { tasks: v.tasks.slice(i, i + 50).map(fitTask) });
        added += r.added; already += r.already;
      }
      return { added, already };
    },
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
      {m.isPending ? <Loader2 className="animate-spin" /> : <ClipboardList />} {label}{tasks.length > 1 ? ` (${tasks.length})` : ""}
    </button>
  );
}
