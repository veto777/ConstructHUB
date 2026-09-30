import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createHmac, randomUUID, randomInt } from "node:crypto";
import pg from "pg";

// Route hardening that needs real, separate accounts (no dev bypass): cross-tenant
// Click Guard deletes, the exclusion-list key, proxy-verified visitor IPs, and the
// review funnel's owner preview / resend semantics. Same child-server pattern as
// growth-isolation.test.ts, on its own port.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(new URL(process.env.CRM_TEST_BASE_URL!).port) + 4;
const base = `http://127.0.0.1:${port}`;
const secret = "growth-hardening-session-secret";
const testIp = `198.18.${randomInt(256)}.${randomInt(1, 255)}`;
const users: number[] = [], sids: string[] = [], domainIds: number[] = [];
let child: ChildProcess;
let a: string, b: string;

async function account() {
  const { rows: [user] } = await pool.query("insert into users(email,display_name,email_verified) values($1,'Hardening fixture',true) returning id", [`${randomUUID()}@example.invalid`]);
  users.push(user.id);
  // Click Guard and review templates are plan features; Growth covers 3 protected websites.
  await pool.query("insert into subscriptions(user_id,plan,status) values($1,'growth','active')", [user.id]);
  const sid = randomUUID(); sids.push(sid);
  await pool.query("insert into session(sid,sess,expire) values($1,$2,now()+interval '1 hour')", [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: user.id } })]);
  const sig = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}
