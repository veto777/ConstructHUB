/**
 * Rank tracker history: visibility, average position and the top-10 count over time (one figure at a time, in
 * orange), how the tracked keywords spread across the result pages at each check, and one keyword's position
 * history. All from saved checks — free to open. The page's figure row reads the same history through useRankHistory.
 * The device, tag, figure shown (`series`) and highlighted check (`date`) come from the address (rank-params.ts) and
 * every control writes it back, so a link into the panel and a choice made on it are the same thing. Every check has
 * a dated link (a keyboard and touch path beside the chart's own points).
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtDate, type SeoSite } from "./shell";
import { ORANGE, TOOLTIP } from "./viz";
import { seoLinks, setParam } from "./links";
import { NO_TAG, pageParts, SERIES_WORDS, scrollToTestId, useRankParams, type RankTo } from "./rank-params";
import { BANDS, CARD, LINK, LINK_BLOCK, PanelTitle, RankTrendPanel, SectionTitle, TABLE } from "./viz-rank";

type Device = "desktop" | "mobile";
/** One check day. `top10` is the 4–10 slice (the bands stack), so "in the top 10" is top3 + top10. */
export type HistoryDay = { date: string; checked: number; ranked: number; top3: number; top10: number; top20: number; top100: number; notRanked: number; averagePosition: number | null; visibility: number; mapPack?: number };
type History = { device: Device; devices: Device[]; tag: string | null; tags: string[]; days: HistoryDay[] };

const tick = { fontSize: 12, fill: "var(--g-text-2)" };
/** Where each band of the Positions chart leads: the table narrowed to that slice of the newest check. */
const BAND_LINK: Record<(typeof BANDS)[number]["key"], RankTo> = { top3: { band: "top3" }, top10: { positions: "4-10" }, top20: { positions: "11-20" }, top100: { positions: "21+" }, notRanked: { band: "notFound" } };
/** How often the site is checked, in the words of the tracking settings. */
const EVERY: Record<string, string> = { weekly: "every week", twice_weekly: "twice a week", daily: "every day" };
/** The device pills: 32px on desktop, 44px at phone width. */
const PILL = "g-pill g-pill--sm max-sm:!min-h-11";

/** The saved history of one device (the site's first when `device` is empty), all keywords or one tag's. One request per key, shared. */
export function useRankHistory(siteId: number | null, device: string, tag: string) {
  const params = new URLSearchParams();
  if (device) params.set("device", device);
  if (tag) params.set("tag", tag);
  const qs = params.toString();
  return useQuery<History>({ queryKey: [`/api/seo/sites/${siteId}/rank-history${qs ? `?${qs}` : ""}`], enabled: siteId != null, refetchOnMount: "always" });
}

