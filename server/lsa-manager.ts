import { db } from "./db";
import { lsaManagerConnection, lsaManagerAccounts, lsaManagerLeads, lsaConnections, users } from "@shared/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { sendLsaChargedLeadAlert } from "./email";

export const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v17";
const GOOGLE_ADS_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface CampaignSummary {
  resourceName: string;
  id: string;
  name: string;
  status: string;
  budgetResourceName: string;
  dailyBudgetMicros: string;
  dailyBudgetFormatted: string;
  channelType: string;
  isLsa: boolean;
}

export interface MutateResult {
  ok: boolean;
  error?: string;
  resourceName?: string;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[lsa-manager] Token refresh failed:", err);
      return null;
    }
    const data = await res.json();
    const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000);
    return { accessToken: data.access_token, expiresAt };
  } catch (e) {
    console.error("[lsa-manager] Token refresh error:", e);
    return null;
  }
}

export async function getManagerConnection() {
  const [conn] = await db.select().from(lsaManagerConnection).orderBy(desc(lsaManagerConnection.connectedAt)).limit(1);
  return conn || null;
}

async function getValidAccessToken(conn: typeof lsaManagerConnection.$inferSelect): Promise<string | null> {
  if (conn.accessToken && conn.tokenExpiry && conn.tokenExpiry > new Date(Date.now() + 60000)) {
    return conn.accessToken;
  }
  const refreshed = await refreshAccessToken(conn.refreshToken);
  if (!refreshed) return null;

  await db.update(lsaManagerConnection)
    .set({ accessToken: refreshed.accessToken, tokenExpiry: refreshed.expiresAt, lastRefreshedAt: new Date() })
    .where(eq(lsaManagerConnection.id, conn.id));

  return refreshed.accessToken;
}

function makeHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId.replace(/-/g, "");
  }
  return headers;
}

function formatCustomerId(id: string): string {
  return id.replace(/-/g, "");
}

function parseStreamBatches(text: string): any[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const batches: any[] = [];
    for (const line of trimmed.split("\n").filter(Boolean)) {
      try {
        batches.push(JSON.parse(line));
      } catch {}
    }
    return batches;
  }
}

export async function fetchCampaigns(targetCustomerId: string, useManager = true, userId?: number | null): Promise<CampaignSummary[]> {
  const creds = await getManagerCredentials(useManager, userId);
  if ("error" in creds) throw new Error(creds.error);

  const cid = formatCustomerId(targetCustomerId);

  const query = `
    SELECT
      campaign.resource_name,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.campaign_budget,
      campaign_budget.resource_name,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
    ORDER BY campaign.name
    LIMIT 50
  `;

  const url = `${GOOGLE_ADS_BASE}/customers/${cid}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: "POST",
    headers: makeHeaders(creds.accessToken, creds.devToken, creds.loginCid),
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Ads API error ${res.status}: ${errText}`);
  }

  const batches = parseStreamBatches(await res.text());
  const campaigns: CampaignSummary[] = [];

  for (const batch of batches) {
    for (const result of batch.results || []) {
      const c = result.campaign;
      const b = result.campaignBudget || result.campaign_budget;
      if (!c) continue;
      const budgetMicros = b?.amountMicros || b?.amount_micros || "0";
      const budgetDollars = (Number(budgetMicros) / 1_000_000).toFixed(2);
      const budgetResourceName =
        b?.resourceName || b?.resource_name ||
        c?.campaignBudget || c?.campaign_budget || "";
      campaigns.push({
        resourceName: c.resourceName || c.resource_name || "",
        id: String(c.id || ""),
        name: c.name || "Unnamed",
        status: c.status || "UNKNOWN",
        budgetResourceName,
        dailyBudgetMicros: String(budgetMicros),
        dailyBudgetFormatted: `$${budgetDollars}`,
        channelType: c.advertisingChannelType || c.advertising_channel_type || "UNKNOWN",
        isLsa: (c.advertisingChannelType || c.advertising_channel_type || "") === "LOCAL_SERVICES",
      });
    }
  }

  return campaigns;
}

