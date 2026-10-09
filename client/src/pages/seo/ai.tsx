/**
 * /seo/ai — AI visibility: when a customer asks ChatGPT, Google Gemini or
 * Perplexity for what you do, are you named, and is your website one of their
 * sources? Ask a question, read each answer, and keep the history. A second
 * tool lists the questions for which Google's AI answers already use a site.
 * Each run shows its price first; reopening a saved result is free.
 *
 * The address is the view (links.ts seoLinks.ai): ?prompt= / ?question= opens one question's answers; ?month=,
 * ?assistant=, ?named=, ?cited=, ?first=, ?business=, ?source=, ?latest= and ?days= list every saved answer that
 * matches, under a chip that says what narrowed them (and what a parameter it could not apply said); ?vs= is the
 * like-for-like month of the summary; ?mentions= (+ ?platform=) fills the "Where AI answers already use a website"
 * box and shows its saved result. Every figure of the summary links here. Arriving by link never asks an assistant
 * or buys a lookup.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AiSummaryPanel, monthName } from "./ai-summary";
import { ActiveFilter, api, clearParams, Empty, fmtDate, fmtNum, isNotRunYet, money, SeoShell, useAddress, useHash, useScrollTo, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing, type SeoStatus } from "./shell";
import { seoLinks, setParam, setParams } from "./links";
import { CARD, FIGURE_LINK, Heading, LinkedFigure, MetricRow, QUIET_LINK, RatioBar, TAP, TEXT_LINK } from "./viz-more";

type Engine = "chatgpt" | "gemini" | "perplexity";
type Source = { domain: string; title: string | null; url: string | null; ours: boolean };
type Answer = { engine: Engine; model: string; mentioned: boolean; cited: boolean; listedAt: number | null; businesses: string[]; sources: Source[]; searches: string[]; answer: string; at?: string; runId?: string | null };
type PromptHistory = { prompt: string; lastAt: string; runId?: string | null; latest: (Answer & { at: string })[]; history: { at: string; engine: Engine; mentioned: boolean; cited: boolean; listedAt: number | null; businesses?: string[]; sources?: string[] }[] };
type Data = { businessName: string | null; domain: string; prompts: PromptHistory[]; suggestions: string[]; tracked?: { id: number; prompt: string; engines: Engine[]; nextAt: string }[]; maxTracked?: number };
type Mention = { question: string; searches: number | null; answer: string; sources: { domain: string; title: string | null; ours: boolean }[]; seenAt: string | null };
type MentionsPage = { domain: string; platform: "google" | "chat_gpt"; total: number | null; rows: Mention[]; fetchedAt: string };
/** One saved answer, flattened for the list the address narrows: the newest ones carry the full reading, earlier ones what was kept of it. */
type Row = { prompt: string; engine: Engine; at: string; mentioned: boolean; cited: boolean; listedAt: number | null; businesses: string[]; sources: string[]; latest: boolean };

