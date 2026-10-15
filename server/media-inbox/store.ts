/** The media inbox's database access (./schema.ts). */
import { pool } from "../db";
import type { MediaDecision } from "./ai";
import type { Inbound } from "./mailbox";
import type { MediaPartnerKind } from "@shared/media-inbox";

export const storeDeps = { db: () => pool };
const db = () => storeDeps.db();

export async function getState(mailbox: string): Promise<{ uidValidity: string | null; lastUid: number }> {
  const r = await db().query(`SELECT uid_validity, last_uid FROM media_inbox_state WHERE mailbox = $1`, [mailbox]);
  return { uidValidity: r.rows[0]?.uid_validity ?? null, lastUid: Number(r.rows[0]?.last_uid ?? 0) };
}

export async function saveState(mailbox: string, uidValidity: string, lastUid: number) {
  await db().query(
    `INSERT INTO media_inbox_state (mailbox, uid_validity, last_uid) VALUES ($1, $2, $3)
     ON CONFLICT (mailbox) DO UPDATE SET uid_validity = $2, last_uid = GREATEST(CASE WHEN media_inbox_state.uid_validity = $2 THEN media_inbox_state.last_uid ELSE 0 END, $3)`,
    [mailbox, uidValidity, lastUid]);
}

export async function markPass(mailbox: string, error: string | null) {
  await db().query(
    `INSERT INTO media_inbox_state (mailbox, last_pass_at, last_pass_error) VALUES ($1, now(), $2)
     ON CONFLICT (mailbox) DO UPDATE SET last_pass_at = now(), last_pass_error = $2`, [mailbox, error]);
}

/** Store an inbound email once (by Message-ID). `reason` set = a machine sender, logged as automated. */
export async function saveInbound(mailbox: string, m: Inbound, reason: string | null): Promise<boolean> {
  // A reply to an email we sent joins that email's thread and company (our first-contact emails have no Gmail thread id).
  const known = m.references.length
    ? (await db().query(`SELECT thread_key, partner_id FROM media_messages WHERE message_id = ANY($1) ORDER BY id LIMIT 1`, [m.references])).rows[0]
    : null;
  const r = await db().query(
    `INSERT INTO media_messages (mailbox, message_id, thread_key, direction, from_email, from_name, to_email, cc, subject, body, references_ids, received_at, status, reason, partner_id)
     VALUES ($1, $2, $3, 'in', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT (message_id) DO NOTHING RETURNING id`,
    [mailbox, m.messageId, known?.thread_key ?? m.threadKey, m.fromEmail, m.fromName, m.to, m.cc, m.subject.slice(0, 500), m.body, m.references.join(" "), m.date,
      reason ? "automated" : "new", reason, known?.partner_id ?? null]);
  return Boolean(r.rows[0]);
}

export type PendingMessage = {
  id: number; body: string; partnerId: number | null; messageId: string; threadKey: string | null; fromEmail: string; fromName: string | null; cc: string | null;
  subject: string; references: string[]; attempts: number;
};

export async function pending(limit: number): Promise<PendingMessage[]> {
  const r = await db().query(
    `SELECT id, body, partner_id, message_id, thread_key, from_email, from_name, cc, subject, references_ids, attempts FROM media_messages
      WHERE direction = 'in' AND status = 'new' ORDER BY received_at LIMIT $1`, [limit]);
  return r.rows.map((x) => ({
    id: x.id, body: x.body ?? "", partnerId: x.partner_id, messageId: x.message_id, threadKey: x.thread_key, fromEmail: x.from_email, fromName: x.from_name, cc: x.cc,
    subject: x.subject, references: String(x.references_ids ?? "").split(/\s+/).filter(Boolean), attempts: x.attempts,
  }));
}

export async function thread(threadKey: string | null, id: number) {
  const r = await db().query(
    `SELECT direction, from_email, received_at, subject, body FROM media_messages
      WHERE (thread_key = $1 AND $1 IS NOT NULL) OR id = $2 ORDER BY received_at, id`, [threadKey, id]);
  return r.rows.map((x) => ({ direction: x.direction, from: x.from_email, at: new Date(x.received_at).toISOString(), subject: x.subject, body: x.body }));
}

export async function bumpAttempt(id: number, error: string) {
  await db().query(`UPDATE media_messages SET attempts = attempts + 1, reason = $2 WHERE id = $1`, [id, error.slice(0, 500)]);
}