async function getUserRefreshToken(userId: number): Promise<string | null> {
  // Prefer the adwords-scope refresh token captured when the user self-connected
  // their Google Ads account (lsa_connections). Fall back to the login-scope
  // token from Google sign-in (users.googleRefreshToken), which may lack the
  // adwords scope needed for Ads API write access.
  const [conn] = await db.select({ refreshToken: lsaConnections.refreshToken }).from(lsaConnections).where(eq(lsaConnections.userId, userId)).limit(1);
  if (conn?.refreshToken) return conn.refreshToken;
  const [user] = await db.select({ googleRefreshToken: users.googleRefreshToken }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.googleRefreshToken ?? null;
}

async function getUserAccessToken(userId: number): Promise<string | null> {
  const refreshToken = await getUserRefreshToken(userId);
  if (!refreshToken) return null;
  const refreshed = await refreshAccessToken(refreshToken);
  return refreshed?.accessToken ?? null;
}

async function getManagerCredentials(useManager: boolean, userId?: number | null): Promise<{
  accessToken: string;
  devToken: string;
  loginCid: string | undefined;
} | { error: string }> {
  if (!useManager) {
    // Self-connected account: use the account owner's own adwords-scope OAuth token
    // (captured in lsa_connections when the user self-connected). This path must NOT
    // require an admin manager connection — self accounts are managed with the user's
    // own credentials plus the env developer token.
    if (userId) {
      const userAccessToken = await getUserAccessToken(userId);
      if (userAccessToken) {
        const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
        return { accessToken: userAccessToken, devToken, loginCid: undefined };
      }
    }
    // No usable user token. Fall back to manager credentials only if a manager
    // connection happens to exist (e.g. the account is also under the MCC).
    const conn = await getManagerConnection();
    if (!conn) return { error: "No user credentials or manager connection available" };
    const devToken = conn.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
    const accessToken = await getValidAccessToken(conn);
    if (!accessToken) return { error: "Failed to get valid access token" };
    return { accessToken, devToken, loginCid: undefined };
  }

  // Centrally-managed account: requires the admin manager (MCC) connection.
  const conn = await getManagerConnection();
  if (!conn) return { error: "No manager connection configured" };
  const devToken = conn.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
  const accessToken = await getValidAccessToken(conn);
  if (!accessToken) return { error: "Failed to get valid access token" };
  return { accessToken, devToken, loginCid: formatCustomerId(conn.managerId) };
}

export async function mutateCampaignBudget(
  targetCustomerId: string,
  budgetResourceName: string,
  newDailyBudgetDollars: number,
  useManager = true,
  userId?: number | null
): Promise<MutateResult> {
  if (!budgetResourceName || !budgetResourceName.includes("/campaignBudgets/")) {
    return { ok: false, error: `Invalid budget resource name: "${budgetResourceName}". Must be in the form customers/{cid}/campaignBudgets/{id}` };
  }

  const creds = await getManagerCredentials(useManager, userId);
  if ("error" in creds) return { ok: false, error: creds.error };

  const cid = formatCustomerId(targetCustomerId);
  const budgetMicros = Math.round(newDailyBudgetDollars * 1_000_000);

  const url = `${GOOGLE_ADS_BASE}/customers/${cid}/campaignBudgets:mutate`;
  const body = {
    operations: [{
      update: { resourceName: budgetResourceName, amountMicros: String(budgetMicros) },
      updateMask: "amount_micros",
    }],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(creds.accessToken, creds.devToken, creds.loginCid),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Google Ads API error ${res.status}: ${errText}` };
    }
    const data = await res.json();
    return { ok: true, resourceName: data.results?.[0]?.resourceName };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function mutateCampaignStatus(
  targetCustomerId: string,
  campaignResourceName: string,
  newStatus: "ENABLED" | "PAUSED",
  useManager = true,
  userId?: number | null
): Promise<MutateResult> {
  const creds = await getManagerCredentials(useManager, userId);
  if ("error" in creds) return { ok: false, error: creds.error };

  const cid = formatCustomerId(targetCustomerId);
  const url = `${GOOGLE_ADS_BASE}/customers/${cid}/campaigns:mutate`;
  const body = {
    operations: [{
      update: { resourceName: campaignResourceName, status: newStatus },
      updateMask: "status",
    }],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(creds.accessToken, creds.devToken, creds.loginCid),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Google Ads API error ${res.status}: ${errText}` };
    }
    const data = await res.json();
    return { ok: true, resourceName: data.results?.[0]?.resourceName };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function mutateCampaignSettings(
  targetCustomerId: string,
  campaignResourceName: string,
  settings: { name?: string },
  useManager = true,
  userId?: number | null
): Promise<MutateResult> {
  const updates: Record<string, string> = {};
  const masks: string[] = [];

  if (settings.name !== undefined) { updates.name = settings.name; masks.push("name"); }
  if (masks.length === 0) return { ok: false, error: "No settings provided to update" };

  const creds = await getManagerCredentials(useManager, userId);
  if ("error" in creds) return { ok: false, error: creds.error };

  const cid = formatCustomerId(targetCustomerId);
  const url = `${GOOGLE_ADS_BASE}/customers/${cid}/campaigns:mutate`;
  const body = {
    operations: [{
      update: { resourceName: campaignResourceName, ...updates },
      updateMask: masks.join(","),
    }],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(creds.accessToken, creds.devToken, creds.loginCid),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Google Ads API error ${res.status}: ${errText}` };
    }
    const data = await res.json();
    return { ok: true, resourceName: data.results?.[0]?.resourceName };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function createManagerLinkInvitation(targetCustomerId: string): Promise<MutateResult> {
  const conn = await getManagerConnection();
  if (!conn) return { ok: false, error: "No manager connection configured" };

  const accessToken = await getValidAccessToken(conn);
  if (!accessToken) return { ok: false, error: "Failed to get valid access token" };

  const devToken = conn.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
  const cid = formatCustomerId(targetCustomerId);
  const managerCid = formatCustomerId(conn.managerId);

  const url = `${GOOGLE_ADS_BASE}/customers/${managerCid}/customerClientLinks:mutate`;
  const body = {
    operations: [{
      create: {
        clientCustomer: `customers/${cid}`,
        status: "PENDING",
      },
    }],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(accessToken, devToken, managerCid),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `Google Ads API error ${res.status}: ${errText}` };
    }

    const data = await res.json();
    return { ok: true, resourceName: data.results?.[0]?.resourceName };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function listChildAccounts(): Promise<Array<{ customerId: string; name: string; isLsa: boolean }>> {
  const conn = await getManagerConnection();
  if (!conn) return [];

  const accessToken = await getValidAccessToken(conn);
  if (!accessToken) return [];

  const devToken = conn.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
  const managerCid = formatCustomerId(conn.managerId);

  const query = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.id,
      customer_client.level,
      customer_client.manager
    FROM customer_client
    WHERE customer_client.level BETWEEN 1 AND 10
    ORDER BY customer_client.level ASC
    LIMIT 500
  `;

  const url = `${GOOGLE_ADS_BASE}/customers/${managerCid}/googleAds:searchStream`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(accessToken, devToken, managerCid),
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return [];

    const batches = parseStreamBatches(await res.text());
    const accounts: Array<{ customerId: string; name: string; isLsa: boolean }> = [];

    for (const batch of batches) {
      for (const result of batch.results || []) {
        const cc = result.customerClient || result.customer_client;
        if (!cc) continue;
        const cid = String(cc.id || cc.clientCustomer?.split("/").pop() || "");
        if (!cid) continue;
        accounts.push({
          customerId: cid,
          name: cc.descriptiveName || cc.descriptive_name || "Unknown",
          isLsa: false,
        });
      }
    }

    return accounts;
  } catch {
    return [];
  }
}

export async function detectLsaEnrollment(targetCustomerId: string, useManager = true): Promise<boolean> {
  try {
    const campaigns = await fetchCampaigns(targetCustomerId, useManager);
    return campaigns.some(c => c.isLsa);
  } catch {
    return false;
  }
}

/* --------------------------------- leads ----------------------------------- */

const LEAD_QUERY = `
  SELECT
    local_services_lead.id,
    local_services_lead.lead_type,
    local_services_lead.category_id,
    local_services_lead.service_id,
    local_services_lead.contact_details,
    local_services_lead.lead_status,
    local_services_lead.lead_charged,
    local_services_lead.credit_details.credit_state,
    local_services_lead.creation_date_time
  FROM local_services_lead
  ORDER BY local_services_lead.creation_date_time DESC
  LIMIT 200
`;

function parseLeadDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}

