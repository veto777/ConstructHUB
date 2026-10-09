/**
 * /seo/plan — Action plan: what you decided to do about what the SEO tools found, per site.
 * Findings arrive here from "Add to plan" on the Opportunities, Content gap, Link intersect,
 * Backlinks and Site audit screens; you can also write your own. Free (server/seo/tasks.ts).
 *
 * The list is the address (links.ts seoLinks.plan): ?status= open | todo | doing | overdue | done | dropped | closed,
 * ?kind= one kind of task, ?task= scrolls to and outlines one task; a chip says what narrowed the list. Every count
 * is a link to the tasks it counts, and every task carries a link back to the finding it came from (its stored
 * source: the audit issue, the lost link, the keyword, the mention).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, clearParams, Empty, fmtDate, fmtNum, HIGHLIGHT, SeoShell, TabStrip, useAddress, useScrollTo, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing, type SeoSite } from "./shell";
import { seoLinks, setParam } from "./links";
import { CARD, FOCUS_RING, LINK_CUE, LinkedFigure, MetricRow, QUIET_LINK, TAP_PAD, TEXT_LINK } from "./viz-more";

type Kind = "keyword" | "page" | "link_reclaim" | "link_prospect" | "audit" | "other";
type Status = "todo" | "doing" | "done" | "dropped";
type Counts = { todo: number; doing: number; done: number; dropped: number; doneRecently: number };
type Task = { recheck?: "none" | "unverifiable" | "not_rechecked" | "failed" | "later" | "unavailable"; id: number; kind: Kind; title: string; target: string | null; url: string | null; facts: Record<string, string | number | boolean | null>; source: string | null; status: Status; note: string | null; createdAt: string; doneAt: string | null; resolved?: { on: string | null }; dueOn?: string | null; owner?: string | null };
/** Today in the browser's own calendar ("2026-10-08"): due dates are calendar dates, read where the person is. */
/** A due date in words, with the year when it is not this year ("Oct 12", "Jan 5, 2027"). */
const dueWords = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localToday = () => ymd(new Date());
/** Seven days after today, in the browser's calendar: the end of "due soon". */
const localSoon = () => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d); };
type Data = { tasks: Task[]; counts: Counts; closedShown: number; closedMax?: number; max: number };
const RECHECK: Record<NonNullable<Task["recheck"]>, string> = {
  none: "Not rechecked since it was added — run a new crawl in Site audit to see whether it is fixed.",
  unverifiable: "This can't be checked automatically. Look in Site audit to see whether it is still listed.",
  not_rechecked: "The newest crawl did not run this check again on everything it was found on (a page not re-visited, a speed test that did not run, a check that only samples, or no Google profile attached), so it cannot say whether it is fixed.",
  later: "Not checked this time (there are many audit tasks); it will be when some are finished.",
  unavailable: "Couldn't read the crawls just now, so nothing can be said about this yet. Reload to try again.",
  failed: "The newest crawl failed, so this has not been rechecked.",
};

const KIND: Record<Kind, string> = { keyword: "Keyword", page: "New page", link_reclaim: "Win back a link", link_prospect: "Ask for a link", audit: "Site fix", other: "Other" };
const STATUS: Record<Status, string> = { doing: "In progress", todo: "To do", done: "Done", dropped: "Dropped" };
/** The lists ?status= can name, in the visitor's words. */
const STATUS_WORDS: Record<string, string> = { open: "Open tasks", todo: "To do", doing: "In progress", overdue: "Past their due date", done: "Done", dropped: "Dropped", closed: "Done and dropped" };
const CLOSED = new Set(["done", "dropped", "closed"]);
const OWN_PARAMS = ["task", "status", "kind", "due", "owner"];
/** A small chip that is a link: its own size, a 44 px tap area around it, the dotted underline and the focus ring. */
const CHIP_LINK = `g-chip g-chip--sm ${TAP_PAD} ${LINK_CUE} ${FOCUS_RING}`;
/** The facts carried from the finding, in words. */
function facts(t: Task): string {
  return factWords(t).join(" · ");
}
/** The same facts one by one, so each can be a link. */
function factWords(t: Task): string[] {
  const d = t.facts, out: string[] = [];
  if (typeof d.position === "number") out.push(`position ${d.position} when added`);
  if (typeof d.volume === "number") out.push(`${fmtNum(d.volume)} searches a month`);
  if (typeof d.authority === "number") out.push(`authority ${d.authority}`);
  if (typeof d.affected === "number") out.push(`${fmtNum(d.affected)} affected when added`);
  if (typeof d.lastSeen === "string") out.push(`link last seen ${fmtDate(d.lastSeen)}`);
  if (typeof d.linksTo === "string" && d.linksTo) out.push(`links to ${d.linksTo}`);
  return out;
}