/** Replies already sent to this address today (loop protection against another auto-responder). */
export async function repliesToday(email: string): Promise<number> {
  const r = await db().query(`SELECT count(*)::int n FROM media_messages WHERE direction = 'out' AND lower(to_email) = lower($1) AND received_at > now() - interval '24 hours'`, [email]);
  return Number(r.rows[0]?.n ?? 0);
}

export type OutboundPurpose = "reply" | "outreach" | "followup";
export async function saveOutbound(mailbox: string, o: { messageId: string; threadKey: string | null; to: string; cc?: string | null; subject: string; body: string; partnerId: number | null; purpose: OutboundPurpose }): Promise<number> {
  const r = await db().query(
    `INSERT INTO media_messages (mailbox, message_id, thread_key, direction, from_email, to_email, cc, subject, body, status, partner_id, purpose)
     VALUES ($1, $2, $3, 'out', $1, $4, $5, $6, $7, 'replied', $8, $9) ON CONFLICT (message_id) DO NOTHING RETURNING id`,
    [mailbox, o.messageId, o.threadKey ?? o.messageId, o.to, o.cc ?? null, o.subject, o.body, o.partnerId, o.purpose]);
  if (o.partnerId) await db().query(
    `UPDATE media_partners SET tried_emails = CASE WHEN lower($2) = ANY(tried_emails) THEN tried_emails ELSE array_append(tried_emails, lower($2)) END, last_message_at = now() WHERE id = $1`,
    [o.partnerId, o.to]);
  return r.rows[0]?.id ?? 0;
}

export type SilentThread = {
  lastId: number; threadKey: string; to: string; cc: string | null; lastMessageId: string; references: string[];
  partnerId: number; company: string; domain: string | null; contactName: string | null; triedEmails: string[];
  followups: number; firstSubject: string; firstBody: string;
};

/**
 * Threads where we wrote last, nobody answered for `days`, the ball is not in our court (no email waiting for the
 * owner) and the company is still live (talking / agreed). Each is acted on once (followed_up_at on our last email).
 */
export async function silentThreads(days: number, limit = 20): Promise<SilentThread[]> {
  const r = await db().query(
    `WITH last AS (
       SELECT DISTINCT ON (thread_key) * FROM media_messages WHERE thread_key IS NOT NULL ORDER BY thread_key, received_at DESC, id DESC)
     SELECT l.id, l.thread_key, l.to_email, l.cc, l.message_id, l.partner_id, p.company, p.domain, p.contact_name, p.tried_emails,
            (SELECT count(*)::int FROM media_messages f WHERE f.thread_key = l.thread_key AND f.purpose = 'followup') AS followups,
            (SELECT string_agg(o.message_id, ' ' ORDER BY o.received_at) FROM media_messages o WHERE o.thread_key = l.thread_key) AS refs,
            (SELECT o.subject FROM media_messages o WHERE o.thread_key = l.thread_key AND o.direction = 'out' ORDER BY o.received_at, o.id LIMIT 1) AS first_subject,
            (SELECT o.body FROM media_messages o WHERE o.thread_key = l.thread_key AND o.direction = 'out' ORDER BY o.received_at, o.id LIMIT 1) AS first_body
       FROM last l JOIN media_partners p ON p.id = l.partner_id
      WHERE l.direction = 'out' AND l.followed_up_at IS NULL AND l.received_at < now() - make_interval(days => $1)
        AND p.status IN ('talking', 'agreed')
        AND NOT EXISTS (SELECT 1 FROM media_messages i WHERE i.thread_key = l.thread_key AND i.direction = 'in' AND i.status IN ('needs_owner', 'failed', 'new'))
      ORDER BY l.received_at LIMIT $2`, [days, limit]);
  return r.rows.map((x) => ({
    lastId: x.id, threadKey: x.thread_key, to: x.to_email, cc: x.cc, lastMessageId: x.message_id, references: String(x.refs ?? "").split(" ").filter(Boolean),
    partnerId: x.partner_id, company: x.company, domain: x.domain, contactName: x.contact_name, triedEmails: x.tried_emails ?? [],
    followups: x.followups, firstSubject: x.first_subject ?? "", firstBody: x.first_body ?? "",
  }));
}

export async function markFollowedUp(messageId: number) {
  await db().query(`UPDATE media_messages SET followed_up_at = now() WHERE id = $1`, [messageId]);
}

/** Contact addresses we already hold for a domain (the Backlinks database's crawl). */
export async function knownEmails(domain: string): Promise<string[]> {
  const r = await db().query(`SELECT contact_emails FROM backlink_sources WHERE domain = $1`, [domain]).catch(() => ({ rows: [] as any[] }));
  return (r.rows[0]?.contact_emails ?? []) as string[];
}

