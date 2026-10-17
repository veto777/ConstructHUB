/**
 * In-app HOVER 3D viewer — the data side. Nobody has to leave ConstructHUB (or own a HOVER login) to see a capture.
 *
 *   GET /api/crm/measurements/:id/model3d                → the capture as a compact JSON mesh (shared/hover-mesh.ts)
 *   GET /api/crm/measurements/:id/wireframes/:view       → a HOVER wireframe PNG streamed through us
 *   GET /api/client/measurements/:id/model3d             → same, client-portal session, the session's own customers only
 *   GET /api/client/measurements/:id/wireframes/:view
 *   GET /api/public/estimates/:token/model3d             → same, the estimate's customer only (the public estimate's
 *   GET /api/public/estimates/:token/wireframes/:view       email gate, or a contractor preview grant)
 *
 * HOVER endpoints (OAuth bearer of the measurement's ORG — never another org's token):
 *   GET {api}/v3/models/{model_id}/artifacts/cad_export.xml?version=v2      the "XML 3D Export"
 *   GET {api}/v3/models/{model_id}/artifacts/wireframe_{type}.png?version=… wireframe images (front/back/left/right
 *                                                                          with version url; roof with url|top|lengths|
 *                                                                          areas|pitches)
 *   GET {api}/v3/jobs/{job_id}   only when the model id is not already known — models[] carries it, plus
 *                                artifacts.cad_exports.xml_v2 when the model's deliverable has an XML export.
 *
 * Caching: the parsed mesh and each wireframe PNG are stored once in the gated attachment storage
 * (crm_attachments kind "model3d", refId = the measurement's customer, like the measurement PDF) and indexed in
 * crm_measurements.raw_payload.model3d. A refusal from HOVER (no model, no XML for the deliverable, 403/404) is
 * remembered for UNAVAILABLE_TTL_MS so a page view does not re-ask HOVER every time; a 429 is never cached.
 * Concurrent requests for the same measurement share one in-flight HOVER fetch.
 *
 * Outcomes the viewer falls back on (JSON {status}): ready (200, mesh) · unavailable (200, reason) ·
 * not_connected (200 — HOVER disconnected or sign-in expired) · rate_limited (503 + Retry-After) · error (502).
 * A wireframe that HOVER does not have answers 404 {status:"unavailable"}.
 */
import type { Express } from "express";
import fs from "fs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { crmAttachments, crmEstimates, crmMeasurements } from "@shared/schema";
import { parseHoverXml3d, HoverMeshError, MESH_LIMITS, type HoverMesh } from "@shared/hover-mesh";
import { requireOrg } from "./tenancy";
import { allow as rateAllow, requireClient } from "./client-auth";
import { requireDocSession, previewGrantValid } from "./portal";
import { storeGeneratedFile, storedFilePath } from "./attachments";
import {
  getHoverAccessToken, hoverBases, hoverFetchWithBackoff, hoverRetryAfterMs, HoverReconnectError,
} from "./hover";
import { clientShareView, parseHoverShareUrl, safeHoverMediaUrl, shareIsLive } from "./hover-share";
import { viewer3dOffered, viewerMeasurementForEstimate } from "./hover-model3d-offer";

export { viewer3dOffered, viewerMeasurementForEstimate } from "./hover-model3d-offer";

type FetchFn = typeof fetch;
type GetUser = (req: any, res: any) => any;
type MeasurementRow = typeof crmMeasurements.$inferSelect;

/** A refusal from HOVER is re-checked after this long. */
export const UNAVAILABLE_TTL_MS = 12 * 3600_000;
const WIREFRAME_MAX_BYTES = 15 * 1024 * 1024;

