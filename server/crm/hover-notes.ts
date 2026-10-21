/**
 * HOVER job notes → the client's Notes (owner, 2026-10-21: "make sure you go add this now!").
 *
 * A note written on a HOVER job (the Notes box at the bottom of hover.to/wr/jobs/<id>) lands in
 * crm_customer_notes for the CRM client the job is already linked to — the same job → client link the rest of
 * the integration uses: the crm_measurements row with provider "hover", externalId "hover:<jobId>" and its
 * customer_id, inside the connected org only.
 *
 *   Read:  GET /api/v2/notes.json?job_id=<id>  (developers.hover.to/reference/list-notes) →
 *          {"results":[{id, job_id, org_id, user_id, body, created_at, updated_at, user:{email, first_name, last_name}}]}
 *   Write: one crm_customer_notes row per HOVER note — source "hover", source_author = HOVER's writer,
 *          created_at = HOVER's created_at, no ConstructHUB author (author_member_id null: owner/admin may edit).
 *   Link:  crm_hover_note_links (org_id, hover_note_id) → note_id. Re-syncs never duplicate; a note edited in
 *          HOVER (new updated_at) is updated here; a note deleted in HOVER is left alone here; a note the team
 *          deleted here is not brought back (the link outlives it).
 *
 * When: after every HOVER sync, in the background (the Sync button never waits on it). A job's notes are re-read
 * when they were never read, when HOVER's job updated_at moved, while the job is recent (14 days), and at least
 * once a day otherwise. Calls are paced under HOVER's 120 requests/minute; a 429 that outlasts the backoff stops
 * the pass and the rest stay due for the next one.
 */
import { randomUUID, createHash } from "crypto";
import { db } from "../db";
import { crmCustomerNotes, crmHoverNoteLinks, crmMeasurements } from "@shared/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

