/**
 * /seo/alerts — what changed since the last check: rankings that fell or rose,
 * the Google map pack entered or left, linking sites lost or gained. Read from
 * saved alerts (GET /api/seo/alerts); opening this page costs nothing. The same
 * alerts reach the bell, and email when that is switched on in Settings.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { api, Empty, fmtDate, fmtNum, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { KeywordWatch, type KwPick } from "./keyword-watch";
import { marketLabel } from "@shared/seo-markets";
import { BLUE_WORDS } from "./viz-more";

type Kind = "rank_drop" | "rank_gain" | "links_lost" | "links_gained" | "grid_down" | "grid_up" | "kw_new" | "kw_lost" | "mention_new";
type MentionItem = { checkId: number; name: string; since: string; takenOn: string; linksChecked?: boolean; pages: { domain: string; url: string; title: string; place: string | null; confirmed: boolean; linksToYou: boolean | null }[]; more?: number };
type KwItem = { since: string; takenOn?: string; snapshotId?: number; beforeId?: number; locationCode?: number; languageCode?: string; keywords: { keyword: string; position: number | null; volume: number | null; was?: number | null }[]; more?: number };
type GridItem = { keyword: string; size: number; spacing: number; top3: number; checked: number; score: number | null; wasTop3: number; wasChecked: number; wasScore: number | null; since: string };
type RankItem = { keyword: string; device: string; location: string | null; what: "dropped" | "lost" | "left_map_pack" | "improved" | "new" | "entered_map_pack"; from: number | null; to: number | null; /** The two days compared (older alerts have none). */ since?: string | null; on?: string | null };
type LinkItem = { from: number | null; to: number | null; since: string; backlinksFrom: number | null; backlinksTo: number | null; lost?: { domain: string; authority: number | null; from: string | null }[]; lostTotal?: number | null; lostShown?: number };
type Alert = { id: number; siteId: number; domain: string; kind: Kind; title: string; items: (RankItem | LinkItem | GridItem)[]; readAt: string | null; createdAt: string; /** Its delivery (bell / email) was given up after repeated tries. */ notSent?: boolean; /** The bell entry went out; the email did not, after its tries. */ emailFailed?: boolean };
/** One page of alerts (GET /api/seo/alerts): filtered by kind on the server, with the counts the wording rests on. */
type AlertPage = { alerts: Alert[]; hasMore: boolean; pageSize: number; /** Of the kind chosen, within the scope. */ total: number; /** Of every kind, within the scope. */ totalAll: number; unread: number; /** Deliveries given up (those alerts are marked). */ undelivered: number };
/** Rank rows shown before "Show all" (every movement is kept with the alert; none is cut). */
const RANK_ROWS = 25;

const KIND: Record<Kind, { label: string; good: boolean }> = {
  rank_drop: { label: "Rankings fell", good: false }, rank_gain: { label: "Rankings improved", good: true },
  links_lost: { label: "Links lost", good: false }, links_gained: { label: "Links gained", good: true },
  grid_down: { label: "Local grid worse", good: false }, grid_up: { label: "Local grid better", good: true },
  kw_new: { label: "Searches newly seen", good: true }, kw_lost: { label: "Searches no longer seen", good: false },
  mention_new: { label: "New mentions", good: true },
};
const FILTER_LABEL: Record<Kind, string> = { rank_drop: "Rankings fell", rank_gain: "Rankings improved", links_lost: "Links lost", links_gained: "Links gained", grid_down: "Local grid worse", grid_up: "Local grid better", kw_new: "Newly seen", kw_lost: "No longer seen", mention_new: "New mentions" };
const WHAT: Record<RankItem["what"], (i: RankItem) => string> = {
  dropped: (i) => `fell from ${i.from} to ${i.to}`,
  lost: (i) => `no longer found in the results (was ${i.from})`,
  left_map_pack: (i) => `left the Google map pack (was ${i.from})`,
  improved: (i) => `rose from ${i.from} to ${i.to}`,
  new: (i) => `now ranks at ${i.to}`,
  entered_map_pack: (i) => `entered the Google map pack at ${i.to}`,
};