/** The wireframe views the viewer offers → HOVER's artifact name + version (developers.hover.to "Get Wireframe Images"). */
export const WIREFRAME_VIEWS = {
  front: { type: "front", version: "url", label: "Front" },
  back: { type: "back", version: "url", label: "Back" },
  left: { type: "left", version: "url", label: "Left" },
  right: { type: "right", version: "url", label: "Right" },
  top: { type: "roof", version: "top", label: "Top" },
  "roof-lengths": { type: "roof", version: "lengths", label: "Roof lengths" },
  "roof-areas": { type: "roof", version: "areas", label: "Roof areas" },
  "roof-pitches": { type: "roof", version: "pitches", label: "Roof pitches" },
} as const;
export type WireframeView = keyof typeof WIREFRAME_VIEWS;
export const isWireframeView = (v: unknown): v is WireframeView =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(WIREFRAME_VIEWS, v);

export type UnavailableReason =
  | "not_hover" | "no_model" | "no_xml_export" | "hover_refused" | "hover_not_found" | "empty_geometry" | "bad_export";

export type Model3dResult =
  | { status: "ready"; mesh: HoverMesh; modelId: string; cached: boolean }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "not_connected" }
  | { status: "rate_limited"; retryAfterSec: number }
  | { status: "error"; message: string };

export type WireframeResult =
  | { status: "ready"; buffer: Buffer; mime: string }
  | { status: "unavailable"; reason: UnavailableReason }
  | { status: "not_connected" }
  | { status: "rate_limited"; retryAfterSec: number }
  | { status: "error"; message: string };

interface Model3dState {
  status?: "ready" | "unavailable";
  reason?: UnavailableReason | null;
  modelId?: string;
  meshAttachmentId?: string;
  checkedAt?: string;
  wireframes?: Record<string, { attachmentId?: string; missing?: boolean; checkedAt?: string }>;
}

const stateOf = (m: MeasurementRow): Model3dState => (((m.rawPayload ?? {}) as any).model3d ?? {}) as Model3dState;
const fresh = (iso: string | undefined, now = Date.now()) => !!iso && now - new Date(iso).getTime() < UNAVAILABLE_TTL_MS;

/** Atomic merge into raw_payload.model3d (and one nested wireframe entry) — never a read-modify-write of the row. */
async function mergeModel3dState(measurementId: string, patch: Partial<Model3dState>, wireframe?: { key: string; value: object }) {
  const p = JSON.stringify(patch);
  if (wireframe) {
    const w = JSON.stringify({ [wireframe.key]: wireframe.value });
    await db.execute(sql`update crm_measurements set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('model3d',
      coalesce(raw_payload->'model3d', '{}'::jsonb) || ${p}::jsonb || jsonb_build_object('wireframes',
        coalesce(raw_payload->'model3d'->'wireframes', '{}'::jsonb) || ${w}::jsonb))
      where id = ${measurementId}`);
    return;
  }
  await db.execute(sql`update crm_measurements set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('model3d',
    coalesce(raw_payload->'model3d', '{}'::jsonb) || ${p}::jsonb) where id = ${measurementId}`);
}

async function reloadMeasurement(id: string): Promise<MeasurementRow | null> {
  const [row] = await db.select().from(crmMeasurements).where(eq(crmMeasurements.id, id)).limit(1);
  return row ?? null;
}

/** A cached file of this org (attachment kind "model3d"), or null if the row or its file is gone. */
async function readCached(orgId: string, attachmentId: string | undefined): Promise<{ buffer: Buffer; mime: string } | null> {
  if (!attachmentId || !/^[0-9a-f-]{36}$/i.test(attachmentId)) return null;
  const [att] = await db.select().from(crmAttachments)
    .where(and(eq(crmAttachments.id, attachmentId), eq(crmAttachments.orgId, orgId), eq(crmAttachments.kind, "model3d")))
    .limit(1);
  if (!att) return null;
  const abs = storedFilePath(att);
  if (!abs) return null;
  return { buffer: await fs.promises.readFile(abs), mime: att.mime };
}

const isNotConnected = (e: unknown) =>
  e instanceof HoverReconnectError || /not connected|unreadable — reconnect/i.test(String((e as any)?.message ?? ""));

