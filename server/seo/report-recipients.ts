/**
 * Who may receive an account's SEO report emails (security review S-3).
 *
 * Report emails go to addresses the customer typed, carry the customer's brand
 * name and PDF, and leave from our domain — so an address gets nothing until
 * it has CONFIRMED. The rules, in one place:
 *
 *  - A new address is sent ONE short confirmation email (no PDF, nothing the
 *    customer wrote beyond a length-limited, escaped brand name) with a signed,
 *    single-use link that expires in 7 days. Until it is used the address is
 *    "pending" and both "Send now" and the schedule skip it.
 *  - Addresses that belong to the account (the signed-in owner, active team
 *    members who accepted their invitation) are confirmed on sight.
 *  - "This wasn't me" blocks the address for that account AND for every
 *    account (seo_report_blocks). TODO(privacy-code): once the platform-wide
 *    suppression table from the privacy-code branch is on main, write there
 *    too / read it here and retire seo_report_blocks.
 *  - Limits: per account, confirmation emails a day and distinct customer-typed
 *    recipients in total (higher for Agency); per recipient, one confirmation
 *    email in 7 days across all accounts. A tripped limit is an ops issue.
 *  - Recipients saved before this existed (production schedules) have no row
 *    here: they are treated as unconfirmed, and the next send mails them the
 *    confirmation instead of the report.
 *
 * Sender identity: SEO_REPORT_FROM (default reports@constructhub.us), never
 * the billing address. NOTE the transport (server/email.ts trySend) rewrites
 * the From ADDRESS to the authenticated SMTP account; the display name and
 * Reply-To survive. For the address to really change, the operator must add
 * reports@constructhub.us as a verified "send as" alias on the SMTP account
 * (or point SMTP_EMAIL at a dedicated mailbox) with SPF/DKIM/DMARC on the
 * sending domain — see HANDOFF.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { APP_BASE_URL, emailLayout, sendTransactionalEmail, type TransactionalEmail } from "../account/email";
import { getEntitlements, type Entitlements } from "../entitlements";
import { takeBudget } from "../growth-limits";
import { recordIssue } from "../ops/issues";

export const REPORT_RECIPIENT_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_report_recipients (
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     email text NOT NULL,
     status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','blocked')),
     source text NOT NULL DEFAULT 'customer' CHECK (source IN ('customer','account')),
     nonce text,
     confirm_sent_at timestamptz,
     confirm_tries integer NOT NULL DEFAULT 0,
     confirmed_at timestamptz,
     blocked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, email)
   )`,
  `CREATE INDEX IF NOT EXISTS seo_report_recipients_email ON seo_report_recipients(email)`,
  `CREATE INDEX IF NOT EXISTS seo_report_recipients_nonce ON seo_report_recipients(nonce) WHERE nonce IS NOT NULL`,
  // "This wasn't me": the address is never mailed a report by ANY account. TODO(privacy-code): merge with the
  // platform-wide suppression table once that branch is on main.
  `CREATE TABLE IF NOT EXISTS seo_report_blocks (
     email text PRIMARY KEY,
     by_user_id integer,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
];

export type RecipientStatus = "confirmed" | "pending" | "unconfirmed" | "blocked" | "limited";
export type RecipientRow = { email: string; status: "pending" | "confirmed" | "blocked"; source: "customer" | "account"; nonce: string | null; confirmSentAt: Date | null; confirmTries: number };

/** Everything the rules read or write, so tests run them without a database. */
export type RecipientStore = {
  rows(userId: number, emails: string[]): Promise<RecipientRow[]>;
  /** The owner's address and those of active team members who accepted their invitation (lower-cased). */
  ownedAddresses(userId: number): Promise<string[]>;
  /** Customer-typed addresses this account has ever added (any status). */
  distinctCount(userId: number): Promise<number>;
  /** The newest confirmation email sent to this address by ANY account. */
  lastConfirmSentTo(email: string): Promise<Date | null>;
  globallyBlocked(email: string): Promise<boolean>;
  optedOut(userId: number, email: string): Promise<boolean>;
  insertPending(userId: number, email: string): Promise<void>;
  markConfirmationSent(userId: number, email: string, nonce: string, at: Date): Promise<void>;
  setConfirmed(userId: number, email: string, source: "customer" | "account", at: Date): Promise<void>;
  block(userId: number, email: string, at: Date): Promise<void>;
};

