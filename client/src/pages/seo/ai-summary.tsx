/**
 * AI visibility → the picture so far (server/seo/ai-summary.ts): across the questions asked for this site, how often
 * the assistants name it and use its website, month by month, and which businesses and websites they name instead.
 * Read from saved answers — free. Every figure says how many answers it rests on.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtNum, type SeoSite } from "./shell";
import { AddToPlan, type PlanTask } from "./plan-button";

type Count = { answers: number; mentioned: number; cited: number };
type Summary = {
  nowDays: number; now: Count & { questions: number; first: number };
  byEngine: (Count & { engine: string })[]; byMonth: (Count & { month: string; questions: number })[];
  businesses: { name: string; answers: number; questions: number }[];
  sources: { domain: string; answers: number; questions: number; ours: boolean; rival: boolean; directory?: string }[];
  truncated?: boolean;
  trend: { months: string[]; answers: number[]; questions: number[]; you: number[]; names: { name: string; counts: number[] }[] };
  compare: Compare | null;
};
type Compare = {
  from: string; to: string; options: string[]; pairs: number; questions: number;
  you: { before: number; after: number }; cited: { before: number; after: number };
  names: { name: string; before: number; after: number }[]; sources: { domain: string; before: number; after: number; rival: boolean }[];
};
const change = (before: number, after: number) => after === before ? "no change" : after > before ? `up ${after - before}` : `down ${before - after}`;

/** Who the assistants named, month by month — each cell out of that month's answers, which can differ in what was asked. */
function TrendCard({ s }: { s: Summary }) {
  const t = s.trend;
  if (t.months.length < 2) return null;
  const rows = [{ name: "You", counts: t.you, you: true }, ...t.names.map((n) => ({ ...n, you: false }))];
  return (
    <div className="rounded-lg border p-4 lg:col-span-2" style={card} data-testid="ai-summary-trend">
      <h3 className="g-text mb-1 text-[14px] font-medium">Who gets named, month by month</h3>
      <p className="g-text-2 mb-2 text-[12px]">Answers that named each business, out of that month's answers (the newest answer to each question from each assistant). The other businesses are the {t.names.length} named most often across these months.</p>
      <div className="overflow-x-auto">
        <table className="g-table w-full" data-testid="table-ai-trend">
          <thead><tr><th>Business</th>{t.months.map((m, i) => <th key={m} className="num" title={`${fmtNum(t.answers[i])} answers to ${fmtNum(t.questions[i])} questions`}>{monthName(m)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="max-w-[14rem] truncate" title={r.name}>{r.you ? <b className="font-medium">You</b> : r.name}</td>
                {r.counts.map((c, i) => <td key={t.months[i]} className="num whitespace-nowrap" data-label={monthName(t.months[i])}>{of(c, t.answers[i])}</td>)}
              </tr>
            ))}
            <tr><td className="g-text-2 text-[12px]">Questions asked</td>{t.questions.map((q, i) => <td key={t.months[i]} className="num g-text-2 text-[12px]" data-label={monthName(t.months[i])}>{fmtNum(q)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="g-text-2 mt-2 text-[12px]">Months can hold different questions and assistants, so a column is not like for like with the next — {s.compare ? "the comparison below is" : "the newest month shares no question asked of the same assistant with any earlier month, so there is no like-for-like comparison; ask the same questions again"}. Names are read from what the answers set in bold: one business written two ways can appear twice. Months are calendar months in UTC.</p>
      {s.truncated && <p className="mt-1 text-[12px]" role="status" style={{ color: "#b06000" }}>There are more saved answers than are read at once, so the oldest months here may be missing answers.</p>}
    </div>
  );
}

/** Two months, like for like: only the questions both months asked the same assistant. */
function CompareCard({ c, vs, setVs, loading, truncated }: { c: Compare; vs: string | null; setVs: (m: string) => void; loading: boolean; truncated?: boolean }) {
  // While a newly chosen month loads, the select shows the choice and the figures are dimmed; once loaded it shows the
  // month the figures are for (the server falls back to the default when the chosen one can no longer be compared).
  const pending = loading && !!vs && vs !== c.from;
  const line = (label: string, x: { before: number; after: number }) => (
    <li className="flex flex-wrap items-baseline gap-x-2"><span className="g-text">{label}</span><span className="g-text-2 tabular-nums">{of(x.before, c.pairs)} → {of(x.after, c.pairs)}</span><span className="g-text-2 text-[12px]">({change(x.before, x.after)})</span></li>
  );
  return (
    <div className="rounded-lg border p-4 lg:col-span-2" style={card} data-testid="ai-summary-compare" aria-busy={loading}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="g-text text-[14px] font-medium">Like for like: {monthName(c.to)} against</h3>
        <label className="sr-only" htmlFor="ai-compare-month">Month to compare with</label>
        <select id="ai-compare-month" className="g-select" value={pending ? vs! : c.from} onChange={(e) => setVs(e.target.value)} data-testid="select-ai-compare">
          {c.options.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          {pending && !c.options.includes(vs!) && <option value={vs!}>{monthName(vs!)}</option>}
        </select>
        {pending && <span className="g-text-2 text-[12px]" role="status">Updating…</span>}
      </div>
      {!loading && vs && vs !== c.from && <p className="mb-1 text-[12px]" role="status" style={{ color: "#b06000" }} data-testid="text-ai-compare-fallback">{monthName(vs)} can no longer be compared with {monthName(c.to)}; showing {monthName(c.from)}.</p>}
      <div className={pending ? "opacity-50" : undefined}>
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-ai-compare-basis">Only the {fmtNum(c.pairs)} answer{c.pairs === 1 ? "" : "s"} to {fmtNum(c.questions)} question{c.questions === 1 ? "" : "s"} asked of the same assistant in both months count — so a change here is not from asking something different. {c.pairs < 6 ? "That is a small sample: one answer more or less moves it." : ""}</p>
      <ul className="mb-3 space-y-1 text-[13px]">{line("Named you", c.you)}{line("Used your website as a source", c.cited)}</ul>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="g-text mb-1 text-[13px] font-medium">Other names</h4>
          {c.names.length === 0 ? <p className="g-text-2 text-[12px]">No other name was picked out in these answers.</p> : (
            <table className="g-table w-full" data-testid="table-ai-compare-names">
              <thead><tr><th>Name</th><th className="num">{monthName(c.from)}</th><th className="num">{monthName(c.to)}</th></tr></thead>
              <tbody>{c.names.map((n) => <tr key={n.name}><td className="max-w-[12rem] truncate" title={n.name}>{n.name}{n.before === 0 && <span className="g-text-2 text-[12px]"> · new</span>}{n.after === 0 && <span className="g-text-2 text-[12px]"> · gone</span>}</td><td className="num" data-label={monthName(c.from)}>{fmtNum(n.before)}</td><td className="num" data-label={monthName(c.to)}>{fmtNum(n.after)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div>
          <h4 className="g-text mb-1 text-[13px] font-medium">Websites among the sources</h4>
          {c.sources.length === 0 ? <p className="g-text-2 text-[12px]">These answers listed no other websites as sources.</p> : (
            <table className="g-table w-full" data-testid="table-ai-compare-sources">
              <thead><tr><th>Website</th><th className="num">{monthName(c.from)}</th><th className="num">{monthName(c.to)}</th></tr></thead>
              <tbody>{c.sources.map((x) => <tr key={x.domain}><td className="max-w-[12rem] truncate" title={x.domain}>{x.domain}{x.rival && <span className="g-text-2 text-[12px]"> · a competitor you follow</span>}</td><td className="num" data-label={monthName(c.from)}>{fmtNum(x.before)}</td><td className="num" data-label={monthName(c.to)}>{fmtNum(x.after)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <p className="g-text-2 mt-2 text-[12px]">Counts are answers out of {fmtNum(c.pairs)}, biggest change first{c.names.length >= 15 || c.sources.length >= 15 ? " (the 15 with the biggest change in each list)" : ""}. Assistants' answers vary from one asking to the next, so a small change can be chance. Months are calendar months in UTC.</p>
      {truncated && <p className="mt-1 text-[12px]" role="status" style={{ color: "#b06000" }}>There are more saved answers than are read at once; if {monthName(c.from)} is among the oldest, some of its answers may be missing here.</p>}
      </div>
    </div>
  );
}
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Google Gemini", perplexity: "Perplexity" };
const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const of = (n: number, total: number) => `${fmtNum(n)} of ${fmtNum(total)}`;

function Bar({ n, total, label }: { n: number; total: number; label: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-[4rem] flex-1 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden><div className="h-full" style={{ width: `${pct}%`, background: "var(--g-green)" }} /></div>
      <span className="g-text w-24 shrink-0 text-right text-[12px] tabular-nums"><span className="sr-only">{label}: </span>{of(n, total)}</span>
    </div>
  );
}

export function AiSummaryPanel({ site }: { site: SeoSite }) {
  // Asked again when the window is looked at and every few minutes: the monthly questions, or another tab, may have added answers.
  // The chosen month belongs to the site it was chosen for: another site starts from its own default.
  const [chosen, setChosen] = useState<{ siteId: number; vs: string } | null>(null);
  const vs = chosen?.siteId === site.id ? chosen.vs : null;
  const setVs = (m: string) => setChosen({ siteId: site.id, vs: m });
  const base = `/api/seo/sites/${site.id}/ai/summary`;
  const q = useQuery<Summary>({
    queryKey: [vs ? `${base}?vs=${vs}` : base], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 60_000, refetchInterval: 5 * 60_000,
    // Keep showing the previous figures while another month loads — for the same site only.
    placeholderData: (prev, prevQuery) => (typeof prevQuery?.queryKey[0] === "string" && prevQuery.queryKey[0].startsWith(base) ? prev : undefined),
  });
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status" data-testid="ai-summary-loading">Adding up your saved answers…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't add up your saved answers: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const s = q.data;
  // Nothing saved at all: the page's own introduction says what to do; no empty panel.
  if (!s || (s.now.answers === 0 && s.byMonth.length === 0)) return null;
  const months = (
    <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-months">
      <h3 className="g-text mb-2 text-[14px] font-medium">Month by month</h3>
      {s.byMonth.length < 2 && s.now.answers > 0 ? <p className="g-text-2 text-[13px]">One month of answers so far. Ask the same questions again next month — or tick "ask every month" — to see whether this moves.</p> : (
        <table className="g-table w-full">
          <thead><tr><th>Month</th><th className="num">Questions</th><th className="num">Named you</th><th className="num">Used your site</th></tr></thead>
          <tbody>{s.byMonth.map((m) => <tr key={m.month}><td>{monthName(m.month)}</td><td className="num" data-label="Questions">{fmtNum(m.questions)}</td><td className="num" data-label="Named you">{of(m.mentioned, m.answers)}</td><td className="num" data-label="Used your site">{of(m.cited, m.answers)}</td></tr>)}</tbody>
        </table>
      )}
      {s.byMonth.length >= 2 && <p className="g-text-2 mt-2 text-[12px]">Each month counts the newest answer to each question from each assistant. Months can hold different questions and different assistants, so they are not like for like — the Questions column says how many each rests on.</p>}
      {s.truncated && <p className="g-text-2 mt-2 text-[12px]" role="status">There are more saved answers than are read at once; the oldest months may be incomplete.</p>}
    </div>
  );
  // Answers on record, but none recent: the history is still shown, and "now" is not claimed.
  if (s.now.answers === 0) return (
    <section className="mb-6" data-testid="ai-summary">
      <h2 className="g-text text-[16px] font-medium">The picture so far</h2>
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]" data-testid="text-ai-summary">No answers from the last {s.nowDays} days, so there is nothing to say about now. Ask your questions again to bring this up to date; the earlier months are below.</p>
      <div className="grid gap-4 lg:grid-cols-2">{months}<TrendCard s={s} />{s.compare && <CompareCard c={s.compare} vs={vs} setVs={setVs} loading={q.isFetching} truncated={s.truncated} />}</div>
    </section>
  );
  const others = s.sources.filter((x) => !x.ours);
  const task = (x: Summary["sources"][number]): PlanTask => ({ kind: "link_prospect", title: `Check that your ${x.directory ?? x.domain} profile is accurate — ${x.domain} was among the sources of answers to ${x.questions} of your questions`, target: x.domain, facts: { answers: x.answers, questions: x.questions }, source: `ai-source:${x.domain}` });
  return (
    <section className="mb-6" data-testid="ai-summary">
      <h2 className="g-text text-[16px] font-medium">The picture so far</h2>
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]" data-testid="text-ai-summary">
        Across your {fmtNum(s.now.questions)} question{s.now.questions === 1 ? "" : "s"}, counting for each question the newest answer from each assistant ({fmtNum(s.now.answers)} answer{s.now.answers === 1 ? "" : "s"} from the last {s.nowDays} days): you were named in <b className="g-text font-medium">{of(s.now.mentioned, s.now.answers)}</b> and your website was used as a source in <b className="g-text font-medium">{of(s.now.cited, s.now.answers)}</b>{s.now.first > 0 ? `; you were the first business named in ${fmtNum(s.now.first)}` : ""}. These are your own questions — a sample, not every question people ask.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-engines">
          <h3 className="g-text mb-2 text-[14px] font-medium">By assistant — answers that named you</h3>
          <ul className="space-y-2 text-[13px]">
            {s.byEngine.map((e) => <li key={e.engine}><div className="g-text mb-0.5">{ENGINE[e.engine] ?? e.engine}</div><Bar n={e.mentioned} total={e.answers} label={`${ENGINE[e.engine] ?? e.engine} named you in`} /></li>)}
          </ul>
        </div>
        {months}
        <TrendCard s={s} />
        {s.compare && <CompareCard c={s.compare} vs={vs} setVs={setVs} loading={q.isFetching} truncated={s.truncated} />}
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-businesses">
          <h3 className="g-text mb-1 text-[14px] font-medium">Other names in the answers</h3>
          {s.businesses.length === 0 ? <p className="g-text-2 text-[13px]">No other name was picked out in these answers — which is not the same as no other business being mentioned.</p> : (
            <>
              <ul className="space-y-1.5 text-[13px]">
                {s.businesses.slice(0, 10).map((b) => <li key={b.name}><div className="g-text mb-0.5 truncate" title={b.name}>{b.name}</div><Bar n={b.answers} total={s.now.answers} label={`${b.name} was named in`} /></li>)}
              </ul>
              <p className="g-text-2 mt-2 text-[12px]">Mostly other businesses — but read from what the answers set in bold, so a heading can slip in, one business written two ways can appear twice, and yours could appear under a spelling we did not recognise. Answers out of your {fmtNum(s.now.answers)}.</p>
            </>
          )}
        </div>
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-sources">
          <h3 className="g-text mb-1 text-[14px] font-medium">Websites among the answers' sources</h3>
          {others.length === 0 ? <p className="g-text-2 text-[13px]">{s.sources.length ? "Only your own website was used as a source." : "These answers listed no sources."}</p> : (
            <>
              <table className="g-table w-full" data-testid="table-ai-sources">
                <thead><tr><th>Website</th><th className="num" title={`Out of your ${s.now.answers} newest answers`}>Answers</th><th className="num">Questions</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {others.slice(0, 12).map((x) => (
                    <tr key={x.domain}>
                      <td className="max-w-[14rem] truncate"><Link href={`/seo/explorer?domain=${encodeURIComponent(x.domain)}`} className="g-link" title={`Open ${x.domain} in Site explorer`}>{x.domain}</Link>{x.rival && <span className="g-text-2 text-[12px]"> · a competitor you follow</span>}{x.directory && <span className="g-text-2 text-[12px]"> · a directory or profile site</span>}</td>
                      <td className="num" data-label="Answers">{fmtNum(x.answers)}</td><td className="num" data-label="Questions">{fmtNum(x.questions)}</td>
                      <td className="num">{x.directory && <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-ai-${x.domain}`} tasks={[task(x)]} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="g-text-2 mt-2 text-[12px]">The websites the saved answers listed as their sources. Many are other businesses' own sites. Where one is a directory or review site, it is worth checking that your profile there is accurate — which page of it an assistant read, and whether that changes a future answer, is not known.{s.now.cited > 0 ? ` Your own website was among the sources of ${of(s.now.cited, s.now.answers)} answers.` : ""}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