export async function noteOnPartner(id: number, ownerQuestion: string) {
  await db().query(`UPDATE media_partners SET owner_question = $2, updated_at = now() WHERE id = $1`, [id, ownerQuestion]);
}

export async function finishMessage(id: number, status: "replied" | "needs_owner" | "failed", reason: string | null, replyId: number | null, partnerId: number | null) {
  await db().query(`UPDATE media_messages SET status = $2, reason = $3, reply_id = $4, partner_id = COALESCE($5, partner_id) WHERE id = $1`,
    [id, status, reason, replyId, partnerId]);
}

export type PartnerRow = { id: number; company: string; domain: string | null; kind: MediaPartnerKind; status: string; costTerms: string | null; agreement: string | null; addedTo: string | null; contactEmail: string | null };
const partnerRow = (x: any): PartnerRow => ({ id: x.id, company: x.company, domain: x.domain, kind: x.kind, status: x.status, costTerms: x.cost_terms, agreement: x.agreement, addedTo: x.added_to, contactEmail: x.contact_email });

/**
 * Create or update the company behind an email from the model's reading of the thread. Status only moves forward
 * (finalized is the admin's call and is never undone here); agreed stamps agreed_at once.
 */
export async function upsertPartner(p: { domain: string | null; contactEmail: string; contactName: string | null; d: MediaDecision }): Promise<{ partner: PartnerRow; newlyAgreed: boolean }> {
  const found = p.domain
    ? await db().query(`SELECT * FROM media_partners WHERE domain = $1`, [p.domain])
    : await db().query(`SELECT * FROM media_partners WHERE domain IS NULL AND lower(contact_email) = lower($1)`, [p.contactEmail]);
  const d = p.d;
  const company = d.company ?? p.domain ?? p.contactEmail;
  if (!found.rows[0]) {
    const r = await db().query(
      `INSERT INTO media_partners (company, domain, kind, status, contact_name, contact_email, summary, agreement, to_finalize, cost_terms, owner_question, agreed_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $4 = 'agreed' THEN now() END, now()) RETURNING *`,
      [company, p.domain, d.kind, d.stage, p.contactName, p.contactEmail, d.summary, d.agreement, d.toFinalize, d.costTerms, d.ownerQuestion]);
    return { partner: partnerRow(r.rows[0]), newlyAgreed: d.stage === "agreed" };
  }
  const cur = found.rows[0];
  const next = cur.status === "finalized" ? "finalized" : cur.status === "agreed" && d.stage === "talking" ? "agreed" : d.stage;
  const r = await db().query(
    `UPDATE media_partners SET company = COALESCE($2, company), kind = CASE WHEN kind = 'other' THEN $3 ELSE kind END, status = $4,
       contact_name = COALESCE(contact_name, $5), contact_email = COALESCE(contact_email, $6), summary = COALESCE(NULLIF($7, ''), summary),
       agreement = COALESCE($8, agreement), to_finalize = COALESCE($9, to_finalize), cost_terms = COALESCE($10, cost_terms),
       owner_question = $11, agreed_at = CASE WHEN $4 = 'agreed' AND agreed_at IS NULL THEN now() ELSE agreed_at END,
       last_message_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [cur.id, d.company, d.kind, next, p.contactName, p.contactEmail, d.summary, d.agreement, d.toFinalize, d.costTerms, d.ownerQuestion]);
  return { partner: partnerRow(r.rows[0]), newlyAgreed: next === "agreed" && cur.status !== "agreed" && cur.status !== "finalized" };
}

/** Find or create the company we email first (outreach from the admin page). */
export async function partnerForOutreach(company: string, domain: string | null, kind: MediaPartnerKind, email: string): Promise<number> {
  const r = await db().query(
    `INSERT INTO media_partners (company, domain, kind, contact_email, last_message_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (domain) DO UPDATE SET last_message_at = now(), updated_at = now() RETURNING id`,
    [company, domain, kind, email]);
  return r.rows[0].id;
}

const BACKLINK_KIND: Partial<Record<MediaPartnerKind, string>> = { article: "guest_post", news: "editorial", pbn: "pbn" };

/**
 * An agreed company joins our own lists: a directory → the directory catalogue (listing_directories, kind "partner");
 * an article site, news outlet or PBN → the Backlinks database as "agreed". Returns where it went, or why it could not.
 */
export async function addAgreedPartner(p: PartnerRow): Promise<{ addedTo: string | null; note: string | null }> {
  if (p.addedTo) return { addedTo: p.addedTo, note: null };
  if (!p.domain) return { addedTo: null, note: "Need the company's website to add it to our lists" };
  const when = new Date().toISOString().slice(0, 10);
  let addedTo: string | null = null;
  if (p.kind === "directory") {
    const note = `Partner agreement via media@ (${when}): ${p.agreement ?? "agreed"}`.slice(0, 1000);
    const hit = await db().query(`UPDATE listing_directories SET notes = concat_ws(' · ', notes, $2::text), active = true, updated_at = now() WHERE domain = $1 RETURNING id`, [p.domain, note]);
    if (!hit.rows[0]) {
      const taken = await db().query(`SELECT 1 FROM listing_directories WHERE name = $1`, [p.company]);
      await db().query(
        `INSERT INTO listing_directories (name, domain, kind, tier, category, paid, source, notes) VALUES ($1, $2, 'partner', 3, 'general', $3, $4, $5)`,
        [taken.rows[0] ? `${p.company} (${p.domain})` : p.company, p.domain, Boolean(p.costTerms), `https://${p.domain}/`, note]);
    }
    addedTo = "Directory catalogue";
  } else if (BACKLINK_KIND[p.kind]) {
    const r = await db().query(
      `INSERT INTO backlink_sources (domain, kind, discovered_url, discovered_via, status) VALUES ($1, $2, $3, 'media-inbox', 'agreed')
       ON CONFLICT (domain) DO UPDATE SET status = 'agreed', updated_at = now() RETURNING id`,
      [p.domain, BACKLINK_KIND[p.kind], `https://${p.domain}/`]);
    await db().query(`INSERT INTO backlink_events (source_id, type, detail) VALUES ($1, 'agreed', $2)`, [r.rows[0].id, JSON.stringify({ via: "media-inbox", agreement: p.agreement })]);
    addedTo = "Backlinks database";
  } else {
    return { addedTo: null, note: null };
  }
  await db().query(`UPDATE media_partners SET added_to = $2, updated_at = now() WHERE id = $1`, [p.id, addedTo]);
  return { addedTo, note: null };
}

