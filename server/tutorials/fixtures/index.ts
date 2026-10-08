/**
 * Tutorial fixtures — the public face (docs/tutorials/FIXTURES.md). Importing this registers every
 * provider fixture; registering is inert. Nothing is reachable unless gate.ts says this process is
 * a recording slot.
 */
import "./providers/stripe";
import "./providers/hover";
import "./providers/google-calendar";
import "./providers/sms";
import "./providers/email";
import "./providers/auth";
import "./providers/search-console";

export { tutorialFixturesOn, assertTutorialFixturesBootable, evaluateTutorialGate, fixtureMarked, FIXTURE_MARK } from "./gate";
import { registerTutorialFixtureRoutes } from "./registry";
export { providerFixture, registerTutorialFixtureRoutes, runTutorialFixtureBoot, registeredFixtureIds, FIXTURE_ROUTE_PREFIX } from "./registry";
export type { StripeFixture } from "./providers/stripe";
export type { HoverFixture } from "./providers/hover";
export type { GoogleCalendarFixture } from "./providers/google-calendar";
export type { SmsFixture } from "./providers/sms";
export type { EmailFixture } from "./providers/email";
export type { SearchConsoleFixture } from "./providers/search-console";

import { tutorialFixturesOn } from "./gate";

/**
 * In a recording slot no server-side request may leave the machine: a fixture that was forgotten
 * must fail loudly, not quietly reach a real provider. Loopback only (the slot calls its own
 * stand-in APIs and webhooks there). Installed once, by the boot wiring, and only with the gate on.
 */
let egressGuarded = false;
export function installTutorialEgressGuard(): boolean {
  if (!tutorialFixturesOn() || egressGuarded) return egressGuarded;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    let host = "";
    try { host = new URL(typeof input === "string" ? input : input?.url ?? String(input)).hostname; } catch { /* a relative URL cannot leave */ }
    if (host && !/^(127\.0\.0\.1|localhost|\[?::1\]?)$/.test(host)) throw new TypeError(`tutorial recording slot: outbound request to ${host} blocked (no fixture answers it)`);
    return real(input, init);
  }) as typeof fetch;
  egressGuarded = true;
  return true;
}

/**
 * The one call server/routes.ts makes. With the gate off it does nothing and returns false: no
 * route, no guard, no boot hook. With it on: the stand-in routes under /__tutorial (local-only),
 * the egress guard, and the boot hooks behind GET /__tutorial/ready.
 */
export function registerTutorialFixtures(app: import("express").Express): boolean {
  if (!tutorialFixturesOn()) return false;
  const demoOrgId = async (): Promise<string | null> => {
    const { pool } = await import("../../db");
    return (await pool.query(`select id from crm_orgs where name = 'Aspire Interiors' order by created_at limit 1`)).rows[0]?.id ?? null;
  };
  registerTutorialFixtureRoutes(app, demoOrgId);
  installTutorialEgressGuard();
  return true;
}
