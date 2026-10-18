/**
 * In-app HOVER 3D viewer — the loaders behind GET …/model3d and …/wireframes/:view (server/crm/hover-model3d.ts).
 *
 * DB-level against the local dev database (no dev server): a throwaway org with a HOVER connection and an in-process
 * fake of hover.to passed as fetchFn — nothing reaches the network (the fake throws on any URL it does not know).
 * The XML served is the SYNTHETIC gable box from hover-mesh.test.ts's format (no real address). Everything created is
 * deleted afterwards. The HTTP routes (org isolation, client scoping, role gates) are in hover-model3d-routes.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import fs from "fs";
import path from "path";

process.env.DATABASE_URL ??= "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
process.env.STRIPE_SECRET_KEY ??= "sk_test_vitest_stub";

const hover = await import("./hover");
const m3d = await import("./hover-model3d");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = <T = any>(text: string, params: any[] = []) => pool.query(text, params).then((r) => r.rows as T[]);

const SYNTH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DATA_EXPORT><LOCATION address="Synthetic Box" lat="1" long="2"/><STRUCTURES><ROOF id="ROOF1"><FACES>
<FACE id="F1" type="ROOF" name="RF-1"><POLYGON id="P1" path="L3,L11,L15,L14" size="335.41" pitch="6"/></FACE>
<FACE id="F2" type="ROOF" name="RF-2"><POLYGON id="P2" path="L7,L13,L15,L10" size="335.41" pitch="6"/></FACE>
<FACE id="F3" type="WALL" children="F4" name="SI-1"><POLYGON id="P3" path="L1,L2,L3,L4" size="288"/></FACE>
<FACE id="F4" type="WALLPENETRATION"><POLYGON id="P4" path="L16,L17,L18,L19" pitch="Infinity"/></FACE>
<FACE id="F6" type="WALL" name="SI-2"><POLYGON id="P6" path="L5,L6,L7,L8" size="300"/></FACE>
<FACE id="F7" type="WALL" name="SI-3"><POLYGON id="P7" path="L9,L8,L10,L11,L4" size="250"/></FACE>
<FACE id="F8" type="WALL" name="SI-4"><POLYGON id="P8" path="L12,L6,L13,L14,L2" size="250"/></FACE>
</FACES><LINES>
<LINE id="L1" type="BOTTOMWALL" path="C1,C2"/><LINE id="L2" path="C2,C6"/><LINE id="L3" type="EAVE" path="C6,C5"/>
<LINE id="L4" path="C1,C5"/><LINE id="L5" path="C4,C3"/><LINE id="L6" path="C3,C7"/><LINE id="L7" type="EAVE" path="C7,C8"/>
<LINE id="L8" path="C8,C4"/><LINE id="L9" path="C1,C4"/><LINE id="L10" type="RAKE" path="C8,C9"/>
<LINE id="L11" type="RAKE" path="C9,C5"/><LINE id="L12" path="C2,C3"/><LINE id="L13" type="RAKE" path="C7,C10"/>
<LINE id="L14" type="RAKE" path="C10,C6"/><LINE id="L15" type="RIDGE" path="C9,C10"/>
<LINE id="L16" path="C11,C12"/><LINE id="L17" path="C12,C13"/><LINE id="L18" path="C13,C14"/><LINE id="L19" path="C14,C11"/>
</LINES><POINTS>
<POINT id="C1" data="0,0,0"/><POINT id="C2" data="30,0,0"/><POINT id="C3" data="30,20,0"/><POINT id="C4" data="0,20,0"/>
<POINT id="C5" data="0,0,10"/><POINT id="C6" data="30,0,10"/><POINT id="C7" data="30,20,10"/><POINT id="C8" data="0,20,10"/>
<POINT id="C9" data="0,10,15"/><POINT id="C10" data="30,10,15"/>
<POINT id="C11" data="5,0,3"/><POINT id="C12" data="8,0,3"/><POINT id="C13" data="8,0,7"/><POINT id="C14" data="5,0,7"/>
</POINTS></ROOF></STRUCTURES></DATA_EXPORT>`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** In-process hover.to. Per-model behaviour for the XML export; every call is logged. */
function fakeHover() {
  const st = {
    calls: [] as { path: string; auth: string | null; host: string; url: string }[],
    jobs: new Map<string, any>(),
    xml: new Map<string, { status: number; body?: string; retryAfter?: string }>(),
    wf: new Map<string, () => Response>(),
  };
  const json = (code: number, body: any, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json", ...headers } });
  const fetchFn = (async (input: any, init: any) => {
    const u = new URL(String(input));
    const auth = (init?.headers as any)?.authorization ?? null;
    st.calls.push({ path: u.pathname, auth, host: u.host, url: u.toString() });
    if (u.pathname === "/oauth/token") return json(200, { access_token: "at-model3d", refresh_token: "rt-model3d", expires_in: 7200 });
    const job = /^\/api\/v3\/jobs\/(\d+)$/.exec(u.pathname);
    if (job) return st.jobs.has(job[1]) ? json(200, st.jobs.get(job[1])) : json(404, {});
    const xml = /^\/api\/v3\/models\/(\d+)\/artifacts\/cad_export\.xml$/.exec(u.pathname);
    if (xml) {
      expect(u.searchParams.get("version")).toBe("v2");
      const r = st.xml.get(xml[1]) ?? { status: 404 };
      if (r.status !== 200) return json(r.status, { error: "x" }, r.retryAfter ? { "retry-after": r.retryAfter } : {});
      // Live HOVER serves the export as application/octet-stream (verified 2026-10-17) — never rely on an XML type.
      return new Response(r.body ?? SYNTH_XML, { status: 200, headers: { "content-type": "application/octet-stream" } });
    }
    const wf = /^\/api\/v3\/models\/(\d+)\/artifacts\/wireframe_(\w+)\.png$/.exec(u.pathname);
    if (wf) {
      const key = `${wf[2]}:${u.searchParams.get("version")}`;
      const override = st.wf.get(key);
      if (override) return override();
      if (key === "front:url") return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
      if (key === "back:url") return new Response(null, { status: 302, headers: { location: "https://storage.hover.test/signed/back.png?sig=1" } });
      if (key === "right:url") return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
      if (key === "roof:areas") return json(200, { url: "https://storage.hover.test/signed/areas.png" });
      if (key === "roof:pitches") return new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "image/png" } });
      return json(404, {});
    }
    if (u.host === "storage.hover.test") {
      const chain = /^\/chain\/(\d+)$/.exec(u.pathname);
      if (chain && Number(chain[1]) > 0) return new Response(null, { status: 302, headers: { location: `/chain/${Number(chain[1]) - 1}` } });
      if (u.pathname === "/to-metadata") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      if (u.pathname === "/to-internal") return new Response(null, { status: 302, headers: { location: "https://internal.hover.test/x.png" } });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }
    throw new Error(`fake hover: unexpected ${u.host}${u.pathname}`);
  }) as typeof fetch;
  return { st, fetchFn };
}

