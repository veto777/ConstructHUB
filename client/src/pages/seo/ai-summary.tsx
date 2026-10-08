/**
 * AI visibility → the picture so far (server/seo/ai-summary.ts): across the questions asked for this site, how often
 * the assistants name it and use its website, month by month, and which businesses and websites they name instead.
 * Read from saved answers — free. Every figure says how many answers it rests on.
 */
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
};
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
  const q = useQuery<Summary>({ queryKey: [`/api/seo/sites/${site.id}/ai/summary`], refetchOnMount: "always" });
  if (q.isLoading) return null;
  if (q.isError) return <p className="g-text-2 mb-4 text-[13px]" role="alert">Couldn't add up your saved answers: {apiErrorMessage(q.error)} <button type="button" className="g-link" onClick={() => void q.refetch()}>Try again</button></p>;
  const s = q.data;
  // Nothing asked yet (or not lately): the page's own introduction says what to do; no empty panel.
  if (!s || s.now.answers === 0) return null;
  const others = s.sources.filter((x) => !x.ours);
  const task = (x: Summary["sources"][number]): PlanTask => ({ kind: "link_prospect", title: `Check your ${x.directory ?? x.domain} profile — AI assistants read ${x.domain} for ${x.questions} of your questions`, target: x.domain, facts: { answers: x.answers, questions: x.questions }, source: `ai-source:${x.domain}` });
  return (
    <section className="mb-6" data-testid="ai-summary">
      <h2 className="g-text text-[16px] font-medium">The picture so far</h2>
      <p className="g-text-2 mb-3 max-w-3xl text-[13px]" data-testid="text-ai-summary">
        Across your {fmtNum(s.now.questions)} question{s.now.questions === 1 ? "" : "s"}, counting the newest answer from each assistant ({fmtNum(s.now.answers)} answer{s.now.answers === 1 ? "" : "s"} from the last {s.nowDays} days): you were named in <b className="g-text font-medium">{of(s.now.mentioned, s.now.answers)}</b> and your website was used as a source in <b className="g-text font-medium">{of(s.now.cited, s.now.answers)}</b>{s.now.first > 0 ? `; you were the first business named in ${fmtNum(s.now.first)}` : ""}. These are your own questions — a sample, not every question people ask.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-engines">
          <h3 className="g-text mb-2 text-[14px] font-medium">By assistant — answers that named you</h3>
          <ul className="space-y-2 text-[13px]">
            {s.byEngine.map((e) => <li key={e.engine}><div className="g-text mb-0.5">{ENGINE[e.engine] ?? e.engine}</div><Bar n={e.mentioned} total={e.answers} label={`${ENGINE[e.engine] ?? e.engine} named you in`} /></li>)}
          </ul>
        </div>
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-months">
          <h3 className="g-text mb-2 text-[14px] font-medium">Month by month</h3>
          {s.byMonth.length < 2 ? <p className="g-text-2 text-[13px]">One month of answers so far. Ask the same questions again next month — or tick "ask every month" — to see whether this moves.</p> : (
            <table className="g-table w-full">
              <thead><tr><th>Month</th><th className="num">Questions</th><th className="num">Named you</th><th className="num">Used your site</th></tr></thead>
              <tbody>{s.byMonth.map((m) => <tr key={m.month}><td>{monthName(m.month)}</td><td className="num">{fmtNum(m.questions)}</td><td className="num">{of(m.mentioned, m.answers)}</td><td className="num">{of(m.cited, m.answers)}</td></tr>)}</tbody>
            </table>
          )}
          {s.byMonth.length >= 2 && <p className="g-text-2 mt-2 text-[12px]">Each month counts the newest answer to each question from each assistant. Months with different questions are not like for like — the Questions column says how many each rests on.</p>}
        </div>
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-businesses">
          <h3 className="g-text mb-1 text-[14px] font-medium">Other businesses the assistants named</h3>
          {s.businesses.length === 0 ? <p className="g-text-2 text-[13px]">No other business was named in these answers.</p> : (
            <>
              <ul className="space-y-1.5 text-[13px]">
                {s.businesses.slice(0, 10).map((b) => <li key={b.name}><div className="g-text mb-0.5 truncate" title={b.name}>{b.name}</div><Bar n={b.answers} total={s.now.answers} label={`${b.name} was named in`} /></li>)}
              </ul>
              <p className="g-text-2 mt-2 text-[12px]">Read from the names the answers set in bold, so a name written two ways can appear twice and a heading can slip in. Answers out of your {fmtNum(s.now.answers)}.</p>
            </>
          )}
        </div>
        <div className="rounded-lg border p-4" style={card} data-testid="ai-summary-sources">
          <h3 className="g-text mb-1 text-[14px] font-medium">Websites the assistants drew on</h3>
          {others.length === 0 ? <p className="g-text-2 text-[13px]">{s.sources.length ? "Only your own website was used as a source." : "These answers listed no sources."}</p> : (
            <>
              <table className="g-table w-full" data-testid="table-ai-sources">
                <thead><tr><th>Website</th><th className="num" title={`Out of your ${s.now.answers} newest answers`}>Answers</th><th className="num">Questions</th><th><span className="sr-only">Action plan</span></th></tr></thead>
                <tbody>
                  {others.slice(0, 12).map((x) => (
                    <tr key={x.domain}>
                      <td className="max-w-[14rem] truncate"><Link href={`/seo/explorer?domain=${encodeURIComponent(x.domain)}`} className="g-link" title={`Open ${x.domain} in Site explorer`}>{x.domain}</Link>{x.rival && <span className="g-text-2 text-[12px]"> · a competitor you follow</span>}{x.directory && <span className="g-text-2 text-[12px]"> · a directory or profile site</span>}</td>
                      <td className="num">{fmtNum(x.answers)}</td><td className="num">{fmtNum(x.questions)}</td>
                      <td className="num">{x.directory && <AddToPlan siteId={site.id} label="Plan" testId={`button-plan-ai-${x.domain}`} tasks={[task(x)]} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="g-text-2 mt-2 text-[12px]">The pages an assistant read while answering. Many are other businesses' own websites. Where one is a directory or review site, having a complete profile there puts your business in front of the assistant — it is no promise of being named.{s.sources.some((x) => x.ours) ? ` Your own website was used in ${fmtNum(s.sources.find((x) => x.ours)!.answers)} of these answers.` : ""}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
