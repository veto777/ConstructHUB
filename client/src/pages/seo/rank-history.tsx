/**
 * Rank tracker history: visibility, average position and the top-10 count over time (one figure at a time, in
 * orange), how the tracked keywords spread across the result pages at each check, and one keyword's position
 * history. All from saved checks — free to open. The page's figure row reads the same history through useRankHistory.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, type SeoSite } from "./shell";
import { ORANGE, TOOLTIP } from "./viz";
import { BANDS, CARD, PanelTitle, RankTrendPanel, SectionTitle, TABLE } from "./viz-rank";

type Device = "desktop" | "mobile";
export type HistoryDay = { date: string; checked: number; ranked: number; top3: number; top10: number; top20: number; top100: number; notRanked: number; averagePosition: number | null; visibility: number; mapPack?: number };
type History = { device: Device; devices: Device[]; tag: string | null; tags: string[]; days: HistoryDay[] };

const tick = { fontSize: 12, fill: "var(--g-text-2)" };

/** The saved history of one device (the site's first when `device` is empty), all keywords or one tag's. One request per key, shared. */
export function useRankHistory(siteId: number | null, device: string, tag: string) {
  const params = new URLSearchParams();
  if (device) params.set("device", device);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  return useQuery<History>({ queryKey: [`/api/seo/sites/${siteId}/rank-history${qs ? `?${qs}` : ""}`], enabled: siteId != null, refetchOnMount: "always" });
}

