/**
 * SMS compliance pivot — the carrier-required behavior:
 *
 *   1. Client/homeowner texting is gated to orgs with their OWN registered
 *      number/account (BYO/dedicated) — never the shared platform number.
 *   2. STOP / HELP / START inbound webhook + opt-out suppression on send.
 *   3. SMS consent capture (explicit timestamp on the member).
 *   4. Voice "check your email" nudge (calls need no carrier campaign).
 *
 * Part 1 is pure/seam tests — the module is imported dynamically AFTER the
 * env shims so its db pool points at the test database (CRM_TEST_*).
 * Part 2 exercises the running dev server (CRM_TEST_BASE_URL).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
// The seam tests run REAL opt-out queries — point the module's pool at the
// test DB before importing it (db.ts reads DATABASE_URL at import time).
process.env.DATABASE_URL =
  process.env.CRM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

let sendSms: any, resolveSmsSender: any, orgCanTextClients: any, smsStatus: any,
  recordSmsOptout: any, clearSmsOptout: any, isSmsOptedOut: any,
  smsLamlReply: any, signalwireSignatureOk: any, CLIENT_TEXT_NEEDS_OWN_NUMBER: string;
let placeEmailNudgeCall: any, voiceNudgeOnEstimate: any, emailNudgeTwiml: any;

beforeAll(async () => {
  ({
    sendSms, resolveSmsSender, orgCanTextClients, smsStatus,
    recordSmsOptout, clearSmsOptout, isSmsOptedOut,
    smsLamlReply, signalwireSignatureOk, CLIENT_TEXT_NEEDS_OWN_NUMBER,
  } = await import("./sms"));
  ({ placeEmailNudgeCall, voiceNudgeOnEstimate, emailNudgeTwiml } = await import("./voice"));
  // The table is created by the dev server's ensureCrmSchema; create it here
  // too so the seam tests also pass against a fresh database.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_sms_optouts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id varchar NOT NULL,
      phone text NOT NULL,
      reason text,
      created_at timestamp DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_sms_optouts_org_phone_idx
      ON crm_sms_optouts (org_id, phone);
  `);
});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const SW_KEYS = ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER", "SIGNALWIRE_SIGNING_KEY"] as const;
const SW_ENV = {
  SIGNALWIRE_SPACE_URL: "x.signalwire.com",
  SIGNALWIRE_PROJECT_ID: "proj-1",
  SIGNALWIRE_API_TOKEN: "tok-1",
  SIGNALWIRE_FROM_NUMBER: "+15550001111",
};

async function withSwEnv<T>(vals: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(SW_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SW_KEYS) {
    const v = vals[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of SW_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

afterEach(() => vi.unstubAllGlobals());

// ── Part 1: gating, suppression seam, voice (pure / db-seam) ───────────────

describe("orgCanTextClients (pure)", () => {
  it("platform sender may NOT text clients; dedicated and BYO may; no sender may not", async () => {
    await withSwEnv(SW_ENV, () => {
      // Platform (no org sms config) — refused even though a sender exists.
      expect(resolveSmsSender(null)?.mode).toBe("platform");
      expect(orgCanTextClients(null)).toBe(false);
      expect(orgCanTextClients({ sms: { mode: "platform" } })).toBe(false);

      // Dedicated: their number on the platform account.
      expect(orgCanTextClients({ sms: { mode: "dedicated", fromNumber: "+15551234567" } })).toBe(true);

      // BYO: complete own-account config. Token via the module's encryptor.
      return (async () => {
        const { encryptSmsSecret } = await import("./sms");
        const byo = {
          sms: {
            mode: "byo", fromNumber: "+15557654321",
            spaceUrl: "acme.signalwire.com", projectId: "p1",
            apiTokenEnc: encryptSmsSecret("tok"),
          },
        };
        expect(orgCanTextClients(byo)).toBe(true);
        // Incomplete BYO falls back to platform → still refused for clients.
        expect(orgCanTextClients({ sms: { mode: "byo", fromNumber: "+15557654321" } })).toBe(false);
      })();
    });
    // Nothing can send at all (no platform env, no org config) → refused.
    await withSwEnv({}, () => {
      expect(orgCanTextClients(null)).toBe(false);
    });
  });

  it("smsStatus surfaces canTextClients for the UI", async () => {
    await withSwEnv(SW_ENV, () => {
      expect(smsStatus(null).canTextClients).toBe(false);
      expect(smsStatus({ sms: { mode: "dedicated", fromNumber: "+15551234567" } }).canTextClients).toBe(true);
    });
  });
});

describe("opt-out suppression seam (real test DB)", () => {
  const orgA = "vitest-sms-seam-a";
  const orgB = "vitest-sms-seam-b";
  const phone = "+15550199999";
  const outbox = path.join(process.cwd(), "tmp", `sms-seam-test-${Date.now()}.jsonl`);

  afterEach(async () => {
    await pool.query(`delete from crm_sms_optouts where org_id in ($1, $2, '*') and phone = $3`, [orgA, orgB, phone]);
  });

  it("a STOP row skips the send (reported, never thrown); other orgs are unaffected until the '*' row exists", async () => {
    const savedPath = process.env.SMS_OUTBOX_PATH;
    process.env.SMS_OUTBOX_PATH = outbox;
    await withSwEnv({}, async () => {
      try {
        // No opt-out → sends (log provider in dev).
        const before = await sendSms(phone, "hello", undefined, orgA);
        expect(before.ok).toBe(true);
        expect(before.provider).toBe("log");

        // Org A opts out → org A suppressed, org B still sends (tenant isolation).
        await recordSmsOptout(orgA, phone, "STOP");
        expect(await isSmsOptedOut(orgA, phone)).toBe(true);
        expect(await isSmsOptedOut(orgB, phone)).toBe(false);

        const suppressed = await sendSms(phone, "hello", undefined, orgA);
        expect(suppressed.ok).toBe(false);
        expect(suppressed.error).toContain("STOP");
        const otherOrg = await sendSms(phone, "hello", undefined, orgB);
        expect(otherOrg.ok).toBe(true);

        // Platform-wide row (a STOP to the shared number) suppresses everyone.
        await recordSmsOptout("*", phone, "STOP");
        const bothOrgs = await sendSms(phone, "hello", undefined, orgB);
        expect(bothOrgs.ok).toBe(false);

        // START clears every row for the phone → sends again.
        await clearSmsOptout(phone);
        expect(await isSmsOptedOut(orgA, phone)).toBe(false);
        const resumed = await sendSms(phone, "hello", undefined, orgA);
        expect(resumed.ok).toBe(true);
      } finally {
        if (savedPath === undefined) delete process.env.SMS_OUTBOX_PATH;
        else process.env.SMS_OUTBOX_PATH = savedPath;
        fs.rmSync(outbox, { force: true });
      }
    });
  });
});

describe("voice email-nudge (pure)", () => {
  it("the toggle reads custom_fields->voiceNudge (default OFF)", () => {
    expect(voiceNudgeOnEstimate(null)).toBe(false);
    expect(voiceNudgeOnEstimate({ voiceNudge: true })).toBe(true);
    expect(voiceNudgeOnEstimate({ voiceNudge: false })).toBe(false);
  });

  it("the message names the org and points at the inbox/spam folder", () => {
    const twiml = emailNudgeTwiml("Bob's Roofing & <Sons>");
    expect(twiml).toContain("<Say>Hi, this is Bob&apos;s Roofing &amp; &lt;Sons&gt;");
    expect(twiml).toContain("check your email inbox or spam folder");
  });

  it("unconfigured dev records a log call instead of dialing — and never throws", async () => {
    const outbox = path.join(process.cwd(), "tmp", `voice-test-${Date.now()}.jsonl`);
    const savedPath = process.env.VOICE_OUTBOX_PATH;
    process.env.VOICE_OUTBOX_PATH = outbox;
    await withSwEnv({}, async () => {
      try {
        const r = await placeEmailNudgeCall("+15551234567", { name: "Vitest Roofing", customFields: null });
        expect(r).toEqual({ ok: true, provider: "log", sid: null });
        const lines = fs.readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(lines.at(-1)).toMatchObject({ provider: "log", to: "+15551234567" });
        expect(lines.at(-1).twiml).toContain("Vitest Roofing");
      } finally {
        if (savedPath === undefined) delete process.env.VOICE_OUTBOX_PATH;
        else process.env.VOICE_OUTBOX_PATH = savedPath;
        fs.rmSync(outbox, { force: true });
      }
    });
  });

  it("configured: POSTs From/To/Twiml to Accounts/{project}/Calls.json with basic auth", async () => {
    await withSwEnv(SW_ENV, async () => {
      const calls: { url: string; init: any }[] = [];
      vi.stubGlobal("fetch", async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        return { ok: true, status: 201, json: async () => ({ sid: "CAabc123" }) };
      });
      const r = await placeEmailNudgeCall("+15551234567", { name: "Vitest Roofing", customFields: null });
      expect(r).toEqual({ ok: true, provider: "signalwire", sid: "CAabc123" });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://x.signalwire.com/api/laml/2010-04-01/Accounts/proj-1/Calls.json");
      const params = new URLSearchParams(calls[0].init.body);
      expect(params.get("From")).toBe("+15550001111");
      expect(params.get("To")).toBe("+15551234567");
      expect(params.get("Twiml")).toContain("<Response><Say>");
    });
  });
});

describe("inbound webhook helpers (pure)", () => {
  it("LaML replies are valid XML with the message escaped", () => {
    expect(smsLamlReply()).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    expect(smsLamlReply("You're <unsubscribed>")).toContain("<Message>You&#39;re &lt;unsubscribed&gt;</Message>");
  });

  it("unsigned requests pass (a STOP must never be dropped); without a signing key a mismatch is accepted", async () => {
    await withSwEnv(SW_ENV, () => {
      expect(signalwireSignatureOk({ headers: {}, body: {}, originalUrl: "/api/crm/sms/inbound" })).toBe(true);
      // SignalWire signs with the project signing key, not the API token — until
      // SIGNALWIRE_SIGNING_KEY is installed we cannot verify, so we must not 403
      // real carrier STOPs (2026-08-27 incident).
      expect(signalwireSignatureOk({
        headers: { "x-signalwire-signature": "definitely-wrong" },
        body: { From: "+15551234567" },
        originalUrl: "/api/crm/sms/inbound",
      })).toBe(true);
    });
  });

  it("with SIGNALWIRE_SIGNING_KEY set, a correct signature passes and a wrong one is rejected", async () => {
    const { createHmac } = await import("crypto");
    const { getBaseUrl } = await import("../auth");
    await withSwEnv({ ...SW_ENV, SIGNALWIRE_SIGNING_KEY: "signing-key-1" }, () => {
      const req: any = { headers: { host: "portal.constructhub.us" }, body: { Body: "STOP", From: "+15551234567" }, originalUrl: "/api/crm/sms/inbound" };
      const signed = `${getBaseUrl(req)}${req.originalUrl}Body${"STOP"}From${"+15551234567"}`;
      req.headers["x-signalwire-signature"] = createHmac("sha1", "signing-key-1").update(signed).digest("base64");
      expect(signalwireSignatureOk(req)).toBe(true);
      req.headers["x-signalwire-signature"] = createHmac("sha1", "some-other-key").update(signed).digest("base64");
      expect(signalwireSignatureOk(req)).toBe(false);
    });
  });
});

// ── Part 2: against the dev server ──────────────────────────────────────────

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.headers as any)?.["content-type"] ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers, cookie: setCookie?.split(";")[0] ?? cookie };
}

async function poll<T>(fn: () => Promise<T>, want: (v: T) => boolean, ms = 9000): Promise<T> {
  const deadline = Date.now() + ms;
  let v = await fn();
  while (!want(v) && Date.now() < deadline) {
    await sleep(250);
    v = await fn();
  }
  return v;
}

const uniquePhone = () => `+1 555 ${String(Math.floor(1000000 + Math.random() * 8999999))}`;

describe("SMS compliance against the dev server", () => {
  let cookie: string | undefined;
  let orgId: string;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
  });

  async function makeCustomer(withPhone = true) {
    const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: `Vitest Compliance ${run}`,
        email: `vitest.compliance.${run}@example.com`,
        ...(withPhone ? { phone: uniquePhone() } : {}),
      }),
    }, cookie);
    expect(cust.status).toBe(201);
    return cust.body;
  }

  async function makeEstimate(customerId: string) {
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId, title: "Vitest compliance estimate",
        items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 42000 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    return est.body;
  }

  it("platform org: the estimate-send client text is refused with the BYO reason; email still sends", async () => {
    const status = await api("/api/crm/sms/status", {}, cookie);
    expect(status.status).toBe(200);
    expect(status.body.canTextClients).toBe(false); // dev org is on the shared number

    const cust = await makeCustomer();
    const est = await makeEstimate(cust.id);
    const send = await api(`/api/crm/estimates/${est.id}/send`, {
      method: "POST", body: JSON.stringify({ sms: true }),
    }, cookie);
    expect(send.status).toBe(200);
    expect(send.body.emailed).toBe(true);
    expect(send.body.texted).toBe(false);
    expect(send.body.smsTo).toBeNull();
    expect(send.body.smsError).toContain("Client texting needs your own number");
  });

  it("BYO org: the client text is ATTEMPTED (not gated) — and fails honestly against the unreachable account", async () => {
    const sender = await api("/api/crm/sms/sender", {
      method: "PUT",
      body: JSON.stringify({
        mode: "byo", fromNumber: "+15550100009",
        // Port 9 (discard) fails fast — the point is the send is ATTEMPTED,
        // not that a fake account delivers.
        spaceUrl: "127.0.0.1:9", projectId: "proj-vitest", apiToken: "tok-vitest",
      }),
    }, cookie);
    expect(sender.status).toBe(200);
    expect(sender.body.canTextClients).toBe(true);

    try {
      const cust = await makeCustomer();
      const est = await makeEstimate(cust.id);
      const send = await api(`/api/crm/estimates/${est.id}/send`, {
        method: "POST", body: JSON.stringify({ sms: true }),
      }, cookie);
      expect(send.status).toBe(200);
      expect(send.body.emailed).toBe(true);
      expect(send.body.smsTo).toBeTruthy(); // the send went out the door…
      expect(send.body.smsError ?? "").not.toContain("Client texting needs your own number");
      expect(send.body.texted).toBe(false); // …and honestly failed at the fake account

      // The message-center text route is likewise no longer gated for BYO.
      const msg = await api("/api/crm/messages", {
        method: "POST", body: JSON.stringify({ customerId: cust.id, channel: "text", body: "hi" }),
      }, cookie);
      expect(msg.status).not.toBe(409);
    } finally {
      const back = await api("/api/crm/sms/sender", {
        method: "PUT", body: JSON.stringify({ mode: "platform" }),
      }, cookie);
      expect(back.status).toBe(200);
      expect(back.body.canTextClients).toBe(false);
    }
  });

  it("platform org: message-center text is refused 409 with the BYO reason", async () => {
    const cust = await makeCustomer();
    const msg = await api("/api/crm/messages", {
      method: "POST", body: JSON.stringify({ customerId: cust.id, channel: "text", body: "hi" }),
    }, cookie);
    // No sender at all in dev → the older "not configured" refusal ALSO names
    // a path; on a configured platform sender it's the BYO reason. Either way
    // the client is NOT texted from the shared number.
    expect(msg.status).toBe(409);
  });

  it("STOP records the opt-out (per-org + platform-wide), HELP answers, START clears — LaML XML throughout", async () => {
    const me = await api("/api/crm/me", {}, cookie);
    const memberPhone = me.body.member.phone;
    // Give the dev member a phone so the org-match leg is exercised.
    const phone = memberPhone || "+15550100077";
    if (!memberPhone) {
      await api("/api/crm/profile", { method: "PATCH", body: JSON.stringify({ phone }) }, cookie);
    }
    const normalized = phone.replace(/[^\d]/g, "").replace(/^(\d{10})$/, "1$1");
    const e164 = `+${normalized}`;

    try {
      const stop = await api("/api/crm/sms/inbound", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: e164, To: "+15550001111", Body: "stop" }).toString(),
      });
      expect(stop.status).toBe(200);
      expect(stop.headers.get("content-type")).toContain("text/xml");
      expect(stop.body).toContain("unsubscribed");
      expect(stop.body).toContain("Reply START to resume");

      // Recorded: the platform-wide row AND this org's row (the member's phone).
      const rows = await poll(
        async () => (await pool.query(
          `select org_id from crm_sms_optouts where phone = $1`, [e164],
        )).rows.map((r: any) => r.org_id),
        (ids: string[]) => ids.includes("*") && ids.includes(orgId),
      );
      expect(rows).toContain("*");
      expect(rows).toContain(orgId);

      const help = await api("/api/crm/sms/inbound", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: e164, To: "+15550001111", Body: "HELP" }).toString(),
      });
      expect(help.status).toBe(200);
      expect(help.body).toContain("support@constructhub.us");
      expect(help.body).toContain("STOP");

      const start = await api("/api/crm/sms/inbound", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: e164, To: "+15550001111", Body: "START" }).toString(),
      });
      expect(start.status).toBe(200);
      expect(start.body).toContain("resubscribed");
      const remaining = (await pool.query(
        `select count(*)::int as n from crm_sms_optouts where phone = $1`, [e164],
      )).rows[0].n;
      expect(remaining).toBe(0);
    } finally {
      await pool.query(`delete from crm_sms_optouts where phone = $1`, [e164]);
    }
  });

  it("consent: enabling any Text channel stamps smsConsentAt; the explicit endpoint sets and clears it", async () => {
    const org = await api("/api/crm/org", {}, cookie);
    const priorPref = org.body.customFields?.notificationPrefs?.estimateSent;

    try {
      // Clear, then flip a Text channel on → the org PATCH stamps consent.
      await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: false }) }, cookie);
      let me = await api("/api/crm/me", {}, cookie);
      expect(me.body.member.smsConsentAt).toBeNull();

      const patch = await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ notificationPrefs: { estimateSent: { sms: true } } }),
      }, cookie);
      expect(patch.status).toBe(200);
      me = await api("/api/crm/me", {}, cookie);
      expect(me.body.member.smsConsentAt).toBeTruthy();

      // Explicit withdraw + re-consent through the dedicated endpoint.
      const off = await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: false }) }, cookie);
      expect(off.status).toBe(200);
      expect(off.body.smsConsentAt).toBeNull();
      const on = await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: true }) }, cookie);
      expect(on.status).toBe(200);
      expect(on.body.smsConsentAt).toBeTruthy();
    } finally {
      await api("/api/crm/org", {
        method: "PATCH",
        body: JSON.stringify({ notificationPrefs: { estimateSent: priorPref ?? true } }),
      }, cookie);
      await api("/api/crm/me/sms-consent", { method: "POST", body: JSON.stringify({ agree: false }) }, cookie);
    }
  });

  it("voice nudge: toggle ON places a (log) call on estimate send; toggle OFF stays silent", async () => {
    const outboxPath = path.join(process.cwd(), "tmp", "voice-outbox.jsonl");
    const readOutbox = () =>
      fs.existsSync(outboxPath) ? fs.readFileSync(outboxPath, "utf8") : "";

    const on = await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ voiceNudge: true }) }, cookie);
    expect(on.status).toBe(200);

    try {
      const cust1 = await makeCustomer();
      const est1 = await makeEstimate(cust1.id);
      const before = readOutbox();
      const send1 = await api(`/api/crm/estimates/${est1.id}/send`, { method: "POST", body: "{}" }, cookie);
      expect(send1.status).toBe(200);
      const digits1 = cust1.phone.replace(/\D/g, "").slice(-10);
      await poll(async () => readOutbox(), (o) => o !== before && o.includes(digits1));
      expect(readOutbox()).toContain("check your email inbox or spam folder");

      const off = await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ voiceNudge: false }) }, cookie);
      expect(off.status).toBe(200);
      const cust2 = await makeCustomer();
      const est2 = await makeEstimate(cust2.id);
      const beforeOff = readOutbox();
      const send2 = await api(`/api/crm/estimates/${est2.id}/send`, { method: "POST", body: "{}" }, cookie);
      expect(send2.status).toBe(200);
      await sleep(1500); // give a fire-and-forget call time to (not) happen
      const phone2digits = cust2.phone.replace(/\D/g, "").slice(-10);
      expect(readOutbox().slice(beforeOff.length)).not.toContain(phone2digits);
    } finally {
      await api("/api/crm/org", { method: "PATCH", body: JSON.stringify({ voiceNudge: false }) }, cookie);
    }
  });
});