const ENGINES: { key: Engine; label: string; price: "aiChatgpt" | "aiGemini" | "aiPerplexity" }[] = [
  { key: "chatgpt", label: "ChatGPT", price: "aiChatgpt" }, { key: "gemini", label: "Google Gemini", price: "aiGemini" }, { key: "perplexity", label: "Perplexity", price: "aiPerplexity" },
];
const LABEL = Object.fromEntries(ENGINES.map((e) => [e.key, e.label])) as Record<Engine, string>;
const card = CARD;
const can = (status: SeoStatus | undefined, cents: number | null) => cents == null || !status?.credits || status.credits.availableCents === -1 || status.credits.availableCents >= cents;
/** The parameters this page owns: dropped when the site changes (they belong to the questions of the site before). */
const OWN_PARAMS = ["prompt", "question", "month", "assistant", "named", "cited", "first", "business", "source", "latest", "days", "vs", "mentions", "platform"];
/** The ones that narrow the answers list (the question alone opens that question's answers as before). */
const FILTER_PARAMS = ["month", "assistant", "named", "cited", "first", "business", "source", "latest", "days"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The usage ledger keeps the first 90 characters of a question: a ?prompt= at least this long may be that cut. */
const LEDGER_CUT = 85;
const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** An assistant named by its key ("gemini") or its label ("Google Gemini"). */
const engineOf = (name: string | null): Engine | null => (name ? ENGINES.find((e) => same(e.key, name) || same(e.label, name))?.key ?? null : null);
const flag = (v: string | null) => v === "true" || v === "1";
/** A flag's value that is neither true nor false ("named=foo"): said in the chip, applied as nothing. */
const oddFlag = (v: string | null) => (v === null || flag(v) || v === "false" || v === "0" ? null : v);

/** A verdict in green or red; with `href` its words open the answers it is one of (the colour stays). */
function Verdict({ ok, yes, no, href }: { ok: boolean; yes: string; no: string; href?: string }) {
  return <span className="inline-flex items-center gap-1 text-[13px]" style={{ color: ok ? "var(--g-green)" : "var(--g-red)" }}>{ok ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}{href ? <Link href={href} className={QUIET_LINK} style={{ color: "inherit" }}>{ok ? yes : no}</Link> : ok ? yes : no}</span>;
}

function AnswerCard({ a, name, stale, siteId, prompt }: { a: Answer; name: string | null; /** From an earlier ask than the others shown. */ stale?: boolean; siteId: number; prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} data-testid={`ai-answer-${a.engine}`}>
      {/* The date opens this question's answers of that month; each verdict the answers to it that say the same. */}
      <Heading level={3} meta={a.at ? <>asked <Link href={seoLinks.ai(siteId, { prompt, month: a.at.slice(0, 7) })} className={QUIET_LINK}>{fmtDate(a.at)}</Link></> : undefined}><Link href={seoLinks.ai(siteId, { prompt, assistant: a.engine })} className={QUIET_LINK} title={`Every saved answer from ${LABEL[a.engine]} to this question`}>{LABEL[a.engine]}</Link></Heading>
      {stale && <p className="g-text-2 mb-2 text-[12px]" data-testid={`ai-stale-${a.engine}`}>Not asked the last time — this is its answer from <Link href={seoLinks.ai(siteId, { prompt, assistant: a.engine, month: a.at?.slice(0, 7) })} className={QUIET_LINK}>{fmtDate(a.at)}</Link>.</p>}
      <div className="flex flex-col gap-1">
        <Verdict ok={a.mentioned} yes={a.listedAt ? `Named you — ${a.listedAt === 1 ? "first" : `#${a.listedAt}`} of ${a.businesses.length} businesses` : "Named you"} no={name ? `Did not name ${name}` : "Did not name you"} href={seoLinks.ai(siteId, a.mentioned ? { prompt, ...(a.listedAt === 1 ? { first: true } : { named: true }) } : { prompt, assistant: a.engine })} />
        <Verdict ok={a.cited} yes="Used your website as a source" no="Did not use your website as a source" href={seoLinks.ai(siteId, a.cited ? { prompt, cited: true } : { prompt, assistant: a.engine })} />
      </div>
      {a.businesses.length > 0 && (
        <div className="mt-3">
          <h4 className="g-text-2 mb-1 text-[12px]" title="Read from the names the answer sets in bold">Businesses it named, in the order it listed them</h4>
          {/* Each name opens every saved answer that named it (yours: the answers that named you). */}
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px]">{a.businesses.map((b, i) => <li key={b} className={a.listedAt === i + 1 ? "g-text font-medium" : "g-text"}><Link href={a.listedAt === i + 1 ? seoLinks.ai(siteId, { named: true }) : seoLinks.ai(siteId, { business: b })} className={QUIET_LINK}>{b}</Link>{a.listedAt === i + 1 ? " · you" : ""}</li>)}</ol>
        </div>
      )}
      {a.sources.length > 0 && (
        <div className="mt-3">
          <h4 className="g-text-2 mb-1 text-[12px]">Websites it used</h4>
          {/* The website opens in Site explorer — your own the answers that used it as a source; the arrow opens the page the assistant read. */}
          <ul className="flex flex-wrap gap-1.5 text-[12px]">{a.sources.map((s) => <li key={s.domain} className="g-chip g-chip--sm !min-h-11" style={{ textTransform: "none", ...(s.ours ? { borderColor: "var(--g-green)", color: "var(--g-green)" } : {}) }} title={s.title ?? undefined}><Link href={s.ours ? seoLinks.ai(siteId, { cited: true }) : seoLinks.explorer(s.domain)} className={QUIET_LINK}>{s.domain}</Link>{s.ours ? " · you" : ""}{s.url && <a href={s.url} target="_blank" rel="noreferrer nofollow" className={TAP} aria-label={`Open the page on ${s.domain} the assistant read`}><ExternalLink className="h-3 w-3" aria-hidden /></a>}</li>)}</ul>
        </div>
      )}
      {a.searches.length > 0 && <p className="g-text-2 mt-3 text-[12px]">It searched the web for: {a.searches.map((q, i) => <span key={q}>{i > 0 && ", "}<Link href={seoLinks.keywords(q)} className={TEXT_LINK}>"{q}"</Link></span>)}</p>}
      <button type="button" className="g-link mt-3 min-h-11 text-[13px]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide the answer" : "Read the answer"}</button>
      {open && <p className="g-text mt-2 whitespace-pre-wrap text-[13px] leading-relaxed" data-testid={`ai-text-${a.engine}`}>{a.answer || "The assistant returned no text."}</p>}
    </section>
  );
}

