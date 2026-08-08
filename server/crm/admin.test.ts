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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { spawn, execSync, type ChildProcess } from "child_process";
import { createWriteStream } from "fs";
import pg from "pg";
import { ADMIN_EMAILS } from "../admin";
import { safeEq, gateClientIp, gateOpen, gateRecordFailure, gateClear } from "./admin";

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


/**
 * Configured-gate coverage. The dev server runs WITHOUT ADMIN_GATE_USER/PASS
 * (gate off), so this suite spawns its own server on :8199 with the gate
 * configured and kills it in afterAll. Never touches 8119/8129/8139.
 */
const GATE_PORT = 8199;
const GBASE = `http://127.0.0.1:${GATE_PORT}`;
const GATE_USER = "vt-gate-admin";
const GATE_PASS = "vt-gate-pass-123";

function cookieFrom(r: Response): string {
  const m = (r.headers.get("set-cookie") || "").match(/connect\.sid=[^;]+/);
  return m ? m[0] : "";
}

function postGate(body: any, cookie = "", xff?: string) {
  return fetch(`${GBASE}/api/admin/gate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(xff ? { "x-forwarded-for": xff } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("safeEq (unit)", () => {
  it("true only for identical strings, length mismatches included", () => {
    expect(safeEq("s3cret", "s3cret")).toBe(true);
    expect(safeEq("", "")).toBe(true);
    expect(safeEq("s3cret", "s3creT")).toBe(false);
    expect(safeEq("s3cret", "s3cret-longer")).toBe(false);
    expect(safeEq("s3cret-longer", "s3cret")).toBe(false);
  });
});

describe("gate brute-force limiter (unit)", () => {
  it("keys on req.ip only — spoofable headers never reach the bucket key", () => {
    const req = {
      ip: "9.9.9.9",
      headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2, 3.3.3.3" },
    };
    expect(gateClientIp(req)).toBe("9.9.9.9");
  });

  it("caps at 8 failures a window; a success (gateClear) restores access", () => {
    const key = `unit-${Date.now()}-${Math.random()}`;
    expect(gateOpen(key)).toBe(true);
    for (let i = 0; i < 7; i++) gateRecordFailure(key);
    expect(gateOpen(key)).toBe(true);
    gateRecordFailure(key);
    expect(gateOpen(key)).toBe(false);
    gateClear(key);
    expect(gateOpen(key)).toBe(true);
  });
});

describe("configured admin gate (:8199 child server)", () => {
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    child = spawn("npx", ["tsx", "server/index.ts"], {
      env: {
        ...process.env,
        PORT: String(GATE_PORT),
        DEV_AUTH_BYPASS_USER1: "true",
        ADMIN_GATE_USER: GATE_USER,
        ADMIN_GATE_PASS: GATE_PASS,
        OPENAI_API_KEY: "dummy-not-used",
        HOVER_CLIENT_SECRET: "dummy-hover-secret",
        GOOGLE_CLIENT_SECRET: "dummy",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group, so afterAll can kill npx AND tsx
    });
    const log = createWriteStream("/tmp/gate-server-8199.log");
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);

    const deadline = Date.now() + 120_000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${GBASE}/api/admin/gate`);
        if (r.status === 200) {
          up = true;
          break;
        }
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 750));
    }
    if (!up) throw new Error("gate child server never came up on :8199 — see /tmp/gate-server-8199.log");
  }, 150_000);

  afterAll(async () => {
    try {
      if (child?.pid) process.kill(-child.pid, "SIGKILL");
    } catch { /* already dead */ }
    try {
      execSync("fuser -k 8199/tcp 2>/dev/null || true");
    } catch { /* best effort */ }
  });

  it("reports configured, 403s admin APIs until the gate is passed, then 200s", async () => {
    const status = await (await fetch(`${GBASE}/api/admin/gate`)).json();
    expect(status.gateConfigured).toBe(true);
    expect(status.gatePassed).toBe(false);

    // The dev-bypass user IS a platform admin, so only the missing second
    // factor can be blocking this request.
    const blocked = await fetch(`${GBASE}/api/admin/analytics`);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).gateRequired).toBe(true);

    const wrong = await postGate({ username: GATE_USER, password: "nope" });
    expect(wrong.status).toBe(401);

    const ok = await postGate({ username: GATE_USER, password: GATE_PASS });
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect(cookie).toBeTruthy();

    const authed = await fetch(`${GBASE}/api/admin/analytics`, { headers: { cookie } });
    expect(authed.status).toBe(200);
  });

  it("an LSA route 403s a signed-in platform admin who never passed the gate", async () => {
    // Sign up + verify + promote a throwaway account onto the platform admin
    // email list, then log in for real (adminGuard wants req.isAuthenticated,
    // which the dev bypass does NOT fake).
    const email = `vt-lsagate-${stamp}@example.com`;
    const adminEmail = ADMIN_EMAILS[0];
    let userId: number | null = null;
    try {
      const signup = await fetch(`${GBASE}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "gatepassword1" }),
      });
      expect(signup.status).toBe(200);
      const { rows } = await q(`select id from users where email = $1`, [email]);
      userId = rows[0].id;
      await q(`update users set email_verified = true, email = $1 where id = $2`, [adminEmail, userId]);

      const login = await fetch(`${GBASE}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: "gatepassword1" }),
      });
      expect(login.status).toBe(200);
      const cookie = cookieFrom(login);
      expect(cookie).toBeTruthy();

      // Admin session, no gate → both adminGuard (LSA) and the test-email
      // route must refuse with the gate marker, not serve.
      const lsa = await fetch(`${GBASE}/api/admin/lsa/manager`, { headers: { cookie } });
      expect(lsa.status).toBe(403);
      expect((await lsa.json()).gateRequired).toBe(true);

      const testEmail = await fetch(`${GBASE}/api/admin/test-email`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      });
      expect(testEmail.status).toBe(403);
      expect((await testEmail.json()).gateRequired).toBe(true);

      // The beta-codes routes (inline isAdmin checks) sit behind the same wall.
      const beta = await fetch(`${GBASE}/api/beta-codes`, { headers: { cookie } });
      expect(beta.status).toBe(403);
      expect((await beta.json()).gateRequired).toBe(true);

      // Pass the gate on this session and the LSA route opens.
      const gate = await postGate({ username: GATE_USER, password: GATE_PASS }, cookie);
      expect(gate.status).toBe(200);
      const lsaOk = await fetch(`${GBASE}/api/admin/lsa/manager`, { headers: { cookie } });
      expect(lsaOk.status).toBe(200);
      const betaOk = await fetch(`${GBASE}/api/beta-codes`, { headers: { cookie } });
      expect(betaOk.status).toBe(200);
    } finally {
      if (userId != null) await q(`delete from users where id = $1`, [userId]);
    }
  });

  it("8 wrong passwords lock the ip — attempt 9 is a 429 even with the right password", async () => {
    // NOTE: on a directly-connected dev box `trust proxy: 1` lets XFF steer
    // req.ip, so each test run uses its own fixed XFF for an isolated bucket.
    // The XFF-rotation guarantee itself is pinned by the gateClientIp unit
    // test above (the bucket key never comes from headers).
    const xff = `10.254.${Math.floor(Math.random() * 250) + 1}.1`;
    for (let i = 0; i < 8; i++) {
      const r = await postGate({ username: GATE_USER, password: `wrong-${i}` }, "", xff);
      expect(r.status).toBe(401);
    }
    const ninth = await postGate({ username: GATE_USER, password: GATE_PASS }, "", xff);
    expect(ninth.status).toBe(429);
  });
});