/** Only HOVER's own API host (or the configured/stubbed API base) ever receives the org's bearer token. */
function hoverApiUrl(u: unknown, apiBase: string): string | null {
  if (typeof u !== "string") return null;
  if (u.startsWith(`${apiBase}/`)) return u;
  const safe = safeHoverMediaUrl(u);
  return safe && new URL(safe).hostname === "hover.to" && new URL(safe).pathname.startsWith("/api/") ? safe : null;
}

/** A model id found in the stored full_json (its artifact/wireframe URLs carry /models/<id>/). */
export function modelIdFromFullJson(fullJson: unknown): string | null {
  let found: string | null = null;
  const walk = (n: unknown, depth: number) => {
    if (found || depth > 8 || n === null || n === undefined) return;
    if (typeof n === "string") {
      const m = /hover\.to\/api\/v\d\/models\/(\d{1,12})\//.exec(n);
      if (m) found = m[1];
      return;
    }
    if (Array.isArray(n)) { for (const x of n.slice(0, 200)) walk(x, depth + 1); return; }
    if (typeof n === "object") for (const v of Object.values(n as object).slice(0, 400)) walk(v, depth + 1);
  };
  walk(fullJson, 0);
  return found;
}

/**
 * The model to export from a job's models[]: a completed model whose deliverable lists an XML export first, then any
 * completed model, then the first one. `xmlListed` says whether HOVER listed cad_exports.xml* for it (false when the
 * job lists artifacts but no XML — that deliverable has no 3D export).
 */
export function pickExportModel(job: any): { modelId: string; xmlUrl: string | null; xmlListed: boolean | null } | null {
  const models: any[] = Array.isArray(job?.models) ? job.models.filter((m: any) => m && /^\d{1,12}$/.test(String(m.id ?? ""))) : [];
  if (!models.length) return null;
  const xmlOf = (m: any) => m?.artifacts?.cad_exports?.xml_v2 ?? m?.artifacts?.cad_exports?.xml ?? null;
  const complete = (m: any) => !m.state || /^(complete|completed)$/i.test(String(m.state));
  const chosen = models.find((m) => complete(m) && xmlOf(m)) ?? models.find(complete) ?? models[0];
  const listsArtifacts = chosen.artifacts && typeof chosen.artifacts === "object" && !Array.isArray(chosen.artifacts);
  return {
    modelId: String(chosen.id),
    xmlUrl: typeof xmlOf(chosen) === "string" ? xmlOf(chosen) : null,
    xmlListed: listsArtifacts ? Boolean(xmlOf(chosen)) : null,
  };
}

/** Resolve (and remember) the HOVER model id of a measurement. */
async function resolveModel(m: MeasurementRow, token: string, fetchFn: FetchFn):
Promise<{ modelId: string; xmlUrl: string | null; xmlListed: boolean | null } | Exclude<Model3dResult, { status: "ready" }>> {
  const st = stateOf(m);
  if (st.modelId) return { modelId: st.modelId, xmlUrl: null, xmlListed: null };
  const raw = (m.rawPayload ?? {}) as any;
  const fromJson = modelIdFromFullJson(raw.fullJson);
  if (fromJson) {
    await mergeModel3dState(m.id, { modelId: fromJson });
    return { modelId: fromJson, xmlUrl: null, xmlListed: null };
  }
  const { apiBase } = hoverBases();
  const res = await hoverFetchWithBackoff(fetchFn, `${apiBase}/v3/jobs/${encodeURIComponent(String(raw.hoverJobId))}`, {
    headers: { authorization: `Bearer ${token}` },
  }, 1);
  if (res.status === 429) return { status: "rate_limited", retryAfterSec: Math.ceil(hoverRetryAfterMs(res.headers?.get?.("retry-after")) / 1000) };
  if (res.status === 401) return { status: "not_connected" };
  if (res.status === 403) return { status: "unavailable", reason: "hover_refused" };
  if (res.status === 404) return { status: "unavailable", reason: "hover_not_found" };
  if (!res.ok) return { status: "error", message: `HOVER job lookup failed (${res.status})` };
  const job = await res.json().catch(() => null);
  const pick = pickExportModel(job);
  if (!pick) return { status: "unavailable", reason: "no_model" };
  await mergeModel3dState(m.id, { modelId: pick.modelId });
  return pick;
}

