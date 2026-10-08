/**
 * /seo/ai — AI visibility: when a customer asks ChatGPT, Google Gemini or
 * Perplexity for what you do, are you named, and is your website one of their
 * sources? Ask a question, read each answer, and keep the history. A second
 * tool lists the questions for which Google's AI answers already use a site.
 * Each run shows its price first; reopening a saved result is free.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiSummaryPanel } from "./ai-summary";
import { api, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useSelectedSite, useSeoSites, useSeoStatus, type SeoStatus } from "./shell";

type Engine = "chatgpt" | "gemini" | "perplexity";
type Source = { domain: string; title: string | null; url: string | null; ours: boolean };
type Answer = { engine: Engine; model: string; mentioned: boolean; cited: boolean; listedAt: number | null; businesses: string[]; sources: Source[]; searches: string[]; answer: string; at?: string; runId?: string | null };
type PromptHistory = { prompt: string; lastAt: string; runId?: string | null; latest: (Answer & { at: string })[]; history: { at: string; engine: Engine; mentioned: boolean; cited: boolean; listedAt: number | null }[] };
type Data = { businessName: string | null; domain: string; prompts: PromptHistory[]; suggestions: string[]; tracked?: { id: number; prompt: string; engines: Engine[]; nextAt: string }[]; maxTracked?: number };
type Mention = { question: string; searches: number | null; answer: string; sources: { domain: string; title: string | null; ours: boolean }[]; seenAt: string | null };
type MentionsPage = { domain: string; platform: "google" | "chat_gpt"; total: number | null; rows: Mention[]; fetchedAt: string };

const ENGINES: { key: Engine; label: string; price: "aiChatgpt" | "aiGemini" | "aiPerplexity" }[] = [
  { key: "chatgpt", label: "ChatGPT", price: "aiChatgpt" }, { key: "gemini", label: "Google Gemini", price: "aiGemini" }, { key: "perplexity", label: "Perplexity", price: "aiPerplexity" },
];
const LABEL = Object.fromEntries(ENGINES.map((e) => [e.key, e.label])) as Record<Engine, string>;
const card = { borderColor: "var(--g-divider)", background: "var(--g-surface)" };
const can = (status: SeoStatus | undefined, cents: number | null) => cents == null || !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= cents;

function Verdict({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className="inline-flex items-center gap-1 text-[13px]" style={{ color: ok ? "var(--g-green)" : "var(--g-red)" }}>{ok ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}{ok ? yes : no}</span>;
}

function AnswerCard({ a, name, stale }: { a: Answer; name: string | null; /** From an earlier ask than the others shown. */ stale?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border p-4" style={card} data-testid={`ai-answer-${a.engine}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="g-text text-[15px] font-medium">{LABEL[a.engine]}</h3>
        {a.at && <span className="g-text-2 text-[12px]">asked {fmtDate(a.at)}</span>}
      </div>
      {stale && <p className="g-text-2 mb-2 text-[12px]" data-testid={`ai-stale-${a.engine}`}>Not asked the last time — this is its answer from {fmtDate(a.at)}.</p>}
      <div className="flex flex-col gap-1">
        <Verdict ok={a.mentioned} yes={a.listedAt ? `Named you — ${a.listedAt === 1 ? "first" : `#${a.listedAt}`} of ${a.businesses.length} businesses` : "Named you"} no={name ? `Did not name ${name}` : "Did not name you"} />
        <Verdict ok={a.cited} yes="Used your website as a source" no="Did not use your website as a source" />
      </div>
      {a.businesses.length > 0 && (
        <div className="mt-3">
          <h4 className="g-text-2 mb-1 text-[12px]" title="Read from the names the answer sets in bold">Businesses it named, in the order it listed them</h4>
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px]">{a.businesses.map((b, i) => <li key={b} className={a.listedAt === i + 1 ? "g-text font-medium" : "g-text"}>{b}{a.listedAt === i + 1 ? " · you" : ""}</li>)}</ol>
        </div>
      )}
      {a.sources.length > 0 && (
        <div className="mt-3">
          <h4 className="g-text-2 mb-1 text-[12px]">Websites it used</h4>
          <ul className="flex flex-wrap gap-1.5 text-[12px]">{a.sources.map((s) => <li key={s.domain} className="g-chip g-chip--sm" style={{ textTransform: "none", ...(s.ours ? { borderColor: "var(--g-green)", color: "var(--g-green)" } : {}) }} title={s.title ?? undefined}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer nofollow">{s.domain}</a> : s.domain}{s.ours ? " · you" : ""}</li>)}</ul>
        </div>
      )}
      {a.searches.length > 0 && <p className="g-text-2 mt-3 text-[12px]">It searched the web for: {a.searches.map((q) => `"${q}"`).join(", ")}</p>}
      <button type="button" className="g-link mt-3 text-[13px]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide the answer" : "Read the answer"}</button>
      {open && <p className="g-text mt-2 whitespace-pre-wrap text-[13px] leading-relaxed" data-testid={`ai-text-${a.engine}`}>{a.answer || "The assistant returned no text."}</p>}
    </section>
  );
}

