import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { pool } from "../db";
import { ensureDomainsSchema } from "./schema";
import { registerDomainRoutes } from "./routes";
import { planForModule } from "@shared/plans";
import {
  saveConnection,
  preview,
  confirm,
  processJob,
  rollbackPreview,
  monitor,
} from "./service";
import { decryptToken } from "../gbp/token-crypto";
import type { DomainState, RegistrarAdapter } from "./types";
vi.mock("../account-events", () => ({
  notifyUser: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
}));
import { notifyUser, logActivity } from "../account-events";
let user: number, other: number, connection: number, domain: number;
const handlers = new Map<string, any>();
let state: DomainState = {
  domain: "fixture-0001.example.test",
  expires: "2027-01-01T00:00:00Z",
  autoRenew: true,
  status: "ACTIVE",
  nameservers: ["ns1.example.test", "ns2.example.test"],
  records: [
    {
      id: "1",
      name: "@",
      type: "MX",
      content: "mail.example.test",
      ttl: 600,
      priority: 10,
    },
  ],
};
const write = vi.fn();
const a: RegistrarAdapter = {
  list: async () => ({ domains: [state], next: null }),
  read: async () => structuredClone(state),
  setNameservers: async (_d, ns) => {
    write();
    state.nameservers = ns;
  },
  createRecord: async (_d, r) => {
    write();
    const created = { ...r, id: "2" };
    state.records.push(created);
    return created;
  },
  updateRecord: async (_d, r) => {
    write();
    state.records = state.records.map((x) => (x.id === r.id ? r : x));
  },
  deleteRecord: async (_d, r) => {
    write();
    state.records = state.records.filter((x) => x.id !== r.id);
  },
};
async function call(
  method: string,
  path: string,
  body = {},
  query = {},
  who = user,
  recent = true,
) {
  let code = 200,
    data: any;
  const req: any = {
    body,
    query,
    user: { id: who },
    session: {
      recentAuth: recent ? { userId: who, at: Date.now() } : undefined,
    },
    headers: {},
  };
  const res: any = {
    status: (n: number) => {
      code = n;
      return res;
    },
    json: (d: any) => {
      data = d;
      return res;
    },
  };
  await handlers.get(`${method}${path}`)(req, res);
  return { code, data };
}
const job = async (id: string) =>
  (await pool.query("SELECT * FROM domain_jobs WHERE id=$1", [id])).rows[0];
beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname))
    throw new Error("a7 DB required");
  await ensureDomainsSchema();
  await ensureDomainsSchema();
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES('a7-domains-'||gen_random_uuid()||'@example.test'),('a7-domains-other-'||gen_random_uuid()||'@example.test') RETURNING id",
  );
  [user, other] = rows.map((r) => r.id);
  // The fixture owner is on the plan that includes Domains + Gmail alerts (the worker checks it per job).
  await pool.query(
    "INSERT INTO subscriptions(user_id,plan,status) VALUES($1,$2,'active')",
    [user, planForModule("domainsMailAlerts")],
  );
  const locations = await pool.query(
    "INSERT INTO business_locations(user_id,business_name,website) SELECT $1,'Fixture client '||n,'https://fixture-'||lpad(n::text,4,'0')||'.example.test' FROM generate_series(1,1000) n RETURNING id",
    [user],
  );
  await pool.query(
    "INSERT INTO managed_domains(user_id,domain,location_id) SELECT $1,'fixture-'||lpad(n::text,4,'0')||'.example.test',($2::int[])[n] FROM generate_series(1,1000) n",
    [user, locations.rows.map((r) => r.id)],
  );
  connection = Number(
    await saveConnection(
      user,
      "porkbun",
      "Fixture connection",
      "a7-secret-key",
      "a7-secret-token",
    ),
  );
  domain = Number(
    (
      await pool.query(
        "UPDATE managed_domains SET connection_id=$2,registrar='porkbun' WHERE user_id=$1 AND domain='fixture-0001.example.test' RETURNING id",
        [user, connection],
      )
    ).rows[0].id,
  );
  const app: any = { use: () => {} };
  for (const method of ["get", "post"])
    app[method] = (path: string, fn: any) => handlers.set(method + path, fn);
  registerDomainRoutes(app, (req, res) =>
    req.user?.id ? req.user : (res.status(401).json({}), null),
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM subscriptions WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM managed_domains WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1)", [
    [user, other],
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[user, other]]);
  await pool.end();
});
it("paginates and searches 1000 seeded locations/domains with owner scoping", async () => {
  const first = await call("get", "/api/domains", {}, {});
  expect(first.data.total).toBe(1000);
  expect(first.data.items).toHaveLength(25);
  const last = await call("get", "/api/domains", {}, { page: "40" });
  expect(last.data.items).toHaveLength(25);
  expect(last.data.items[24].domain).toBe("fixture-1000.example.test");
  const search = await call("get", "/api/domains", {}, { q: "fixture-0999" });
  expect(search.data.items).toHaveLength(1);
  const locations = await call(
    "get",
    "/api/domains/locations",
    {},
    { q: "Fixture client 999" },
  );
  expect(locations.data.items).toHaveLength(1);
  expect((await call("get", "/api/domains", {}, {}, other)).data.total).toBe(0);
  expect(
    (
      await call(
        "post",
        "/api/domains/mapping",
        { ids: [domain], locationId: null },
        {},
        other,
      )
    ).code,
  ).toBe(404);
  expect((await call("get", "/api/domains", {}, { limit: "9999" })).code).toBe(
    400,
  );
  expect((await call("get", "/api/domains", {}, {}, 0)).code).toBe(401);
});
it("encrypts credentials and never returns them through connections", async () => {
  const c = (
    await pool.query("SELECT credentials FROM domain_connections WHERE id=$1", [
      connection,
    ])
  ).rows[0];
  expect(c.credentials).toMatch(/^v1:/);
  expect(c.credentials).not.toContain("a7-secret");
  expect(decryptToken(c.credentials)).toContain("a7-secret-token");
  expect(
    JSON.stringify((await call("get", "/api/domains/connections")).data),
  ).not.toContain("credentials");
});
it("requires a real preview, confirmation warning, step-up, and rejects foreign jobs", async () => {
  const [id] = await preview(user, [domain], {
    kind: "nameservers",
    nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
  });
  expect(write).not.toHaveBeenCalled();
  await expect(confirm(user, [id], true)).rejects.toThrow("Preview");
  await processJob(await job(id), { adapter: () => a });
  expect((await job(id)).status).toBe("ready");
  expect(
    (
      await call(
        "post",
        "/api/domains/confirm",
        { jobIds: [id], confirmed: true, emailWarningAccepted: true },
        {},
        user,
        false,
      )
    ).code,
  ).toBe(403);
  await expect(confirm(other, [id], true)).rejects.toThrow();
  await expect(confirm(user, [id], false)).rejects.toThrow("Acknowledge");
  await confirm(user, [id], true);
  await processJob(await job(id), { adapter: () => a });
  expect(write).toHaveBeenCalledTimes(1);
  expect((await job(id)).status).toBe("verifying");
  await processJob(await job(id), {
    adapter: () => a,
    http: async () =>
      new Response(
        JSON.stringify({
          Status: 0,
          Answer: state.nameservers.map((data) => ({
            type: 2,
            data: data + ".",
          })),
        }),
      ),
  });
  expect((await job(id)).status).toBe("verified");
  expect(logActivity).toHaveBeenCalledWith(
    null,
    user,
    "domains.changed",
    expect.objectContaining({ jobId: id }),
  );
  const [rollback] = await rollbackPreview(user, id);
  await processJob(await job(rollback), { adapter: () => a });
  expect((await job(rollback)).after_state.nameservers).toEqual([
    "ns1.example.test",
    "ns2.example.test",
  ]);
  await confirm(user, [rollback], true);
  await processJob(await job(rollback), { adapter: () => a });
  expect(state.nameservers).toEqual(["ns1.example.test", "ns2.example.test"]);
});
it("detects stale previews and preserves MX snapshot for rollback", async () => {
  const [id] = await preview(user, [domain], {
    kind: "update",
    record: {
      name: "@",
      type: "MX",
      content: "newmail.example.test",
      ttl: 600,
      priority: 20,
    },
  });
  await processJob(await job(id), { adapter: () => a });
  expect((await job(id)).before_state.records[0].content).toBe(
    "mail.example.test",
  );
  await confirm(user, [id], true);
  state.records[0].priority = 30;
  const calls = write.mock.calls.length;
  await expect(processJob(await job(id), { adapter: () => a })).rejects.toThrow(
    "changed since preview",
  );
  expect(write).toHaveBeenCalledTimes(calls);
  state.records[0].priority = 10;
  const [fresh] = await preview(user, [domain], {
    kind: "delete",
    record: state.records[0],
  });
  await processJob(await job(fresh), { adapter: () => a });
  await confirm(user, [fresh], true);
  await processJob(await job(fresh), { adapter: () => a });
  expect((await job(fresh)).result.inverse.record.content).toBe(
    "mail.example.test",
  );
});
it("monitors manual-only DNS, SSL and expiry with deduplicated alerts", async () => {
  const d = {
    id: domain,
    user_id: user,
    domain: state.domain,
    state: {
      ...state,
      expires: new Date(Date.now() + 5 * 86400000).toISOString(),
      autoRenew: false,
    },
    observed: { [`${state.domain}:NS`]: ["old.example.test"] },
  };
  await pool.query(
    "UPDATE domain_jobs SET status='verified' WHERE user_id=$1 AND status='verifying'",
    [user],
  );
  const deps = {
    http: async () => new Response('{"Status":0,"Answer":[]}'),
    health: async () => ({
      up: false,
      sslExpires: new Date(Date.now() + 5 * 86400000).toISOString(),
    }),
  };
  await monitor(d, deps);
  expect(notifyUser).toHaveBeenCalledWith(
    user,
    "domains.monitor",
    expect.objectContaining({
      title: "Domain nameservers changed outside ConstructHUB",
    }),
  );
  const count = (
    await pool.query(
      "SELECT count(*)::int n FROM domain_alert_dedup WHERE domain_id=$1",
      [domain],
    )
  ).rows[0].n;
  expect(count).toBe(5);
});