const job = (id: number, models: any[]) => ({ id, name: `Job ${id}`, models });
const xmlModel = (id: number) => ({
  id, state: "complete", deliverable: "complete",
  artifacts: { cad_exports: { xml_v2: `https://hover.to/api/v3/models/${id}/artifacts/cad_export.xml?version=v2` } },
});

describe("pure helpers", () => {
  it("pickExportModel prefers a completed model with an XML export; notes when the deliverable has none", () => {
    expect(m3d.pickExportModel(job(1, [{ id: 10, state: "failed" }, xmlModel(11)]))).toEqual({
      modelId: "11", xmlUrl: "https://hover.to/api/v3/models/11/artifacts/cad_export.xml?version=v2", xmlListed: true,
    });
    expect(m3d.pickExportModel(job(1, [{ id: 12, state: "complete", artifacts: { measurements: { pdf: "x" } } }])))
      .toEqual({ modelId: "12", xmlUrl: null, xmlListed: false });
    expect(m3d.pickExportModel(job(1, [{ id: 13 }]))).toEqual({ modelId: "13", xmlUrl: null, xmlListed: null });
    expect(m3d.pickExportModel(job(1, []))).toBeNull();
    expect(m3d.pickExportModel({ models: [{ id: "abc" }] })).toBeNull();
  });
  it("modelIdFromFullJson reads /models/<id>/ out of HOVER API URLs only", () => {
    expect(m3d.modelIdFromFullJson({ wireframes: { front: { wireframe_url: "https://hover.to/api/v3/models/4242/artifacts/wireframe_front.png" } } })).toBe("4242");
    expect(m3d.modelIdFromFullJson({ x: "https://evil.test/api/v3/models/1/" })).toBeNull();
    expect(m3d.modelIdFromFullJson(null)).toBeNull();
  });
  it("wireframe views are an allowlist", () => {
    expect(m3d.isWireframeView("front")).toBe(true);
    expect(m3d.isWireframeView("roof-pitches")).toBe(true);
    expect(m3d.isWireframeView("../../etc")).toBe(false);
    expect(m3d.isWireframeView("constructor")).toBe(false);
  });
});

