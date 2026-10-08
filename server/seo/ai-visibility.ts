/**
 * AI visibility: when someone asks an AI assistant for what this business
 * sells, is the business named, and is its website one of the sources?
 *
 *   Ask the AIs   one question put to ChatGPT, Google Gemini and Perplexity
 *                 (with their web search on), each answer read for the
 *                 business's name, its website among the sources, and which
 *                 other businesses were named. Saved, so the history shows
 *                 whether that changes.
 *   AI mentions   the questions for which Google's AI Overviews (or ChatGPT)
 *                 already use a given website as a source.
 *
 * Every call is bought through server/seo/budget.ts.
 */
import { z } from "zod";
import { pool } from "../db";
import { isCountryLabel } from "@shared/seo-markets";
import { request, assertOk, normalizeBusinessName, safeHttpUrl, safeDomain } from "./dataforseo";

export const AI_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_ai_checks (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    prompt text NOT NULL,
    engine text NOT NULL,
    model text,
    mentioned boolean NOT NULL,
    cited boolean NOT NULL,
    listed_at integer,
    businesses jsonb NOT NULL DEFAULT '[]'::jsonb,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    searches jsonb NOT NULL DEFAULT '[]'::jsonb,
    answer text NOT NULL DEFAULT '',
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS seo_ai_checks_site ON seo_ai_checks(site_id, created_at DESC)`,
  // Answers that came from one ask share a run id: they are counted together, and never with an older ask.
  `ALTER TABLE seo_ai_checks ADD COLUMN IF NOT EXISTS run_id uuid`,
  // Questions asked again every month (from the month's included data only).
  `CREATE TABLE IF NOT EXISTS seo_ai_tracked (
    id serial PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt text NOT NULL,
    engines text[] NOT NULL,
    next_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_ai_tracked_prompt ON seo_ai_tracked(site_id, lower(prompt))`,
  // Answers that were paid for by the monthly job and are waiting to be filed. A row leaves only in the same
  // transaction that files its answers, so a saving problem can delay them but never lose or re-buy them.
  `CREATE TABLE IF NOT EXISTS seo_ai_unsaved (
     id serial PRIMARY KEY,
     user_id integer NOT NULL,
     site_id integer NOT NULL,
     prompt text NOT NULL,
     answers jsonb NOT NULL,
     cost_usd numeric NOT NULL DEFAULT 0,
     run_id text NOT NULL UNIQUE,
     tries integer NOT NULL DEFAULT 0,
     next_at timestamptz NOT NULL DEFAULT now(),
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // 'opened' = the run exists but nothing has been sent to the source yet (safe to ask again);
  // 'asking' = the ask is about to go, or went: it may or may not have been paid for;
  // 'paid' = the answers are here and waiting to be filed.
  `ALTER TABLE seo_ai_unsaved ALTER COLUMN answers DROP NOT NULL`,
  `ALTER TABLE seo_ai_unsaved ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'paid'`,
  `ALTER TABLE seo_ai_unsaved ADD COLUMN IF NOT EXISTS tracked_id integer`,
  // One answer per assistant per run, enforced by the database: filing a run twice cannot double it. Rows that would
  // break the rule (the same run filed twice before the rule existed — identical copies) are reduced to the first
  // one, and only while the rule is not there yet, so creating it can never fail on existing data.
  // Clean-up and rule are ONE step under a lock (a DO block is a single transaction), so no other writer can add a
  // duplicate between them.
  // The lock is taken BEFORE looking, so two servers starting together cannot both decide to create it.
  `DO $$ BEGIN
     LOCK TABLE seo_ai_checks IN SHARE ROW EXCLUSIVE MODE;
     IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'seo_ai_checks' AND indexname = 'seo_ai_checks_run_engine') THEN
       DELETE FROM seo_ai_checks a USING seo_ai_checks b WHERE a.run_id IS NOT NULL AND a.run_id = b.run_id AND a.engine = b.engine AND a.id > b.id;
       CREATE UNIQUE INDEX seo_ai_checks_run_engine ON seo_ai_checks(run_id, engine) WHERE run_id IS NOT NULL;
     END IF;
   END $$`,
];

/** One spelling of a question everywhere it is stored or compared: single spaces, trimmed. */
export function onePrompt(p: string): string { return String(p ?? "").replace(/\s+/g, " ").trim(); }

export const MAX_TRACKED_PROMPTS = 5;
export const trackInput = z.object({
  prompt: z.string().trim().min(8).max(300).transform(onePrompt),
  engines: z.array(z.enum(["chatgpt", "gemini", "perplexity"])).min(1).max(3).default(["chatgpt", "gemini", "perplexity"]),
  on: z.boolean(),
}).strict();

/**
 * The assistants we ask, and the model each is asked through. `estimateUsd` is
 * what is reserved (the most one answer has cost us, with room); `typicalUsd`
 * is what was measured on 2026-10-08 for a contractor question, the price shown.
 */
export const AI_ENGINES = {
  chatgpt: { path: "chat_gpt", model: "gpt-4o-mini", label: "ChatGPT", estimateUsd: 0.05, typicalUsd: 0.027 },
  gemini: { path: "gemini", model: "gemini-2.5-flash-lite", label: "Google Gemini", estimateUsd: 0.06, typicalUsd: 0.036 },
  perplexity: { path: "perplexity", model: "sonar", label: "Perplexity", estimateUsd: 0.015, typicalUsd: 0.006 },
} as const;
export type AiEngine = keyof typeof AI_ENGINES;
export const AI_ENGINE_KEYS = Object.keys(AI_ENGINES) as AiEngine[];
export const AI_MENTIONS_ESTIMATE_USD = 0.13, AI_MENTIONS_TYPICAL_USD = 0.12, AI_MENTIONS_ROWS = 20;
export const MAX_ANSWER_CHARS = 6000;

export const askInput = z.object({
  prompt: z.string().trim().min(8, "Write the question a customer would ask.").max(300).transform(onePrompt),
  engines: z.array(z.enum(["chatgpt", "gemini", "perplexity"])).min(1).max(3),
}).strict();
export const mentionsInput = z.object({
  domain: z.string().min(3).max(253),
  platform: z.enum(["google", "chat_gpt"]).default("google"),
  peek: z.boolean().default(false),
}).strict();

export type AiSource = { domain: string; title: string | null; url: string | null; ours: boolean };
export type AiReading = {
  /** The business is named in the answer (its name, or its web address). */
  mentioned: boolean;
  /** Its website is among the sources the assistant used. */
  cited: boolean;
  /** Where it stands among the businesses named, from 1; null when it is not one of them. */
  listedAt: number | null;
  businesses: string[];
  sources: AiSource[];
};

const GEMINI_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");
const sameSite = (host: string, target: string) => { const d = bare(host); return d === target || d.endsWith(`.${target}`); };
/** Markdown reduced to the words a person reads: links to their text, emphasis marks dropped. */
export function plainText(markdown: string): string {
  return String(markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The businesses an answer names: its bold headings, which is how all three assistants set out a list of companies. */
export function namedBusinesses(markdown: string): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const m of String(markdown ?? "").matchAll(/\*\*(.+?)\*\*/g)) {
    const name = plainText(m[1]).replace(/[:：]\s*$/, "").trim();
    // Not a name: a line of details ("Open now · Siding contractor · 4.9"), a sentence, a label.
    if (!name || name.length > 80 || /[·•]|\d\.\d|\(\d+ reviews?\)|^open now|^closed/i.test(name) || name.split(/\s+/).length > 9 || /^(key benefits?|pros|cons|note|summary|overview|tips?|services?|why|how)\b/i.test(name)) continue;
    // A licence or reference number set in bold ("SIDINV787PJ") is not a business.
    if (/\d/.test(name) && !/[a-z]/.test(name)) continue;
    const key = normalizeBusinessName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

/** Read one answer for a business: named? a source? where in the list? Pure, for tests. */
export function readAnswer(markdown: string, annotations: { title?: unknown; url?: unknown }[], site: { domain: string; businessName?: string | null }): AiReading {
  const domain = bare(site.domain), ours = normalizeBusinessName(site.businessName);
  const text = plainText(markdown), flat = ` ${normalizeBusinessName(text)} `;
  const businesses = namedBusinesses(markdown);
  const isOurs = (name: string) => { const n = normalizeBusinessName(name.split(/\s+[|–—:·-]\s+/)[0]); return ours.length >= 4 && (n === ours || normalizeBusinessName(name) === ours); };
  const listed = businesses.findIndex(isOurs);
  const sources: AiSource[] = [], seen = new Set<string>();
  for (const a of Array.isArray(annotations) ? annotations : []) {
    const url = safeHttpUrl(a?.url);
    let host: string | null = null;
    try { host = url ? new URL(url).hostname : null; } catch { host = null; }
    // No usable address: not a source we can name.
    if (!host) continue;
    // Gemini hands back its own redirect address and puts the real site in the title; only then is the title read as the site.
    const redirect = host === GEMINI_REDIRECT_HOST;
    if (redirect) host = safeDomain(typeof a?.title === "string" ? a.title : "");
    const d = safeDomain(host ?? "");
    // A real site has a dot in its name; a title that is just a word is not one.
    if (!d || !d.includes(".") || d === GEMINI_REDIRECT_HOST || seen.has(d)) continue;
    seen.add(d);
    sources.push({ domain: d, title: typeof a?.title === "string" && a.title !== d ? a.title.slice(0, 160) : null, url: url && !redirect ? url.replace(/[?&]utm_source=[^&]*/, "").replace(/\?$/, "") : null, ours: sameSite(d, domain) });
    if (sources.length >= 20) break;
  }
  const cited = sources.some((s) => s.ours);
  // In running text a name counts only when it is distinctive: two words or more ("Quality LLC" must not match the word
  // "quality"). The web address counts only as a whole address, not as part of a longer one.
  const distinctive = ours.split(" ").length >= 2 && ours.length >= 6;
  const addressed = new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9-]|\\.[a-z0-9])`).test(text.toLowerCase());
  const mentioned = listed >= 0 || (distinctive && flat.includes(` ${ours} `)) || addressed;
  return { mentioned, cited, listedAt: listed >= 0 ? listed + 1 : null, businesses, sources };
}

export type AiAnswer = AiReading & { engine: AiEngine; model: string; answer: string; searches: string[] };
export const aiDeps = { request };

/** Put one question to one assistant, with its web search on. */
export async function fetchAiAnswer(engine: AiEngine, prompt: string, site: { domain: string; businessName?: string | null }): Promise<{ data: AiAnswer; costUsd: number }> {
  const e = AI_ENGINES[engine];
  const task = assertOk(await aiDeps.request("POST", `/ai_optimization/${e.path}/llm_responses/live`, [{ user_prompt: prompt, model_name: e.model, web_search: true, max_output_tokens: 700 }]));
  const result: any = task.result?.[0] ?? {};
  const sections = (Array.isArray(result.items) ? result.items : []).flatMap((i: any) => (Array.isArray(i?.sections) ? i.sections : [])).filter((s: any) => s && typeof s.text === "string");
  const markdown = sections.map((s: any) => s.text).join("\n\n");
  const annotations = sections.flatMap((s: any) => (Array.isArray(s.annotations) ? s.annotations : []));
  return {
    data: {
      engine, model: typeof result.model_name === "string" ? result.model_name : e.model,
      ...readAnswer(markdown, annotations, site),
      answer: plainText(markdown).slice(0, MAX_ANSWER_CHARS),
      searches: (Array.isArray(result.fan_out_queries) ? result.fan_out_queries : []).filter((q: unknown) => typeof q === "string").slice(0, 8).map((q: string) => q.slice(0, 200)),
    },
    costUsd: typeof task.cost === "number" ? task.cost : 0,
  };
}

/** Ask every chosen assistant at once. One failing does not lose the others; what each cost is added up. */
export async function askAi(prompt: string, engines: AiEngine[], site: { domain: string; businessName?: string | null }): Promise<{ data: { answers: AiAnswer[]; failed: AiEngine[] }; costUsd: number; customerUsd: number; costUnknown: boolean }> {
  const settled = await Promise.allSettled(engines.map((e) => fetchAiAnswer(e, prompt, site)));
  // costUsd is everything it cost us; customerUsd only the assistants that answered — one that failed is not the customer's to pay.
  let costUsd = 0, customerUsd = 0, costUnknown = false, firstError: unknown = null;
  const answers: AiAnswer[] = [], failed: AiEngine[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") { costUsd += s.value.costUsd; customerUsd += s.value.costUsd; answers.push(s.value.data); }
    else {
      costUsd += typeof s.reason?.costUsd === "number" ? s.reason.costUsd : 0;
      if (s.reason?.code === "timeout" || (s.reason?.code === "upstream" && !(s.reason?.costUsd > 0))) costUnknown = true;
      failed.push(engines[i]); firstError ??= s.reason;
    }
  });
  if (!answers.length) throw Object.assign(firstError instanceof Error ? firstError : new Error(String(firstError)), { costUsd, costUnknown });
  return { data: { answers, failed }, costUsd, customerUsd, costUnknown };
}

export const askEstimateUsd = (engines: AiEngine[]) => Math.round(engines.reduce((a, e) => a + AI_ENGINES[e].estimateUsd, 0) * 1e6) / 1e6;

/** Save the answers of one ask together (all or none), under one run id. */
export async function saveAiAnswers(userId: number, siteId: number, prompt: string, answers: AiAnswer[], costUsd: number, runId: string, opts: { /** A monthly question: its month moves on in the same step. */ advanceTrackedId?: number } = {}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Filing a run twice changes nothing: a run already filed is only taken off the waiting list.
    const { rows: [filed] } = await client.query("SELECT 1 FROM seo_ai_checks WHERE run_id=$1 AND user_id=$2 LIMIT 1", [runId, userId]);
    if (!filed) for (const a of answers)
      await client.query(
        `INSERT INTO seo_ai_checks(user_id, site_id, prompt, engine, model, mentioned, cited, listed_at, businesses, sources, searches, answer, cost_usd, run_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (run_id, engine) WHERE run_id IS NOT NULL DO NOTHING`,
        [userId, siteId, onePrompt(prompt), a.engine, a.model, a.mentioned, a.cited, a.listedAt, JSON.stringify(a.businesses), JSON.stringify(a.sources), JSON.stringify(a.searches), a.answer, costUsd / Math.max(1, answers.length), runId]);
    await client.query("DELETE FROM seo_ai_unsaved WHERE run_id=$1", [runId]);
    if (opts.advanceTrackedId !== undefined) await client.query("UPDATE seo_ai_tracked SET next_at = now() + interval '30 days' WHERE id=$1", [opts.advanceTrackedId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

export type AiPromptHistory = {
  prompt: string; lastAt: string;
  /** The run the newest answers came from; an answer with another run id is from an earlier ask. */
  runId: string | null;
  /** The newest answer from each assistant asked, with the full reading. */
  latest: (AiAnswer & { at: string; runId: string | null })[];
  /** Every earlier check, newest first: just whether the business was named and used as a source. */
  history: { at: string; engine: AiEngine; mentioned: boolean; cited: boolean; listedAt: number | null }[];
};

/** A site's saved questions, newest first, grouped by question. Pure over the rows, for tests. */
export function groupAiChecks(rows: any[], maxPrompts = 15): AiPromptHistory[] {
  const byPrompt = new Map<string, AiPromptHistory>();
  for (const r of rows) {   // rows are newest first
    const key = String(r.prompt).toLowerCase().replace(/\s+/g, " ").trim();
    let p = byPrompt.get(key);
    if (!p) { if (byPrompt.size >= maxPrompts) continue; p = { prompt: r.prompt, lastAt: new Date(r.created_at).toISOString(), runId: r.run_id ?? null, latest: [], history: [] }; byPrompt.set(key, p); }
    const at = new Date(r.created_at).toISOString();
    if (!p.latest.some((x) => x.engine === r.engine)) p.latest.push({ engine: r.engine, model: r.model ?? "", mentioned: r.mentioned, cited: r.cited, listedAt: r.listed_at, businesses: r.businesses ?? [], sources: r.sources ?? [], searches: r.searches ?? [], answer: r.answer ?? "", at, runId: r.run_id ?? null });
    else if (p.history.length < 60) p.history.push({ at, engine: r.engine, mentioned: r.mentioned, cited: r.cited, listedAt: r.listed_at });
  }
  return [...byPrompt.values()];
}
export async function aiHistory(userId: number, siteId: number): Promise<AiPromptHistory[]> {
  const { rows } = await pool.query("SELECT prompt, engine, model, mentioned, cited, listed_at, businesses, sources, searches, answer, created_at, run_id FROM seo_ai_checks WHERE site_id=$1 AND user_id=$2 ORDER BY created_at DESC, id DESC LIMIT 400", [siteId, userId]);
  return groupAiChecks(rows);
}

/** Questions worth asking, made from what the site already tracks: "best <service> in <city>". */
export function suggestPrompts(keywords: { keyword: string; location: string | null }[], max = 6): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const k of keywords) {
    // A keyword's place is a city only when it is finer than a whole country (a site's own country is a place too).
    const city = k.location && !isCountryLabel(k.location) ? k.location.split(",")[0].trim() : null;
    const kw = k.keyword.replace(/\b(near me|best|top|cost|price|prices)\b/gi, "").replace(/\s+/g, " ").trim();
    if (!kw || kw.split(" ").length > 5) continue;
    const q = city ? `Who are the best ${kw} companies in ${city}? Name specific businesses.` : `Who are the best ${kw} companies near me? Name specific businesses.`;
    if (!city && out.length) continue;   // without a place, one generic question is enough
    if (seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase()); out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

// ── AI mentions ────────────────────────────────────────────────────────────

export type AiMention = { question: string; searches: number | null; answer: string; sources: { domain: string; title: string | null; ours: boolean }[]; seenAt: string | null };
export type AiMentionsPage = { domain: string; platform: "google" | "chat_gpt"; total: number | null; rows: AiMention[]; fetchedAt: string };

export function parseMention(item: any, domain: string): AiMention | null {
  if (!item || typeof item.question !== "string" || !item.question.trim()) return null;
  const seen = new Set<string>();
  const sources = (Array.isArray(item.sources) ? item.sources : []).map((s: any) => {
    const d = safeDomain(s?.domain);
    if (!d || seen.has(d)) return null;
    seen.add(d);
    return { domain: d, title: typeof s?.title === "string" ? s.title.slice(0, 160) : null, ours: sameSite(d, bare(domain)) };
  }).filter(Boolean).slice(0, 8) as AiMention["sources"];
  return {
    question: item.question.trim().slice(0, 300), searches: typeof item.ai_search_volume === "number" ? item.ai_search_volume : null,
    answer: plainText(String(item.answer ?? "")).slice(0, 600), sources,
    seenAt: typeof item.last_response_at === "string" ? item.last_response_at.slice(0, 10) : null,
  };
}

export async function fetchAiMentions(input: { domain: string; platform: "google" | "chat_gpt" }): Promise<{ data: AiMentionsPage; costUsd: number }> {
  const task = assertOk(await aiDeps.request("POST", "/ai_optimization/llm_mentions/search/live", [{
    target: [{ domain: input.domain }], location_code: 2840, language_code: "en", platform: input.platform, limit: AI_MENTIONS_ROWS,
  }]), { treatNoResultsAsEmpty: true });
  const r: any = task.result?.[0] ?? {};
  return {
    data: { domain: input.domain, platform: input.platform, total: typeof r.total_count === "number" ? r.total_count : null, rows: (Array.isArray(r.items) ? r.items : []).map((i: any) => parseMention(i, input.domain)).filter((x: AiMention | null): x is AiMention => !!x), fetchedAt: new Date().toISOString() },
    costUsd: typeof task.cost === "number" ? task.cost : 0,
  };
}

// ── Asked again every month ────────────────────────────────────────────────

export async function trackedPrompts(siteId: number): Promise<{ id: number; prompt: string; engines: AiEngine[]; nextAt: string }[]> {
  const { rows } = await pool.query(`SELECT id, prompt, engines, next_at AS "nextAt" FROM seo_ai_tracked WHERE site_id=$1 ORDER BY created_at`, [siteId]);
  return rows;
}
/** Turn monthly re-asking on or off for a question. Returns null when the site already tracks the most allowed. */
export async function setTracked(userId: number, siteId: number, input: z.infer<typeof trackInput>): Promise<boolean> {
  if (!input.on) { await pool.query("DELETE FROM seo_ai_tracked WHERE site_id=$1 AND user_id=$2 AND lower(btrim(regexp_replace(prompt, '\\s+', ' ', 'g')))=lower($3)", [siteId, userId, input.prompt]); return true; }
  const { rows: [{ n, has }] } = await pool.query("SELECT count(*)::int n, bool_or(lower(prompt)=lower($2)) AS has FROM seo_ai_tracked WHERE site_id=$1", [siteId, input.prompt]);
  if (!has && n >= MAX_TRACKED_PROMPTS) return false;
  await pool.query(
    `INSERT INTO seo_ai_tracked(site_id, user_id, prompt, engines, next_at) VALUES($1,$2,$3,$4, now() + interval '30 days')
     ON CONFLICT (site_id, lower(prompt)) DO UPDATE SET engines=EXCLUDED.engines`, [siteId, userId, input.prompt, [...new Set(input.engines)]]);
  return true;
}
