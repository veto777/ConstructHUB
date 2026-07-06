/**
 * LSA discovery + sync engine — MULTI-TENANT, built to scale to thousands of
 * accounts across many users.
 *
 *  - Discovery walks every account a connection can reach (customer_client tree)
 *    and records names / manager flags / login context in lsa_accounts.
 *  - Sync is incremental per account (a creation-time cursor with a small overlap
 *    window so recently-charged leads still refresh) and concurrency-limited.
 *  - A rotating scheduler syncs the least-recently-synced accounts each tick so
 *    one tenant with thousands of accounts never starves the rest.
 *
 * The lead query, upsert shape, and cost derivation are ported verbatim from the
 * authoritative bundle — only tenancy (user_id everywhere) changed.
 */
import { gaqlSearch, listAccessibleCustomers, clearAccessToken } from "./client";
import { notifyNewLead } from "./telegram";
import { getConnectionByUserId } from "./store";
import { db } from "../db";
import { lsaLeads, lsaAccounts, lsaConnections, type LsaConnection, type LsaAccount } from "@shared/schema";
import { and, eq, count, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";

const CUSTOMER_CLIENT_QUERY = `
  SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status, customer_client.level
  FROM customer_client
  WHERE customer_client.status = 'ENABLED'
`;

const LEAD_QUERY_BASE = `
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
`;

// Re-pull this much history before the cursor each sync so a lead whose charged
// status flips shortly after creation still gets refreshed.
const OVERLAP_MS = 3 * 24 * 60 * 60 * 1000;
const SYNC_CONCURRENCY = 4;

function parseLeadDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

/** Google wall-clock format "YYYY-MM-DD HH:MM:SS" (UTC) for GAQL date filters. */
function gaqlDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function buildLeadQuery(cursor: Date | null): string {
  let q = LEAD_QUERY_BASE;
  if (cursor) {
    const from = new Date(cursor.getTime() - OVERLAP_MS);
    q += `  WHERE local_services_lead.creation_date_time > '${gaqlDateTime(from)}'\n`;
  }
  q += `  ORDER BY local_services_lead.creation_date_time DESC`;
  return q;
}

function dateKey(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function dailyCostQuery(startDate: string, endDate: string): string {
  return `
    SELECT segments.date, metrics.cost_micros
    FROM campaign
    WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES'
      AND segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;
}

/* --------------------------------- discovery --------------------------------- */

export async function discoverAccounts(conn: LsaConnection): Promise<{ discovered: number; warning: string | null }> {
  if (!conn.refreshToken) return { discovered: 0, warning: "Not connected." };
  let warning: string | null = null;

  let accessible: string[] = [];
  try {
    accessible = await listAccessibleCustomers(conn.refreshToken);
  } catch (e: any) {
    clearAccessToken(conn.refreshToken);
    return { discovered: 0, warning: `Could not list accessible accounts: ${e?.message || String(e)}` };
  }

  type Found = { loginCustomerId: string; descriptiveName: string | null; isManager: boolean };
  const found = new Map<string, Found>();

  for (const rootId of accessible) {
    try {
      const rows = await gaqlSearch(conn.refreshToken, rootId, CUSTOMER_CLIENT_QUERY, rootId);
      for (const r of rows) {
        const cc = r?.customerClient || {};
        const cid = String(cc.id || "").replace(/\D/g, "");
        if (!cid) continue;
        const isManager = cc.manager === true;
        const name = cc.descriptiveName ?? null;
        const existing = found.get(cid);
        if (!existing) {
          found.set(cid, { loginCustomerId: rootId, descriptiveName: name, isManager });
        } else {
          if (!existing.descriptiveName && name) existing.descriptiveName = name;
        }
      }
    } catch {
      // Not a manager / no tree access — still register the root as its own login.
      if (!found.has(rootId)) found.set(rootId, { loginCustomerId: rootId, descriptiveName: null, isManager: false });
    }
  }

  for (const [customerId, info] of Array.from(found)) {
    await db
      .insert(lsaAccounts)
      .values({
        userId: conn.userId,
        connectionId: conn.id,
        customerId,
        loginCustomerId: info.loginCustomerId,
        descriptiveName: info.descriptiveName,
        isManager: info.isManager,
      })
      .onConflictDoUpdate({
        target: [lsaAccounts.userId, lsaAccounts.customerId],
        set: {
          connectionId: conn.id,
          loginCustomerId: info.loginCustomerId,
          descriptiveName: info.descriptiveName,
          isManager: info.isManager,
          updatedAt: new Date(),
        },
      });
  }

  await db
    .update(lsaConnections)
    .set({ lastDiscoveryAt: new Date(), updatedAt: new Date() })
    .where(eq(lsaConnections.id, conn.id));

  return { discovered: found.size, warning };
}

/* ----------------------------- per-account costs ----------------------------- */

async function syncLeadCostsForAccount(conn: LsaConnection, account: LsaAccount): Promise<number> {
  const cid = account.customerId;
  const loginCid = account.loginCustomerId || cid;

  const charged = await db
    .select({ id: lsaLeads.id, when: lsaLeads.leadCreationTime })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.userId, conn.userId), eq(lsaLeads.customerId, cid), eq(lsaLeads.leadCharged, true)));

  // Clear cost on anything not currently charged so stale figures can't linger.
  await db
    .update(lsaLeads)
    .set({ leadCost: null })
    .where(
      and(
        eq(lsaLeads.userId, conn.userId),
        eq(lsaLeads.customerId, cid),
        sql`${lsaLeads.leadCharged} IS DISTINCT FROM true`,
      ),
    );

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
    costRows = await gaqlSearch(conn.refreshToken!, cid, dailyCostQuery(start, today), loginCid);
  } catch {
    return 0;
  }

  const costByDate = new Map<string, number>();
  let totalMicros = 0;
  for (const r of costRows) {
    const d = r?.segments?.date;
    const micros = Number(r?.metrics?.costMicros || 0);
    if (!d) continue;
    costByDate.set(d, (costByDate.get(d) || 0) + micros);
    totalMicros += micros;
  }

  for (const [d, ids] of Array.from(byDate)) {
    const dayMicros = costByDate.get(d) || 0;
    if (dayMicros <= 0 || ids.length === 0) continue;
    const perLead = (dayMicros / ids.length / 1e6).toFixed(2);
    await db.update(lsaLeads).set({ leadCost: perLead }).where(inArray(lsaLeads.id, ids));
  }

  return totalMicros;
}

/* ------------------------------- account sync ------------------------------- */

export interface AccountSyncResult {
  customerId: string;
  ok: boolean;
  imported: number;
  newLeads: number;
  costTotal: string;
  error?: string;
}

export async function syncAccount(conn: LsaConnection, account: LsaAccount): Promise<AccountSyncResult> {
  const cid = account.customerId;
  const loginCid = account.loginCustomerId || cid;

  // Known lead ids for THIS account before the sync, to detect brand-new leads.
  const existingRows = await db
    .select({ id: lsaLeads.leadId })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.userId, conn.userId), eq(lsaLeads.customerId, cid)));
  const existingIds = new Set(existingRows.map((r) => r.id));
  const isFirstBackfill = existingIds.size === 0 && account.syncCursor == null;

  let rows: any[];
  try {
    rows = await gaqlSearch(conn.refreshToken!, cid, buildLeadQuery(account.syncCursor), loginCid);
  } catch (e: any) {
    const msg = e?.message || String(e);
    clearAccessToken(conn.refreshToken);
    // First probe failure on an unknown account ⇒ mark not-enrolled. Keep an
    // already-enrolled account enrolled (transient errors shouldn't demote it).
    await db
      .update(lsaAccounts)
      .set({
        lastError: msg,
        lastSyncAt: new Date(),
        lsaEnrolled: account.lsaEnrolled === true ? true : false,
        updatedAt: new Date(),
      })
      .where(eq(lsaAccounts.id, account.id));
    return { customerId: cid, ok: false, imported: 0, newLeads: 0, costTotal: "0.00", error: msg };
  }

  let imported = 0;
  let maxCreation: Date | null = account.syncCursor;
  const newLeadsToNotify: Array<Parameters<typeof notifyNewLead>[1]> = [];

  for (const r of rows) {
    const lead = r.localServicesLead;
    if (!lead?.id) continue;
    const cd = lead.contactDetails || {};
    const created = parseLeadDate(lead.creationDateTime);
    if (created && (!maxCreation || created > maxCreation)) maxCreation = created;
    const values = {
      userId: conn.userId,
      leadId: String(lead.id),
      customerId: cid,
      leadType: lead.leadType ?? null,
      categoryId: lead.categoryId ?? null,
      serviceId: lead.serviceId ?? null,
      contactName: cd.consumerName ?? null,
      contactPhone: cd.phoneNumber ?? null,
      contactEmail: cd.email ?? null,
      leadStatus: lead.leadStatus ?? null,
      leadCharged: typeof lead.leadCharged === "boolean" ? lead.leadCharged : null,
      feedbackSubmitted: typeof lead.leadFeedbackSubmitted === "boolean" ? lead.leadFeedbackSubmitted : null,
      creditState: lead.creditDetails?.creditState ?? null,
      leadCreationTime: created,
      rawJson: lead,
    };
    const isNew = !existingIds.has(values.leadId);
    await db
      .insert(lsaLeads)
      .values(values)
      .onConflictDoUpdate({
        target: lsaLeads.leadId,
        set: {
          userId: values.userId,
          customerId: values.customerId,
          leadStatus: values.leadStatus,
          contactName: values.contactName,
          contactPhone: values.contactPhone,
          contactEmail: values.contactEmail,
          leadCharged: values.leadCharged,
          // Refresh Google-authoritative fields only; never touch surveyAnswer /
          // disputeReason / disputeStatus (our local dispute record).
          feedbackSubmitted: values.feedbackSubmitted,
          creditState: values.creditState,
          rawJson: values.rawJson,
        },
      });
    imported++;
    if (isNew && !isFirstBackfill) {
      existingIds.add(values.leadId);
      newLeadsToNotify.push({
        leadId: values.leadId,
        userId: values.userId,
        contactName: values.contactName,
        contactPhone: values.contactPhone,
        contactEmail: values.contactEmail,
        leadType: values.leadType,
        categoryId: values.categoryId,
        serviceId: values.serviceId,
        leadStatus: values.leadStatus,
        leadCreationTime: values.leadCreationTime,
      });
    }
  }

  // Costs (best-effort) + fresh counts.
  let totalMicros = 0;
  try {
    totalMicros = await syncLeadCostsForAccount(conn, account);
  } catch { /* leave costs untouched */ }
  const costTotal = (totalMicros / 1e6).toFixed(2);

  const [{ c: leadCount }] = await db
    .select({ c: count() })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.userId, conn.userId), eq(lsaLeads.customerId, cid)));
  const [{ c: chargedCount }] = await db
    .select({ c: count() })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.userId, conn.userId), eq(lsaLeads.customerId, cid), eq(lsaLeads.leadCharged, true)));
  const [{ c: disputedCount }] = await db
    .select({ c: count() })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.userId, conn.userId), eq(lsaLeads.customerId, cid), eq(lsaLeads.disputeStatus, "disputed")));

  await db
    .update(lsaAccounts)
    .set({
      lsaEnrolled: true,
      lastError: null,
      lastSyncAt: new Date(),
      syncCursor: maxCreation,
      leadCount,
      chargedCount,
      disputedCount,
      costTotal,
      updatedAt: new Date(),
    })
    .where(eq(lsaAccounts.id, account.id));

  // Bridge to the admin Account Manager: surface this self-connected, LSA-enrolled
  // account in lsa_manager_accounts (linkType "self") so admins can see and, if
  // desired, upgrade it to central management. Best-effort + idempotent; the
  // upsert reconciles link types (a central account stays "both", not downgraded).
  try {
    await storage.upsertLsaAccount({
      customerId: cid,
      accountName: account.descriptiveName ?? null,
      userId: conn.userId,
      linkType: "self",
      linkStatus: "active",
      isLsaEnrolled: true,
    });
  } catch (e) {
    console.error(`[lsa] manager-account bridge failed for ${cid}:`, e);
  }

  // DM the owner about brand-new leads (sequential, best-effort).
  if (conn.telegramChatId && newLeadsToNotify.length > 0) {
    for (const lead of newLeadsToNotify) await notifyNewLead(conn, lead);
  }

  return { customerId: cid, ok: true, imported, newLeads: newLeadsToNotify.length, costTotal };
}

/* ---------------------------- connection-level sync ---------------------------- */

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface SyncResult {
  ok: boolean;
  imported: number;
  accountsWithLsa: number;
  accountsScanned: number;
  error?: string;
}

/** Discover (if needed) then sync all enabled accounts for one connection. */
export async function syncConnection(conn: LsaConnection, opts?: { discover?: boolean }): Promise<SyncResult> {
  if (!conn.refreshToken) {
    return { ok: false, imported: 0, accountsWithLsa: 0, accountsScanned: 0, error: "Not connected to Google Ads." };
  }
  try {
    if (opts?.discover) await discoverAccounts(conn);

    const accounts = await db
      .select()
      .from(lsaAccounts)
      .where(and(eq(lsaAccounts.userId, conn.userId), eq(lsaAccounts.enabled, true)));

    const results = await runWithConcurrency(accounts, SYNC_CONCURRENCY, (acc) => syncAccount(conn, acc));

    const imported = results.reduce((s, r) => s + r.imported, 0);
    const accountsWithLsa = results.filter((r) => r.ok && r.imported > 0).length;
    const failed = results.filter((r) => !r.ok);
    const totalCost = results.reduce((s, r) => s + Number(r.costTotal || 0), 0).toFixed(2);

    let softNote: string | null = null;
    if (accounts.length > 0 && failed.length === accounts.length) {
      softNote = `All ${accounts.length} account(s) failed to query. Last error: ${failed[failed.length - 1]?.error || "unknown"}`;
    } else if (failed.length > 0) {
      softNote = `${failed.length} of ${accounts.length} account(s) skipped (no LSA access or query error).`;
    }

    await db
      .update(lsaConnections)
      .set({
        lastSyncAt: new Date(),
        lastSyncError: softNote,
        lastSyncCount: imported,
        lastCostTotal: totalCost,
        updatedAt: new Date(),
      })
      .where(eq(lsaConnections.id, conn.id));

    const allFailed = accounts.length > 0 && failed.length === accounts.length;
    return {
      ok: !allFailed,
      imported,
      accountsWithLsa,
      accountsScanned: accounts.length,
      error: allFailed ? softNote || undefined : undefined,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await db
      .update(lsaConnections)
      .set({ lastSyncAt: new Date(), lastSyncError: msg, updatedAt: new Date() })
      .where(eq(lsaConnections.id, conn.id));
    return { ok: false, imported: 0, accountsWithLsa: 0, accountsScanned: 0, error: msg };
  }
}

/* ------------------------------ rotating scheduler ------------------------------ */

const ROTATION_BATCH = 25;
let rotationRunning = false;

/**
 * Sync the least-recently-synced enabled accounts across ALL connections.
 * Enrolled accounts get priority, then never-probed (null), then known
 * not-enrolled — so leads stay fresh while dormant accounts are still rechecked.
 */
export async function runRotatingSync(): Promise<void> {
  if (rotationRunning) return;
  rotationRunning = true;
  try {
    const accounts = await db
      .select()
      .from(lsaAccounts)
      .where(eq(lsaAccounts.enabled, true))
      .orderBy(
        sql`(CASE WHEN ${lsaAccounts.lsaEnrolled} IS TRUE THEN 0 WHEN ${lsaAccounts.lsaEnrolled} IS NULL THEN 1 ELSE 2 END)`,
        sql`${lsaAccounts.lastSyncAt} ASC NULLS FIRST`,
      )
      .limit(ROTATION_BATCH);
    if (accounts.length === 0) return;

    // Group by user so we load each connection once.
    const byUser = new Map<number, LsaAccount[]>();
    for (const a of accounts) (byUser.get(a.userId) ?? byUser.set(a.userId, []).get(a.userId)!).push(a);

    for (const [userId, accs] of Array.from(byUser)) {
      const conn = await getConnectionByUserId(userId);
      if (!conn?.refreshToken) continue;
      await runWithConcurrency(accs, SYNC_CONCURRENCY, (acc) => syncAccount(conn, acc).catch((e) => ({
        customerId: acc.customerId, ok: false, imported: 0, newLeads: 0, costTotal: "0.00", error: String(e),
      } as AccountSyncResult)));
    }
  } catch (e: any) {
    console.error("LSA rotating sync error:", e?.message || String(e));
  } finally {
    rotationRunning = false;
  }
}
