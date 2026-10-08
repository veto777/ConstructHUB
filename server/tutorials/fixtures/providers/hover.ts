/**
 * HOVER — tutorial fixture. Recording slots only (../gate.ts).
 *
 * Seam: `hoverBases()` + the HOVER client id / secret in server/crm/hover.ts. In a slot the OAuth
 * and API base URLs point at a stand-in HOVER API served by this same process
 * (/__tutorial/hover/…), so the product's own token refresh, job walk, customer matching,
 * measurement summary, PDF and photo import all run for real against three invented jobs.
 *
 * The connection itself (a refresh token encrypted with the slot's own session secret) cannot be
 * seeded, so `onBoot` writes it and runs the product's own sync once.
 */
import fs from "fs";
import path from "path";
import type { Router } from "express";
import { FIXTURE_MARK } from "../gate";
import { defineProviderFixture, FIXTURE_ROUTE_PREFIX } from "../registry";
import { fixturePdf } from "../pdf";

export type HoverFixture = { clientId: string; clientSecret: string; oauthBase: string; apiBase: string };

const self = () => `http://127.0.0.1:${process.env.PORT}${FIXTURE_ROUTE_PREFIX}/hover`;
const ACCESS = "tutfx-hover-access", REFRESH = "tutfx-hover-refresh";
const ASSETS = () => path.join(process.cwd(), "scripts", "tutorials", "assets");

type Job = {
  id: string; name: string; daysAgo: number; photos: number[];
  contact: { name: string; email: string; phone: string };
  address: { location_line_1: string; city: string; region: string; postal_code: string };
  m: { roof: number; siding: number; windows: number; stories: number; pitch: string; waste: number };
};
/** Three completed captures, one per state the demo company works in. The contacts are demo clients (seed-demo.ts). */
export const FIXTURE_HOVER_JOBS: Job[] = [
  { id: `${FIXTURE_MARK.hoverJob}1001`, name: "Ellison — exterior measure", daysAgo: 12, photos: [8],
    contact: { name: "Greta Ellison", email: "greta.ellison@example.com", phone: "(941) 555-0161" },
    address: { location_line_1: "17 Heron Way", city: "Venice", region: "FL", postal_code: "34285" },
    m: { roof: 2460, siding: 1880, windows: 14, stories: 1, pitch: "5/12", waste: 10 } },
  { id: `${FIXTURE_MARK.hoverJob}1002`, name: "Oyelaran — exterior measure", daysAgo: 5, photos: [8],
    contact: { name: "Tunde Oyelaran", email: "tunde.oyelaran@example.com", phone: "(518) 555-0126" },
    address: { location_line_1: "58 Wren Hollow Ln", city: "Albany", region: "NY", postal_code: "12203" },
    m: { roof: 1890, siding: 2240, windows: 18, stories: 2, pitch: "8/12", waste: 12 } },
  { id: `${FIXTURE_MARK.hoverJob}1003`, name: "Hadley — exterior measure", daysAgo: 2, photos: [8],
    contact: { name: "Caleb & Nora Hadley", email: "hadleys@example.com", phone: "(512) 555-0118" },
    address: { location_line_1: "1712 Juniper Bend", city: "Austin", region: "TX", postal_code: "78704" },
    m: { roof: 2130, siding: 1560, windows: 11, stories: 1, pitch: "4/12", waste: 10 } },
];

const api = () => `${self()}/api`;
const jobDetail = (j: Job) => ({
  id: j.id, name: j.name, state: "complete", contact: j.contact, address: j.address,
  // An example.com address: the stand-in has no 3D viewer, and a made-up link must not look like a real one.
  designProUrl: `https://hover.example.com/3d/${j.id}`,
  deliverables: { measurements_json: `${api()}/v3/jobs/${j.id}/measurements.json`, measurements_pdf: `${api()}/v3/jobs/${j.id}/measurements.pdf` },
  models: [{ images: j.photos.map((n) => ({ id: `${j.id}-${n}`, image: { url: `${api()}/images/site-${String(n).padStart(2, "0")}.jpg` } })) }],
});
const fullJson = (j: Job) => ({
  roof: { total_roof_area_sqft: j.m.roof, predominant_pitch: j.m.pitch, waste_percent: j.m.waste },
  siding: { total_siding_area_sqft: j.m.siding }, openings: { windows: j.m.windows }, property: { stories: j.m.stories },
});

