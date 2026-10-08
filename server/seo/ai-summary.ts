/**
 * AI visibility, added up: across the questions a site has asked the assistants — how often it is named and used as
 * a source now, how that has moved month by month, which other businesses the assistants name, and which websites
 * they draw on. Built only from answers already saved (seo_ai_checks) — free.
 *
 * What is counted is always an ANSWER: one assistant's reply to one question. "Now" is the newest answer to each
 * question from each assistant (so a question asked ten times does not weigh ten times); a month is the newest answer
 * to each question from each assistant within that month. These are the customer's own questions, a handful of them —
 * a sample, never "share of all AI answers", and the page says how many answers every figure rests on.
 */
import { pool } from "../db";
import { DIRECTORIES } from "./directories";
import { normalizeBusinessName } from "./dataforseo";

export const AI_SUMMARY_MONTHS = 12;
/** "Now" looks no further back than this: an answer older than that says little about today. */
export const AI_SUMMARY_NOW_DAYS = 120;
export type AiCheckLite = { prompt: string; engine: string; mentioned: boolean; cited: boolean; listedAt: number | null; businesses: unknown; sources: unknown; at: string };
export type AiCount = { answers: number; mentioned: number; cited: number };
export type AiSummary = {
  nowDays: number;
  /** The newest answer to each question from each assistant, within nowDays. */
  now: AiCount & { questions: number; /** Of the answers that named the business in a list: how many put it first. */ first: number };
  byEngine: (AiCount & { engine: string })[];
  /** Oldest first; only months that have answers. */
  byMonth: (AiCount & { month: string; questions: number })[];
  /**
   * Other names the "now" answers set in bold, most-named first. Mostly businesses — but read from formatting, so a
   * heading can be among them, and the customer's own business under a spelling we could not match. Never "competitors".
   */
  businesses: { name: string; answers: number; questions: number }[];
  /** true = there were more saved answers than are read at once, so older months may be incomplete (see aiSummary). */
  truncated?: boolean;
  /** Websites the "now" answers drew on, most-used first. */
  sources: { domain: string; answers: number; questions: number; ours: boolean; /** A competitor this site follows. */ rival: boolean; /** The name of the review site or directory this is (server/seo/directories.ts), when it is one — a place a business can have a profile. */ directory?: string }[];
};

const promptKey = (p: string) => String(p ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const nameKey = (n: string) => n.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(llc|inc|co|corp|ltd|company)\b/g, " ").replace(/\s+/g, " ").trim();
const bare = (d: string) => d.toLowerCase().replace(/^www\./, "");
const count = (list: AiCheckLite[]): AiCount => ({ answers: list.length, mentioned: list.filter((r) => r.mentioned).length, cited: list.filter((r) => r.cited).length });
/** The newest row per question and assistant. `rows` may be in any order. */
function newestEach(rows: AiCheckLite[]): AiCheckLite[] {
  const best = new Map<string, AiCheckLite>();
  for (const r of rows) { const k = `${promptKey(r.prompt)}\u0000${r.engine}`; const had = best.get(k); if (!had || r.at > had.at) best.set(k, r); }
  return [...best.values()];
}