function Mentions({ status, domain: initial }: { status: SeoStatus | undefined; domain: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState(initial);
  const [platform, setPlatform] = useState<"google" | "chat_gpt">("google");
  const [asked, setAsked] = useState<{ domain: string; platform: "google" | "chat_gpt" } | null>(null);
  useEffect(() => { setInput(initial); setAsked(null); }, [initial]);
  const body = useMemo(() => asked ?? { domain: "", platform }, [asked, platform]);
  const queryKey = ["/api/seo/ai/mentions", body];
  const saved = useQuery<{ page: MentionsPage } | null>({
    queryKey, enabled: !!asked, retry: false, staleTime: 5 * 60_000,
    queryFn: async () => { try { return await api("POST", "/api/seo/ai/mentions", { ...body, peek: true }); } catch (e) { if (isNotRunYet(e)) return null; throw e; } },
  });
  const run = useMutation({
    mutationFn: (v: { body: unknown; key: readonly unknown[] }) => api("POST", "/api/seo/ai/mentions", v.body),
    onSuccess: (data: unknown, v) => { qc.setQueryData(v.key, data); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] }); },
    onError: (e) => toast({ title: "Couldn't look that up", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const price = status?.prices?.aiMentions ?? null, page = saved.data?.page ?? null;
  return (
    <section className="mt-8" data-testid="ai-mentions">
      <h2 className="g-text text-[18px] font-medium">Where AI answers already use a website</h2>
      <p className="g-text-2 mb-3 text-[13px]">The questions for which Google's AI Overviews (or ChatGPT) quote a site as a source — yours, or a competitor's to see what earns them the mention. A local business often has none yet; a big brand has thousands.</p>
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""); if (d) setAsked({ domain: d, platform }); }} data-testid="form-ai-mentions">
        <label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Website</span><input className="g-input w-full" value={input} onChange={(e) => setInput(e.target.value)} placeholder="example.com" autoComplete="off" data-testid="input-ai-mentions-domain" /></label>
        <label><span className="sr-only">Which AI</span><select className="g-input g-select" value={platform} onChange={(e) => setPlatform(e.target.value as "google" | "chat_gpt")} data-testid="select-ai-mentions-platform"><option value="google">Google AI Overviews</option><option value="chat_gpt">ChatGPT</option></select></label>
        <Button type="submit" disabled={!input.trim()} data-testid="button-ai-mentions-check"><Search className="mr-1 h-4 w-4" /> Check</Button>
      </form>
      {asked && saved.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Checking for a saved result…</p>}
      {asked && saved.isError && <div className="g-callout" role="alert"><h3>Couldn't check for a saved result</h3><p>{apiErrorMessage(saved.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void saved.refetch()}>Try again</button></div>}
      {asked && saved.isSuccess && !page && (
        <Empty testId="ai-mentions-not-run">
          <h3>AI mentions of {asked.domain}</h3>
          <p>Not looked up yet.{!can(status, price) && " You don't have enough SEO data left — add credit above."}</p>
          <Button className="mt-2" disabled={run.isPending || !status?.configured || !can(status, price)} onClick={() => run.mutate({ body, key: queryKey })} data-testid="button-ai-mentions-run">{run.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Looking…</> : `Look it up${price != null ? ` — about ${money(price)}` : ""}`}</Button>
        </Empty>
      )}
      {page && (
        <div data-testid="ai-mentions-result">
          <p className="g-text mb-2 text-[14px]"><b className="font-medium tabular-nums">{fmtNum(page.total ?? page.rows.length)}</b> {page.platform === "google" ? "Google AI Overview" : "ChatGPT"} answer{(page.total ?? page.rows.length) === 1 ? "" : "s"} use {page.domain} as a source <span className="g-text-2 text-[12px]">· as of {fmtDate(page.fetchedAt)} · United States</span></p>
          {page.rows.length === 0 ? <Empty><h3>No AI answers use this site yet</h3><p>That is normal for a local business. AI answers lean on pages that explain a topic clearly and are quoted by other sites — guides, comparisons, cost pages — and on review and directory sites. The "Ask the AIs" check above shows who they name today for your service and city.</p></Empty> : (
            <div className="overflow-x-auto"><table className="g-table w-full" data-testid="table-ai-mentions">
              <thead><tr><th>Question people ask</th><th className="num">Searches / mo</th><th>Other sites used in the same answer</th><th className="num">Seen</th></tr></thead>
              <tbody>{page.rows.map((m) => <tr key={m.question}><td className="max-w-[320px]" title={m.answer}>{m.question}</td><td className="num">{fmtNum(m.searches)}</td><td className="g-text-2 text-[12px]">{m.sources.filter((s) => !s.ours).slice(0, 5).map((s) => s.domain).join(", ") || "—"}</td><td className="num g-text-2">{fmtDate(m.seenAt)}</td></tr>)}</tbody>
            </table></div>
          )}
          {(page.total ?? 0) > page.rows.length && <p className="g-text-2 mt-2 text-[12px]">Showing the {page.rows.length} most-searched of {fmtNum(page.total)}.</p>}
        </div>
      )}
    </section>
  );
}