it("cannot disguise deletion of an MX record to bypass the email warning", async () => {
  state.records = [
    {
      id: "91",
      name: "@",
      type: "MX",
      content: "mx.example.test",
      ttl: 300,
      priority: 10,
    },
  ];
  const [id] = await preview(user, [domain], {
    kind: "delete",
    record: {
      id: "91",
      name: "@",
      type: "A",
      content: "192.0.2.1",
      ttl: 600,
      priority: 0,
    },
  });
  await processJob(await job(id), { adapter: () => a });
  expect((await job(id)).payload.change.record.type).toBe("MX");
  await expect(confirm(user, [id], false)).rejects.toThrow("Acknowledge");
  const [update] = await preview(user, [domain], {
    kind: "update",
    record: {
      id: "91",
      name: "@",
      type: "A",
      content: "192.0.2.1",
      ttl: 600,
      priority: 0,
    },
  });
  await processJob(await job(update), { adapter: () => a });
  await expect(confirm(user, [update], false)).rejects.toThrow("Acknowledge");
});

it("persists rollback intent before an ambiguous write and never replays it after a crash", async () => {
  const { runDomainWorker } = await import("./service");
  await pool.query(
    "UPDATE domain_jobs SET status='complete' WHERE user_id=$1",
    [user],
  );
  const [id] = await preview(user, [domain], {
    kind: "nameservers",
    nameservers: ["crash-a.example.test", "crash-b.example.test"],
  });
  await processJob(await job(id), { adapter: () => a });
  await confirm(user, [id], true);
  const failing = {
    ...a,
    setNameservers: vi.fn(async () => {
      throw new Error(
        "Network interrupted after provider may have applied write",
      );
    }),
  };
  await runDomainWorker({ adapter: () => failing });
  expect((await job(id)).status).toBe("uncertain");
  expect((await job(id)).result.inverse.nameservers).toEqual(state.nameservers);
  await runDomainWorker({ adapter: () => failing });
  expect(failing.setNameservers).toHaveBeenCalledTimes(1);
  const [rollback] = await rollbackPreview(user, id);
  expect((await job(rollback)).status).toBe("previewing");
});