/** One keyword-watch alert: what it compared, and every keyword the alert kept (the first twenty until asked for the rest). */
function KwAlert({ kind, item: i, domain, onOpen }: { kind: Kind; item: KwItem; domain: string; /** Open the exact comparison this alert was raised from in the keyword watch. */ onOpen?: () => void }) {
  const [all, setAll] = useState(false);
  const kept = i.keywords.length, more = i.more ?? 0, shown = all ? i.keywords : i.keywords.slice(0, 20);
  return (
    <div>
      <p className="g-text-2 text-[13px]">In our search data{i.locationCode ? ` for ${marketLabel(i.locationCode, i.languageCode ?? "en")}` : ""}: the snapshot of {i.takenOn ? fmtDate(i.takenOn) : "that day"} compared with the one of {fmtDate(i.since)}. It is the data's view, not Google's own — track a search in the rank tracker to check Google itself.</p>
      <table className="g-table mt-2">
        <thead><tr><th>Keyword</th><th className="num">{kind === "kw_new" ? "Position then" : "Position before"}</th><th className="num">Volume / mo</th></tr></thead>
        <tbody>{shown.map((k) => <tr key={k.keyword}><td>{k.keyword}</td><td className="num" data-label={kind === "kw_new" ? "Position then" : "Position before"}>{(kind === "kw_new" ? k.position : k.was) ?? "—"}</td><td className="num" data-label="Volume / mo">{fmtNum(k.volume)}</td></tr>)}</tbody>
      </table>
      {kept > 20 && <button type="button" className="g-link mt-1 text-[13px]" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show the first 20" : `Show all ${fmtNum(kept)} kept with this alert`}</button>}
      {more > 0 && <p className="g-text-2 mt-1 text-[12px]">{fmtNum(more)} more changed than this alert keeps — the comparison lists every one.</p>}
      {onOpen && <button type="button" className="g-link mt-1 text-[13px]" onClick={onOpen} data-testid="button-kw-alert-open">Open this comparison for {domain} (snapshots of {fmtDate(i.since)} and {i.takenOn ? fmtDate(i.takenOn) : "that day"})</button>}
    </div>
  );
}

/** The movements of one rank alert: every one the alert holds, the first RANK_ROWS until asked for the rest. */
function RankRows({ items }: { items: RankItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, RANK_ROWS);
  return (
    <>
      <table className="g-table mt-2">
        <thead><tr><th>Keyword</th><th>Where</th><th>Device</th><th>What happened</th></tr></thead>
        <tbody>{shown.map((i, n) => <tr key={n}><td>{i.keyword}</td><td data-label="Where" className="g-text-2">{i.location ?? "United States"}</td><td data-label="Device" className="g-text-2 capitalize">{i.device}</td><td data-label="What happened">{WHAT[i.what]?.(i) ?? i.what}{i.since && i.on ? <span className="g-text-2"> · {fmtDate(i.since)} → {fmtDate(i.on)}</span> : null}</td></tr>)}</tbody>
      </table>
      {items.length > RANK_ROWS && <button type="button" className="g-link mt-1 text-[13px]" aria-expanded={all} onClick={() => setAll(!all)} data-testid="button-rank-alert-all">{all ? `Show the first ${RANK_ROWS}` : `Show all ${fmtNum(items.length)} movements`}</button>}
    </>
  );
}

export default function SeoAlertsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const [kwPick, setKwPick] = useState<KwPick | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scope, setScope] = useState<"site" | "all">("all");
  const [kind, setKind] = useState<Kind | "all">("all");
  // The site and the kind go to the server: it filters before it cuts the page, so an empty page means there are none.
  const params = new URLSearchParams();
  if (scope === "site" && site) params.set("siteId", String(site.id));
  if (kind !== "all") params.set("kind", kind);
  const qs = params.toString();
  const url = `/api/seo/alerts${qs ? `?${qs}` : ""}`;
  const q = useQuery<AlertPage>({ queryKey: [url], refetchOnMount: "always", refetchInterval: 60_000 });
  // Older pages ("Show more") sit after the live first page; they belong to one filter and go when it changes.
  const [older, setOlder] = useState<{ url: string; alerts: Alert[]; hasMore: boolean }>({ url, alerts: [], hasMore: false });
  const more = useMutation({
    mutationFn: (before: number) => api("GET", `${url}${qs ? "&" : "?"}before=${before}`) as Promise<AlertPage>,
    onSuccess: (p) => setOlder((o) => ({ url, alerts: [...(o.url === url ? o.alerts : []), ...p.alerts], hasMore: p.hasMore })),
    onError: (e) => toast({ title: "Couldn't load more alerts", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const read = useMutation({
    mutationFn: (ids: number[] | null) => api("POST", "/api/seo/alerts/read", ids ? { ids } : {}),
    onSuccess: (_d, ids) => {
      void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith("/api/seo/alerts") }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      // The older pages are not fetched again: they are marked here.
      setOlder((o) => ({ ...o, alerts: o.alerts.map((a) => (!ids || ids.includes(a.id)) && !a.readAt ? { ...a, readAt: new Date().toISOString() } : a) }));
    },
    onError: (e) => toast({ title: "Couldn't mark that as read", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const extra = older.url === url ? older.alerts : [];
  const seen = new Set<number>();
  const alerts = [...(q.data?.alerts ?? []), ...extra].filter((a) => !seen.has(a.id) && (seen.add(a.id), true));
  const hasMore = extra.length ? older.hasMore : (q.data?.hasMore ?? false);
  const unread = q.data?.unread ?? 0;
  const total = q.data?.total ?? 0, undelivered = q.data?.undelivered ?? 0;

  return (
    <SeoShell title="Alerts" description="What changed since the last check — rankings, the Google map pack and the sites that link to you." site={site} onSite={onSite} sites={sites} status={status}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="g-tabs !mb-0" aria-label="Which alerts">
          {(["all", "rank_drop", "rank_gain", "links_lost", "links_gained", "grid_down", "grid_up", "kw_new", "kw_lost", "mention_new"] as const).map((k) => <a key={k} href={`#${k}`} aria-current={kind === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setKind(k); }} data-testid={`tab-alerts-${k}`}>{k === "all" ? "All" : KIND[k].label}</a>)}
        </nav>
        {site && (
          <label className="flex items-center gap-2 text-[13px]"><span className="g-text-2">Show</span>
            <select className="g-select" value={scope} onChange={(e) => setScope(e.target.value as "site" | "all")} data-testid="select-alerts-scope">
              <option value="all">All my sites</option><option value="site">{site.domain} only</option>
            </select>
          </label>
        )}
        <button type="button" className="g-pill g-pill--sm ml-auto" disabled={!unread || read.isPending} onClick={() => read.mutate(null)} data-testid="button-alerts-read-all"><Check /> Mark all read{unread ? ` (${fmtNum(unread)})` : ""}</button>
      </div>
      <p className="g-text-2 mb-4 text-[13px]">Alerts also reach the bell at the top of the page, and your inbox for falls and lost links. Choose what is emailed under <Link href="/settings?tab=notifications" className="g-link">Settings → Notifications</Link>; set how big a move counts under <Link href="/seo/rank-tracker" className="g-link">Rank tracker → Tracking settings</Link>.</p>

      {site && <div id="keyword-watch" className="scroll-mt-4"><KeywordWatch site={site} pick={kwPick} onPick={setKwPick} /></div>}
      {q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…</p>}
      {q.isError && <div className="g-callout" role="alert" data-testid="alerts-error"><h3>Couldn't load your alerts</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {q.isSuccess && undelivered > 0 && (
        <div className="g-callout mb-4" role="status" data-testid="alerts-undelivered">
          <h3>{fmtNum(undelivered)} alert{undelivered === 1 ? "" : "s"} could not be sent</h3>
          <p>The bell or email delivery failed again and again, so it was given up. {undelivered === 1 ? "The alert is" : "They are"} kept here, marked "Not sent".</p>
        </div>
      )}
      {q.isSuccess && alerts.length === 0 && (
        <Empty testId="alerts-empty">
          <h3>{(q.data?.totalAll ?? 0) > 0 ? "No alerts of this kind" : scope === "site" && site ? `No alerts for ${site.domain} yet` : "No alerts yet"}</h3>
          <p>{(q.data?.totalAll ?? 0) > 0 ? "Choose a different kind above." : "An alert appears here when a weekly rank check, a monthly backlink snapshot, a repeating local grid or the keyword watch finds a change in the saved data, compared with the one before it, that is big enough to qualify. The first check of a keyword has nothing to compare with, so alerts start with the second."}</p>
        </Empty>
      )}
      {q.isSuccess && alerts.length > 0 && <p className="g-text-2 mb-2 text-[13px]" data-testid="alerts-count">Showing {fmtNum(alerts.length)} of {fmtNum(total)} alert{total === 1 ? "" : "s"}{kind !== "all" ? ` of this kind` : ""}{scope === "site" && site ? ` for ${site.domain}` : ""}, newest first.</p>}
      <ul className="space-y-3" data-testid="list-alerts">
        {alerts.map((a) => (
          <li key={a.id} className="min-w-0 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`alert-${a.id}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {/* The kind keeps its green / red: better or worse is exactly what it says. The title is blue like every heading. */}
              <span className={`g-move ${KIND[a.kind].good ? "g-move--up" : "g-move--down"} text-[13px]`}>{KIND[a.kind].good ? "▲" : "▼"} {KIND[a.kind].label}</span>
              <h2 className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]" style={BLUE_WORDS}>{a.title}</h2>
              {!a.readAt && <span className="g-chip g-chip--sm">New</span>}
              {a.notSent && <span className="g-chip g-chip--sm" title="Sending it to the bell or by email failed again and again, so it was given up. It is kept here.">Not sent</span>}
              {!a.notSent && a.emailFailed && <span className="g-chip g-chip--sm" title="The bell entry went out; the email failed every time it was tried.">Email not sent</span>}
              <span className="g-text-2 ml-auto text-[12px]">{fmtDate(a.createdAt)}</span>
              {!a.readAt && <button type="button" className="g-pill g-pill--sm" disabled={read.isPending} onClick={() => read.mutate([a.id])} aria-label={`Mark "${a.title}" as read`}>Mark read</button>}
            </div>
            {a.kind === "rank_drop" || a.kind === "rank_gain" ? (
              <RankRows items={a.items as RankItem[]} />
            ) : a.kind === "mention_new" ? (
              (a.items as unknown as MentionItem[]).map((i, n) => (
                <div key={n}>
                  <p className="g-text-2 text-[13px]">Pages published since {fmtDate(i.since)} that use "{i.name}", likely you — {i.pages.some((p) => p.confirmed) ? "a website you confirmed, or " : ""}naming one of your places. Check each one before asking for a link.{i.linksChecked === false ? " Whether their websites link to you could not be checked." : ""}</p>
                  <ul className="mt-1 space-y-1 text-[13px]" aria-label="New pages that mention you">
                    {i.pages.map((p) => <li key={p.url}><a href={p.url} className="g-link" target="_blank" rel="noreferrer">{p.domain}</a><span className="g-text-2"> — {p.title}{p.confirmed ? " · you confirmed this website" : p.place ? ` · names ${p.place}` : ""}{p.linksToYou === null ? " · link not known" : ""}</span></li>)}
                  </ul>
                  {(i.more ?? 0) > 0 && <p className="g-text-2 mt-1 text-[12px]">{fmtNum(i.more!)} more than this alert keeps.</p>}
                </div>
              ))
            ) : a.kind === "kw_new" || a.kind === "kw_lost" ? (
              (a.items as unknown as KwItem[]).map((i, n) => <KwAlert key={n} kind={a.kind} item={i} domain={a.domain} onOpen={i.snapshotId && i.beforeId ? () => { onSite(a.siteId); setKwPick({ siteId: a.siteId, now: i.snapshotId!, before: i.beforeId!, fromAlert: Date.now() }); requestAnimationFrame(() => document.getElementById("keyword-watch")?.scrollIntoView({ behavior: "smooth", block: "start" })); } : undefined} />)
            ) : a.kind === "grid_down" || a.kind === "grid_up" ? (
              (a.items as GridItem[]).map((i, n) => <p key={n} className="g-text text-[13px]">"{i.keyword}", {i.size} × {i.size} points {i.spacing} mile{i.spacing === 1 ? "" : "s"} apart: in the first three local results at <b className="font-medium tabular-nums">{i.top3} of {i.checked}</b> points, was <b className="font-medium tabular-nums">{i.wasTop3} of {i.wasChecked}</b> on {fmtDate(i.since)}. Position score {i.score ?? "—"}, was {i.wasScore ?? "—"} (lower is better).</p>)
            ) : (
              (a.items as LinkItem[]).map((i, n) => <div key={n}><p className="g-text text-[13px]">Sites linking to {a.domain}: <b className="font-medium tabular-nums">{fmtNum(i.from)}</b> on {fmtDate(i.since)}, <b className="font-medium tabular-nums">{fmtNum(i.to)}</b> now{i.backlinksFrom != null && i.backlinksTo != null ? ` (total links ${fmtNum(i.backlinksFrom)} → ${fmtNum(i.backlinksTo)})` : ""}.</p>{(i.lost?.length ?? 0) > 0 && <ul className="g-text mt-1 list-disc pl-5 text-[13px]" aria-label="Sites a link was lost from">{i.lost!.map((l, k) => <li key={k}>{l.domain}{l.authority != null ? <span className="g-text-2"> · authority {l.authority}</span> : null}{l.from ? <> · <a href={l.from} className="g-link" target="_blank" rel="noreferrer">the page that linked</a></> : null}</li>)}{i.lostTotal != null && i.lostTotal > i.lost!.length ? <li className="g-text-2 list-none">{fmtNum(i.lostTotal)} sites had a lost link in all; the Backlinks page keeps the 25 strongest.</li> : null}</ul>}</div>)
            )}
            <p className="mt-2 text-[13px]">
              <Link href={a.kind.startsWith("rank") ? "/seo/rank-tracker" : a.kind.startsWith("grid") ? "/seo/local-grid" : a.kind === "mention_new" ? `/seo/mentions?site=${a.siteId}${(a.items as unknown as MentionItem[])[0]?.checkId ? `&check=${(a.items as unknown as MentionItem[])[0].checkId}` : ""}` : a.kind.startsWith("kw") ? `/seo/explorer?domain=${encodeURIComponent(a.domain)}` : "/seo/backlinks"} className="g-link" onClick={() => onSite(a.siteId)}>{a.kind.startsWith("rank") ? "Open the rank tracker" : a.kind.startsWith("grid") ? "Open the local grid" : a.kind === "mention_new" ? "Open the mentions" : a.kind.startsWith("kw") ? "Open Site explorer" : "Open backlinks"} for {a.domain}</Link>
            </p>
          </li>
        ))}
      </ul>
      {q.isSuccess && hasMore && alerts.length > 0 && (
        <p className="mt-4"><button type="button" className="g-pill" disabled={more.isPending} onClick={() => more.mutate(alerts[alerts.length - 1].id)} data-testid="button-alerts-more">{more.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : `Show more (${fmtNum(Math.max(0, total - alerts.length))} older)`}</button></p>
      )}
    </SeoShell>
  );
}
