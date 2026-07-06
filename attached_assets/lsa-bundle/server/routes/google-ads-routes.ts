/**
 * Admin endpoints for the Google Local Services Ads (LSA) integration.
 *
 * The OAuth start/callback routes are full-page browser redirects (Google can't
 * send custom auth headers), so these live under /api/admin/* and rely on the
 * same admin posture as the rest of the admin API. CSRF on the callback is
 * guarded by a short-lived random `state` value.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  isConfigured,
  isConnected,
  buildAuthUrl,
  exchangeCode,
  saveRefreshToken,
  loadConfig,
  getRedirectUri,
} from "../services/google-ads-client";
import {
  syncLsaLeads,
  getStoredLsaLeads,
  getLsaLeadCount,
  provideLeadFeedback,
  enqueueDisputes,
  resumeDisputeQueue,
  scheduleDisputes,
  unscheduleDisputes,
  promoteDueScheduledDisputes,
} from "../services/google-ads-leads";

// Short-lived OAuth state store (10 min). In-memory is fine — if the server
// restarts mid-flow the user just clicks Connect again.
const pendingStates = new Map<string, number>();
function newState(): string {
  const s = crypto.randomBytes(16).toString("hex");
  pendingStates.set(s, Date.now() + 10 * 60 * 1000);
  return s;
}
function consumeState(s: string): boolean {
  const exp = pendingStates.get(s);
  if (!exp) return false;
  pendingStates.delete(s);
  return exp > Date.now();
}

// Escape any text that ends up inside the HTML response. The callback receives
// attacker-controllable query params (error, code) and exception strings, so we
// must never inject them raw — that would be a reflected XSS on our own origin.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function closeTab(message: string, ok: boolean): string {
  const icon = ok ? "✅" : "⚠️";
  const title = ok ? "Connected" : "Heads up";
  const safeMessage = escapeHtml(message);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Google Ads</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b1220;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:440px;text-align:center;padding:36px;background:#131c30;border-radius:18px;border:1px solid #25324d}
.ic{font-size:52px;line-height:1}h2{margin:14px 0 8px}p{color:#aebbd4;line-height:1.5}</style></head>
<body><div class="box"><div class="ic">${icon}</div><h2>${title}</h2><p>${safeMessage}</p></div></body></html>`;
}

export function registerGoogleAdsRoutes(
  app: Express,
  requireAdminToken: (req: Request, res: Response, next: () => void) => void,
) {
  // Connection + sync status for the admin UI.
  app.get("/api/admin/google-ads/status", async (_req, res) => {
    try {
      const configured = isConfigured();
      const connected = configured ? await isConnected() : false;
      const cfg = connected ? await loadConfig() : undefined;
      const leadCount = await getLsaLeadCount().catch(() => 0);
      res.json({
        configured,
        connected,
        leadCount,
        lastSyncAt: cfg?.lastSyncAt ?? null,
        lastSyncError: cfg?.lastSyncError ?? null,
        lastSyncCount: cfg?.lastSyncCount ?? 0,
        lastCostTotal: cfg?.lastCostTotal ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Kick off the OAuth consent flow (opened in a new tab by the admin UI).
  app.get("/api/admin/google-ads/oauth/start", (req, res) => {
    if (!isConfigured()) {
      return res.status(503).send(closeTab("Google Ads API isn't configured yet (missing client credentials).", false));
    }
    const host = req.get("host") || "";
    const state = newState();
    res.redirect(buildAuthUrl(getRedirectUri(host), state));
  });

  // OAuth redirect target — exchanges the code for a refresh token.
  app.get("/api/admin/google-ads/oauth/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.send(closeTab(`Google sign-in was cancelled (${error}).`, false));
    if (!code || !state || !consumeState(state)) {
      return res.send(closeTab("This sign-in link expired or was invalid. Please click Connect again.", false));
    }
    try {
      const host = req.get("host") || "";
      const tokens = await exchangeCode(code, getRedirectUri(host));
      if (!tokens.refresh_token) {
        return res.send(closeTab(
          "Google didn't return a refresh token. Remove this app under your Google Account → Security → Third-party access, then click Connect again.",
          false,
        ));
      }
      await saveRefreshToken(tokens.refresh_token);
      // Pull leads right away, but don't block the success page on it.
      syncLsaLeads().catch(() => {});
      res.send(closeTab("Google Ads is connected. You can close this tab and return to the admin panel.", true));
    } catch (e: any) {
      res.send(closeTab(`Connection failed: ${e?.message || e}`, false));
    }
  });

  // Manual "Sync now" trigger. Admin-token gated (pulls account data).
  app.post("/api/admin/google-ads/sync", requireAdminToken, async (_req, res) => {
    if (!isConfigured()) return res.status(503).json({ ok: false, error: "Google Ads API not configured." });
    const result = await syncLsaLeads();
    res.status(result.ok ? 200 : 500).json(result);
  });

  // Stored LSA leads for the admin panel.
  app.get("/api/admin/google-ads/leads", async (_req, res) => {
    try {
      res.json(await getStoredLsaLeads());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Rate a single LSA lead (Google ProvideLeadFeedback). A "bad" rating with a
  // reason is how a lead is flagged for a billing credit/dispute. This is a
  // real write to the owner's Google Ads account.
  app.post("/api/admin/google-ads/leads/:leadId/feedback", requireAdminToken, async (req, res) => {
    if (!isConfigured()) return res.status(503).json({ ok: false, error: "Google Ads API not configured." });
    const { leadId } = req.params;
    const { surveyAnswer, dissatisfiedReason } = (req.body || {}) as {
      surveyAnswer?: string;
      dissatisfiedReason?: string | null;
    };
    try {
      await provideLeadFeedback(leadId, String(surveyAnswer || ""), dissatisfiedReason ?? null);
      res.json({ ok: true });
    } catch (e: any) {
      // Surface Google's raw message so any mismatch is visible to the owner.
      res.status(400).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Dispute MANY leads at once. They're sent to Google one-by-one with a
  // randomized 30–60s gap between each (every gap differs) so it never looks
  // like automated/bot spam. Returns immediately; progress shows via each
  // lead's dispute_status sticker.
  app.post("/api/admin/google-ads/leads/dispute-batch", requireAdminToken, async (req, res) => {
    if (!isConfigured()) return res.status(503).json({ ok: false, error: "Google Ads API not configured." });
    try {
      const items = (req.body?.items || []) as { leadId: string; reason: string }[];
      const result = await enqueueDisputes(items);
      res.json({ ok: true, queued: result.queued });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Schedule MANY leads to be disputed at FUTURE moments. Each item carries its
  // own reason and runAt (epoch ms), so the owner can scatter disputes across
  // days/weeks. The lead sits in dispute_status='scheduled' until its moment,
  // then a timer (below) promotes it into the same spaced send queue.
  app.post("/api/admin/google-ads/leads/schedule-batch", requireAdminToken, async (req, res) => {
    if (!isConfigured()) return res.status(503).json({ ok: false, error: "Google Ads API not configured." });
    try {
      const items = (req.body?.items || []) as { leadId: string; reason: string; runAt: number }[];
      const result = await scheduleDisputes(items);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Cancel scheduled-but-not-yet-sent disputes.
  app.post("/api/admin/google-ads/leads/unschedule", requireAdminToken, async (req, res) => {
    try {
      const leadIds = (req.body?.leadIds || []) as string[];
      const result = await unscheduleDisputes(leadIds);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message || String(e) });
    }
  });

  // Recover any disputes interrupted by a restart so the UI never hangs.
  resumeDisputeQueue().catch(() => {});

  // Promote any scheduled disputes whose moment has arrived into the send queue.
  // Run once on boot (catches anything due while the server was down) and then
  // every minute. The send queue still spaces each one 30–60s apart.
  promoteDueScheduledDisputes().catch(() => {});
  const SCHEDULE_TICK_MS = 60 * 1000;
  setInterval(() => {
    if (!isConfigured()) return;
    promoteDueScheduledDisputes().catch(() => {});
  }, SCHEDULE_TICK_MS);

  // Background auto-sync so new LSA leads appear on their own — no need to hit
  // "Sync now". Google's Ads API has NO real-time push/webhook for leads, so
  // frequent polling is the only way to keep the list current. We poll every
  // 2 minutes when connected; the admin page also refetches the stored list on
  // its own, so a new lead shows up within ~2 minutes of Google receiving it.
  const AUTO_SYNC_MS = 2 * 60 * 1000;
  let autoSyncing = false;
  setInterval(async () => {
    // Take the lock BEFORE any await so a slow tick can never overlap the next.
    if (autoSyncing || !isConfigured()) return;
    autoSyncing = true;
    try {
      if (await isConnected()) await syncLsaLeads();
    } catch {
      /* surfaced via lastSyncError on the status endpoint */
    } finally {
      autoSyncing = false;
    }
  }, AUTO_SYNC_MS);

  console.log("✅ Google Ads / LSA routes registered (/api/admin/google-ads/*)");
}
