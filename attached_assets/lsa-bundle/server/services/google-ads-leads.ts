/**
 * Sync Google Local Services Ads (LSA) leads into the `lsa_leads` table.
 *
 * Strategy: the LSA account sits under the MCC (login-customer-id). We enumerate
 * the MCC's non-manager child accounts, then run the local_services_lead query
 * against each one (accounts without LSA simply error and are skipped). Leads are
 * upserted by Google's lead id so re-syncs refresh status without duplicating.
 *
 * PHONE_CALL leads carry the caller's phone number in contact_details — that's
 * the key field the owner needs to compare against website leads.
 */
import { gaqlSearch, adsPost, loadConfig, listAccessibleCustomers, LOGIN_CUSTOMER_ID } from "./google-ads-client";
import { db } from "../db";
import { lsaLeads, googleAdsConfig } from "@shared/schema";
import { desc, eq, count, and, or, isNull, inArray, lte, sql } from "drizzle-orm";

const CHILD_ACCOUNTS_QUERY = `
  SELECT customer_client.id, customer_client.manager, customer_client.status
  FROM customer_client
  WHERE customer_client.manager = false
`;

const LEAD_QUERY = `
  SELECT
    local_services_lead.id,
    local_services_lead.lead_type,
    local_services_lead.category_id,
    local_services_lead.service_id,
    local_services_lead.contact_details,
    local_services_lead.lead_status,
    local_services_lead.lead_charged,
    local_services_lead.lead_feedback_submitted,
    local_services_lead.credit_details.credit_state,
    local_services_lead.creation_date_time
  FROM local_services_lead
  ORDER BY local_services_lead.creation_date_time DESC
`;

