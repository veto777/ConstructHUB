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
import { KeywordWatch } from "./keyword-watch";

type Kind = "rank_drop" | "rank_gain" | "links_lost" | "links_gained" | "grid_down" | "grid_up" | "kw_new" | "kw_lost";
type KwItem = { since: string; keywords: { keyword: string; position: number | null; volume: number | null; was?: number | null }[]; more?: number };
type GridItem = { keyword: string; size: number; spacing: number; top3: number; checked: number; score: number | null; wasTop3: number; wasChecked: number; wasScore: number | null; since: string };
type RankItem = { keyword: string; device: string; location: string | null; what: "dropped" | "lost" | "left_map_pack" | "improved" | "new" | "entered_map_pack"; from: number | null; to: number | null };
type LinkItem = { from: number | null; to: number | null; since: string; backlinksFrom: number | null; backlinksTo: number | null; lost?: { domain: string; authority: number | null; from: string | null }[]; lostTotal?: number | null; lostShown?: number };
type Alert = { id: number; siteId: number; domain: string; kind: Kind; title: string; items: (RankItem | LinkItem | GridItem)[]; readAt: string | null; createdAt: string };

const KIND: Record<Kind, { label: string; good: boolean }> = {
  rank_drop: { label: "Rankings fell", good: false }, rank_gain: { label: "Rankings improved", good: true },
  links_lost: { label: "Links lost", good: false }, links_gained: { label: "Links gained", good: true },
  grid_down: { label: "Local grid worse", good: false }, grid_up: { label: "Local grid better", good: true },
  kw_new: { label: "New searches", good: true }, kw_lost: { label: "Searches lost", good: false },
};
const FILTER_LABEL: Record<Kind, string> = { rank_drop: "Rankings fell", rank_gain: "Rankings improved", links_lost: "Links lost", links_gained: "Links gained", grid_down: "Local grid worse", grid_up: "Local grid better", kw_new: "New searches", kw_lost: "Searches lost" };
const WHAT: Record<RankItem["what"], (i: RankItem) => string> = {
  dropped: (i) => `fell from ${i.from} to ${i.to}`,
  lost: (i) => `dropped out of the results (was ${i.from})`,
  left_map_pack: (i) => `left the Google map pack (was ${i.from})`,
  improved: (i) => `rose from ${i.from} to ${i.to}`,
  new: (i) => `now ranks at ${i.to}`,
  entered_map_pack: (i) => `entered the Google map pack at ${i.to}`,
};