const norm = (email: string) => email.trim().toLowerCase();
const rowOf = (r: any): RecipientRow => ({ email: r.email, status: r.status, source: r.source, nonce: r.nonce ?? null, confirmSentAt: r.confirm_sent_at ? new Date(r.confirm_sent_at) : null, confirmTries: Number(r.confirm_tries ?? 0) });

const pgStore: RecipientStore = {
  async rows(userId, emails) {
    if (!emails.length) return [];
    const { rows } = await pool.query("SELECT email, status, source, nonce, confirm_sent_at, confirm_tries FROM seo_report_recipients WHERE user_id=$1 AND email = ANY($2)", [userId, emails]);
    return rows.map(rowOf);
  },
  async ownedAddresses(userId) {
    const { rows } = await pool.query(
      `SELECT lower(email) AS email FROM users WHERE id=$1 AND email IS NOT NULL
       UNION SELECT lower(m.email) FROM crm_members m JOIN crm_orgs o ON o.id=m.org_id WHERE o.owner_user_id=$1 AND m.status='active' AND m.user_id IS NOT NULL`, [userId]);
    return rows.map((r: any) => r.email).filter(Boolean);
  },
  async distinctCount(userId) {
    const { rows: [r] } = await pool.query("SELECT count(*)::int AS n FROM seo_report_recipients WHERE user_id=$1 AND source='customer'", [userId]);
    return Number(r?.n ?? 0);
  },
  async lastConfirmSentTo(email) {
    const { rows: [r] } = await pool.query("SELECT max(confirm_sent_at) AS at FROM seo_report_recipients WHERE email=$1", [email]);
    return r?.at ? new Date(r.at) : null;
  },
  async globallyBlocked(email) { return (await pool.query("SELECT 1 FROM seo_report_blocks WHERE email=$1", [email])).rows.length > 0; },
  async optedOut(userId, email) { return (await pool.query("SELECT 1 FROM seo_report_optouts WHERE user_id=$1 AND email=$2", [userId, email])).rows.length > 0; },
  async insertPending(userId, email) {
    await pool.query("INSERT INTO seo_report_recipients(user_id, email, status, source) VALUES($1,$2,'pending','customer') ON CONFLICT DO NOTHING", [userId, email]);
  },
  async markConfirmationSent(userId, email, nonce, at) {
    await pool.query("UPDATE seo_report_recipients SET nonce=$3, confirm_sent_at=$4, confirm_tries=confirm_tries+1 WHERE user_id=$1 AND email=$2", [userId, email, nonce, at]);
  },
  async setConfirmed(userId, email, source, at) {
    await pool.query(
      `INSERT INTO seo_report_recipients(user_id, email, status, source, confirmed_at) VALUES($1,$2,'confirmed',$3,$4)
       ON CONFLICT (user_id, email) DO UPDATE SET status='confirmed', source=EXCLUDED.source, confirmed_at=coalesce(seo_report_recipients.confirmed_at, EXCLUDED.confirmed_at)`, [userId, email, source, at]);
  },
  async block(userId, email, at) {
    await pool.query(
      `INSERT INTO seo_report_recipients(user_id, email, status, source, blocked_at, nonce) VALUES($1,$2,'blocked','customer',$3,NULL)
       ON CONFLICT (user_id, email) DO UPDATE SET status='blocked', blocked_at=EXCLUDED.blocked_at, nonce=NULL`, [userId, email, at]);
    await pool.query("INSERT INTO seo_report_blocks(email, by_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [email, userId]);
  },
};

/** Swapped by tests. */
export const recipientDeps = {
  store: pgStore as RecipientStore,
  sendEmail: (userId: number, dedupeKey: string, email: TransactionalEmail) => sendTransactionalEmail(userId, "seo.report-confirm", dedupeKey, email),
  entitlements: (userId: number): Promise<Entitlements> => getEntitlements(userId),
  takeBudget: (key: string, limit: number, windowMs: number) => takeBudget(key, limit, 1, windowMs),
  recordIssue: (input: Parameters<typeof recordIssue>[0]) => recordIssue(input).catch(() => {}),
  now: () => new Date(),
  secret: () => process.env.SEO_REPORT_SECRET || process.env.SESSION_SECRET || "",
};

// ── Sender identity ────────────────────────────────────────────────────────
/** Reports and confirmations leave from here — never from the billing/receipts address. */
export const reportFromAddress = (env: NodeJS.ProcessEnv = process.env) => (env.SEO_REPORT_FROM || "reports@constructhub.us").trim();
export const reportSender = (env: NodeJS.ProcessEnv = process.env) => `"ConstructHUB Reports" <${reportFromAddress(env)}>`;

// ── Limits ─────────────────────────────────────────────────────────────────
export const CONFIRM_LIMITS = {
  standard: { confirmationsPerDay: 5, distinctRecipients: 20 },
  agency: { confirmationsPerDay: 25, distinctRecipients: 100 },
} as const;
export const CONFIRM_TOKEN_DAYS = 7;
/** One confirmation email to an address in this many days, whoever asks. */
export const RECIPIENT_COOLDOWN_DAYS = 7;
/** Confirmation emails ever sent to one (account, address) — a pending address is never nagged forever. */
export const MAX_CONFIRM_TRIES = 3;
const DAY = 86_400_000;

/** The same gate the SEO tool reads: the Agency plan (or a platform admin's unlimited allowance) gets the higher limits. */
export const isAgency = (ent: Pick<Entitlements, "accessPlan" | "allowances"> | null | undefined) => !!ent && (ent.accessPlan === "agency" || ent.allowances?.seoKeywords === -1);
export const limitsFor = (ent: Pick<Entitlements, "accessPlan" | "allowances"> | null | undefined) => (isAgency(ent) ? CONFIRM_LIMITS.agency : CONFIRM_LIMITS.standard);

// ── Brand name: the only customer-controlled text in a confirmation ────────
export const BRAND_MAX = 60;
/** Plain text, one line, no control characters, at most BRAND_MAX characters; a neutral fallback when empty. (HTML escaping is the layout's.) */
export function brandLabel(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const s = String(name ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, BRAND_MAX).trim();
  return s || "A ConstructHUB customer";
}

// ── Token: signed, bound to (account, address, nonce), expires ──────────────
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload: string, key: string) => createHmac("sha256", key).update(`seo-report-confirm:${payload}`).digest("base64url").slice(0, 43);