// Google does NOT expose a per-lead dollar amount (cost_micros is prohibited on
// local_services_lead). The only cost data available is the campaign's daily
// spend. We pull it here and divide each day's real spend across that day's
// charged leads, so the per-lead figures always add up to the true total.
function dailyCostQuery(startDate: string, endDate: string): string {
  return `
    SELECT segments.date, metrics.cost_micros
    FROM campaign
    WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;
}

function parseLeadDate(s?: string): Date | null {
  if (!s) return null;
  // Google returns e.g. "2026-06-15 12:34:56+00:00" — make it ISO-parseable.
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Accounts to scan for LSA leads. The LSA account is sometimes the login/manager
 * account ITSELF (no separate child account) and sometimes a non-manager child
 * under the MCC. So we always include the login account and add any children.
 */
interface Candidate {
  customerId: string;      // account to query for leads
  loginCustomerId: string; // login context to use for that query
}

async function listCandidateAccounts(): Promise<{ accounts: Candidate[]; warning: string | null }> {
  // Keyed by customerId so we never query the same account twice.
  const byId = new Map<string, Candidate>();
  let warning: string | null = null;

  // 1) Directly-accessible accounts (the LSA account usually lives HERE, not
  //    under our MCC). Each must log in as ITSELF.
  let accessible: string[] = [];
  try {
    accessible = await listAccessibleCustomers();
  } catch (e: any) {
    warning = `Could not list accessible accounts: ${e?.message || String(e)}`;
  }
  for (const id of accessible) {
    byId.set(id, { customerId: id, loginCustomerId: id });
  }

  // Always include the configured login/MCC account as a fallback.
  const loginId = String(LOGIN_CUSTOMER_ID).replace(/\D/g, "");
  if (loginId && !byId.has(loginId)) {
    byId.set(loginId, { customerId: loginId, loginCustomerId: loginId });
  }

  // 2) For each manager among those accounts, add its non-manager children,
  //    queried with the manager as their login context.
  for (const mgrId of Array.from(new Set([...accessible, loginId]))) {
    if (!mgrId) continue;
    try {
      const rows = await gaqlSearch(mgrId, CHILD_ACCOUNTS_QUERY, mgrId);
      for (const r of rows) {
        const childId = String(r?.customerClient?.id || "").replace(/\D/g, "");
        if (childId && !byId.has(childId)) {
          byId.set(childId, { customerId: childId, loginCustomerId: mgrId });
        }
      }
    } catch {
      // Not a manager / no child access — fine, the account itself is still scanned.
    }
  }

  return { accounts: Array.from(byId.values()), warning };
}

/** YYYY-MM-DD (UTC wall-clock) of a stored lead timestamp, to match segments.date. */
function dateKey(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Pull the LOCAL_SERVICES campaign's real daily spend for an account and spread
 * each day's spend across that day's charged leads, writing the result into
 * lsa_leads.lead_cost. Returns the account's total spend in micros so the caller
 * can show the true billing total. Per-lead is exact on single-charged-lead days
 * and an even split otherwise — and always sums back to the real total.
 */
async function syncLeadCostsForAccount(cand: Candidate): Promise<number> {
  // Charged leads for this account (these are the only ones that cost money).
  const charged = await db
    .select({ id: lsaLeads.id, when: lsaLeads.leadCreationTime })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.customerId, cand.customerId), eq(lsaLeads.leadCharged, true)));

  // Clear cost on anything not currently charged (false OR unknown/null) so a
  // stale figure can't linger after a lead is credited/disputed back.
  await db
    .update(lsaLeads)
    .set({ leadCost: null })
    .where(
      and(
        eq(lsaLeads.customerId, cand.customerId),
        sql`${lsaLeads.leadCharged} IS DISTINCT FROM true`,
      ),
    );

  // Earliest charged-lead date sets how far back we ask Google for spend.
  let earliest: string | null = null;
  const byDate = new Map<string, string[]>();
  for (const l of charged) {
    const k = dateKey(l.when);
    if (!k) continue;
    if (!earliest || k < earliest) earliest = k;
    (byDate.get(k) ?? byDate.set(k, []).get(k)!).push(l.id);
  }

  const today = new Date().toISOString().slice(0, 10);
  const start = earliest || today;

  let costRows: any[] = [];
  try {
    costRows = await gaqlSearch(cand.customerId, dailyCostQuery(start, today), cand.loginCustomerId);
  } catch {
    // No cost access for this account — leave costs null, still return 0.
    return 0;
  }

  // date -> spend micros
  const costByDate = new Map<string, number>();
  let totalMicros = 0;
  for (const r of costRows) {
    const d = r?.segments?.date;
    const micros = Number(r?.metrics?.costMicros || 0);
    if (!d) continue;
    costByDate.set(d, (costByDate.get(d) || 0) + micros);
    totalMicros += micros;
  }

  // Spread each day's spend across that day's charged leads.
  for (const [d, ids] of byDate) {
    const dayMicros = costByDate.get(d) || 0;
    if (dayMicros <= 0 || ids.length === 0) continue;
    const perLead = (dayMicros / ids.length / 1e6).toFixed(2);
    await db.update(lsaLeads).set({ leadCost: perLead }).where(inArray(lsaLeads.id, ids));
  }

  return totalMicros;
}

/** Send a Telegram alert for a brand-new LSA lead with full client info. */
async function notifyTelegramNewLead(lead: {
  leadId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  leadType: string | null;
  categoryId: string | null;
  serviceId: string | null;
  leadStatus: string | null;
  leadCreationTime: Date | null;
}): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (label: string, val?: string | null) =>
    val ? `${label}: <b>${esc(String(val))}</b>\n` : "";
  const when = lead.leadCreationTime
    ? lead.leadCreationTime.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    : "";

  const text =
    `🟢 <b>New Google LSA Lead (Ads)</b>\n\n` +
    row("👤 Name", lead.contactName) +
    row("📞 Phone", lead.contactPhone) +
    row("✉️ Email", lead.contactEmail) +
    row("🔧 Type", lead.leadType) +
    row("🗂️ Category", lead.categoryId) +
    row("🛠️ Service", lead.serviceId) +
    row("📊 Status", lead.leadStatus) +
    (when ? `🕐 ${esc(when)}\n` : "") +
    `\n⚡ Source: <b>Google Local Services Ads</b>` +
    `\n\n🚩 Bad lead? Tap <b>Report bad lead</b> below and pick a reason.`;

  // Inline button — the reliable way to report a bad lead. A button tap reaches
  // the bot even with group privacy mode on (a plain typed message does not), so
  // the owner never has to use Telegram's "Reply" gesture.
  const replyMarkup = {
    inline_keyboard: [[{ text: "🚩 Report bad lead", callback_data: `lsadq:${lead.leadId}` }]],
  };

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`Telegram LSA alert rejected (${resp.status}): ${body.slice(0, 300)}`);
      return;
    }
    // Remember which Telegram message announced this lead so a "dispute" reply
    // to it can be mapped straight back to the lead. Best-effort.
    try {
      const data: any = await resp.json();
      const mid = data?.result?.message_id;
      if (mid != null) {
        await db
          .update(lsaLeads)
          .set({ tgAlertMessageId: String(mid) })
          .where(eq(lsaLeads.leadId, lead.leadId));
      }
    } catch { /* non-fatal */ }
  } catch (e: any) {
    // Best-effort — never let a notification failure break the sync.
    console.warn(`Telegram LSA alert failed: ${e?.message || String(e)}`);
  }
}

export interface SyncResult {
  ok: boolean;
  imported: number;
  accountsWithLsa: number;
  accountsScanned: number;
  error?: string;
}

export async function syncLsaLeads(): Promise<SyncResult> {
  const cfg = await loadConfig();
  if (!cfg?.refreshToken) {
    return { ok: false, imported: 0, accountsWithLsa: 0, accountsScanned: 0, error: "Not connected to Google Ads." };
  }

  let imported = 0;
  let accountsWithLsa = 0;
  let accountsScanned = 0;
  let failedAccounts = 0;
  let lastAccountError = "";

  // Known lead ids before this sync. A lead missing from this set is brand-new,
  // so we fire a Telegram alert for it. We also skip alerts on the very first
  // backfill (empty table) so connecting doesn't spam every historical lead.
  const existingRows = await db.select({ id: lsaLeads.leadId }).from(lsaLeads);
  const existingIds = new Set(existingRows.map((r) => r.id));
  const isFirstBackfill = existingIds.size === 0;
  const newLeadsToNotify: Array<Parameters<typeof notifyTelegramNewLead>[0]> = [];

  const accountsWithLeads: Candidate[] = [];

  try {
    const { accounts: candidates, warning: childWarning } = await listCandidateAccounts();
    accountsScanned = candidates.length;

    for (const candidate of candidates) {
      const { customerId, loginCustomerId } = candidate;
      let rows: any[];
      try {
        rows = await gaqlSearch(customerId, LEAD_QUERY, loginCustomerId);
      } catch (e: any) {
        // An account that isn't enrolled in LSA (or that we lack access to) will
        // error here — that's expected and fine to skip. But we record the
        // failures so a *systemic* problem (bad GAQL / API version / revoked
        // access across the board) can't masquerade as a successful empty sync.
        failedAccounts++;
        lastAccountError = e?.message || String(e);
        continue;
      }
      if (rows.length > 0) {
        accountsWithLsa++;
        accountsWithLeads.push(candidate);
      }

      for (const r of rows) {
        const lead = r.localServicesLead;
        if (!lead?.id) continue;
        const cd = lead.contactDetails || {};
        const values = {
          leadId: String(lead.id),
          customerId,
          leadType: lead.leadType ?? null,
          categoryId: lead.categoryId ?? null,
          serviceId: lead.serviceId ?? null,
          contactName: cd.consumerName ?? null,
          contactPhone: cd.phoneNumber ?? null,
          contactEmail: cd.email ?? null,
          leadStatus: lead.leadStatus ?? null,
          // Charged status comes straight from Google and is authoritative —
          // update it on every sync (a lead can flip if it's disputed/credited).
          leadCharged: typeof lead.leadCharged === "boolean" ? lead.leadCharged : null,
          // Authoritative from Google: whether feedback was submitted (here or in
          // the LSA app) and any credit state for a disputed lead.
          feedbackSubmitted: typeof lead.leadFeedbackSubmitted === "boolean" ? lead.leadFeedbackSubmitted : null,
          creditState: lead.creditDetails?.creditState ?? null,
          leadCreationTime: parseLeadDate(lead.creationDateTime),
          rawJson: lead,
        };
        const isNew = !existingIds.has(values.leadId);
        await db.insert(lsaLeads).values(values).onConflictDoUpdate({
          target: lsaLeads.leadId,
          set: {
            leadStatus: values.leadStatus,
            contactName: values.contactName,
            contactPhone: values.contactPhone,
            contactEmail: values.contactEmail,
            leadCharged: values.leadCharged,
            // Refresh feedback flag + credit state from Google, but DON'T touch
            // surveyAnswer/disputeReason — those are our local record of what we
            // sent and Google never returns them.
            feedbackSubmitted: values.feedbackSubmitted,
            creditState: values.creditState,
            rawJson: values.rawJson,
          },
        });
        imported++;
        if (isNew && !isFirstBackfill) {
          existingIds.add(values.leadId); // guard against dupes within one run
          newLeadsToNotify.push(values);
        }
      }
    }

    // If we scanned accounts but EVERY one failed, this isn't a real "0 leads"
    // result — something is systemically broken. Report it as a failure so the
    // owner doesn't think the sync worked.
    if (accountsScanned > 0 && failedAccounts === accountsScanned) {
      const msg = `All ${accountsScanned} account(s) failed to query. Last error: ${lastAccountError}`;
      await db.update(googleAdsConfig)
        .set({ lastSyncAt: new Date(), lastSyncError: msg, updatedAt: new Date() })
        .where(eq(googleAdsConfig.id, cfg.id));
      return { ok: false, imported, accountsWithLsa, accountsScanned, error: msg };
    }

    // Some accounts failing is normal (not all are enrolled in LSA), but keep a
    // soft note so partial issues are visible without flagging the whole sync.
    // A child-discovery failure is also folded in (leads on child accounts
    // could have been missed) so the owner can see it.
    const notes: string[] = [];
    if (failedAccounts > 0) {
      notes.push(`${failedAccounts} of ${accountsScanned} account(s) were skipped (no LSA access or query error).`);
    }
    if (childWarning) notes.push(childWarning);

    // Pull real Google Ads spend and spread it across charged leads. Google does
    // not give a per-lead price, so this is the closest accurate figure and it
    // always sums back to the true total billed by Google.
    let totalCostMicros = 0;
    for (const cand of accountsWithLeads) {
      try {
        totalCostMicros += await syncLeadCostsForAccount(cand);
      } catch (e: any) {
        notes.push(`Cost sync failed for account ${cand.customerId}: ${e?.message || String(e)}`);
      }
    }
    const totalCostDollars = (totalCostMicros / 1e6).toFixed(2);

    const softNote = notes.length > 0 ? notes.join(" ") : null;

    await db.update(googleAdsConfig)
      .set({
        lastSyncAt: new Date(),
        lastSyncError: softNote,
        lastSyncCount: imported,
        lastCostTotal: totalCostDollars,
        updatedAt: new Date(),
      })
      .where(eq(googleAdsConfig.id, cfg.id));

    // Fire Telegram alerts for brand-new leads (sequentially, best-effort).
    for (const lead of newLeadsToNotify) {
      await notifyTelegramNewLead(lead);
    }

    return { ok: true, imported, accountsWithLsa, accountsScanned };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await db.update(googleAdsConfig)
      .set({ lastSyncAt: new Date(), lastSyncError: msg, updatedAt: new Date() })
      .where(eq(googleAdsConfig.id, cfg.id));
    return { ok: false, imported, accountsWithLsa, accountsScanned, error: msg };
  }
}

// Google's SurveyAnswer enum only has two usable values (UNSPECIFIED/UNKNOWN are
// return-only). 👍 Good = SATISFIED, 👎 Bad = DISSATISFIED.
const SURVEY_ANSWERS = new Set(["SATISFIED", "DISSATISFIED"]);

// Valid SurveyDissatisfiedReason enum values per the official v22 reference
// (LocalServicesLeadSurveyDissatisfiedReasonEnum). OTHER_DISSATISFIED_REASON is
// omitted because Google requires a free-form otherReasonComment when selected.
// Verified empirically: sending a value outside this set (e.g. NOT_A_CUSTOMER)
// gets an atomic INVALID_ARGUMENT reject from Google (no dispute is filed).
const DISSATISFIED_REASONS = new Set([
  "DUPLICATE",
  "GEO_MISMATCH",
  "JOB_TYPE_MISMATCH",
  "NOT_READY_TO_BOOK",
  "SOLICITATION",
  "SPAM",
]);

/**
 * Send the owner's rating for a single LSA lead to Google
 * (LocalServicesLeadService.ProvideLeadFeedback). A DISSATISFIED answer with a
 * reason is how a bad lead is flagged for a billing credit/dispute. The request
 * shape is { surveyAnswer, surveyDissatisfied: { surveyDissatisfiedReason } } —
 * the reason MUST be nested (a flat top-level field is rejected) and survey_details
 * is required for DISSATISFIED. After this, Google's lead_feedback_submitted flips
 * to true on the next sync and any credit shows up in credit_details.credit_state.
 */
export async function provideLeadFeedback(
  leadId: string,
  surveyAnswer: string,
  dissatisfiedReason?: string | null,
  opts?: { fromQueue?: boolean },
): Promise<any> {
  const answer = String(surveyAnswer || "").toUpperCase();
  if (!SURVEY_ANSWERS.has(answer)) {
    throw new Error(`Invalid rating "${surveyAnswer}".`);
  }
  const id = String(leadId).replace(/\D/g, "");
  const rows = await db.select().from(lsaLeads).where(eq(lsaLeads.leadId, id));
  const row = rows[0];
  if (!row) throw new Error("That lead isn't in the system yet — try Sync now first.");

  // Authoritative anti-double-dispute guard. Google itself is the source of
  // truth (feedbackSubmitted), so never re-rate a lead it already has feedback
  // for. The 'queued'/'sending' states are the batch queue's own in-flight
  // markers, so only block on those for direct/manual calls (fromQueue bypasses).
  if (row.feedbackSubmitted === true) {
    throw new Error("This lead has already been rated.");
  }
  if (!opts?.fromQueue) {
    const s = row.disputeStatus || "";
    if (s === "queued" || s === "sending") throw new Error("This lead is already queued for a dispute.");
    if (s === "disputed") throw new Error("This lead has already been disputed.");
  }
  const cid = (row.customerId || "").replace(/\D/g, "");
  if (!cid) throw new Error("This lead has no Google account id on file.");

  const body: Record<string, unknown> = { surveyAnswer: answer };
  const reason = dissatisfiedReason ? String(dissatisfiedReason).toUpperCase() : null;
  if (answer === "DISSATISFIED") {
    if (!reason) {
      throw new Error("Pick a reason when rating a lead as bad.");
    }
    if (!DISSATISFIED_REASONS.has(reason)) {
      throw new Error(`Invalid reason "${dissatisfiedReason}".`);
    }
    // survey_details is REQUIRED for a DISSATISFIED answer and the reason must be
    // nested under surveyDissatisfied (oneof member of survey_details).
    body.surveyDissatisfied = { surveyDissatisfiedReason: reason };
  }

  // The LSA account logs in as itself (it is not under our MCC), so use its own
  // id as the login-customer-id — same as the lead query.
  const res = await adsPost(
    cid,
    `customers/${cid}/localServicesLeads/${id}:provideLeadFeedback`,
    body,
    cid,
  );

  await db
    .update(lsaLeads)
    .set({
      feedbackSubmitted: true,
      surveyAnswer: answer,
      disputeReason: reason,
      // Only a "bad" rating is a dispute; a "good" rating clears any local state.
      disputeStatus: answer === "DISSATISFIED" ? "disputed" : null,
    })
    .where(eq(lsaLeads.leadId, id));

  return res;
}

export async function getStoredLsaLeads() {
  return db.select().from(lsaLeads).orderBy(desc(lsaLeads.leadCreationTime));
}

export async function getLsaLeadCount(): Promise<number> {
  const r = await db.select({ c: count() }).from(lsaLeads);
  return r[0]?.c || 0;
}

// ---------------------------------------------------------------------------
// Spaced dispute queue
// ---------------------------------------------------------------------------
// Disputing many leads in a tight burst looks like automated/bot abuse to
// Google. So batched disputes are sent ONE AT A TIME with a randomized 30–60s
// gap between each (every gap is different). State lives in
// lsa_leads.dispute_status so the admin UI can show a live
// "queued / disputing / disputed" sticker and the same lead is never disputed
// twice.
type QueueItem = { leadId: string; reason: string; runAt: number };
let disputeQueue: QueueItem[] = [];
let queueRunning = false;

// 30s–60s. `used` enforces that no two gaps in the same batch are identical, so
// the sequence of report times is always different (anti-bot-pattern).
function randomGapMs(used?: Set<number>): number {
  let gap = Math.round(30000 + Math.random() * 30000);
  if (used) {
    let guard = 0;
    while (used.has(gap) && guard++ < 50) gap = Math.round(30000 + Math.random() * 30000);
    used.add(gap);
  }
  return gap;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDisputeQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (disputeQueue.length > 0) {
      const item = disputeQueue[0];
      const wait = item.runAt - Date.now();
      if (wait > 0) await sleep(wait);
      disputeQueue.shift();
      try {
        await db.update(lsaLeads).set({ disputeStatus: "sending" }).where(eq(lsaLeads.leadId, item.leadId));
        // provideLeadFeedback stamps disputeStatus = "disputed" on success.
        await provideLeadFeedback(item.leadId, "DISSATISFIED", item.reason, { fromQueue: true });
      } catch (e) {
        await db
          .update(lsaLeads)
          .set({ disputeStatus: "failed" })
          .where(eq(lsaLeads.leadId, item.leadId))
          .catch(() => {});
        console.error(`Dispute failed for lead ${item.leadId}:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    queueRunning = false;
  }
}

