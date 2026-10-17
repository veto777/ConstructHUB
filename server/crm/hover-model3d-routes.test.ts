/**
 * In-app HOVER 3D viewer — the HTTP routes (server/crm/hover-model3d.ts): org isolation, client-portal and
 * public-estimate scoping, fallback statuses, and the wireframe proxy.
 *
 * Runs against the local dev server (DEV_AUTH_BYPASS_USER1=true, CRM_TEST_BASE_URL) with a LOCAL STUB standing in
 * for hover.to — tmp/hover-stub.json points the dev server at it (the non-production override in hover.ts), exactly
 * like hover.test.ts. The dev server needs HOVER_CLIENT_ID/SECRET set (any value; they only reach the stub).
 * The HOVER connection is made through the real connect + OAuth-callback flow against the stub. The org's
 * custom_fields are snapshotted and restored; every fixture row is deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import pg from "pg";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const STUB_PORT = Number(process.env.TEST_HOVER_PORT);
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const STUB_FILE = path.join(process.cwd(), "tmp", "hover-stub.json");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function api(p: string, cookie?: string) {
  const res = await fetch(`${BASE}${p}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: body as any, ct, headers: res.headers, setCookie: res.headers.get("set-cookie") };
}

// A synthetic 30 × 20 ft gable box in HOVER's documented XML 3D export format (no real address).
const XML = `<?xml version="1.0" encoding="UTF-8"?><DATA_EXPORT><LOCATION address="Synthetic Box" lat="1" long="2"/><STRUCTURES><ROOF id="ROOF1"><FACES>
<FACE id="F1" type="ROOF" name="RF-1"><POLYGON id="P1" path="L3,L11,L15,L14" size="335.41" pitch="6"/></FACE>
<FACE id="F2" type="ROOF" name="RF-2"><POLYGON id="P2" path="L7,L13,L15,L10" size="335.41" pitch="6"/></FACE>
<FACE id="F3" type="WALL" name="SI-1"><POLYGON id="P3" path="L1,L2,L3,L4" size="300"/></FACE>
</FACES><LINES>
<LINE id="L1" path="C1,C2"/><LINE id="L2" path="C2,C6"/><LINE id="L3" type="EAVE" path="C6,C5"/><LINE id="L4" path="C1,C5"/>
<LINE id="L7" type="EAVE" path="C7,C8"/><LINE id="L10" type="RAKE" path="C8,C9"/><LINE id="L11" type="RAKE" path="C9,C5"/>
<LINE id="L13" type="RAKE" path="C7,C10"/><LINE id="L14" type="RAKE" path="C10,C6"/><LINE id="L15" type="RIDGE" path="C9,C10"/>
</LINES><POINTS>
<POINT id="C1" data="0,0,0"/><POINT id="C2" data="30,0,0"/><POINT id="C5" data="0,0,10"/><POINT id="C6" data="30,0,10"/>
<POINT id="C7" data="30,20,10"/><POINT id="C8" data="0,20,10"/><POINT id="C9" data="0,10,15"/><POINT id="C10" data="30,10,15"/>
</POINTS></ROOF></STRUCTURES></DATA_EXPORT>`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// Job ids → model ids → behaviour. Unique to this file so a shared dev DB never collides with hover.test.ts.
const JOB = { ready: 93101, missing: 93102, limited: 93103, other: 93104 };
const MODEL = { ready: 7101, missing: 7102, limited: 7103, other: 7104 };

const stub = {
  server: null as http.Server | null,
  paths: [] as string[],
};

function startStub(): Promise<void> {
  stub.server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", STUB);
    stub.paths.push(u.pathname);
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/oauth/token") {
      return json(200, { access_token: "at-3d-routes", refresh_token: "rt-3d-routes", expires_in: 7200, scope: "public" });
    }
    const job = /^\/api\/v3\/jobs\/(\d+)$/.exec(u.pathname);
    if (job) {
      const entry = Object.entries(JOB).find(([, id]) => String(id) === job[1]);
      if (!entry) return json(404, {});
      const modelId = MODEL[entry[0] as keyof typeof MODEL];
      return json(200, { id: Number(job[1]), models: [{ id: modelId, state: "complete", artifacts: { cad_exports: { xml_v2: `${STUB}/api/v3/models/${modelId}/artifacts/cad_export.xml?version=v2` } } }] });
    }
    const xml = /^\/api\/v3\/models\/(\d+)\/artifacts\/cad_export\.xml$/.exec(u.pathname);
    if (xml) {
      if (xml[1] === String(MODEL.ready) || xml[1] === String(MODEL.other)) {
        res.writeHead(200, { "content-type": "application/octet-stream" }); // what live HOVER sends
        return res.end(XML);
      }
      if (xml[1] === String(MODEL.limited)) return json(429, { error: "slow down" }, { "retry-after": "9" });
      return json(404, { error: "not found" });
    }
    const wf = /^\/api\/v3\/models\/(\d+)\/artifacts\/wireframe_(\w+)\.png$/.exec(u.pathname);
    if (wf && ((wf[1] === String(MODEL.ready) && wf[2] === "front") || (wf[1] === String(MODEL.missing) && wf[2] === "roof" && u.searchParams.get("version") === "lengths"))) {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    return json(404, {});
  });
  return new Promise((r) => stub.server!.listen(STUB_PORT, "127.0.0.1", () => r()));
}

describe("HOVER 3D viewer routes (dev server + HOVER stub)", () => {
  let cookie: string | undefined;
  let orgId: string;
  let otherOrg: string;
  let savedCustomFields: any = null;
  let custA: string, custB: string, custC: string;
  const m: Record<string, string> = {};
  let estA: string, estC: string, tokenA: string, tokenC: string;
  let sessA: string, sessB: string;


  const insertMeasurement = async (org: string, customer: string | null, provider: string, jobId: number | null, raw: object = {}) =>
    (await q(`insert into crm_measurements (org_id, customer_id, provider, status, external_id, address_line1, raw_payload)
              values ($1,$2,$3,'ready',$4,'1 Synthetic Way',$5) returning id`,
      [org, customer, provider, jobId ? `hover:${jobId}` : null,
        JSON.stringify({ importSource: provider, ...(jobId ? { hoverJobId: String(jobId) } : {}), ...raw })]))[0].id as string;
  const session = async (ids: string[]) => {
    const raw = randomBytes(32).toString("hex");
    await q(`insert into crm_client_sessions (token_hash, customer_ids, expires_at, last_seen_at) values ($1,$2::jsonb, now() + interval '1 day', now())`,
      [sha256(raw), JSON.stringify(ids)]);
    return `crm_client=${raw}`;
  };

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    cookie = me.setCookie?.split(";")[0];
    orgId = me.body.org.id;
    const [org] = await q(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    savedCustomFields = org?.custom_fields ?? null;
    await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'hover' where id = $1`, [orgId]);

    await startStub();
    fs.mkdirSync(path.dirname(STUB_FILE), { recursive: true });
    fs.writeFileSync(STUB_FILE, JSON.stringify({ oauthBase: STUB, apiBase: `${STUB}/api` }));

    // Connect through the real flow: /connect mints the state, the callback exchanges the code at the stub.
    const connect = await api("/api/crm/integrations/hover/connect", cookie);
    expect(connect.status).toBe(302);
    const state = new URL(connect.headers.get("location")!).searchParams.get("state")!;
    const cb = await api(`/api/crm/integrations/hover/oauth/callback?code=stub-code&state=${encodeURIComponent(state)}`, cookie);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("hover=connected");

    const cust = async (org: string, name: string) =>
      (await q(`insert into crm_customers (org_id, display_name, portal_token) values ($1,$2, md5(random()::text)) returning id`, [org, name]))[0].id as string;
    custA = await cust(orgId, "Vitest 3D A");
    custB = await cust(orgId, "Vitest 3D B");
    custC = await cust(orgId, "Vitest 3D C (no capture)");
    otherOrg = (await q(`insert into crm_orgs (name, owner_user_id) values ('Vitest 3D other org', 1) returning id`))[0].id;
    const custX = await cust(otherOrg, "Other org client");

    m.ready = await insertMeasurement(orgId, custA, "hover", JOB.ready, { model3dUrl: `https://hover.to/3d/${JOB.ready}` });
    m.missing = await insertMeasurement(orgId, custB, "hover", JOB.missing);
    m.limited = await insertMeasurement(orgId, custB, "hover", JOB.limited);
    m.manual = await insertMeasurement(orgId, custA, "other", null);
    m.otherOrg = await insertMeasurement(otherOrg, custX, "hover", JOB.other);

    const est = async (c: string) => {
      const tok = randomBytes(18).toString("hex");
      const id = (await q(`insert into crm_estimates (org_id, customer_id, title, public_token, status, sent_at) values ($1,$2,'Vitest 3D estimate',$3,'sent',now()) returning id`, [orgId, c, tok]))[0].id;
      return { id, tok };
    };
    ({ id: estA, tok: tokenA } = await est(custA));
    ({ id: estC, tok: tokenC } = await est(custC));
    sessA = await session([custA]);
    sessB = await session([custB]);
  }, 60_000);

  afterAll(async () => {
    try {
      fs.rmSync(STUB_FILE, { force: true });
      if (orgId) {
        await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`, [orgId, JSON.stringify(savedCustomFields ?? {})]);
        await q(`delete from crm_attachments where org_id = $1 and kind = 'model3d' and ref_id = any($2)`, [orgId, [custA, custB, custC]]);
        await q(`delete from crm_estimates where id = any($1)`, [[estA, estC].filter(Boolean)]);
        await q(`delete from crm_measurements where id = any($1)`, [Object.values(m)]);
        await q(`delete from crm_client_sessions where customer_ids::text like '%' || $1 || '%' or customer_ids::text like '%' || $2 || '%'`, [custA, custB]);
        await q(`delete from crm_customers where id = any($1)`, [[custA, custB, custC].filter(Boolean)]);
      }
      if (otherOrg) {
        for (const t of ["crm_attachments", "crm_measurements", "crm_customers"]) await q(`delete from ${t} where org_id = $1`, [otherOrg]);
        await q(`delete from crm_orgs where id = $1`, [otherOrg]);
      }
    } finally {
      await new Promise<void>((r) => (stub.server ? stub.server.close(() => r()) : r()));
      await pool.end();
    }
  }, 60_000);

  describe("contractor", () => {
    it("ready: the mesh, the address and the contractor's own HOVER link", async () => {
      const r = await api(`/api/crm/measurements/${m.ready}/model3d`, cookie);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ready");
      expect(r.body.mesh.counts).toEqual({ roof: 2, wall: 1, opening: 0, skipped: 0 });
      expect(r.body.mesh.faces.find((f: any) => f.name === "RF-1")).toMatchObject({ type: "roof", areaSqft: 335.41, pitch: "6/12" });
      expect(r.body.mesh.location.address).toBe("Synthetic Box");
      expect(r.body.hoverAppUrl).toBe(`https://hover.to/3d/${JOB.ready}`);
      expect(r.body.share).toBeNull();
      expect(r.body.wireframeViews.map((v: any) => v.id)).toContain("roof-pitches");
      // Cached: a second view does not go back to HOVER.
      const before = stub.paths.filter((p) => p.endsWith("cad_export.xml")).length;
      expect((await api(`/api/crm/measurements/${m.ready}/model3d`, cookie)).body.status).toBe("ready");
      expect(stub.paths.filter((p) => p.endsWith("cad_export.xml")).length).toBe(before);
    });

    it("fallback statuses: no export → 200 unavailable; persistent 429 → 503 + Retry-After; not HOVER → 404", async () => {
      const miss = await api(`/api/crm/measurements/${m.missing}/model3d`, cookie);
      expect(miss.status).toBe(200);
      expect(miss.body).toMatchObject({ status: "unavailable", reason: "no_xml_export" });
      const lim = await api(`/api/crm/measurements/${m.limited}/model3d`, cookie);
      expect(lim.status).toBe(503);
      expect(lim.body).toMatchObject({ status: "rate_limited", retryAfterSec: 9 });
      expect(lim.headers.get("retry-after")).toBe("9");
      expect((await api(`/api/crm/measurements/${m.manual}/model3d`, cookie)).status).toBe(404);
    });

    it("wireframes stream through us as images; a view HOVER lacks is a 404; unknown views are refused", async () => {
      const front = await api(`/api/crm/measurements/${m.ready}/wireframes/front`, cookie);
      expect(front.status).toBe(200);
      expect(front.ct).toBe("image/png");
      expect(Buffer.compare(front.body, PNG)).toBe(0);
      const left = await api(`/api/crm/measurements/${m.ready}/wireframes/left`, cookie);
      expect(left.status).toBe(404);
      expect(left.body.status).toBe("unavailable");
      expect((await api(`/api/crm/measurements/${m.ready}/wireframes/..%2F..%2Fetc`, cookie)).status).toBe(404);
      expect((await api(`/api/crm/measurements/${m.ready}/wireframes/constructor`, cookie)).status).toBe(404);
    });

    it("org isolation: another org's capture is a 404 and HOVER is never asked about it", async () => {
      const n = stub.paths.length;
      expect((await api(`/api/crm/measurements/${m.otherOrg}/model3d`, cookie)).status).toBe(404);
      expect((await api(`/api/crm/measurements/${m.otherOrg}/wireframes/front`, cookie)).status).toBe(404);
      expect(stub.paths.slice(n).some((p) => p.includes(String(JOB.other)) || p.includes(String(MODEL.other)))).toBe(false);
      // No session at all → no model.
      expect((await fetch(`${BASE}/api/client/measurements/${m.ready}/model3d`)).status).toBe(401);
    });
  });

  describe("client portal", () => {
    it("the client's own capture: mesh without the location, no contractor link", async () => {
      const r = await api(`/api/client/measurements/${m.ready}/model3d`, sessA);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ready");
      expect(r.body.mesh.location).toBeNull();
      expect(r.body.address).toBeNull();
      expect(r.body.hoverAppUrl).toBeNull();
      expect(JSON.stringify(r.body)).not.toContain("hover.to/3d/");
      const wf = await api(`/api/client/measurements/${m.ready}/wireframes/front`, sessA);
      expect(wf.status).toBe(200);
      expect(wf.ct).toBe("image/png");
    });

    it("another customer's capture is a 404 (same org), and so is another org's", async () => {
      expect((await api(`/api/client/measurements/${m.missing}/model3d`, sessA)).status).toBe(404);
      expect((await api(`/api/client/measurements/${m.missing}/wireframes/front`, sessA)).status).toBe(404);
      expect((await api(`/api/client/measurements/${m.ready}/model3d`, sessB)).status).toBe(404);
      expect((await api(`/api/client/measurements/${m.otherOrg}/model3d`, sessA)).status).toBe(404);
      expect((await api(`/api/client/measurements/${m.manual}/model3d`, sessA)).status).toBe(404);
    });

    it("a capture with no 3D export: no card, but the client's own routes answer honestly (and wireframes still flow)", async () => {
      // m.missing is now known-unavailable (contractor test above) and has no share. Authorization is not availability:
      // the client still reaches their own capture and gets the fallback status, never a 404.
      const own = await api(`/api/client/measurements/${m.missing}/model3d`, sessB);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ status: "unavailable", reason: "no_xml_export", share: null });
      const docsB = await api(`/api/client/documents`, sessB);
      expect(docsB.body.reports.find((r: any) => r.id === m.missing).viewer3d).toBe(false);
      // HOVER has roof lengths for it (the live shape: image/png, no redirect) — the wireframe route serves it, and
      // with a wireframe cached the card comes back.
      const wf = await api(`/api/client/measurements/${m.missing}/wireframes/roof-lengths`, sessB);
      expect(wf.status).toBe(200);
      expect(wf.ct).toBe("image/png");
      expect((await api(`/api/client/documents`, sessB)).body.reports.find((x: any) => x.id === m.missing).viewer3d).toBe(true);
      expect((await api(`/api/client/measurements/${m.missing}/wireframes/front`, sessB)).status).toBe(404);
      await q(`update crm_measurements set raw_payload = raw_payload || $2::jsonb where id = $1`, [m.missing, JSON.stringify({
        share: { url: "https://hover.to/shared/vitestShareBBBB", token: "vitestShareBBBB", expiresAt: new Date(Date.now() + 86400_000).toISOString(), source: "manual" },
      })]);
      const r = await api(`/api/client/measurements/${m.missing}/model3d`, sessB);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: "unavailable", reason: "no_xml_export", share: { url: "https://hover.to/shared/vitestShareBBBB" } });
      expect((await api(`/api/client/documents`, sessB)).body.reports.find((x: any) => x.id === m.missing).viewer3d).toBe(true);
      expect((await api(`/api/client/documents`, sessA)).body.reports.find((x: any) => x.id === m.ready).viewer3d).toBe(true);
    });
  });

  describe("public estimate", () => {
    it("behind the estimate's email gate; the estimate's own customer's capture only", async () => {
      const gated = await api(`/api/public/estimates/${tokenA}/model3d`);
      expect(gated.status).toBe(401);
      expect(gated.body.requiresVerification).toBe(true);
      expect((await api(`/api/public/estimates/${tokenA}/model3d`, sessB)).status).toBe(401);
      const r = await api(`/api/public/estimates/${tokenA}/model3d`, sessA);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("ready");
      expect(r.body.measurementId).toBe(m.ready);
      expect(r.body.mesh.location).toBeNull();
      expect(r.body.hoverAppUrl).toBeNull();
      expect((await api(`/api/public/estimates/${tokenA}/wireframes/front`, sessA)).status).toBe(200);
      const page = await api(`/api/public/estimates/${tokenA}`, sessA);
      expect(page.status).toBe(200);
      expect(page.body.viewer3d).toBe(true);
    });

    it("an estimate whose customer has no HOVER capture → 404 and no viewer offered; bad tokens → 404", async () => {
      const sessC = await session([custC]);
      expect((await api(`/api/public/estimates/${tokenC}/model3d`, sessC)).status).toBe(404);
      expect((await api(`/api/public/estimates/${tokenC}`, sessC)).body.viewer3d).toBe(false);
      expect((await api(`/api/public/estimates/short/model3d`, sessA)).status).toBe(404);
      expect((await api(`/api/public/estimates/${"z".repeat(36)}/model3d`, sessA)).status).toBe(404);
    });
  });
});
