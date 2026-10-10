/**
 * Permit alerts API — /api/permits/watches (CRUD, hits, check now), gated by
 * requireModule("permitAlerts") (platform admins pass every module gate), plus
 * two public reads the directory and the form use: which portal platforms
 * support alerts, and the trade picker list.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { permitDatabases, permitWatches, permitWatchHits, permits, permitPollState, type PermitWatch } from "@shared/schema";
import {
  TRADES, TRADE_KEYS, WATCH_KINDS, MAX_WATCHES_PER_USER, MAX_DATABASES_PER_WATCH, MAX_RADIUS_MILES,
  type PermitWatchDto, type WatchParams, type WatchChannels,
} from "@shared/permit-alerts";
import { requireModule } from "../entitlements";
import { rateLimit } from "../growth-limits";
import { storage } from "../storage";
import { getAdapter, listAdapters } from "../scrapers/registry";
import { normalizePhone } from "../crm/sms";
import { geocodeAddress, geocoderConfigured } from "./geocode";
import { requestPollSoon } from "./poller";

type GetUser = (req: any, res: any) => any;

const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const paramsInput = z.object({
  address: optText(300),
  parcel: optText(80),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  radiusMiles: z.number().min(0).max(MAX_RADIUS_MILES).nullish(),
  trades: z.array(z.enum(TRADE_KEYS as [string, ...string[]])).max(TRADES.length).optional(),
  keywords: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
  contractorName: optText(160),
  contractorLicense: optText(60),
});
const channelsInput = z.object({
  email: z.boolean().default(true),
  sms: z.boolean().default(false),
  smsTo: optText(32),
  telegram: z.boolean().default(false),
});
export const watchInput = z.object({
  kind: z.enum(WATCH_KINDS),
  name: z.string().trim().min(1).max(120).optional(),
  params: paramsInput.default({}),
  channels: channelsInput.default({ email: true, sms: false, telegram: false }),
  databaseIds: z.array(z.number().int().positive()).min(1).max(MAX_DATABASES_PER_WATCH),
  active: z.boolean().optional(),
});
export type WatchInput = z.infer<typeof watchInput>;

export class WatchError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Validate the kind's own fields and fill the derived ones (a name, a geocoded center). */
export async function prepareWatch(input: WatchInput, jurisdictions: Array<{ id: number; name: string; jurisdiction: string }>): Promise<{ name: string; params: WatchParams; channels: WatchChannels }> {
  const p: WatchParams = { ...input.params, trades: (input.params.trades ?? []) as WatchParams["trades"], keywords: input.params.keywords ?? [] };
  const hint = jurisdictions[0]?.jurisdiction ?? null;
  let name = input.name ?? "";
  switch (input.kind) {
    case "address":
      if (!p.address && !p.parcel) throw new WatchError(400, "An address (or parcel number) is required");
      name ||= p.address ?? `Parcel ${p.parcel}`;
      break;
    case "parcel":
      if (!p.parcel) throw new WatchError(400, "A parcel number is required");
      name ||= `Parcel ${p.parcel}`;
      break;
    case "contractor":
      if (!p.contractorName && !p.contractorLicense) throw new WatchError(400, "A contractor name or license number is required");
      name ||= p.contractorName ?? `License ${p.contractorLicense}`;
      break;
    case "trade_area": {
      const tradeLabels = (p.trades ?? []).map((k) => TRADES.find((t) => t.key === k)?.label ?? k);
      const what = [...tradeLabels, ...(p.keywords ?? [])];
      name ||= `${what.length ? what.slice(0, 3).join(", ") + (what.length > 3 ? ", …" : "") : "All permits"} in ${jurisdictions.length === 1 ? jurisdictions[0].jurisdiction : `${jurisdictions.length} jurisdictions`}`;
      if ((p.radiusMiles ?? 0) > 0 && !p.address && typeof p.lat !== "number") throw new WatchError(400, "A radius needs a center address");
      break;
    }
  }
  if ((input.kind === "address" || input.kind === "trade_area") && p.address && (typeof p.lat !== "number" || typeof p.lng !== "number")) {
    const g = await geocodeAddress(p.address, hint);
    if (g) { p.lat = g.lat; p.lng = g.lng; }
    else if (input.kind === "trade_area" && (p.radiusMiles ?? 0) > 0) {
      if (!geocoderConfigured()) { p.radiusMiles = 0; }
      else throw new WatchError(400, "That address could not be located — try a fuller address, or leave the radius off to watch the whole jurisdiction");
    }
  }
  const channels: WatchChannels = { email: input.channels.email, sms: input.channels.sms, smsTo: null, telegram: input.channels.telegram };
  if (input.channels.smsTo) {
    const n = normalizePhone(input.channels.smsTo);
    if (!n) throw new WatchError(400, "That phone number does not look right");
    channels.smsTo = n;
  }
  if (!channels.email && !channels.sms && !channels.telegram) throw new WatchError(400, "Pick at least one way to be notified");
  return { name: name.slice(0, 120), params: p, channels };
}