export default function SeoAiPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/ai`;
  const q = useQuery<Data>({ queryKey: [key], enabled: !!site, refetchOnMount: "always" });
  const [prompt, setPrompt] = useState("");
  const [engines, setEngines] = useState<Engine[]>(["chatgpt", "gemini", "perplexity"]);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [name, setName] = useState("");
  /** The answers just paid for, shown straight away — also when saving them to the history failed. */
  const [lastRun, setLastRun] = useState<{ prompt: string; answers: Answer[]; at: string; runId: string; saved: boolean } | null>(null);
  // An answer that comes back after the site was switched belongs to the site it was asked for, not the one on screen.
  const siteRef = useRef<number | undefined>(site?.id);
  siteRef.current = site?.id;
  useEffect(() => { setPrompt(""); setOpenPrompt(null); setLastRun(null); }, [site?.id]);
  const d = q.data;
  const price = status.data?.prices ? engines.reduce((a, e) => a + (status.data!.prices[ENGINES.find((x) => x.key === e)!.price] ?? 0), 0) : null;
  // What must be available to start (the most it can cost), which is more than the usual price.
  const hold = status.data?.prices ? engines.reduce((a, e) => { const k = ENGINES.find((x) => x.key === e)!.price; return a + (status.data!.holds?.[k] ?? status.data!.prices[k] ?? 0); }, 0) : null;
  const ask = useMutation({
    mutationFn: (p: string) => api("POST", `${key}/ask`, { prompt: p, engines }),
    onSuccess: (r: { siteId: number; prompt: string; runId: string; saved: boolean; answers: Answer[]; failed: Engine[] }) => {
      void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${r.siteId}/ai`] }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith(`/api/seo/sites/${r.siteId}/ai/summary`) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (r.siteId !== siteRef.current) return;
      setLastRun({ prompt: r.prompt, answers: r.answers.map((a) => ({ ...a, runId: r.runId })), at: new Date().toISOString(), runId: r.runId, saved: r.saved });
      setOpenPrompt(r.prompt); setPrompt("");
      if (r.failed.length) toast({ title: `${r.failed.map((e) => LABEL[e]).join(" and ")} didn't answer`, description: "You were not charged for it. The others are below.", variant: "destructive" });
    },
    onError: (e) => toast({ title: "Couldn't ask the assistants", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const saveName = useMutation({
    mutationFn: () => api("POST", `/api/seo/sites/${site!.id}/settings`, { businessName: name.trim() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: [key] }); void qc.invalidateQueries({ queryKey: ["/api/seo/sites"] }); toast({ title: "Business name saved" }); },
    onError: (e) => toast({ title: "Couldn't save the name", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const track = useMutation({
    mutationFn: (v: { prompt: string; on: boolean; engines: Engine[] }) => api("POST", `${key}/track`, v.on ? v : { prompt: v.prompt, on: false }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: [key] }); toast({ title: v.on ? "This question will be asked again every month" : "Monthly asking stopped" }); },
    onError: (e) => toast({ title: "Couldn't change that", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const savedShown = d?.prompts.find((p) => p.prompt === openPrompt) ?? d?.prompts[0] ?? null;
  // The run just made is on screen at once. Normally the history has it too a moment later; if saving failed, this is all there is.
  // ...until the history itself holds that run (matched by its id, never by time).
  const inHistory = !!lastRun && !!d?.prompts.some((p) => p.runId === lastRun.runId);
  const showRun = !!lastRun && !inHistory && (openPrompt === null || openPrompt === lastRun.prompt);
  const unsaved = showRun && !!lastRun && !lastRun.saved;
  const shown: PromptHistory | null = showRun && lastRun ? { prompt: lastRun.prompt, lastAt: lastRun.at, runId: lastRun.runId, latest: lastRun.answers.map((a) => ({ ...a, at: lastRun.at })), history: savedShown?.prompt === lastRun.prompt ? savedShown.history : [] } : savedShown;
  // Answers belong together only when they came from the same ask (older rows have no run id: those go by the minute).
  const isFresh = (a: { at: string; runId?: string | null }) => !!shown && (shown.runId ? a.runId === shown.runId : Date.parse(shown.lastAt) - Date.parse(a.at) < 60_000);
  const freshAnswers = shown ? shown.latest.filter(isFresh) : [];
  const namesIt = !!shown && !!d?.businessName && shown.prompt.toLowerCase().includes(d.businessName.toLowerCase());
  const toggle = (e: Engine) => setEngines((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]));
  const ready = prompt.trim().length >= 8 && engines.length > 0;

  return (
    <SeoShell title="AI visibility" description="When a customer asks ChatGPT, Gemini or Perplexity for what you do — are you named, and is your website one of their sources?" site={site} onSite={onSite} sites={sites} status={status}>
      {!site && sites.isSuccess && <Empty testId="ai-empty-sites"><h3>No sites yet</h3><p>Add your site above; then ask the assistants the question your customers ask.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="ai-error"><h3>Couldn't load AI visibility</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && d && (
        <>
          <AiSummaryPanel site={site} />
          {!d.businessName && (
            <form className="g-callout mb-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveName.mutate(); }} data-testid="form-ai-business-name">
              <h3>First: what is your business called?</h3>
              <p>An answer usually names a business, not its web address. Enter the name exactly as on your Google Business Profile so we can tell whether you were named.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Business name</span><input className="g-input w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Alpine Exteriors" data-testid="input-ai-business-name" /></label>
                <Button type="submit" disabled={!name.trim() || saveName.isPending}>{saveName.isPending ? "Saving…" : "Save name"}</Button></div>
            </form>
          )}
          <form className="rounded-lg border p-4" style={card} onSubmit={(e) => { e.preventDefault(); if (ready) ask.mutate(prompt.trim()); }} data-testid="form-ai-ask">
            <h2 className="g-text text-[16px] font-medium">Ask the assistants</h2>
            <label className="mt-2 block text-[13px]"><span className="g-text-2">The question a customer would ask</span>
              <textarea className="g-input mt-1 min-h-[72px] w-full py-2" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="Who are the best siding contractors in Bellingham, WA? Name specific companies." data-testid="textarea-ai-prompt" />
            </label>
            {d.suggestions.length > 0 && <p className="g-text-2 mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">From your tracked keywords: {d.suggestions.map((s) => <button key={s} type="button" className="g-pill g-pill--sm !h-auto !py-1 text-left" style={{ whiteSpace: "normal" }} onClick={() => setPrompt(s)}>{s}</button>)}</p>}
            <fieldset className="mt-3"><legend className="g-text-2 text-[13px]">Ask</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {ENGINES.map((e) => <label key={e.key} className="flex items-center gap-2"><input type="checkbox" checked={engines.includes(e.key)} onChange={() => toggle(e.key)} data-testid={`checkbox-ai-${e.key}`} /> <span className="g-text">{e.label}</span>{status.data?.prices?.[e.price] != null && <span className="g-text-2 text-[12px]">about {money(status.data.prices[e.price])}</span>}</label>)}
              </div>
            </fieldset>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!ready || ask.isPending || !status.data?.configured || !can(status.data, hold)} data-testid="button-ai-ask">{ask.isPending ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Asking — up to a minute…</> : `Ask${price != null && engines.length ? ` — about ${money(price)}` : ""}`}</Button>
              <span className="g-text-2 text-[13px]">{!can(status.data, hold) ? `You need ${hold != null ? money(hold) : "more"} of SEO data available to start (the most it can cost) — add credit above.` : "Each assistant is asked with its web search on, as a customer would use it. Answers vary from one day to the next; the history shows the trend."}</span>
            </div>
          </form>

          {d.prompts.length === 0 && !shown && !ask.isPending && <Empty testId="ai-empty"><h3>Nothing asked yet</h3><p>Ask the question your customers ask — "best roofing contractor in my city" — and see which businesses each assistant names, and which websites it relied on.</p></Empty>}
          {shown && (
            <section className="mt-5" data-testid="ai-result">
              <h2 className="g-text mb-1 text-[16px] font-medium">"{shown.prompt}"</h2>
              {unsaved && !ask.isPending && <p className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="ai-unsaved">These answers are shown but could not be added to your history. Copy anything you want to keep.</p>}
              {namesIt && <p className="g-text-2 mb-2 text-[13px]" data-testid="ai-names-it">Your question names your business, so being named back proves little. Ask it the way a stranger would — the service and the city, no names.</p>}
              <p className="g-text-2 mb-3 text-[13px]">Named by {freshAnswers.filter((a) => a.mentioned).length} of the {freshAnswers.length} assistant{freshAnswers.length === 1 ? "" : "s"} asked on {fmtDate(shown.lastAt)} <button type="button" className="g-link ml-2" disabled={ask.isPending} onClick={() => ask.mutate(shown.prompt)} data-testid="button-ai-again">Ask again{price != null ? ` — about ${money(price)}` : ""}</button></p>
              {(() => { const t = d.tracked?.find((x) => x.prompt.toLowerCase() === shown.prompt.toLowerCase()); const asked = shown.latest.map((a) => a.engine); const monthly = status.data?.prices ? (t ? t.engines : asked).reduce((a, e) => a + (status.data!.prices[ENGINES.find((x) => x.key === e)!.price] ?? 0), 0) : null; return (
                <label className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="ai-track">
                  <input type="checkbox" checked={!!t} disabled={track.isPending} onChange={(e) => track.mutate({ prompt: shown.prompt, on: e.target.checked, engines: asked })} data-testid="checkbox-ai-track" />
                  <span className="g-text">Ask this again every month</span>
                  <span className="g-text-2 text-[12px]">{t ? `next on ${fmtDate(t.nextAt)} · ` : ""}{monthly != null ? `about ${money(monthly)} a month, taken from your included SEO data only — it is skipped when that has run out` : ""}</span>
                </label>
              ); })()}
              <div className="grid gap-4 lg:grid-cols-3">{ENGINES.map((e) => shown.latest.find((a) => a.engine === e.key)).filter((a): a is Answer & { at: string } => !!a).map((a) => <AnswerCard key={a.engine} a={a} name={d.businessName} stale={!isFresh(a)} />)}</div>
              {shown.history.length > 0 && (
                <details className="mt-3 text-[13px]" data-testid="ai-history"><summary className="g-link cursor-pointer">Earlier answers to this question ({shown.history.length})</summary>
                  <table className="g-table mt-2"><thead><tr><th>Asked</th><th>Assistant</th><th>Named you</th><th>Used your website</th></tr></thead>
                    <tbody>{shown.history.map((h, i) => <tr key={i}><td>{fmtDate(h.at)}</td><td>{LABEL[h.engine]}</td><td>{h.mentioned ? `Yes${h.listedAt ? ` (#${h.listedAt})` : ""}` : "No"}</td><td>{h.cited ? "Yes" : "No"}</td></tr>)}</tbody></table>
                </details>
              )}
            </section>
          )}
          {d.prompts.length > 1 && (
            <section className="mt-6" data-testid="ai-prompts">
              <h2 className="g-text mb-2 text-[16px] font-medium">Questions you have asked</h2>
              <div className="overflow-x-auto"><table className="g-table w-full">
                <thead><tr><th>Question</th>{ENGINES.map((e) => <th key={e.key}>{e.label}</th>)}<th className="num">Last asked</th></tr></thead>
                <tbody>{d.prompts.map((p) => (
                  <tr key={p.prompt}>
                    <td className="max-w-[420px]"><button type="button" className="g-link text-left" aria-current={shown?.prompt === p.prompt ? "true" : undefined} onClick={() => { setOpenPrompt(p.prompt); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{p.prompt}</button></td>
                    {ENGINES.map((e) => { const a = p.latest.find((x) => x.engine === e.key); return <td key={e.key}>{!a ? <span className="g-text-2">not asked</span> : <>{a.mentioned ? <span style={{ color: "var(--g-green)" }}>Named{a.listedAt ? ` #${a.listedAt}` : ""}</span> : <span style={{ color: "var(--g-red)" }}>Not named</span>}{(p.runId ? a.runId !== p.runId : false) && <span className="g-text-2 text-[12px]"> · {fmtDate(a.at)}</span>}</>}</td>; })}
                    <td className="num g-text-2">{fmtDate(p.lastAt)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          )}
          {(d.tracked?.length ?? 0) > 0 && (
            <section className="mt-6" data-testid="ai-tracked">
              <h2 className="g-text mb-1 text-[16px] font-medium">Asked again every month</h2>
              <p className="g-text-2 mb-2 text-[13px]">{d.tracked!.length} of {d.maxTracked ?? 5} questions. Each uses your included SEO data only, and is skipped in a month when that has run out.</p>
              <ul className="space-y-1 text-[13px]">
                {d.tracked!.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="g-text min-w-0 flex-1">{t.prompt}</span>
                    <span className="g-text-2 text-[12px]">{t.engines.map((e) => LABEL[e] ?? e).join(", ")} · next {fmtDate(t.nextAt)}</span>
                    <button type="button" className="g-pill g-pill--sm" disabled={track.isPending} onClick={() => track.mutate({ prompt: t.prompt, on: false, engines: t.engines })} aria-label={`Stop asking "${t.prompt}" every month`} data-testid={`button-ai-stop-${t.id}`}>Stop</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="g-text-2 mt-4 text-[12px]">Your question is sent to each assistant through our data provider and the answers are kept in your history. The assistants are asked through their programming interfaces with web search on; the app on your phone can answer a little differently. To be named more often: keep your Google Business Profile and reviews current, get listed on the directories the assistants quote (they are in "Websites it used"), and publish pages that answer the question plainly. See who they quote, then check those sites in <Link href="/seo/explorer" className="g-link">Site explorer</Link>.</p>
          <Mentions status={status.data} domain={d.domain} />
        </>
      )}
    </SeoShell>
  );
}
