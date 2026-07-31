/**
 * Platform admin + beta invites.
 *
 * Runs against the running dev server (same trick as divisions.test.ts): the
 * dev-bypass user is a platform admin in dev, so the non-admin gate is
 * exercised by temporarily pointing user 1's email at a non-admin address and
 * restoring it in a finally block. Local throwaway dev DB only.
 *
 * Pinned behaviours:
 *   1. Every /api/admin/* route 403s a non-admin — the gate is the platform
 *      email list, never org membership.
 *   2. A beta token is single-use, email-bound and expires; a bad token never
 *      blocks the signup itself.
 *   3. An org whose owner is beta-flagged reports unlimited seats and a real
 *      invitation that would 402 any free-plan org sails through.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = (text: string, params: any[] = []) => pool.query(text, params);

const DEV_EMAIL = "dev@constructhub.local";
const stamp = Date.now().toString(36);

beforeAll(async () => {
  // The suite needs the dev server up; fail with a clear message otherwise.
  const r = await fetch(`${BASE}/api/crm/me`);
  expect(r.status, "dev server reachable on :8119").toBe(200);
});

async function withDevEmail<T>(email: string, fn: () => Promise<T>): Promise<T> {
  await q(`update users set email = $1 where id = 1`, [email]);
  try {
    return await fn();
  } finally {
    await q(`update users set email = $1 where id = 1`, [DEV_EMAIL]);
  }
}

async function cleanupBeta(email: string) {
  await q(`delete from users where email = $1`, [email]);
  await q(`delete from crm_beta_invites where email = $1`, [email]);
}

describe("platform admin gating", () => {
  it("admin endpoints answer for the platform admin", async () => {
    const overview = await (await fetch(`${BASE}/api/admin/overview`)).json();
    expect(overview.users).toBeGreaterThan(0);
    expect(overview.orgs).toBeGreaterThan(0);
    expect(overview.payments.succeededCents).toBeGreaterThanOrEqual(0);

    const users = await (await fetch(`${BASE}/api/admin/users`)).json();
    expect(Array.isArray(users)).toBe(true);
    expect(users.some((u: any) => u.email === DEV_EMAIL)).toBe(true);

    const orgs = await (await fetch(`${BASE}/api/admin/orgs`)).json();
    expect(orgs.length).toBeGreaterThan(0);
    const detail = await (await fetch(`${BASE}/api/admin/orgs/${orgs[0].id}`)).json();
    expect(detail.org.id).toBe(orgs[0].id);
    expect(detail.seats.limit).toBeTypeOf("number");
  });

  it("every /api/admin/* route 403s a non-admin", async () => {
    await withDevEmail("not-an-admin@example.com", async () => {
      const me = await (await fetch(`${BASE}/api/crm/me`)).json();
      expect(me.isPlatformAdmin).toBe(false);

      for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/orgs", "/api/admin/beta-invites"]) {
        const r = await fetch(`${BASE}${path}`);
        expect(r.status, path).toBe(403);
      }
      const post = await fetch(`${BASE}/api/admin/beta-invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "x@example.com" }),
      });
      expect(post.status).toBe(403);
    });
  });
});

describe("beta invites", () => {
  it("signup with a valid token flags the account; the token dies on first use", async () => {
    const invited = `vt-beta-${stamp}@example.com`;
    const other = `vt-notbeta-${stamp}@example.com`;
    try {
      const create = await fetch(`${BASE}/api/admin/beta-invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invited }),
      });
      expect(create.status).toBe(201);
      const { link } = await create.json();
      const token = new URL(link).searchParams.get("beta")!;
      expect(token).toBeTruthy();

      // Accept: a NEW account signing up with ?beta= gets flagged.
      const signup = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invited, password: "betapassword1", beta: token }),
      });
      expect(signup.status).toBe(200);
      const { rows: flagged } = await q(`select beta_at from users where email = $1`, [invited]);
      expect(flagged[0].beta_at).toBeTruthy();
      const { rows: inv } = await q(`select accepted_at from crm_beta_invites where email = $1`, [invited]);
      expect(inv[0].accepted_at).toBeTruthy();

      // Single-use: a second account with the same token signs up fine but
      // is NOT flagged.
      const reuse = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: other, password: "betapassword1", beta: token }),
      });
      expect(reuse.status).toBe(200);
      const { rows: notFlagged } = await q(`select beta_at from users where email = $1`, [other]);
      expect(notFlagged[0].beta_at).toBeNull();
    } finally {
      await cleanupBeta(invited);
      await cleanupBeta(other);
    }
  });

  it("an expired token never flags", async () => {
    const email = `vt-expired-${stamp}@example.com`;
    const token = `expired-${stamp}`;
    try {
      await q(
        `insert into crm_beta_invites (email, token_hash, expires_at)
         values ($1, $2, now() - interval '1 day')`,
        [email, createHash("sha256").update(token).digest("hex")],
      );
      const signup = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "betapassword1", beta: token }),
      });
      expect(signup.status).toBe(200);
      const { rows } = await q(`select beta_at from users where email = $1`, [email]);
      expect(rows[0].beta_at).toBeNull();
    } finally {
      await cleanupBeta(email);
    }
  });

  it("a token addressed to a different email never flags", async () => {
    const invited = `vt-bound-${stamp}@example.com`;
    const other = `vt-bound-other-${stamp}@example.com`;
    try {
      const create = await fetch(`${BASE}/api/admin/beta-invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invited }),
      });
      const { link } = await create.json();
      const token = new URL(link).searchParams.get("beta")!;
      const signup = await fetch(`${BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: other, password: "betapassword1", beta: token }),
      });
      expect(signup.status).toBe(200);
      const { rows } = await q(`select beta_at from users where email = $1`, [other]);
      expect(rows[0].beta_at).toBeNull();
      // …and the invite stays unaccepted for the real recipient.
      const { rows: inv } = await q(`select accepted_at from crm_beta_invites where email = $1`, [invited]);
      expect(inv[0].accepted_at).toBeNull();
    } finally {
      await cleanupBeta(invited);
      await cleanupBeta(other);
    }
  });
});

describe("beta accounts are unlimited", () => {
  it("a beta owner gets limit -1 and an invitation that would 402 a 1-seat plan sails through", async () => {
    const invitee = `vt-seat-${stamp}@example.com`;
    // Shrink the dev owner's plan to a single seat so only the beta flag can
    // let a second seat through; restore everything in finally.
    const { rows: before } = await q(`select plan, status from subscriptions where user_id = 1`);
    try {
      await q(`update subscriptions set plan = 'standard', status = 'active' where user_id = 1`);
      await q(`update users set beta_at = now() where id = 1`);

      const me = await (await fetch(`${BASE}/api/crm/me`)).json();
      expect(me.seats.plan).toBe("beta");
      expect(me.seats.limit).toBe(-1);
      expect(me.seats.canAddSeat).toBe(true);

      const invite = await fetch(`${BASE}/api/crm/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invitee, role: "field" }),
      });
      expect(invite.status).toBe(201);

      // Same org, same 1-seat plan, flag removed: the very next invite 402s.
      // Proves the beta flag — not the plan — is what let the seat through.
      await q(`delete from crm_invitations where email = $1`, [invitee]);
      await q(`delete from crm_members where email = $1 and status = 'invited'`, [invitee]);
      await q(`update users set beta_at = null where id = 1`);
      const unflagged = await (await fetch(`${BASE}/api/crm/me`)).json();
      expect(unflagged.seats.limit).toBe(1);
      const blocked = await fetch(`${BASE}/api/crm/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `vt-seat2-${stamp}@example.com`, role: "field" }),
      });
      expect(blocked.status).toBe(402);
    } finally {
      await q(`delete from crm_invitations where email in ($1, $2)`, [invitee, `vt-seat2-${stamp}@example.com`]);
      await q(`delete from crm_members where email in ($1, $2) and status = 'invited'`, [invitee, `vt-seat2-${stamp}@example.com`]);
      await q(`update users set beta_at = null where id = 1`);
      if (before.length) {
        await q(`update subscriptions set plan = $1, status = $2 where user_id = 1`, [before[0].plan, before[0].status]);
      }
    }
  });
});
