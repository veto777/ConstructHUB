/**
 * Keyword lists and bulk keyword analysis for Keywords Explorer.
 *
 *   Bulk analysis  volume, difficulty, cost per click and intent for up to 200
 *                  keywords in one call (bought through server/seo/budget.ts,
 *                  saved in seo_report_cache).
 *   Lists          named sets of keywords an account keeps: research saved for
 *                  later, with the numbers each keyword had when it was added.
 *                  Free — nothing in a list calls the data source.
 */
import { z } from "zod";
import { pool } from "../db";
import { request, assertOk, taskItems } from "./dataforseo";
import { estimateLabsUsd } from "./pricing";
import { parseKeywordIdea, type KeywordIdeaRow } from "./reports";

export const BULK_MAX = 200;
export const MAX_LISTS = 100;
export const MAX_LIST_ITEMS = 2000;

/** Lower case, single spaces, no duplicates, no empties, capped. */
export function cleanKeywords(list: readonly string[], cap = BULK_MAX): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of list) {
    const k = String(raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!k || k.length > 200 || seen.has(k)) continue;
    seen.add(k); out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

export const bulkInput = z.object({
  keywords: z.array(z.string().max(400)).min(1).max(1000),
  locationCode: z.number().int().positive().default(2840),
  languageCode: z.string().regex(/^[a-z]{2}$/).default("en"),
  /** Return the saved copy or 404 — never buy. */
  peek: z.boolean().default(false),
}).strict();

/** The most a bulk analysis of `count` keywords can cost us. */
export const bulkEstimateUsd = (count: number) => estimateLabsUsd(count);

export type BulkPage = { rows: KeywordIdeaRow[]; /** Asked for, but the source has no numbers for them. */ notFound: string[]; fetchedAt: string };
export const listDeps = { request };

export async function fetchBulkKeywords(input: { keywords: string[]; locationCode: number; languageCode: string }): Promise<{ data: BulkPage; costUsd: number }> {
  const task = assertOk(await listDeps.request("POST", "/dataforseo_labs/google/keyword_overview/live", [{
    keywords: input.keywords, location_code: input.locationCode, language_code: input.languageCode,
  }]), { treatNoResultsAsEmpty: true });
  const byKeyword = new Map<string, KeywordIdeaRow>();
  for (const i of taskItems(task)) { const row = parseKeywordIdea(i); if (row) byKeyword.set(row.keyword.toLowerCase(), row); }
  // In the order they were asked for.
  const rows = input.keywords.map((k) => byKeyword.get(k)).filter((r): r is KeywordIdeaRow => !!r);
  return { data: { rows, notFound: input.keywords.filter((k) => !byKeyword.has(k)), fetchedAt: new Date().toISOString() }, costUsd: typeof task.cost === "number" ? task.cost : 0 };
}

// ── Lists ──────────────────────────────────────────────────────────────────

export const LIST_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_keyword_lists (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS seo_keyword_list_items (
    list_id integer NOT NULL REFERENCES seo_keyword_lists(id) ON DELETE CASCADE,
    keyword text NOT NULL,
    volume integer,
    cpc numeric(10,4),
    difficulty integer,
    intent text,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, keyword)
  )`,
];

const metric = z.number().min(0).max(2_000_000_000).transform(Math.round).nullable().optional();
export const listItemsInput = z.object({
  /** Add to this list... */
  listId: z.number().int().positive().optional(),
  /** ...or to a new one with this name. */
  name: z.string().trim().min(1).max(80).optional(),
  items: z.array(z.object({
    keyword: z.string().trim().min(1).max(200),
    volume: metric, difficulty: z.number().min(0).max(100).transform(Math.round).nullable().optional(),
    cpc: z.number().min(0).max(99_999).nullable().optional(), intent: z.string().max(40).nullable().optional(),
  }).strict()).max(1000).default([]),
}).strict().refine((v) => v.listId !== undefined || v.name !== undefined, { message: "Choose a list or name a new one." });

export class ListError extends Error { constructor(message: string, readonly status = 400) { super(message); this.name = "ListError"; } }

export async function listsOf(userId: number) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name, l.created_at AS "createdAt", count(i.keyword)::int AS keywords, coalesce(sum(i.volume),0)::bigint AS volume
       FROM seo_keyword_lists l LEFT JOIN seo_keyword_list_items i ON i.list_id=l.id
      WHERE l.user_id=$1 GROUP BY l.id ORDER BY l.name`, [userId]);
  return rows.map((r: any) => ({ ...r, volume: Number(r.volume) }));
}

async function ownedList(userId: number, listId: number) {
  const { rows: [l] } = await pool.query("SELECT id, name FROM seo_keyword_lists WHERE id=$1 AND user_id=$2", [listId, userId]);
  if (!l) throw new ListError("List not found", 404);
  return l as { id: number; name: string };
}

export async function listItems(userId: number, listId: number) {
  const list = await ownedList(userId, listId);
  const { rows } = await pool.query(
    `SELECT keyword, volume, cpc::float8 AS cpc, difficulty, intent, added_at AS "addedAt" FROM seo_keyword_list_items WHERE list_id=$1 ORDER BY volume DESC NULLS LAST, keyword`, [list.id]);
  return { list, items: rows };
}