/** Queue a batch of "bad lead" disputes to be sent to Google spaced out in time. */
export async function enqueueDisputes(
  items: { leadId: string; reason: string }[],
): Promise<{ queued: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No leads to dispute.");
  }
  // Clean, validate, and de-duplicate by leadId (a lead can't appear twice).
  const seen = new Set<string>();
  const cleaned: { leadId: string; reason: string }[] = [];
  for (const it of items) {
    const leadId = String(it.leadId || "").replace(/\D/g, "");
    const reason = String(it.reason || "").toUpperCase();
    if (!leadId) throw new Error("A selected lead has no id.");
    if (!DISSATISFIED_REASONS.has(reason)) throw new Error(`Invalid reason "${it.reason}".`);
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    cleaned.push({ leadId, reason });
  }

  // Atomically CLAIM each lead with a conditional update: only flip to 'queued'
  // when it's free to dispute (not already rated by Google, and not already
  // null/failed in our pipeline). `.returning()` tells us which we actually won,
  // closing the read-then-write race so a lead can never be double-queued.
  const cursorStart = Date.now();
  let cursor = cursorStart;
  const usedGaps = new Set<number>();
  let queued = 0;
  for (const c of cleaned) {
    const claimed = await db
      .update(lsaLeads)
      .set({ disputeStatus: "queued", disputeReason: c.reason })
      .where(
        and(
          eq(lsaLeads.leadId, c.leadId),
          // Backstop: only dispute leads Google actually CHARGED you for —
          // disputing a free lead recovers $0 and just pads your dispute count.
          eq(lsaLeads.leadCharged, true),
          or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          // A scheduled lead is fair game to send now (manual "report now"),
          // alongside the usual free/failed states.
          or(
            isNull(lsaLeads.disputeStatus),
            eq(lsaLeads.disputeStatus, "failed"),
            eq(lsaLeads.disputeStatus, "scheduled"),
          ),
        ),
      )
      .returning({ leadId: lsaLeads.leadId });
    if (claimed.length === 0) continue; // already disputed / in-flight / uncharged — skip.
    cursor += randomGapMs(usedGaps);
    disputeQueue.push({ leadId: c.leadId, reason: c.reason, runAt: cursor });
    queued++;
  }

  if (queued === 0) {
    throw new Error("Those leads are already disputed or in progress.");
  }

  void runDisputeQueue();
  return { queued };
}

