/**
 * The SEO dashboard's presentational layer in the tool language (components/tool): one panel per site — a header
 * line, then a strip of metric cells between 1px rules — and the portfolio strip above the list.
 *
 * The rule (owner, 2026-10-09: "all data should take you somewhere", then "everything is clickable and separately"):
 * every distinct piece is its OWN target with its own destination and an accessible name that says where it goes —
 * the number, the change beside it, the sparkline, each sub-count, each badge. Nothing is one big link, nothing is a
 * dead number, and every address is a seoLinks builder (pages/seo/links.ts) of a view that exists:
 *
 *   domain → Site explorer overview · ↗ → the website itself · analysed date → the same saved report
 *   group chip → edit the group · star → toggle · Site explorer / Rank tracker / Site audit / Action plan → that tool
 *   for this site · Refresh / Analyse → buys a new report (the only purchase on the page)
 *   Health badge → audit issues · its move → the two crawls compared · Crawled → audit pages · With errors → audit
 *   pages narrowed to errors · Last crawl → that crawl
 *   Authority → explorer overview · change → overview from the first month shown · sparkline → overview at the
 *   newest month · "0–100…" → referring domains
 *   Referring domains → that report · change → the report from the first month · Backlinks → backlinks report ·
 *   sparkline → the Backlink growth chart on referring domains
 *   Organic traffic → top pages (they carry the traffic) · change → top pages from the first month · Value →
 *   paid keywords (what the traffic would cost as ads) · sparkline → the Performance chart on traffic
 *   Organic keywords → keywords report · change → from the first month · bar segments and legend → that position
 *   band · sparkline → the Performance chart on keywords
 *   Tracked keywords → rank tracker · Checked → the tracker on that device · bar → that band · Add keywords → tracker
 *
 * The data hooks, the order / group / filter logic and the mutations stay in pages/seo/dashboard.tsx.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { CheckCircle2, Circle, ExternalLink, Loader2, RefreshCw, Star } from "lucide-react";
import { MetricStrip, StatCell, StatusBadge, ToolLink, scoreTone } from "@/components/tool";
import { seoLinks, type PositionBand } from "@/pages/seo/links";
import { fmtDate, fmtNum, type SeoSite } from "@/pages/seo/shell";
import { compact, DistributionBar, FigureLink, FOCUS, monthLabel, PALETTE, TrendPanel, type TrendPoint } from "@/pages/seo/viz";

/** One crawl's health; readable false = the crawl could not be read (score not known). pages = what the score is out of. */
export type HealthPoint = { jobId: string; at: string | null; readable: boolean; health: number | null; pages: number | null; errorPages: number | null; pageCap: number | null };
export type SiteCard = {
  site: SeoSite;
  /** From the site's own crawls (Site audit): the newest finished crawl, and the newest few oldest first (gaps included). */
  audit: (HealthPoint & { trend: HealthPoint[] }) | null;
  /** null = the count could not be read just now. */
  openTasks?: number | null;
  /** Each keyword's newest check on ONE device (`device`), between `firstOn` and `checkedOn`. */
  rank: { top3: number; top10: number; ranked: number; checked: number; checkedOn: string | null; firstOn?: string | null; device?: "desktop" | "mobile" | null };
  report: {
    fetchedAt: string; authority: number | null; backlinks: number | null; referringDomains: number | null;
    organicKeywords: number | null; organicTraffic: number | null; trafficValue: number | null; top3: number | null; top10: number | null;
    history: { month: string; traffic: number; keywords: number }[] | null;
    linkHistory: { month: string; referringDomains: number; authority: number | null }[] | null;
  } | null;
};

/** A series' change from its first to its last point (null when there is no series to speak of). */
const change = (xs: (number | null | undefined)[] | undefined) => { const v = (xs ?? []).filter((x): x is number => typeof x === "number"); return v.length > 1 ? v[v.length - 1] - v[0] : null; };
const healthWords = (p: HealthPoint) => (!p.readable ? "could not be read" : p.health === null ? "no page scored" : `health ${p.health}, ${fmtNum(p.errorPages ?? 0)} of ${fmtNum(p.pages ?? 0)} pages with errors`);
const signed = (n: number) => `${n > 0 ? "up" : "down"} ${compact(Math.abs(n))}`;

