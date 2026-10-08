/**
 * /seo/plan — Action plan: what you decided to do about what the SEO tools found, per site.
 * Findings arrive here from "Add to plan" on the Opportunities, Content gap, Link intersect,
 * Backlinks and Site audit screens; you can also write your own. Free (server/seo/tasks.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, SeoShell, Tile, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";

type Kind = "keyword" | "page" | "link_reclaim" | "link_prospect" | "audit" | "other";
type Status = "todo" | "doing" | "done" | "dropped";
type Counts = { todo: number; doing: number; done: number; dropped: number; doneRecently: number };
type Task = { recheck?: "none" | "smaller" | "not_rechecked" | "failed"; id: number; kind: Kind; title: string; target: string | null; url: string | null; facts: Record<string, string | number | boolean | null>; source: string | null; status: Status; note: string | null; createdAt: string; doneAt: string | null; resolved?: { on: string | null } };
type Data = { tasks: Task[]; counts: Counts; closedShown: number; max: number };
const RECHECK: Record<NonNullable<Task["recheck"]>, string> = {
  none: "Not rechecked since it was added — run a new crawl in Site audit to see whether it is fixed.",
  smaller: "A newer crawl did not list this, but it covered far fewer pages than the crawl this came from, so that proves nothing yet.",
  not_rechecked: "The newest crawl could not re-check this (it crawled other pages, or had no Google profile attached).",
  failed: "The newest crawl failed, so this has not been rechecked.",
};

const KIND: Record<Kind, string> = { keyword: "Keyword", page: "New page", link_reclaim: "Win back a link", link_prospect: "Ask for a link", audit: "Site fix", other: "Other" };
const STATUS: Record<Status, string> = { doing: "In progress", todo: "To do", done: "Done", dropped: "Dropped" };
/** The facts carried from the finding, in words. */
function facts(t: Task): string {
  const d = t.facts, out: string[] = [];
  if (typeof d.position === "number") out.push(`position ${d.position} when added`);
  if (typeof d.volume === "number") out.push(`${fmtNum(d.volume)} searches a month`);
  if (typeof d.authority === "number") out.push(`authority ${d.authority}`);
  if (typeof d.affected === "number") out.push(`${fmtNum(d.affected)} affected when added`);
  if (typeof d.lastSeen === "string") out.push(`link last seen ${fmtDate(d.lastSeen)}`);
  if (typeof d.linksTo === "string" && d.linksTo) out.push(`links to ${d.linksTo}`);
  return out.join(" · ");
}