// ── Telegram-driven single-lead dispute ─────────────────────────────────────
// The owner reports a bad LSA lead straight from its Telegram alert. This is
// owner-driven: the owner names the reason; we never fabricate one. Disputes
// still go through enqueueDisputes (spaced sending + atomic anti-double claim +
// charged-only backstop), so this path inherits every existing safety guard.

const TG_REASON_MAP: { keys: string[]; reason: string; label: string }[] = [
  { keys: ["spam"], reason: "SPAM", label: "Spam" },
  { keys: ["solicit", "sales call", "sales", "telemarket", "marketing call", "selling"], reason: "SOLICITATION", label: "Solicitation (sales call)" },
  { keys: ["duplicate", "dupe", "same lead", "already have this"], reason: "DUPLICATE", label: "Duplicate" },
  { keys: ["not my service", "don't offer", "dont offer", "not offer", "wrong service", "job type", "don't do", "dont do", "not offered", "not the service", "service i don"], reason: "JOB_TYPE_MISMATCH", label: "Service I don't offer" },
  { keys: ["outside", "out of area", "out of my area", "too far", "not in my area", "wrong area", "geo", "far away"], reason: "GEO_MISMATCH", label: "Outside my area" },
  { keys: ["not ready", "just looking", "browsing", "window shopping"], reason: "NOT_READY_TO_BOOK", label: "Not ready to book" },
];

