/**
 * SMS (Twilio) + estimate reminders + engagement re-engagement alerts.
 *
 * Part 1 is pure/provider tests: Twilio payload shape against a mocked fetch,
 * not-configured honesty, the recording log provider, phone normalisation —
 * no server needed. Env is read AT CALL TIME by the module, so tests flip
 * process.env freely (always restored).
 *
 * Part 2 exercises the running dev server like engagement.test.ts does:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";

// sms.ts imports tenancy → ../stripe, which throws without a key at module
// scope — and ES imports hoist above any env shim, so the module is loaded
// dynamically in beforeAll AFTER the shims are set (engagement.test.ts does
// the same for portal.ts).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let sendSms: any, smsConfigured: any, smsMissingEnv: any, smsStatus: any,
  normalizePhone: any, reengagementDayKey: any;

beforeAll(async () => {
  ({ sendSms, smsConfigured, smsMissingEnv, smsStatus, normalizePhone, reengagementDayKey } =
    await import("./sms"));
});

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});

const TWILIO_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;

/** Run fn with the Twilio env set to `vals` (undefined = unset); always restores. */
async function withTwilioEnv<T>(vals: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(TWILIO_KEYS.map((k) => [k, process.env[k]]));
  for (const k of TWILIO_KEYS) {
    const v = vals[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of TWILIO_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

afterEach(() => vi.unstubAllGlobals());

// ── Part 1: pure / provider ─────────────────────────────────────────────────

describe("sms configuration honesty (pure)", () => {
  it("not-configured names every missing env var and hides the from-number", async () => {
    await withTwilioEnv({}, async () => {
      expect(smsConfigured()).toBe(false);
      expect(smsMissingEnv()).toEqual([...TWILIO_KEYS]);
      const s = smsStatus();
      expect(s.configured).toBe(false);
      expect(s.missing).toEqual([...TWILIO_KEYS]);
      expect(s.fromNumber).toBeNull();
    });
  });

  it("partial env is still not configured — and says exactly which are left", async () => {
    await withTwilioEnv({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: undefined, TWILIO_FROM_NUMBER: "+15550001111" }, async () => {
      expect(smsConfigured()).toBe(false);
      expect(smsMissingEnv()).toEqual(["TWILIO_AUTH_TOKEN"]);
    });
  });

  it("fully set env is configured; the status never leaks the auth token", async () => {
    await withTwilioEnv({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret-token", TWILIO_FROM_NUMBER: "+15550001111" }, async () => {
      expect(smsConfigured()).toBe(true);
      const s = smsStatus();
      expect(s.configured).toBe(true);
      expect(s.missing).toEqual([]);
      expect(s.fromNumber).toBe("+15550001111");
      expect(JSON.stringify(s)).not.toContain("secret-token");
    });
  });
});

describe("normalizePhone (pure)", () => {
  it("accepts E.164 and bare US numbers, rejects junk", () => {
    expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+442071234567")).toBe("+442071234567");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("twilio provider payload shape (mocked fetch)", () => {
  it("POSTs From/To/Body to Accounts/{SID}/Messages.json with basic auth", async () => {
    await withTwilioEnv(
      { TWILIO_ACCOUNT_SID: "ACtest123", TWILIO_AUTH_TOKEN: "tok-xyz", TWILIO_FROM_NUMBER: "+15550001111" },
      async () => {
        const calls: { url: string; init: any }[] = [];
        vi.stubGlobal("fetch", async (url: any, init: any) => {
          calls.push({ url: String(url), init });
          return { ok: true, status: 201, json: async () => ({ sid: "SMabc123" }) };
        });

        const r = await sendSms("+15551234567", "your estimate is waiting");
        expect(r).toEqual({ ok: true, provider: "twilio", sid: "SMabc123" });

        expect(calls).toHaveLength(1);
        const { url, init } = calls[0];
        expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("ACtest123:tok-xyz").toString("base64")}`);
        expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
        const params = new URLSearchParams(init.body);
        expect(params.get("From")).toBe("+15550001111");
        expect(params.get("To")).toBe("+15551234567");
        expect(params.get("Body")).toBe("your estimate is waiting");
      },
    );
  });

  it("a Twilio rejection comes back as ok:false with the message — never throws", async () => {
    await withTwilioEnv(
      { TWILIO_ACCOUNT_SID: "ACtest123", TWILIO_AUTH_TOKEN: "tok-xyz", TWILIO_FROM_NUMBER: "+15550001111" },
      async () => {
        vi.stubGlobal("fetch", async () => ({
          ok: false, status: 400, json: async () => ({ message: "The 'To' number is not a valid phone number." }),
        }));
        const r = await sendSms("+1555", "hi");
        expect(r.ok).toBe(false);
        expect(r.provider).toBe("twilio");
        expect(r.error).toContain("not a valid phone number");
      },
    );
  });
});

describe("log provider (the unconfigured seam)", () => {
  it("records to the outbox instead of sending and names itself 'log'", async () => {
    const outbox = path.join(process.cwd(), "tmp", `sms-test-${Date.now()}.jsonl`);
    await withTwilioEnv({}, async () => {
      const savedPath = process.env.SMS_OUTBOX_PATH;
      process.env.SMS_OUTBOX_PATH = outbox;
      try {
        const r = await sendSms("+15551234567", "recorded, not sent");
        expect(r).toEqual({ ok: true, provider: "log", sid: null });
        const lines = fs.readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(lines.at(-1)).toMatchObject({ provider: "log", to: "+15551234567", body: "recorded, not sent" });
      } finally {
        if (savedPath === undefined) delete process.env.SMS_OUTBOX_PATH;
        else process.env.SMS_OUTBOX_PATH = savedPath;
        fs.rmSync(outbox, { force: true });
      }
    });
  });
});

describe("reengagement day key (pure)", () => {
  it("is the UTC date — the once-per-day idempotency unit", () => {
    expect(reengagementDayKey(new Date("2026-08-01T23:59:59Z"))).toBe("2026-08-01");
    expect(reengagementDayKey(new Date("2026-08-01T00:00:01Z"))).toBe("2026-08-01");
  });
});

// ── Part 2: against the dev server ──────────────────────────────────────────

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function clientCookie(customerId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify([customerId])],
  );
  return `crm_client=${raw}`;
}

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
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

const getMarker = async (estimateId: string) =>
  (await pool.query(`select custom_fields->'reengagementAlerts' as m from crm_estimates where id = $1`, [estimateId]))
    .rows[0]?.m ?? null;

describe("reminders + reengagement alerts against the dev server", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
  });

  async function makeSentEstimate() {
    const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: `Vitest SMS ${run}`,
        email: `vitest.sms.${run}@example.com`,
        // Unique per customer — the CRM refuses duplicate phones (409).
        phone: `+1 555 ${String(Math.floor(1000000 + Math.random() * 8999999))}`,
      }),
    }, cookie);
    expect(cust.status).toBe(201);
    const est = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.body.id, title: "Vitest SMS estimate",
        items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 42000 }],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    const send = await api(`/api/crm/estimates/${est.body.id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    return { est: est.body, customerId: cust.body.id as string, token: send.body.link.split("/e/")[1].split("?")[0] as string };
  }

  it("sms status is honestly not-configured on the dev server (no Twilio env)", async () => {
    const r = await api("/api/crm/sms/status", {}, cookie);
    expect(r.status).toBe(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.missing).toEqual(expect.arrayContaining(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]));
    // …and the test-send refuses rather than pretending.
    const t = await api("/api/crm/sms/test", { method: "POST", body: JSON.stringify({ to: "+15551234567" }) }, cookie);
    expect(t.status).toBe(503);
  });

  it("reminder emails + texts the client and records who/when/channel — merged, never clobbered", async () => {
    const { est } = await makeSentEstimate();

    const r1 = await api(`/api/crm/estimates/${est.id}/remind`, { method: "POST", body: "{}" }, cookie);
    expect(r1.status).toBe(200);
    expect(r1.body.emailed).toBe(true);
    expect(r1.body.texted).toBe(true);
    // Twilio is unconfigured on the dev server → the recording log provider.
    expect(r1.body.smsProvider).toBe("log");
    expect(r1.body.reminders).toHaveLength(1);
    expect(r1.body.reminders[0].channel).toBe("email+sms");
    expect(r1.body.reminders[0].by).toBeTruthy();
    expect(r1.body.reminders[0].at).toBeTruthy();

    const r2 = await api(`/api/crm/estimates/${est.id}/remind`, { method: "POST", body: "{}" }, cookie);
    expect(r2.status).toBe(200);
    expect(r2.body.reminders).toHaveLength(2);
    expect(r2.body.reminders[0].at).toBe(r1.body.reminders[0].at); // first record intact

    // The DB row agrees — and unrelated custom_fields keys would survive too.
    const { rows } = await pool.query(`select custom_fields from crm_estimates where id = $1`, [est.id]);
    expect(rows[0].custom_fields.reminders).toHaveLength(2);
  });

  it("reminder is refused for drafts and answered estimates", async () => {
    const run = `${Date.now()}`;
    const cust = await api("/api/crm/customers", {
      method: "POST", body: JSON.stringify({ displayName: `Vitest SMS Draft ${run}`, email: `vitest.sms.d.${run}@example.com` }),
    }, cookie);
    const draft = await api("/api/crm/estimates", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.body.id, title: "Draft",
        items: [{ kind: "labor", name: "Line", quantityMilli: 1000, unitPriceCents: 100 }],
      }),
    }, cookie);
    const r = await api(`/api/crm/estimates/${draft.body.id}/remind`, { method: "POST", body: "{}" }, cookie);
    expect(r.status).toBe(409);
  });

  it("alert fires on the 2nd distinct session — not the 1st — and only once per day", async () => {
    const { est, customerId, token } = await makeSentEstimate();

    // Give the alert target (the estimate's creator) a mobile so the SMS leg
    // is exercised; restore whatever was there before.
    const priorPhone = (await pool.query(
      `select phone from crm_members where id = (select created_by_member_id from crm_estimates where id = $1)`, [est.id],
    )).rows[0]?.phone ?? null;
    await pool.query(
      `update crm_members set phone = '+15550100001' where id = (select created_by_member_id from crm_estimates where id = $1)`, [est.id],
    );

    try {
      const client = await clientCookie(customerId);

      // First gated open + first session: no alert (that's the "opened" mail).
      const g1 = await api(`/api/public/estimates/${token}`, {}, client);
      expect(g1.status).toBe(200);
      const s1 = await api("/api/public/engagement/start", {
        method: "POST", body: JSON.stringify({ docType: "estimate", token }),
      }, client);
      expect(s1.body.sessionId).toBeTruthy();
      await sleep(800);
      expect(await getMarker(est.id)).toBeNull();

      // Second distinct session → the client is back → the alert fires.
      const s2 = await api("/api/public/engagement/start", {
        method: "POST", body: JSON.stringify({ docType: "estimate", token }),
      }, client);
      expect(s2.body.sessionId).toBeTruthy();
      const marker = await poll(() => getMarker(est.id), (m) => !!m);
      expect(marker).toBeTruthy();
      expect(marker.lastDay).toBe(reengagementDayKey());
      expect(marker.count).toBe(1);
      expect(marker.textedTo).toBe("+15550100001");
      expect(marker.smsProvider).toBe("log"); // Twilio unconfigured → recorded

      // The email attempt landed in the dev outbox.
      const outbox = fs.readFileSync(path.join(process.cwd(), "tmp", "email-outbox.jsonl"), "utf8");
      expect(outbox).toContain("is reviewing estimate");

      // Once per day: a third session and another gated open stay quiet.
      await api("/api/public/engagement/start", {
        method: "POST", body: JSON.stringify({ docType: "estimate", token }),
      }, client);
      await api(`/api/public/estimates/${token}`, {}, client);
      await sleep(1200);
      expect((await getMarker(est.id)).count).toBe(1);
    } finally {
      await pool.query(
        `update crm_members set phone = $2 where id = (select created_by_member_id from crm_estimates where id = $1)`,
        [est.id, priorPhone],
      );
    }
  });

  it("clientReengaged pref OFF silences the alert entirely", async () => {
    const org = await api("/api/crm/org", {}, cookie);
    expect(org.status).toBe(200);
    const prior = org.body.customFields?.notificationPrefs?.clientReengaged;

    const off = await api("/api/crm/org", {
      method: "PATCH", body: JSON.stringify({ notificationPrefs: { clientReengaged: false } }),
    }, cookie);
    expect(off.status).toBe(200);

    try {
      const { est, customerId, token } = await makeSentEstimate();
      const client = await clientCookie(customerId);
      await api(`/api/public/estimates/${token}`, {}, client);
      await api("/api/public/engagement/start", {
        method: "POST", body: JSON.stringify({ docType: "estimate", token }),
      }, client);
      await api("/api/public/engagement/start", {
        method: "POST", body: JSON.stringify({ docType: "estimate", token }),
      }, client);
      await sleep(1500); // long enough that a firing alert would have landed
      expect(await getMarker(est.id)).toBeNull();
    } finally {
      await api("/api/crm/org", {
        method: "PATCH", body: JSON.stringify({ notificationPrefs: { clientReengaged: prior ?? true } }),
      }, cookie);
    }
  });
});