/** The website looked up here is the address (?mentions= ?platform=): a link opens its saved result free; "Look it up" alone buys one. */
function Mentions({ status, domain: initial, wanted, siteId }: { status: SeoStatus | undefined; domain: string; wanted: { domain: string; platform: "google" | "chat_gpt" } | null; siteId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState(wanted?.domain ?? initial);
  const [platform, setPlatform] = useState<"google" | "chat_gpt">(wanted?.platform ?? "google");
  useEffect(() => { setInput(wanted?.domain ?? initial); if (wanted) setPlatform(wanted.platform); }, [initial, wanted?.domain, wanted?.platform]);
  const asked = wanted;
  const body = useMemo(() => asked ?? { domain: "", platform }, [asked?.domain, asked?.platform, platform]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <section id="ai-mentions" className="mt-8 scroll-mt-4" data-testid="ai-mentions">
      <Heading className="!mb-0 !text-[18px]">Where AI answers already use a website</Heading>
      <p className="g-text-2 mb-3 text-[13px]">The questions for which Google's AI Overviews (or ChatGPT) quote a site as a source — yours, or a competitor's to see what earns them the mention. A local business often has none yet; a big brand has thousands.</p>
      {/* "Check" writes the website and the AI to the address (one history entry): the saved result, if any, is shown free, and the back button undoes the check. */}
      <form className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); const d = cleanDomain(input); if (d) setParams({ mentions: d, platform }); }} data-testid="form-ai-mentions">
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
          <div className="mb-3"><LinkedFigure href={seoLinks.explorer(page.domain)} testId="ai-mentions-total" label={`${page.platform === "google" ? "Google AI Overview" : "ChatGPT"} answer${(page.total ?? page.rows.length) === 1 ? "" : "s"} that use ${page.domain} as a source`} value={fmtNum(page.total ?? page.rows.length)} foot={<>as of <Link href={seoLinks.ai(siteId, { mentions: page.domain, platform: page.platform })} className={QUIET_LINK}>{fmtDate(page.fetchedAt)}</Link> · United States</>} /></div>
          {page.rows.length === 0 ? <Empty><h3>No AI answers use this site yet</h3><p>That is normal for a local business. AI answers lean on pages that explain a topic clearly and are quoted by other sites — guides, comparisons, cost pages — and on review and directory sites. The "Ask the assistants" check above shows who they named, when last asked, for your service and city.</p></Empty> : (
            <div className="overflow-x-auto"><table className="g-table w-full" data-testid="table-ai-mentions">
              <thead><tr><th>Question people ask</th><th className="num">Searches / mo</th><th>Other sites used in the same answer</th><th className="num">Seen</th></tr></thead>
              {/* A question opens in Keywords explorer (its searches a month on the volume chart there); each other site in Site explorer. The date is the source's and has no view of its own: it opens the question. */}
              <tbody>{page.rows.map((m) => <tr key={m.question}><td className="max-w-[320px]" title={m.answer}><Link href={seoLinks.keywords(m.question)} className={TEXT_LINK}>{m.question}</Link></td><td className="num" data-label="Searches / mo"><Link href={seoLinks.keywords(m.question, { section: "volume" })} className={FIGURE_LINK}>{fmtNum(m.searches)}</Link></td><td className="g-text-2 text-[12px]" data-label="Other sites">{m.sources.filter((s) => !s.ours).slice(0, 5).map((s, i) => <span key={s.domain}>{i > 0 && ", "}<Link href={seoLinks.explorer(s.domain)} className={QUIET_LINK}>{s.domain}</Link></span>)}{m.sources.filter((s) => !s.ours).length === 0 && "—"}</td><td className="num g-text-2" data-label="Seen"><Link href={seoLinks.keywords(m.question)} className={QUIET_LINK} title="The source's date for this answer; opens the question">{fmtDate(m.seenAt)}</Link></td></tr>)}</tbody>
            </table></div>
          )}
          {(page.total ?? 0) > page.rows.length && <p className="g-text-2 mt-2 text-[12px]">Showing the {page.rows.length} most-searched of <Link href={seoLinks.explorer(page.domain)} className={QUIET_LINK}>{fmtNum(page.total)}</Link> (the total is the figure above; no view lists the rest).</p>}
        </div>
      )}
    </section>
  );
}