/** Map an owner's free-text reason word(s) to a valid Google dissatisfied reason. */
export function parseDisputeReason(text: string): { reason: string; label: string } | null {
  const t = String(text || "").toLowerCase();
  for (const r of TG_REASON_MAP) {
    for (const k of r.keys) {
      if (t.includes(k)) return { reason: r.reason, label: r.label };
    }
  }
  return null;
}

function reasonLabel(reason: string): string {
  const hit = TG_REASON_MAP.find((r) => r.reason === reason);
  return hit ? hit.label : reason;
}

/** Find the lead whose new-lead Telegram alert had this message_id. */
export async function findLeadByTgAlertMessageId(
  messageId: string,
): Promise<{ leadId: string; contactName: string | null } | null> {
  const mid = String(messageId || "").trim();
  if (!mid) return null;
  const rows = await db
    .select({ leadId: lsaLeads.leadId, contactName: lsaLeads.contactName })
    .from(lsaLeads)
    .where(eq(lsaLeads.tgAlertMessageId, mid))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Queue a single LSA lead for an internal Google dispute, reported from Telegram.
 * Returns a status code the caller turns into a friendly reply. Charged-only and
 * anti-double-dispute are enforced here AND inside enqueueDisputes.
 */
export async function disputeLeadFromTelegram(
  leadId: string,
  reason: string,
): Promise<{ ok: boolean; code: "ok" | "uncharged" | "already" | "not_found"; label?: string; name?: string }> {
  const id = String(leadId || "").replace(/\D/g, "");
  if (!id) return { ok: false, code: "not_found" };
  const rows = await db.select().from(lsaLeads).where(eq(lsaLeads.leadId, id)).limit(1);
  const lead = rows[0];
  if (!lead) return { ok: false, code: "not_found" };
  const name = lead.contactName || lead.contactEmail || `Lead ${id}`;
  if (lead.feedbackSubmitted === true) return { ok: false, code: "already", name };
  if (["queued", "sending", "disputed"].includes(String(lead.disputeStatus))) {
    return { ok: false, code: "already", name };
  }
  // Only dispute leads Google actually charged for — disputing a free lead
  // recovers nothing and just pads your dispute count.
  if (lead.leadCharged !== true) return { ok: false, code: "uncharged", name };
  try {
    await enqueueDisputes([{ leadId: id, reason }]);
  } catch {
    // enqueue throws when nothing got claimed (lost a race / already taken).
    return { ok: false, code: "already", name };
  }
  return { ok: true, code: "ok", label: reasonLabel(reason), name };
}

/** On boot, re-queue anything left mid-flight by a restart so stickers don't hang. */
export async function resumeDisputeQueue(): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(lsaLeads)
      .where(inArray(lsaLeads.disputeStatus, ["queued", "sending"]));
    if (pending.length === 0) return;
    let cursor = Date.now();
    for (const r of pending) {
      if (!r.disputeReason || !DISSATISFIED_REASONS.has(r.disputeReason)) {
        await db.update(lsaLeads).set({ disputeStatus: "failed" }).where(eq(lsaLeads.leadId, r.leadId)).catch(() => {});
        continue;
      }
      cursor += randomGapMs();
      disputeQueue.push({ leadId: r.leadId, reason: r.disputeReason, runAt: cursor });
    }
    if (disputeQueue.length > 0) {
      void runDisputeQueue();
      console.log(`↻ Resumed ${disputeQueue.length} pending LSA dispute(s).`);
    }
  } catch (e) {
    console.error("Failed to resume dispute queue:", e);
  }
}

