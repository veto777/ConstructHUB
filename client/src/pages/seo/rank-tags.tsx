/**
 * Rank tracker -> by tag (server/seo/rank-tags.ts): each tag's keywords on the newest check against the one before,
 * on one device. Changes are measured only on the keywords checked both times. Saved checks only — free.
 * The device is the page's (the address's `device`); every figure in a row links to the table narrowed to that tag
 * (and band, order, movement or "checked"), so a number here lands on the keywords it counts.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";
import { seoLinks, setParam } from "./links";
import { NO_TAG, slug, useRankParams, type RankTo } from "./rank-params";
import { LINK, SectionTitle, TABLE } from "./viz-rank";

type Row = { tag: string | null; keywords: number; checked: number; ranked: number; top3: number; top10: number; averagePosition: number | null; visibility: number | null; compared: number; weighted: boolean; changeWeighted: boolean | null; visibilityChange: number | null; top10Change: number | null; positionNow: number | null; positionBefore: number | null; rankedBoth: number; newSince: number };
type Span = { from: string; to: string; keywords: number };
type Data = { device: "desktop" | "mobile"; devices: ("desktop" | "mobile")[]; deviceFallback?: boolean; now: Span | null; before: Span | null; all: Row; rows: Row[] };
/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;
/** A change: up is good for visibility and the top 10. With `href`, the change is a link to the rows it was measured on. */
const Move = ({ v, decimals = 0, unit = "", href, testId, title }: { v: number | null; decimals?: number; unit?: string; href?: string; testId?: string; title?: string }) => {
  if (v === null) return null;
  const body = v === 0 ? <span className="g-text-2 ml-1 text-[12px]">±0</span> : <span className={`g-move ${v > 0 ? "g-move--up" : "g-move--down"} ml-1`}>{v > 0 ? "+" : "−"}{decimals ? Math.abs(v).toFixed(decimals) : fmtNum(Math.abs(v))}{unit}</span>;
  return href ? <Link href={href} className={LINK} title={title} data-testid={testId}>{body}</Link> : body;
};