const inFlight = new Map<string, Promise<any>>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inFlight.get(key);
  if (hit) return hit;
  const p = run().finally(() => { if (inFlight.get(key) === p) inFlight.delete(key); });
  inFlight.set(key, p);
  return p;
}

/**
 * The 3D mesh of one HOVER measurement (the caller has already proven the measurement is the caller's to see).
 * Cache first; one HOVER fetch per measurement at a time.
 */
export function loadModel3d(m: MeasurementRow, opts: { fetchFn?: FetchFn; refresh?: boolean } = {}): Promise<Model3dResult> {
  return once(`mesh:${m.id}`, () => loadModel3dInner(m, opts.fetchFn ?? fetch, !!opts.refresh));
}

async function loadModel3dInner(m0: MeasurementRow, fetchFn: FetchFn, refresh: boolean): Promise<Model3dResult> {
  const m = (await reloadMeasurement(m0.id)) ?? m0;
  const raw = (m.rawPayload ?? {}) as any;
  if (m.provider !== "hover" || !raw.hoverJobId) return { status: "unavailable", reason: "not_hover" };
  const st = stateOf(m);

  if (st.status === "ready" && st.meshAttachmentId && !refresh) {
    const hit = await readCached(m.orgId, st.meshAttachmentId);
    if (hit) {
      try {
        return { status: "ready", mesh: JSON.parse(hit.buffer.toString("utf8")), modelId: String(st.modelId ?? ""), cached: true };
      } catch { /* a broken cache file is refetched below */ }
    }
  }
  if (st.status === "unavailable" && st.reason && fresh(st.checkedAt) && !refresh) {
    return { status: "unavailable", reason: st.reason };
  }

  const unavailable = async (reason: UnavailableReason): Promise<Model3dResult> => {
    await mergeModel3dState(m.id, { status: "unavailable", reason, checkedAt: new Date().toISOString() });
    return { status: "unavailable", reason };
  };

  let token: string;
  try {
    token = await getHoverAccessToken(m.orgId, fetchFn);
  } catch (e) {
    if (isNotConnected(e)) return { status: "not_connected" };
    return { status: "error", message: "Could not sign in to HOVER" };
  }

  const model = await resolveModel(m, token, fetchFn);
  if ("status" in model) {
    if (model.status === "unavailable") return unavailable(model.reason);
    return model;
  }
  if (model.xmlListed === false) return unavailable("no_xml_export");

  const { apiBase } = hoverBases();
  const url = hoverApiUrl(model.xmlUrl, apiBase)
    ?? `${apiBase}/v3/models/${encodeURIComponent(model.modelId)}/artifacts/cad_export.xml?version=v2`;
  const res = await hoverFetchWithBackoff(fetchFn, url, { headers: { authorization: `Bearer ${token}` } }, 1);
  if (res.status === 429) return { status: "rate_limited", retryAfterSec: Math.ceil(hoverRetryAfterMs(res.headers?.get?.("retry-after")) / 1000) };
  if (res.status === 401) return { status: "not_connected" };
  if (res.status === 403) return unavailable("hover_refused");
  // 400/404/422: HOVER has no XML export for this model (deliverable type, or the model is not finished).
  if (res.status === 400 || res.status === 404 || res.status === 422) return unavailable("no_xml_export");
  if (!res.ok) return { status: "error", message: `HOVER XML export failed (${res.status})` };

  if (Number(res.headers.get("content-length") ?? 0) > MESH_LIMITS.xmlBytes) return unavailable("bad_export");
  const xml = await res.text().catch(() => "");
  let mesh: HoverMesh;
  try {
    mesh = parseHoverXml3d(xml);
  } catch (e) {
    if (e instanceof HoverMeshError) return unavailable(e.code === "empty_geometry" ? "empty_geometry" : "bad_export");
    return { status: "error", message: "Could not read the HOVER export" };
  }

  const att = await storeGeneratedFile({
    orgId: m.orgId, kind: "model3d", refId: m.customerId ?? null,
    fileName: `hover-model-${model.modelId}.json`, buffer: Buffer.from(JSON.stringify(mesh)), mime: "application/json", ext: "json",
  });
  await mergeModel3dState(m.id, {
    status: "ready", reason: null, modelId: model.modelId, meshAttachmentId: att.id, checkedAt: new Date().toISOString(),
  });
  return { status: "ready", mesh, modelId: model.modelId, cached: false };
}