/**
 * Site health from the site's own crawls: the newest crawl's score, its move since the crawl just before it (only when
 * both have a score), the pages behind it, and the last few crawls. Health is a share of the pages crawled, so a move
 * can come from crawling different pages — the sizes are said whenever they differ.
 */
export function HealthCell({ audit, siteId, onPick }: { audit: SiteCard["audit"]; siteId: number; /** The audit page keeps a chosen site: told which before a link is followed. */ onPick?: () => void }) {
  const trend = audit?.trend ?? [];
  const prev = trend.length > 1 ? trend[trend.length - 2] : null;
  const move = audit?.health != null && prev?.health != null ? audit.health - prev.health : null;
  // Different page limits, or more than a tenth more or fewer pages scored (every crawl's size is in the list below).
  const sizesDiffer = !!audit && !!prev && prev.readable && audit.readable && (prev.pageCap !== audit.pageCap || Math.abs((prev.pages ?? 0) - (audit.pages ?? 0)) > 0.1 * Math.max(prev.pages ?? 0, audit.pages ?? 0));
  const crawl = (jobId: string) => seoLinks.audit(siteId, { at: jobId });
  const scored = !!audit && audit.readable && audit.health !== null;
  const note: ReactNode = !audit ? null
    : !audit.readable ? <>The newest crawl (<FigureLink href={crawl(audit.jobId)} onClick={onPick} testId={`link-health-crawled-${siteId}`}>{fmtDate(audit.at)}</FigureLink>) could not be read, so its score is not known</>
    : audit.health === null ? <>Crawled <FigureLink href={crawl(audit.jobId)} onClick={onPick} testId={`link-health-crawled-${siteId}`}>{fmtDate(audit.at)}</FigureLink> — no page could be scored</>
    : <>
      {prev && move === null ? <FigureLink href={crawl(prev.jobId)} onClick={onPick} testId={`link-health-before-${siteId}`}>the crawl before has no score</FigureLink> : null}
      {sizesDiffer ? <><FigureLink href={crawl(prev!.jobId)} onClick={onPick} testId={`link-health-before-${siteId}`}>the crawl before scored {fmtNum(prev!.pages ?? 0)} pages{prev!.pageCap !== audit.pageCap ? ` (limit ${fmtNum(prev!.pageCap ?? 0)}, now ${fmtNum(audit.pageCap ?? 0)})` : ""}</FigureLink> — a move can come from crawling different pages, not only from fixes</> : null}
    </>;
  return (
    <StatCell label="Health score" testId={`metric-health-${siteId}`} href={seoLinks.audit(siteId, { tab: "issues" })} onClick={onPick} linkTestId={`link-health-${siteId}`}
      ariaLabel={audit?.health == null ? undefined : `Site health: ${audit.health} out of 100 — open the site audit's issues`}
      none={!audit ? "No crawl yet" : !audit.readable ? "The newest crawl could not be read" : "No page could be scored"}
      value={audit?.health == null ? null : <StatusBadge tone={scoreTone(audit.health)} size="lg">{audit.health}</StatusBadge>}
      delta={move && audit && prev ? { value: move, href: seoLinks.audit(siteId, { at: audit.jobId, vs: prev.jobId }), onClick: onPick, period: "since the crawl before", testId: `link-health-move-${siteId}`, ariaLabel: `Health ${signed(move)} since the crawl before — compare the two crawls`, format: (n) => String(n) } : null}
      subs={scored ? [
        { key: "pages", label: "Crawled", value: fmtNum(audit!.pages ?? 0), href: seoLinks.audit(siteId, { tab: "pages" }), onClick: onPick, testId: `link-health-pages-${siteId}`, ariaLabel: `Pages crawled: ${fmtNum(audit!.pages ?? 0)} — open the audit's pages` },
        { key: "errors", label: "With errors", value: fmtNum(audit!.errorPages ?? 0), href: seoLinks.audit(siteId, { tab: "pages", show: "errors" }), onClick: onPick, testId: `link-health-errors-${siteId}`, ariaLabel: `Pages with errors: ${fmtNum(audit!.errorPages ?? 0)} — open the audit's pages narrowed to errors` },
        { key: "crawled", label: "Last crawl", value: fmtDate(audit!.at), href: crawl(audit!.jobId), onClick: onPick, testId: `link-health-crawled-${siteId}`, ariaLabel: `Last crawl: ${fmtDate(audit!.at)} — open that crawl` },
      ] : undefined}
      note={note}>
      {!audit && <Link href={seoLinks.audit(siteId)} onClick={onPick} className="tool-btn self-start" aria-label="No crawl yet — open Site audit to run one" data-testid={`link-health-audit-${siteId}`}>Open Site audit</Link>}
      {trend.length > 1 && (
        <details className="tool-about !mt-0" data-testid={`health-history-${siteId}`}>
          <summary>Last {trend.length} crawls</summary>
          <ul>{trend.slice().reverse().map((t, i) => <li key={t.jobId}><FigureLink href={crawl(t.jobId)} onClick={onPick} testId={`link-crawl-${siteId}-${i}`}>{fmtDate(t.at)}: {healthWords(t)}</FigureLink></li>)}</ul>
        </details>
      )}
    </StatCell>
  );
}