async function api(path: string, cookie = "", method = "GET", body?: any, headers: Record<string, string> = {}) {
  return fetch(base + path, { method, headers: { cookie, "content-type": "application/json", "x-forwarded-for": testIp, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("route hardening (auxiliary child server)", () => {
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: { ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false", SESSION_SECRET: secret, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "", SCRAPE_SCHEDULER_DISABLED: "true" },
      stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    const log = createWriteStream(`tmp/growth-hardening-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error("Hardening test server exited");
      try { if ((await api("/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Hardening test server did not start");
    a = await account(); b = await account();
  }, 90_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await pool.query("delete from blocked_ips where domain_id=any($1::int[])", [domainIds]);
    await pool.query("delete from click_visits where domain_id=any($1::int[])", [domainIds]);
    await pool.query("delete from tracked_domains where id=any($1::int[])", [domainIds]);
    await pool.query("delete from review_requests where user_id=any($1::int[])", [users]);
    await pool.query("delete from review_templates where user_id=any($1::int[])", [users]);
    await pool.query("delete from review_reminder_settings where user_id=any($1::int[])", [users]);
    await pool.query("delete from subscriptions where user_id=any($1::int[])", [users]);
    await pool.query("delete from users where id=any($1::int[])", [users]);
    await pool.query("delete from session where sid=any($1::text[])", [sids]);
    await pool.end();
  });

  describe("Click Guard", () => {
    it("rejects junk domains and IPs, and never deletes another account's blocked IP", async () => {
      expect((await api("/api/click-guard/domains", a, "POST", { domain: "   " })).status).toBe(400);
      const domainA = await (await api("/api/click-guard/domains", a, "POST", { domain: "https://hardening-a.example/landing" })).json();
      const domainB = await (await api("/api/click-guard/domains", b, "POST", { domain: "hardening-b.example" })).json();
      domainIds.push(domainA.id, domainB.id);
      expect(domainA.domain).toBe("hardening-a.example");
      expect((await api(`/api/click-guard/domains/${domainA.id}/block`, a, "POST", { ipAddress: "not-an-ip" })).status).toBe(400);
      const block = await (await api(`/api/click-guard/domains/${domainA.id}/block`, a, "POST", { ipAddress: "198.51.100.91" })).json();
      expect((await api(`/api/click-guard/domains/${domainB.id}/block/${block.id}`, b, "DELETE")).status).toBe(404);
      expect((await api(`/api/click-guard/domains/${domainA.id}/block/${block.id}`, b, "DELETE")).status).toBe(404);
      const still = await (await api(`/api/click-guard/domains/${domainA.id}/blocked`, a)).json();
      expect(still.map((x: any) => x.id)).toContain(block.id);
      expect((await api(`/api/click-guard/domains/${domainA.id}/block/${block.id}`, a, "DELETE")).status).toBe(200);
    });

    it("serves the exclusion list only with the script's key and stores the proxy-verified IP", async () => {
      const domain = await (await api("/api/click-guard/domains", a, "POST", { domain: "hardening-c.example" })).json();
      domainIds.push(domain.id);
      await api(`/api/click-guard/domains/${domain.id}/block`, a, "POST", { ipAddress: "203.0.113.0/24" });
      expect((await api(`/api/click-guard/exclusion-list/${domain.trackingId}?format=json`)).status).toBe(403);
      const { exclusionUrl } = await (await api(`/api/click-guard/domains/${domain.id}/google-ads-script`, a)).json();
      const list = await (await api(new URL(exclusionUrl).pathname + new URL(exclusionUrl).search)).json();
      expect(list.ips).toEqual(["203.0.113.0/24"]);
      // Cloudflare appends the real client to any X-Forwarded-For the client sent.
      const track = await fetch(base + "/api/click-guard/track", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.191, 198.51.100.7", "cf-ipcountry": "US" }, body: JSON.stringify({ trackingId: domain.trackingId, userAgent: "Hardening fixture browser agent" }) });
      expect(track.status).toBe(204);
      const { rows } = await pool.query("select ip_address,country from click_visits where domain_id=$1", [domain.id]);
      expect(rows).toEqual([{ ip_address: "198.51.100.7", country: "US" }]);
    });
  });

  describe("review funnel", () => {
    it("rejects non-Google review links", async () => {
      for (const googleProfileUrl of ["not a url", "https://example.com/review"]) {
        expect((await api("/api/review-templates", a, "POST", { name: "Hardening", googleProfileUrl })).status).toBe(400);
      }
    });

    it("does not record the owner's preview, and a resend keeps the customer's answer", async () => {
      const template = await (await api("/api/review-templates", a, "POST", { name: "Hardening", googleProfileUrl: "https://search.google.com/local/writereview?placeid=HARDENING" })).json();
      expect(template.googleProfileUrl).toBe("https://search.google.com/local/writereview?placeid=HARDENING");
      const created = await (await api("/api/reviews/create", a, "POST", { clientName: "Hardening customer", clientEmail: `${randomUUID()}@example.invalid`, templateId: template.id })).json();
      const token = created.token;
      const row = async () => (await pool.query("select link_clicked,email_opened,status,feedback_rating,next_reminder_at from review_requests where token=$1", [token])).rows[0];

      const preview = await (await api(`/api/review/${token}`, a)).json();
      expect(preview.preview).toBe(true);
      expect((await (await api(`/api/review/${token}/feedback`, a, "POST", { rating: 3 })).json()).recorded).toBe(false);
      expect(await row()).toMatchObject({ link_clicked: false, email_opened: false, status: "sent", feedback_rating: null });

      expect((await (await api(`/api/review/${token}`)).json()).preview).toBe(false);
      expect((await api(`/api/review/${token}/feedback`, "", "POST", { rating: 9 })).status).toBe(200);
      expect(await row()).toMatchObject({ link_clicked: true, email_opened: true, status: "positive_feedback", feedback_rating: 9 });

      const resend = await (await api(`/api/reviews/${created.id}/resend`, a, "POST", {})).json();
      expect(resend.alreadyResponded).toBe(true);
      expect(await row()).toMatchObject({ status: "positive_feedback", feedback_rating: 9, next_reminder_at: null });
    });
  });

  describe("public inquiry forms", () => {
    it("validates the email before sending staff mail", async () => {
      const r = await api("/api/seo-inquiry", "", "POST", { name: "Hardening", email: "not-an-email" });
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe("Enter a valid email address");
    });
  });
});