/** Facts the one-line summary above already says, or that only the server uses. */
const SUMMARISED = new Set(["position", "volume", "authority", "affected", "lastSeen", "linksTo", "crawlId", "origin"]);
const FACT_LABEL: Record<string, string> = {
  severity: "Severity", crawlAt: "Crawl it came from", examples: "Found on", finding: "What was found", searches: "Searches", moreSearches: "More searches", overlap: "Results shared with the first search",
  basis: "What it rests on", checked: "Checked", where: "Where", notFound: "Searches your site was not found for", variants: "Possible address variants", checks: "Checks", latest: "Latest check", morePages: "More pages",
  moreOwnAddresses: "More of your addresses", linkTo: "Link to", words: "Words to link", context: "Where the words appear", crawled: "Crawled", answers: "Answers", questions: "Questions", device: "Device", location: "Place", period: "Period", latestCheck: "Latest check", changes: "Changes",
};
/** "page1Seen" → "Page 1 seen"; known names get their own wording. */
const factLabel = (k: string) => FACT_LABEL[k] ?? k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (_m, c: string) => ` ${c.toLowerCase()}`);
/** The rest of what a task was saved with — the evidence behind it — for a person to read. */
function evidence(t: Task): [string, string][] {
  return Object.entries(t.facts).filter(([k, v]) => !SUMMARISED.has(k) && v !== null && v !== "" && v !== false).map(([k, v]) => [factLabel(k), k === "crawlAt" && typeof v === "string" ? fmtDate(v) : String(v)]);
}

/**
 * Where a task came from, from the source it was saved with (the same string that keeps a finding from being added
 * twice): the audit issue, the lost link, the keyword, the mention, the AI source. A task with no known source has no
 * link here (its own address or target, when it has one, is shown as before).
 */