// ── admin reads ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function summary(mailbox: string) {
  const [m, p, s] = await Promise.all([
    db().query(`SELECT status, count(*)::int n FROM media_messages WHERE direction = 'in' GROUP BY status`),
    db().query(`SELECT status, count(*)::int n FROM media_partners GROUP BY status`),
    db().query(`SELECT last_pass_at, last_pass_error FROM media_inbox_state WHERE mailbox = $1`, [mailbox]),
  ]);
  const sent = await db().query(`SELECT count(*)::int n FROM media_messages WHERE direction = 'out'`);
  const queue = await queueCounts();
  return {
    counts: Object.fromEntries(m.rows.map((x) => [x.status, x.n])),
    partners: Object.fromEntries(p.rows.map((x) => [x.status, x.n])),
    sent: Number(sent.rows[0]?.n ?? 0),
    queue,
    lastPassAt: s.rows[0]?.last_pass_at ? new Date(s.rows[0].last_pass_at).toISOString() : null,
    lastPassError: s.rows[0]?.last_pass_error ?? null,
  };
}

export async function listPartners(status?: string) {
  const r = await db().query(
    `SELECT p.*, (SELECT count(*)::int FROM media_messages m WHERE m.partner_id = p.id) AS messages FROM media_partners p
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY CASE p.status WHEN 'agreed' THEN 0 WHEN 'talking' THEN 1 WHEN 'finalized' THEN 2 ELSE 3 END, p.last_message_at DESC NULLS LAST`,
    [status ?? null]);
  return r.rows.map((x) => ({
    id: x.id, company: x.company, domain: x.domain, kind: x.kind, status: x.status, contactName: x.contact_name, contactEmail: x.contact_email,
    summary: x.summary, agreement: x.agreement, toFinalize: x.to_finalize, costTerms: x.cost_terms, ownerQuestion: x.owner_question,
    agreedAt: x.agreed_at ? new Date(x.agreed_at).toISOString() : null, addedTo: x.added_to,
    lastMessageAt: x.last_message_at ? new Date(x.last_message_at).toISOString() : null, messages: x.messages,
  }));
}