export function makeConfirmToken(userId: number, email: string, nonce: string, expiresAt: Date, key = recipientDeps.secret()): string | null {
  if (!key) return null;
  const payload = `${userId}.${b64(norm(email))}.${nonce}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${payload}.${sign(payload, key)}`;
}
export type ConfirmClaim = { userId: number; email: string; nonce: string };
/** The claim a token makes, or why it is not accepted. Signature first (constant time), then expiry. */
export function parseConfirmToken(token: unknown, now = recipientDeps.now(), key = recipientDeps.secret()): { ok: true; claim: ConfirmClaim } | { ok: false; reason: "invalid" | "expired" } {
  if (!key || typeof token !== "string" || token.length > 600) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 5) return { ok: false, reason: "invalid" };
  const [u, e, nonce, exp, sig] = parts;
  const payload = `${u}.${e}.${nonce}.${exp}`;
  const want = sign(payload, key);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { ok: false, reason: "invalid" };
  const userId = Number(u), expires = Number(exp) * 1000;
  if (!Number.isInteger(userId) || userId <= 0 || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !Number.isFinite(expires)) return { ok: false, reason: "invalid" };
  let email: string;
  try { email = norm(unb64(e)); } catch { return { ok: false, reason: "invalid" }; }
  if (!email.includes("@")) return { ok: false, reason: "invalid" };
  if (expires <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, claim: { userId, email, nonce } };
}
export const confirmUrl = (token: string) => `${APP_BASE_URL()}/api/seo/report-confirm?t=${encodeURIComponent(token)}`;
export const refuseUrl = (token: string) => `${APP_BASE_URL()}/api/seo/report-refuse?t=${encodeURIComponent(token)}`;