export default function SeoAlertsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scope, setScope] = useState<"site" | "all">("all");
  const [kind, setKind] = useState<Kind | "all">("all");
  const url = `/api/seo/alerts${scope === "site" && site ? `?siteId=${site.id}` : ""}`;
  const q = useQuery<{ alerts: Alert[]; unread: number }>({ queryKey: [url], refetchOnMount: "always", refetchInterval: 60_000 });
  const read = useMutation({
    mutationFn: (ids: number[] | null) => api("POST", "/api/seo/alerts/read", ids ? { ids } : {}),
    onSuccess: () => { void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith("/api/seo/alerts") }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't mark that as read", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const alerts = (q.data?.alerts ?? []).filter((a) => kind === "all" || a.kind === kind);
  const unread = q.data?.unread ?? 0;

  return (
    <SeoShell title="Alerts" description="What changed since the last check — rankings, the Google map pack and the sites that link to you." site={site} onSite={onSite} sites={sites} status={status}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="g-tabs !mb-0" aria-label="Which alerts">
          {(["all", "rank_drop", "rank_gain", "links_lost", "links_gained", "grid_down", "grid_up", "kw_new", "kw_lost"] as const).map((k) => <a key={k} href={`#${k}`} aria-current={kind === k ? "page" : undefined} onClick={(e) => { e.preventDefault(); setKind(k); }} data-testid={`tab-alerts-${k}`}>{k === "all" ? "All" : KIND[k].label}</a>)}
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

      {site && <KeywordWatch site={site} />}
      {q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…</p>}
      {q.isError && <div className="g-callout" role="alert" data-testid="alerts-error"><h3>Couldn't load your alerts</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {q.isSuccess && alerts.length === 0 && (
        <Empty testId="alerts-empty">
          <h3>{(q.data?.alerts.length ?? 0) > 0 ? "No alerts of this kind" : "No alerts yet"}</h3>
          <p>{(q.data?.alerts.length ?? 0) > 0 ? "Choose a different kind above." : "An alert appears here when a weekly rank check, a monthly backlink snapshot, a repeating local grid or the keyword watch finds a real change from the one before it. The first check of a keyword has nothing to compare with, so alerts start with the second."}</p>
        </Empty>
      )}
      <ul className="space-y-3" data-testid="list-alerts">
        {alerts.map((a) => (
          <li key={a.id} className="rounded-lg border p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={`alert-${a.id}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={`g-move ${KIND[a.kind].good ? "g-move--up" : "g-move--down"} text-[13px]`}>{KIND[a.kind].good ? "▲" : "▼"} {KIND[a.kind].label}</span>
              <h2 className="g-text text-[15px] font-medium">{a.title}</h2>
              {!a.readAt && <span className="g-chip g-chip--sm">New</span>}
              <span className="g-text-2 ml-auto text-[12px]">{fmtDate(a.createdAt)}</span>
              {!a.readAt && <button type="button" className="g-pill g-pill--sm" disabled={read.isPending} onClick={() => read.mutate([a.id])} aria-label={`Mark "${a.title}" as read`}>Mark read</button>}
            </div>
            {a.kind === "rank_drop" || a.kind === "rank_gain" ? (
              <table className="g-table mt-2">
                <thead><tr><th>Keyword</th><th>Where</th><th>Device</th><th>What happened</th></tr></thead>
                <tbody>{(a.items as RankItem[]).map((i, n) => <tr key={n}><td>{i.keyword}</td><td data-label="Where" className="g-text-2">{i.location ?? "United States"}</td><td data-label="Device" className="g-text-2 capitalize">{i.device}</td><td data-label="What happened">{WHAT[i.what]?.(i) ?? i.what}</td></tr>)}</tbody>
              </table>
            ) : a.kind === "kw_new" || a.kind === "kw_lost" ? (
              (a.items as unknown as KwItem[]).map((i, n) => (
                <div key={n}>
                  <p className="g-text-2 text-[13px]">Compared with the snapshot of {fmtDate(i.since)}.</p>
                  <table className="g-table mt-2">
                    <thead><tr><th>Keyword</th><th className="num">{a.kind === "kw_new" ? "Position now" : "Position before"}</th><th className="num">Volume / mo</th></tr></thead>
                    <tbody>{i.keywords.slice(0, 20).map((k) => <tr key={k.keyword}><td>{k.keyword}</td><td className="num">{(a.kind === "kw_new" ? k.position : k.was) ?? "—"}</td><td className="num">{fmtNum(k.volume)}</td></tr>)}</tbody>
                  </table>
                  {i.keywords.length + (i.more ?? 0) > 20 && <p className="g-text-2 mt-1 text-[12px]">…and {fmtNum(i.keywords.length + (i.more ?? 0) - 20)} more — the full list is in the keyword watch above.</p>}
                </div>
              ))
            ) : a.kind === "grid_down" || a.kind === "grid_up" ? (
              (a.items as GridItem[]).map((i, n) => <p key={n} className="g-text text-[13px]">"{i.keyword}", {i.size} × {i.size} points {i.spacing} mile{i.spacing === 1 ? "" : "s"} apart: in the first three local results at <b className="font-medium tabular-nums">{i.top3} of {i.checked}</b> points, was <b className="font-medium tabular-nums">{i.wasTop3} of {i.wasChecked}</b> on {fmtDate(i.since)}. Position score {i.score ?? "—"}, was {i.wasScore ?? "—"} (lower is better).</p>)
            ) : (
              (a.items as LinkItem[]).map((i, n) => <div key={n}><p className="g-text text-[13px]">Sites linking to {a.domain}: <b className="font-medium tabular-nums">{fmtNum(i.from)}</b> on {fmtDate(i.since)}, <b className="font-medium tabular-nums">{fmtNum(i.to)}</b> now{i.backlinksFrom != null && i.backlinksTo != null ? ` (total links ${fmtNum(i.backlinksFrom)} → ${fmtNum(i.backlinksTo)})` : ""}.</p>{(i.lost?.length ?? 0) > 0 && <ul className="g-text mt-1 list-disc pl-5 text-[13px]" aria-label="Sites a link was lost from">{i.lost!.map((l, k) => <li key={k}>{l.domain}{l.authority != null ? <span className="g-text-2"> · authority {l.authority}</span> : null}{l.from ? <> · <a href={l.from} className="g-link" target="_blank" rel="noreferrer">the page that linked</a></> : null}</li>)}{i.lostTotal != null && i.lostTotal > i.lost!.length ? <li className="g-text-2 list-none">{fmtNum(i.lostTotal)} sites had a lost link in all; the Backlinks page keeps the 25 strongest.</li> : null}</ul>}</div>)
            )}
            <p className="mt-2 text-[13px]">
              <Link href={a.kind.startsWith("rank") ? "/seo/rank-tracker" : a.kind.startsWith("grid") ? "/seo/local-grid" : a.kind.startsWith("kw") ? `/seo/explorer?domain=${encodeURIComponent(a.domain)}` : "/seo/backlinks"} className="g-link" onClick={() => onSite(a.siteId)}>{a.kind.startsWith("rank") ? "Open the rank tracker" : a.kind.startsWith("grid") ? "Open the local grid" : a.kind.startsWith("kw") ? "Open Site explorer" : "Open backlinks"} for {a.domain}</Link>
            </p>
          </li>
        ))}
      </ul>
    </SeoShell>
  );
}