export function alertPlatforms(): string[] {
  const out = new Set<string>();
  for (const a of listAdapters()) if (a.capabilities.listRecent) { out.add(a.platform); for (const al of a.aliases ?? []) out.add(al); }
  return Array.from(out).sort();
}

async function toDtos(rows: PermitWatch[]): Promise<PermitWatchDto[]> {
  if (!rows.length) return [];
  const dbIds = Array.from(new Set(rows.flatMap((w) => w.databaseIds)));
  const [dbs, states, counts] = await Promise.all([
    dbIds.length ? db.select({ id: permitDatabases.id, name: permitDatabases.name, jurisdiction: permitDatabases.jurisdiction, platform: permitDatabases.platform }).from(permitDatabases).where(inArray(permitDatabases.id, dbIds)) : Promise.resolve([]),
    dbIds.length ? db.select().from(permitPollState).where(inArray(permitPollState.databaseId, dbIds)) : Promise.resolve([]),
    db.select({ watchId: permitWatchHits.watchId, n: sql<number>`count(*)::int` }).from(permitWatchHits).where(inArray(permitWatchHits.watchId, rows.map((w) => w.id))).groupBy(permitWatchHits.watchId),
  ]);
  const dbBy = new Map(dbs.map((d) => [d.id, d]));
  const stateBy = new Map(states.map((s) => [s.databaseId, s]));
  const countBy = new Map(counts.map((c) => [c.watchId, c.n]));
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  return rows.map((w) => ({
    id: w.id, userId: w.userId, kind: w.kind as PermitWatchDto["kind"], name: w.name,
    params: (w.params ?? {}) as WatchParams, channels: (w.channels ?? {}) as WatchChannels,
    databaseIds: w.databaseIds, active: w.active,
    createdAt: iso(w.createdAt)!, updatedAt: iso(w.updatedAt)!, lastCheckedAt: iso(w.lastCheckedAt), lastMatchedAt: iso(w.lastMatchedAt),
    hitCount: countBy.get(w.id) ?? 0,
    jurisdictions: w.databaseIds.map((id) => {
      const d = dbBy.get(id), s = stateBy.get(id);
      return {
        databaseId: id, name: d?.name ?? `Jurisdiction ${id}`, jurisdiction: d?.jurisdiction ?? "", platform: d?.platform ?? null,
        alertsSupported: getAdapter(d?.platform)?.capabilities.listRecent === true,
        lastPolledAt: iso(s?.lastPolledAt), lastSuccessAt: iso(s?.lastSuccessAt), lastError: s?.lastError ?? null, failingSince: iso(s?.failingSince),
      };
    }),
  }));
}