/** Pure. `now` is passed in for tests. */
export function summariseAi(rows: readonly AiCheckLite[], opts: { rivals?: readonly string[]; now?: Date; /** The customer's own business, so it is not listed among the others. */ businessName?: string | null; domain?: string | null } = {}): AiSummary {
  // The customer's own business, however the answer wrote it: its name as whole words inside the bold text
  // ("Alpine Exteriors (Bellingham)", "Alpine Exteriors — siding"), or its web address.
  const own = normalizeBusinessName(opts.businessName), ownDomain = opts.domain ? bare(opts.domain) : "";
  const isOwn = (name: string) => { const n = ` ${normalizeBusinessName(name)} `; return (own.length >= 4 && n.includes(` ${own} `)) || (!!ownDomain && name.toLowerCase().includes(ownDomain)); };
  const nowAt = opts.now ?? new Date();
  const since = new Date(nowAt.getTime() - AI_SUMMARY_NOW_DAYS * 86400_000).toISOString();
  const current = newestEach(rows.filter((r) => r.at >= since));
  const questions = (list: AiCheckLite[]) => new Set(list.map((r) => promptKey(r.prompt))).size;

  const months = new Map<string, AiCheckLite[]>();
  const oldest = new Date(Date.UTC(nowAt.getUTCFullYear(), nowAt.getUTCMonth() - (AI_SUMMARY_MONTHS - 1), 1)).toISOString();
  for (const r of rows) { if (r.at < oldest) continue; const m = r.at.slice(0, 7); (months.get(m) ?? months.set(m, []).get(m)!).push(r); }

  // Other businesses: every name in an answer except the one the answer was read as being this business.
  const biz = new Map<string, { names: Map<string, number>; answers: number; questions: Set<string> }>();
  const src = new Map<string, { answers: number; questions: Set<string>; ours: boolean }>();
  for (const r of current) {
    const names = Array.isArray(r.businesses) ? r.businesses.filter((b): b is string => typeof b === "string" && !!b.trim()) : [];
    const seen = new Set<string>();
    names.forEach((n, i) => {
      if (r.listedAt === i + 1 || isOwn(n)) return;
      const k = nameKey(n);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const b = biz.get(k) ?? biz.set(k, { names: new Map(), answers: 0, questions: new Set() }).get(k)!;
      b.answers++; b.questions.add(promptKey(r.prompt)); b.names.set(n.trim(), (b.names.get(n.trim()) ?? 0) + 1);
    });
    const domains = new Set<string>();
    for (const s of Array.isArray(r.sources) ? r.sources : []) {
      const d = typeof (s as any)?.domain === "string" ? bare((s as any).domain) : "";
      if (!d || domains.has(d)) continue;
      domains.add(d);
      const e = src.get(d) ?? src.set(d, { answers: 0, questions: new Set(), ours: false }).get(d)!;
      e.answers++; e.questions.add(promptKey(r.prompt)); if ((s as any).ours === true) e.ours = true;
    }
  }
  const rivals = new Set((opts.rivals ?? []).map(bare));
  const isRival = (d: string) => [...rivals].some((r) => d === r || d.endsWith(`.${r}`));
  const engines = [...new Set(current.map((r) => r.engine))].sort();
  return {
    nowDays: AI_SUMMARY_NOW_DAYS,
    now: { ...count(current), questions: questions(current), first: current.filter((r) => r.listedAt === 1).length },
    byEngine: engines.map((engine) => ({ engine, ...count(current.filter((r) => r.engine === engine)) })),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => { const each = newestEach(list); return { month, ...count(each), questions: questions(each) }; }),
    businesses: [...biz.values()].map((b) => ({ name: [...b.names.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0], answers: b.answers, questions: b.questions.size }))
      .sort((a, b) => b.answers - a.answers || b.questions - a.questions || a.name.localeCompare(b.name)).slice(0, 20),
    sources: [...src.entries()].map(([domain, e]) => { const dir = DIRECTORIES.find((x) => domain === x.domain || domain.endsWith(`.${x.domain}`)); return { domain, answers: e.answers, questions: e.questions.size, ours: e.ours, rival: !e.ours && isRival(domain), ...(dir && !e.ours ? { directory: dir.name } : {}) }; })
      .sort((a, b) => b.answers - a.answers || b.questions - a.questions || a.domain.localeCompare(b.domain)).slice(0, 25),
  };
}

export const AI_SUMMARY_MAX_ROWS = 20000;
/**
 * A site's saved answers of the last AI_SUMMARY_MONTHS months, added up. Saved rows only. The database hands over
 * only what the summary counts — the newest answer to each question from each assistant in each month — so asking
 * one question many times cannot push other questions or older months out. If even that is more than
 * AI_SUMMARY_MAX_ROWS (the newest are kept), the result says so (`truncated`).
 */
export async function aiSummary(userId: number, siteId: number, opts: { rivals: readonly string[]; businessName?: string | null; domain?: string | null }): Promise<AiSummary> {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (lower(btrim(regexp_replace(prompt, '\\s+', ' ', 'g'))), engine, date_trunc('month', created_at AT TIME ZONE 'UTC'))
              prompt, engine, mentioned, cited, listed_at AS "listedAt", businesses, sources, created_at, id
         FROM seo_ai_checks WHERE site_id=$1 AND user_id=$2 AND created_at >= now() - interval '${AI_SUMMARY_MONTHS + 1} months'
        ORDER BY lower(btrim(regexp_replace(prompt, '\\s+', ' ', 'g'))), engine, date_trunc('month', created_at AT TIME ZONE 'UTC'), created_at DESC, id DESC
     ) newest ORDER BY created_at DESC, id DESC LIMIT ${AI_SUMMARY_MAX_ROWS + 1}`, [siteId, userId]);
  const truncated = rows.length > AI_SUMMARY_MAX_ROWS;
  const out = summariseAi(rows.slice(0, AI_SUMMARY_MAX_ROWS).map((r: any) => ({ ...r, at: new Date(r.created_at).toISOString() })), opts);
  return truncated ? { ...out, truncated } : out;
}
