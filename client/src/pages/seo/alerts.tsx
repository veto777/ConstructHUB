/**
 * /seo/alerts — what changed since the last check: rankings that fell or rose,
 * the Google map pack entered or left, linking sites lost or gained. Read from
 * saved alerts (GET /api/seo/alerts); opening this page costs nothing. The same
 * alerts reach the bell, and email when that is switched on in Settings.
 *
 * The kind and the site are the address (links.ts seoLinks.alerts: ?kind= ?site=), so the kind tabs and the scope
 * picker are links and the back button undoes them; a chip says what narrowed the list. Every alert, and every keyword,
 * site or scan in it, opens the thing it is about: a rank move opens that keyword in the rank tracker, a lost link the
 * site it came from on Backlinks, a grid move that scan on the local grid, a mention its check on Mentions. A keyword
 * alert's "Open this comparison" is a link too (?now= ?before=): the keyword watch on this page reads the pair from
 * the address (keyword-watch.tsx), with its list (?watch=) and "show all" (?watchAll=).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ActiveFilter, api, clearParams, Empty, fmtDate, fmtNum, SeoShell, useAddress, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing } from "./shell";
import { seoLinks, setParam, setParams } from "./links";
import { KeywordWatch, type KwPick } from "./keyword-watch";
import { marketLabel } from "@shared/seo-markets";
import { BLUE_WORDS, FIGURE_LINK, FOCUS_RING, LINK_CUE, QUIET_LINK, TAP_PAD, TEXT_LINK } from "./viz-more";
import { HIGHLIGHT, TabStrip, useScrollTo } from "./shell";

type Kind = "rank_drop" | "rank_gain" | "links_lost" | "links_gained" | "grid_down" | "grid_up" | "kw_new" | "kw_lost" | "mention_new";
type MentionItem = { checkId: number; name: string; since: string; takenOn: string; linksChecked?: boolean; pages: { domain: string; url: string; title: string; place: string | null; confirmed: boolean; linksToYou: boolean | null }[]; more?: number };
type KwItem = { since: string; takenOn?: string; snapshotId?: number; beforeId?: number; locationCode?: number; languageCode?: string; keywords: { keyword: string; position: number | null; volume: number | null; was?: number | null }[]; more?: number };
type GridItem = { keyword: string; size: number; spacing: number; /** The scan the alert was raised from (older alerts have none). */ scanId?: number; /** The earlier scan it was compared with (newer alerts only). */ wasScanId?: number; top3: number; checked: number; score: number | null; wasTop3: number; wasChecked: number; wasScore: number | null; since: string };
type RankItem = { keyword: string; device: string; location: string | null; what: "dropped" | "lost" | "left_map_pack" | "improved" | "new" | "entered_map_pack"; from: number | null; to: number | null; /** The two days compared (older alerts have none). */ since?: string | null; on?: string | null };
type LinkItem = { from: number | null; to: number | null; since: string; backlinksFrom: number | null; backlinksTo: number | null; lost?: { domain: string; authority: number | null; from: string | null }[]; lostTotal?: number | null; lostShown?: number };
type Alert = { id: number; siteId: number; domain: string; kind: Kind; title: string; items: (RankItem | LinkItem | GridItem)[]; readAt: string | null; createdAt: string; /** Its delivery (bell / email) was given up after repeated tries. */ notSent?: boolean; /** The bell entry went out; the email did not, after its tries. */ emailFailed?: boolean };
/** One page of alerts (GET /api/seo/alerts): filtered by kind on the server, with the counts the wording rests on. */
type AlertPage = { alerts: Alert[]; hasMore: boolean; pageSize: number; /** Of the kind chosen, within the scope. */ total: number; /** Of every kind, within the scope. */ totalAll: number; unread: number; /** Deliveries given up (those alerts are marked). */ undelivered: number };
/** Rank rows shown before "Show all" (every movement is kept with the alert; none is cut). */
const RANK_ROWS = 25;
const KINDS = ["rank_drop", "rank_gain", "links_lost", "links_gained", "grid_down", "grid_up", "kw_new", "kw_lost", "mention_new"] as const;

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
const device = (d: string) => (d === "mobile" || d === "desktop" ? d : undefined);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : undefined);

/**
 * Where an alert as a whole leads: the thing it is about, narrowed to what changed. A grid or mention alert opens its
 * scan / check only when it holds one; with several, the page that lists them — each item carries its own link.
 */