// ---------------------------------------------------------------------------
// Future-dated (scheduled) disputes
// ---------------------------------------------------------------------------
// Instead of disputing a batch all at once, the owner can pin each lead to a
// future moment. The lead sits in dispute_status='scheduled' with a
// dispute_scheduled_at timestamp; a periodic check (promoteDueScheduledDisputes)
// moves any that are due into the normal spaced send queue. This survives
// restarts because the schedule lives in the DB, letting disputes be scattered
// across days/weeks so the pattern looks natural to Google.

/**
 * Schedule a batch of disputes for future moments. `items` carry a per-lead
 * `reason` and `runAt` (epoch ms). Only CHARGED, not-yet-rated leads are
 * claimed; everything else is skipped. Returns how many were scheduled.
 */
export async function scheduleDisputes(
  items: { leadId: string; reason: string; runAt: number }[],
): Promise<{ scheduled: number; skipped: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No leads to schedule.");
  }
  const seen = new Set<string>();
  const cleaned: { leadId: string; reason: string; runAt: number }[] = [];
  for (const it of items) {
    const leadId = String(it.leadId || "").replace(/\D/g, "");
    const reason = String(it.reason || "").toUpperCase();
    const runAt = Number(it.runAt);
    if (!leadId) throw new Error("A selected lead has no id.");
    if (!DISSATISFIED_REASONS.has(reason)) throw new Error(`Invalid reason "${it.reason}".`);
    if (!Number.isFinite(runAt) || runAt <= 0) throw new Error("A selected lead has no valid date.");
    if (seen.has(leadId)) continue;
    seen.add(leadId);
    cleaned.push({ leadId, reason, runAt });
  }

  let scheduled = 0;
  for (const c of cleaned) {
    const claimed = await db
      .update(lsaLeads)
      .set({
        disputeStatus: "scheduled",
        disputeReason: c.reason,
        disputeScheduledAt: new Date(c.runAt),
      })
      .where(
        and(
          eq(lsaLeads.leadId, c.leadId),
          // Same charged-only backstop as the immediate path.
          eq(lsaLeads.leadCharged, true),
          or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          // Free to (re)schedule unless it's already on its way or finished.
          or(
            isNull(lsaLeads.disputeStatus),
            eq(lsaLeads.disputeStatus, "failed"),
            eq(lsaLeads.disputeStatus, "scheduled"),
          ),
        ),
      )
      .returning({ leadId: lsaLeads.leadId });
    if (claimed.length === 0) continue;
    scheduled++;
  }

  if (scheduled === 0) {
    throw new Error("Those leads can't be scheduled (already disputed, in progress, or uncharged).");
  }
  return { scheduled, skipped: cleaned.length - scheduled };
}

