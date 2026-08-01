/**
 * Team access administration: invitation resend, set-your-own-password for
 * accountless members, and invite revocation on member disable.
 *
 * Runs against the running dev server (same trick as admin.test.ts): the
 * dev-bypass user is the org owner, so manageTeam-gated routes answer. The
 * owner's account is beta-flagged for the run so seat limits never interfere;
 * the flag is restored in afterAll. Throwaway emails per run; everything
 * created is deleted again. Local throwaway dev DB only.
 *
 * Pinned behaviours:
 *   1. Resend rotates the token (old link dies), extends the expiry to 14
 *      days out, and reports an `emailed` flag — false with broken SMTP is a
 *      valid outcome, never an error.
 *   2. send-password-reset creates a users row (null password_hash) for a
 *      member who has none, mints a 1h reset token, and the member can then
 *      complete the standard reset + login round-trip themselves.
 *   3. Disabling a member also revokes their pending invitations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: any[] = []) => pool.query(text, params);

const stamp = Date.now().toString(36);
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
  // Unlimited seats for the run so the plan limit can't 402 a test invite.
  const { rows } = await q(`select beta_at from users where id = 1`);
  betaAtBefore = rows[0]?.beta_at ?? null;
  await q(`update users set beta_at = now() where id = 1`);
});

afterAll(async () => {
  await q(`update users set beta_at = $1 where id = 1`, [betaAtBefore]);
  await pool.end();
});

async function createInvite(email: string) {
  const r = await post("/api/crm/invitations", { email, role: "field" });
  expect(r.status, "invite created").toBe(201);
  return r.json();
}

async function cleanup(email: string) {
  await q(`delete from crm_invitations where email = $1`, [email]);
  await q(`delete from crm_members where email = $1`, [email]);
  await q(`delete from users where email = $1`, [email]);
}

describe("invitation resend", () => {
  it("rotates the token, extends the expiry and reports the emailed flag", async () => {
    const email = `vt-resend-${stamp}@example.com`;
    try {
      const { invitation } = await createInvite(email);
      const { rows: before } = await q(`select token, expires_at from crm_invitations where id = $1`, [invitation.id]);
      expect(before.length).toBe(1);

      // Age the invite so an "extension" is measurable, not just a rewrite.
      await q(`update crm_invitations set expires_at = now() - interval '1 day' where id = $1`, [invitation.id]);

      const r = await post(`/api/crm/invitations/${invitation.id}/resend`, {});
      expect(r.status).toBe(200);
      const body = await r.json();
      // Broken SMTP in dev is fine — the flag must be there either way, and
      // the fresh link is returned for copy-to-clipboard.
      expect(typeof body.emailed).toBe("boolean");
      const newToken = new URL(body.link).searchParams.get("token");
      expect(newToken).toBeTruthy();
      expect(newToken).not.toBe(before[0].token);
      expect(body.invitation.token).toBeUndefined();

      const { rows: after } = await q(`select token, expires_at from crm_invitations where id = $1`, [invitation.id]);
      expect(after[0].token).toBe(newToken);
      const expiresIn = new Date(after[0].expires_at).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
      expect(expiresIn).toBeLessThan(15 * 24 * 60 * 60 * 1000);

      // The rotated-out token is dead for the public lookup.
      const stale = await fetch(`${BASE}/api/crm/invitations/lookup/${before[0].token}`);
      expect(stale.status).toBe(404);
    } finally {
      await cleanup(email);
    }
  });

  it("404s an unknown id and a revoked invitation, 409s an accepted one", async () => {
    const email = `vt-resend2-${stamp}@example.com`;
    try {
      const missing = await post(`/api/crm/invitations/00000000-0000-0000-0000-000000000000/resend`, {});
      expect(missing.status).toBe(404);

      const { invitation } = await createInvite(email);
      await q(`update crm_invitations set revoked_at = now() where id = $1`, [invitation.id]);
      const revoked = await post(`/api/crm/invitations/${invitation.id}/resend`, {});
      expect(revoked.status).toBe(404);

      await q(`update crm_invitations set revoked_at = null, accepted_at = now() where id = $1`, [invitation.id]);
      const accepted = await post(`/api/crm/invitations/${invitation.id}/resend`, {});
      expect(accepted.status).toBe(409);
    } finally {
      await cleanup(email);
    }
  });
});

describe("member send-password-reset", () => {
  it("creates the account, mints a token, and the member sets their own password", async () => {
    const email = `vt-reset-${stamp}@example.com`;
    const password = "member-chose-this-1";
    try {
      await createInvite(email);
      const { rows: members } = await q(`select id, status from crm_members where email = $1`, [email]);
      expect(members.length).toBe(1);
      expect(members[0].status).toBe("invited");
      // Accountless: no users row may exist beforehand.
      expect((await q(`select id from users where email = $1`, [email])).rows.length).toBe(0);

      const r = await post(`/api/crm/members/${members[0].id}/send-password-reset`, {});
      expect(r.status).toBe(200);
      const { emailed } = await r.json();
      expect(typeof emailed).toBe("boolean");

      const { rows: accounts } = await q(
        `select id, password_hash, reset_token, reset_expiry, email_verified from users where email = $1`,
        [email],
      );
      expect(accounts.length).toBe(1);
      // The whole point: no server-generated password, ever.
      expect(accounts[0].password_hash).toBeNull();
      expect(accounts[0].reset_token).toBeTruthy();
      expect(new Date(accounts[0].reset_expiry).getTime() - Date.now()).toBeGreaterThan(30 * 60 * 1000);

      // Full round-trip: the member sets their OWN password via the standard
      // reset route, then logs in with it.
      const reset = await post("/api/auth/reset-password", { token: accounts[0].reset_token, password });
      expect(reset.status).toBe(200);
      const { rows: afterReset } = await q(
        `select password_hash, reset_token, email_verified from users where email = $1`,
        [email],
      );
      expect(afterReset[0].password_hash).toBeTruthy();
      expect(afterReset[0].reset_token).toBeNull();
      expect(afterReset[0].email_verified).toBe(true);

      const login = await post("/api/auth/login", { email, password });
      expect(login.status).toBe(200);
      expect((await login.json()).email).toBe(email);
    } finally {
      await cleanup(email);
    }
  });

  it("reuses an existing passwordless users row instead of duplicating it", async () => {
    const email = `vt-reset2-${stamp}@example.com`;
    try {
      await q(`insert into users (email, email_verified) values ($1, false)`, [email]);
      await createInvite(email);
      const { rows: members } = await q(`select id from crm_members where email = $1`, [email]);
      const { rows: beforeRows } = await q(`select id from users where email = $1`, [email]);

      const r = await post(`/api/crm/members/${members[0].id}/send-password-reset`, {});
      expect(r.status).toBe(200);

      const { rows: afterRows } = await q(`select id, reset_token from users where email = $1`, [email]);
      expect(afterRows.length).toBe(1);
      expect(afterRows[0].id).toBe(beforeRows[0].id);
      expect(afterRows[0].reset_token).toBeTruthy();
    } finally {
      await cleanup(email);
    }
  });

  it("404s a member outside the org / unknown id", async () => {
    const r = await post(`/api/crm/members/00000000-0000-0000-0000-000000000000/send-password-reset`, {});
    expect(r.status).toBe(404);
  });
});

describe("disabling a member", () => {
  it("also revokes their pending invitations", async () => {
    const email = `vt-disable-${stamp}@example.com`;
    try {
      await createInvite(email);
      const { rows: members } = await q(`select id from crm_members where email = $1`, [email]);
      expect(members.length).toBe(1);

      const r = await fetch(`${BASE}/api/crm/members/${members[0].id}`, { method: "DELETE" });
      expect(r.status).toBe(200);
      expect((await r.json()).status).toBe("disabled");

      const { rows: invites } = await q(`select revoked_at from crm_invitations where email = $1`, [email]);
      expect(invites.length).toBe(1);
      expect(invites[0].revoked_at).toBeTruthy();
    } finally {
      await cleanup(email);
    }
  });
});