function alertTarget(a: Alert): { href: string; label: string } {
  if (a.kind === "rank_drop" || a.kind === "rank_gain") return { href: seoLinks.rankTracker(a.siteId, { move: a.kind === "rank_drop" ? "down" : "up" }), label: "Open these keywords in the rank tracker" };
  if (a.kind === "grid_down" || a.kind === "grid_up") { const items = a.items as GridItem[], g = items.length === 1 ? items[0] : undefined; return { href: seoLinks.localGrid(a.siteId, g?.scanId ? { scan: g.scanId, show: "top3" } : {}), label: g?.scanId ? "Open this scan on the local grid" : items.length > 1 ? "Open the local grid (each search above opens its own scan)" : "Open the local grid" }; }
  if (a.kind === "mention_new") { const items = a.items as unknown as MentionItem[], m = items.length === 1 ? items[0] : undefined; return { href: seoLinks.mentions(a.siteId, m?.checkId ? { check: m.checkId } : {}), label: m?.checkId ? "Open this check on Mentions" : items.length > 1 ? "Open the mentions (each check above opens on its own)" : "Open the mentions" }; }
  if (a.kind === "kw_new" || a.kind === "kw_lost") return { href: seoLinks.explorer(a.domain, "keywords"), label: "Open the keywords in Site explorer" };
  return { href: seoLinks.backlinks(a.siteId, { section: a.kind === "links_lost" ? "lost" : "new" }), label: a.kind === "links_lost" ? "Open the lost links on Backlinks" : "Open the new links on Backlinks" };
}