/** Cancel scheduled disputes that haven't been sent yet (clears them back to untouched). */
export async function unscheduleDisputes(leadIds: string[]): Promise<{ cancelled: number }> {
  const ids = (Array.isArray(leadIds) ? leadIds : [])
    .map((x) => String(x || "").replace(/\D/g, ""))
    .filter(Boolean);
  if (ids.length === 0) throw new Error("No scheduled leads to cancel.");
  const cleared = await db
    .update(lsaLeads)
    .set({ disputeStatus: null, disputeScheduledAt: null })
    .where(and(inArray(lsaLeads.leadId, ids), eq(lsaLeads.disputeStatus, "scheduled")))
    .returning({ leadId: lsaLeads.leadId });
  return { cancelled: cleared.length };
}

/**
 * Move any scheduled disputes whose moment has arrived into the spaced send
 * queue. Called on boot and on a periodic timer. The queue itself still spaces
 * each send 30–60s apart, so even several leads due in the same minute go out
 * naturally rather than in a single burst.
 */
export async function promoteDueScheduledDisputes(): Promise<void> {
  try {
    const due = await db
      .select()
      .from(lsaLeads)
      .where(
        and(
          eq(lsaLeads.disputeStatus, "scheduled"),
          lte(lsaLeads.disputeScheduledAt, new Date()),
        ),
      );
    if (due.length === 0) return;

    let cursor = Date.now();
    const usedGaps = new Set<number>();
    let promoted = 0;
    let retired = 0;

    for (const r of due) {
      // Missing/invalid reason — it can never succeed, so retire it (only while
      // it's still 'scheduled') to stop it being re-selected every minute.
      if (!r.disputeReason || !DISSATISFIED_REASONS.has(r.disputeReason)) {
        const f = await db
          .update(lsaLeads)
          .set({ disputeStatus: "failed", disputeScheduledAt: null })
          .where(and(eq(lsaLeads.leadId, r.leadId), eq(lsaLeads.disputeStatus, "scheduled")))
          .returning({ leadId: lsaLeads.leadId });
        if (f.length) retired++;
        continue;
      }

      // Atomically claim scheduled -> queued, but ONLY while it's still
      // 'scheduled' (so a lead cancelled in this same window — now null — can
      // never be re-claimed) AND still genuinely disputable (charged, not rated).
      const claimed = await db
        .update(lsaLeads)
        .set({ disputeStatus: "queued", disputeScheduledAt: null })
        .where(
          and(
            eq(lsaLeads.leadId, r.leadId),
            eq(lsaLeads.disputeStatus, "scheduled"),
            eq(lsaLeads.leadCharged, true),
            or(isNull(lsaLeads.feedbackSubmitted), eq(lsaLeads.feedbackSubmitted, false)),
          ),
        )
        .returning({ leadId: lsaLeads.leadId });
      if (claimed.length > 0) {
        cursor += randomGapMs(usedGaps);
        disputeQueue.push({ leadId: r.leadId, reason: r.disputeReason, runAt: cursor });
        promoted++;
        continue;
      }

      // Not claimed: it was either cancelled (now null — leave it alone) or it's
      // due but no longer disputable (rated elsewhere / no longer charged).
      // Retire only the still-'scheduled'-but-ineligible rows so they don't loop.
      const retiredRow = await db
        .update(lsaLeads)
        .set({ disputeStatus: "failed", disputeScheduledAt: null })
        .where(
          and(
            eq(lsaLeads.leadId, r.leadId),
            eq(lsaLeads.disputeStatus, "scheduled"),
            or(
              isNull(lsaLeads.leadCharged),
              eq(lsaLeads.leadCharged, false),
              eq(lsaLeads.feedbackSubmitted, true),
            ),
          ),
        )
        .returning({ leadId: lsaLeads.leadId });
      if (retiredRow.length) retired++;
    }

    if (promoted > 0) {
      void runDisputeQueue();
      console.log(`⏰ Promoted ${promoted} scheduled LSA dispute(s) into the send queue.`);
    }
    if (retired > 0) {
      console.log(`⚠️ Retired ${retired} un-disputable scheduled lead(s).`);
    }
  } catch (e) {
    console.error("Failed to promote scheduled disputes:", e);
  }
}