export const HOVER_NOTE_SOURCE = "hover";
/** A job's notes are re-read at least this often. */
export const HOVER_NOTES_RECHECK_MS = 24 * 3600_000;
/** A job HOVER touched this recently has its notes re-read on every sync. */
export const HOVER_NOTES_ACTIVE_MS = 14 * 24 * 3600_000;
/** Space between notes calls: ≤100/min, under HOVER's 120 RPM with room for the sync's own calls. */
export const HOVER_NOTES_PACE_MS = 600;
const NOTES_PAGE_CAP = 10;
/** Consecutive non-429 failures that end the pass (a missing scope would fail every job alike). */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface HoverNote {
  id: string;
  jobId: string;
  body: string;
  author: string | null;
  createdAt: Date | null;
  /** HOVER's updated_at, else a hash of the body — what tells an edit apart. */
  version: string;
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The writer as HOVER has them: "First Last", else the e-mail, else null. */
export function hoverNoteAuthor(user: any): string | null {
  const name = [clean(user?.first_name), clean(user?.last_name)].filter(Boolean).join(" ");
  if (name) return name;
  return clean(user?.email) || clean(user?.name) || null;
}

const parseDate = (v: unknown): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** HOVER's notes payload → notes with an id and a non-empty body. */
export function parseHoverNotes(json: any, jobId: string): HoverNote[] {
  const list: any[] = Array.isArray(json) ? json
    : Array.isArray(json?.results) ? json.results
      : Array.isArray(json?.notes) ? json.notes : [];
  const out: HoverNote[] = [];
  for (const n of list) {
    const id = n?.id;
    const body = typeof n?.body === "string" ? n.body.trim() : "";
    if (id === null || id === undefined || id === "" || !body) continue;
    if (n?.job_id != null && String(n.job_id) !== String(jobId)) continue;
    const updated = typeof n?.updated_at === "string" && n.updated_at ? n.updated_at : null;
    out.push({
      id: String(id),
      jobId: String(jobId),
      body,
      author: hoverNoteAuthor(n?.user),
      createdAt: parseDate(n?.created_at),
      version: updated ?? `body:${createHash("sha1").update(body).digest("hex")}`,
    });
  }
  return out;
}

export type HoverNotesApi = (apiPath: string) => Promise<{ status: number; json: any }>;

/** Every note on one job (paged when HOVER pages it). */
export async function fetchHoverJobNotes(
  api: HoverNotesApi, jobId: string,
): Promise<{ ok: true; notes: HoverNote[] } | { ok: false; status: number }> {
  const byId = new Map<string, HoverNote>();
  for (let page = 1; page <= NOTES_PAGE_CAP; page++) {
    const r = await api(`/v2/notes.json?job_id=${encodeURIComponent(jobId)}${page > 1 ? `&page=${page}` : ""}`);
    if (r.status !== 200) {
      if (page === 1) return { ok: false, status: r.status };
      break;
    }
    const batch = parseHoverNotes(r.json, jobId);
    let fresh = 0;
    for (const n of batch) if (!byId.has(n.id)) { byId.set(n.id, n); fresh++; }
    const total = Number(r.json?.pagination?.total_pages ?? r.json?.meta?.pagination?.total_pages);
    const next = Number(r.json?.pagination?.next_page ?? r.json?.meta?.pagination?.next_page);
    const more = Number.isFinite(total) && total > 0 ? page < total : Number.isFinite(next) && next > page;
    if (!more || !fresh) break;
  }
  return { ok: true, notes: [...byId.values()] };
}

/** Is this job's notes read due? */
export function hoverNotesDue(
  state: { notesSyncedAt?: unknown; notesJobUpdatedAt?: unknown },
  listedUpdatedAt: string | null,
  now: number = Date.now(),
): boolean {
  const synced = typeof state.notesSyncedAt === "string" ? Date.parse(state.notesSyncedAt) : NaN;
  if (!Number.isFinite(synced)) return true;
  if (listedUpdatedAt && listedUpdatedAt !== state.notesJobUpdatedAt) return true;
  const touched = listedUpdatedAt ? Date.parse(listedUpdatedAt) : NaN;
  if (Number.isFinite(touched) && now - touched < HOVER_NOTES_ACTIVE_MS) return true;
  return now - synced >= HOVER_NOTES_RECHECK_MS;
}

/** Write one job's HOVER notes onto its client. Idempotent; see the header for edits and deletes. */
export async function importHoverJobNotes(
  orgId: string, customerId: string, jobId: string, notes: HoverNote[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0, updated = 0;
  for (const n of notes) {
    await db.transaction(async (tx) => {
      const [link] = await tx.select().from(crmHoverNoteLinks)
        .where(and(eq(crmHoverNoteLinks.orgId, orgId), eq(crmHoverNoteLinks.hoverNoteId, n.id)))
        .for("update")
        .limit(1);
      if (!link) {
        const noteId = randomUUID();
        const claimed = await tx.insert(crmHoverNoteLinks)
          .values({ orgId, hoverNoteId: n.id, hoverJobId: jobId, noteId, hoverUpdatedAt: n.version })
          .onConflictDoNothing()
          .returning({ noteId: crmHoverNoteLinks.noteId });
        if (!claimed.length) return; // another run imported it a moment ago
        await tx.insert(crmCustomerNotes).values({
          id: noteId, orgId, customerId, authorMemberId: null, body: n.body,
          createdAt: n.createdAt ?? new Date(), source: HOVER_NOTE_SOURCE, sourceAuthor: n.author,
        });
        inserted++;
        return;
      }
      const [note] = await tx.select().from(crmCustomerNotes)
        .where(and(eq(crmCustomerNotes.id, link.noteId), eq(crmCustomerNotes.orgId, orgId))).limit(1);
      if (!note) return; // the team deleted it here — keep it deleted
      const patch: Partial<typeof crmCustomerNotes.$inferInsert> = {};
      // Edited in HOVER: HOVER's text wins. Unchanged in HOVER: an edit made here stands.
      if (link.hoverUpdatedAt !== n.version) {
        if (note.body !== n.body) patch.body = n.body;
        if ((note.sourceAuthor ?? null) !== n.author) patch.sourceAuthor = n.author;
      }
      // The note follows its job when the job is re-filed onto another client.
      if (note.customerId !== customerId) patch.customerId = customerId;
      if (Object.keys(patch).length) {
        await tx.update(crmCustomerNotes).set(patch).where(eq(crmCustomerNotes.id, note.id));
        updated++;
      }
      if (link.hoverUpdatedAt !== n.version || link.hoverJobId !== jobId) {
        await tx.update(crmHoverNoteLinks).set({ hoverUpdatedAt: n.version, hoverJobId: jobId, updatedAt: new Date() })
          .where(and(eq(crmHoverNoteLinks.orgId, orgId), eq(crmHoverNoteLinks.hoverNoteId, n.id)));
      }
    });
  }
  return { inserted, updated };
}

export interface HoverNotesReport {
  at: string;
  due: number;
  checked: number;
  inserted: number;
  updated: number;
  /** Due jobs left for the next pass (rate limit, or the pass stopped on failures). */
  deferred: number;
  error: string | null;
}

/** Stamp a job's notes read on its measurement (jsonb merge — never a stale whole-payload rewrite). */
async function stampNotesRead(measurementId: string, at: string, jobUpdatedAt: string | null): Promise<void> {
  const patch = JSON.stringify({ notesSyncedAt: at, notesJobUpdatedAt: jobUpdatedAt });
  await db.update(crmMeasurements).set({
    rawPayload: sql`coalesce(${crmMeasurements.rawPayload}, '{}'::jsonb) || ${patch}::jsonb`,
  }).where(eq(crmMeasurements.id, measurementId));
}

/**
 * One notes pass over the org's linked HOVER jobs. `listedJobs` is the sync's jobs listing (for updated_at);
 * a linked job missing from it is still read on the daily recheck. Newest jobs first.
 */
export async function syncHoverNotes(
  orgId: string,
  listedJobs: any[],
  api: HoverNotesApi,
  opts: { sleep?: (ms: number) => Promise<void>; paceMs?: number; now?: () => number } = {},
): Promise<HoverNotesReport> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pace = opts.paceMs ?? HOVER_NOTES_PACE_MS;
  const now = opts.now ?? Date.now;
  const listedUpdated = new Map<string, string | null>();
  for (const j of listedJobs) {
    const id = j?.id ?? j?.job_id;
    if (id === null || id === undefined) continue;
    listedUpdated.set(String(id), typeof j?.updated_at === "string" ? j.updated_at : null);
  }
  const rows = await db.select({
    id: crmMeasurements.id,
    externalId: crmMeasurements.externalId,
    customerId: crmMeasurements.customerId,
    createdAt: crmMeasurements.createdAt,
    notesSyncedAt: sql<string | null>`${crmMeasurements.rawPayload} ->> 'notesSyncedAt'`,
    notesJobUpdatedAt: sql<string | null>`${crmMeasurements.rawPayload} ->> 'notesJobUpdatedAt'`,
  }).from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.provider, "hover"), isNotNull(crmMeasurements.customerId)));

  // One read per job: a job with several rows (never expected) goes to its newest linked row.
  const byJob = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const jobId = /^hover:(.+)$/.exec(r.externalId ?? "")?.[1];
    if (!jobId || !r.customerId) continue;
    const prev = byJob.get(jobId);
    if (!prev || (r.createdAt?.getTime() ?? 0) > (prev.createdAt?.getTime() ?? 0)) byJob.set(jobId, r);
  }
  const t0 = now();
  const due = [...byJob.entries()]
    .filter(([jobId, r]) => hoverNotesDue(r, listedUpdated.get(jobId) ?? null, t0))
    .sort(([a, ra], [b, rb]) => {
      const ta = Date.parse(listedUpdated.get(a) ?? "") || ra.createdAt?.getTime() || 0;
      const tb = Date.parse(listedUpdated.get(b) ?? "") || rb.createdAt?.getTime() || 0;
      return tb - ta;
    });

  const report: HoverNotesReport = { at: new Date(t0).toISOString(), due: due.length, checked: 0, inserted: 0, updated: 0, deferred: 0, error: null };
  let failures = 0;
  for (let i = 0; i < due.length; i++) {
    const [jobId, row] = due[i];
    if (i > 0 && pace > 0) await sleep(pace);
    const got = await fetchHoverJobNotes(api, jobId).catch((e: any) => ({ ok: false as const, status: 0, thrown: String(e?.message || e) }));
    if (!got.ok) {
      if (got.status === 429) {
        report.deferred = due.length - i;
        report.error = "HOVER rate limit — the rest are read next sync";
        break;
      }
      if (got.status === 404) { // the job is gone at HOVER: nothing to read, check again tomorrow
        await stampNotesRead(row.id, new Date(now()).toISOString(), listedUpdated.get(jobId) ?? null);
        continue;
      }
      report.error ??= `notes list failed (${(got as any).thrown ?? got.status}) for job ${jobId}`.slice(0, 160);
      if (++failures >= MAX_CONSECUTIVE_FAILURES) {
        report.deferred = due.length - i - 1;
        break;
      }
      continue;
    }
    failures = 0;
    // Re-read the link at write time: the job may have been re-filed while we were asking HOVER.
    const [cur] = await db.select({ customerId: crmMeasurements.customerId }).from(crmMeasurements)
      .where(and(eq(crmMeasurements.id, row.id), eq(crmMeasurements.orgId, orgId))).limit(1);
    if (!cur?.customerId) continue;
    const r = await importHoverJobNotes(orgId, cur.customerId, jobId, got.notes);
    report.inserted += r.inserted;
    report.updated += r.updated;
    report.checked++;
    await stampNotesRead(row.id, new Date(now()).toISOString(), listedUpdated.get(jobId) ?? null);
  }
  return report;
}