export function RankHistoryPanel({ site }: { site: SeoSite }) {
  const p = useRankParams();
  const [, navigate] = useLocation();
  // The device and tag are the page's (the address). Keywords with no tag ("(none)") are not kept apart in the saved
  // history, so that view reads all keywords — and says so below.
  const device = p.device ?? "";
  const noTag = p.tag === NO_TAG;
  const tag = p.tag && !noTag ? p.tag : "";
  const q = useRankHistory(site.id, device, tag);
  const h = q.data;
  // A check named in the address is shown in the numbers and scrolled to.
  useEffect(() => { if (p.date && h?.days.some((d) => d.date === p.date)) return scrollToTestId(`history-row-${p.date}`); }, [p.date, h]);
  if (q.isLoading) return <p className="g-text-2 mb-4 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading history…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't load the history: {apiErrorMessage(q.error)}</p>;
  if (!h) return null;
  // What a link from here carries: the device shown (when there is a choice) and the tag, so the table reads the same
  // keywords the figure counts. "(none)" is not carried by a count — the panel's figures are over all keywords then —
  // but stays on the links that only move within the panel (a check, Clear), so the table keeps its narrowing.
  const scope: RankTo = { ...(h.devices.length > 1 ? { device: h.device } : {}), ...(tag ? { tag } : {}) };
  const to = (x: RankTo = {}) => seoLinks.rankTracker(site.id, { ...scope, ...x });
  const keep: RankTo = noTag ? { tag: NO_TAG } : {};
  const check = (date: string) => to({ ...keep, panel: "history", date });
  const dateShown = p.date && h.days.some((d) => d.date === p.date) ? p.date : null;
  // What the address asks of this panel (`series`, `date`), in the visitor's words, with a way to clear it — said even
  // when there is no check yet to show it on.
  const chip = (p.series || p.date) && (
    <span className="g-chip !min-h-8 flex-wrap gap-x-2 text-[13px] font-normal" role="status" data-testid="active-filter">
      <span>History: {[
        p.series ? (SERIES_WORDS[p.series] ? `${SERIES_WORDS[p.series]} over time` : `“${p.series}” is not a figure of this chart, so the first is shown`) : "",
        p.date ? (dateShown ? `the check of ${fmtDate(dateShown)}` : `no check was saved on “${p.date}”`) : "",
      ].filter(Boolean).join(" · ")}{h.days.length === 0 ? " — no check is saved yet" : ""}</span>
      <Link href={to({ ...keep, panel: "history" })} className={`${LINK} font-medium`} title="The history panel with nothing picked" data-testid="link-clear-history">Clear</Link>
    </span>
  );
  // Nothing checked yet and nothing to choose between: stay out of the way — unless the address asked for something here.
  if (h.days.length === 0 && !tag && h.devices.length < 2 && h.tags.length === 0) {
    return chip ? <section className="mb-5 scroll-mt-16" data-testid="rank-history"><div className="mb-2 flex flex-wrap items-center gap-2"><SectionTitle>History</SectionTitle>{chip}</div><p className="g-text-2 text-[13px]" data-testid="rank-history-empty">No checks yet on {h.device}.</p></section> : null;
  }
  const last = h.days[h.days.length - 1], first = h.days[0];
  // One figure as dated points, oldest first; a day without the figure is left out, never drawn as 0.
  const pts = (pick: (d: HistoryDay) => number | null | undefined) => h.days.flatMap((d) => { const v = pick(d); return v == null ? [] : [{ label: fmtDate(d.date), value: v, date: d.date }]; });
  // A bar of the newest check leads to those keywords; an older check's bar shows that check in the numbers below.
  const onBar = (key: keyof typeof BAND_LINK, date: string | undefined) => { if (!date) return; if (date === last.date) navigate(to(BAND_LINK[key])); else setParam("date", date); };
  const every = EVERY[site.rankFrequency ?? "weekly"] ?? "every week";
  const recent = [...h.days].reverse().slice(0, 10);
  return (
    <section className="mb-5 scroll-mt-16" data-testid="rank-history">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle>History</SectionTitle>
        {h.devices.length > 1 && (
          <div className="flex gap-1" role="group" aria-label="Device">
            {h.devices.map((d) => <button key={d} type="button" className={PILL} aria-pressed={h.device === d} style={h.device === d ? { borderColor: "var(--g-blue)", color: "var(--g-blue)" } : undefined} onClick={() => setParam("device", d)} data-testid={`button-history-${d}`}>{d === "desktop" ? "Desktop" : "Mobile"}</button>)}
          </div>
        )}
        {h.tags.length > 0 && (
          <label className="flex items-center gap-2 text-[13px]"><span className="g-text-2">Tag</span>
            <select className="g-select" value={noTag ? NO_TAG : h.tags.includes(tag) ? tag : ""} onChange={(e) => setParam("tag", e.target.value)} data-testid="select-history-tag">
              <option value="">All keywords</option>
              {h.tags.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value={NO_TAG}>No tag (shown here as all keywords)</option>
            </select>
          </label>
        )}
        {chip}
      </div>
      {noTag && <p className="g-text-2 mb-2 text-[12px]" role="status" data-testid="text-history-notag">The address asks for keywords with no tag. The saved history does not keep them apart, so this panel shows all keywords; the table below is narrowed to them.</p>}
      {h.days.length === 0 && <p className="g-text-2 text-[13px]" data-testid="rank-history-empty">No checks yet{tag ? ` for keywords tagged "${tag}"` : ""} on {h.device}.</p>}
      {h.days.length === 1 && <p className="g-text-2 mb-2 text-[13px]">One check so far (<Link href={check(first.date)} className={LINK} title="This check in the numbers below" data-testid={`link-only-check-${first.date}`}>{fmtDate(first.date)}</Link>). The trend lines appear after the next check ({every}).</p>}
      {h.days.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <RankTrendPanel title="Over time" testId="chart-visibility" selected={p.series} onSelect={(k) => setParam("series", k)} onPointClick={(pt) => { if (pt.date) setParam("date", pt.date); }} pointHref={(pt) => check(pt.date ?? first.date)} series={[
              { key: "visibility", label: "Visibility", points: pts((d) => d.visibility), format: (v) => `${v}%`, note: "Visibility estimates the share of clicks you win on these keywords: 100% means #1 for all of them, 0% means none on page one. A point on the chart, or a date below, opens that check in the numbers." },
              { key: "position", label: "Average position", points: pts((d) => d.averagePosition), format: (v) => String(v), reversed: true, note: "Ranked keywords only. #1 is at the top, so a rising line is better." },
              { key: "top3", label: "In the top 3", points: pts((d) => d.top3), note: "How many of the keywords checked that day were in Google's first three results." },
              { key: "top10", label: "In the top 10", points: pts((d) => d.top3 + d.top10), note: "How many of the keywords checked that day were in Google's first ten results." },
              ...(h.days.some((d) => d.mapPack != null) ? [{ key: "map", label: "In the map pack", points: pts((d) => d.mapPack), note: "How many of the keywords checked that day found you in the map pack." }] : []),
            ]} />
            {/* Every check as a dated link: the way to an older check for keyboard and touch (the chart is decoration). */}
            <p className="g-text-2 text-[12px]" data-testid="list-checks"><span>Checks: </span>{recent.map((d, i) => <span key={d.date}>{i ? " · " : ""}<Link href={check(d.date)} className={LINK} title={`The check of ${fmtDate(d.date)} in the numbers below`} data-testid={`link-check-${d.date}`} aria-current={d.date === dateShown ? "true" : undefined} style={d.date === dateShown ? { fontWeight: 500 } : undefined}>{fmtDate(d.date)}</Link></span>)}{h.days.length > recent.length ? <span> · and <Link href={check(h.days[h.days.length - recent.length - 1].date)} className={LINK} title="The earlier checks, in the numbers table below (it opens on the newest of them)" data-testid="link-checks-earlier">{h.days.length - recent.length} earlier</Link> in the table below</span> : null}</p>
          </div>
          <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid="chart-positions">
            <PanelTitle>Positions <span className="g-text-2 font-normal">· <Link href={to({ checked: true })} className={LINK} title="The keywords with a saved check" data-testid="link-positions-checked">{last.checked} keyword{last.checked === 1 ? "" : "s"}</Link> checked <Link href={check(last.date)} className={LINK} title="The newest check in the numbers below" data-testid="link-positions-date">{fmtDate(last.date)}</Link></span></PanelTitle>
            <p className="g-text-2 mb-2 text-[12px]">How many of your keywords sat in each band of Google's results at each check. A band below opens those keywords from the newest check; a bar of an older check, or its date above, opens that check in the numbers.</p>
            <div className="h-48 sm:h-56" aria-hidden>
              <ResponsiveContainer>
                <BarChart data={h.days} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v) => fmtDate(String(v))} tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={30} />
                  <Tooltip labelFormatter={(v) => fmtDate(String(v))} contentStyle={TOOLTIP} cursor={{ fill: "var(--g-hover)" }} />
                  {BANDS.map((b) => <Bar key={b.key} dataKey={b.key} name={b.label} stackId="p" fill={b.color} stroke="var(--g-surface)" strokeWidth={1} isAnimationActive={false} className="cursor-pointer" onClick={(d: { payload?: { date?: string }; date?: string }) => onBar(b.key, d?.payload?.date ?? d?.date)} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]" aria-label="Bands of the newest check">
              {BANDS.map((b) => <li key={b.key} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5" style={{ background: b.color }} aria-hidden /><Link href={to(BAND_LINK[b.key])} className={LINK} title={`The keywords ${b.key === "notRanked" ? "not found" : `at ${b.label}`} in the newest check`} data-testid={`link-band-${b.key}`}>{b.label} <b className="font-medium tabular-nums">{last[b.key]}</b></Link></li>)}
            </ul>
          </div>
        </div>
      )}
      {h.days.length > 0 && (
        <details className="mt-2 text-[13px]" data-testid="rank-history-table" open={dateShown ? true : undefined}>
          <summary className="g-link cursor-pointer max-sm:min-h-11 max-sm:leading-[44px]">Show these numbers as a table</summary>
          {dateShown && <p className="g-text-2 mt-2 text-[12px]" data-testid="active-date">Showing the check of {fmtDate(dateShown)} · <Link href={to({ ...keep, panel: "history" })} className={LINK} data-testid="link-clear-date">Clear</Link></p>}
          <div className="overflow-x-auto">
            <table className={`${TABLE} mt-2`}>
              <thead><tr><th>Checked</th><th className="num">Visibility</th><th className="num">Average position</th><th className="num">In map pack</th>{BANDS.map((b) => <th key={b.key} className="num">{b.label}</th>)}</tr></thead>
              <tbody>{[...h.days].reverse().map((d) => {
                const newest = d.date === last.date, here = d.date === dateShown;
                return (
                  <tr key={d.date} data-testid={`history-row-${d.date}`} className="scroll-mt-16" style={here ? { background: "var(--g-accent-soft)" } : undefined} data-highlighted={here || undefined}>
                    <td><Link href={check(d.date)} className={LINK} title="This check, highlighted" data-testid={`link-history-date-${d.date}`}>{fmtDate(d.date)}</Link>{newest && <span className="g-text-2 text-[11px]"> · newest</span>}</td>
                    <td className="num" data-label="Visibility"><Link href={to({ panel: "history", series: "visibility", date: d.date })} className={LINK} title="Visibility over time" data-testid={`link-history-visibility-${d.date}`}>{d.visibility}%</Link></td>
                    <td className="num" data-label="Average position">{d.averagePosition == null ? "—" : <Link href={to({ panel: "history", series: "position", date: d.date })} className={LINK} title="Average position over time" data-testid={`link-history-position-${d.date}`}>{d.averagePosition}</Link>}</td>
                    <td className="num" data-label="In map pack">{d.mapPack == null ? <span title="The map pack was not measured in this check">—</span> : newest ? <Link href={to({ mapPack: true })} className={LINK} title="The keywords whose results show a map pack, the ones you were found in first" data-testid={`link-history-map-${d.date}`}>{d.mapPack}</Link> : <Link href={to({ panel: "history", series: "map", date: d.date })} className={LINK} title="In the map pack, over time" data-testid={`link-history-map-${d.date}`}>{d.mapPack}</Link>}</td>
                    {BANDS.map((b) => <td key={b.key} className="num" data-label={b.label}>{newest ? <Link href={to(BAND_LINK[b.key])} className={LINK} title={`The keywords ${b.key === "notRanked" ? "not found" : `at ${b.label}`} in this check${d[b.key] === 0 ? " (none — the table says so)" : ""}`} data-testid={`link-history-${b.key}-${d.date}`}>{d[b.key]}</Link> : <Link href={check(d.date)} className={`${LINK} g-text`} title="Only the newest check's keywords can be listed; this opens the check" data-testid={`link-history-${b.key}-${d.date}`}>{d[b.key]}</Link>}</td>)}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {h.days.length > 1 && <p className="g-text-2 mt-1 text-[12px]">Only the newest check's keywords can be listed — the table above holds each keyword's newest position; older checks are kept as these totals and in each keyword's own history.</p>}
        </details>
      )}
    </section>
  );
}

type Point = { date: string; desktop: number | null; mobile: number | null; url: string | null; checked?: { desktop: boolean; mobile: boolean } };

/**
 * One keyword's position at every saved check, #1 at the top: desktop as a solid orange line, mobile dashed. `href`
 * is where a check's date and positions lead (the site's history panel on that day).
 */
export function KeywordHistory({ id, devices, href }: { id: number; devices: Device[]; href?: (date: string) => string }) {
  const q = useQuery<{ keyword: string; points: Point[] }>({ queryKey: [`/api/seo/keywords/${id}/history`], refetchOnMount: "always", });
  if (q.isLoading) return <p className="g-text-2 flex items-center gap-2 text-[13px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.isError) return <p className="g-text-2 text-[13px]" role="alert">Couldn't load this keyword's history: {apiErrorMessage(q.error)}</p>;
  const points = q.data?.points ?? [];
  if (!points.length) return <p className="g-text-2 text-[13px]">Not checked yet — the first position appears after the next check.</p>;
  const day = (date: string, body: React.ReactNode, testId: string, title: string) => (href ? <Link href={href(date)} className={LINK} title={title} data-testid={testId}>{body}</Link> : body);
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
                <td>{day(p.date, fmtDate(p.date), `link-kw-history-date-${id}-${p.date}`, "This check in the history panel")}</td>
                {devices.map((d) => <td key={d} className="num" data-label={d === "desktop" ? "Desktop" : "Mobile"}>{p[d] != null ? day(p.date, p[d], `link-kw-history-${d}-${id}-${p.date}`, "This check in the history panel") : p.checked?.[d] === false ? <span className="g-text-2" title="Not checked on this device that day">—</span> : day(p.date, <span title="Not within the result pages the check read">not found</span>, `link-kw-history-${d}-${id}-${p.date}`, "This check in the history panel")}</td>)}
                <td data-label="Page" className="max-w-[320px] truncate">{p.url ? (() => { const at = pageParts(p.url); return at ? <Link href={seoLinks.explorer(at.domain, "pages", { path: at.path })} className={LINK_BLOCK} title={`${p.url} — this page in Site explorer`} data-testid={`link-kw-history-page-${id}-${p.date}`}>{p.url.replace(/^https?:\/\/(www\.)?/, "")}</Link> : <span title={p.url}>{p.url}</span>; })() : <span className="g-text-2">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