export async function listMessages(f: { status?: string; direction?: string; partnerId?: number; limit: number; offset: number }) {
  const r = await db().query(
    `SELECT m.*, p.company, count(*) OVER()::int AS total FROM media_messages m LEFT JOIN media_partners p ON p.id = m.partner_id
      WHERE ($1::text IS NULL OR m.status = $1) AND ($2::text IS NULL OR m.direction = $2) AND ($3::int IS NULL OR m.partner_id = $3)
      ORDER BY m.received_at DESC, m.id DESC LIMIT $4 OFFSET $5`,
    [f.status ?? null, f.direction ?? null, f.partnerId ?? null, f.limit, f.offset]);
  return {
    total: Number(r.rows[0]?.total ?? 0),
    rows: r.rows.map((x) => ({
      id: x.id, direction: x.direction, fromEmail: x.from_email, fromName: x.from_name, toEmail: x.to_email, subject: x.subject,
      body: x.body, receivedAt: new Date(x.received_at).toISOString(), status: x.status, reason: x.reason, partnerId: x.partner_id, company: x.company,
    })),
  };
}

export async function getPartner(id: number): Promise<PartnerRow | null> {
  const r = await db().query(`SELECT * FROM media_partners WHERE id = $1`, [id]);
  return r.rows[0] ? partnerRow(r.rows[0]) : null;
}

export async function updatePartner(id: number, f: { status?: string; kind?: string; toFinalize?: string | null; ownerQuestion?: string | null; domain?: string | null }) {
  await db().query(
    `UPDATE media_partners SET status = COALESCE($2, status), kind = COALESCE($3, kind),
       to_finalize = CASE WHEN $4::boolean THEN $5 ELSE to_finalize END, owner_question = CASE WHEN $6::boolean THEN $7 ELSE owner_question END,
       domain = CASE WHEN $8::boolean THEN $9 ELSE domain END,
       agreed_at = CASE WHEN $2 IN ('agreed','finalized') AND agreed_at IS NULL THEN now() ELSE agreed_at END, updated_at = now() WHERE id = $1`,
    [id, f.status ?? null, f.kind ?? null, f.toFinalize !== undefined, f.toFinalize ?? null, f.ownerQuestion !== undefined, f.ownerQuestion ?? null,
      f.domain !== undefined, f.domain ?? null]);
}

export async function markHandled(id: number) {
  await db().query(`UPDATE media_messages SET status = 'replied', reason = concat_ws(' · ', reason, 'Handled by an admin') WHERE id = $1 AND status IN ('needs_owner','failed')`, [id]);
}

// ── first-contact queue ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Queue the vetted directories that are listings businesses (owner, 2026-10-14). Only general business directories
 * and contractor directories qualify: the directory catalogue's "general" / "contractor" rows, or a Backlinks
 * "citation" source the catalogue does not hold. Government sites (licence lookups), trade associations (they sell
 * memberships), chambers and manufacturer dealer locators are places to be listed, not listings partners, and the
 * first batch of 2026-10-14 wrongly reached a state attorney general. Graded A or B, publishes an email, never
 * contacted. `pick` chooses the address; `name` is the fallback greeting name. Returns how many were added.
 */
export const NOT_A_LISTINGS_BUSINESS = /(\.(gov|mil|edu)$)|(\.(state|k12|co|ci|city)\.[a-z]{2}\.us$)|chamber|association|assoc\b|institute|council|society|federation|union\b/i;
export const NOT_A_PARTNER_ADDRESS = /^(membership|members|member|diversity|hr|careers|jobs|customer[._-]?(support|service|care)|hic|complaints?|legal|privacy|accounting|billing|webmaster)[._@+-]/i;

export async function queueVettedDirectories(pick: (emails: string[]) => string | null, name: (domain: string, signals: any) => string): Promise<number> {
  const r = await db().query(
    `SELECT s.domain, s.kind, s.contact_emails, s.signals, d.name AS catalogue_name FROM backlink_sources s
       LEFT JOIN listing_directories d ON d.domain = s.domain
      WHERE s.kind IN ('directory', 'citation') AND s.tier IN ('A', 'B') AND cardinality(s.contact_emails) > 0
        AND (d.category IN ('general', 'contractor') OR (d.id IS NULL AND s.kind = 'citation'))
        AND NOT EXISTS (SELECT 1 FROM media_outreach_queue q WHERE q.domain = s.domain)
        AND NOT EXISTS (SELECT 1 FROM media_partners p WHERE p.domain = s.domain)
      ORDER BY s.tier, s.score DESC NULLS LAST`);
  let added = 0;
  for (const x of r.rows) {
    if (NOT_A_LISTINGS_BUSINESS.test(x.domain) || NOT_A_LISTINGS_BUSINESS.test(x.catalogue_name ?? "")) continue;
    const to = pick((x.contact_emails as string[]).filter((e) => !NOT_A_PARTNER_ADDRESS.test(e)));
    if (!to) continue;
    const fallback = name(x.domain, x.signals);
    const company = (x.catalogue_name && fallback === x.domain ? x.catalogue_name : fallback).slice(0, 120);
    const ins = await db().query(
      `INSERT INTO media_outreach_queue (domain, company, kind, to_email, source) VALUES ($1, $2, 'directory', $3, 'backlinks-db') ON CONFLICT (domain) DO NOTHING RETURNING id`,
      [x.domain, company, to.toLowerCase()]);
    if (ins.rows[0]) added++;
  }
  return added;
}

