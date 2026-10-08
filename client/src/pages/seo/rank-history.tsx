/**
 * Rank tracker history: visibility and average position over time, how the
 * tracked keywords spread across the result pages at each check, and one
 * keyword's position history. All from saved checks — free to open.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, type SeoSite } from "./shell";

type Device = "desktop" | "mobile";
type Day = { date: string; checked: number; ranked: number; top3: number; top10: number; top20: number; top100: number; notRanked: number; averagePosition: number | null; visibility: number; mapPack?: number };
type History = { device: Device; devices: Device[]; tag: string | null; tags: string[]; days: Day[] };

const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
const tick = { fontSize: 12, fill: "var(--g-text-2)" };
const tooltipStyle = { fontSize: 12, background: "var(--g-surface)", border: "1px solid var(--g-divider)", color: "var(--g-text)" };
const BUCKETS = [
  { key: "top3", label: "1–3", color: "#188038" },
  { key: "top10", label: "4–10", color: "#34a853" },
  { key: "top20", label: "11–20", color: "#fbbc04" },
  { key: "top100", label: "21+", color: "#e8710a" },
  { key: "notRanked", label: "Not ranked", color: "#9aa0a6" },
] as const;

export function RankHistoryPanel({ site }: { site: SeoSite }) {
  const [device, setDevice] = useState<Device | "">("");
  const [tag, setTag] = useState("");
  // Another site has its own devices and tags.
  useEffect(() => { setDevice(""); setTag(""); }, [site.id]);
  const params = new URLSearchParams();
  if (device) params.set("device", device);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  const q = useQuery<History>({ queryKey: [`/api/seo/sites/${site.id}/rank-history${qs ? `?${qs}` : ""}`] });
  const h = q.data;
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the history: {apiErrorMessage(q.error)}</p>;
  if (!h) return null;
  // Nothing checked yet and nothing to choose between: stay out of the way.
  if (h.days.length === 0 && !tag && h.devices.length < 2 && h.tags.length === 0) return null;
  const last = h.days[h.days.length - 1], first = h.days[0];
  return (
    <section className="mb-5" data-testid="rank-history">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="g-text text-[16px] font-medium">History</h2>
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
          <div className="rounded-lg border p-4" style={card} data-testid="chart-visibility">
            <div className="mb-1 flex flex-wrap items-baseline gap-x-4">
              <span className="g-text text-[14px] font-medium">Visibility <span className="tabular-nums">{last.visibility}%</span></span>
              <span className="g-text text-[14px] font-medium">Average position <span className="tabular-nums">{last.averagePosition ?? "—"}</span></span>
            </div>
            <p className="g-text-2 mb-2 text-[12px]">Visibility estimates the share of clicks you win on these keywords: 100% means #1 for all of them, 0% means none on page one.</p>
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={h.days} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="vis" domain={[0, 100]} tick={tick} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
                  <YAxis yAxisId="pos" orientation="right" reversed allowDecimals={false} domain={[1, "auto"]} tick={tick} axisLine={false} tickLine={false} width={30} />
                  <Tooltip labelFormatter={(v) => fmtDate(String(v))} formatter={(v: number, name: string) => [name === "Visibility" ? `${v}%` : v, name]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="vis" type="monotone" dataKey="visibility" name="Visibility" stroke="#1a73e8" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line yAxisId="pos" type="monotone" dataKey="averagePosition" name="Average position" stroke="#e8710a" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-lg border p-4" style={card} data-testid="chart-positions">
            <div className="g-text mb-1 text-[14px] font-medium">Positions <span className="g-text-2 font-normal">· {last.checked} keyword{last.checked === 1 ? "" : "s"} checked {fmtDate(last.date)}</span></div>
            <p className="g-text-2 mb-2 text-[12px]">How many of your keywords sat in each band of Google's results at each check.</p>
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={h.days} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--g-divider)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={30} />
                  <Tooltip labelFormatter={(v) => fmtDate(String(v))} contentStyle={tooltipStyle} cursor={{ fill: "var(--g-hover)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {BUCKETS.map((b) => <Bar key={b.key} dataKey={b.key} name={b.label} stackId="p" fill={b.color} isAnimationActive={false} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {h.days.length > 0 && (
        <details className="mt-2 text-[13px]" data-testid="rank-history-table">
          <summary className="g-link cursor-pointer">Show these numbers as a table</summary>
          <table className="g-table mt-2">
            <thead><tr><th>Checked</th><th className="num">Visibility</th><th className="num">Average position</th><th className="num">In map pack</th>{BUCKETS.map((b) => <th key={b.key} className="num">{b.label}</th>)}</tr></thead>
            <tbody>{[...h.days].reverse().map((d) => <tr key={d.date}><td>{fmtDate(d.date)}</td><td className="num">{d.visibility}%</td><td className="num">{d.averagePosition ?? "—"}</td><td className="num">{d.mapPack ?? 0}</td>{BUCKETS.map((b) => <td key={b.key} className="num">{d[b.key]}</td>)}</tr>)}</tbody>
          </table>
        </details>
      )}
    </section>
  );
}

type Point = { date: string; desktop: number | null; mobile: number | null; url: string | null; checked?: { desktop: boolean; mobile: boolean } };

/** One keyword's position at every saved check. Lower on the chart is worse: position 1 is at the top. */
export function KeywordHistory({ id, devices }: { id: number; devices: Device[] }) {
  const q = useQuery<{ keyword: string; points: Point[] }>({ queryKey: [`/api/seo/keywords/${id}/history`] });
  if (q.isLoading) return <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p className="g-text-2 text-[13px]" role="alert">Couldn't load this keyword's history: {apiErrorMessage(q.error)}</p>;
  const points = q.data?.points ?? [];
  if (!points.length) return <p className="g-text-2 text-[13px]">Not checked yet — the first position appears after the next check.</p>;
  return (
    <div data-testid={`keyword-history-${id}`}>
      {points.length > 1 && (
        <div className="h-40">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--g-divider)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} />
              <YAxis reversed allowDecimals={false} domain={[1, "auto"]} tick={tick} axisLine={false} tickLine={false} width={30} />
              <Tooltip labelFormatter={(v) => fmtDate(String(v))} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {devices.includes("desktop") && <Line type="monotone" dataKey="desktop" name="Desktop" stroke="#1a73e8" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
              {devices.includes("mobile") && <Line type="monotone" dataKey="mobile" name="Mobile" stroke="#e8710a" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <table className="g-table mt-2">
        <thead><tr><th>Checked</th>{devices.map((d) => <th key={d} className="num">{d === "desktop" ? "Desktop" : "Mobile"}</th>)}<th>Ranking page</th></tr></thead>
        <tbody>
          {[...points].reverse().slice(0, 12).map((p) => (
            <tr key={p.date}>
              <td>{fmtDate(p.date)}</td>
              {devices.map((d) => <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p[d] ?? (p.checked?.[d] === false ? <span className="g-text-2" title="Not checked on this device that day">—</span> : "not ranked")}</td>)}
              <td data-label="Page" className="max-w-[320px] truncate">{p.url ? <a href={p.url} className="g-link" target="_blank" rel="noreferrer">{p.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : <span className="g-text-2">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