it("removes a saved registrar key behind step-up, keeps the domains and job history, and stops its queued work", async () => {
  const { CONNECTION_REMOVED, CONNECTION_REMOVED_VERIFY } = await import("./service");
  const removable = Number(
    await saveConnection(user, "namecom", "I- removable key", "i-key", "i-secret"),
  );
  const discover = (
    await pool.query(
      "SELECT id FROM domain_jobs WHERE connection_id=$1 AND kind='discover'",
      [removable],
    )
  ).rows[0].id;
  const kept = Number(
    (
      await pool.query(
        "UPDATE managed_domains SET connection_id=$2,registrar='namecom' WHERE user_id=$1 AND domain='fixture-0002.example.test' RETURNING id",
        [user, removable],
      )
    ).rows[0].id,
  );
  // One change waiting for confirmation, one applied and still verifying, one finished (history).
  const [waiting] = await preview(user, [kept], {
    kind: "nameservers",
    nameservers: ["i-a.example.test", "i-b.example.test"],
  });
  const verifying = crypto.randomUUID(),
    done = crypto.randomUUID();
  await pool.query(
    "INSERT INTO domain_jobs(id,user_id,domain_id,connection_id,kind,status) VALUES($1,$3,$4,$5,'change','verifying'),($2,$3,$4,$5,'change','verified')",
    [verifying, done, user, kept, removable],
  );
  // The list names each saved key without its secret; another account sees none of them.
  const saved = await call("get", "/api/domains/saved-connections");
  expect(saved.data.items).toEqual(
    expect.arrayContaining([
      { id: removable, provider: "namecom", label: "I- removable key" },
    ]),
  );
  expect(JSON.stringify(saved.data)).not.toMatch(/i-secret|credentials/);
  expect(
    (await call("get", "/api/domains/saved-connections", {}, {}, other)).data,
  ).toEqual({ items: [] });
  // Step-up re-auth, owner scoping, and all-or-nothing ids.
  expect(
    (
      await call("post", "/api/domains/disconnect", { ids: [removable] }, {}, user, false)
    ).data,
  ).toMatchObject({ reauth: true });
  expect(
    (await call("post", "/api/domains/disconnect", { ids: [removable] }, {}, other)).code,
  ).toBe(404);
  expect(
    (await call("post", "/api/domains/disconnect", { ids: [removable, 2147483000] })).code,
  ).toBe(404);
  expect(
    (await pool.query("SELECT 1 FROM domain_connections WHERE id=$1", [removable])).rowCount,
  ).toBe(1);
  const removed = await call("post", "/api/domains/disconnect", {
    ids: [removable, removable],
  });
  expect(removed.code).toBe(200);
  expect(removed.data.results).toHaveLength(1);
  expect(removed.data.results[0].message).toContain(
    "The key still works at Name.com until you delete it there (API token management).",
  );
  expect(removed.data.results[0].message).toContain(
    "2 queued tasks for this key were stopped before reaching Name.com. 1 applied change is no longer verified here; check it at Name.com.",
  );
  expect(
    (await pool.query("SELECT 1 FROM domain_connections WHERE id=$1", [removable])).rowCount,
  ).toBe(0);
  // The domain stays, without a connection; history stays; pending work is closed with a reason.
  expect(
    (await pool.query("SELECT connection_id FROM managed_domains WHERE id=$1", [kept])).rows[0]
      .connection_id,
  ).toBeNull();
  const rows = Object.fromEntries(
    (
      await pool.query(
        "SELECT id,status,error,connection_id FROM domain_jobs WHERE id=ANY($1::uuid[])",
        [[discover, waiting, verifying, done]],
      )
    ).rows.map((r) => [r.id, r]),
  );
  expect(rows[discover]).toMatchObject({ status: "failed", error: CONNECTION_REMOVED, connection_id: null });
  expect(rows[waiting]).toMatchObject({ status: "failed", error: CONNECTION_REMOVED, connection_id: null });
  expect(rows[verifying]).toMatchObject({ status: "verification_failed", error: CONNECTION_REMOVED_VERIFY, connection_id: null });
  expect(rows[done]).toMatchObject({ status: "verified", connection_id: null });
  expect(logActivity).toHaveBeenCalledWith(expect.anything(), user, "domains.disconnected", {
    provider: "namecom",
    connectionId: removable,
  });
  expect(notifyUser).toHaveBeenCalledWith(
    user,
    "domains.disconnected",
    expect.objectContaining({ title: "Registrar API key removed", body: "I- removable key" }),
  );
  // Without a key, the domain can't be changed from ConstructHUB any more.
  await expect(
    preview(user, [kept], { kind: "nameservers", nameservers: ["x.example.test", "y.example.test"] }),
  ).rejects.toThrow("Manual domains");
});