const FREE_MAIL_ADDR = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|aol|icloud|proton(mail)?)\./i;

/** Vetted directories (any tier) that publish an email and were never classified. Government sites never reach the AI. */
export async function needingClass(limit: number): Promise<{ domain: string; title: string | null; homeTitle: string | null }[]> {
  const r = await db().query(
    `SELECT domain, signals->>'title' AS title, signals->>'homeTitle' AS "homeTitle" FROM backlink_sources
      WHERE status = 'qualified' AND kind IN ('directory', 'citation') AND cardinality(contact_emails) > 0 AND partner_class IS NULL
        AND domain !~ '\\.(gov|mil|edu)$' AND domain !~ '\\.(state|k12|co|ci|city|us)\\.[a-z]{2}\\.us$'
      ORDER BY tier, score DESC NULLS LAST LIMIT $1`, [limit]);
  return r.rows;
}
export async function saveClasses(classes: Map<string, string>, names: Map<string, string> = new Map()) {
  for (const [domain, cls] of classes)
    await db().query(`UPDATE backlink_sources SET partner_class = $2, partner_name = $3, partner_class_at = now() WHERE domain = $1`, [domain, cls, names.get(domain) ?? null]);
}

/**
 * Queue classified directories (2026-10-15): a listing directory gets the Directory Sync email, a trade association or
 * chamber the member-resource email. Government sites and webmail addresses (often a member's, not the organisation's)
 * are never queued.
 */
export async function queueClassified(pick: (emails: string[]) => string | null, name: (domain: string, signals: any) => string): Promise<number> {
  const r = await db().query(
    `SELECT s.domain, s.partner_class, s.partner_name, s.contact_emails, s.signals FROM backlink_sources s
      WHERE s.status = 'qualified' AND s.partner_class IN ('listing_directory', 'trade_association', 'chamber') AND cardinality(s.contact_emails) > 0
        AND NOT EXISTS (SELECT 1 FROM media_outreach_queue q WHERE q.domain = s.domain)
        AND NOT EXISTS (SELECT 1 FROM media_partners p WHERE p.domain = s.domain)
      ORDER BY s.tier, s.score DESC NULLS LAST`);
  let added = 0;
  for (const x of r.rows) {
    if (/\.(gov|mil|edu)$/.test(x.domain)) continue;
    const to = pick((x.contact_emails as string[]).filter((e) => !NOT_A_PARTNER_ADDRESS.test(e) && !FREE_MAIL_ADDR.test(e)));
    if (!to) continue;
    const ins = await db().query(
      `INSERT INTO media_outreach_queue (domain, company, kind, to_email, source) VALUES ($1, $2, $3, $4, 'backlinks-classified') ON CONFLICT (domain) DO NOTHING RETURNING id`,
      [x.domain, (x.partner_name ?? name(x.domain, x.signals)).slice(0, 120), x.partner_class === "listing_directory" ? "directory" : "association", to.toLowerCase()]);
    if (ins.rows[0]) added++;
  }
  return added;
}


/**
 * Queue vetted article / guest-post sites and news outlets (Backlinks kinds guest_post, editorial, press_release; tier
 * A or B; at least 500 Google visits a month — below that it is a contractor's own blog or a link farm; publishes an
 * email; never contacted). Same exclusions as directories, plus free-mail addresses (on these
 * sites they are mostly guest-post sellers, not editors). press_release / editorial → "news", guest_post → "article".
 */
