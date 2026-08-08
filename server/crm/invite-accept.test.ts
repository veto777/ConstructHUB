/**
 * Invitation accept hardening: email binding, phone sanity, atomic claim.
 *
 * Same running-dev-server trick as team-admin.test.ts: DEV_AUTH_BYPASS_USER1
 * authenticates every request as the org owner (user 1), so the suite
 * temporarily rewrites user 1's email to bind it to a throwaway invite — the
 * real email is always restored, and ALWAYS before cleanup() runs (cleanup
 * deletes users by email; running it while user 1 wears a throwaway email
 * would delete the owner). Throwaway emails per run; everything created is
 * deleted again. Local throwaway dev DB only.
 *
 * Pinned behaviours:
 *   1. Accept requires the account email to be present AND to match the
 *      invite: a mismatch is 403, and so is an account with no email at all
 *      (previously the check was skipped for falsy emails).
 *   2. All-same-digit phone numbers ("0000000") are 400, and a rejected
 *      accept never consumes the invite.
 *   3. The claim is atomic: a sequential second accept is 409, and two
 *      concurrent accepts yield exactly one 200 and one clean 409 — never a
 *      500 from the member upsert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: any[] = []) => pool.query(text, params);

const stamp = Date.now().toString(36);
let ownerEmail: string | null = null;
let betaAtBefore: any = null;

const post = (path: string, body: any) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  // The suite needs the dev server up; fail with a clear message otherwise.
  const r = await fetch(`${BASE}/api/crm/me`);
  expect(r.status, "dev server reachable").toBe(200);
  const { rows } = await q(`select email, beta_at from users where id = 1`);
  ownerEmail = rows[0]?.email ?? null;
  betaAtBefore = rows[0]?.beta_at ?? null;
  // Unlimited seats for the run so the plan limit can't 402 a test invite.
  await q(`update users set beta_at = now() where id = 1`);
});

afterAll(async () => {
  await q(`update users set email = $1, beta_at = $2 where id = 1`, [ownerEmail, betaAtBefore]);
  await pool.end();
});

const setOwnerEmail = (email: string) => q(`update users set email = $1 where id = 1`, [email]);

async function createInvite(email: string) {
  const r = await post("/api/crm/invitations", { email, role: "field" });
  expect(r.status, "invite created").toBe(201);
  return r.json();
}

async function tokenOf(inviteId: string) {
  const { rows } = await q(`select token from crm_invitations where id = $1`, [inviteId]);
  return rows[0].token as string;
}

async function acceptedAt(inviteId: string) {
  const { rows } = await q(`select accepted_at from crm_invitations where id = $1`, [inviteId]);
  return rows[0]?.accepted_at;
}

async function cleanup(email: string) {
  await q(`delete from crm_invitations where email = $1`, [email]);
  await q(`delete from crm_members where email = $1`, [email]);
  await q(`delete from users where email = $1`, [email]);
}

describe("invite accept email binding", () => {
  it("403s when the account email differs from the invite email", async () => {
    const email = `va-mismatch-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      // The dev-bypass account keeps its own (different) email here.
      const r = await post("/api/crm/invitations/accept", {
        token: await tokenOf(invitation.id),
        phone: "5551234567",
      });
      expect(r.status).toBe(403);
      expect(await acceptedAt(invitation.id)).toBeNull();
    } finally {
      await cleanup(email);
    }
  });

  it("403s when the account has no email at all", async () => {
    const email = `va-noemail-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      const token = await tokenOf(invitation.id);
      await setOwnerEmail("");
      const r = await post("/api/crm/invitations/accept", { token, phone: "5551234567" });
      expect(r.status).toBe(403);
      expect(await acceptedAt(invitation.id)).toBeNull();
    } finally {
      await setOwnerEmail(ownerEmail!);
      await cleanup(email);
    }
  });
});

describe("invite accept phone check", () => {
  it("400s an all-same-digit phone and leaves the invite unclaimed", async () => {
    const email = `va-phone-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      const token = await tokenOf(invitation.id);
      await setOwnerEmail(email);
      const r = await post("/api/crm/invitations/accept", { token, phone: "0000000" });
      expect(r.status).toBe(400);
      expect(await acceptedAt(invitation.id)).toBeNull();
    } finally {
      await setOwnerEmail(ownerEmail!);
      await cleanup(email);
    }
  });
});

describe("invite accept atomic claim", () => {
  it("accepts once, then 409s a sequential second accept", async () => {
    const email = `va-seq-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      const token = await tokenOf(invitation.id);
      await setOwnerEmail(email);

      const first = await post("/api/crm/invitations/accept", { token, phone: "5551234567" });
      expect(first.status).toBe(200);
      const second = await post("/api/crm/invitations/accept", { token, phone: "5551234567" });
      expect(second.status).toBe(409);

      const { rows } = await q(`select user_id, status from crm_members where email = $1`, [email]);
      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(1);
      expect(rows[0].status).toBe("active");
    } finally {
      await setOwnerEmail(ownerEmail!);
      await cleanup(email);
    }
  });

  it("a concurrent double-accept yields exactly one 200 and one clean 409", async () => {
    const email = `va-race-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      const token = await tokenOf(invitation.id);
      await setOwnerEmail(email);

      const [a, b] = await Promise.all([
        post("/api/crm/invitations/accept", { token, phone: "5551234567" }),
        post("/api/crm/invitations/accept", { token, phone: "5551234567" }),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 409]);

      const { rows } = await q(`select id from crm_members where email = $1`, [email]);
      expect(rows.length).toBe(1);
    } finally {
      await setOwnerEmail(ownerEmail!);
      await cleanup(email);
    }
  });
});