function origin(t: Task, site: SeoSite): { href: string; label: string } | null {
  // A source too long to store whole was cut to fit (plan-button.tsx fitTask); its whole words are kept in the facts.
  const s = typeof t.facts.origin === "string" && t.facts.origin ? t.facts.origin.replace(/…$/, "") : t.source ?? "";
  const after = (prefix: string) => s.slice(prefix.length);
  if (s.startsWith("audit:")) return { href: seoLinks.audit(site.id, { issue: after("audit:") }), label: "Open this issue in Site audit" };
  if (s.startsWith("lost:")) return { href: seoLinks.backlinks(site.id, { section: "lost", domain: after("lost:") }), label: "Open this lost link on Backlinks" };
  if (s.startsWith("kw:")) return { href: seoLinks.keywords(after("kw:")), label: "Open this keyword in Keywords explorer" };
  if (s.startsWith("gap:")) return { href: seoLinks.keywords(after("gap:")), label: "Open this keyword in Keywords explorer" };
  if (s.startsWith("area:") || s.startsWith("check:")) return { href: seoLinks.keywords(s.replace(/^[a-z]+:/, "")), label: "Open this keyword in Keywords explorer" };
  if (s.startsWith("competing:")) return { href: seoLinks.rankTracker(site.id, { panel: "competing" }), label: "Open the competing pages in the rank tracker" };
  if (s.startsWith("serp-group:")) { const d = s.split(":")[1]; return { href: seoLinks.rankTracker(site.id, { panel: "groups", device: d === "mobile" || d === "desktop" ? d : undefined }), label: "Open the search groups in the rank tracker" }; }
  if (s.startsWith("mention:")) return { href: seoLinks.mentions(site.id), label: "Open the mentions" };
  if (s.startsWith("ai-source:")) return { href: seoLinks.ai(site.id, { source: after("ai-source:") }), label: "Open the AI answers that drew on this website" };
  if (s.startsWith("dir:")) return { href: seoLinks.explorer(after("dir:")), label: "Open this directory in Site explorer" };
  if (s.startsWith("outgoing:")) return { href: seoLinks.audit(site.id, { tab: "outgoing" }), label: "Open the outgoing links in Site audit" };
  if (s.startsWith("link-pair:") || s.startsWith("link-opp:")) return { href: seoLinks.audit(site.id, { tab: "links" }), label: "Open the internal links in Site audit" };
  if (s.startsWith("prospect:")) return { href: seoLinks.explorer(after("prospect:")), label: `Open ${after("prospect:")} in Site explorer` };
  // "kw-page:<before>-<now>:<page>": the keyword watch's comparison of those two snapshots, opened on the Alerts page.
  if (s.startsWith("kw-page:")) { const m = /^kw-page:(\d+)-(\d+):/.exec(s); return m ? { href: seoLinks.alerts({ site: site.id, before: Number(m[1]), now: Number(m[2]) }), label: "Open this comparison in the keyword watch on Alerts" } : { href: seoLinks.alerts({ site: site.id }), label: "Open Alerts (the keyword watch is at the top)" }; }
  if (t.kind === "audit") return { href: seoLinks.audit(site.id), label: "Open Site audit" };
  if (t.kind === "link_reclaim") return { href: seoLinks.backlinks(site.id, { section: "lost" }), label: "Open the lost links on Backlinks" };
  return null;
}