/**
 * Where HOVER may send us for a wireframe (a signed-storage redirect or a JSON {url}): https on a public DNS name —
 * never an IP literal, localhost or an internal suffix, and never with our token attached.
 */
function publicHttpsUrl(u: URL): boolean {
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(h);
}

const looksLikeImage = (b: Buffer) =>
  (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) // PNG
  || (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff); // JPEG

/** One wireframe image of a HOVER measurement, cached in gated storage. */
export function loadWireframe(m: MeasurementRow, view: WireframeView, opts: { fetchFn?: FetchFn } = {}): Promise<WireframeResult> {
  return once(`wf:${m.id}:${view}`, () => loadWireframeInner(m, view, opts.fetchFn ?? fetch));
}

async function loadWireframeInner(m0: MeasurementRow, view: WireframeView, fetchFn: FetchFn): Promise<WireframeResult> {
  const m = (await reloadMeasurement(m0.id)) ?? m0;
  const raw = (m.rawPayload ?? {}) as any;
  if (m.provider !== "hover" || !raw.hoverJobId) return { status: "unavailable", reason: "not_hover" };
  const st = stateOf(m);
  const entry = st.wireframes?.[view];
  if (entry?.attachmentId) {
    const hit = await readCached(m.orgId, entry.attachmentId);
    if (hit) return { status: "ready", buffer: hit.buffer, mime: hit.mime };
  }
  if (entry?.missing && fresh(entry.checkedAt)) return { status: "unavailable", reason: "hover_not_found" };
  const missing = async (): Promise<WireframeResult> => {
    await mergeModel3dState(m.id, {}, { key: view, value: { missing: true, checkedAt: new Date().toISOString() } });
    return { status: "unavailable", reason: "hover_not_found" };
  };

  let token: string;
  try {
    token = await getHoverAccessToken(m.orgId, fetchFn);
  } catch (e) {
    if (isNotConnected(e)) return { status: "not_connected" };
    return { status: "error", message: "Could not sign in to HOVER" };
  }
  const model = await resolveModel(m, token, fetchFn);
  if ("status" in model) {
    if (model.status === "unavailable") return missing();
    return model;
  }

  const { apiBase } = hoverBases();
  const spec = WIREFRAME_VIEWS[view];
  const url = `${apiBase}/v3/models/${encodeURIComponent(model.modelId)}/artifacts/wireframe_${spec.type}.png?version=${spec.version}`;
  let res = await hoverFetchWithBackoff(fetchFn, url, { headers: { authorization: `Bearer ${token}` }, redirect: "manual" }, 1);
  // HOVER may answer with a redirect to signed storage, or JSON naming the image URL: follow once, WITHOUT our token.
  let next: string | null = null;
  if (res.status >= 300 && res.status < 400) next = res.headers.get("location");
  else if (res.ok && /json/i.test(res.headers.get("content-type") ?? "")) {
    const j: any = await res.json().catch(() => null);
    next = typeof j?.url === "string" ? j.url : null;
    if (!next) return missing();
  }
  if (next) {
    let target: URL;
    try { target = new URL(next, url); } catch { return missing(); }
    if (!target.toString().startsWith(`${apiBase}/`) && !publicHttpsUrl(target)) return missing();
    res = await fetchFn(target.toString(), { redirect: "follow" });
  }
  if (res.status === 429) return { status: "rate_limited", retryAfterSec: Math.ceil(hoverRetryAfterMs(res.headers?.get?.("retry-after")) / 1000) };
  if (res.status === 401) return { status: "not_connected" };
  if (!res.ok) {
    if (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 422) return missing();
    return { status: "error", message: `HOVER wireframe failed (${res.status})` };
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > WIREFRAME_MAX_BYTES) return missing();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length || buffer.length > WIREFRAME_MAX_BYTES || !looksLikeImage(buffer)) return missing();
  const mime = buffer[0] === 0x89 ? "image/png" : "image/jpeg";
  const att = await storeGeneratedFile({
    orgId: m.orgId, kind: "model3d", refId: m.customerId ?? null,
    fileName: `hover-wireframe-${model.modelId}-${view}.${mime === "image/png" ? "png" : "jpg"}`,
    buffer, mime, ext: mime === "image/png" ? "png" : "jpg",
  });
  await mergeModel3dState(m.id, {}, { key: view, value: { attachmentId: att.id, checkedAt: new Date().toISOString() } });
  return { status: "ready", buffer, mime };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 60);

