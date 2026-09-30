import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { pool } from "./db";
import { ensureAccountEventsSchema, notifyUser, logActivity, channelsFor, registerAccountEventRoutes, KIND_DEFAULTS } from "./account-events";
let userId: number;
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname)) throw new Error("requires a local development DB");
  await ensureAccountEventsSchema();
  ({ rows: [{ id: userId }] } = await pool.query("INSERT INTO users(email) VALUES('acct-events-'||gen_random_uuid()::text||'@example.invalid') RETURNING id"));
});
afterAll(async () => { await pool.query("DELETE FROM users WHERE id=$1", [userId]); await pool.end(); });
describe("account events", () => {
  it("security kinds always email; ordinary kinds follow preferences", async () => {
    await pool.query("INSERT INTO user_notification_prefs(user_id,kind,in_app,email) VALUES($1,'google.connected',false,false),($1,'gbp.new_review',false,false)", [userId]);
    expect(await channelsFor(userId, "google.connected")).toEqual({ inApp: false, email: true });
    expect(await channelsFor(userId, "gbp.new_review")).toEqual({ inApp: false, email: false });
    await notifyUser(userId, "gbp.new_review", { title: "muted" });
    await notifyUser(userId, "gbp.profile_change", { title: "Profile changed", severity: "warning" });
    const { rows } = await pool.query("SELECT kind,title FROM user_notifications WHERE user_id=$1", [userId]);
    expect(rows).toEqual([{ kind: "gbp.profile_change", title: "Profile changed" }]);
  });
  it("records who, what and from where", async () => {
    await logActivity({ ip: "10.0.0.1", headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "UA" } }, userId, "google.connected", { email: "a@example.invalid" });
    const { rows: [a] } = await pool.query("SELECT kind,detail,ip,user_agent FROM account_activity WHERE user_id=$1", [userId]);
    expect(a).toMatchObject({ kind: "google.connected", detail: { email: "a@example.invalid" }, ip: "203.0.113.9", user_agent: "UA" });
  });
  it("lists and persists every registered kind, including content and Site Scan delivery", async () => {
    const handlers = new Map<string, any>();
    const app: any = {};
    for (const method of ['get', 'post', 'put']) {
      app[method] = (path: string, handler: any) => handlers.set(`${method} ${path}`, handler);
    }
    registerAccountEventRoutes(app, req => req.user);
    const req: any = { user: { id: userId } };
    const response = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis() });
    const listed = response();
    await handlers.get('get /api/notification-prefs')(req, listed);
    expect(listed.json.mock.calls[0][0].prefs.map((p: any) => p.kind).sort()).toEqual(Object.keys(KIND_DEFAULTS).sort());
    for (const kind of ['gbp.post_failed', 'sitescan.completed', 'sitescan.regressed'] as const) {
      expect(listed.json.mock.calls[0][0].prefs).toContainEqual(expect.objectContaining({ kind, inApp: true, email: false }));
      const saved = response();
      await handlers.get('put /api/notification-prefs')({ ...req, body: { prefs: [{ kind, inApp: false, email: false }] } }, saved);
      expect(saved.json).toHaveBeenCalledWith({ ok: true });
      await notifyUser(userId, kind, { title: 'Muted fixture' });
      expect((await pool.query('SELECT id FROM user_notifications WHERE user_id=$1 AND kind=$2', [userId, kind])).rowCount).toBe(0);
      await handlers.get('put /api/notification-prefs')({ ...req, body: { prefs: [{ kind, inApp: true, email: false }] } }, response());
      await notifyUser(userId, kind, { title: 'Enabled fixture' });
      expect((await pool.query('SELECT id FROM user_notifications WHERE user_id=$1 AND kind=$2', [userId, kind])).rowCount).toBe(1);
    }
    const invalid = response();
    await handlers.get('put /api/notification-prefs')({ ...req, body: { prefs: [{ kind: 'unknown', inApp: true, email: false }] } }, invalid);
    expect(invalid.status).toHaveBeenCalledWith(400);
  });

});
