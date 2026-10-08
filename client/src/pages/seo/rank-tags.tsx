/**
 * Rank tracker -> by tag (server/seo/rank-tags.ts): each tag's keywords on the newest check against the one before,
 * on one device. Changes are measured only on the keywords checked both times. Saved checks only — free.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, fmtNum, type SeoSite } from "./shell";

type Row = { tag: string | null; keywords: number; checked: number; ranked: number; top3: number; top10: number; averagePosition: number | null; visibility: number | null; compared: number; weighted: boolean; visibilityChange: number | null; top10Change: number | null; positionNow: number | null; positionBefore: number | null; rankedBoth: number; newSince: number };
type Span = { from: string; to: string; keywords: number };
const spanWords = (x: Span) => (x.from === x.to ? fmtDate(x.from) : `${fmtDate(x.from)} to ${fmtDate(x.to)}`);
type Data = { device: "desktop" | "mobile"; devices: ("desktop" | "mobile")[]; deviceFallback?: boolean; now: Span | null; before: Span | null; all: Row; rows: Row[] };
/** A cell's label for screen readers (the phone layout hides the table header). */
const Label = ({ children }: { children: string }) => <span className="sr-only">{children}: </span>;
/** A change: up is good for visibility and the top 10. */
const Move = ({ v, unit = "" }: { v: number | null; unit?: string }) =>
  v === null ? null : v === 0 ? <span className="g-text-2 ml-1 text-[12px]">±0</span>
    : <span className={`g-move ${v > 0 ? "g-move--up" : "g-move--down"} ml-1`}>{v > 0 ? "+" : "−"}{fmtNum(Math.abs(v))}{unit}</span>;

export function RankTagsPanel({ site }: { site: SeoSite }) {
  const [device, setDevice] = useState<"desktop" | "mobile" | null>(null);
  useEffect(() => { setDevice(null); }, [site.id]);
  const url = `/api/seo/sites/${site.id}/rank-tags${device ? `?device=${device}` : ""}`;
  const q = useQuery<Data>({ queryKey: [url], refetchOnMount: "always" });
  const d = q.data;
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading tags…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the tags: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  // No tags: nothing to break the keywords down by.
  if (!d || d.rows.length === 0) return null;
  const list = [...d.rows, { ...d.all, tag: "" }];
  return (
    <section className="mb-5" data-testid="rank-tags" aria-busy={q.isFetching}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="g-text text-[16px] font-medium">By tag</h2>
        {d.devices.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Device">
            {d.devices.map((x) => <button key={x} type="button" className="g-pill g-pill--sm" aria-pressed={d.device === x} style={d.device === x ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setDevice(x)} data-testid={`button-tags-${x}`}>{x === "desktop" ? "Desktop" : "Mobile"}</button>)}
          </div>
        )}
      </div>
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-tags-basis">
        {d.deviceFallback ? "This site does not track that device. " : ""}{d.now ? <>Each keyword's newest saved day on {d.device} ({spanWords(d.now)}){d.before ? ` against its own saved day before (${spanWords(d.before)})` : " — none has a day before it to compare with"} (a later check on the same day replaces the earlier one). Changes count only keywords with both — the figure under each change says how many; a keyword checked once is counted apart as new, never as a gain. A keyword can carry more than one tag, so the tags add up to more than all keywords. Visibility is an index, not a share of real clicks: 100 would mean every keyword first; weighted by search volume where every keyword has one, otherwise each keyword counts once.</> : "No check of these keywords on this device yet."}
      </p>
      {d.now && (
        <div className="overflow-x-auto">
          <table className="g-table w-full" data-testid="table-rank-tags">
            <thead><tr><th>Tag</th><th className="num">Keywords</th><th className="num">Visibility index</th><th className="num">In the top 10</th><th className="num">Avg. position</th><th className="num">New since</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.tag ?? "\u0000none"} data-testid={`row-tag-${r.tag === "" ? "all" : r.tag ?? "none"}`} className={r.tag === "" ? "font-medium" : undefined}>
                  <td className="max-w-[16rem] !whitespace-normal [overflow-wrap:anywhere]" data-label="Tag"><Label>Tag</Label>{r.tag === "" ? "All keywords" : r.tag === null ? <span className="g-text-2">No tag</span> : r.tag}</td>
                  <td className="num" data-label="Keywords"><Label>Keywords</Label>{fmtNum(r.keywords)}{r.checked < r.keywords && <span className="g-text-2 block text-[11px]">{fmtNum(r.checked)} checked</span>}</td>
                  <td className="num" data-label="Visibility index"><Label>Visibility index</Label>{r.visibility === null ? "—" : r.visibility}<Move v={r.visibilityChange} />{r.visibility !== null && <span className="g-text-2 block text-[11px]">{r.weighted ? "by search volume" : "each keyword once"}{r.visibilityChange !== null ? ` · change on ${fmtNum(r.compared)}` : ""}</span>}</td>
                  <td className="num" data-label="In the top 10"><Label>In the top 10</Label>{fmtNum(r.top10)}<Move v={r.top10Change} />{r.top3 > 0 && <span className="g-text-2 block text-[11px]">{fmtNum(r.top3)} in the top 3</span>}</td>
                  <td className="num" data-label="Avg. position"><Label>Average position</Label>{r.averagePosition ?? "—"}{r.positionNow !== null && r.positionBefore !== null && <span className="g-text-2 block text-[11px]">{r.rankedBoth} ranked both times: {r.positionBefore} → {r.positionNow}</span>}</td>
                  <td className="num" data-label="New since"><Label>New since</Label>{d.before ? fmtNum(r.newSince) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