/** The JSON a viewer gets. Contractors also get the location and their own HOVER app link; clients never do. */
function model3dBody(m: MeasurementRow, r: Model3dResult, audience: "contractor" | "client") {
  const raw = (m.rawPayload ?? {}) as any;
  const share = audience === "client"
    ? clientShareView(raw)
    : (shareIsLive(raw.share) ? { url: parseHoverShareUrl(raw.share.url)!.url } : null);
  const meta = {
    measurementId: m.id,
    address: audience === "contractor" ? [m.addressLine1, m.city, m.state].filter(Boolean).join(", ") || null : null,
    share: share ? { url: share.url } : null,
    hoverAppUrl: audience === "contractor" && typeof raw.model3dUrl === "string" && /^https:\/\/hover\.to\/3d\/\d+$/.test(raw.model3dUrl)
      ? raw.model3dUrl : null,
    wireframeViews: Object.entries(WIREFRAME_VIEWS).map(([id, v]) => ({ id, label: v.label })),
  };
  if (r.status === "ready") {
    const mesh = audience === "client" ? { ...r.mesh, location: null } : r.mesh;
    return { code: 200, body: { status: "ready", ...meta, mesh } };
  }
  if (r.status === "rate_limited") return { code: 503, body: { status: r.status, retryAfterSec: r.retryAfterSec, ...meta } };
  if (r.status === "error") return { code: 502, body: { status: "error", message: r.message, ...meta } };
  return { code: 200, body: { ...r, ...meta } };
}

async function sendModel3d(res: any, m: MeasurementRow, audience: "contractor" | "client", refresh = false) {
  const r = await loadModel3d(m, { refresh }).catch((e: any) => {
    console.error("[hover-3d] model load failed:", String(e?.message || e).slice(0, 200));
    return { status: "error", message: "Could not load the 3D model" } as Model3dResult;
  });
  const { code, body } = model3dBody(m, r, audience);
  if (code === 503) res.setHeader("Retry-After", String((body as any).retryAfterSec ?? 30));
  res.setHeader("Cache-Control", "private, no-store");
  res.status(code).json(body);
}

async function sendWireframe(res: any, m: MeasurementRow, view: string) {
  if (!isWireframeView(view)) return res.status(404).json({ status: "unavailable", message: "Unknown view" });
  const r = await loadWireframe(m, view).catch((e: any) => {
    console.error("[hover-3d] wireframe load failed:", String(e?.message || e).slice(0, 200));
    return { status: "error", message: "Could not load the wireframe" } as WireframeResult;
  });
  if (r.status === "ready") {
    res.setHeader("Content-Type", r.mime);
    res.setHeader("Content-Length", String(r.buffer.length));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(r.buffer);
  }
  if (r.status === "rate_limited") {
    res.setHeader("Retry-After", String(r.retryAfterSec));
    return res.status(503).json(r);
  }
  if (r.status === "error") return res.status(502).json(r);
  if (r.status === "not_connected") return res.status(409).json(r);
  return res.status(404).json(r);
}