// ── The confirmation email ─────────────────────────────────────────────────
export function confirmationEmail(brand: unknown, recipient: string, token: string): TransactionalEmail {
  const who = brandLabel(brand);
  const { html, text } = emailLayout({
    title: `${who} wants to send you SEO reports`,
    intro: `${who} uses ConstructHUB to email SEO reports and asked for them to go to ${norm(recipient)}. Nothing is sent to you unless you confirm below. If you do nothing, this address gets no reports.`,
    cta: { label: "Yes, send me the reports", url: confirmUrl(token) },
    footer: `This wasn't me / I don't want these: ${refuseUrl(token)} — that blocks this address from these reports. Both links work for ${CONFIRM_TOKEN_DAYS} days. This email was sent by ConstructHUB on behalf of a customer; we have not shared anything else with them.`,
    preheader: `Confirm before any report is sent to you.`,
  });
  return { to: norm(recipient), subject: `Confirm: SEO reports from ${who}`, html, text, from: reportSender() };
}

// ── The rules ──────────────────────────────────────────────────────────────
export type EnsureResult = {
  /** Every address asked about, with where it stands now. */
  status: Record<string, RecipientStatus>;
  confirmed: string[]; pending: string[]; blocked: string[]; limited: string[];
  /** Confirmation emails that went out in this call. */
  confirmationsSent: string[];
};

const mask = (e: string) => e.replace(/^(.).*@/, "$1***@");
const limitIssue = (userId: number, kind: string, detail: Record<string, unknown>) => recipientDeps.recordIssue({
  source: "server", severity: "warning", key: `seo-report-confirm-limit:${kind}:${userId}`,
  title: `SEO report confirmations: ${kind} limit reached (account ${userId})`, detail: { userId, kind, ...detail },
});

/**
 * Bring every address in `emails` to a known standing for this account, sending a confirmation email to each one that
 * needs it (within the limits). Called when a schedule is saved, on "Send now", and by the scheduler before each send —
 * which is how recipients saved before confirmation existed get their confirmation instead of a report.
 */
export async function ensureRecipients(userId: number, emails: string[], opts: { brand?: string | null; ent?: Entitlements | null } = {}): Promise<EnsureResult> {
  const d = recipientDeps, now = d.now();
  const list = [...new Set(emails.map(norm).filter((e) => e.includes("@")))];
  const res: EnsureResult = { status: {}, confirmed: [], pending: [], blocked: [], limited: [], confirmationsSent: [] };
  if (!list.length) return res;
  const [owned, rows, ent] = await Promise.all([d.store.ownedAddresses(userId), d.store.rows(userId, list), opts.ent ? Promise.resolve(opts.ent) : d.entitlements(userId).catch(() => null)]);
  const ownedSet = new Set(owned.map(norm)), byEmail = new Map(rows.map((r) => [r.email, r]));
  const limits = limitsFor(ent);
  let distinct: number | null = null;
  const put = (email: string, s: RecipientStatus) => { res.status[email] = s; (s === "confirmed" ? res.confirmed : s === "blocked" ? res.blocked : s === "limited" ? res.limited : res.pending).push(email); };

  for (const email of list) {
    const row = byEmail.get(email);
    // (2) The account's own addresses: confirmed on sight, whatever any other account's recipient did.
    if (ownedSet.has(email)) {
      if (row?.status !== "confirmed" || row.source !== "account") await d.store.setConfirmed(userId, email, "account", now);
      put(email, "confirmed"); continue;
    }
    if (row?.status === "blocked" || (await d.store.optedOut(userId, email))) { put(email, "blocked"); continue; }
    if (await d.store.globallyBlocked(email)) { await d.store.block(userId, email, now); put(email, "blocked"); continue; }
    if (row?.status === "confirmed") { put(email, "confirmed"); continue; }
    // A new address (or one saved before confirmations existed).
    if (!row) {
      distinct ??= await d.store.distinctCount(userId);
      if (distinct >= limits.distinctRecipients) {
        await limitIssue(userId, "distinct-recipients", { limit: limits.distinctRecipients, email: mask(email) });
        put(email, "limited"); continue;
      }
      await d.store.insertPending(userId, email); distinct++;
    }
    const sentAt = row?.confirmSentAt ?? null, tries = row?.confirmTries ?? 0;
    const due = !sentAt || (now.getTime() - sentAt.getTime() >= RECIPIENT_COOLDOWN_DAYS * DAY && tries < MAX_CONFIRM_TRIES);
    if (!due) { put(email, "pending"); continue; }
    // (4) Limits — then the one email.
    if (!d.secret()) {
      await d.recordIssue({ source: "server", severity: "error", key: "seo-report-confirm-no-secret", title: "SEO report confirmations cannot be signed: set SEO_REPORT_SECRET (or SESSION_SECRET)", detail: { userId } });
      put(email, "pending"); continue;
    }
    const last = await d.store.lastConfirmSentTo(email);
    if (last && now.getTime() - last.getTime() < RECIPIENT_COOLDOWN_DAYS * DAY) {
      await limitIssue(userId, "recipient-cooldown", { email: mask(email), lastSentAt: last.toISOString() });
      put(email, "pending"); continue;
    }
    if (!(await d.takeBudget(`seo:report-confirm:${userId}`, limits.confirmationsPerDay, DAY))) {
      await limitIssue(userId, "confirmations-per-day", { limit: limits.confirmationsPerDay, email: mask(email) });
      put(email, "pending"); continue;
    }
    const nonce = randomBytes(18).toString("base64url");
    const token = makeConfirmToken(userId, email, nonce, new Date(now.getTime() + CONFIRM_TOKEN_DAYS * DAY))!;
    try {
      await d.sendEmail(userId, `seo-report-confirm:${userId}:${email}:${nonce}`, confirmationEmail(opts.brand, email, token));
      await d.store.markConfirmationSent(userId, email, nonce, now);
      res.confirmationsSent.push(email);
    } catch (e: any) {
      console.error(`[seo] report confirmation to ${mask(email)} failed: ${e?.message ?? e}`);
    }
    put(email, "pending");
  }
  return res;
}

