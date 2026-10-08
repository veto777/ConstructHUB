/**
 * THE ONE PLACE tutorial fixtures are registered and reached (docs/tutorials/FIXTURES.md).
 *
 * A provider fixture stands in for one outside service in a recording slot. It can offer:
 *   adapter   what the feature code asks for at its seam — `providerFixture("stripe")` — instead of
 *             its real client / credentials. NULL whenever the gate is off, so the feature code's
 *             real path is untouched.
 *   routes    local-only HTTP endpoints under /__tutorial/<id>/… (a stand-in provider API the real
 *             client code calls, or a stand-in hosted page). Not mounted when the gate is off.
 *   actions   helpers the recorder's `fixture` step calls (POST /__tutorial/action/<id>.<name>):
 *             inject an inbound text, mark an estimate opened, hand over an emailed link.
 *   onBoot    connection state that cannot live in the seed (anything encrypted with the slot's
 *             own session secret).
 *
 * Every accessor here asks gate.ts first. With the gate off: no adapter, no route, no action, no
 * boot hook — server/tutorials/fixtures/fixtures.test.ts asserts exactly that.
 *
 * To add a provider: one file in providers/ that calls `defineProviderFixture`, one import line in
 * index.ts, and one `providerFixture("<id>")` at the feature's narrowest seam.
 */
import type { Express, Request, Response, Router } from "express";
import express from "express";
import { tutorialFixturesOn } from "./gate";

export type FixtureActionContext = { req: Request; orgId: string; origin: string };
export type FixtureAction = (input: Record<string, any>, ctx: FixtureActionContext) => Promise<Record<string, unknown> | void>;

export interface ProviderFixture<Adapter = unknown> {
  /** Short id: "stripe", "hover", "google-calendar", "sms", "email", "client", "search-console". */
  id: string;
  /** What it simulates, in a sentence (listed by GET /__tutorial/fixtures and in FIXTURES.md). */
  simulates: string;
  /** The seam it hooks: file and symbol. */
  seam: string;
  /** Built once, on first use, and only with the gate on. */
  adapter?: () => Adapter;
  routes?: (router: Router) => void;
  actions?: Record<string, FixtureAction>;
  onBoot?: (ctx: { orgId: string }) => Promise<void>;
}

const providers = new Map<string, ProviderFixture<any>>();
const adapters = new Map<string, unknown>();

/** Called by each providers/*.ts at import. Registering is inert: nothing runs until the gate says so. */
export function defineProviderFixture<A>(def: ProviderFixture<A>): ProviderFixture<A> {
  if (providers.has(def.id)) throw new Error(`tutorial fixture "${def.id}" is registered twice`);
  providers.set(def.id, def);
  return def;
}

/** Ids of every registered provider fixture (registration is not activation). */
export const registeredFixtureIds = (): string[] => [...providers.keys()].sort();

/**
 * The seam call. Feature code writes `const fx = providerFixture<StripeFixture>("stripe")` and uses
 * `fx` only when it is not null — which is only in a recording slot.
 */
export function providerFixture<A = unknown>(id: string): A | null {
  if (!tutorialFixturesOn()) return null;
  const def = providers.get(id);
  if (!def?.adapter) return null;
  if (!adapters.has(id)) adapters.set(id, def.adapter());
  return adapters.get(id) as A;
}

/** A fixture helper refuses to do anything outside a slot — also when called directly. */
export function requireTutorialFixtures(what: string): void {
  if (!tutorialFixturesOn()) throw new Error(`${what} is a tutorial fixture and is only available in a recording slot`);
}

/** Only this machine may call fixture routes: the recorder and the slot's own server. */
function localOnly(req: Request, res: Response, next: () => void) {
  const ip = String(req.socket.remoteAddress || "");
  const forwarded = req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || req.headers["x-real-ip"];
  if (forwarded || !/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip)) { res.status(404).end(); return; }
  next();
}

export const FIXTURE_ROUTE_PREFIX = "/__tutorial";

/**
 * Mount every fixture route — or nothing at all. Returns what was mounted (empty when the gate is off).
 * `demoOrgId` resolves the demo workspace for actions and boot hooks.
 */
export function registerTutorialFixtureRoutes(app: Express, demoOrgId: () => Promise<string | null>): string[] {
  if (!tutorialFixturesOn()) return [];
  const root = express.Router();
  root.use(localOnly);
  // Never cached, never indexed, never logged with a body (the request log only prints /api paths).
  root.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex"); next(); });
  const mounted: string[] = [];
  for (const def of providers.values()) {
    if (!def.routes) continue;
    const r = express.Router();
    def.routes(r);
    root.use(`/${def.id}`, r);
    mounted.push(def.id);
  }
  root.get("/fixtures", (_req, res) => {
    res.json({ fixtures: [...providers.values()].map((d) => ({ id: d.id, simulates: d.simulates, seam: d.seam, actions: Object.keys(d.actions ?? {}) })) });
  });
  root.post("/action/:name", async (req, res) => {
    if (!tutorialFixturesOn()) return res.status(404).end();
    const [id, ...rest] = String(req.params.name).split(".");
    const action = providers.get(id)?.actions?.[rest.join(".")];
    if (!action) return res.status(404).json({ message: `no fixture action ${req.params.name}` });
    try {
      const orgId = await demoOrgId();
      if (!orgId) return res.status(409).json({ message: "the demo workspace does not exist in this database" });
      const origin = `${req.protocol}://${req.headers.host}`;
      res.json({ ok: true, ...((await action((req.body ?? {}) as Record<string, any>, { req, orgId, origin })) ?? {}) });
    } catch (e: any) {
      res.status(400).json({ ok: false, message: String(e?.message || e).slice(0, 300) });
    }
  });
  // Boot hooks need the server to be answering (HOVER's sync calls this process's own stand-in API),
  // so they run on the first call of /ready — which scripts/tutorials/app.ts makes before recording.
  let booted: Promise<string[]> | null = null;
  root.get("/ready", async (_req, res) => {
    try { res.json({ ok: true, slot: process.env.TUTORIAL_SLOT, booted: await (booted ??= runTutorialFixtureBoot(demoOrgId)), routes: mounted }); }
    catch (e: any) { booted = null; res.status(500).json({ ok: false, message: String(e?.message || e).slice(0, 400) }); }
  });
  app.use(FIXTURE_ROUTE_PREFIX, root);
  return mounted;
}

/** Run every provider's boot hook (connection state that depends on the slot's own secrets). */
export async function runTutorialFixtureBoot(demoOrgId: () => Promise<string | null>): Promise<string[]> {
  if (!tutorialFixturesOn()) return [];
  const orgId = await demoOrgId();
  if (!orgId) return [];
  const ran: string[] = [];
  for (const def of providers.values()) {
    if (!def.onBoot) continue;
    await def.onBoot({ orgId });
    ran.push(def.id);
  }
  return ran;
}

/** Tests only: forget built adapters (the gate is re-read on every call anyway). */
export function resetTutorialFixtureAdapters(): void { adapters.clear(); }
