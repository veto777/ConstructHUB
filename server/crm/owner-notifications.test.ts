/**
 * Owner-level notifications — the "runs a tight ship" switches:
 *   estimateSent (portal.ts send route), memberLogin (auth.ts login,
 *   debounced per user/org/hour), memberAccountChange (auth.ts change-password
 *   + crm self-profile routes), leadReceived (lead-capture.ts intake).
 *
 * Requires the local dev server (DEV_AUTH_BYPASS_USER1=true):
 *   DATABASE_URL=… DEV_AUTH_BYPASS_USER1=true PORT=8119 npx tsx --env-file=.env server/index.ts
 * Override the target with CRM_TEST_BASE_URL; the DB with DATABASE_URL.
 *
 * Honest assertion path: outside production sendWithFallback sinks every
 * message to tmp/email-outbox.jsonl (server/email.ts), so a fired
 * notification is a real outbox row and a silenced one is its absence.
 * Every fixture carries a per-run marker so concurrent suites writing the
 * same outbox can never satisfy (or break) these assertions. Org
 * notificationPrefs are snapshotted and restored in a finally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";
import bcrypt from "bcryptjs";
import { CRM_NOTIFICATION_PREFS } from "@shared/schema";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

// The dev server's cwd is the repo root (npm run dev / tsx server/index.ts),
// which is where server/email.ts sinks the outbox.
const OUTBOX =
  process.env.CRM_TEST_OUTBOX ??
  fileURLToPath(new URL("../../tmp/email-outbox.jsonl", import.meta.url));

type OutboxMail = { at: string; to: string[]; subject: string | null; html: string | null };

function outbox(): OutboxMail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readFileSync(OUTBOX, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as OutboxMail;
      } catch {
        return null;
      }
    })
    .filter((m): m is OutboxMail => m !== null);
}

/**
 * Every sunk mail whose subject, html or recipient list mentions the marker.
 * `since` (ISO timestamp captured just before the triggering action) excludes
 * stale rows from earlier runs — the outbox is append-only and shared.
 */
function mailsMatching(marker: string, since?: string): OutboxMail[] {
  return outbox().filter(
    (m) =>
      (!since || m.at >= since) &&
      ((m.subject ?? "").includes(marker) ||
        (m.html ?? "").includes(marker) ||
        (m.to ?? []).some((t) => t.includes(marker))),
  );
}

/** Poll until at least one matching mail appears (fire-and-forget senders). */
async function waitForMail(marker: string, since?: string, timeoutMs = 8000): Promise<OutboxMail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = mailsMatching(marker, since);
    if (found.length) return found;
    if (Date.now() > deadline) return [];
    await new Promise((r) => setTimeout(r, 150));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Recipients as one searchable string — senders comma-join `to` (same shape as portal.ts notifyOwner). */
const rcpts = (m: OutboxMail) => (m.to ?? []).join(",");

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

async function setPref(cookie: string | undefined, key: string, value: boolean) {
  const r = await api(
    "/api/crm/org",
    { method: "PATCH", body: JSON.stringify({ notificationPrefs: { [key]: value } }) },
    cookie,
  );
  expect(r.status).toBe(200);
}