export default function SeoPlanPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [closedLimit, setClosedLimit] = useState(100);
  const key = `/api/seo/sites/${site?.id}/tasks`;
  const q = useQuery<Data>({ queryKey: [key, closedLimit], queryFn: () => api("GET", `${key}?closed=${closedLimit}`), enabled: !!site });
  // The list shown is the address: which status, which kind, which task.
  const statusParam = params.get("status");
  const list = statusParam && STATUS_WORDS[statusParam] ? statusParam : "open";
  const showClosed = CLOSED.has(list);
  const kindParam = params.get("kind");
  const kind: Kind | "all" = kindParam && kindParam in KIND ? (kindParam as Kind) : "all";
  const taskParam = params.get("task");
  const taskId = Number(taskParam) || null;
  const dueParam = params.get("due"), dueSoon = dueParam === "soon";
  const ownerParam = params.get("owner")?.trim() || null;
  const [title, setTitle] = useState("");
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<Set<number>>(() => new Set());
  const [note, setNote] = useState("");
  // The due date and owner being edited, for one task at a time.
  const [planFor, setPlanFor] = useState<number | null>(null);
  const [dueDraft, setDueDraft] = useState(""), [ownerDraft, setOwnerDraft] = useState("");
  const refresh = (siteId: number) => { void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${siteId}/tasks`] }); void qc.invalidateQueries({ queryKey: ["/api/seo/dashboard"] }); };
  const add = useMutation({
    mutationFn: (v: { siteId: number; title: string }) => api("POST", `/api/seo/sites/${v.siteId}/tasks`, { tasks: [{ kind: "other", title: v.title }] }),
    onSuccess: (_d: unknown, v) => { setTitle(""); refresh(v.siteId); },
    onError: (e) => toast({ title: "Couldn't add that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const change = useMutation({
    mutationFn: (v: { siteId: number; id: number; patch: { status?: Status; note?: string | null; dueOn?: string | null; owner?: string | null } }) => api("POST", `/api/seo/tasks/${v.id}`, v.patch),
    onSuccess: (_d: unknown, v) => { if (v.patch.note !== undefined) setNoteFor(null); if (v.patch.dueOn !== undefined || v.patch.owner !== undefined) setPlanFor(null); refresh(v.siteId); },
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
  // Another site is another plan: the status, kind and task in the address belonged to the plan before.
  const changeSite = (id: number) => { clearParams(OWN_PARAMS); onSite(id); };
  useEffect(() => { setNoteFor(null); setClosedLimit(100); }, [site?.id]);
  // A kind that no longer applies (the last task of that kind gone) is dropped from the address, never left hiding everything.
  useEffect(() => { if (kind !== "all" && q.data && !kinds.includes(kind)) clearParams(["kind"]); }, [kinds, kind, q.data]);
  const counts = q.data?.counts;
  const closedTotal = counts ? counts.done + counts.dropped : closed.length;
  const today = localToday();
  // Open tasks: past their due date first (the earliest first), then by due date, then the ones with none (as before).
  const byDue = (a: Task, b: Task) => (a.dueOn ?? "9999") < (b.dueOn ?? "9999") ? -1 : (a.dueOn ?? "9999") > (b.dueOn ?? "9999") ? 1 : 0;
  const inList = (t: Task) => list === "open" ? t.status === "todo" || t.status === "doing" : list === "closed" ? t.status === "done" || t.status === "dropped" : list === "overdue" ? (t.status === "todo" || t.status === "doing") && !!t.dueOn && t.dueOn < today : t.status === list;
  const soon = localSoon();
  const sameOwner = (t: Task) => !ownerParam || (t.owner ?? "").trim().toLowerCase() === ownerParam.toLowerCase();
  const dueOk = (t: Task) => !dueSoon || (!!t.dueOn && t.dueOn >= today && t.dueOn <= soon);
  let shown = (showClosed ? closed : [...open].sort(byDue)).filter((t) => inList(t) && (kind === "all" || t.kind === kind) && sameOwner(t) && dueOk(t));
  // A task the address names that the narrowing hides is shown on its own, and the chip says so.
  const target = taskId ? all.find((t) => t.id === taskId) ?? null : null;
  const targetHidden = !!target && !shown.some((t) => t.id === target.id);
  if (target && targetHidden) shown = [target];
  const overdue = open.filter((t) => t.dueOn && t.dueOn < today).length;
  const set = (t: Task, s: Status) => site && change.mutate({ siteId: site.id, id: t.id, patch: { status: s } });
  useScrollTo(taskId ? `task-${taskId}` : null, !!q.data);
  // Every parameter the address names is said, also one that only repeats the default (?status=open).
  const chip = [
    list !== "open" || statusParam === "open" ? STATUS_WORDS[list] : "", statusParam && !STATUS_WORDS[statusParam] ? `"${statusParam}" — not a list here, showing the open tasks` : "",
    dueSoon ? `due today or in the next 7 days (${showClosed ? "of the open tasks only — none of these is open" : "your calendar"})` : dueParam !== null ? `due="${dueParam}" — not a due-date filter here (soon), so not applied` : "",
    ownerParam ? `${ownerParam}'s tasks` : "",
    taskParam !== null && !taskId ? `task "${taskParam}" — not a task number` : "",
    kind !== "all" ? KIND[kind] : "", kindParam && kind === "all" ? `"${kindParam}" — not a kind of task` : "",
    taskId ? (target ? `task #${taskId}${targetHidden ? " (shown on its own — it is not in that list)" : ""}` : q.data ? `task #${taskId} — not in this plan` : `task #${taskId}`) : "",
  ].filter(Boolean).join(" · ");
  const here = (p: { status?: string; kind?: string } = {}) => seoLinks.plan(site!.id, { status: p.status ?? (list === "open" ? undefined : list), kind: p.kind ?? (kind === "all" ? undefined : kind), due: dueSoon ? "soon" : undefined, owner: ownerParam ?? undefined });
  /** The evidence opened under each task (shown on request, so the links in it are real anchors once shown). */
  const toggleEvidence = (id: number) => setEvidenceOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <SeoShell title="Action plan" description="What you have decided to do about what the SEO tools found — and what is done." site={site} onSite={changeSite} sites={sites} status={status}>
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="plan-site-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
      {chip && site && <ActiveFilter onClear={() => clearParams(OWN_PARAMS, false)} clearLabel="All open tasks">{chip}</ActiveFilter>}
      {!site && sites.isSuccess && <Empty testId="plan-empty-sites"><h3>No sites yet</h3><p>Add your site above; findings you choose to act on are kept here for it.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading the plan…</p>}
      {site && q.isError && <div className="g-callout" role="alert"><h3>Couldn't load the plan</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && q.data && (
        <>
          {/* The plan's counts in one row (as the dashboard lays a site's figures out); each opens the tasks it counts. */}
          <div className="mb-4 rounded-xl border p-3 sm:p-4" style={CARD}>
            <MetricRow cols={overdue > 0 ? 5 : 4} testId="plan-summary">
              <LinkedFigure href={seoLinks.plan(site.id, { status: "todo" })} label="To do" value={fmtNum(counts?.todo ?? 0)} testId="tile-plan-todo" />
              <LinkedFigure href={seoLinks.plan(site.id, { status: "doing" })} label="In progress" value={fmtNum(counts?.doing ?? 0)} testId="tile-plan-doing" />
              <LinkedFigure href={seoLinks.plan(site.id, { status: "done" })} label="Done in the last 30 days" value={fmtNum(counts?.doneRecently ?? 0)} testId="tile-plan-done" foot="the done list has every one" />
              <LinkedFigure href={seoLinks.plan(site.id, { status: "done" })} label="Done in all" value={fmtNum(counts?.done ?? 0)} testId="tile-plan-total" />
              {overdue > 0 && <LinkedFigure href={seoLinks.plan(site.id, { status: "overdue" })} label="Past their due date" value={fmtNum(overdue)} testId="tile-plan-overdue" />}
            </MetricRow>
          </div>
          <form className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate({ siteId: site.id, title: title.trim() }); }} data-testid="form-plan-add">
            <label className="min-w-0 flex-1 sm:max-w-xl"><span className="sr-only">A task of your own</span>
              <input className="g-input w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task of your own — e.g. Ask the supplier to list us as an installer" data-testid="input-plan-title" />
            </label>
            <Button type="submit" disabled={!title.trim() || add.isPending} data-testid="button-plan-add"><Plus className="mr-1 h-4 w-4" /> Add</Button>
          </form>
          {/* The tabs and the kind pills are the address (?status= ?kind=): a link and a picked filter are the same thing. */}
          <TabStrip label="Tasks">
            <Link href={here({ status: "" })} aria-current={!showClosed ? "page" : undefined} data-testid="tab-plan-open">Open <span className="g-text-2 tabular-nums">{fmtNum(open.length)}</span></Link>
            <Link href={here({ status: "closed" })} aria-current={showClosed ? "page" : undefined} data-testid="tab-plan-closed">Done and dropped <span className="g-text-2 tabular-nums">{fmtNum(closedTotal)}</span></Link>
          </TabStrip>
          {kinds.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px]" role="group" aria-label="Show only">
              {(["all", ...kinds] as const).map((k) => <button key={k} type="button" className="g-pill g-pill--sm !min-h-11" aria-pressed={kind === k} style={kind === k ? { background: "var(--g-hover)" } : undefined} onClick={() => setParam("kind", k === "all" ? null : k)} data-testid={`filter-plan-${k}`}>{k === "all" ? "Everything" : KIND[k]}</button>)}
            </div>
          )}
          {all.length === 0 ? (
            <Empty testId="plan-empty">
              <h3>Nothing in the plan yet</h3>
              <p>Wherever the SEO tools find something worth doing there is an <b>Add to plan</b> button: a keyword just off page one in <Link href={seoLinks.explorer(site.domain, "keywords")} className={TEXT_LINK}>Opportunities</Link>, a site that stopped linking on <Link href={seoLinks.backlinks(site.id, { section: "lost" })} className={TEXT_LINK}>Backlinks</Link>, an issue in the <Link href={seoLinks.audit(site.id)} className={TEXT_LINK}>Site audit</Link>. Add it, work through the list, and tick things off here.</p>
            </Empty>
          ) : shown.length === 0 ? <Empty testId="plan-none">{ownerParam || dueSoon ? "No task in this list matches the narrowing above." : showClosed ? (list === "closed" ? "Nothing done or dropped yet." : `Nothing ${STATUS_WORDS[list].toLowerCase()}${kind !== "all" ? " of this kind" : ""}.`) : list === "overdue" ? "Nothing past its due date." : list !== "open" ? `Nothing ${STATUS_WORDS[list].toLowerCase()}${kind !== "all" ? " of this kind" : ""}.` : kind === "all" ? "Nothing open — everything in the plan is done or dropped." : "Nothing open of this kind."}</Empty> : (
            <ul className="space-y-2" data-testid="list-plan">
              {shown.map((t) => { const from = origin(t, site); return (
                <li key={t.id} id={`task-${t.id}`} className="scroll-mt-4 rounded-lg border p-3" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)", ...(taskId === t.id ? HIGHLIGHT : {}) }} data-testid={`task-${t.id}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={here({ kind: t.kind })} className={CHIP_LINK} title={`Only ${KIND[t.kind].toLowerCase()} tasks`} data-testid={`link-task-kind-${t.id}`}>{KIND[t.kind]}</Link>
                        {t.status !== "todo" && <Link href={seoLinks.plan(site.id, { status: t.status })} className={`${QUIET_LINK} g-text-2 text-[12px]`}>{STATUS[t.status]}{t.status === "done" && t.doneAt ? ` ${fmtDate(t.doneAt)}` : ""}</Link>}
                        <h2 className={`g-text text-[14px] font-medium ${t.status === "dropped" ? "line-through" : ""}`}><Link href={seoLinks.plan(site.id, { task: t.id, status: list === "open" ? undefined : list })} className={QUIET_LINK} data-testid={`link-task-${t.id}`}>{t.title}</Link></h2>
                        {t.dueOn && (t.status === "todo" || t.status === "doing") && <Link href={seoLinks.plan(site.id, { status: t.dueOn < today ? "overdue" : "open" })} className={CHIP_LINK} style={t.dueOn < today ? { color: "var(--g-red, #c5221f)" } : undefined} data-testid={`task-due-${t.id}`}>{t.dueOn < today ? `Overdue — was due ${dueWords(t.dueOn)}` : t.dueOn === today ? "Due today" : `Due ${dueWords(t.dueOn)}`}</Link>}
                        {t.owner && <span className="g-text-2 min-w-0 max-w-full text-[12px] [overflow-wrap:anywhere]" data-testid={`task-owner-${t.id}`}>· <Link href={seoLinks.plan(site.id, { owner: t.owner, status: list === "open" ? undefined : list })} className={QUIET_LINK} title={`Only ${t.owner}'s tasks`} data-testid={`link-task-owner-${t.id}`}>{t.owner}</Link></span>}
                      </div>
                      <p className="g-text-2 mt-1 text-[12px]">
                        {t.url ? <a href={t.url} className={TEXT_LINK} target="_blank" rel="noreferrer">{t.url.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink className="inline h-3 w-3" aria-hidden /></a> : t.target}
                        {/* The facts are as they were when the task was added; each opens the finding's screen, which has today's. */}
                        {(t.url || t.target) && facts(t) ? " · " : ""}{factWords(t).map((w, k) => <span key={k}>{k > 0 && " · "}{from ? <Link href={from.href} className={QUIET_LINK} title={`As it was when added — ${from.label.toLowerCase()} for today's`}>{w}</Link> : w}</span>)}{(t.url || t.target || facts(t)) ? " · " : ""}<Link href={seoLinks.plan(site.id, { task: t.id, status: list === "open" ? undefined : list })} className={QUIET_LINK}>added {fmtDate(t.createdAt)}</Link>
                        {from && <> · <Link href={from.href} className={TEXT_LINK} data-testid={`link-task-source-${t.id}`}>{from.label}</Link></>}
                      </p>
                      {evidence(t).length > 0 && (
                        <div className="mt-1 text-[12px]" data-testid={`task-evidence-${t.id}`}>
                          <button type="button" className={TEXT_LINK} aria-expanded={evidenceOpen.has(t.id)} onClick={() => toggleEvidence(t.id)} data-testid={`button-task-evidence-${t.id}`}>{evidenceOpen.has(t.id) ? "Hide what this is based on" : "What this is based on"}</button>
                          {evidenceOpen.has(t.id) && <>
                            <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-[max-content_1fr]">
                              {evidence(t).map(([k, v]) => <div key={k} className="contents"><dt className="g-text-2">{k}</dt><dd className="g-text break-words">{/^https?:\/\/\S+$/.test(v) ? <a href={v} className={`${TEXT_LINK} break-all`} target="_blank" rel="noreferrer">{v}</a> : v}</dd></div>)}
                            </dl>
                            <p className="g-text-2 mt-1">As it was when the task was added{t.kind === "audit" ? <> — <Link href={from?.href ?? seoLinks.audit(site.id)} className={TEXT_LINK}>open Site audit</Link> for the crawl as it is now</> : ""}.</p>
                          </>}
                        </div>
                      )}
                      {t.recheck && !t.resolved && <p className="g-text-2 mt-1 text-[12px]" data-testid={`task-recheck-${t.id}`}>{RECHECK[t.recheck]}</p>}
                      {t.resolved && <p className="mt-1 text-[13px]" style={{ color: "var(--g-green, #188038)" }} role="status" data-testid={`task-resolved-${t.id}`}>A crawl made after you added this{t.resolved.on ? <> (<Link href={from?.href ?? seoLinks.audit(site.id)} className={QUIET_LINK} style={{ color: "inherit" }} title="Site audit, on this issue">{fmtDate(t.resolved.on)}</Link>)</> : ""} ran this check again on everything it was found on and no longer finds it{t.recheck === "failed" ? " — though a newer crawl since then failed" : ""}. <button type="button" className={TEXT_LINK} disabled={change.isPending} onClick={() => set(t, "done")}>Mark it done</button></p>}
                      {planFor === t.id && (
                        <form className="mt-2 flex flex-wrap items-end gap-2 text-[13px]" onSubmit={(e) => { e.preventDefault(); change.mutate({ siteId: site.id, id: t.id, patch: { dueOn: dueDraft || null, owner: ownerDraft.trim() || null } }); }} data-testid={`form-task-plan-${t.id}`}>
                          <label className="flex flex-col"><span className="g-text-2 mb-0.5">Due by</span><input type="date" className="g-input" value={dueDraft} onChange={(e) => setDueDraft(e.target.value)} data-testid={`input-task-due-${t.id}`} /></label>
                          <label className="flex min-w-0 flex-col"><span className="g-text-2 mb-0.5">Who is doing it</span><input className="g-input w-48 max-w-full" value={ownerDraft} maxLength={60} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="e.g. Sam" data-testid={`input-task-owner-${t.id}`} /></label>
                          <Button size="sm" type="submit" disabled={change.isPending}>Save</Button>
                          <button type="button" className="g-pill g-pill--sm" onClick={() => setPlanFor(null)}>Cancel</button>
                        </form>
                      )}
                      {noteFor === t.id ? (
                        <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); change.mutate({ siteId: site.id, id: t.id, patch: { note: note.trim() || null } }); }}>
                          <label className="min-w-0 flex-1"><span className="sr-only">Note for {t.title}</span><textarea className="g-input min-h-[64px] w-full py-2" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} autoFocus data-testid={`input-task-note-${t.id}`} /></label>
                          <div className="flex gap-2"><Button size="sm" type="submit" disabled={change.isPending}>Save note</Button><button type="button" className="g-pill g-pill--sm" onClick={() => setNoteFor(null)}>Cancel</button></div>
                        </form>
                      ) : t.note ? <p className="g-text mt-2 whitespace-pre-wrap text-[13px]" data-testid={`text-task-note-${t.id}`}>{t.note} <button type="button" className={TEXT_LINK} onClick={() => { setNoteFor(t.id); setNote(t.note ?? ""); }} aria-label={`Edit the note on ${t.title}`}>Edit</button></p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.status === "todo" && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={change.isPending} onClick={() => set(t, "doing")} aria-label={`Start: ${t.title}`} data-testid={`button-task-start-${t.id}`}><Play /> Start</button>}
                      {(t.status === "todo" || t.status === "doing") && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={change.isPending} onClick={() => set(t, "done")} aria-label={`Mark done: ${t.title}`} data-testid={`button-task-done-${t.id}`}><Check /> Done</button>}
                      {(t.status === "todo" || t.status === "doing") && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={change.isPending} onClick={() => set(t, "dropped")} aria-label={`Drop: ${t.title}`}><X /> Drop</button>}
                      {(t.status === "done" || t.status === "dropped") && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={change.isPending} onClick={() => set(t, "todo")} aria-label={`Reopen: ${t.title}`} data-testid={`button-task-reopen-${t.id}`}><RotateCcw /> Reopen</button>}
                      {(t.status === "todo" || t.status === "doing") && planFor !== t.id && <button type="button" className="g-pill g-pill--sm !min-h-11" onClick={() => { setPlanFor(t.id); setDueDraft(t.dueOn ?? ""); setOwnerDraft(t.owner ?? ""); }} aria-label={`Due date and owner for ${t.title}`} data-testid={`button-task-plan-${t.id}`}>{t.dueOn || t.owner ? "Due / who" : "Set due date"}</button>}
                      {noteFor !== t.id && !t.note && <button type="button" className="g-pill g-pill--sm !min-h-11" onClick={() => { setNoteFor(t.id); setNote(""); }} aria-label={`Add a note to ${t.title}`} data-testid={`button-task-note-${t.id}`}>Note</button>}
                      <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={remove.isPending} onClick={() => remove.mutate({ siteId: site.id, id: t.id })} aria-label={`Delete: ${t.title}`}><Trash2 /></button>
                    </div>
                  </div>
                </li>
              ); })}
            </ul>
          )}
          {showClosed && closedTotal > closed.length && <p className="g-text-2 mt-3 text-[13px]" data-testid="plan-more-closed">Showing the latest <Link href={here({ status: "closed" })} className={QUIET_LINK}>{fmtNum(closed.length)}</Link> of <Link href={seoLinks.plan(site.id, { status: "closed" })} className={QUIET_LINK}>{fmtNum(closedTotal)}</Link>. {closed.length >= (q.data?.closedMax ?? 5000) ? `The page lists up to ${fmtNum(q.data?.closedMax ?? 5000)}; older ones are still counted above.` : <button type="button" className={TEXT_LINK} disabled={q.isFetching} onClick={() => setClosedLimit((n) => Math.min(q.data?.closedMax ?? 5000, Math.max(n * 5, n + 100)))}>Show more</button>}</p>}
          <p className="g-text-2 mt-3 text-[12px]">Due dates are read by your computer's calendar here; the emailed report counts by UTC and says so. The plan is yours to keep: nothing here spends SEO data. The numbers on a task are what they were when you added it — the screen it came from has today's.</p>
        </>
      )}
    </SeoShell>
  );
}