function routes(r: Router) {
  r.post("/oauth/token", (_req, res) => res.json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 7200, token_type: "bearer" }));
  const authed = (req: any, res: any, next: any) => (req.headers.authorization === `Bearer ${ACCESS}` ? next() : res.status(401).json({ error: "unauthorized" }));
  r.use("/api", authed);
  r.get("/api/v2/jobs", (req, res) => res.json(Number(req.query.page || 1) > 1
    ? { results: [], pagination: { total_pages: 1 } }
    : { results: FIXTURE_HOVER_JOBS.map((j) => ({ id: j.id, name: j.name, state: "complete" })), pagination: { total_pages: 1 } }));
  const find = (id: string) => FIXTURE_HOVER_JOBS.find((j) => j.id === id);
  r.get("/api/v3/jobs/:id", (req, res) => { const j = find(req.params.id); return j ? res.json(jobDetail(j)) : res.status(404).json({ error: "not found" }); });
  r.get("/api/v3/jobs/:id/measurements.json", (req, res) => { const j = find(req.params.id); return j ? res.json(fullJson(j)) : res.status(404).json({ error: "not found" }); });
  r.get("/api/v3/jobs/:id/measurements.pdf", (req, res) => {
    const j = find(req.params.id);
    if (!j) return res.status(404).end();
    res.type("application/pdf").send(fixturePdf([
      "Measurement summary (demonstration)", `${j.contact.name} - ${j.address.city}, ${j.address.region}`,
      `Roof area: ${j.m.roof} sq ft    Pitch: ${j.m.pitch}`, `Siding area: ${j.m.siding} sq ft    Windows: ${j.m.windows}`,
      "This document belongs to a fictional demo workspace.",
    ]));
  });
  r.get("/api/images/:file", (req, res) => {
    const name = path.basename(String(req.params.file));
    const file = path.join(ASSETS(), "photos", name);
    if (!/^site-\d\d\.jpg$/.test(name) || !fs.existsSync(file)) return res.status(404).end();
    res.type("image/jpeg").send(fs.readFileSync(file));
  });
  r.get("/api/v2/webhooks", (_req, res) => res.json({ results: [] }));
  r.post("/api/v2/webhooks", (_req, res) => res.json({ webhook: { id: "tutfx-webhook-1", hmac_secret: "tutfx-webhook-secret" } }));
  r.delete("/api/v2/webhooks/:id", (_req, res) => res.status(204).end());
}

export const hoverFixture = defineProviderFixture<HoverFixture>({
  id: "hover",
  simulates: "A connected HOVER account with three completed measurement jobs (Florida, New York, Texas), each with a summary, a PDF and a drawn (generated) photo.",
  seam: "server/crm/hover.ts — hoverBases(), hoverConfigured() and the client id / secret (the stand-in API is served at /__tutorial/hover)",
  adapter: () => ({ clientId: "tutfx-hover-client", clientSecret: "tutfx-hover-secret", oauthBase: self(), apiBase: api() }),
  routes,
  onBoot: async ({ orgId }) => {
    const { pool } = await import("../../../db");
    const hover = await import("../../../crm/hover");
    const { rows: [org] } = await pool.query(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    const cf = (org?.custom_fields ?? {}) as Record<string, any>;
    // Only where the seed asked for it (scripts/tutorials/seed-fixtures.ts leaves `hover.fixture`).
    if (!cf.hover?.fixture) return;
    const day = 86400000;
    cf.hover = {
      ...cf.hover,
      refreshTokenEnc: hover.encryptHoverSecret(REFRESH),
      connectedAt: cf.hover.connectedAt ?? new Date(Date.now() - 21 * day).toISOString(),
      webhook: { id: "tutfx-webhook-1", url: "https://portal.example.com/api/crm/integrations/hover/webhook", hmacSecretEnc: hover.encryptHoverSecret("tutfx-webhook-secret"),
        verified: true, registeredAt: new Date(Date.now() - 21 * day).toISOString(), verifiedAt: new Date(Date.now() - 21 * day).toISOString() },
      lastError: null, needsReconnect: false,
    };
    await pool.query(`update crm_orgs set custom_fields = $2::jsonb where id = $1`, [orgId, JSON.stringify(cf)]);
    hover.clearHoverTokenCache(orgId);
    // The product's own sync, against the stand-in: matches each job to its demo client and stores the summary, PDF and photos.
    await hover.runHoverSync(orgId);
    // A capture is finished days before anyone looks at it — not all three "just now".
    for (const j of FIXTURE_HOVER_JOBS)
      await pool.query(`update crm_measurements set completed_at = now() - make_interval(days => $3), created_at = now() - make_interval(days => $3)
                         where org_id = $1 and external_id = $2 and created_at > now() - interval '1 hour'`, [orgId, `hover:${j.id}`, j.daysAgo]);
  },
});
