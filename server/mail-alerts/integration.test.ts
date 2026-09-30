import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { pool } from "../db";
import { ensureMailAlertsSchema } from "./schema";
import { ensureDomainsSchema } from "../domains/schema";
import {
  forwardingAddress,
  ingest,
  purgeExpiredMail,
  storeMatched,
} from "./service";
import { syncGmail } from "./gmail";
import { GMAIL_QUERY } from "./classify";
import { encryptToken } from "../gbp/token-crypto";
vi.mock("../account-events", () => ({
  notifyUser: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
}));
let user: number, other: number, location: number, address: string;
beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname))
    throw new Error("a7 DB required");
  await ensureDomainsSchema();
  await ensureMailAlertsSchema();
  await ensureMailAlertsSchema();
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES('a7-mail-'||gen_random_uuid()||'@example.test'),('a7-mail-other-'||gen_random_uuid()||'@example.test') RETURNING id",
  );
  [user, other] = rows.map((r) => r.id);
  location = (
    await pool.query(
      "INSERT INTO business_locations(user_id,business_name,website) VALUES($1,'Fixture Agency Client','https://client.example.test') RETURNING id",
      [user],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO managed_domains(user_id,domain,location_id) VALUES($1,'client.example.test',$2)",
    [user, location],
  );
  process.env.INBOUND_MAIL_DOMAIN = "alerts.constructhub.test";
  address = (await forwardingAddress(user))!;
});
afterAll(async () => {
  await pool.query("DELETE FROM managed_domains WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[user, other]]);
  await pool.end();
});
it("uses unique inbound addresses, drops unrelated bodies, maps clients and deduplicates", async () => {
  expect(await forwardingAddress(user)).toBe(address);
  expect(await forwardingAddress(other)).not.toBe(address);
  await ingest({
    from: "friend@example.test",
    to: address,
    subject: "Private unrelated message",
    text: "must never persist",
  });
  expect(
    (
      await pool.query("SELECT * FROM mail_alert_messages WHERE user_id=$1", [
        user,
      ])
    ).rows,
  ).toHaveLength(0);
  const m = {
    from: "noreply@porkbun.com",
    to: address,
    subject: "Domain transfer request",
    text: "A transfer for client.example.test was requested",
  };
  await ingest(m);
  await ingest(m);
  const { rows } = await pool.query(
    "SELECT * FROM mail_alert_messages WHERE user_id=$1",
    [user],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    severity: "critical",
    location_id: location,
  });
  expect(
    (
      await pool.query("SELECT * FROM mail_alert_messages WHERE user_id=$1", [
        other,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("handles Gmail forwarding confirmation and enforces 30-day retention", async () => {
  await ingest(
    `From: forwarding-noreply@google.com\r\nTo: ${address}\r\nSubject: Gmail Forwarding Confirmation\r\n\r\nConfirmation code: 123456789\nhttps://mail.google.com/mail/vf-fixture`,
  );
  const {
    rows: [m],
  } = await pool.query(
    "SELECT * FROM mail_alert_messages WHERE user_id=$1 AND category='forwarding'",
    [user],
  );
  expect(m.confirmation_code).toBe("123456789");
  expect(
    new Date(m.expires_at).getTime() - new Date(m.received_at).getTime(),
  ).toBe(30 * 86400000);
  await pool.query(
    "UPDATE mail_alert_messages SET expires_at=now()-interval '1 second' WHERE id=$1",
    [m.id],
  );
  await purgeExpiredMail();
  expect(
    (await pool.query("SELECT id FROM mail_alert_messages WHERE id=$1", [m.id]))
      .rows,
  ).toHaveLength(0);
  expect(
    await storeMatched(
      user,
      {
        from: "noreply@porkbun.com",
        to: address,
        subject: "Domain expiry",
        text: "old",
      },
      "gmail",
      new Date(Date.now() - 31 * 86400000),
    ),
  ).toBe(false);
});
it("Gmail queries only allowlisted senders, fetches bodies only after metadata matches", async () => {
  const http = vi.fn(async (raw: any) => {
    const u = new URL(raw);
    if (u.pathname.endsWith("/messages")) {
      expect(u.searchParams.get("q")).toBe(GMAIL_QUERY);
      expect(u.searchParams.get("maxResults")).toBe("20");
      return Response.json({
        messages: [{ id: "known" }, { id: "unrelated" }],
      });
    }
    if (u.searchParams.get("format") === "metadata")
      return Response.json({
        payload: {
          headers: [
            {
              name: "From",
              value: u.pathname.endsWith("known")
                ? "sc-noreply@google.com"
                : "friend@example.test",
            },
            { name: "Subject", value: "Indexing issue" },
          ],
        },
      });
    if (u.pathname.endsWith("/known"))
      return Response.json({
        internalDate: String(Date.now()),
        payload: {
          mimeType: "text/plain",
          body: {
            data: Buffer.from("client.example.test indexing issue").toString(
              "base64url",
            ),
          },
        },
      });
    throw new Error("Unrelated body must not be fetched");
  });
  await syncGmail(
    {
      user_id: user,
      google_subject: "fixture",
      access_token: encryptToken("fake-token"),
      expires_at: new Date(Date.now() + 3600000),
      page_token: null,
    },
    http,
  );
  expect(http).toHaveBeenCalledTimes(4);
  expect(
    (
      await pool.query(
        "SELECT * FROM mail_alert_messages WHERE user_id=$1 AND source='gmail'",
        [user],
      )
    ).rows,
  ).toHaveLength(1);
});

it("paginates 1000 alerts and client locations, filters on the server and isolates owners", async () => {
  const { registerMailAlertRoutes } = await import("./routes");
  const handlers = new Map<string, any>();
  const app: any = { use: () => {} };
  for (const method of ["get", "post"])
    app[method] = (path: string, fn: any) => handlers.set(method + path, fn);
  registerMailAlertRoutes(app, (req: any, res: any) =>
    req.user?.id ? req.user : (res.status(401).json({}), null),
  );
  const call = async (path: string, query: any = {}, who = user) => {
    let status = 200,
      data: any;
    const res: any = {
      status: (s: number) => {
        status = s;
        return res;
      },
      json: (v: any) => {
        data = v;
        return res;
      },
    };
    await handlers.get("get" + path)({ query, user: { id: who } }, res);
    return { status, data };
  };
  await pool.query(
    "INSERT INTO business_locations(user_id,business_name,website) SELECT $1,'A7 mail scale client '||n,'https://scale-'||n||'.example.test' FROM generate_series(1,1000)n",
    [user],
  );
  await pool.query(
    "INSERT INTO mail_alert_messages(user_id,dedupe,source,category,severity,sender,subject,body) SELECT $1,'scale-'||n,'forwarding','gsc','warning','sc-noreply@google.com','Scale indexing fixture '||n,'Explicit test fixture' FROM generate_series(1,1000)n",
    [user],
  );
  const first = await call("/api/mail-alerts", { q: "Scale indexing fixture" });
  expect(first.data.total).toBe(1000);
  expect(first.data.items).toHaveLength(25);
  const last = await call("/api/mail-alerts", {
    q: "Scale indexing fixture",
    page: "40",
  });
  expect(last.data.items).toHaveLength(25);
  expect(
    (
      await call("/api/mail-alerts", {
        q: "Scale indexing fixture",
        category: "ads",
      })
    ).data.total,
  ).toBe(0);
  expect((await call("/api/mail-alerts", {}, other)).data.items).toHaveLength(
    0,
  );
  expect((await call("/api/mail-alerts", { limit: "1000" })).status).toBe(400);
  expect((await call("/api/mail-alerts", {}, 0)).status).toBe(401);
});

it("uses the trusted envelope recipient when Gmail preserves the original To header", async () => {
  await ingest(
    "From: sc-noreply@google.com\r\nTo: original@gmail.com\r\nSubject: Coverage issue envelope fixture\r\n\r\nclient.example.test",
    address,
  );
  expect(
    (
      await pool.query(
        "SELECT id FROM mail_alert_messages WHERE user_id=$1 AND subject='Coverage issue envelope fixture'",
        [user],
      )
    ).rows,
  ).toHaveLength(1);
});

it("gates optional OAuth, validates state and scopes, encrypts a separate grant", async () => {
  const { registerGmailOAuth, GMAIL_SCOPE } = await import("./gmail");
  const handlers = new Map<string, any>();
  const app: any = { use: () => {} };
  for (const method of ["get", "post"])
    app[method] = (path: string, fn: any) => handlers.set(method + path, fn);
  const http = vi.fn(async (raw: any) =>
    String(raw).includes("/token")
      ? Response.json({
          access_token: "gmail-access-fixture",
          refresh_token: "gmail-refresh-fixture",
          scope: `openid email ${GMAIL_SCOPE}`,
          expires_in: 3600,
        })
      : Response.json({
          sub: "oauth-fixture",
          email: "fixture@gmail.com",
          email_verified: true,
        }),
  );
  registerGmailOAuth(app, (req: any) => req.user, http);
  const req: any = {
    user: { id: user },
    session: { recentAuth: { userId: user, at: Date.now() } },
    headers: { host: "localhost:8189" },
    protocol: "http",
    get: (n: string) => (n === "host" ? "localhost:8189" : undefined),
    query: {},
  };
  let status = 200,
    result: any;
  const res: any = {
    status: (s: number) => {
      status = s;
      return res;
    },
    json: (v: any) => {
      result = v;
      return res;
    },
    redirect: (v: any) => {
      result = v;
      return res;
    },
  };
  process.env.GMAIL_OAUTH_ENABLED = "false";
  await handlers.get("get/api/mail-alerts/oauth/connect")(req, res);
  expect(status).toBe(404);
  expect(http).not.toHaveBeenCalled();
  process.env.GMAIL_OAUTH_ENABLED = "true";
  await handlers.get("get/api/mail-alerts/oauth/connect")(req, res);
  expect(new URL(result).searchParams.get("scope")).toContain(GMAIL_SCOPE);
  expect(new URL(result).searchParams.get("scope")).not.toContain(
    "business.manage",
  );
  req.query = { code: "fixture-code", state: "wrong" };
  await handlers.get("get/api/mail-alerts/oauth/callback")(req, res);
  expect(result).toContain("failed");
  expect(http).not.toHaveBeenCalled();
  await handlers.get("get/api/mail-alerts/oauth/connect")(req, res);
  req.query = { code: "fixture-code", state: req.session.mailOAuth.state };
  await handlers.get("get/api/mail-alerts/oauth/callback")(req, res);
  expect(result).toContain("connected");
  const {
    rows: [grant],
  } = await pool.query(
    "SELECT * FROM mail_alert_grants WHERE user_id=$1 AND google_subject='oauth-fixture'",
    [user],
  );
  expect(grant.access_token).toMatch(/^v1:/);
  expect(grant.refresh_token).not.toContain("gmail-refresh");
  expect(
    (await pool.query("SELECT * FROM gbp_grants WHERE user_id=$1", [user]))
      .rows,
  ).toHaveLength(0);
  process.env.GMAIL_OAUTH_ENABLED = "false";
});