export function RankHistoryPanel({ site }: { site: SeoSite }) {
  const [device, setDevice] = useState<Device | "">("");
  const [tag, setTag] = useState("");
  // Another site has its own devices and tags.
  useEffect(() => { setDevice(""); setTag(""); }, [site.id]);
  const q = useRankHistory(site.id, device, tag);
  const h = q.data;
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the history: {apiErrorMessage(q.error)}</p>;
  if (!h) return null;
  // Nothing checked yet and nothing to choose between: stay out of the way.
  if (h.days.length === 0 && !tag && h.devices.length < 2 && h.tags.length === 0) return null;
  const last = h.days[h.days.length - 1], first = h.days[0];
  // One figure as dated points, oldest first; a day without the figure is left out, never drawn as 0.
  const pts = (pick: (d: HistoryDay) => number | null | undefined) => h.days.flatMap((d) => { const v = pick(d); return v == null ? [] : [{ label: fmtDate(d.date), value: v }]; });
  return (
    <section className="mb-5" data-testid="rank-history">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle>History</SectionTitle>
        {h.devices.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Device">
            {h.devices.map((d) => <button key={d} type="button" className="g-pill g-pill--sm" aria-pressed={h.device === d} style={h.device === d ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setDevice(d)} data-testid={`button-history-${d}`}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}
          </div>
        )}
        {h.tags.length > 0 && (
          <label className="flex items-center gap-2 text-[13px]"><span className="g-text-2">Tag</span>
            <select className="g-select" value={tag} onChange={(e) => setTag(e.target.value)} data-testid="select-history-tag">
              <option value="">All keywords</option>
              {h.tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
      </div>
      {h.days.length === 0 && <p className="g-text-2 text-[13px]" data-testid="rank-history-empty">No checks yet{tag ? ` for keywords tagged "${tag}"` : ""} on {h.device}.</p>}
      {h.days.length === 1 && <p className="g-text-2 mb-2 text-[13px]">One check so far ({fmtDate(first.date)}). The trend lines appear after the next weekly check.</p>}
      {h.days.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RankTrendPanel title="Over time" testId="chart-visibility" series={[
            { key: "visibility", label: "Visibility", points: pts((d) => d.visibility), format: (v) => `${v}%`, note: "Visibility estimates the share of clicks you win on these keywords: 100% means #1 for all of them, 0% means none on page one." },
            { key: "position", label: "Average position", points: pts((d) => d.averagePosition), format: (v) => String(v), reversed: true, note: "Ranked keywords only. #1 is at the top, so a rising line is better." },
            { key: "top3", label: "In the top 3", points: pts((d) => d.top3), note: "How many of the keywords checked that day were in Google's first three results." },
            { key: "top10", label: "In the top 10", points: pts((d) => d.top10), note: "How many of the keywords checked that day were in Google's first ten results." },
            ...(h.days.some((d) => d.mapPack != null) ? [{ key: "map", label: "In the map pack", points: pts((d) => d.mapPack), note: "How many of the keywords checked that day found you in the map pack." }] : []),
          ]} />
          <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid="chart-positions">
            <PanelTitle>Positions <span className="g-text-2 font-normal">· {last.checked} keyword{last.checked === 1 ? "" : "s"} checked {fmtDate(last.date)}</span></PanelTitle>
            <p className="g-text-2 mb-2 text-[12px]">How many of your keywords sat in each band of Google's results at each check.</p>
            <div className="h-48 sm:h-56" aria-hidden>
              <ResponsiveContainer>
                <BarChart data={h.days} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={30} />
                  <Tooltip labelFormatter={(v) => fmtDate(String(v))} contentStyle={TOOLTIP} cursor={{ fill: "var(--g-hover)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
                  {BANDS.map((b) => <Bar key={b.key} dataKey={b.key} name={b.label} stackId="p" fill={b.color} stroke="var(--g-surface)" strokeWidth={1} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {h.days.length > 0 && (
        <details className="mt-2 text-[13px]" data-testid="rank-history-table">
          <summary className="g-link cursor-pointer">Show these numbers as a table</summary>
          <div className="overflow-x-auto">
            <table className={`${TABLE} mt-2`}>
              <thead><tr><th>Checked</th><th className="num">Visibility</th><th className="num">Average position</th><th className="num">In map pack</th>{BANDS.map((b) => <th key={b.key} className="num">{b.label}</th>)}</tr></thead>
              <tbody>{[...h.days].reverse().map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="num" data-label="Visibility">{d.visibility}%</td><td className="num" data-label="Average position">{d.averagePosition ?? "—"}</td><td className="num" data-label="In map pack">{d.mapPack ?? 0}</td>{BANDS.map((b) => <td key={b.key} className="num" data-label={b.label}>{d[b.key]}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

type Point = { date: string; desktop: number | null; mobile: number | null; url: string | null; checked?: { desktop: boolean; mobile: boolean } };

/** One keyword's position at every saved check, #1 at the top: desktop as a solid orange line, mobile dashed. */
export function KeywordHistory({ id, devices }: { id: number; devices: Device[] }) {
  const q = useQuery<{ keyword: string; points: Point[] }>({ queryKey: [`/api/seo/keywords/${id}/history`], refetchOnMount: "always", });
  if (q.isLoading) return <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p className="g-text-2 text-[13px]" role="alert">Couldn't load this keyword's history: {apiErrorMessage(q.error)}</p>;
  const points = q.data?.points ?? [];
  if (!points.length) return <p className="g-text-2 text-[13px]">Not checked yet — the first position appears after the next check.</p>;
  return (
    <div data-testid={`keyword-history-${id}`}>
      {points.length > 1 && (
        <div className="h-40" aria-hidden>
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis reversed allowDecimals={false} domain={[1, "auto"]} tick={tick} axisLine={false} tickLine={false} width={30} />
              <Tooltip labelFormatter={(v) => fmtDate(String(v))} contentStyle={TOOLTIP} />
              {devices.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {devices.includes("desktop") && <Line type="monotone" dataKey="desktop" name="Desktop" stroke={ORANGE} strokeWidth={2} dot={{ r: 3 }} legendType="plainline" isAnimationActive={false} />}
              {devices.includes("mobile") && <Line type="monotone" dataKey="mobile" name="Mobile" stroke={ORANGE} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeDasharray: "0" }} legendType="plainline" isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={`${TABLE} mt-2`}>
          <thead><tr><th>Checked</th>{devices.map((d) => <th key={d} className="num">{d === "desktop" ? "Desktop" : "Mobile"}</th>)}<th>Ranking page</th></tr></thead>
          <tbody>
            {[...points].reverse().slice(0, 12).map((p) => (
              <tr key={p.date}>
                <td>{fmtDate(p.date)}</td>
                {devices.map((d) => <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p[d] ?? (p.checked?.[d] === false ? <span className="g-text-2" title="Not checked on this device that day">—</span> : <span title="Not within the result pages the check read">not found</span>)}</td>)}
                <td data-label="Page" className="max-w-[320px] truncate">{p.url ? <a href={p.url} className="g-link" target="_blank" rel="noreferrer">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="g-text-2">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