/** A tile of the portfolio strip: the same props the old tiles took, drawn as a metric cell. `foot` carries its own links. */
export function PortfolioCell({ label, value, foot, testId, href, onClick, linkTestId }: { label: string; value: ReactNode; foot?: ReactNode; /** Kept for the callers; charts are orange, words blue. */ color?: string; testId?: string; href?: string; onClick?: () => void; linkTestId?: string }) {
  return <StatCell label={label} value={value} note={foot} testId={testId} href={href} onClick={onClick} linkTestId={linkTestId ?? (testId ? `link-${testId}` : undefined)} ariaLabel={typeof value === "string" ? `${label}: ${value} — show the sites in that order` : `${label} — show the sites in that order`} />;
}

/** One step of filling a site's row: what it gives, whether it is done, and one small button. */
function StartStep({ n, done, title, text, children }: { n: number; done: boolean; title: string; text: ReactNode; children: ReactNode }) {
  return (
    <div className="tool-stat">
      <div className="tool-stat__label"><span>Step {n}</span><span className="ml-auto inline-flex items-center gap-1" style={{ color: done ? "var(--tool-up)" : undefined }}>{done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Circle className="h-3.5 w-3.5" aria-hidden />}{done ? "Done" : "Not yet"}</span></div>
      <h3 className="text-[14px] font-semibold leading-5" style={{ color: "var(--tool-text)" }}>{title}</h3>
      <p className="tool-stat__note">{text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ProjectRow({ card, busy, canAnalyse, price, priceNote, onAnalyse, onPick, star, group }: {
  card: SiteCard;
  /** A report for this site is being bought right now. */
  busy: boolean;
  /** The data source is on and the balance covers a report. */
  canAnalyse: boolean;
  /** "$1.20" — what a new report costs this account. */
  price: string;
  priceNote: string;
  onAnalyse: () => void;
  /** The audit, rank tracker and plan keep a chosen site: a link to one site's page also makes it the chosen site. */
  onPick: () => void;
  star: { pending: boolean; onToggle: () => void };
  group: { editing: boolean; draft: string; pending: boolean; onDraft: (v: string) => void; onEdit: () => void; onSave: () => void; onCancel: () => void };
}) {
  const { site: s, rank, report: r, audit, openTasks } = card;
  const pick = onPick;
  // Where this site's figures lead. Arriving by any of these never buys data: the explorer shows the saved
  // report (or an Analyse button), the audit and the rank tracker what is stored.
  const ex = (view?: string, p?: { band?: PositionBand; month?: string; series?: string }) => seoLinks.explorer(s.domain, view, p);
  const pts = (xs: { month: string; value: number | null }[]): TrendPoint[] => xs.filter((h) => h.value != null).map((h) => ({ label: monthLabel(h.month), value: h.value as number, key: h.month }));
  const trafficPts = pts((r?.history ?? []).map((h) => ({ month: h.month, value: h.traffic })));
  const keywordPts = pts((r?.history ?? []).map((h) => ({ month: h.month, value: h.keywords })));
  const domainPts = pts((r?.linkHistory ?? []).map((h) => ({ month: h.month, value: h.referringDomains })));
  const authorityPts = pts((r?.linkHistory ?? []).map((h) => ({ month: h.month, value: h.authority })));
  const since = (view: string, xs: TrendPoint[]) => ex(view, { month: xs[0]?.key });
  // The change is the series' first month to its last, so it says so: "since Apr 2026" (the figure beside it is the saved report's).
  const since1 = (xs: TrendPoint[]) => (xs.length > 1 ? `since ${xs[0].label}` : undefined);
  const span = (xs: TrendPoint[]) => (xs.length > 1 ? `${xs[0].label} to ${xs[xs.length - 1].label}` : "");
  const vals = (xs: TrendPoint[]) => xs.map((p) => p.value);
  const noReport = "Not in the saved report";
  return (
    <section className="tool-panel" data-testid={`card-site-${s.id}`}>
      <div className="tool-panel__head">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded text-[13px] font-semibold uppercase" style={{ color: "var(--tool-accent-ink)", background: "color-mix(in srgb, var(--tool-accent) 14%, transparent)" }} aria-hidden>{s.domain.replace(/^www\./, "")[0]}</span>
        <div className="min-w-0">
          <h2 className="tool-panel__title"><ToolLink href={ex()} testId={`link-domain-${s.id}`} label={`${s.domain} — open its Site explorer overview`}>{s.domain}</ToolLink></h2>
        </div>
        <a href={`https://${s.domain}`} target="_blank" rel="noopener noreferrer" className="tool-btn tool-btn--icon tool-btn--quiet" aria-label={`Open ${s.domain} in a new tab`} title="Open the website" data-testid={`link-open-site-${s.id}`}><ExternalLink aria-hidden /></a>
        <span className="tool-muted text-[12px]">{r ? <ToolLink href={ex()} testId={`link-analysed-${s.id}`} label={`Analysed ${fmtDate(r.fetchedAt)} — open the saved report`}>analysed {fmtDate(r.fetchedAt)}</ToolLink> : "not analysed yet"}</span>
        {group.editing ? (
          <form className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto" onSubmit={(e) => { e.preventDefault(); group.onSave(); }} data-testid={`form-group-${s.id}`}>
            <label className="sr-only" htmlFor={`group-${s.id}`}>Group for {s.domain}</label>
            <input id={`group-${s.id}`} className="g-input !h-8 w-40 min-w-0 max-w-full flex-1 !py-0 text-[13px] sm:flex-none" list="seo-groups" maxLength={40} value={group.draft} onChange={(e) => group.onDraft(e.target.value)} placeholder="e.g. Smith Roofing" autoFocus data-testid={`input-group-${s.id}`} />
            <button type="submit" className="tool-btn" disabled={group.pending}>Save</button>
            <button type="button" className="tool-btn" onClick={group.onCancel}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="tool-chip max-w-full !whitespace-normal text-left [overflow-wrap:anywhere]" onClick={group.onEdit} aria-label={s.group ? `Group: ${s.group} — change` : `Put ${s.domain} in a group`} data-testid={`button-group-${s.id}`}>{s.group ? s.group : "+ Group"}</button>
        )}
        <button type="button" className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${FOCUS}`} aria-pressed={!!s.starred} aria-label={s.starred ? `Remove the star from ${s.domain}` : `Star ${s.domain} to keep it on top`} title={s.starred ? "Starred — stays on top" : "Star to keep on top"} disabled={star.pending} onClick={star.onToggle} data-testid={`button-star-${s.id}`}>
          <Star className="h-4 w-4" style={s.starred ? { fill: "#f9ab00", color: "#f9ab00" } : { color: "var(--tool-text-2)" }} aria-hidden />
        </button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Link href={ex()} className="tool-btn" data-testid={`link-explore-${s.id}`}>Site explorer</Link>
          <Link href={seoLinks.rankTracker(s.id)} className="tool-btn" onClick={pick} data-testid={`link-rank-${s.id}`}>Rank tracker</Link>
          <Link href={seoLinks.audit(s.id)} className="tool-btn" onClick={pick} data-testid={`link-audit-${s.id}`}>Site audit</Link>
          <Link href={seoLinks.plan(s.id)} className="tool-btn" onClick={pick} data-testid={`link-plan-${s.id}`} aria-label={`Action plan${openTasks == null ? " — count unavailable" : openTasks ? ` — ${openTasks} open` : ""}`}>Action plan{openTasks == null ? <span className="tool-muted">· ?</span> : openTasks ? <span className="tool-tabs__count" style={{ background: "var(--tool-active)", borderRadius: 9999, padding: "0 6px", fontSize: 11, fontWeight: 600 }}>{openTasks}</span> : null}</Link>
          <button type="button" className="tool-btn" disabled={busy || !canAnalyse} onClick={onAnalyse} data-testid={`button-analyse-${s.id}`} title={`A new report costs about ${price} of your SEO data.${priceNote}`}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {r ? "Refresh" : "Analyse"} · {price}
          </button>
        </div>
      </div>
      {r ? (
        <>
          <MetricStrip cols={[2, 3, 6]}>
            <HealthCell audit={audit} siteId={s.id} onPick={pick} />
            <StatCell label="Authority" testId={`metric-authority-${s.id}`} href={ex()} linkTestId={`link-authority-${s.id}`} value={r.authority == null ? null : String(r.authority)} none={noReport}
              ariaLabel={`Authority: ${r.authority} out of 100 — open the site overview`}
              delta={{ value: change(vals(authorityPts)), period: since1(authorityPts), href: since("overview", authorityPts), testId: `link-authority-change-${s.id}`, ariaLabel: `Authority ${signed(change(vals(authorityPts)) ?? 0)}, ${span(authorityPts)} — open the overview from the first of those months` }}
              note={<ToolLink href={ex("referringDomains")} testId={`link-authority-foot-${s.id}`} label="Authority is 0 to 100, from the sites linking to it — open the referring domains">0–100, from linking sites</ToolLink>}
              spark={{ points: vals(authorityPts), color: "blue", range: true, href: ex("overview", { month: authorityPts[authorityPts.length - 1]?.key }), testId: `spark-authority-${s.id}`, ariaLabel: `Authority by month, ${span(authorityPts)} — open the overview at the newest month` }} />
            <StatCell label="Referring domains" testId={`metric-domains-${s.id}`} href={ex("referringDomains")} linkTestId={`link-domains-${s.id}`} value={r.referringDomains == null ? null : compact(r.referringDomains)} none={noReport}
              ariaLabel={`Referring domains: ${fmtNum(r.referringDomains)} — open the referring domains report`}
              delta={{ value: change(vals(domainPts)), period: since1(domainPts), href: since("referringDomains", domainPts), testId: `link-domains-change-${s.id}`, ariaLabel: `Referring domains ${signed(change(vals(domainPts)) ?? 0)}, ${span(domainPts)} — open the report from the first of those months` }}
              subs={[{ key: "backlinks", label: "Backlinks", value: compact(r.backlinks), href: ex("backlinks"), testId: `link-backlinks-${s.id}`, ariaLabel: `Backlinks: ${fmtNum(r.backlinks)} — open the backlinks report` }]}
              spark={{ points: vals(domainPts), color: "blue", range: true, href: ex("overview", { series: "domains" }), testId: `spark-domains-${s.id}`, ariaLabel: `Referring domains by month, ${span(domainPts)} — open the Backlink growth chart` }} />
            <StatCell label="Organic traffic (est.)" testId={`metric-traffic-${s.id}`} href={ex("pages")} linkTestId={`link-traffic-${s.id}`} value={r.organicTraffic == null ? null : compact(r.organicTraffic)} none={noReport}
              ariaLabel={`Estimated organic traffic: ${fmtNum(r.organicTraffic)} visits a month — open the top pages, which carry it`}
              delta={{ value: change(vals(trafficPts)), period: since1(trafficPts), href: since("pages", trafficPts), testId: `link-traffic-change-${s.id}`, ariaLabel: `Organic traffic ${signed(change(vals(trafficPts)) ?? 0)}, ${span(trafficPts)} — open the top pages from the first of those months` }}
              subs={r.trafficValue != null ? [{ key: "value", label: "Value", value: `$${Math.round(r.trafficValue).toLocaleString("en-US")} / mo`, href: ex("paidKeywords"), testId: `link-traffic-value-${s.id}`, ariaLabel: `Traffic value: $${Math.round(r.trafficValue).toLocaleString("en-US")} a month, what these visits would cost as ads — open the paid keywords` }] : undefined}
              spark={{ points: vals(trafficPts), color: "orange", range: true, href: ex("overview", { series: "traffic" }), testId: `spark-traffic-${s.id}`, ariaLabel: `Organic traffic by month, ${span(trafficPts)} — open the Performance chart` }} />
            <StatCell label="Organic keywords" testId={`metric-keywords-${s.id}`} href={ex("keywords")} linkTestId={`link-keywords-${s.id}`} value={r.organicKeywords == null ? null : compact(r.organicKeywords)} none={noReport}
              ariaLabel={`Organic keywords: ${fmtNum(r.organicKeywords)} — open the keywords report`}
              delta={{ value: change(vals(keywordPts)), period: since1(keywordPts), href: since("keywords", keywordPts), testId: `link-keywords-change-${s.id}`, ariaLabel: `Organic keywords ${signed(change(vals(keywordPts)) ?? 0)}, ${span(keywordPts)} — open the keywords from the first of those months` }}
              spark={{ points: vals(keywordPts), color: "orange", range: true, href: ex("overview", { series: "keywords" }), testId: `spark-keywords-${s.id}`, ariaLabel: `Organic keywords by month, ${span(keywordPts)} — open the Performance chart` }}>
              {r.top10 != null && r.top3 != null && r.organicKeywords != null && <DistributionBar testId={`dist-keywords-${s.id}`} parts={[{ key: "top3", label: "Top 3", value: r.top3, color: PALETTE.top3 }, { key: "top10", label: "4–10", value: Math.max(0, r.top10 - r.top3), color: PALETTE.top10 }, { key: "rest", label: "11+", value: Math.max(0, r.organicKeywords - r.top10), color: PALETTE.rest }]} segmentHref={(k) => ex("keywords", { band: k as PositionBand })} />}
            </StatCell>
            <StatCell label="Tracked keywords" testId={`metric-tracked-${s.id}`} href={seoLinks.rankTracker(s.id)} onClick={pick} linkTestId={`link-tracked-${s.id}`} value={fmtNum(s.keywordCount)}
              ariaLabel={`Tracked keywords: ${fmtNum(s.keywordCount)} — open the rank tracker`}
              subs={rank.checked ? [{ key: "checked", label: rank.device ? `On ${rank.device}` : "Newest checks", value: rank.firstOn && rank.firstOn !== rank.checkedOn ? `${fmtDate(rank.firstOn)} – ${fmtDate(rank.checkedOn)}` : fmtDate(rank.checkedOn), href: seoLinks.rankTracker(s.id, { device: rank.device ?? undefined }), onClick: pick, testId: `link-tracked-checked-${s.id}`, ariaLabel: `Checked ${fmtDate(rank.checkedOn)}${rank.device ? ` on ${rank.device}` : ""} — open the rank tracker${rank.device ? " on that device" : ""}` }] : undefined}
              note={!rank.checked && s.keywordCount ? <FigureLink href={seoLinks.rankTracker(s.id)} onClick={pick} testId={`link-tracked-due-${s.id}`}>No check saved yet{s.nextRankCheckAt ? ` — the first automatic check is due ${fmtDate(s.nextRankCheckAt)}` : ""}; it is skipped while this month's included data is used up</FigureLink> : undefined}>
              {rank.checked > 0 ? <DistributionBar testId={`dist-tracked-${s.id}`} parts={[{ key: "top3", label: "Top 3", value: rank.top3, color: PALETTE.top3 }, { key: "top10", label: "4–10", value: Math.max(0, rank.top10 - rank.top3), color: PALETTE.top10 }, { key: "rest", label: "Below 10 or not found", value: Math.max(0, rank.checked - rank.top10), color: PALETTE.rest }]} segmentHref={(k) => seoLinks.rankTracker(s.id, { band: k as PositionBand })} onSegment={pick} />
                : !s.keywordCount && <Link href={seoLinks.rankTracker(s.id)} className="tool-btn self-start" onClick={pick} aria-label={`No keyword tracked for ${s.domain} yet — open the rank tracker to add some`} data-testid={`link-add-keywords-${s.id}`}>Add keywords</Link>}
            </StatCell>
          </MetricStrip>
          <details className="tool-row-more" data-testid={`trend-details-${s.id}`}>
            <summary>Trends over time</summary>
            <TrendPanel title="Over time" testId={`trend-${s.id}`} note="Monthly. Traffic and keywords are estimates from the keyword database; referring domains and authority come from the backlink index. A point, or a month in the list, opens that month in Site explorer."
              series={[
                { key: "traffic", label: "Organic traffic (estimate)", color: PALETTE.traffic, points: trafficPts },
                { key: "keywords", label: "Organic keywords", color: PALETTE.keywords, points: keywordPts },
                { key: "domains", label: "Referring domains", color: PALETTE.domains, points: domainPts },
                { key: "authority", label: "Authority", color: PALETTE.authority, points: authorityPts },
              ]} pointHref={(_k, p) => ex("overview", { month: p.key })} />
          </details>
        </>
      ) : (
        <MetricStrip cols={[1, 3, 3]} testId={`start-${s.id}`}>
          {/* Three steps to fill this row; each says whether it is done. Nothing here is a figure until a step has run. */}
          <StartStep n={1} done={false} title="Analyse the site" text="Authority, backlinks, estimated search traffic, keywords and competitors — with two years of monthly history.">
            <button type="button" className="tool-btn" disabled={busy || !canAnalyse} onClick={onAnalyse} data-testid={`button-analyse-empty-${s.id}`}>{busy ? <Loader2 className="animate-spin" /> : null}Analyse — about {price}</button>
          </StartStep>
          <StartStep n={2} done={(s.keywordCount ?? 0) > 0} title="Track your keywords"
            text={(s.keywordCount ?? 0) > 0 ? <><FigureLink href={seoLinks.rankTracker(s.id, { panel: "keywords" })} onClick={pick} testId={`link-start-tracked-${s.id}`}>{fmtNum(s.keywordCount)} tracked</FigureLink> — checked every week by default.</> : "Your services and towns: where the site is found in Google and the map pack, every week."}>
            <Link href={seoLinks.rankTracker(s.id)} className="tool-btn" onClick={pick} data-testid={`link-start-rank-${s.id}`}>Open Rank tracker</Link>
          </StartStep>
          {audit ? <HealthCell audit={audit} siteId={s.id} onPick={pick} /> : (
            <StartStep n={3} done={false} title="Crawl the site" text="Broken pages, redirects, titles, speed and what a crawler can read.">
              <Link href={seoLinks.audit(s.id)} className="tool-btn" onClick={pick} data-testid={`link-start-audit-${s.id}`}>Open Site audit</Link>
            </StartStep>
          )}
        </MetricStrip>
      )}
    </section>
  );
}