describe("DB: model3d + wireframe loaders", () => {
  let orgId: string;
  let orgB: string;
  let custId: string;
  let otherCust: string;
  let fake: ReturnType<typeof fakeHover>;
  let seq = 8100;

  const measurement = async (opts: { jobId?: number | null; provider?: string; raw?: any; org?: string; customer?: string | null; status?: string } = {}) => {
    const jobId = opts.jobId === undefined ? ++seq : opts.jobId;
    const raw = { importSource: "hover", ...(jobId ? { hoverJobId: String(jobId) } : {}), ...(opts.raw ?? {}) };
    const [row] = await q(
      `insert into crm_measurements (org_id, customer_id, provider, status, external_id, address_line1, postal_code, raw_payload)
       values ($1,$2,$3,$4,$5,'1 Test Way','00001',$6) returning *`,
      [opts.org ?? orgId, opts.customer === undefined ? custId : opts.customer, opts.provider ?? "hover", opts.status ?? "ready",
        jobId ? `hover:${jobId}` : null, JSON.stringify(raw)],
    );
    // Drizzle-shaped row (camelCase) — the loaders only need these fields.
    return { id: row.id, orgId: row.org_id, customerId: row.customer_id, provider: row.provider, status: row.status, rawPayload: row.raw_payload } as any;
  };
  const rawOf = async (id: string) => (await q(`select raw_payload from crm_measurements where id = $1`, [id]))[0].raw_payload;
  const xmlCalls = () => fake.st.calls.filter((c) => c.path.endsWith("cad_export.xml")).length;
  const jobCalls = () => fake.st.calls.filter((c) => c.path.startsWith("/api/v3/jobs/")).length;

  beforeAll(async () => {
    hover.setHoverBackoffSleep(async () => {});
    // Test DNS: storage.hover.test is a public address, internal.hover.test a private one. Nothing else resolves.
    m3d.setModel3dDnsLookup(async (h) => (h === "storage.hover.test" ? ["93.184.216.34"] : h === "internal.hover.test" ? ["10.0.0.5"] : []));
    orgId = (await q(`insert into crm_orgs (name, owner_user_id) values ('HOVER model3d Vitest Org', 1) returning id`))[0].id;
    orgB = (await q(`insert into crm_orgs (name, owner_user_id) values ('HOVER model3d Vitest Org B (not connected)', 1) returning id`))[0].id;
    hover.clearHoverTokenCache(orgId);
    await q(`update crm_orgs set custom_fields = $2::jsonb where id = $1`, [orgId, JSON.stringify({
      hover: { refreshTokenEnc: hover.encryptHoverSecret("rt-model3d"), connectedAt: new Date().toISOString() },
    })]);
    custId = (await q(`insert into crm_customers (org_id, display_name, address_line1, postal_code, portal_token) values ($1,'Model Owner','1 Test Way','00001', md5(random()::text)) returning id`, [orgId]))[0].id;
    otherCust = (await q(`insert into crm_customers (org_id, display_name, portal_token) values ($1,'Someone Else', md5(random()::text)) returning id`, [orgId]))[0].id;
    fake = fakeHover();
  }, 30000);

  afterAll(async () => {
    hover.setHoverBackoffSleep(null);
    m3d.setModel3dDnsLookup(null);
    for (const o of [orgId, orgB].filter(Boolean)) {
      for (const t of ["crm_attachments", "crm_measurements", "crm_estimates", "crm_projects", "crm_customers"]) {
        await q(`delete from ${t} where org_id = $1`, [o]);
      }
      await q(`delete from crm_orgs where id = $1`, [o]);
    }
    await pool.end();
  });

  it("ready: job → model → XML v2 → mesh, stored once in gated storage (kind model3d, refId = customer)", async () => {
    const m = await measurement({ jobId: 9101 });
    fake.st.jobs.set("9101", job(9101, [xmlModel(555)]));
    fake.st.xml.set("555", { status: 200 });
    const r = await m3d.loadModel3d(m, { fetchFn: fake.fetchFn });
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.modelId).toBe("555");
    expect(r.cached).toBe(false);
    expect(r.mesh.counts).toEqual({ roof: 2, wall: 4, opening: 1, window: 0, door: 0, soffit: 0, skipped: 0 });
    // The bearer only ever went to HOVER's API.
    const xmlCall = fake.st.calls.find((c) => c.path === "/api/v3/models/555/artifacts/cad_export.xml")!;
    expect(xmlCall.auth).toBe("Bearer at-model3d");
    const raw = await rawOf(m.id);
    expect(raw.model3d).toMatchObject({ status: "ready", modelId: "555" });
    expect(raw.hoverJobId).toBe("9101"); // the rest of raw_payload is untouched
    const [att] = await q(`select * from crm_attachments where id = $1`, [raw.model3d.meshAttachmentId]);
    expect(att).toMatchObject({ org_id: orgId, kind: "model3d", ref_id: custId, mime: "application/json" });

    // Second load: from the cache, HOVER not asked again.
    const before = fake.st.calls.length;
    const again = await m3d.loadModel3d(m, { fetchFn: fake.fetchFn });
    expect(again).toMatchObject({ status: "ready", cached: true, modelId: "555" });
    expect(fake.st.calls.length).toBe(before);
  });

  it("concurrent loads of one measurement share ONE HOVER fetch", async () => {
    const m = await measurement({ jobId: 9102 });
    fake.st.jobs.set("9102", job(9102, [xmlModel(556)]));
    fake.st.xml.set("556", { status: 200 });
    const x0 = xmlCalls(), j0 = jobCalls();
    const all = await Promise.all(Array.from({ length: 5 }, () => m3d.loadModel3d(m, { fetchFn: fake.fetchFn })));
    expect(all.every((r) => r.status === "ready")).toBe(true);
    expect(xmlCalls() - x0).toBe(1);
    expect(jobCalls() - j0).toBe(1);
  });

  it("the model id stored in full_json skips the job lookup", async () => {
    const m = await measurement({ raw: { fullJson: { wireframes: { front: { wireframe_url: "https://hover.to/api/v3/models/557/artifacts/wireframe_front.png" } } } } });
    fake.st.xml.set("557", { status: 200 });
    const j0 = jobCalls();
    expect((await m3d.loadModel3d(m, { fetchFn: fake.fetchFn })).status).toBe("ready");
    expect(jobCalls()).toBe(j0);
  });

  it("HOVER has no XML for the model (404) → unavailable, remembered; refresh asks again", async () => {
    const m = await measurement({ raw: { model3d: { modelId: "558" } } });
    fake.st.xml.set("558", { status: 404 });
    expect(await m3d.loadModel3d(m, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "no_xml_export" });
    const x0 = xmlCalls();
    expect(await m3d.loadModel3d(m, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "no_xml_export" });
    expect(xmlCalls()).toBe(x0); // negative cache
    expect((await rawOf(m.id)).model3d).toMatchObject({ status: "unavailable", reason: "no_xml_export", modelId: "558" });
    fake.st.xml.set("558", { status: 200 });
    const r = await m3d.loadModel3d(m, { fetchFn: fake.fetchFn, refresh: true });
    expect(r.status).toBe("ready");
    expect((await rawOf(m.id)).model3d.reason).toBeNull();

    // A second refresh replaces the mesh and removes the superseded cache row + file (no orphans).
    const first = (await rawOf(m.id)).model3d.meshAttachmentId;
    const [firstAtt] = await q(`select storage_path from crm_attachments where id = $1`, [first]);
    const firstFile = path.join(process.cwd(), "tmp", "crm-attachments", firstAtt.storage_path);
    expect(fs.existsSync(firstFile)).toBe(true);
    expect((await m3d.loadModel3d(m, { fetchFn: fake.fetchFn, refresh: true })).status).toBe("ready");
    const second = (await rawOf(m.id)).model3d.meshAttachmentId;
    expect(second).not.toBe(first);
    expect(await q(`select id from crm_attachments where id = $1`, [first])).toHaveLength(0);
    expect(fs.existsSync(firstFile)).toBe(false);
    // A definitive refusal later drops the stale mesh too.
    fake.st.xml.set("558", { status: 404 });
    expect((await m3d.loadModel3d(m, { fetchFn: fake.fetchFn, refresh: true })).status).toBe("unavailable");
    expect(await q(`select id from crm_attachments where id = $1`, [second])).toHaveLength(0);
    expect((await rawOf(m.id)).model3d.meshAttachmentId).toBeNull();
  });

  it("403/400 → reported but NOT remembered; a deliverable without an XML export → no_xml_export without asking for it", async () => {
    const m1 = await measurement({ raw: { model3d: { modelId: "559" } } });
    fake.st.xml.set("559", { status: 403 });
    expect(await m3d.loadModel3d(m1, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "hover_refused" });
    expect((await rawOf(m1.id)).model3d.status).toBeUndefined();
    fake.st.xml.set("559", { status: 400 });
    expect(await m3d.loadModel3d(m1, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "no_xml_export" });
    expect((await rawOf(m1.id)).model3d.status).toBeUndefined();
    fake.st.xml.set("559", { status: 200 });
    expect((await m3d.loadModel3d(m1, { fetchFn: fake.fetchFn })).status).toBe("ready"); // the blip passed

    const m2 = await measurement({ jobId: 9105 });
    fake.st.jobs.set("9105", job(9105, [{ id: 560, state: "complete", artifacts: { measurements: { pdf: "https://hover.to/api/v3/models/560/artifacts/measurements.pdf" } } }]));
    const x0 = xmlCalls();
    expect(await m3d.loadModel3d(m2, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "no_xml_export" });
    expect(xmlCalls()).toBe(x0);

    const m3 = await measurement({ jobId: 9106 });
    fake.st.jobs.set("9106", job(9106, []));
    expect(await m3d.loadModel3d(m3, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "no_model" });
    const m4 = await measurement({ jobId: 9107 }); // HOVER does not know the job
    expect(await m3d.loadModel3d(m4, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "hover_not_found" });
  });

  it("an export without geometry → empty_geometry (remembered); garbage → bad_export (not remembered)", async () => {
    const m1 = await measurement({ raw: { model3d: { modelId: "561" } } });
    fake.st.xml.set("561", { status: 200, body: "<DATA_EXPORT><STRUCTURES/></DATA_EXPORT>" });
    expect(await m3d.loadModel3d(m1, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "empty_geometry" });
    expect((await rawOf(m1.id)).model3d.status).toBe("unavailable");
    const m2 = await measurement({ raw: { model3d: { modelId: "562" } } });
    fake.st.xml.set("562", { status: 200, body: "<html>login</html>" });
    expect(await m3d.loadModel3d(m2, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "bad_export" });
    expect((await rawOf(m2.id)).model3d.status).toBeUndefined();
  });

  it("bodies are read with a byte counter: an over-cap stream is cut off without trusting content-length", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); },
    });
    expect(await m3d.readCapped(new Response(endless), 10 * 1024)).toBeNull();
    expect(pulled).toBeLessThan(20); // stopped right after the cap, not at the end of the stream
    expect(await m3d.readCapped(new Response("x".repeat(100), { headers: { "content-length": "999999" } }), 1000)).toBeNull();
    expect((await m3d.readCapped(new Response("hello"), 1000))!.toString()).toBe("hello");
  });

  it("address vetting for third-party hops", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "garbage"]) {
      expect(m3d.isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(m3d.isPrivateAddress(ip), ip).toBe(false);
    expect(await m3d.publicHttpsTarget(new URL("https://storage.hover.test/a.png"))).toBe(true);
    expect(await m3d.publicHttpsTarget(new URL("https://internal.hover.test/a.png"))).toBe(false); // resolves private
    expect(await m3d.publicHttpsTarget(new URL("https://unresolvable.hover.test/a.png"))).toBe(false);
    expect(await m3d.publicHttpsTarget(new URL("http://storage.hover.test/a.png"))).toBe(false);
    expect(await m3d.publicHttpsTarget(new URL("https://169.254.169.254/latest"))).toBe(false);
    expect(await m3d.publicHttpsTarget(new URL("https://[::1]/x"))).toBe(false);
    expect(await m3d.publicHttpsTarget(new URL("https://u:p@storage.hover.test/x"))).toBe(false);
  });

  it("429 that persists → rate_limited with Retry-After, never cached", async () => {
    const m = await measurement({ raw: { model3d: { modelId: "563" } } });
    fake.st.xml.set("563", { status: 429, retryAfter: "7" });
    expect(await m3d.loadModel3d(m, { fetchFn: fake.fetchFn })).toEqual({ status: "rate_limited", retryAfterSec: 7 });
    expect((await rawOf(m.id)).model3d.status).toBeUndefined();
    fake.st.xml.set("563", { status: 200 });
    expect((await m3d.loadModel3d(m, { fetchFn: fake.fetchFn })).status).toBe("ready");
  });

  it("not a HOVER capture / org not connected", async () => {
    const manual = await measurement({ provider: "manual", jobId: null });
    expect(await m3d.loadModel3d(manual, { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "not_hover" });
    const custB = (await q(`insert into crm_customers (org_id, display_name, portal_token) values ($1,'B', md5(random()::text)) returning id`, [orgB]))[0].id;
    const inB = await measurement({ org: orgB, customer: custB });
    const n0 = fake.st.calls.length;
    expect(await m3d.loadModel3d(inB, { fetchFn: fake.fetchFn })).toEqual({ status: "not_connected" });
    expect(fake.st.calls.length).toBe(n0); // no token of another org was ever used
  });

  it("wireframes: streamed + cached; signed redirects / JSON urls followed WITHOUT our token; only 404/422 remembered", async () => {
    const m = await measurement({ raw: { model3d: { modelId: "570" } } });
    const front = await m3d.loadWireframe(m, "front", { fetchFn: fake.fetchFn });
    expect(front.status).toBe("ready");
    if (front.status === "ready") expect(front.mime).toBe("image/png");
    const n0 = fake.st.calls.length;
    expect((await m3d.loadWireframe(m, "front", { fetchFn: fake.fetchFn })).status).toBe("ready");
    expect(fake.st.calls.length).toBe(n0); // cached

    expect((await m3d.loadWireframe(m, "back", { fetchFn: fake.fetchFn })).status).toBe("ready");
    expect((await m3d.loadWireframe(m, "roof-areas", { fetchFn: fake.fetchFn })).status).toBe("ready");
    const storage = fake.st.calls.filter((c) => c.host === "storage.hover.test");
    expect(storage).toHaveLength(2);
    expect(storage.every((c) => c.auth === null)).toBe(true);

    // 404 → remembered.
    expect(await m3d.loadWireframe(m, "left", { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "hover_not_found" });
    // A redirect to an IP literal (cloud metadata) is never followed — and not remembered.
    expect(await m3d.loadWireframe(m, "right", { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "hover_not_found" });
    expect(fake.st.calls.some((c) => c.host.startsWith("169.254"))).toBe(false);
    // Not an image → not remembered.
    expect(await m3d.loadWireframe(m, "roof-pitches", { fetchFn: fake.fetchFn })).toEqual({ status: "unavailable", reason: "hover_not_found" });
    const n1 = fake.st.calls.length;
    await m3d.loadWireframe(m, "left", { fetchFn: fake.fetchFn });
    expect(fake.st.calls.length).toBe(n1);
    const raw = await rawOf(m.id);
    expect(Object.keys(raw.model3d.wireframes).sort()).toEqual(["back", "front", "left", "roof-areas"]);
    expect(raw.model3d.wireframes.left).toMatchObject({ missing: true });
    // The top view is HOVER's roof wireframe, version=top.
    await m3d.loadWireframe(m, "top", { fetchFn: fake.fetchFn });
    const top = fake.st.calls.filter((c) => c.path === "/api/v3/models/570/artifacts/wireframe_roof.png" && c.url.includes("version=top")).length;
    expect(top).toBeGreaterThan(0);

    // A cached file that vanished is re-fetched and the superseded cache row is removed (no orphans).
    const oldId = raw.model3d.wireframes.front.attachmentId;
    const [oldAtt] = await q(`select storage_path from crm_attachments where id = $1`, [oldId]);
    fs.rmSync(path.join(process.cwd(), "tmp", "crm-attachments", oldAtt.storage_path));
    expect((await m3d.loadWireframe(m, "front", { fetchFn: fake.fetchFn })).status).toBe("ready");
    expect(await q(`select id from crm_attachments where id = $1`, [oldId])).toHaveLength(0);
    expect((await rawOf(m.id)).model3d.wireframes.front.attachmentId).not.toBe(oldId);
  });

  it("redirect chains: every hop vetted by hand (https, public DNS), ≤3 hops; transient refusals are not remembered", async () => {
    const m = await measurement({ raw: { model3d: { modelId: "571" } } });
    const to = (loc: string) => () => new Response(null, { status: 302, headers: { location: loc } });
    const storageCalls = () => fake.st.calls.filter((c) => c.host === "storage.hover.test").length;

    // A vetted first hop that redirects on to http://169.254.169.254 — the second hop is refused.
    fake.st.wf.set("front:url", to("https://storage.hover.test/to-metadata"));
    expect((await m3d.loadWireframe(m, "front", { fetchFn: fake.fetchFn })).status).toBe("unavailable");
    expect(fake.st.calls.some((c) => c.host.startsWith("169.254"))).toBe(false);
    // …or on to a name that RESOLVES to a private address.
    fake.st.wf.set("back:url", to("https://storage.hover.test/to-internal"));
    expect((await m3d.loadWireframe(m, "back", { fetchFn: fake.fetchFn })).status).toBe("unavailable");
    expect(fake.st.calls.some((c) => c.host === "internal.hover.test")).toBe(false);
    // Two storage hops are fine; a longer chain is cut off after the hop limit.
    fake.st.wf.set("left:url", to("https://storage.hover.test/chain/1"));
    expect((await m3d.loadWireframe(m, "left", { fetchFn: fake.fetchFn })).status).toBe("ready");
    const s0 = storageCalls();
    fake.st.wf.set("right:url", to("https://storage.hover.test/chain/5"));
    expect((await m3d.loadWireframe(m, "right", { fetchFn: fake.fetchFn })).status).toBe("unavailable");
    expect(storageCalls() - s0).toBe(3);
    // JSON without a url, and a 403, are reported but never remembered.
    fake.st.wf.set("roof:top", () => new Response(JSON.stringify({ nope: 1 }), { headers: { "content-type": "application/json" } }));
    expect((await m3d.loadWireframe(m, "top", { fetchFn: fake.fetchFn })).status).toBe("unavailable");
    fake.st.wf.set("roof:lengths", () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } }));
    expect((await m3d.loadWireframe(m, "roof-lengths", { fetchFn: fake.fetchFn })).status).toBe("unavailable");
    expect(Object.keys((await rawOf(m.id)).model3d.wireframes ?? {})).toEqual(["left"]);
    // The blip passes: roof lengths straight from HOVER as image/png (the live shape).
    fake.st.wf.set("roof:lengths", () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    expect((await m3d.loadWireframe(m, "roof-lengths", { fetchFn: fake.fetchFn })).status).toBe("ready");
    fake.st.wf.clear();
  });

  it("what clients are offered vs. what they may open: availability expires; authorization never depends on it", async () => {
    const live = { url: "https://hover.to/shared/liveShareAAAA", token: "liveShareAAAA", expiresAt: new Date(Date.now() + 86400_000).toISOString(), source: "manual" };
    const nowIso = new Date().toISOString();
    const oldIso = new Date(Date.now() - m3d.UNAVAILABLE_TTL_MS - 1000).toISOString();
    expect(m3d.viewer3dOffered({ provider: "hover", rawPayload: { hoverJobId: "1" } } as any)).toBe(true);
    expect(m3d.viewer3dOffered({ provider: "hover", rawPayload: { hoverJobId: "1", model3d: { status: "unavailable", checkedAt: nowIso } } } as any)).toBe(false);
    expect(m3d.viewer3dOffered({ provider: "hover", rawPayload: { hoverJobId: "1", model3d: { status: "unavailable", checkedAt: oldIso } } } as any)).toBe(true);
    expect(m3d.viewer3dOffered({ provider: "hover", rawPayload: { hoverJobId: "1", model3d: { status: "unavailable", checkedAt: nowIso }, share: live } } as any)).toBe(true);
    expect(m3d.viewer3dOffered({ provider: "hover", rawPayload: { hoverJobId: "1", model3d: { status: "unavailable", checkedAt: nowIso, wireframes: { front: { attachmentId: "x" } } } } } as any)).toBe(true);
    expect(m3d.viewer3dOffered({ provider: "manual", rawPayload: { hoverJobId: "1" } } as any)).toBe(false);
    expect(m3d.viewer3dAuthorized({ provider: "hover", status: "ready", rawPayload: { hoverJobId: "1", model3d: { status: "unavailable", checkedAt: nowIso } } } as any)).toBe(true);
    expect(m3d.viewer3dAuthorized({ provider: "hover", status: "draft", rawPayload: { hoverJobId: "1" } } as any)).toBe(false);
    expect(m3d.viewer3dAuthorized({ provider: "other", status: "ready", rawPayload: { hoverJobId: "1" } } as any)).toBe(false);

    const lone = (await q(`insert into crm_customers (org_id, display_name, portal_token) values ($1,'Lone', md5(random()::text)) returning id`, [orgId]))[0].id;
    const noMesh = await measurement({ customer: lone, raw: { model3d: { status: "unavailable", reason: "no_xml_export", checkedAt: nowIso } } });
    // The card is not offered, but the viewer routes still reach the capture (its wireframes may exist).
    expect(await m3d.viewerMeasurementForEstimate({ orgId, customerId: lone }, { offeredOnly: true })).toBeNull();
    expect((await m3d.viewerMeasurementForEstimate({ orgId, customerId: lone }))?.id).toBe(noMesh.id);
    const withShare = await measurement({ customer: lone, raw: { share: live } });
    expect((await m3d.viewerMeasurementForEstimate({ orgId, customerId: lone }, { offeredOnly: true }))?.id).toBe(withShare.id);
    expect((await m3d.viewerMeasurementForEstimate({ orgId, customerId: lone }))?.id).toBe(withShare.id);
    expect(await m3d.viewerMeasurementForEstimate({ orgId, customerId: otherCust })).toBeNull();
    expect(await m3d.viewerMeasurementForEstimate({ orgId: orgB, customerId: lone })).toBeNull();
  });
});