export function registerHoverModel3dRoutes(app: Express, getDevUser: GetUser): void {
  // ── Contractor ──
  // /api/crm/measurements/:id is visibility-checked by authorizeObjectRequest (inside requireOrg) before we run.
  const crmMeasurement = async (req: any, res: any): Promise<MeasurementRow | null> => {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (!rateAllow(`model3d:org:${ctx.org.id}`, 900)) {
      res.status(429).json({ message: "Too many requests — try again in a few minutes." });
      return null;
    }
    const [m] = await db.select().from(crmMeasurements)
      .where(and(eq(crmMeasurements.orgId, ctx.org.id), eq(crmMeasurements.id, String(req.params.id)), eq(crmMeasurements.provider, "hover")))
      .limit(1);
    if (!m) {
      res.status(404).json({ message: "HOVER measurement not found" });
      return null;
    }
    return m;
  };

  app.get("/api/crm/measurements/:id/model3d", async (req: any, res) => {
    const m = await crmMeasurement(req, res);
    if (!m) return;
    await sendModel3d(res, m, "contractor", req.query?.refresh === "1");
  });

  app.get("/api/crm/measurements/:id/wireframes/:view", async (req: any, res) => {
    const m = await crmMeasurement(req, res);
    if (!m) return;
    await sendWireframe(res, m, String(req.params.view));
  });

  // ── Client portal (session cookie; the session's own customers only) ──
  const clientMeasurement = async (req: any, res: any): Promise<MeasurementRow | null> => {
    if (!rateAllow(`model3d:ip:${clientIp(req)}`, 240)) {
      res.status(429).json({ message: "Too many requests — try again in a few minutes." });
      return null;
    }
    const client = await requireClient(req, res);
    if (!client) return null;
    const [m] = await db.select().from(crmMeasurements).where(eq(crmMeasurements.id, String(req.params.id))).limit(1);
    if (!m || !m.customerId || !client.customerIds.includes(m.customerId) || m.provider !== "hover"
      || m.status !== "ready" || !viewer3dOffered(m)) {
      res.status(404).json({ message: "Not found" });
      return null;
    }
    return m;
  };

  app.get("/api/client/measurements/:id/model3d", async (req: any, res) => {
    const m = await clientMeasurement(req, res);
    if (!m) return;
    await sendModel3d(res, m, "client");
  });

  app.get("/api/client/measurements/:id/wireframes/:view", async (req: any, res) => {
    const m = await clientMeasurement(req, res);
    if (!m) return;
    await sendWireframe(res, m, String(req.params.view));
  });

  // ── Public estimate (the estimate page's own email gate, or a contractor preview grant) ──
  const estimateMeasurement = async (req: any, res: any): Promise<MeasurementRow | null> => {
    if (!rateAllow(`model3d:ip:${clientIp(req)}`, 240)) {
      res.status(429).json({ message: "Too many requests — try again in a few minutes." });
      return null;
    }
    const t = String(req.params.token || "");
    if (t.length < 24) { res.status(404).json({ message: "Not found" }); return null; }
    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) { res.status(404).json({ message: "Not found" }); return null; }
    const preview = previewGrantValid("estimate", est.id, String(req.query?.preview || ""));
    if (!preview && !(await requireDocSession(req, res, est.customerId))) return null;
    if (est.expiresAt && est.expiresAt.getTime() < Date.now() && !est.approvedAt && !est.declinedAt) {
      res.status(410).json({ message: "This estimate has expired.", expired: true });
      return null;
    }
    const m = await viewerMeasurementForEstimate(est);
    if (!m) { res.status(404).json({ message: "Not found" }); return null; }
    return m;
  };

  app.get("/api/public/estimates/:token/model3d", async (req: any, res) => {
    const m = await estimateMeasurement(req, res);
    if (!m) return;
    await sendModel3d(res, m, "client");
  });

  app.get("/api/public/estimates/:token/wireframes/:view", async (req: any, res) => {
    const m = await estimateMeasurement(req, res);
    if (!m) return;
    await sendWireframe(res, m, String(req.params.view));
  });
}