/** Add keywords to a list (creating it by name when asked). Keywords already there get their numbers refreshed. */
/** `replace`: a refresh — the numbers handed in are today's and overwrite what is stored, even with "none". */
export async function addToList(userId: number, input: z.infer<typeof listItemsInput>, replace = false): Promise<{ list: { id: number; name: string }; added: number; total: number }> {
  let list: { id: number; name: string };
  if (input.listId !== undefined) list = await ownedList(userId, input.listId);
  else {
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int n FROM seo_keyword_lists WHERE user_id=$1", [userId]);
    const { rows: [existing] } = await pool.query("SELECT id, name FROM seo_keyword_lists WHERE user_id=$1 AND lower(name)=lower($2)", [userId, input.name]);
    if (existing) list = existing;
    else {
      if (n >= MAX_LISTS) throw new ListError(`You can keep up to ${MAX_LISTS} lists. Delete one you no longer need.`, 403);
      const { rows: [created] } = await pool.query("INSERT INTO seo_keyword_lists(user_id, name) VALUES($1,$2) ON CONFLICT (user_id, name) DO UPDATE SET name=EXCLUDED.name RETURNING id, name", [userId, input.name]);
      list = created;
    }
  }
  const byKeyword = new Map(input.items.map((i) => [cleanKeywords([i.keyword], 1)[0], i] as const).filter(([k]) => !!k));
  const keywords = [...byKeyword.keys()];
  const { rows: [{ have }] } = await pool.query("SELECT count(*)::int have FROM seo_keyword_list_items WHERE list_id=$1", [list.id]);
  const { rows: already } = await pool.query("SELECT keyword FROM seo_keyword_list_items WHERE list_id=$1 AND keyword = ANY($2::text[])", [list.id, keywords]);
  const adding = keywords.length - already.length;
  if (have + adding > MAX_LIST_ITEMS) throw new ListError(`A list holds up to ${MAX_LIST_ITEMS.toLocaleString("en-US")} keywords; this one has ${have}.`, 403);
  if (keywords.length) {
    const col = <T>(f: (i: (typeof input.items)[number]) => T) => keywords.map((k) => f(byKeyword.get(k)!));
    await pool.query(
      `INSERT INTO seo_keyword_list_items(list_id, keyword, volume, cpc, difficulty, intent)
       SELECT $1, * FROM unnest($2::text[], $3::int[], $4::numeric[], $5::int[], $6::text[])
       ON CONFLICT (list_id, keyword) DO UPDATE SET
         volume=CASE WHEN $7 THEN EXCLUDED.volume ELSE coalesce(EXCLUDED.volume, seo_keyword_list_items.volume) END,
         cpc=CASE WHEN $7 THEN EXCLUDED.cpc ELSE coalesce(EXCLUDED.cpc, seo_keyword_list_items.cpc) END,
         difficulty=CASE WHEN $7 THEN EXCLUDED.difficulty ELSE coalesce(EXCLUDED.difficulty, seo_keyword_list_items.difficulty) END,
         intent=CASE WHEN $7 THEN EXCLUDED.intent ELSE coalesce(EXCLUDED.intent, seo_keyword_list_items.intent) END`,
      [list.id, keywords, col((i) => i.volume ?? null), col((i) => i.cpc ?? null), col((i) => i.difficulty ?? null), col((i) => i.intent ?? null), replace]);
  }
  return { list, added: adding, total: have + adding };
}

/**
 * Write today's numbers onto keywords that are IN the list (never adds one — a keyword removed meanwhile stays removed),
 * and clear the numbers of keywords the source has nothing for, so an old figure cannot pass for a current one.
 */
export async function refreshListMetrics(listId: number, rows: { keyword: string; volume: number | null; cpc: number | null; difficulty: number | null; intent: string | null }[], notFound: string[]): Promise<number> {
  let updated = 0;
  if (rows.length) {
    const { rowCount } = await pool.query(
      `UPDATE seo_keyword_list_items i SET volume=v.volume, cpc=v.cpc, difficulty=v.difficulty, intent=v.intent
         FROM unnest($2::text[], $3::int[], $4::numeric[], $5::int[], $6::text[]) AS v(keyword, volume, cpc, difficulty, intent)
        WHERE i.list_id=$1 AND i.keyword=v.keyword`,
      [listId, rows.map((r) => r.keyword), rows.map((r) => (r.volume == null ? null : Math.round(r.volume))), rows.map((r) => r.cpc), rows.map((r) => (r.difficulty == null ? null : Math.round(r.difficulty))), rows.map((r) => r.intent)]);
    updated = rowCount ?? 0;
  }
  if (notFound.length) await pool.query("UPDATE seo_keyword_list_items SET volume=NULL, cpc=NULL, difficulty=NULL, intent=NULL WHERE list_id=$1 AND keyword = ANY($2::text[])", [listId, notFound]);
  return updated;
}

export async function removeFromList(userId: number, listId: number, keywords: string[]): Promise<number> {
  const list = await ownedList(userId, listId);
  const { rowCount } = await pool.query("DELETE FROM seo_keyword_list_items WHERE list_id=$1 AND keyword = ANY($2::text[])", [list.id, keywords]);
  return rowCount ?? 0;
}
export async function deleteList(userId: number, listId: number): Promise<void> {
  const list = await ownedList(userId, listId);
  await pool.query("DELETE FROM seo_keyword_lists WHERE id=$1", [list.id]);
}