export async function queueVettedPublishers(pick: (emails: string[]) => string | null, name: (domain: string, signals: any) => string): Promise<number> {
  const r = await db().query(
    `SELECT s.domain, s.kind, s.contact_emails, s.signals FROM backlink_sources s
      WHERE s.kind IN ('guest_post', 'editorial', 'press_release') AND s.tier IN ('A', 'B') AND cardinality(s.contact_emails) > 0
        AND COALESCE((s.metrics->>'organicTraffic')::numeric, 0) >= 500
        AND NOT EXISTS (SELECT 1 FROM media_outreach_queue q WHERE q.domain = s.domain)
        AND NOT EXISTS (SELECT 1 FROM media_partners p WHERE p.domain = s.domain)
      ORDER BY s.tier, s.score DESC NULLS LAST`);
  let added = 0;
  for (const x of r.rows) {
    if (NOT_A_LISTINGS_BUSINESS.test(x.domain)) continue;
    const to = pick((x.contact_emails as string[]).filter((e) => !NOT_A_PARTNER_ADDRESS.test(e) && !FREE_MAIL_ADDR.test(e)));
    if (!to) continue;
    const ins = await db().query(
      `INSERT INTO media_outreach_queue (domain, company, kind, to_email, source) VALUES ($1, $2, $3, $4, 'backlinks-db') ON CONFLICT (domain) DO NOTHING RETURNING id`,
      [x.domain, name(x.domain, x.signals).slice(0, 120), x.kind === "guest_post" ? "article" : "news", to.toLowerCase()]);
    if (ins.rows[0]) added++;
  }
  return added;
}

/** Load a researched list (news outlets, directories) into the queue; existing domains and contacted companies are skipped. */
export async function queueList(rows: { domain: string; company: string; kind: "directory" | "article" | "news"; email: string }[], source: string): Promise<number> {
  let added = 0;
  for (const r of rows) {
    const ins = await db().query(
      `INSERT INTO media_outreach_queue (domain, company, kind, to_email, source)
       SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM media_partners p WHERE p.domain = $1)
       ON CONFLICT (domain) DO NOTHING RETURNING id`,
      [r.domain.toLowerCase(), r.company.slice(0, 120), r.kind, r.email.toLowerCase(), source.slice(0, 60)]);
    if (ins.rows[0]) added++;
  }
  return added;
}

/** Whole days since the first first-contact email (the sending ramp). */
export async function daysSending(): Promise<number> {
  const r = await db().query(`SELECT floor(extract(epoch FROM now() - min(received_at)) / 86400)::int d FROM media_messages WHERE direction = 'out' AND purpose = 'outreach'`);
  return Number(r.rows[0]?.d ?? 0);
}

export async function outreachSentToday(): Promise<number> {
  const r = await db().query(`SELECT count(*)::int n FROM media_messages WHERE direction = 'out' AND purpose = 'outreach' AND received_at >= date_trunc('day', now())`);
  return Number(r.rows[0]?.n ?? 0);
}

export async function nextQueued(limit: number) {
  const r = await db().query(`SELECT id, domain, company, kind, to_email FROM media_outreach_queue WHERE status = 'queued' ORDER BY id LIMIT $1`, [limit]);
  return r.rows as { id: number; domain: string; company: string; kind: string; to_email: string }[];
}

export async function finishQueued(id: number, status: "sent" | "skipped", reason: string | null) {
  await db().query(`UPDATE media_outreach_queue SET status = $2, reason = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() END WHERE id = $1`, [id, status, reason]);
}

export async function queueCounts() {
  const r = await db().query(`SELECT count(*) FILTER (WHERE status = 'queued')::int queued, count(*) FILTER (WHERE status = 'sent')::int sent,
    count(*) FILTER (WHERE status = 'sent' AND sent_at >= date_trunc('day', now()))::int sent_today FROM media_outreach_queue`);
  return { queued: r.rows[0]?.queued ?? 0, sent: r.rows[0]?.sent ?? 0, sentToday: r.rows[0]?.sent_today ?? 0 };
}

/** They asked us to stop: the company is declined and the address never gets another email. */
export async function optOut(messageId: number, email: string, partnerId: number | null) {
  const { suppress } = await import("../backlinks/store");
  await suppress(email, "Asked the media inbox to stop");
  await db().query(`UPDATE media_messages SET status = 'replied', reason = 'Asked us to stop — no reply, never emailed again' WHERE id = $1`, [messageId]);
  if (partnerId) await db().query(`UPDATE media_partners SET status = 'declined', owner_question = NULL, updated_at = now() WHERE id = $1 AND status <> 'finalized'`, [partnerId]);
  await db().query(`UPDATE media_outreach_queue SET status = 'skipped', reason = 'Opted out' WHERE to_email = lower($1) AND status = 'queued'`, [email]);
}

export async function partnerIdForEmail(email: string, domain: string | null): Promise<number | null> {
  const r = await db().query(`SELECT id FROM media_partners WHERE (domain = $2 AND $2 IS NOT NULL) OR lower(contact_email) = lower($1) OR lower($1) = ANY(tried_emails) LIMIT 1`, [email, domain]);
  return r.rows[0]?.id ?? null;
}

// ── auto-replies from companies we contacted ─────────────────────────────────────────────────────────────────────────