export interface LeadSyncResult {
  ok: boolean;
  imported: number;
  newCharged: number;
  error?: string;
}

/**
 * Pull LSA leads for a single manager child account, upsert them into
 * lsa_manager_leads (keyed on the global Google lead id), and fire an admin
 * email alert for any genuinely new charged lead. Idempotent; never overwrites
 * the local dispute record. Dormant-safe: returns an error result (does not
 * throw) when no manager connection / credentials are configured.
 */
export async function fetchAndStoreLeads(
  accountDbId: number,
  targetCustomerId: string,
  accountName: string | null,
  useManager = true,
  userId?: number | null,
): Promise<LeadSyncResult> {
  const creds = await getManagerCredentials(useManager, userId);
  if ("error" in creds) return { ok: false, imported: 0, newCharged: 0, error: creds.error };

  const cid = formatCustomerId(targetCustomerId);
  const url = `${GOOGLE_ADS_BASE}/customers/${cid}/googleAds:searchStream`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(creds.accessToken, creds.devToken, creds.loginCid),
      body: JSON.stringify({ query: LEAD_QUERY }),
    });
  } catch (e: any) {
    return { ok: false, imported: 0, newCharged: 0, error: e.message };
  }
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, imported: 0, newCharged: 0, error: `Google Ads API error ${res.status}: ${errText}` };
  }

  // Snapshot existing leads for this account so we only alert on brand-new
  // charged leads (or a lead that flipped from not-charged to charged).
  const existingRows = await db
    .select({ googleLeadId: lsaManagerLeads.googleLeadId, charged: lsaManagerLeads.charged })
    .from(lsaManagerLeads)
    .where(eq(lsaManagerLeads.accountId, accountDbId));
  const existingCharged = new Map(existingRows.map(r => [r.googleLeadId, r.charged]));
  const isFirstBackfill = existingRows.length === 0;

  const batches = parseStreamBatches(await res.text());
  let imported = 0;
  const newlyCharged: Array<{
    customerName: string | null;
    customerPhone: string | null;
    serviceRequested: string | null;
    leadType: string | null;
  }> = [];

  for (const batch of batches) {
    for (const result of batch.results || []) {
      const lead = result.localServicesLead || result.local_services_lead;
      if (!lead?.id) continue;
      const cd = lead.contactDetails || lead.contact_details || {};
      const googleLeadId = String(lead.id);
      const charged = typeof lead.leadCharged === "boolean" ? lead.leadCharged
        : typeof lead.lead_charged === "boolean" ? lead.lead_charged : false;
      const customerName = cd.consumerName || cd.consumer_name || null;
      const customerPhone = cd.phoneNumber || cd.phone_number || null;
      const serviceRequested = lead.serviceId || lead.service_id || lead.categoryId || lead.category_id || null;
      const leadType = lead.leadType || lead.lead_type || null;
      const status = lead.leadStatus || lead.lead_status || "new";
      const leadCreatedAt = parseLeadDate(lead.creationDateTime || lead.creation_date_time);

      const values = {
        accountId: accountDbId,
        googleLeadId,
        leadType,
        status,
        customerName,
        customerPhone,
        serviceRequested,
        charged,
        leadCreatedAt,
      };

      await db.insert(lsaManagerLeads).values(values).onConflictDoUpdate({
        target: lsaManagerLeads.googleLeadId,
        // Refresh Google-authoritative fields only; never touch the local
        // dispute record (disputed / disputeReason / disputedAt / disputedByAdminId).
        set: {
          status: values.status,
          customerName: values.customerName,
          customerPhone: values.customerPhone,
          serviceRequested: values.serviceRequested,
          charged: values.charged,
        },
      });
      imported++;

      const becameCharged = charged && existingCharged.get(googleLeadId) !== true;
      if (becameCharged && !isFirstBackfill) {
        existingCharged.set(googleLeadId, true);
        newlyCharged.push({ customerName, customerPhone, serviceRequested, leadType });
      }
    }
  }

  // Refresh the denormalised lead count on the account row.
  const [{ total }] = await db
    .select({ total: count() })
    .from(lsaManagerLeads)
    .where(eq(lsaManagerLeads.accountId, accountDbId));
  await db.update(lsaManagerAccounts)
    .set({ leadCount: Number(total), updatedAt: new Date() })
    .where(eq(lsaManagerAccounts.id, accountDbId));

  // Fire admin email alerts for genuinely new charged leads (best-effort).
  for (const lead of newlyCharged) {
    try {
      await sendLsaChargedLeadAlert({
        accountName,
        customerId: cid,
        customerName: lead.customerName,
        customerPhone: lead.customerPhone,
        serviceRequested: lead.serviceRequested,
        leadType: lead.leadType,
      });
    } catch (e) {
      console.error("[lsa-manager] charged-lead alert failed:", e);
    }
  }

  return { ok: true, imported, newCharged: newlyCharged.length };
}