export default function SeoPlanPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  // "Open the plan" from another screen names the site it added to: that site is the one shown.
  useEffect(() => { const want = Number(new URLSearchParams(window.location.search).get("site")); if (want && sites.data?.some((s) => s.id === want) && site?.id !== want) onSite(want); }, [sites.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [closedLimit, setClosedLimit] = useState(100);
  const key = `/api/seo/sites/${site?.id}/tasks`;
  const q = useQuery<Data>({ queryKey: [key, closedLimit], queryFn: () => api("GET", `${key}?closed=${closedLimit}`), enabled: !!site });
  const [kind, setKind] = useState<Kind | "all">("all");
  const [showClosed, setShowClosed] = useState(false);
  const [title, setTitle] = useState("");
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const refresh = (siteId: number) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${siteId}/tasks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); };
  const add = useMutation({
    mutationFn: (v: { siteId: number; title: string }) => api("POST", `/api/seo/sites/${v.siteId}/tasks`, { tasks: [{ kind: "other", title: v.title }] }),
    onSuccess: (_d: unknown, v) => { setTitle(""); refresh(v.siteId); },
    onError: (e) => toast({ title: "Couldn't add that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const change = useMutation({
    mutationFn: (v: { siteId: number; id: number; patch: { status?: Status; note?: string | null } }) => api("POST", `/api/seo/tasks/${v.id}`, v.patch),
    onSuccess: (_d: unknown, v) => { if (v.patch.note !== undefined) setNoteFor(null); refresh(v.siteId); },
    onError: (e) => toast({ title: "Couldn't save that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (v: { siteId: number; id: number }) => api("DELETE", `/api/seo/tasks/${v.id}`),
    onSuccess: (_d: unknown, v) => refresh(v.siteId),
    onError: (e) => toast({ title: "Couldn't delete that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const all = q.data?.tasks ?? [];
  const open = all.filter((t) => t.status === "todo" || t.status === "doing");
  const closed = all.filter((t) => t.status === "done" || t.status === "dropped");
  const kinds = useMemo(() => [...new Set(all.map((t) => t.kind))], [all]);
  // A filter that no longer applies (another site, or the last task of that kind gone) is dropped, never left hiding everything.
  useEffect(() => { setKind("all"); setShowClosed(false); setNoteFor(null); setClosedLimit(100); }, [site?.id]);
  useEffect(() => { if (kind !== "all" && q.data && !kinds.includes(kind)) setKind("all"); }, [kinds, kind, q.data]);
  const counts = q.data?.counts;
  const closedTotal = counts ? counts.done + counts.dropped : closed.length;
  const shown = (showClosed ? closed : open).filter((t) => kind === "all" || t.kind === kind);
  const set = (t: Task, s: Status) => site && change.mutate({ siteId: site.id, id: t.id, patch: { status: s } });

  return (
    <SeoShell title="Action plan" description="What you have decided to do about what the SEO tools found — and what is done." site={site} onSite={onSite} sites={sites} status={status}>
      {!site && sites.isSuccess && <Empty testId="plan-empty-sites"><h3>No sites yet</h3><p>Add your site above; findings you choose to act on are kept here for it.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the plan…</p>}
      {site && q.isError && <div className="g-callout" role="alert"><h3>Couldn't load the plan</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && q.data && (
        <>
          <div className="g-tiles mb-4">
            <Tile label="To do" value={fmtNum(counts?.todo ?? 0)} testId="tile-plan-todo" />
            <Tile label="In progress" value={fmtNum(counts?.doing ?? 0)} testId="tile-plan-doing" />
            <Tile label="Done in the last 30 days" value={fmtNum(counts?.doneRecently ?? 0)} testId="tile-plan-done" />
            <Tile label="Done in all" value={fmtNum(counts?.done ?? 0)} testId="tile-plan-total" />
          </div>
          <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate({ siteId: site.id, title: title.trim() }); }} data-testid="form-plan-add">
            <label className="min-w-0 flex-1 sm:max-w-xl"><span className="sr-only">A task of your own</span>
              <input className="g-input w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task of your own — e.g. Ask the supplier to list us as an installer" data-testid="input-plan-title" />
            </label>
            <Button type="submit" disabled={!title.trim() || add.isPending} data-testid="button-plan-add"><Plus className="mr-1 h-4 w-4" /> Add</Button>
          </form>
          <nav className="g-tabs" aria-label="Tasks">
            <a href="#open" aria-current={!showClosed ? "page" : undefined} onClick={(e) => { e.preventDefault(); setShowClosed(false); }} data-testid="tab-plan-open">Open <span className="g-text-2 tabular-nums">{fmtNum(open.length)}</span></a>
            <a href="#closed" aria-current={showClosed ? "page" : undefined} onClick={(e) => { e.preventDefault(); setShowClosed(true); }} data-testid="tab-plan-closed">Done and dropped <span className="g-text-2 tabular-nums">{fmtNum(closedTotal)}</span></a>
          </nav>
          {kinds.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]" role="group" aria-label="Show only">
              {(["all", ...kinds] as const).map((k) => <button key={k} type="button" className="g-pill g-pill--sm" aria-pressed={kind === k} style={kind === k ? { background: "var(--g-hover)" } : undefined} onClick={() => setKind(k)} data-testid={`filter-plan-${k}`}>{k === "all" ? "Everything" : KIND[k]}</button>)}
            </div>
          )}
          {all.length === 0 ? (
            <Empty testId="plan-empty">
              <h3>Nothing in the plan yet</h3>
              <p>Wherever the SEO tools find something worth doing there is an <b>Add to plan</b> button: a keyword just off page one in <Link href={`/seo/explorer?domain=${encodeURIComponent(site.domain)}`} className="g-link">Opportunities</Link>, a site that stopped linking on <Link href="/seo/backlinks" className="g-link">Backlinks</Link>, an issue in the <Link href="/seo/audit" className="g-link">Site audit</Link>. Add it, work through the list, and tick things off here.</p>
            </Empty>
          ) : shown.length === 0 ? <Empty testId="plan-none">{showClosed ? "Nothing done or dropped yet." : kind === "all" ? "Nothing open — everything in the plan is done or dropped." : "Nothing open of this kind."}</Empty> : (
            <ul className="space-y-2" data-testid="list-plan">
              {shown.map((t) => (
                <li key={t.id} className="rounded-lg border p-3" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`task-${t.id}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="g-chip g-chip--sm">{KIND[t.kind]}</span>
                        {t.status !== "todo" && <span className="g-text-2 text-[12px]">{STATUS[t.status]}{t.status === "done" && t.doneAt ? ` ${fmtDate(t.doneAt)}` : ""}</span>}
                        <h2 className={`g-text text-[14px] font-medium ${t.status === "dropped" ? "line-through" : ""}`}>{t.title}</h2>
                      </div>
                      <p className="g-text-2 mt-1 text-[12px]">
                        {t.url ? <a href={t.url} className="g-link" target="_blank" rel="noreferrer">{t.url.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink className="inline h-3 w-3" aria-hidden /></a> : t.target}
                        {(t.url || t.target) && facts(t) ? " · " : ""}{facts(t)}{(t.url || t.target || facts(t)) ? " · " : ""}added {fmtDate(t.createdAt)}
                      </p>
                      {t.recheck && !t.resolved && <p className="g-text-2 mt-1 text-[12px]" data-testid={`task-recheck-${t.id}`}>{RECHECK[t.recheck]}</p>}
                      {t.resolved && <p className="mt-1 text-[13px]" style={{ color: "var(--g-green, #188038)" }} role="status" data-testid={`task-resolved-${t.id}`}>A crawl made after you added this{t.resolved.on ? ` (${fmtDate(t.resolved.on)})` : ""} re-checked it and no longer finds it{t.recheck === "failed" ? " — though a newer crawl since then failed" : ""}. <button type="button" className="g-link" disabled={change.isPending} onClick={() => set(t, "done")}>Mark it done</button></p>}
                      {noteFor === t.id ? (
                        <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); change.mutate({ siteId: site.id, id: t.id, patch: { note: note.trim() || null } }); }}>
                          <label className="min-w-0 flex-1"><span className="sr-only">Note for {t.title}</span><textarea className="g-input min-h-[64px] w-full py-2" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} autoFocus data-testid={`input-task-note-${t.id}`} /></label>
                          <div className="flex gap-2"><Button size="sm" type="submit" disabled={change.isPending}>Save note</Button><button type="button" className="g-pill g-pill--sm" onClick={() => setNoteFor(null)}>Cancel</button></div>
                        </form>
                      ) : t.note ? <p className="g-text mt-2 whitespace-pre-wrap text-[13px]" data-testid={`text-task-note-${t.id}`}>{t.note} <button type="button" className="g-link" onClick={() => { setNoteFor(t.id); setNote(t.note ?? ""); }} aria-label={`Edit the note on ${t.title}`}>Edit</button></p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.status === "todo" && <button type="button" className="g-pill g-pill--sm" disabled={change.isPending} onClick={() => set(t, "doing")} aria-label={`Start: ${t.title}`} data-testid={`button-task-start-${t.id}`}><Play /> Start</button>}
                      {(t.status === "todo" || t.status === "doing") && <button type="button" className="g-pill g-pill--sm" disabled={change.isPending} onClick={() => set(t, "done")} aria-label={`Mark done: ${t.title}`} data-testid={`button-task-done-${t.id}`}><Check /> Done</button>}
                      {(t.status === "todo" || t.status === "doing") && <button type="button" className="g-pill g-pill--sm" disabled={change.isPending} onClick={() => set(t, "dropped")} aria-label={`Drop: ${t.title}`}><X /> Drop</button>}
                      {(t.status === "done" || t.status === "dropped") && <button type="button" className="g-pill g-pill--sm" disabled={change.isPending} onClick={() => set(t, "todo")} aria-label={`Reopen: ${t.title}`} data-testid={`button-task-reopen-${t.id}`}><RotateCcw /> Reopen</button>}
                      {noteFor !== t.id && !t.note && <button type="button" className="g-pill g-pill--sm" onClick={() => { setNoteFor(t.id); setNote(""); }} aria-label={`Add a note to ${t.title}`} data-testid={`button-task-note-${t.id}`}>Note</button>}
                      <button type="button" className="g-pill g-pill--sm" disabled={remove.isPending} onClick={() => remove.mutate({ siteId: site.id, id: t.id })} aria-label={`Delete: ${t.title}`}><Trash2 /></button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showClosed && closedTotal > closed.length && <p className="g-text-2 mt-3 text-[13px]" data-testid="plan-more-closed">Showing the latest {fmtNum(closed.length)} of {fmtNum(closedTotal)}. <button type="button" className="g-link" disabled={q.isFetching} onClick={() => setClosedLimit((n) => Math.min(1000, n * 5))}>Show more</button></p>}
          <p className="g-text-2 mt-3 text-[12px]">The plan is yours to keep: nothing here spends SEO data. The numbers on a task are what they were when you added it — the screen it came from has today's.</p>
        </>
      )}
    </SeoShell>
  );
}