/** One keyword-watch alert: what it compared, and every keyword the alert kept (the first twenty until asked for the rest). */
function KwAlert({ kind, item: i, domain, openHref, onOpen }: { kind: Kind; item: KwItem; domain: string; /** The exact comparison this alert was raised from, in the keyword watch on this page (seoLinks.alerts now/before). */ openHref?: string; /** Told when it is opened, so focus moves to the comparison once it has loaded. */ onOpen?: () => void }) {
  const [all, setAll] = useState(false);
  const kept = i.keywords.length, more = i.more ?? 0, shown = all ? i.keywords : i.keywords.slice(0, 20);
  return (
    <div>
      <p className="g-text-2 text-[13px]">In our search data{i.locationCode ? ` for ${marketLabel(i.locationCode, i.languageCode ?? "en")}` : ""}: the snapshot of {openHref ? <Link href={openHref} className={QUIET_LINK}>{i.takenOn ? fmtDate(i.takenOn) : "that day"}</Link> : i.takenOn ? fmtDate(i.takenOn) : "that day"} compared with the one of {openHref ? <Link href={openHref} className={QUIET_LINK}>{fmtDate(i.since)}</Link> : fmtDate(i.since)}. It is the data's view, not Google's own — track a search in the rank tracker to check Google itself.</p>
      {/* Each search opens in Keywords explorer (these are the data's searches, not tracked keywords). */}
      <table className="g-table mt-2">
        <thead><tr><th>Keyword</th><th className="num">{kind === "kw_new" ? "Position then" : "Position before"}</th><th className="num">Volume / mo</th></tr></thead>
        <tbody>{shown.map((k) => { const market = i.locationCode && i.locationCode !== 2840 ? { locationCode: i.locationCode } : {}; return <tr key={k.keyword}><td><Link href={seoLinks.keywords(k.keyword, { ...market, ...(i.locationCode && i.locationCode !== 2840 ? { languageCode: i.languageCode } : {}) })} className={TEXT_LINK}>{k.keyword}</Link></td><td className="num" data-label={kind === "kw_new" ? "Position then" : "Position before"}><Link href={seoLinks.explorer(domain, "keywords", { contains: k.keyword, ...market })} className={FIGURE_LINK} title={`${domain}'s keywords in Site explorer, narrowed to this one`}>{(kind === "kw_new" ? k.position : k.was) ?? "—"}</Link></td><td className="num" data-label="Volume / mo"><Link href={seoLinks.keywords(k.keyword, { section: "volume", ...market, ...(i.locationCode && i.locationCode !== 2840 ? { languageCode: i.languageCode } : {}) })} className={FIGURE_LINK}>{fmtNum(k.volume)}</Link></td></tr>; })}</tbody>
      </table>
      {kept > 20 && <button type="button" className={`${TEXT_LINK} mt-1 text-[13px]`} aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Show the first 20" : `Show all ${fmtNum(kept)} kept with this alert`}</button>}
      {more > 0 && <p className="g-text-2 mt-1 text-[12px]">{openHref ? <Link href={openHref} className={QUIET_LINK}>{fmtNum(more)} more</Link> : fmtNum(more)} changed than this alert keeps — the comparison lists every one.</p>}
      {openHref && <Link href={openHref} className="g-link mt-1 inline-flex min-h-8 items-center text-[13px] !underline decoration-dotted decoration-1 underline-offset-[3px] hover:decoration-solid max-sm:min-h-11" onClick={onOpen} data-testid="link-kw-alert-open">Open this comparison for {domain} (snapshots of {fmtDate(i.since)} and {i.takenOn ? fmtDate(i.takenOn) : "that day"})</Link>}
    </div>
  );
}

/** The movements of one rank alert: every one the alert holds, the first RANK_ROWS until asked for the rest. Each keyword opens in the rank tracker. */
function RankRows({ items, siteId }: { items: RankItem[]; siteId: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, RANK_ROWS);
  return (
    <>
      <table className="g-table mt-2">
        <thead><tr><th>Keyword</th><th>Where</th><th>Device</th><th>What happened</th></tr></thead>
        <tbody>{shown.map((i, n) => <tr key={n}><td><Link href={seoLinks.rankTracker(siteId, { keyword: i.keyword, device: device(i.device) })} className={TEXT_LINK} data-testid={`link-alert-keyword-${n}`}>{i.keyword}</Link></td><td data-label="Where" className="g-text-2"><Link href={seoLinks.rankTracker(siteId, { keyword: i.keyword, device: device(i.device) })} className={QUIET_LINK}>{i.location ?? "United States"}</Link></td><td data-label="Device" className="g-text-2 capitalize"><Link href={seoLinks.rankTracker(siteId, { device: device(i.device) })} className={QUIET_LINK}>{i.device}</Link></td><td data-label="What happened"><Link href={i.what === "left_map_pack" || i.what === "entered_map_pack" ? seoLinks.rankTracker(siteId, { keyword: i.keyword, mapPack: true, device: device(i.device) }) : seoLinks.rankTracker(siteId, { keyword: i.keyword, device: device(i.device), panel: "history" })} className={QUIET_LINK} data-testid={`link-alert-move-${n}`}>{WHAT[i.what]?.(i) ?? i.what}</Link>{i.since && i.on ? <span className="g-text-2"> · <Link href={seoLinks.rankTracker(siteId, { panel: "history", date: day(i.since), device: device(i.device) })} className={QUIET_LINK}>{fmtDate(i.since)}</Link> → <Link href={seoLinks.rankTracker(siteId, { panel: "history", date: day(i.on), device: device(i.device) })} className={QUIET_LINK}>{fmtDate(i.on)}</Link></span> : null}</td></tr>)}</tbody>
      </table>
      {items.length > RANK_ROWS && <button type="button" className={`${TEXT_LINK} mt-1 text-[13px]`} aria-expanded={all} onClick={() => setAll(!all)} data-testid="button-rank-alert-all">{all ? `Show the first ${RANK_ROWS}` : `Show all ${fmtNum(items.length)} movements`}</button>}
    </>
  );
}

export default function SeoAlertsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  // The keyword watch's pair is the address (?now=&before=, seoLinks.alerts), so an alert's "Open this comparison" is a
  // link and the back button undoes a pick. Focus moves to the comparison only when it was opened from an alert.
  const [fromAlert, setFromAlert] = useState<number | null>(null);
  const kwNow = Number(params.get("now")) || null, kwBefore = Number(params.get("before")) || null;
  const kwPick: KwPick | null = site && kwNow && kwBefore ? { siteId: site.id, now: kwNow, before: kwBefore, fromAlert: fromAlert ?? undefined } : null;
  const pickKw = (p: KwPick | null) => { setFromAlert(null); setParams({ now: p?.now ?? null, before: p?.before ?? null, watchAll: null }); };
  const qc = useQueryClient();
  const { toast } = useToast();
  // The scope and the kind are the address: ?site= narrows to one site, ?kind= to one kind.
  const scoped = !!params.get("site") && !missing;
  const scope: "site" | "all" = scoped ? "site" : "all";
  const kindParam = params.get("kind");
  const kind: Kind | "all" = (KINDS as readonly string[]).includes(kindParam ?? "") ? (kindParam as Kind) : "all";
  // The site and the kind go to the server: it filters before it cuts the page, so an empty page means there are none.
  const q = new URLSearchParams();
  if (scope === "site" && site) q.set("siteId", String(site.id));
  if (kind !== "all") q.set("kind", kind);
  const qs = q.toString();
  const url = `/api/seo/alerts${qs ? `?${qs}` : ""}`;
  const page = useQuery<AlertPage>({ queryKey: [url], refetchOnMount: "always", refetchInterval: 60_000 });
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
  const alerts = [...(page.data?.alerts ?? []), ...extra].filter((a) => !seen.has(a.id) && (seen.add(a.id), true));
  const hasMore = extra.length ? older.hasMore : (page.data?.hasMore ?? false);
  const unread = page.data?.unread ?? 0;
  const total = page.data?.total ?? 0, undelivered = page.data?.undelivered ?? 0;
  // ?alert= opens one alert (scrolled to and outlined) when it is among the ones loaded; ?undelivered= keeps those whose
  // delivery was given up, of the ones loaded (that one alert stays shown either way).
  const alertParam = params.get("alert"), alertId = Number(alertParam) || null;
  const undeliveredOnly = ["true", "1"].includes(params.get("undelivered") ?? "");
  const listed = undeliveredOnly ? alerts.filter((a) => a.notSent || a.emailFailed || a.id === alertId) : alerts;
  const targetAlert = alertId ? alerts.find((a) => a.id === alertId) ?? null : null;
  // Arriving with an alert, or with a keyword-watch pair (a plan task's "Open this comparison"), scrolls to it.
  useScrollTo(targetAlert ? `alert-${targetAlert.id}` : kwPick ? "keyword-watch" : null, page.isSuccess);
  /** The kind tabs keep the scope; the scope keeps the kind. */
  const tabHref = (k: Kind | "all") => seoLinks.alerts({ site: scope === "site" && site ? site.id : undefined, kind: k === "all" ? undefined : k });
  const chip = [kind !== "all" ? KIND[kind].label : "", kindParam && kind === "all" ? `"${kindParam}" — not a kind of alert` : "", scope === "site" && site ? `${site.domain} only` : "",
    undeliveredOnly ? `not sent — ${fmtNum(listed.filter((a) => a.notSent || a.emailFailed).length)} of the ${fmtNum(alerts.length)} loaded` : "",
    alertParam === null ? "" : !alertId ? `"${alertParam}" — not an alert number` : targetAlert ? `alert #${alertId}` : page.isSuccess ? `alert #${alertId} — not among the ${fmtNum(alerts.length)} loaded (it may be older — "Show more" — or of another kind or site)` : `alert #${alertId}`,
  ].filter(Boolean).join(" · ");
  const scopeSite = scope === "site" && site ? site.id : undefined;

  return (
    <SeoShell title="Alerts" description="What changed since the last check — rankings, the Google map pack and the sites that link to you." site={site} onSite={onSite} sites={sites} status={status}>
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="alerts-site-missing">The site this link is for isn't one of yours (or was removed). Showing every site.</p>}
      {chip && <ActiveFilter onClear={() => clearParams(["kind", "site", "alert", "undelivered"], false)} clearLabel="All alerts">{chip}</ActiveFilter>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* The kind is the address (?kind=): a tab is a link, so the back button returns to the kind before. */}
        <TabStrip label="Which alerts" className="!mb-0 w-full">
          {(["all", ...KINDS] as const).map((k) => <Link key={k} href={tabHref(k)} aria-current={kind === k ? "page" : undefined} data-testid={`tab-alerts-${k}`}>{k === "all" ? "All" : KIND[k].label}</Link>)}
        </TabStrip>
        {site && (
          <label className="flex items-center gap-2 text-[13px]"><span className="g-text-2">Show</span>
            <select className="g-input g-select !w-auto" value={scope} onChange={(e) => setParam("site", e.target.value === "site" ? site.id : null)} data-testid="select-alerts-scope">
              <option value="all">All my sites</option><option value="site">{site.domain} only</option>
            </select>
          </label>
        )}
        <button type="button" className="g-pill g-pill--sm !min-h-11 ml-auto" disabled={!unread || read.isPending} onClick={() => read.mutate(null)} data-testid="button-alerts-read-all"><Check /> Mark all read{unread ? ` (${fmtNum(unread)})` : ""}</button>
      </div>
      <p className="g-text-2 mb-4 text-[13px]">Alerts also reach the bell at the top of the page, and your inbox for falls and lost links. Choose what is emailed under <Link href={seoLinks.appSettings({ tab: "notifications" })} className={TEXT_LINK} data-testid="link-alerts-settings">Settings → Notifications</Link>; set how big a move counts under {site ? <Link href={seoLinks.rankTracker(site.id)} className={TEXT_LINK}>Rank tracker → Tracking settings</Link> : "Rank tracker → Tracking settings"}.</p>

      {site && <div id="keyword-watch" className="scroll-mt-4"><KeywordWatch site={site} pick={kwPick} onPick={pickKw} /></div>}
      {page.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…</p>}
      {page.isError && <div className="g-callout" role="alert" data-testid="alerts-error"><h3>Couldn't load your alerts</h3><p>{apiErrorMessage(page.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void page.refetch()}>Try again</button></div>}
      {page.isSuccess && undelivered > 0 && (
        <div className="g-callout mb-4" role="status" data-testid="alerts-undelivered">
          <h3><Link href={seoLinks.alerts({ site: scopeSite, kind: kind === "all" ? undefined : kind, undelivered: true })} className={QUIET_LINK} data-testid="link-alerts-undelivered">{fmtNum(undelivered)} alert{undelivered === 1 ? "" : "s"} could not be sent</Link></h3>
          <p>The bell or email delivery failed again and again, so it was given up. {undelivered === 1 ? "The alert is" : "They are"} kept here, marked "Not sent".</p>
        </div>
      )}
      {page.isSuccess && alerts.length === 0 && (
        <Empty testId="alerts-empty">
          <h3>{(page.data?.totalAll ?? 0) > 0 ? "No alerts of this kind" : scope === "site" && site ? `No alerts for ${site.domain} yet` : "No alerts yet"}</h3>
          <p>{(page.data?.totalAll ?? 0) > 0 ? <>Choose a different kind above, or <Link href={seoLinks.alerts({ site: scope === "site" && site ? site.id : undefined })} className={TEXT_LINK}>show every kind</Link>.</> : "An alert appears here when a weekly rank check, a monthly backlink snapshot, a repeating local grid or the keyword watch finds a change in the saved data, compared with the one before it, that is big enough to qualify. The first check of a keyword has nothing to compare with, so alerts start with the second."}</p>
        </Empty>
      )}
      {page.isSuccess && alerts.length > 0 && <p className="g-text-2 mb-2 text-[13px]" data-testid="alerts-count">Showing <Link href={tabHref(kind)} className={QUIET_LINK}>{fmtNum(listed.length)}</Link> of <Link href={tabHref(kind)} className={QUIET_LINK}>{fmtNum(total)}</Link> alert{total === 1 ? "" : "s"}{kind !== "all" ? ` of this kind` : ""}{scope === "site" && site ? ` for ${site.domain}` : ""}, newest first.</p>}
      <ul className="space-y-3" data-testid="list-alerts">
        {listed.map((a) => { const to = alertTarget(a); const self = seoLinks.alerts({ site: scopeSite, kind: a.kind, alert: a.id }); return (
          <li key={a.id} id={`alert-${a.id}`} className="min-w-0 scroll-mt-4 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)", ...(alertId === a.id ? HIGHLIGHT : {}) }} data-testid={`alert-${a.id}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {/* The kind keeps its green / red: better or worse is exactly what it says, and opens the alerts of that kind. The title is blue like every heading and opens what the alert is about. */}
              <Link href={seoLinks.alerts({ site: scope === "site" ? a.siteId : undefined, kind: a.kind })} className={`g-move ${KIND[a.kind].good ? "g-move--up" : "g-move--down"} text-[13px] ${QUIET_LINK}`}>{KIND[a.kind].good ? "▲" : "▼"} {KIND[a.kind].label}</Link>
              <h2 className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]" style={BLUE_WORDS}><Link href={to.href} className={QUIET_LINK} data-testid={`link-alert-${a.id}`}>{a.title}</Link></h2>
              {!a.readAt && <span className="g-chip g-chip--sm">New</span>}
              {a.notSent && <Link href={seoLinks.alerts({ site: scopeSite, undelivered: true })} className={`g-chip g-chip--sm ${TAP_PAD} ${LINK_CUE} ${FOCUS_RING}`} title="Sending it to the bell or by email failed again and again, so it was given up. It is kept here. Opens every alert not sent.">Not sent</Link>}
              {!a.notSent && a.emailFailed && <Link href={seoLinks.alerts({ site: scopeSite, undelivered: true })} className={`g-chip g-chip--sm ${TAP_PAD} ${LINK_CUE} ${FOCUS_RING}`} title="The bell entry went out; the email failed every time it was tried. Opens every alert not sent.">Email not sent</Link>}
              <Link href={self} className={`${QUIET_LINK} g-text-2 ml-auto text-[12px]`} data-testid={`link-alert-date-${a.id}`}>{fmtDate(a.createdAt)}</Link>
              {!a.readAt && <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={read.isPending} onClick={() => read.mutate([a.id])} aria-label={`Mark "${a.title}" as read`}>Mark read</button>}
            </div>
            {a.kind === "rank_drop" || a.kind === "rank_gain" ? (
              <RankRows items={a.items as RankItem[]} siteId={a.siteId} />
            ) : a.kind === "mention_new" ? (
              (a.items as unknown as MentionItem[]).map((i, n) => { const check = seoLinks.mentions(a.siteId, i.checkId ? { check: i.checkId } : {}); return (
                <div key={n}>
                  <p className="g-text-2 text-[13px]">Pages published since <Link href={check} className={QUIET_LINK}>{fmtDate(i.since)}</Link> that use "{i.name}", likely you — {i.pages.some((p) => p.confirmed) ? "a website you confirmed, or " : ""}naming one of your places. Check each one before asking for a link.{i.linksChecked === false ? " Whether their websites link to you could not be checked." : ""}</p>
                  {/* The website opens in Site explorer; the page's title opens the page itself. */}
                  <ul className="mt-1 space-y-1 text-[13px]" aria-label="New pages that mention you">
                    {i.pages.map((p) => <li key={p.url}><Link href={seoLinks.explorer(p.domain)} className={TEXT_LINK} title={`Open ${p.domain} in Site explorer`}>{p.domain}</Link> <span className="g-text-2">—</span> <a href={p.url} className={`${QUIET_LINK} g-text-2`} target="_blank" rel="noreferrer" aria-label={`${p.title} — open the page on ${p.domain}`}>{p.title} ↗</a><span className="g-text-2">{p.confirmed ? " · you confirmed this website" : p.place ? ` · names ${p.place}` : ""}{p.linksToYou === null ? " · link not known" : ""}</span></li>)}
                  </ul>
                  {(i.more ?? 0) > 0 && <p className="g-text-2 mt-1 text-[12px]"><Link href={check} className={TEXT_LINK}>{fmtNum(i.more!)} more than this alert keeps</Link>.</p>}
                  {a.items.length > 1 && i.checkId ? <p className="mt-1 text-[13px]"><Link href={check} className={TEXT_LINK} data-testid={`link-alert-check-${a.id}-${n}`}>Open this check on Mentions</Link></p> : null}
                </div>
              ); })
            ) : a.kind === "kw_new" || a.kind === "kw_lost" ? (
              (a.items as unknown as KwItem[]).map((i, n) => <KwAlert key={n} kind={a.kind} item={i} domain={a.domain} openHref={i.snapshotId && i.beforeId ? seoLinks.alerts({ site: a.siteId, kind: kind === "all" ? undefined : kind, now: i.snapshotId, before: i.beforeId }) : undefined} onOpen={() => { setFromAlert(Date.now()); requestAnimationFrame(() => document.getElementById("keyword-watch")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />)
            ) : a.kind === "grid_down" || a.kind === "grid_up" ? (
              (a.items as GridItem[]).map((i, n) => {
                // This scan's figures open it with the points they count outlined; the earlier one's open that scan (older
                // alerts kept no number for it: the local grid's list of scans, said in the link's title).
                const now = (show?: "top3" | "checked") => (i.scanId ? seoLinks.localGrid(a.siteId, { scan: i.scanId, show }) : seoLinks.localGrid(a.siteId));
                const was = (show?: "top3" | "checked") => (i.wasScanId ? seoLinks.localGrid(a.siteId, { scan: i.wasScanId, show }) : seoLinks.localGrid(a.siteId));
                const wasTitle = i.wasScanId ? undefined : "This alert did not keep the earlier scan's number — the local grid lists every scan";
                return <p key={n} className="g-text text-[13px]"><Link href={now()} className={QUIET_LINK} data-testid={`link-alert-scan-${a.id}-${n}`}>"{i.keyword}", {i.size} × {i.size} points {i.spacing} mile{i.spacing === 1 ? "" : "s"} apart</Link>: in the first three local results at <Link href={now("top3")} className={`${FIGURE_LINK} font-medium tabular-nums`}>{i.top3} of {i.checked}</Link> points, was <Link href={was("top3")} className={`${FIGURE_LINK} font-medium tabular-nums`} title={wasTitle}>{i.wasTop3} of {i.wasChecked}</Link> on <Link href={was()} className={QUIET_LINK} title={wasTitle}>{fmtDate(i.since)}</Link>. Position score <Link href={now("checked")} className={FIGURE_LINK}>{i.score ?? "—"}</Link>, was <Link href={was("checked")} className={FIGURE_LINK} title={wasTitle}>{i.wasScore ?? "—"}</Link> (lower is better).</p>;
              })
            ) : (
              (a.items as LinkItem[]).map((i, n) => <div key={n}><p className="g-text text-[13px]">Sites linking to <Link href={seoLinks.explorer(a.domain, "referringDomains")} className={TEXT_LINK}>{a.domain}</Link>: <Link href={seoLinks.backlinks(a.siteId)} className={`${FIGURE_LINK} font-medium tabular-nums`} title="The Backlinks page keeps the monthly snapshots this count was read from">{fmtNum(i.from)}</Link> on <Link href={seoLinks.backlinks(a.siteId)} className={QUIET_LINK}>{fmtDate(i.since)}</Link>, <Link href={seoLinks.explorer(a.domain, "referringDomains")} className={`${FIGURE_LINK} font-medium tabular-nums`}>{fmtNum(i.to)}</Link> now{i.backlinksFrom != null && i.backlinksTo != null ? <> (total links <Link href={seoLinks.backlinks(a.siteId)} className={FIGURE_LINK} title="The Backlinks page keeps the monthly snapshots this count was read from">{fmtNum(i.backlinksFrom)}</Link> → <Link href={seoLinks.explorer(a.domain, "backlinks")} className={FIGURE_LINK}>{fmtNum(i.backlinksTo)}</Link>)</> : ""}.</p>{(i.lost?.length ?? 0) > 0 && <ul className="g-text mt-1 list-disc pl-5 text-[13px]" aria-label="Sites a link was lost from">{i.lost!.map((l, k) => <li key={k}><Link href={seoLinks.backlinks(a.siteId, { section: "lost", domain: l.domain })} className={TEXT_LINK} data-testid={`link-alert-lost-${a.id}-${k}`}>{l.domain}</Link>{l.authority != null ? <span className="g-text-2"> · <Link href={seoLinks.explorer(l.domain)} className={QUIET_LINK}>authority {l.authority}</Link></span> : null}{l.from ? <> · <a href={l.from} className={TEXT_LINK} target="_blank" rel="noreferrer">the page that linked</a></> : null}</li>)}{i.lostTotal != null && i.lostTotal > i.lost!.length ? <li className="g-text-2 list-none"><Link href={seoLinks.backlinks(a.siteId, { section: "lost" })} className={TEXT_LINK}>{fmtNum(i.lostTotal)} sites had a lost link in all</Link>; the Backlinks page keeps the 25 strongest.</li> : null}</ul>}</div>)
            )}
            <p className="mt-2 text-[13px]">
              <Link href={to.href} className={TEXT_LINK} onClick={() => onSite(a.siteId)} data-testid={`link-alert-open-${a.id}`}>{to.label} for {a.domain}</Link>
            </p>
          </li>
        ); })}
      </ul>
      {page.isSuccess && hasMore && alerts.length > 0 && (
        <p className="mt-4"><button type="button" className="g-pill" disabled={more.isPending} onClick={() => more.mutate(alerts[alerts.length - 1].id)} data-testid="button-alerts-more">{more.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</> : `Show more (${fmtNum(Math.max(0, total - alerts.length))} older)`}</button></p>
      )}
    </SeoShell>
  );
}