export default function SeoAiPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = `/api/seo/sites/${site?.id}/ai`;
  const q = useQuery<Data>({ queryKey: [key], enabled: !!site, refetchOnMount: "always" });
  const [prompt, setPrompt] = useState("");
  const [engines, setEngines] = useState<Engine[]>(["chatgpt", "gemini", "perplexity"]);
  const [name, setName] = useState("");
  /** The earlier answers to the question on screen, shown on request (rendered only then, so every link in them is a real anchor). */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The answers just paid for, shown straight away — also when saving them to the history failed. */
  const [lastRun, setLastRun] = useState<{ prompt: string; answers: Answer[]; at: string; runId: string; saved: boolean } | null>(null);
  // An answer that comes back after the site was switched belongs to the site it was asked for, not the one on screen.
  const siteRef = useRef<number | undefined>(site?.id);
  siteRef.current = site?.id;
  // Another site has its own questions: the question, month, assistant and the rest of the address go with the site before.
  const changeSite = (id: number) => { clearParams(OWN_PARAMS); onSite(id); };
  useEffect(() => { setPrompt(""); setLastRun(null); setHistoryOpen(false); }, [site?.id]);
  const d = q.data;
  // The question on screen comes from the address: ?prompt= by its words, ?question= a tracked question's id.
  const questionParam = params.get("question"), questionId = Number(questionParam) || null;
  const tracked = questionId ? d?.tracked?.find((t) => t.id === questionId) ?? null : null;
  /** A tracked id the site does not have (stopped, or another site's): said below; the newest question is shown. */
  const questionMissing = questionParam !== null && !!d && !tracked;
  const promptParam = params.get("prompt");
  // A ?prompt= the usage ledger cut to its first 90 characters opens the one saved question that begins with it (said below).
  const byPrefix = useMemo(() => promptParam !== null && promptParam.length >= LEDGER_CUT && d && !d.prompts.some((p) => same(p.prompt, promptParam))
    ? d.prompts.filter((p) => p.prompt.trim().toLowerCase().startsWith(promptParam.trim().toLowerCase())) : [], [d, promptParam]);
  const openPrompt = promptParam !== null ? (byPrefix.length === 1 ? byPrefix[0].prompt : promptParam) : tracked?.prompt ?? null;
  // What narrows the answers list — each parameter as read, and what could not be read (said in the chip, applied as nothing).
  const monthParam = params.get("month"), assistantParam = params.get("assistant"), daysParam = params.get("days");
  const days = daysParam !== null && /^\d{1,4}$/.test(daysParam) && Number(daysParam) > 0 ? Number(daysParam) : null;
  const filter = {
    month: monthParam && MONTH.test(monthParam) ? monthParam : null, assistant: engineOf(assistantParam), named: flag(params.get("named")), cited: flag(params.get("cited")), first: flag(params.get("first")),
    business: params.get("business"), source: params.get("source"), latest: flag(params.get("latest")), days,
  };
  /** An assistant this page does not have narrows to nothing (the chip says so) — never silently to everything. */
  const unknownAssistant = assistantParam !== null && !filter.assistant;
  const odd = (["named", "cited", "first", "latest"] as const).map((k) => [k, oddFlag(params.get(k))] as const).filter(([, v]) => v !== null);
  const filtering = FILTER_PARAMS.some((k) => params.has(k));
  const vsParam = params.get("vs");
  const mentionsParam = params.get("mentions"), platformParam = params.get("platform");
  const mentionsWanted = mentionsParam && cleanDomain(mentionsParam) ? { domain: cleanDomain(mentionsParam), platform: platformParam === "chat_gpt" ? "chat_gpt" as const : "google" as const } : null;
  const price = status.data?.prices ? engines.reduce((a, e) => a + (status.data!.prices[ENGINES.find((x) => x.key === e)!.price] ?? 0), 0) : null;
  // What must be available to start (the most it can cost), which is more than the usual price.
  const hold = status.data?.prices ? engines.reduce((a, e) => { const k = ENGINES.find((x) => x.key === e)!.price; return a + (status.data!.holds?.[k] ?? status.data!.prices[k] ?? 0); }, 0) : null;
  const ask = useMutation({
    mutationFn: (p: string) => api("POST", `${key}/ask`, { prompt: p, engines }),
    onSuccess: (r: { siteId: number; prompt: string; runId: string; saved: boolean; answers: Answer[]; failed: Engine[] }) => {
      void qc.invalidateQueries({ queryKey: [`/api/seo/sites/${r.siteId}/ai`] }); void qc.invalidateQueries({ predicate: (x) => typeof x.queryKey[0] === "string" && x.queryKey[0].startsWith(`/api/seo/sites/${r.siteId}/ai/summary`) }); void qc.invalidateQueries({ queryKey: ["/api/seo/status"] });
      if (r.siteId !== siteRef.current) return;
      setLastRun({ prompt: r.prompt, answers: r.answers.map((a) => ({ ...a, runId: r.runId })), at: new Date().toISOString(), runId: r.runId, saved: r.saved });
      // The question just asked is the one on screen — as an address, so it can be shared and the back button leaves it.
      clearParams(["question"]); setParam("prompt", r.prompt); setPrompt("");
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
  const savedShown = d?.prompts.find((p) => openPrompt !== null && same(p.prompt, openPrompt)) ?? (openPrompt === null ? d?.prompts[0] ?? null : null);
  // The run just made is on screen at once. Normally the history has it too a moment later; if saving failed, this is all there is.
  // ...until the history itself holds that run (matched by its id, never by time).
  const inHistory = !!lastRun && !!d?.prompts.some((p) => p.runId === lastRun.runId);
  const showRun = !!lastRun && !inHistory && (openPrompt === null || same(openPrompt, lastRun.prompt));
  const unsaved = showRun && !!lastRun && !lastRun.saved;
  const shown: PromptHistory | null = showRun && lastRun ? { prompt: lastRun.prompt, lastAt: lastRun.at, runId: lastRun.runId, latest: lastRun.answers.map((a) => ({ ...a, at: lastRun.at })), history: savedShown?.prompt === lastRun.prompt ? savedShown.history : [] } : savedShown;
  // Answers belong together only when they came from the same ask (older rows have no run id: those go by the minute).
  const isFresh = (a: { at: string; runId?: string | null }) => !!shown && (shown.runId ? a.runId === shown.runId : Date.parse(shown.lastAt) - Date.parse(a.at) < 60_000);
  const freshAnswers = shown ? shown.latest.filter(isFresh) : [];
  const namesIt = !!shown && !!d?.businessName && shown.prompt.toLowerCase().includes(d.businessName.toLowerCase());
  const toggle = (e: Engine) => setEngines((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e]));
  const ready = prompt.trim().length >= 8 && engines.length > 0;
  // Every saved answer, flat, for the list the address narrows; the newest per question and assistant first.
  const rows = useMemo<Row[]>(() => (d?.prompts ?? []).flatMap((p) => [
    ...p.latest.map((a): Row => ({ prompt: p.prompt, engine: a.engine, at: a.at, mentioned: a.mentioned, cited: a.cited, listedAt: a.listedAt, businesses: a.businesses, sources: a.sources.map((s) => s.domain), latest: true })),
    ...p.history.map((h): Row => ({ prompt: p.prompt, engine: h.engine, at: h.at, mentioned: h.mentioned, cited: h.cited, listedAt: h.listedAt, businesses: h.businesses ?? [], sources: h.sources ?? [], latest: false })),
  ]).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [d]);
  const sinceDays = filter.days ? Date.now() - filter.days * 864e5 : null;
  const listed = useMemo(() => !filtering || unknownAssistant ? [] : rows.filter((r) =>
    (!openPrompt || same(r.prompt, openPrompt)) && (!filter.month || r.at.slice(0, 7) === filter.month) && (!filter.assistant || r.engine === filter.assistant)
    && (!filter.named || r.mentioned) && (!filter.cited || r.cited) && (!filter.first || r.listedAt === 1) && (!filter.latest || r.latest) && (sinceDays === null || Date.parse(r.at) >= sinceDays)
    && (!filter.business || r.businesses.some((b) => same(b, filter.business!))) && (!filter.source || r.sources.some((s) => same(s, filter.source!)))), [rows, filtering, unknownAssistant, openPrompt, filter.month, filter.assistant, filter.named, filter.cited, filter.first, filter.latest, sinceDays, filter.business, filter.source]);
  // What narrowed the list, in words — and, for a parameter that could not be applied, what it said and that it was not.
  const chip = [
    "Answers", openPrompt && filtering ? `to "${openPrompt}"` : "", filter.month ? `from ${monthName(filter.month)}` : monthParam !== null ? `month="${monthParam}" — not a month (YYYY-MM), so not applied` : "",
    filter.assistant ? `by ${LABEL[filter.assistant]}` : unknownAssistant ? `by "${assistantParam}" — not an assistant here (${ENGINES.map((e) => e.label).join(", ")}), so none match` : "",
    filter.named ? "that named you" : "", filter.cited ? "that used your website as a source" : "", filter.first ? "that named you first" : "",
    filter.latest ? "the newest answer to each question from each assistant" : "", filter.days ? `from the last ${filter.days} days` : daysParam !== null ? `days="${daysParam}" — not a number of days, so not applied` : "",
    ...odd.map(([k, v]) => `${k}="${v}" — not true or false, so not applied`),
    filter.business ? `naming "${filter.business}"` : "", filter.source ? `drawing on ${filter.source}` : "",
  ].filter(Boolean).join(" · ");
  /** Everything the address narrows or opens on this page, one chip: the answers list, the like-for-like month, the AI-mentions website. */
  // A question opened by the address alone (no other narrowing) is said too, so its clear control is there: what the
  // page shows for it — that question, the tracked one by its id, or why the newest is shown instead.
  const questionWords = filtering || !d ? "" : promptParam !== null
    ? (shown && openPrompt !== null && same(shown.prompt, openPrompt) ? `One question: "${shown.prompt}"` : `"${openPrompt}" — no saved answers to it for ${site?.domain ?? "this site"}`)
    : questionParam !== null ? (tracked ? `One question, asked again every month: "${tracked.prompt}"` : `question #${questionParam} — not one asked again every month for ${site?.domain ?? "this site"}, so the newest question is shown`) : "";
  const chips = [
    questionWords,
    filtering ? `${chip} — ${fmtNum(listed.length)} of ${fmtNum(rows.length)} saved answer${rows.length === 1 ? "" : "s"}` : "",
    vsParam !== null ? (MONTH.test(vsParam) ? `like for like against ${monthName(vsParam)} (in "The picture so far")` : `vs="${vsParam}" — not a month (YYYY-MM), so the default month is compared`) : "",
    mentionsParam !== null ? (mentionsWanted ? `AI mentions of ${mentionsWanted.domain} (${mentionsWanted.platform === "google" ? "Google AI Overviews" : "ChatGPT"}) — the saved result, if there is one, at the bottom` : `mentions="${mentionsParam}" — not a website`) : "",
  ].filter(Boolean).join(" · ");
  const hash = useHash();
  useScrollTo(hash === "ai-prompts" || hash === "ai-tracked" || hash === "ai-mentions" ? hash : null, !!d);

  return (
    <SeoShell title="AI visibility" description="When a customer asks ChatGPT, Gemini or Perplexity for what you do — are you named, and is your website one of their sources?" site={site} onSite={changeSite} sites={sites} status={status}>
      {missing && site && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="ai-site-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
      {!site && sites.isSuccess && <Empty testId="ai-empty-sites"><h3>No sites yet</h3><p>Add your site above; then ask the assistants the question your customers ask.</p></Empty>}
      {site && q.isLoading && <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {site && q.isError && <div className="g-callout" role="alert" data-testid="ai-error"><h3>Couldn't load AI visibility</h3><p>{apiErrorMessage(q.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void q.refetch()}>Try again</button></div>}
      {site && d && (
        <>
          {/* One chip for everything the address narrows or opens here; its clear control drops all of it (the question too). */}
          {chips && <ActiveFilter onClear={() => clearParams([...FILTER_PARAMS, "prompt", "question", "vs", "mentions", "platform"], false)}>{chips}</ActiveFilter>}
          {questionMissing && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="ai-question-missing">Question #{questionParam} is not one asked again every month for {site.domain} (it was stopped, or belongs to another site) — showing the newest question instead.</p>}
          {byPrefix.length === 1 && <p className="g-text-2 mb-3 text-[13px]" role="status" data-testid="ai-prompt-prefix">Opened by its first {promptParam!.length} characters (what the usage ledger keeps of a question).</p>}
          {filtering && (
            <section className="mb-6" data-testid="ai-answers">
              <p className="g-text-2 mb-2 text-[12px]">Every saved answer that matches. The figures in "The picture so far" count only the newest answer to each question from each assistant (and, at the top, only those from the last weeks), so a count there can be smaller than this list.</p>
              {listed.length === 0 ? <Empty testId="ai-answers-none"><h3>No saved answer matches</h3><p>Clear the narrowing above, or ask the assistants again.</p></Empty> : (
                <div className="overflow-x-auto"><table className="g-table w-full" data-testid="table-ai-answers">
                  <thead><tr><th>Asked</th><th>Question</th><th>Assistant</th><th>Named you</th><th>Used your website</th><th>Businesses it named</th></tr></thead>
                  {/* Each cell opens the saved answers it is one of: the date its month, a verdict the answers to that question that say the same. */}
                  <tbody>{listed.map((r, i) => { const row = { prompt: r.prompt, assistant: r.engine, month: r.at.slice(0, 7) }; return (
                    <tr key={`${r.prompt}-${r.engine}-${r.at}-${i}`}>
                      <td className="whitespace-nowrap"><Link href={seoLinks.ai(site.id, { month: r.at.slice(0, 7) })} className={`${QUIET_LINK} ${TAP}`}>{fmtDate(r.at)}</Link>{!r.latest && <span className="g-text-2 block text-[11px]">an earlier ask</span>}</td>
                      <td className="max-w-[320px] !whitespace-normal [overflow-wrap:anywhere]" data-label="Question"><Link href={seoLinks.ai(site.id, { prompt: r.prompt })} className={TEXT_LINK}>{r.prompt}</Link></td>
                      <td data-label="Assistant"><Link href={seoLinks.ai(site.id, { prompt: r.prompt, assistant: r.engine })} className={QUIET_LINK}>{LABEL[r.engine]}</Link></td>
                      <td data-label="Named you"><Link href={seoLinks.ai(site.id, r.mentioned ? { ...row, ...(r.listedAt === 1 ? { first: true } : { named: true }) } : row)} className={QUIET_LINK} style={{ color: r.mentioned ? "var(--g-green)" : "var(--g-red)" }}>{r.mentioned ? `Yes${r.listedAt ? ` (#${r.listedAt})` : ""}` : "No"}</Link></td>
                      <td data-label="Used your website"><Link href={seoLinks.ai(site.id, r.cited ? { ...row, cited: true } : row)} className={QUIET_LINK} style={{ color: r.cited ? "var(--g-green)" : "var(--g-red)" }}>{r.cited ? "Yes" : "No"}</Link></td>
                      <td className="max-w-[320px] !whitespace-normal text-[12px] [overflow-wrap:anywhere]" data-label="Businesses it named">{r.businesses.length ? <>{r.businesses.slice(0, 4).map((b, k) => <span key={b}>{k > 0 && ", "}<Link href={seoLinks.ai(site.id, { business: b })} className={QUIET_LINK} style={filter.business && same(b, filter.business) ? { fontWeight: 500 } : undefined}>{b}</Link></span>)}{r.businesses.length > 4 ? <>{" "}<Link href={seoLinks.ai(site.id, { prompt: r.prompt })} className={`${QUIET_LINK} g-text-2`}>and {r.businesses.length - 4} more</Link></> : null}</> : <span className="g-text-2">{r.latest ? "none picked out" : "not kept for an earlier ask"}</span>}</td>
                    </tr>
                  ); })}</tbody>
                </table></div>
              )}
            </section>
          )}
          <AiSummaryPanel site={site} />
          {!d.businessName && (
            <form className="g-callout mb-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveName.mutate(); }} data-testid="form-ai-business-name">
              <h3>First: what is your business called?</h3>
              <p>An answer usually names a business, not its web address. Enter the name exactly as on your Google Business Profile so we can tell whether you were named.</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1 sm:max-w-sm"><span className="sr-only">Business name</span><input className="g-input w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Alpine Exteriors" data-testid="input-ai-business-name" /></label>
                <Button type="submit" disabled={!name.trim() || saveName.isPending}>{saveName.isPending ? "Saving…" : "Save name"}</Button></div>
            </form>
          )}
          <form className="min-w-0 rounded-xl border p-3 sm:p-4" style={card} onSubmit={(e) => { e.preventDefault(); if (ready) ask.mutate(prompt.trim()); }} data-testid="form-ai-ask">
            <Heading className="!mb-0">Ask the assistants</Heading>
            <label className="mt-2 block text-[13px]"><span className="g-text-2">The question a customer would ask</span>
              <textarea className="g-input mt-1 min-h-[72px] w-full py-2" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="Who are the best siding contractors in Bellingham, WA? Name specific companies." data-testid="textarea-ai-prompt" />
            </label>
            {d.suggestions.length > 0 && <p className="g-text-2 mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">From your tracked keywords: {d.suggestions.map((s) => <button key={s} type="button" className="g-pill g-pill--sm !h-auto !min-h-11 !py-1 text-left" style={{ whiteSpace: "normal" }} onClick={() => setPrompt(s)}>{s}</button>)}</p>}
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
          {openPrompt !== null && !shown && d.prompts.length > 0 && !ask.isPending && <Empty testId="ai-prompt-missing"><h3>No saved answers to "{openPrompt}"</h3><p>It has not been asked for {site.domain}, or its answers are older than the history keeps. <Link href={seoLinks.ai(site.id)} className={TEXT_LINK}>Show the newest question</Link></p>{byPrefix.length > 1 && <p className="mt-1">{byPrefix.length} saved questions begin that way: {byPrefix.map((p, i) => <span key={p.prompt}>{i > 0 && " · "}<Link href={seoLinks.ai(site.id, { prompt: p.prompt })} className={TEXT_LINK}>"{p.prompt}"</Link></span>)}</p>}</Empty>}
          {shown && (
            <section className="mt-5" data-testid="ai-result">
              {/* The question on screen is an address (?prompt=), so a report or a colleague can link straight to it. */}
              <Heading className="!mb-1"><Link href={seoLinks.ai(site.id, { prompt: shown.prompt })} className={QUIET_LINK} data-testid="link-ai-prompt">"{shown.prompt}"</Link></Heading>
              {unsaved && !ask.isPending && <p className="mb-2 text-[13px]" style={{ color: "var(--g-red)" }} role="alert" data-testid="ai-unsaved">These answers are shown but could not be added to your history. Copy anything you want to keep.</p>}
              {namesIt && <p className="g-text-2 mb-2 text-[13px]" data-testid="ai-names-it">Your question names your business, so being named back proves little. Ask it the way a stranger would — the service and the city, no names.</p>}
              <p className="g-text-2 mb-3 text-[13px]">Named by <Link href={seoLinks.ai(site.id, { prompt: shown.prompt, named: true })} className={TEXT_LINK}>{freshAnswers.filter((a) => a.mentioned).length} of the {freshAnswers.length} assistant{freshAnswers.length === 1 ? "" : "s"}</Link> asked on <Link href={seoLinks.ai(site.id, { prompt: shown.prompt, month: shown.lastAt.slice(0, 7) })} className={QUIET_LINK}>{fmtDate(shown.lastAt)}</Link> <button type="button" className="g-link ml-2 min-h-11" disabled={ask.isPending} onClick={() => ask.mutate(shown.prompt)} data-testid="button-ai-again">Ask again{price != null ? ` — about ${money(price)}` : ""}</button></p>
              {(() => { const t = d.tracked?.find((x) => x.prompt.toLowerCase() === shown.prompt.toLowerCase()); const asked = shown.latest.map((a) => a.engine); const monthly = status.data?.prices ? (t ? t.engines : asked).reduce((a, e) => a + (status.data!.prices[ENGINES.find((x) => x.key === e)!.price] ?? 0), 0) : null; return (
                <label className="mb-3 flex flex-wrap items-center gap-2 text-[13px]" data-testid="ai-track">
                  <input type="checkbox" checked={!!t} disabled={track.isPending} onChange={(e) => track.mutate({ prompt: shown.prompt, on: e.target.checked, engines: asked })} data-testid="checkbox-ai-track" />
                  <span className="g-text">Ask this again every month</span>
                  {/* The next date opens this tracked question by its id; the price opens the usage page, where it is charged. */}
                  <span className="g-text-2 text-[12px]">{t ? <>next on <Link href={seoLinks.ai(site.id, { question: t.id })} className={QUIET_LINK}>{fmtDate(t.nextAt)}</Link> · </> : ""}{monthly != null ? <>about <Link href={seoLinks.usage()} className={QUIET_LINK}>{money(monthly)} a month</Link>, taken from your included SEO data only — it is skipped when that has run out</> : ""}</span>
                </label>
              ); })()}
              {/* This ask's answers added up: named, used as a source, named first — each out of the assistants asked this time, each a link to those answers. */}
              {freshAnswers.length > 0 && (
                <div className="mb-4 rounded-xl border p-3 sm:p-4" style={card}>
                  <MetricRow cols={3} testId="ai-result-figures">
                    <LinkedFigure href={seoLinks.ai(site.id, { prompt: shown.prompt, named: true })} testId="ai-result-named" label="Named you" value={`${freshAnswers.filter((a) => a.mentioned).length} of ${freshAnswers.length}`} foot={<>assistant{freshAnswers.length === 1 ? "" : "s"} asked on <Link href={seoLinks.ai(site.id, { prompt: shown.prompt, month: shown.lastAt.slice(0, 7) })} className={QUIET_LINK}>{fmtDate(shown.lastAt)}</Link></>} chart={<RatioBar value={freshAnswers.filter((a) => a.mentioned).length} total={freshAnswers.length} label="Named you" />} />
                    <LinkedFigure href={seoLinks.ai(site.id, { prompt: shown.prompt, cited: true })} testId="ai-result-cited" label="Used your website as a source" value={`${freshAnswers.filter((a) => a.cited).length} of ${freshAnswers.length}`} chart={<RatioBar value={freshAnswers.filter((a) => a.cited).length} total={freshAnswers.length} label="Used your website" />} />
                    <LinkedFigure href={seoLinks.ai(site.id, { prompt: shown.prompt, first: true })} testId="ai-result-first" label="Named you first" value={`${freshAnswers.filter((a) => a.listedAt === 1).length} of ${freshAnswers.length}`} foot="first of the businesses it listed" chart={<RatioBar value={freshAnswers.filter((a) => a.listedAt === 1).length} total={freshAnswers.length} label="Named you first" />} />
                  </MetricRow>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-3">{ENGINES.map((e) => shown.latest.find((a) => a.engine === e.key)).filter((a): a is Answer & { at: string } => !!a).map((a) => <AnswerCard key={a.engine} a={a} name={d.businessName} stale={!isFresh(a)} siteId={site.id} prompt={shown.prompt} />)}</div>
              {shown.history.length > 0 && (
                <div className="mt-3 text-[13px]" data-testid="ai-history">
                  <button type="button" className={TEXT_LINK} aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)} data-testid="button-ai-history">{historyOpen ? "Hide the earlier answers" : `Earlier answers to this question (${shown.history.length})`}</button>
                  {historyOpen && <>
                    <div className="overflow-x-auto"><table className="g-table mt-2"><thead><tr><th>Asked</th><th>Assistant</th><th>Named you</th><th>Used your website</th></tr></thead>
                    {/* Each verdict opens the saved answers to this question, that month and assistant, that say the same. */}
                    <tbody>{shown.history.map((h, i) => { const row = { prompt: shown.prompt, assistant: h.engine, month: h.at.slice(0, 7) }; return <tr key={i}><td><Link href={seoLinks.ai(site.id, { prompt: shown.prompt, month: h.at.slice(0, 7) })} className={`${QUIET_LINK} ${TAP}`}>{fmtDate(h.at)}</Link></td><td data-label="Assistant"><Link href={seoLinks.ai(site.id, { prompt: shown.prompt, assistant: h.engine })} className={QUIET_LINK}>{LABEL[h.engine]}</Link></td><td data-label="Named you"><Link href={seoLinks.ai(site.id, h.mentioned ? { ...row, ...(h.listedAt === 1 ? { first: true } : { named: true }) } : row)} className={QUIET_LINK}>{h.mentioned ? `Yes${h.listedAt ? ` (#${h.listedAt})` : ""}` : "No"}</Link></td><td data-label="Used your website"><Link href={seoLinks.ai(site.id, h.cited ? { ...row, cited: true } : row)} className={QUIET_LINK}>{h.cited ? "Yes" : "No"}</Link></td></tr>; })}</tbody></table></div>
                  </>}
                </div>
              )}
            </section>
          )}
          {(d.prompts.length > 1 || hash === "ai-prompts") && d.prompts.length > 0 && (
            <section id="ai-prompts" className="mt-6 scroll-mt-4" data-testid="ai-prompts">
              <Heading>Questions you have asked</Heading>
              <div className="overflow-x-auto"><table className="g-table w-full">
                <thead><tr><th>Question</th>{ENGINES.map((e) => <th key={e.key}><Link href={seoLinks.ai(site.id, { assistant: e.key })} className={TEXT_LINK}>{e.label}</Link></th>)}<th className="num">Last asked</th></tr></thead>
                {/* A question opens its answers (the address says which); an assistant's cell opens every saved answer from it to that question. */}
                <tbody>{d.prompts.map((p) => (
                  <tr key={p.prompt} style={shown?.prompt === p.prompt ? { background: "var(--g-hover, rgba(26,115,232,.06))" } : undefined}>
                    <td className="max-w-[420px]"><Link href={seoLinks.ai(site.id, { prompt: p.prompt })} className={`${TEXT_LINK} text-left`} aria-current={shown?.prompt === p.prompt ? "true" : undefined} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>{p.prompt}</Link></td>
                    {ENGINES.map((e) => { const a = p.latest.find((x) => x.engine === e.key); return <td key={e.key} data-label={e.label}>{!a ? <span className="g-text-2">not asked</span> : <Link href={seoLinks.ai(site.id, { prompt: p.prompt, assistant: e.key })} className={QUIET_LINK}>{a.mentioned ? <span style={{ color: "var(--g-green)" }}>Named{a.listedAt ? ` #${a.listedAt}` : ""}</span> : <span style={{ color: "var(--g-red)" }}>Not named</span>}{(p.runId ? a.runId !== p.runId : false) && <span className="g-text-2 text-[12px]"> · {fmtDate(a.at)}</span>}</Link>}</td>; })}
                    <td className="num g-text-2" data-label="Last asked"><Link href={seoLinks.ai(site.id, { prompt: p.prompt, month: p.lastAt.slice(0, 7) })} className={QUIET_LINK}>{fmtDate(p.lastAt)}</Link></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          )}
          {(d.tracked?.length ?? 0) > 0 && (
            <section id="ai-tracked" className="mt-6 scroll-mt-4" data-testid="ai-tracked">
              <Heading className="!mb-1">Asked again every month</Heading>
              <p className="g-text-2 mb-2 text-[13px]"><Link href={`${seoLinks.ai(site.id)}#ai-tracked`} className={QUIET_LINK}>{d.tracked!.length} of {d.maxTracked ?? 5} questions</Link> (the most this account can ask again every month). Each uses your included SEO data only, and is skipped in a month when that has run out.</p>
              {/* A tracked question opens its answers by its id (?question=); an assistant on it opens that assistant's answers to it; the next date the question. */}
              <ul className="space-y-1 text-[13px]">
                {d.tracked!.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2" style={questionId === t.id ? { outline: "2px solid var(--g-blue, #1a73e8)", outlineOffset: 2, borderRadius: 6 } : undefined}>
                    <Link href={seoLinks.ai(site.id, { question: t.id })} className={`${TEXT_LINK} min-w-0 flex-1`} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} data-testid={`link-ai-tracked-${t.id}`}>{t.prompt}</Link>
                    <span className="g-text-2 text-[12px]">{t.engines.map((e, i) => <span key={e}>{i > 0 && ", "}<Link href={seoLinks.ai(site.id, { question: t.id, assistant: e })} className={QUIET_LINK}>{LABEL[e] ?? e}</Link></span>)} · next <Link href={seoLinks.ai(site.id, { question: t.id })} className={QUIET_LINK}>{fmtDate(t.nextAt)}</Link></span>
                    <button type="button" className="g-pill g-pill--sm !min-h-11" disabled={track.isPending} onClick={() => track.mutate({ prompt: t.prompt, on: false, engines: t.engines })} aria-label={`Stop asking "${t.prompt}" every month`} data-testid={`button-ai-stop-${t.id}`}>Stop</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="g-text-2 mt-4 text-[12px]">Your question is sent to each assistant through our data provider and the answers are kept in your history. The assistants are asked through their programming interfaces with web search on; the app on your phone can answer a little differently. To be named more often: keep your Google Business Profile and reviews current, get listed on the directories the assistants quote (they are in "Websites it used"), and publish pages that answer the question plainly. See who they quote, then check those sites in <Link href={seoLinks.explorer(d.domain)} className={TEXT_LINK}>Site explorer</Link>.</p>
          <Mentions status={status.data} domain={d.domain} wanted={mentionsWanted} siteId={site.id} />
        </>
      )}
    </SeoShell>
  );
}