export function RankTagsPanel({ site }: { site: SeoSite }) {
  const p = useRankParams();
  // The page's device; a device this site does not track is answered with the site's own (deviceFallback) and said so.
  const device = p.device;
  const url = `/api/seo/sites/${site.id}/rank-tags${device ? `?device=${device}` : ""}`;
  const q = useQuery<Data>({ queryKey: [url], refetchOnMount: "always" });
  // The last answer is kept to show the heading and device buttons while another device loads or fails (focus stays).
  const [last, setLast] = useState<Data | null>(null);
  useEffect(() => { if (q.data) setLast(q.data); }, [q.data]);
  useEffect(() => { setLast(null); }, [site.id]);
  const d = q.data ?? null, shell = d ?? last;
  if (!shell) {
    if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading tags…</p>;
    if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the tags: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
    return null;
  }
  // No keywords at all: nothing to show. Keywords but no tags: all keywords, and how to break them down.
  // (A failed refresh is still said, even over an earlier "no keywords".)
  if (shell.all.keywords === 0 && !q.isError) return null;
  const list = d ? [...d.rows, { ...d.all, tag: "" }] : [];
  // Where a row's figures lead: the table on this device (when there is a choice), narrowed to the row's tag.
  const scope: RankTo = shell.devices.length > 1 ? { device: d?.device ?? shell.device } : {};
  const tagOf = (r: Row): RankTo => (r.tag === "" ? {} : r.tag === null ? { tag: NO_TAG } : { tag: r.tag });
  const to = (r: Row, x: RankTo = {}) => seoLinks.rankTracker(site.id, { ...scope, ...tagOf(r), ...x });
  const name = (r: Row) => (r.tag === "" ? "all keywords" : r.tag === null ? "keywords with no tag" : `keywords tagged “${r.tag}”`);
  const id = (r: Row) => (r.tag === "" ? "all" : r.tag === null ? "none" : `t-${slug(r.tag)}`);
  // The visibility of one tag over time is kept (the history panel takes a tag); of untagged keywords it is not.
  const visibilityOf = (r: Row) => (r.tag === null ? to(r) : to(r, { panel: "history", series: "visibility" }));
  // The days the figures were read from: each date opens that check in the history panel (on this device).
  const day = (date: string, testId: string) => <Link href={seoLinks.rankTracker(site.id, { ...scope, panel: "history", date })} className={LINK} title="This check in the history panel" data-testid={testId}>{fmtDate(date)}</Link>;
  const spanWords = (x: Span, which: string) => (x.from === x.to ? day(x.from, `link-tags-${which}-to`) : <>{day(x.from, `link-tags-${which}-from`)} to {day(x.to, `link-tags-${which}-to`)}</>);
  return (
    <section className="mb-5 scroll-mt-16" data-testid="rank-tags" aria-busy={q.isFetching}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle>By tag</SectionTitle>
        {shell.devices.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Device">
            {shell.devices.map((x) => <button key={x} type="button" className="g-pill g-pill--sm max-sm:!min-h-11" aria-pressed={(device ?? shell.device) === x} style={(device ?? shell.device) === x ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setParam("device", x)} data-testid={`button-tags-${x}`}>{x === "desktop" ? "Desktop" : "Mobile"}</button>)}
          </div>
        )}
      </div>
      {!d && q.isFetching && <p className="g-text-2 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading {device ?? "tags"}…</p>}
      {q.isError && <p className="g-text-2 text-[13px]" role="alert" data-testid="text-tags-error">Couldn't {d ? "refresh" : "load"} {device ?? "the tags"}: {apiErrorMessage(q.error)}{d ? " — what is shown is from the last time it loaded." : ""} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>}
      {d && (<>
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-tags-basis">
        {d.deviceFallback ? "This site does not track that device. " : ""}{d.now ? <>Each keyword's newest saved day on {d.device} ({spanWords(d.now, "now")}){d.before ? <> against its own saved day before ({spanWords(d.before, "before")})</> : " — none has a day before it to compare with"} (a later check on the same day replaces the earlier one). Changes count only keywords with both — the figure under each change says how many; a keyword checked once is counted apart as new, never as a gain. A keyword can carry more than one tag, so the tags add up to more than all keywords. Visibility is an index, not a share of real clicks: 100 would mean every keyword first; weighted by search volume where every keyword has one, otherwise each keyword counts once. Every figure opens the keywords it counts.</> : "No check of these keywords on this device yet."}
      </p>
      {d.rows.length === 0 && <p className="g-text-2 mb-2 text-[13px]" data-testid="text-tags-none">None of these keywords has a tag yet. Give keywords a tag (a service, a town) when you add them, and each tag gets its own row here.</p>}
      {d.now && (
        <div className="overflow-x-auto">
          <table className={TABLE} data-testid="table-rank-tags">
            <thead><tr><th>Tag</th><th className="num">Keywords</th><th className="num">Visibility index</th><th className="num">In the top 10</th><th className="num">Avg. position</th><th className="num">New since</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.tag ?? "\u0000none"} data-testid={`row-tag-${r.tag === "" ? "all" : r.tag ?? "none"}`} className={r.tag === "" ? "font-medium" : undefined}>
                  <td className="max-w-[16rem] !whitespace-normal [overflow-wrap:anywhere]" data-label="Tag"><Label>Tag</Label><Link href={to(r)} className={LINK} title={`The ${name(r)}`} data-testid={`link-tag-${id(r)}`}>{r.tag === "" ? "All keywords" : r.tag === null ? "No tag" : r.tag}</Link></td>
                  <td className="num" data-label="Keywords"><Label>Keywords</Label><Link href={to(r)} className={LINK} title={`The ${name(r)}`} data-testid={`link-tag-keywords-${id(r)}`}>{fmtNum(r.keywords)}</Link>{r.checked < r.keywords && <Link href={to(r, { checked: true })} className={`${LINK} g-text-2 block text-[11px]`} title={`The ${name(r)} with a saved check on ${d.device}`} data-testid={`link-tag-checked-${id(r)}`}>{fmtNum(r.checked)} checked</Link>}</td>
                  <td className="num" data-label="Visibility index"><Label>Visibility index</Label>{r.visibility === null ? "—" : <Link href={visibilityOf(r)} className={LINK} title={r.tag === null ? "The keywords with no tag (their history is not kept apart)" : `Visibility of the ${name(r)} over time`} data-testid={`link-tag-visibility-${id(r)}`}>{r.visibility}</Link>}<Move v={r.visibilityChange} decimals={1} unit=" pts" href={visibilityOf(r)} testId={`link-tag-visibility-change-${id(r)}`} title={`The change, on the ${name(r)} checked both times`} />{r.visibility !== null && <span className="g-text-2 block text-[11px]">{r.weighted ? "by search volume" : "each keyword once"}{r.visibilityChange !== null ? <> · change on <Link href={to(r, { checked: true })} className={LINK} title={`The ${name(r)} with a saved check`} data-testid={`link-tag-compared-${id(r)}`}>{fmtNum(r.compared)}</Link>{r.changeWeighted !== r.weighted ? (r.changeWeighted ? ", by volume" : ", each once") : ""}</> : ""}</span>}</td>
                  <td className="num" data-label="In the top 10"><Label>In the top 10</Label><Link href={to(r, { band: "top10" })} className={LINK} title={`The ${name(r)} in the top 10${r.top10 === 0 ? " (none — the table says so)" : ""}`} data-testid={`link-tag-top10-${id(r)}`}>{fmtNum(r.top10)}</Link><Move v={r.top10Change} href={to(r, { band: "top10" })} testId={`link-tag-top10-change-${id(r)}`} title={`The ${name(r)} in the top 10 now; each row shows its move since the check before`} />{r.top3 > 0 && <Link href={to(r, { band: "top3" })} className={`${LINK} block text-[11px]`} title={`The ${name(r)} in the top 3`} data-testid={`link-tag-top3-${id(r)}`}>{fmtNum(r.top3)} in the top 3</Link>}</td>
                  <td className="num" data-label="Avg. position"><Label>Average position</Label>{r.averagePosition == null ? "—" : <Link href={to(r, { sort: "position" })} className={LINK} title={`The ${name(r)} ordered by position`} data-testid={`link-tag-position-${id(r)}`}>{r.averagePosition}</Link>}{r.positionNow !== null && r.positionBefore !== null && <Link href={to(r, { sort: "position" })} className={`${LINK} g-text-2 block text-[11px]`} title={`The ${name(r)} ordered by position; each row shows its move since the check before`} data-testid={`link-tag-both-${id(r)}`}>{r.rankedBoth} ranked both times: {r.positionBefore} → {r.positionNow}</Link>}</td>
                  <td className="num" data-label="New since"><Label>New since</Label>{!d.before ? "—" : <Link href={to(r, { move: "new" })} className={LINK} title={`The ${name(r)} new since the check before${r.newSince === 0 ? " (none — the table says so)" : ""}`} data-testid={`link-tag-new-${id(r)}`}>{fmtNum(r.newSince)}</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>)}
    </section>
  );
}
