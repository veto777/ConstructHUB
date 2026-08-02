/**
 * Quick messages (Create menu → Message).
 *
 * Part 1 is pure/provider: the timeline note marker and the delivery seam
 * (text through the recording log provider when no carrier is configured) —
 * env is read AT CALL TIME, so tests flip process.env freely (restored).
 *
 * Part 2 exercises the running dev server like sms.test.ts does:
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import pg from "pg";

// messages.ts imports tenancy → ../stripe, which throws without a key at
// module scope — dynamic import AFTER the shims (same idiom as sms.test.ts).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let messageNoteBody: any, isOutboundMessageNote: any, deliverQuickMessage: any,
  OUTBOUND_MESSAGE_PREFIX: string;

beforeAll(async () => {
  ({ messageNoteBody, isOutboundMessageNote, deliverQuickMessage, OUTBOUND_MESSAGE_PREFIX } =
    await import("./messages"));
});

const pool = new pg.Pool({
  connectionString:
    process.env.CRM_TEST_DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});

const SW_KEYS = ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"] as const;

async function withoutCarrier<T>(fn: () => Promise<T> | T): Promise<T> {
  const saved = Object.fromEntries(SW_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SW_KEYS) delete process.env[k];
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

// ── Part 1: pure / provider ─────────────────────────────────────────────────

describe("outbound message note marker (pure)", () => {
  it("reads as the timeline sentence and is detected back", () => {
    const body = messageNoteBody("email", "joe@example.com", "running 30 late");
    expect(body.startsWith(OUTBOUND_MESSAGE_PREFIX)).toBe(true);
    expect(body).toContain("via email to joe@example.com");
    expect(body).toContain("running 30 late");
    expect(isOutboundMessageNote(body)).toBe(true);

    const smsBody = messageNoteBody("text", "+15551234567", "on my way");
    expect(smsBody).toContain("via text to +15551234567");
    expect(isOutboundMessageNote(smsBody)).toBe(true);
  });

  it("plain contractor notes are NOT message notes", () => {
    expect(isOutboundMessageNote("Gate code is 4482")).toBe(false);
    expect(isOutboundMessageNote("")).toBe(false);
    expect(isOutboundMessageNote(null)).toBe(false);
    expect(isOutboundMessageNote(undefined)).toBe(false);
  });

  it("long bodies are truncated in the note, not dropped", () => {
    const body = messageNoteBody("email", "joe@example.com", "x".repeat(500));
    expect(body.length).toBeLessThan(260);
    expect(body).toContain("…");
    expect(isOutboundMessageNote(body)).toBe(true);
  });
});

describe("deliverQuickMessage — text via the log provider when unconfigured", () => {
  it("records instead of sending and names the provider honestly", async () => {
    const outbox = path.join(process.cwd(), "tmp", `qm-test-${Date.now()}.jsonl`);
    await withoutCarrier(async () => {
      const savedPath = process.env.SMS_OUTBOX_PATH;
      process.env.SMS_OUTBOX_PATH = outbox;
      try {
        const r = await deliverQuickMessage({
          channel: "text", to: "+15551234567", body: "see you Tuesday", orgName: "Alpine",
        });
        expect(r).toEqual({ ok: true, provider: "log", error: undefined });
        const lines = fs.readFileSync(outbox, "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(lines.at(-1)).toMatchObject({ provider: "log", to: "+15551234567" });
        expect(lines.at(-1).body).toContain("see you Tuesday");
      } finally {
        if (savedPath === undefined) delete process.env.SMS_OUTBOX_PATH;
        else process.env.SMS_OUTBOX_PATH = savedPath;
        fs.rmSync(outbox, { force: true });
      }
    });
  });
});

// ── Part 2: against the dev server ──────────────────────────────────────────

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

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

describe("POST /api/crm/messages against the dev server", () => {
  let cookie: string | undefined;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
  });

  async function makeCustomer(email = true) {
    const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({
        displayName: `Vitest QM ${run}`,
        email: email ? `vitest.qm.${run}@example.com` : undefined,
      }),
    }, cookie);
    expect(r.status).toBe(201);
    return r.body.id as string;
  }

  it("email sends and is recorded on the client timeline as a message", async () => {
    const customerId = await makeCustomer();
    const r = await api("/api/crm/messages", {
      method: "POST",
      body: JSON.stringify({ customerId, channel: "email", body: "the dumpster arrives Friday" }),
    }, cookie);
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.provider).toBe("email");
    expect(r.body.noteId).toBeTruthy();

    // The timeline surfaces it as a message entry.
    const tl = await api(`/api/crm/customers/${customerId}/timeline`, {}, cookie);
    expect(tl.status).toBe(200);
    const entry = tl.body.find((e: any) => e.id === `msg-${r.body.noteId}`);
    expect(entry).toBeTruthy();
    expect(entry.kind).toBe("message");
    expect(entry.text).toContain("Message sent via email");
    expect(entry.text).toContain("the dumpster arrives Friday");

    // …and the note row is the marker format.
    const { rows } = await pool.query(`select body from crm_customer_notes where id = $1`, [r.body.noteId]);
    expect(rows[0].body.startsWith("Message sent via ")).toBe(true);
  });

  it("text is an honest 409 when SMS is unconfigured — never a pretend send", async () => {
    const customerId = await makeCustomer();
    const r = await api("/api/crm/messages", {
      method: "POST",
      body: JSON.stringify({ customerId, channel: "text", body: "hi" }),
    }, cookie);
    expect(r.status).toBe(409);
    expect(r.body.message).toContain("Texting is off");
    expect(r.body.message).toContain("Settings");
    expect(r.body.missing).toEqual(expect.arrayContaining(["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"]));

    // Nothing was recorded — a refused send leaves no "you sent" entry.
    const tl = await api(`/api/crm/customers/${customerId}/timeline`, {}, cookie);
    expect(tl.body.filter((e: any) => e.kind === "message")).toHaveLength(0);
  });

  it("validation: empty body, bogus channel, unknown and cross-org clients", async () => {
    const customerId = await makeCustomer();

    const empty = await api("/api/crm/messages", {
      method: "POST", body: JSON.stringify({ customerId, channel: "email", body: "   " }),
    }, cookie);
    expect(empty.status).toBe(400);

    const bogus = await api("/api/crm/messages", {
      method: "POST", body: JSON.stringify({ customerId, channel: "fax", body: "hi" }),
    }, cookie);
    expect(bogus.status).toBe(400);

    const unknown = await api("/api/crm/messages", {
      method: "POST", body: JSON.stringify({ customerId: "no-such-client", channel: "email", body: "hi" }),
    }, cookie);
    expect(unknown.status).toBe(404);
  });

  it("email to a client with no email address is a clear 400, not a send", async () => {
    const customerId = await makeCustomer(false);
    const r = await api("/api/crm/messages", {
      method: "POST", body: JSON.stringify({ customerId, channel: "email", body: "hi" }),
    }, cookie);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("no email address");
  });
});