/** Auto-replies (not bounces or system mail) not yet read for a next step, with the company they belong to. */
export async function unreadAutoReplies(limit = 20) {
  const r = await db().query(
    `SELECT m.id, m.thread_key, m.from_email, m.body, COALESCE(m.partner_id,
            (SELECT p.id FROM media_partners p WHERE p.domain = split_part(lower(m.from_email), '@', 2)
               OR split_part(lower(m.from_email), '@', 2) LIKE '%.' || p.domain OR lower(m.from_email) = ANY(p.tried_emails) LIMIT 1)) AS partner_id
       FROM media_messages m
      WHERE m.direction = 'in' AND m.status = 'automated' AND m.attempts = 0 AND m.reason LIKE 'Automatic message%'
      ORDER BY m.id LIMIT $1`, [limit]);
  return r.rows.filter((x) => x.partner_id) as { id: number; thread_key: string | null; from_email: string; body: string; partner_id: number }[];
}

export async function saveNextStep(messageId: number, partnerId: number, step: { nextStep: string | null; link: string | null; contact: string | null; contactRole?: string | null; summary: string }) {
  const action = [step.nextStep, step.link, step.contact ? `Contact: ${step.contact}` : null].filter(Boolean).join(" — ");
  await db().query(
    `UPDATE media_messages SET attempts = 1, partner_id = $2, reason = concat_ws(' · ', reason, $3::text), next_link = $4, next_contact = $5, next_contact_role = $6,
       acted_at = CASE WHEN $4::text IS NULL AND $5::text IS NULL THEN now() END WHERE id = $1`,
    [messageId, partnerId, action ? `Next step: ${action}` : `Auto-reply read: ${step.summary}`, step.link, step.contact, step.contactRole ?? null]);
  if (action) await db().query(
    `UPDATE media_partners SET to_finalize = $2, summary = concat_ws(' ', summary, $3::text), updated_at = now() WHERE id = $1`,
    [partnerId, `Doing it automatically: ${action}`, `Auto-reply: ${step.summary}`]);
}

export type PendingAction = {
  id: number; partnerId: number; company: string; domain: string | null; triedEmails: string[]; threadKey: string | null;
  link: string | null; contact: string | null; contactRole: string | null;
};
/** Auto-reply next steps not yet carried out, for companies still in play. */
export async function pendingActions(limit = 5): Promise<PendingAction[]> {
  const r = await db().query(
    `SELECT m.id, m.partner_id, p.company, p.domain, p.tried_emails, m.thread_key, m.next_link, m.next_contact, m.next_contact_role
       FROM media_messages m JOIN media_partners p ON p.id = m.partner_id
      WHERE m.acted_at IS NULL AND (m.next_link IS NOT NULL OR m.next_contact IS NOT NULL) AND p.status <> 'declined'
      ORDER BY m.id LIMIT $1`, [limit]);
  return r.rows.map((x) => ({ id: x.id, partnerId: x.partner_id, company: x.company, domain: x.domain, triedEmails: x.tried_emails ?? [], threadKey: x.thread_key, link: x.next_link, contact: x.next_contact, contactRole: x.next_contact_role }));
}

/** What the executor did: on the auto-reply and on the company's record (a price or a blocked form reaches the owner). */
export async function recordAction(messageId: number, partnerId: number, r: { result: string; toFinalize: string | null; costTerms?: string | null; ownerQuestion?: string | null }) {
  await db().query(`UPDATE media_messages SET acted_at = now(), action_result = $2 WHERE id = $1`, [messageId, r.result]);
  await db().query(
    `UPDATE media_partners SET to_finalize = $2, cost_terms = CASE WHEN $3::text IS NULL OR cost_terms LIKE '%' || $3 || '%' THEN cost_terms ELSE concat_ws(' · ', cost_terms, $3::text) END,
       owner_question = COALESCE($4, owner_question), summary = concat_ws(' ', summary, $5::text), updated_at = now() WHERE id = $1`,
    [partnerId, r.toFinalize, r.costTerms ?? null, r.ownerQuestion ?? null, r.result]);
}

/** The first email we sent in a thread (what a new contact is sent). */
export async function firstOutbound(partnerId: number): Promise<{ subject: string; body: string } | null> {
  const r = await db().query(`SELECT subject, body FROM media_messages WHERE partner_id = $1 AND direction = 'out' AND purpose = 'outreach' ORDER BY id LIMIT 1`, [partnerId]);
  return r.rows[0] ?? null;
}

export async function markAutoReplyTried(messageId: number) {
  await db().query(`UPDATE media_messages SET attempts = attempts + 1 WHERE id = $1`, [messageId]);
}