/* ---------------------------- background lead sync ---------------------------- */

let managerLeadTimer: NodeJS.Timeout | null = null;

/**
 * Periodically sync leads for every LSA-enrolled child account under the admin
 * manager connection. Safe to call once at startup; no-ops while there is no
 * active manager connection.
 */
export function startManagerLeadSync(intervalMs = 5 * 60 * 1000) {
  if (managerLeadTimer) return;

  const tick = async () => {
    try {
      const conn = await getManagerConnection();
      if (!conn || conn.status !== "active") return;
      const accounts = await db
        .select()
        .from(lsaManagerAccounts)
        .where(and(eq(lsaManagerAccounts.linkStatus, "active"), eq(lsaManagerAccounts.isLsaEnrolled, true)));
      for (const acct of accounts) {
        const useManager = acct.linkType === "central" || acct.linkType === "both";
        try {
          await fetchAndStoreLeads(acct.id, acct.customerId, acct.accountName, useManager, acct.userId);
        } catch (e) {
          console.error(`[lsa-manager] lead sync failed for ${acct.customerId}:`, e);
        }
      }
    } catch (e) {
      console.error("[lsa-manager] lead sync tick error:", e);
    }
  };

  managerLeadTimer = setInterval(tick, intervalMs);
  if (typeof managerLeadTimer.unref === "function") managerLeadTimer.unref();
  const initial = setTimeout(tick, 30_000);
  if (typeof initial.unref === "function") initial.unref();
}