/** Where each address stands, without sending anything (the Reports page). No row = saved before confirmations existed. */
export async function recipientStatuses(userId: number, emails: string[]): Promise<{ email: string; status: RecipientStatus }[]> {
  const d = recipientDeps;
  const list = [...new Set(emails.map(norm))];
  if (!list.length) return [];
  const [owned, rows] = await Promise.all([d.store.ownedAddresses(userId), d.store.rows(userId, list)]);
  const ownedSet = new Set(owned.map(norm)), byEmail = new Map(rows.map((r) => [r.email, r]));
  const out: { email: string; status: RecipientStatus }[] = [];
  for (const email of list) {
    const row = byEmail.get(email);
    if (ownedSet.has(email)) { out.push({ email, status: "confirmed" }); continue; }
    if (row?.status === "blocked" || (await d.store.optedOut(userId, email))) { out.push({ email, status: "blocked" }); continue; }
    out.push({ email, status: row ? (row.status === "confirmed" ? "confirmed" : "pending") : "unconfirmed" });
  }
  return out;
}

export type ConfirmOutcome = "confirmed" | "already" | "blocked" | "invalid" | "expired";
/** The recipient clicked "Yes": the (account, address) pair becomes confirmed. The link's nonce must be the one on the row. */
export async function confirmRecipient(token: unknown): Promise<ConfirmOutcome> {
  const p = parseConfirmToken(token);
  if (!p.ok) return p.reason;
  const { userId, email, nonce } = p.claim;
  const [row] = await recipientDeps.store.rows(userId, [email]);
  if (!row || row.nonce !== nonce) return "invalid";
  if (row.status === "blocked") return "blocked";
  if (row.status === "confirmed") return "already";
  await recipientDeps.store.setConfirmed(userId, email, "customer", recipientDeps.now());
  return "confirmed";
}
/** The recipient clicked "this wasn't me": blocked for this account and for every account. Uses up the link. */
export async function refuseRecipient(token: unknown): Promise<"blocked" | "invalid" | "expired"> {
  const p = parseConfirmToken(token);
  if (!p.ok) return p.reason;
  const { userId, email, nonce } = p.claim;
  const [row] = await recipientDeps.store.rows(userId, [email]);
  if (!row || row.nonce !== nonce) return "invalid";
  await recipientDeps.store.block(userId, email, recipientDeps.now());
  return "blocked";
}
