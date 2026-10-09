/**
 * AI visibility → the picture so far (server/seo/ai-summary.ts): across the questions asked for this site, how often
 * the assistants name it and use its website, month by month, and which businesses and websites they name instead.
 * Read from saved answers — free. Every figure says how many answers it rests on, and every figure, row and cell is a
 * link to the answers it counts (links.ts seoLinks.ai: month, assistant, named, cited, first, business, source), which
 * the page lists under a chip that says what narrowed them. The like-for-like month is the address too (?vs=).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiErrorMessage } from "@/lib/queryClient";
import { fmtNum, useAddress, type SeoSite } from "./shell";
import { seoLinks, setParam } from "./links";
import { AddToPlan, type PlanTask } from "./plan-button";
import { BarList, BLUE_WORDS, CARD, FIGURE_LINK, Heading, LinkedFigure, MetricRow, MiniBar, QUIET_LINK, RatioBar, TEXT_LINK } from "./viz-more";

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
const figure = FIGURE_LINK;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Who the assistants named, month by month — each cell out of that month's answers, which can differ in what was asked. */
function TrendCard({ s, siteId }: { s: Summary; siteId: number }) {
  const t = s.trend;
  if (t.months.length < 2) return null;
  const rows = [{ name: "You", counts: t.you, you: true }, ...t.names.map((n) => ({ ...n, you: false }))];
  // A row is the answers naming that business (you: the answers that named you); a cell is the same in one month.
  const rowLink = (r: { name: string; you: boolean }, month?: string) => seoLinks.ai(siteId, r.you ? { month, named: true } : { month, business: r.name });
  return (
    <div className="min-w-0 rounded-xl border p-3 sm:p-4 lg:col-span-2" style={card} data-testid="ai-summary-trend">
      <Heading level={3} className="!mb-1">Who gets named, month by month</Heading>
      <p className="g-text-2 mb-2 text-[12px]">Answers that named each business, out of that month's answers (the newest answer to each question from each assistant). The other businesses are the {t.names.length} named most often across these months. Under each month: how many answers and questions it rests on.</p>
      <div className="overflow-x-auto">
        <table className="g-table w-full" data-testid="table-ai-trend">
          <thead><tr><th>Business</th>{t.months.map((m, i) => <th key={m} className="num"><Link href={seoLinks.ai(siteId, { month: m })} className={TEXT_LINK}>{monthName(m)}</Link><span className="g-text-2 block text-[11px] font-normal"><Link href={seoLinks.ai(siteId, { month: m })} className={QUIET_LINK}>{fmtNum(t.answers[i])} answers · {fmtNum(t.questions[i])} questions</Link></span></th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="max-w-[14rem] truncate" title={r.name}><Link href={rowLink(r)} className={TEXT_LINK} data-testid={r.you ? "link-ai-trend-you" : undefined}>{r.you ? <b className="font-medium">You</b> : r.name}</Link></td>
                {r.counts.map((c, i) => <td key={t.months[i]} className="num whitespace-nowrap" data-label={monthName(t.months[i])}><Link href={rowLink(r, t.months[i])} className={figure}>{of(c, t.answers[i])}</Link></td>)}
              </tr>
            ))}
            <tr><td className="g-text-2 text-[12px]">Answers counted</td>{t.answers.map((a, i) => <td key={t.months[i]} className="num g-text-2 text-[12px]" data-label={monthName(t.months[i])}><Link href={seoLinks.ai(siteId, { month: t.months[i] })} className={QUIET_LINK}>{fmtNum(a)}</Link></td>)}</tr>
            <tr><td className="g-text-2 text-[12px]">Questions asked</td>{t.questions.map((q, i) => <td key={t.months[i]} className="num g-text-2 text-[12px]" data-label={monthName(t.months[i])}><Link href={seoLinks.ai(siteId, { month: t.months[i] })} className={QUIET_LINK}>{fmtNum(q)}</Link></td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="g-text-2 mt-2 text-[12px]">Months can hold different questions and assistants, so a column is not like for like with the next — {s.compare ? "the comparison below is" : "the newest month shares no question asked of the same assistant with any earlier month, so there is no like-for-like comparison; ask the same questions again"}. Names are read from what the answers set in bold: one business written two ways can appear twice. Months are calendar months in UTC.</p>
      {s.truncated && <p className="mt-1 text-[12px]" role="status" style={{ color: "#b06000" }}>There are more saved answers than are read at once, so the oldest months here may be missing answers.</p>}
    </div>
  );
}

/** Two months, like for like: only the questions both months asked the same assistant. The earlier month is the address (?vs=). */
function CompareCard({ c, vs, loading, truncated, siteId }: { c: Compare; vs: string | null; loading: boolean; truncated?: boolean; siteId: number }) {
  // While a newly chosen month loads, the select shows the choice and the figures are dimmed; once loaded it shows the
  // month the figures are for (the server falls back to the default when the chosen one can no longer be compared).
  const pending = loading && !!vs && vs !== c.from;
  const to = (p: { named?: boolean; cited?: boolean } = {}) => seoLinks.ai(siteId, { month: c.to, ...p }), from = (p: { named?: boolean; cited?: boolean } = {}) => seoLinks.ai(siteId, { month: c.from, ...p });
  // "x → y (up 2)": each figure opens that month's answers, narrowed the same way.
  const line = (label: string, x: { before: number; after: number }, p: { named?: boolean; cited?: boolean }) => (
    <li className="flex flex-wrap items-baseline gap-x-2"><Link href={to(p)} className={TEXT_LINK}>{label}</Link><span className="g-text-2 tabular-nums"><Link href={from(p)} className={QUIET_LINK}>{of(x.before, c.pairs)}</Link> → <Link href={to(p)} className={QUIET_LINK}>{of(x.after, c.pairs)}</Link></span><Link href={to(p)} className={`${QUIET_LINK} g-text-2 text-[12px]`}>({change(x.before, x.after)})</Link></li>
  );
  return (
    <div className="min-w-0 rounded-xl border p-3 sm:p-4 lg:col-span-2" style={card} data-testid="ai-summary-compare" aria-busy={loading}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Heading level={3} className="!mb-0">Like for like: <Link href={to()} className={QUIET_LINK} data-testid="link-ai-compare-to">{monthName(c.to)}</Link> against</Heading>
        <label className="sr-only" htmlFor="ai-compare-month">Month to compare with</label>
        {/* The month picked is written to the address (?vs=), so the comparison can be linked to and the back button undoes the pick. */}
        <select id="ai-compare-month" className="g-input g-select !w-auto min-h-11" value={pending ? vs! : c.from} onChange={(e) => setParam("vs", e.target.value)} data-testid="select-ai-compare">
          {c.options.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          {pending && !c.options.includes(vs!) && <option value={vs!}>{monthName(vs!)}</option>}
        </select>
        <Link href={from()} className={`${TEXT_LINK} text-[12px]`} data-testid="link-ai-compare-from">that month's answers</Link>
        {pending && <span className="g-text-2 text-[12px]" role="status">Updating…</span>}
      </div>
      {!loading && vs && vs !== c.from && <p className="mb-1 text-[12px]" role="status" style={{ color: "#b06000" }} data-testid="text-ai-compare-fallback">{MONTH.test(vs) ? monthName(vs) : `"${vs}"`} can no longer be compared with {monthName(c.to)}{MONTH.test(vs) ? "" : " (not a month, YYYY-MM)"}; showing {monthName(c.from)}.</p>}
      <div className={pending ? "opacity-50" : undefined}>
      <p className="g-text-2 mb-2 text-[12px]" data-testid="text-ai-compare-basis">Only <Link href={to()} className={QUIET_LINK}>the {fmtNum(c.pairs)} answer{c.pairs === 1 ? "" : "s"} to {fmtNum(c.questions)} question{c.questions === 1 ? "" : "s"}</Link> asked of the same assistant in both months count — so a change here is not from asking something different. {c.pairs < 6 ? "That is a small sample: one answer more or less moves it." : ""}</p>
      <ul className="mb-3 space-y-1 text-[13px]">{line("Named you", c.you, { named: true })}{line("Used your website as a source", c.cited, { cited: true })}</ul>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[13px] font-medium" style={BLUE_WORDS}>Other names</h4>
          {c.names.length === 0 ? <p className="g-text-2 text-[12px]">No other name was picked out in these answers.</p> : (
            <table className="g-table w-full" data-testid="table-ai-compare-names">
              <thead><tr><th>Name</th><th className="num"><Link href={from()} className={QUIET_LINK}>{monthName(c.from)}</Link></th><th className="num"><Link href={to()} className={QUIET_LINK}>{monthName(c.to)}</Link></th></tr></thead>
              <tbody>{c.names.map((n) => <tr key={n.name}><td className="max-w-[12rem] truncate" title={n.name}><Link href={seoLinks.ai(siteId, { business: n.name })} className={TEXT_LINK}>{n.name}</Link>{n.before === 0 && <> <Link href={seoLinks.ai(siteId, { month: c.to, business: n.name })} className={`${QUIET_LINK} g-text-2 text-[12px]`}>· new</Link></>}{n.after === 0 && <> <Link href={seoLinks.ai(siteId, { month: c.from, business: n.name })} className={`${QUIET_LINK} g-text-2 text-[12px]`}>· gone</Link></>}</td><td className="num" data-label={monthName(c.from)}><Link href={seoLinks.ai(siteId, { month: c.from, business: n.name })} className={figure}>{fmtNum(n.before)}</Link></td><td className="num" data-label={monthName(c.to)}><Link href={seoLinks.ai(siteId, { month: c.to, business: n.name })} className={figure}>{fmtNum(n.after)}</Link></td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-[13px] font-medium" style={BLUE_WORDS}>Websites among the sources</h4>
          {c.sources.length === 0 ? <p className="g-text-2 text-[12px]">These answers listed no other websites as sources.</p> : (
            <table className="g-table w-full" data-testid="table-ai-compare-sources">
              <thead><tr><th>Website</th><th className="num"><Link href={from()} className={QUIET_LINK}>{monthName(c.from)}</Link></th><th className="num"><Link href={to()} className={QUIET_LINK}>{monthName(c.to)}</Link></th></tr></thead>
              <tbody>{c.sources.map((x) => <tr key={x.domain}><td className="max-w-[12rem] truncate" title={x.domain}><Link href={seoLinks.explorer(x.domain)} className={TEXT_LINK} title={`Open ${x.domain} in Site explorer`}>{x.domain}</Link>{x.rival && <> <Link href={seoLinks.rankTracker(siteId, { panel: "competitors" })} className={`${QUIET_LINK} g-text-2 text-[12px]`}>· a competitor you follow</Link></>}</td><td className="num" data-label={monthName(c.from)}><Link href={seoLinks.ai(siteId, { month: c.from, source: x.domain })} className={figure}>{fmtNum(x.before)}</Link></td><td className="num" data-label={monthName(c.to)}><Link href={seoLinks.ai(siteId, { month: c.to, source: x.domain })} className={figure}>{fmtNum(x.after)}</Link></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>
      <p className="g-text-2 mt-2 text-[12px]">Counts are answers out of <Link href={to()} className={QUIET_LINK}>{fmtNum(c.pairs)}</Link>, biggest change first{c.names.length >= 15 || c.sources.length >= 15 ? " (the 15 with the biggest change in each list)" : ""}. Assistants' answers vary from one asking to the next, so a small change can be chance. Months are calendar months in UTC. A month's figure opens every saved answer of that month, not only the like-for-like pairs.</p>
      {truncated && <p className="mt-1 text-[12px]" role="status" style={{ color: "#b06000" }}>There are more saved answers than are read at once; if {monthName(c.from)} is among the oldest, some of its answers may be missing here.</p>}
      </div>
    </div>
  );
}
const ENGINE: Record<string, string> = { chatgpt: "ChatGPT", gemini: "Google Gemini", perplexity: "Perplexity" };
const card = CARD;
export const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const of = (n: number, total: number) => `${fmtNum(n)} of ${fmtNum(total)}`;

export function AiSummaryPanel({ site }: { site: SeoSite }) {
  // Asked again when the window is looked at and every few minutes: the monthly questions, or another tab, may have added answers.
  // The like-for-like month is the address (?vs=): a link can name it, and another site starts from its own default once the page drops it.
  const vsParam = useAddress().get("vs");
  const vs = vsParam && MONTH.test(vsParam) ? vsParam : null;
  const base = `/api/seo/sites/${site.id}/ai/summary`;
  const q = useQuery<Summary>({
    queryKey: [vs ? `${base}?vs=${vs}` : base], refetchOnMount: "always", refetchOnWindowFocus: true, staleTime: 60_000, refetchInterval: 5 * 60_000,
    // Keep showing the previous figures while another month loads — for the same site only.
    placeholderData: (prev, prevQuery) => (typeof prevQuery?.queryKey[0] === "string" && prevQuery.queryKey[0].startsWith(base) ? prev : undefined),
  });
  if (q.isLoading) return <p className="g-text-2 mb-4 text-[13px]" role="status" data-testid="ai-summary-loading">Adding up your saved answers…</p>;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't add up your saved answers: {apiErrorMessage(q.error)} <button type="button" className={TEXT_LINK} onClick={() => void q.refetch()}>Try again</button></p>;
  const s = q.data;
  // Nothing saved at all: the page's own introduction says what to do; no empty panel.
  if (!s || (s.now.answers === 0 && s.byMonth.length === 0)) return null;
  const id = site.id;
  const months = (
    <div className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} data-testid="ai-summary-months">
      <Heading level={3}>Month by month</Heading>
      {s.byMonth.length > 0 && (
        <div className="overflow-x-auto"><table className="g-table w-full">
          <thead><tr><th>Month</th><th className="num">Questions</th><th className="num">Named you</th><th className="num">Used your site</th></tr></thead>
          {/* A month opens its answers; the named / used figures open them narrowed to those. */}
          <tbody>{s.byMonth.map((m) => <tr key={m.month}><td><Link href={seoLinks.ai(id, { month: m.month })} className={TEXT_LINK} data-testid={`link-ai-month-${m.month}`}>{monthName(m.month)}</Link></td><td className="num" data-label="Questions"><Link href={seoLinks.ai(id, { month: m.month })} className={figure}>{fmtNum(m.questions)}</Link></td><td className="num" data-label="Named you"><MiniBar value={m.mentioned} total={m.answers} className="mr-2" /><Link href={seoLinks.ai(id, { month: m.month, named: true })} className={figure}>{of(m.mentioned, m.answers)}</Link></td><td className="num" data-label="Used your site"><MiniBar value={m.cited} total={m.answers} className="mr-2" /><Link href={seoLinks.ai(id, { month: m.month, cited: true })} className={figure}>{of(m.cited, m.answers)}</Link></td></tr>)}</tbody>
        </table></div>
      )}
      {s.byMonth.length < 2 && s.now.answers > 0 && <p className="g-text-2 mt-2 text-[13px]">One month of answers so far. Ask the same questions again next month — or tick "ask every month" — to see whether this moves.</p>}
      {s.byMonth.length >= 2 && <p className="g-text-2 mt-2 text-[12px]">Each month counts the newest answer to each question from each assistant. Months can hold different questions and different assistants, so they are not like for like — the Questions column says how many each rests on.</p>}
      {s.truncated && <p className="g-text-2 mt-2 text-[12px]" role="status">There are more saved answers than are read at once; the oldest months may be incomplete.</p>}
    </div>
  );
  // Answers on record, but none recent: the history is still shown, and "now" is not claimed.
  if (s.now.answers === 0) return (
    <section className="mb-6" data-testid="ai-summary">
      <Heading className="!mb-0">The picture so far</Heading>
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]" data-testid="text-ai-summary">No answers from the last {s.nowDays} days, so there is nothing to say about now. Ask your questions again to bring this up to date; the earlier months are below.</p>
      <div className="grid gap-4 lg:grid-cols-2">{months}<TrendCard s={s} siteId={id} />{s.compare && <CompareCard c={s.compare} vs={vsParam} loading={q.isFetching} truncated={s.truncated} siteId={id} />}</div>
    </section>
  );
  const others = s.sources.filter((x) => !x.ours);
  /** The answers the headline figures rest on: the newest to each question from each assistant, from the last nowDays days. */
  const now = seoLinks.ai(id, { latest: true, days: s.nowDays });
  /** The answers a headline figure counts, narrowed one way more: so the landing list holds exactly the figure's answers. */
  const nowWith = (p: { named?: boolean; cited?: boolean; first?: boolean; assistant?: string; business?: string; source?: string }) => seoLinks.ai(id, { latest: true, days: s.nowDays, ...p });
  const task = (x: Summary["sources"][number]): PlanTask => ({ kind: "link_prospect", title: `Check that your ${x.directory ?? x.domain} profile is accurate — ${x.domain} was among the sources of answers to ${x.questions} of your questions`, target: x.domain, facts: { answers: x.answers, questions: x.questions }, source: `ai-source:${x.domain}` });
  return (
    <section className="mb-6" data-testid="ai-summary">
      <Heading className="!mb-0">The picture so far</Heading>
      {/* The headline figures: each out of the newest answers (the paragraph under them says exactly what they rest on), each a link to the answers it counts. */}
      <div className="my-3 rounded-xl border p-3 sm:p-4" style={card}>
        <MetricRow cols={4} testId="ai-summary-figures">
          <LinkedFigure href={`${seoLinks.ai(id)}#ai-prompts`} testId="ai-questions" label="Questions" value={fmtNum(s.now.questions)} foot={<Link href={now} className={QUIET_LINK} data-testid="link-ai-now">{fmtNum(s.now.answers)} answer{s.now.answers === 1 ? "" : "s"} from the last {s.nowDays} days</Link>} />
          <LinkedFigure href={nowWith({ named: true })} testId="ai-named" label="Named you" value={of(s.now.mentioned, s.now.answers)} foot="answers" chart={<RatioBar value={s.now.mentioned} total={s.now.answers} label="Named you" />} />
          <LinkedFigure href={nowWith({ cited: true })} testId="ai-cited" label="Used your website as a source" value={of(s.now.cited, s.now.answers)} foot="answers" chart={<RatioBar value={s.now.cited} total={s.now.answers} label="Used your website" />} />
          <LinkedFigure href={nowWith({ first: true })} testId="ai-first" label="Named you first" value={of(s.now.first, s.now.answers)} foot="answers" chart={<RatioBar value={s.now.first} total={s.now.answers} label="Named you first" />} />
        </MetricRow>
      </div>
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]" data-testid="text-ai-summary">
        Across your <Link href={`${seoLinks.ai(id)}#ai-prompts`} className={QUIET_LINK}>{fmtNum(s.now.questions)} question{s.now.questions === 1 ? "" : "s"}</Link>, counting for each question the newest answer from each assistant (<Link href={now} className={QUIET_LINK}>{fmtNum(s.now.answers)} answer{s.now.answers === 1 ? "" : "s"} from the last {s.nowDays} days</Link>): you were named in <Link href={nowWith({ named: true })} className={`${figure} font-medium`}>{of(s.now.mentioned, s.now.answers)}</Link> and your website was used as a source in <Link href={nowWith({ cited: true })} className={`${figure} font-medium`}>{of(s.now.cited, s.now.answers)}</Link>{s.now.first > 0 ? <>; you were the first business named in <Link href={nowWith({ first: true })} className={figure}>{fmtNum(s.now.first)}</Link></> : ""}. These are your own questions — a sample, not every question people ask.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} data-testid="ai-summary-engines">
          <Heading level={3}>By assistant — answers that named you</Heading>
          {/* Each assistant opens its answers that named you; "x of y" opens the same list, and all of that assistant's answers. */}
          <BarList rows={s.byEngine.map((e) => ({ key: e.engine, label: <Link href={nowWith({ assistant: e.engine, named: true })} className={TEXT_LINK} data-testid={`link-ai-engine-${e.engine}`}>{ENGINE[e.engine] ?? e.engine}</Link>, value: e.mentioned, total: e.answers, words: <><Link href={nowWith({ assistant: e.engine, named: true })} className={figure}>{fmtNum(e.mentioned)}</Link> of <Link href={nowWith({ assistant: e.engine })} className={figure}>{fmtNum(e.answers)}</Link></> }))} />
        </div>
        {months}
        <TrendCard s={s} siteId={id} />
        {s.compare && <CompareCard c={s.compare} vs={vsParam} loading={q.isFetching} truncated={s.truncated} siteId={id} />}
        <div className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} data-testid="ai-summary-businesses">
          <Heading level={3} className="!mb-1">Other names in the answers</Heading>
          {s.businesses.length === 0 ? <p className="g-text-2 text-[13px]">No other name was picked out in these answers — which is not the same as no other business being mentioned.</p> : (
            <>
              {/* Each name and its count open the answers that named it. */}
              <BarList rows={s.businesses.slice(0, 10).map((b) => ({ key: b.name, label: <Link href={nowWith({ business: b.name })} className={TEXT_LINK}>{b.name}</Link>, title: b.name, value: b.answers, total: s.now.answers, words: <><Link href={nowWith({ business: b.name })} className={figure}>{fmtNum(b.answers)}</Link> of <Link href={now} className={QUIET_LINK}>{fmtNum(s.now.answers)}</Link></> }))} />
              <p className="g-text-2 mt-2 text-[12px]">Mostly other businesses — but read from what the answers set in bold, so a heading can slip in, one business written two ways can appear twice, and yours could appear under a spelling we did not recognise. Answers out of your <Link href={now} className={QUIET_LINK}>{fmtNum(s.now.answers)}</Link>.</p>
            </>
          )}
        </div>
        <div className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} data-testid="ai-summary-sources">
          <Heading level={3} className="!mb-1">Websites among the answers' sources</Heading>
          {others.length === 0 ? <p className="g-text-2 text-[13px]">{s.sources.length ? <>Only <Link href={nowWith({ cited: true })} className={TEXT_LINK}>your own website</Link> was used as a source.</> : "These answers listed no sources."}</p> : (
            <>
              {/* The website opens in Site explorer; its counts open the answers that drew on it. */}
              <div className="overflow-x-auto"><table className="g-table w-full" data-testid="table-ai-sources">
                <thead><tr><th>Website</th><th className="num">Answers <span className="g-text-2 block text-[11px] font-normal">of <Link href={now} className={QUIET_LINK} data-testid="link-ai-sources-basis">your {fmtNum(s.now.answers)} newest</Link></span></th><th className="num">Questions</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {others.slice(0, 12).map((x) => (
                    <tr key={x.domain}>
                      <td className="max-w-[14rem] truncate"><Link href={seoLinks.explorer(x.domain)} className={TEXT_LINK} title={`Open ${x.domain} in Site explorer`}>{x.domain}</Link>{x.rival && <> <Link href={seoLinks.rankTracker(id, { panel: "competitors" })} className={`${QUIET_LINK} g-text-2 text-[12px]`}>· a competitor you follow</Link></>}{x.directory && <span className="g-text-2 text-[12px]"> · a directory or profile site</span>}</td>
                      <td className="num" data-label="Answers"><MiniBar value={x.answers} total={s.now.answers} className="mr-2" /><Link href={nowWith({ source: x.domain })} className={figure} data-testid={`link-ai-source-${x.domain}`}>{fmtNum(x.answers)}</Link></td><td className="num" data-label="Questions"><Link href={nowWith({ source: x.domain })} className={figure}>{fmtNum(x.questions)}</Link></td>
                      <td className="num" data-label={x.directory ? "Action plan" : undefined}>{x.directory && <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-ai-${x.domain}`} tasks={[task(x)]} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <p className="g-text-2 mt-2 text-[12px]">The websites the saved answers listed as their sources — the counts are out of the newest answers; a website's count opens every saved answer that drew on it. Many are other businesses' own sites. Where one is a directory or review site, it is worth checking that your profile there is accurate — which page of it an assistant read, and whether that changes a future answer, is not known.{s.now.cited > 0 ? <> Your own website was among the sources of <Link href={nowWith({ cited: true })} className={TEXT_LINK}>{of(s.now.cited, s.now.answers)} answers</Link>.</> : ""}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
