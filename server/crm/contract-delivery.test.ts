/**
 * Signed-contract delivery on estimate approval (dev-server integration).
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 *
 * Approving a gated estimate must mint a crm_attachments row (kind='contract',
 * refId = estimate id) whose bytes are a real PDF, record the delivery
 * attempt on the estimate's events trail (client copy always, admin copy
 * gated by the org's 'contractSigned' notificationPref — default ON), and
 * expose the PDF through the session-gated client download route. SMTP
 * itself is best-effort in dev; the events row is the durable proof of who
 * the contract was sent to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: { ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

/** Insert a client session row as a redeemed magic link would; returns the RAW cookie token. */
async function makeClientSession(customerIds: string[]): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await q(
    `insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at)
     values ($1, $2::jsonb, now() + interval '30 days', now())`,
    [sha256(raw), JSON.stringify(customerIds)],
  );
  return raw;
}

/** Poll until the async contract pipeline has produced the value. */
async function waitFor<T>(fn: () => Promise<T | null | undefined>, tries = 24): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timed out waiting for the contract pipeline");
}

describe("signed contract on approval (dev server)", () => {
  let cookie: string | undefined;
  let orgId: string;
  let custId: string;
  let custEmail: string;
  let otherCustId: string;
  const estimateIds: string[] = [];
  const attachmentIds: string[] = [];

  async function makeEstimate(): Promise<{ id: string; token: string }> {
    const est = await api("/api/crm/estimates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: custId,
        title: "Vitest contract estimate",
        taxRateBps: 1000,
        items: [
          { kind: "labor", name: "Contract line", description: "Full scope of work", quantityMilli: 1000, unitPriceCents: 100_00, taxable: true, hiddenFromClient: false, sortOrder: 0 },
        ],
      }),
    }, cookie);
    expect(est.status).toBe(201);
    estimateIds.push(est.body.id);
    const rows = await q<{ public_token: string }>(
      `select public_token from crm_estimates where id = $1`, [est.body.id]);
    return { id: est.body.id, token: rows[0].public_token };
  }

  async function approve(token: string, raw: string) {
    const r = await api(`/api/public/estimates/${token}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", signatureName: "Mary Homeowner" }),
    }, `crm_client=${raw}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("approved");
  }

  /** Atomically set/clear the org's contractSigned pref — jsonb_set/#- never
   *  clobber sibling keys, so parallel tests patching other prefs are safe. */
  const setContractSignedPref = (on: boolean | null) =>
    on === null
      ? q(`update crm_orgs set custom_fields = coalesce(custom_fields,'{}'::jsonb) #- '{notificationPrefs,contractSigned}' where id = $1`, [orgId])
      : q(`update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields,'{}'::jsonb), '{notificationPrefs,contractSigned}', $2::jsonb, true) where id = $1`, [orgId, JSON.stringify(on)]);

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    custEmail = `vitest.contract.${stamp}@example.com`;
    const mk = async (name: string, email: string) => {
      const r = await api("/api/crm/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name, email }),
      }, cookie);
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    custId = await mk("Vitest Contract A", custEmail);
    otherCustId = await mk("Vitest Contract B", `vitest.contract.${stamp}.b@example.com`);
  });

  afterAll(async () => {
    await setContractSignedPref(null); // leave the org exactly as found
    await q(`delete from crm_attachments where id = any($1)`, [attachmentIds]);
    await q(`delete from crm_estimate_events where estimate_id = any($1)`, [estimateIds]);
    await q(`delete from crm_estimate_items where estimate_id = any($1)`, [estimateIds]);
    await q(`delete from crm_estimates where id = any($1)`, [estimateIds]);
    await q(
      `delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%' or customer_ids::text like '%' || $2 || '%'`,
      [custId, otherCustId],
    );
    await q(`delete from crm_customers where id = any($1)`, [[custId, otherCustId]]);
    await pool.end();
  });

  it("approval mints a real PDF attachment, records the delivery, and the portal can download it", async () => {
    const { id: estimateId, token } = await makeEstimate();
    const raw = await makeClientSession([custId]);
    await approve(token, raw);

    // The stored contract: a kind='contract' attachment whose bytes are a PDF.
    const att = await waitFor(async () => {
      const rows = await q<any>(
        `select id, file_name, mime, size_bytes, storage_path from crm_attachments
         where kind = 'contract' and ref_id = $1`, [estimateId]);
      return rows[0] ?? null;
    });
    attachmentIds.push(att.id);
    expect(att.mime).toBe("application/pdf");
    expect(att.file_name).toMatch(/^contract-.*\.pdf$/);
    const abs = path.join(process.cwd(), "tmp", "crm-attachments", att.storage_path);
    const bytes = fs.readFileSync(abs);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBe(att.size_bytes);
    expect(bytes.length).toBeGreaterThan(1000);

    // The events trail proves who the contract was emailed to: the CLIENT
    // always, the admin because the org's contractSigned pref defaults ON.
    const ev = await waitFor(async () => {
      const rows = await q<any>(
        `select meta from crm_estimate_events where estimate_id = $1 and type = 'contract_emailed'`, [estimateId]);
      return rows[0]?.meta ?? null;
    });
    expect(ev.attachmentId).toBe(att.id);
    expect(ev.clientTo).toEqual([custEmail]);
    expect(ev.adminTo.length).toBeGreaterThan(0);
    expect(ev.adminSkipped).toBe(false);
    // The approved total rides the contract ($100 + 10% tax).
    expect(ev.totalCents).toBe(110_00);

    // The portal payload links the PDF by estimate id…
    const list = await api("/api/client/contracts", {}, `crm_client=${raw}`);
    expect(list.status).toBe(200);
    const entry = list.body.contracts.find((c: any) => c.estimateId === estimateId);
    expect(entry).toBeTruthy();
    expect(entry.downloadUrl).toBe(`/api/client/attachments/${att.id}/download`);

    // …and the gated download streams the same PDF bytes.
    const dl = await fetch(`${BASE}${entry.downloadUrl}`, { headers: { cookie: `crm_client=${raw}` } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await dl.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // Anonymous browsers and OTHER customers are shut out (401 / 404).
    const anon = await fetch(`${BASE}${entry.downloadUrl}`);
    expect(anon.status).toBe(401);
    const otherRaw = await makeClientSession([otherCustId]);
    const steal = await fetch(`${BASE}${entry.downloadUrl}`, { headers: { cookie: `crm_client=${otherRaw}` } });
    expect(steal.status).toBe(404);
    const otherList = await api("/api/client/contracts", {}, `crm_client=${otherRaw}`);
    expect(otherList.body.contracts.find((c: any) => c.estimateId === estimateId)).toBeUndefined();
  });

  it("contractSigned pref OFF silences only the admin copy — the client copy still goes", async () => {
    await setContractSignedPref(false);
    try {
      const { id: estimateId, token } = await makeEstimate();
      const raw = await makeClientSession([custId]);
      await approve(token, raw);

      // The PDF is still generated and stored…
      const att = await waitFor(async () => {
        const rows = await q<any>(
          `select id from crm_attachments where kind = 'contract' and ref_id = $1`, [estimateId]);
        return rows[0] ?? null;
      });
      attachmentIds.push(att.id);

      // …but the delivery event shows the admin copy was skipped by the pref
      // while the client copy was attempted as always.
      const ev = await waitFor(async () => {
        const rows = await q<any>(
          `select meta from crm_estimate_events where estimate_id = $1 and type = 'contract_emailed'`, [estimateId]);
        return rows[0]?.meta ?? null;
      });
      expect(ev.clientTo).toEqual([custEmail]);
      expect(ev.adminTo).toEqual([]);
      expect(ev.adminSkipped).toBe(true);
    } finally {
      await setContractSignedPref(null);
    }
  });
});