describe("owner notifications (dev server)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ownerEmail = `vitest.ownotif.owner.${stamp}@example.com`;
  const memberEmail = `vitest.ownotif.member.${stamp}@example.com`;
  const member2Email = `vitest.ownotif.member2.${stamp}@example.com`;
  const memberName = `Vitest Mate ${stamp}`;
  const member2Name = `Vitest Mate Two ${stamp}`;
  const MEMBER_PW = `Vitest-pw-${stamp}-1!`;
  const MEMBER_PW2 = `Vitest-pw-${stamp}-2!`;
  const MEMBER_PW3 = `Vitest-pw-${stamp}-3!`;

  let cookie: string | undefined;
  let orgId: string;
  let priorPrefs: Record<string, boolean> | undefined;
  let devMemberId: string;
  let devMemberTitle: string | null;

  const estimateIds: string[] = [];
  const customerIds: string[] = [];

  /** Throwaway active member+user pair; owners are notified about them. */
  async function makeMemberUser(email: string, name: string, pw: string, role = "field") {
    const hash = bcrypt.hashSync(pw, 10);
    const [{ id: userId }] = await q<{ id: number }>(
      `insert into users (email, password_hash, display_name, email_verified, account_id)
       values ($1, $2, $3, true, $4) returning id`,
      [email, hash, name, `VIT${randomBytes(6).toString("hex").toUpperCase()}`],
    );
    await q(
      `insert into crm_members (org_id, user_id, email, role, status, display_name)
       values ($1, $2, $3, $4, 'active', $5)`,
      [orgId, userId, email, role, name],
    );
    return userId;
  }

  async function makeEstimate(label: string) {
    const custEmail = `vitest.ownotif.cust.${stamp}.${label}@example.com`;
    const cust = await api(
      "/api/crm/customers",
      { method: "POST", body: JSON.stringify({ displayName: `Vitest Ownotif ${stamp} ${label}`, email: custEmail }) },
      cookie,
    );
    expect(cust.status).toBe(201);
    customerIds.push(cust.body.id);
    const est = await api(
      "/api/crm/estimates",
      {
        method: "POST",
        body: JSON.stringify({
          customerId: cust.body.id,
          title: `Vitest owner-notify estimate ${label}`,
          items: [{ kind: "labor", name: "line", quantityMilli: 1000, unitPriceCents: 123400, taxable: false, hiddenFromClient: false, sortOrder: 0 }],
        }),
      },
      cookie,
    );
    expect(est.status).toBe(201);
    estimateIds.push(est.body.id);
    const [row] = await q<{ number: string | null }>(
      `select number from crm_estimates where id = $1`, [est.body.id]);
    return { id: est.body.id as string, number: row?.number ?? null };
  }

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
    devMemberId = me.body.member.id;
    priorPrefs = (me.body.org.customFields as any)?.notificationPrefs ?? undefined;

    const [dm] = await q<{ title: string | null }>(
      `select title from crm_members where id = $1`, [devMemberId]);
    devMemberTitle = dm?.title ?? null;

    // A second owner seat: the dev user IS the org owner and is always
    // excluded as the actor, so without this seat nobody would be left to
    // mail and every ON-case would be vacuous.
    await q(
      `insert into crm_members (org_id, email, role, status, display_name)
       values ($1, $2, 'owner', 'active', $3)`,
      [orgId, ownerEmail, `Vitest Owner ${stamp}`],
    );

    await makeMemberUser(memberEmail, memberName, MEMBER_PW);
    await makeMemberUser(member2Email, member2Name, MEMBER_PW);
  });

  afterAll(async () => {
    try {
      // Restore the dev member's own profile (the self-edit test changes it).
      await q(`update crm_members set title = $2 where id = $1`, [devMemberId, devMemberTitle]);
      // Restore the org's prefs exactly as found (explicit true == default ON).
      if (cookie) {
        await api(
          "/api/crm/org",
          {
            method: "PATCH",
            body: JSON.stringify({
              notificationPrefs: Object.fromEntries(
                CRM_NOTIFICATION_PREFS.map((p) => [p, priorPrefs?.[p] !== false]),
              ),
            }),
          },
          cookie,
        );
      }
      // Throwaway fixtures.
      await q(`delete from crm_estimate_events where estimate_id = any($1)`, [estimateIds]);
      await q(`delete from crm_estimate_items where estimate_id = any($1)`, [estimateIds]);
      await q(`delete from crm_estimates where id = any($1)`, [estimateIds]);
      await q(`delete from crm_client_tokens where email like 'vitest.ownotif.%'`);
      await q(`delete from crm_customers where id = any($1)`, [customerIds]);
      await q(`delete from crm_customers where display_name like $1`, [`Vitest Lead ${stamp}%`]);
      await q(`delete from crm_members where email like 'vitest.ownotif.%'`);
      await q(`delete from users where email like 'vitest.ownotif.%'`);
    } finally {
      await pool.end();
    }
  });

  it("estimateSent: pref ON mails the owner(s), pref OFF is silent", async () => {
    const a = await makeEstimate("a");
    const sinceA = new Date().toISOString();
    const sendA = await api(`/api/crm/estimates/${a.id}/send`, { method: "POST", body: "{}" }, cookie);
    expect(sendA.status).toBe(200);

    const mails = await waitForMail("Bid sent", sinceA);
    const mine = mails.filter(
      (m) => (m.subject ?? "").includes("Bid sent") && (m.subject ?? "").includes(stamp),
    );
    expect(mine.length).toBeGreaterThanOrEqual(1);
    const mail = mine[0];
    expect(rcpts(mail)).toContain(ownerEmail);
    if (a.number) expect(mail.subject).toContain(a.number);
    expect(mail.html ?? "").toContain("$1,234.00"); // the estimate total
    expect(mail.html ?? "").toContain("/crm/estimates");
    // The client-facing copy went to the client, not to the owner list.
    expect(mail.to.some((t) => t.includes("vitest.ownotif.cust"))).toBe(false);

    await setPref(cookie, "estimateSent", false);
    try {
      const b = await makeEstimate("b");
      const sinceB = new Date().toISOString();
      const sendB = await api(`/api/crm/estimates/${b.id}/send`, { method: "POST", body: "{}" }, cookie);
      expect(sendB.status).toBe(200);
      await sleep(1200);
      const still = mailsMatching(`${stamp} b`, sinceB).filter((m) => (m.subject ?? "").includes("Bid sent"));
      expect(still.length).toBe(0);
    } finally {
      await setPref(cookie, "estimateSent", true);
    }
  });

  it("memberLogin: pref ON mails the owner(s), debounced within the hour, pref OFF is silent", async () => {
    const since1 = new Date().toISOString();
    const login1 = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: memberEmail, password: MEMBER_PW }),
    });
    expect(login1.status).toBe(200);

    const mails = await waitForMail(memberName, since1);
    const loginMails = mails.filter((m) => (m.subject ?? "").includes("signed in"));
    expect(loginMails.length).toBe(1);
    expect(rcpts(loginMails[0])).toContain(ownerEmail);
    // The person who signed in is never mailed about it.
    expect(rcpts(loginMails[0])).not.toContain(memberEmail);

    // Debounce: a second sign-in inside the hour sends nothing new.
    const login2 = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: memberEmail, password: MEMBER_PW }),
    });
    expect(login2.status).toBe(200);
    await sleep(1200);
    expect(mailsMatching(memberName, since1).filter((m) => (m.subject ?? "").includes("signed in")).length).toBe(1);

    // Pref OFF: a different member (fresh debounce key) signs in silently.
    await setPref(cookie, "memberLogin", false);
    try {
      const since3 = new Date().toISOString();
      const login3 = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: member2Email, password: MEMBER_PW }),
      });
      expect(login3.status).toBe(200);
      await sleep(1200);
      expect(mailsMatching(member2Name, since3).filter((m) => (m.subject ?? "").includes("signed in")).length).toBe(0);
    } finally {
      await setPref(cookie, "memberLogin", true);
    }
  });

  it("memberAccountChange: password change mails field names only; pref OFF is silent", async () => {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: member2Email, password: MEMBER_PW }),
    });
    expect(login.status).toBe(200);

    const since = new Date().toISOString();
    const change = await api(
      "/api/auth/change-password",
      { method: "POST", body: JSON.stringify({ currentPassword: MEMBER_PW, newPassword: MEMBER_PW2 }) },
      login.cookie,
    );
    expect(change.status).toBe(200);

    const mails = await waitForMail(member2Name, since);
    const mine = mails.filter((m) => (m.subject ?? "").includes("updated their account"));
    expect(mine.length).toBe(1);
    expect(rcpts(mine[0])).toContain(ownerEmail);
    expect(rcpts(mine[0])).not.toContain(member2Email);
    expect(mine[0].html ?? "").toContain("password"); // the FIELD name…
    expect(mine[0].html ?? "").not.toContain(MEMBER_PW2); // …never the value

    await setPref(cookie, "memberAccountChange", false);
    try {
      const since2 = new Date().toISOString();
      const change2 = await api(
        "/api/auth/change-password",
        { method: "POST", body: JSON.stringify({ currentPassword: MEMBER_PW2, newPassword: MEMBER_PW3 }) },
        login.cookie,
      );
      expect(change2.status).toBe(200);
      await sleep(1200);
      expect(
        mailsMatching("updated their account", since2).filter((m) => (m.subject ?? "").includes(member2Name)).length,
      ).toBe(0);
    } finally {
      await setPref(cookie, "memberAccountChange", true);
    }
  });

  it("memberAccountChange: editing your own CRM profile tells the other owner(s)", async () => {
    const since = new Date().toISOString();
    const patch = await api(
      "/api/crm/profile",
      { method: "PATCH", body: JSON.stringify({ title: `Vitest Title ${stamp}` }) },
      cookie,
    );
    expect(patch.status).toBe(200);

    // The actor (dev user, an owner) is excluded; the throwaway owner gets it.
    const mails = await waitForMail("changed title", since);
    const mine = mails.filter(
      (m) => (m.subject ?? "").includes("updated their account") && rcpts(m).includes(ownerEmail),
    );
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].html ?? "").toContain("title");
  });

  it("leadReceived: pref ON mails the owner(s), pref OFF is silent", async () => {
    const tokenRes = await api("/api/crm/integrations/lead-capture", {}, cookie);
    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.token as string;

    const ipA = `10.250.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
    const sinceA = new Date().toISOString();
    const leadA = await api(`/api/public/leads/${token}`, {
      method: "POST",
      headers: { "x-forwarded-for": ipA },
      body: JSON.stringify({ name: `Vitest Lead ${stamp} A`, message: "roof leak" }),
    });
    expect(leadA.status).toBe(201);

    const mails = await waitForMail(`Vitest Lead ${stamp} A`, sinceA);
    const leadMails = mails.filter((m) => (m.subject ?? "").includes("New website lead"));
    expect(leadMails.length).toBe(1);
    expect(rcpts(leadMails[0])).toContain(ownerEmail);

    await setPref(cookie, "leadReceived", false);
    try {
      const sinceB = new Date().toISOString();
      const leadB = await api(`/api/public/leads/${token}`, {
        method: "POST",
        headers: { "x-forwarded-for": ipA.replace(/\d+$/, "99") },
        body: JSON.stringify({ name: `Vitest Lead ${stamp} B`, message: "siding" }),
      });
      expect(leadB.status).toBe(201);
      await sleep(1200);
      expect(mailsMatching(`Vitest Lead ${stamp} B`, sinceB).length).toBe(0);
    } finally {
      await setPref(cookie, "leadReceived", true);
    }
  });
});
