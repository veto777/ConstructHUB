/**
 * Voice calls (SignalWire LaML Calls API) — the optional "check your email"
 * nudge: when an org turns it on, sending an estimate also rings the client
 * with a short recorded message pointing at their inbox.
 *
 * Why voice is allowed when client TEXTING is not: 10DLC carrier campaigns
 * govern SMS/MMS, not voice calls — a call needs no registered campaign, so
 * the shared platform number MAY call clients even though it may not text
 * them. The sender resolution is still the org's own number when they have
 * one (their clients see a familiar caller id).
 *
 * Same seam discipline as sms.ts: credentials are read at call time, and when
 * nothing can place the call the LOG provider records to
 * tmp/voice-outbox.jsonl (override with VOICE_OUTBOX_PATH) and names itself in
 * the result. placeEmailNudgeCall never throws — a voice hiccup must never
 * break an estimate send.
 */
import fs from "fs";
import path from "path";
import { resolveSmsSender, type SmsSender } from "./sms";
import type { crmOrgs } from "@shared/schema";

export type VoiceResult = {
  ok: boolean;
  provider: "signalwire" | "log";
  sid?: string | null;
  error?: string | null;
};

/** Org toggle (custom_fields->voiceNudge): call the client on estimate send. */
export function voiceNudgeOnEstimate(customFields: unknown): boolean {
  return (customFields as Record<string, unknown> | null | undefined)?.voiceNudge === true;
}

const LOG_PATH = () =>
  process.env.VOICE_OUTBOX_PATH ?? path.join(process.cwd(), "tmp", "voice-outbox.jsonl");

const escXml = (s: string) =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[m]!));

/** The recorded message the client hears. */
export function emailNudgeTwiml(orgName: string): string {
  return `<Response><Say>Hi, this is ${escXml(orgName)}. We just sent your estimate — please check your email inbox or spam folder. Thank you.</Say></Response>`;
}

function logProviderCall(to: string, twiml: string): VoiceResult {
  const entry = { at: new Date().toISOString(), provider: "log", to, twiml };
  try {
    fs.mkdirSync(path.dirname(LOG_PATH()), { recursive: true });
    fs.appendFileSync(LOG_PATH(), JSON.stringify(entry) + "\n");
  } catch { /* a full disk must not break an estimate send */ }
  console.log(`[VOICE LOG] no carrier configured — recorded instead of calling (to: ${to})`);
  return { ok: true, provider: "log", sid: null };
}

async function signalwireCall(to: string, twiml: string, sender: SmsSender): Promise<VoiceResult> {
  const { space, project, token, from } = sender;
  try {
    const resp = await fetch(
      `https://${space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(project)}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${project}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Twiml: twiml }).toString(),
      },
    );
    const payload: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = String(payload?.message ?? `SignalWire HTTP ${resp.status}`).slice(0, 300);
      console.error("[voice] SignalWire call failed:", msg);
      return { ok: false, provider: "signalwire", error: msg };
    }
    return { ok: true, provider: "signalwire", sid: payload?.sid ?? null };
  } catch (e: any) {
    console.error("[voice] SignalWire call failed:", e?.message || e);
    return { ok: false, provider: "signalwire", error: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * Ring `to` (E.164) with the "we just emailed your estimate" message on the
 * org's behalf. Uses the org's own caller id when they brought one, else the
 * shared platform number (voice needs no campaign). Records instead of
 * calling when no carrier is configured. Never throws.
 */
export async function placeEmailNudgeCall(
  to: string,
  org: Pick<typeof crmOrgs.$inferSelect, "name" | "customFields">,
): Promise<VoiceResult> {
  try {
    const twiml = emailNudgeTwiml(org.name);
    const sender = resolveSmsSender(org.customFields);
    if (!sender) return logProviderCall(to, twiml);
    return await signalwireCall(to, twiml, sender);
  } catch (e: any) {
    console.error("[voice] email-nudge call failed:", e?.message || e);
    return { ok: false, provider: "log", error: String(e?.message || e).slice(0, 300) };
  }
}