export function registerPermitAlertRoutes(app: Express, getDevUser: GetUser): void {
  // Public: which portal platforms can list by date (the directory's "Alerts supported" badge) and the trade list.
  app.get("/api/permits/alert-platforms", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ platforms: alertPlatforms(), geocoder: geocoderConfigured() });
  });
  app.get("/api/permits/trades", (_req, res) => res.json({ trades: TRADES.map((t) => ({ key: t.key, label: t.label })) }));

  const gate = requireModule("permitAlerts");
  app.use("/api/permits/watches", rateLimit("permit-alerts", 240, 300), (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    gate(req, res, next);
  });

  const route = (method: "get" | "post" | "patch" | "delete", path: string, fn: (req: Request, res: Response, userId: number) => Promise<any>) =>
    app[method](`/api/permits/watches${path}`, async (req, res) => {
      const u = getDevUser(req, res);
      if (!u) return;
      try { await fn(req, res, u.id); }
      catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ message: e.issues[0]?.message ? `${e.issues[0].path.join(".")}: ${e.issues[0].message}` : "Invalid watch" });
        if (e instanceof WatchError) return res.status(e.status).json({ message: e.message });
        console.error("[permit-alerts] route failed:", e?.message ?? e);
        res.status(500).json({ message: "Permit alert operation failed" });
      }
    });

  const owned = async (id: string, userId: number): Promise<PermitWatch> => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new WatchError(404, "Watch not found");
    const [w] = await db.select().from(permitWatches).where(and(eq(permitWatches.id, n), eq(permitWatches.userId, userId))).limit(1);
    if (!w) throw new WatchError(404, "Watch not found");
    return w;
  };
  const loadJurisdictions = async (ids: number[]) => {
    const rows = await db.select({ id: permitDatabases.id, name: permitDatabases.name, jurisdiction: permitDatabases.jurisdiction, platform: permitDatabases.platform })
      .from(permitDatabases).where(inArray(permitDatabases.id, ids));
    if (rows.length !== new Set(ids).size) throw new WatchError(400, "One of the jurisdictions is not in the directory");
    return rows;
  };

  // Jurisdictions to pick from (the directory's filtered search), each with whether alerts are supported today.
  route("get", "/jurisdictions", async (req, res) => {
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
    const search = text(req.query.q);
    const result = await storage.getDatabasesFiltered({
      stateCode: text(req.query.stateCode), search: search?.replace(/[\\%_]/g, "\\$&"), page: 1, limit: 25,
    });
    res.json({ jurisdictions: result.databases.map((d) => ({
      id: d.id, name: d.name, jurisdiction: d.jurisdiction, jurisdictionType: d.jurisdictionType, platform: d.platform,
      alertsSupported: getAdapter(d.platform)?.capabilities.listRecent === true,
    })) });
  });

  route("get", "", async (_req, res, userId) => {
    const rows = await db.select().from(permitWatches).where(eq(permitWatches.userId, userId)).orderBy(desc(permitWatches.createdAt));
    res.json({ watches: await toDtos(rows), geocoder: geocoderConfigured(), platforms: alertPlatforms() });
  });

  route("post", "", async (req, res, userId) => {
    const input = watchInput.parse(req.body ?? {});
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(permitWatches).where(eq(permitWatches.userId, userId));
    if (n >= MAX_WATCHES_PER_USER) throw new WatchError(403, `You can keep up to ${MAX_WATCHES_PER_USER} watches`);
    const jurisdictions = await loadJurisdictions(input.databaseIds);
    const prepared = await prepareWatch(input, jurisdictions);
    const [row] = await db.insert(permitWatches).values({
      userId, kind: input.kind, name: prepared.name, params: prepared.params as Record<string, unknown>, channels: prepared.channels as Record<string, unknown>,
      databaseIds: Array.from(new Set(input.databaseIds)), active: input.active ?? true,
    }).returning();
    await requestPollSoon(row.databaseIds);
    res.status(201).json({ watch: (await toDtos([row]))[0] });
  });

  route("patch", "/:id", async (req, res, userId) => {
    const existing = await owned(req.params.id as string, userId);
    const merged = watchInput.parse({
      kind: existing.kind, name: existing.name, params: existing.params, channels: existing.channels, databaseIds: existing.databaseIds, active: existing.active,
      ...(req.body ?? {}),
    });
    const jurisdictions = await loadJurisdictions(merged.databaseIds);
    // A changed address/center is re-geocoded; an unchanged one keeps its point.
    const sameAddress = (merged.params.address ?? null) === ((existing.params as WatchParams).address ?? null);
    if (!sameAddress) { merged.params.lat = null; merged.params.lng = null; }
    const prepared = await prepareWatch({ ...merged, name: req.body?.name ?? existing.name }, jurisdictions);
    const [row] = await db.update(permitWatches).set({
      name: prepared.name, params: prepared.params as Record<string, unknown>, channels: prepared.channels as Record<string, unknown>,
      databaseIds: Array.from(new Set(merged.databaseIds)), active: merged.active ?? existing.active, updatedAt: new Date(),
    }).where(eq(permitWatches.id, existing.id)).returning();
    res.json({ watch: (await toDtos([row]))[0] });
  });

  route("delete", "/:id", async (req, res, userId) => {
    const existing = await owned(req.params.id as string, userId);
    await db.delete(permitWatches).where(eq(permitWatches.id, existing.id));
    res.json({ ok: true });
  });

  route("get", "/:id/hits", async (req, res, userId) => {
    const existing = await owned(req.params.id as string, userId);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const rows = await db.select({ hit: permitWatchHits, permit: permits }).from(permitWatchHits)
      .innerJoin(permits, eq(permits.id, permitWatchHits.permitId))
      .where(eq(permitWatchHits.watchId, existing.id)).orderBy(desc(permitWatchHits.matchedAt)).limit(limit);
    res.json({ hits: rows.map(({ hit, permit }) => ({
      id: hit.id, reason: hit.reason, matchedAt: hit.matchedAt, notifiedAt: hit.notifiedAt, channelResults: hit.channelResults,
      permit: { ...permit, raw: undefined },
    })) });
  });

  // "Check now": the watch's jurisdictions are polled on the next scheduler tick (within five minutes).
  route("post", "/:id/check", async (req, res, userId) => {
    const existing = await owned(req.params.id as string, userId);
    await requestPollSoon(existing.databaseIds);
    res.json({ ok: true, databaseIds: existing.databaseIds });
  });
}
