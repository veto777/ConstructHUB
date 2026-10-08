/**
 * THE SAFETY GATE of the tutorial fixtures (docs/tutorials/FIXTURES.md).
 *
 * The walkthrough videos are recorded against a fictional demo workspace. Some pages need a
 * connected outside account (Stripe, HOVER, Google Calendar, a texting number) to show anything.
 * In a RECORDING SLOT ONLY, a fixture stands in for that provider so the real page and the real
 * server logic run. Fixture data is invented — and this project's hard rule (CLAUDE.md) is that
 * invented data never reaches a real user. This file is what enforces that.
 *
 * `tutorialFixturesOn()` is true only when ALL of these hold:
 *   1. TUTORIAL_FIXTURES=1
 *   2. NODE_ENV is not "production" (script/build.ts compiles `process.env.NODE_ENV` to the
 *      literal "production", so in the production bundle this file can only ever answer false)
 *   3. DATABASE_URL is 127.0.0.1 / localhost, port 5432 (5433 is PRODUCTION on this box), and names
 *      a recording database: a database `constructhub_tut_*`, or the dev database
 *      `constructhub_dev` reached through a `search_path` of exactly one `constructhub_tut_*` schema
 *   4. the process was started by the production line: TUTORIAL_SLOT is 1–8 (scripts/tutorials/
 *      app.ts sets it) and PORT is that slot's port, 8180 + slot
 *
 * TUTORIAL_FIXTURES=1 with any other condition failing is a misconfiguration that must never run:
 * `assertTutorialFixturesBootable()` throws, and boot-guard.ts turns that into a refusal to boot.
 *
 * Nothing but this file decides. Every fixture is reached through registry.ts, which asks here.
 */
export const TUTORIAL_SLOT_MAX = 8;
export const TUTORIAL_SLOT_PORT = (slot: number) => 8180 + slot;
const TUT_NAME = /^constructhub_tut_[a-z0-9_]+$/;
const DEV_DATABASE = "constructhub_dev";

/**
 * Every row a fixture writes is recognisable: its id (or its provider-side id) starts with one of
 * these, and where the table has a free-text note the note says so. `fixtureMarked()` is the test.
 */
export const FIXTURE_MARK = {
  /** Row ids written by scripts/tutorials/seed-fixtures.ts and by fixture helpers. */
  id: "tutfx-",
  /** The stand-in connected payment account (crm_payment_accounts.external_account_id). */
  stripeAccount: "acct_tutfx",
  /** Stand-in checkout sessions / intents / charges / events. */
  stripeObject: "tutfx",
  /** HOVER job ids (crm_measurements.external_id = "hover:tutfx-…"). */
  hoverJob: "tutfx-",
  note: "Tutorial fixture — fictional demo data, not a real transaction.",
} as const;
export const fixtureMarked = (value: unknown): boolean =>
  typeof value === "string" && /(^|[:_-])tutfx/.test(value);

export type GateVerdict = { requested: boolean; on: boolean; failures: string[] };

/**
 * The whole decision, as a pure function of an environment (tests call it with their own).
 * `scope: "seed"` is for scripts/tutorials/seed-fixtures.ts, which is not an app process: it has
 * no slot or port, and must pass everything else (so it too can only write a recording database).
 */
export function evaluateTutorialGate(env: Record<string, string | undefined>, nodeEnv: string | undefined, scope: "app" | "seed" = "app"): GateVerdict {
  const requested = env.TUTORIAL_FIXTURES === "1";
  const failures: string[] = [];
  if (nodeEnv === "production") failures.push('NODE_ENV is "production" — fixtures never run in a production process or a production build');

  let slot = NaN;
  if (scope === "seed") { /* no slot: the seed is run by the line's own tools against a named recording database */ }
  else if (!/^[1-8]$/.test(env.TUTORIAL_SLOT ?? "")) failures.push(`TUTORIAL_SLOT must be 1–${TUTORIAL_SLOT_MAX} (set by scripts/tutorials/app.ts) — this process was not started by the production line`);
  else {
    slot = Number(env.TUTORIAL_SLOT);
    if (env.PORT !== String(TUTORIAL_SLOT_PORT(slot))) failures.push(`PORT must be ${TUTORIAL_SLOT_PORT(slot)} for slot ${slot}`);
  }

  const raw = env.DATABASE_URL;
  if (!raw) failures.push("DATABASE_URL is not set");
  else {
    let u: URL | null = null;
    try { u = new URL(raw); } catch { failures.push("DATABASE_URL is not a URL"); }
    if (u) {
      if (!/^postgres(ql)?:$/.test(u.protocol)) failures.push("DATABASE_URL is not a postgres URL");
      if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") failures.push("the database host must be 127.0.0.1 or localhost");
      if ((u.port || "5432") !== "5432") failures.push("the database port must be 5432 (5433 is production)");
      const database = decodeURIComponent(u.pathname.slice(1));
      const paths = [...(u.searchParams.get("options") ?? "").matchAll(/search_path=([^\s]+)/g)].map((m) => m[1]);
      const viaDatabase = TUT_NAME.test(database);
      const viaSchema = database === DEV_DATABASE && paths.length === 1 && TUT_NAME.test(paths[0]);
      if (!viaDatabase && !viaSchema) failures.push("the database must be a recording database: constructhub_tut_*, or constructhub_dev with search_path=constructhub_tut_*");
    }
  }
  return { requested, on: requested && failures.length === 0, failures };
}

/**
 * `process.env.NODE_ENV` is written out in full on purpose: the production build replaces exactly
 * that expression with "production" (script/build.ts `define`), which makes the answer a constant.
 */
const verdict = (): GateVerdict => evaluateTutorialGate(process.env, process.env.NODE_ENV);

/** True only in a recording slot. Every fixture code path asks this (through registry.ts). */
export function tutorialFixturesOn(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return verdict().on;
}

/** Throws when fixtures were asked for anywhere they must not run. A no-op when they were not asked for. */
export function assertTutorialFixturesBootable(): void {
  const v = verdict();
  if (!v.requested || v.on) return;
  throw new Error(
    "REFUSING TO BOOT: TUTORIAL_FIXTURES=1 is set, but this is not a tutorial recording slot.\n"
    + v.failures.map((f) => `  - ${f}`).join("\n")
    + "\nTutorial fixtures are invented demo data for the walkthrough videos and must never run anywhere a real user could see them."
    + "\nUnset TUTORIAL_FIXTURES, or start the app with scripts/tutorials/app.ts.",
  );
}

/** For the fixture seed: throws unless fixtures were asked for AND the database is a recording database. */
export function assertFixtureSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  const v = evaluateTutorialGate(env, process.env.NODE_ENV, "seed");
  if (v.on) return;
  throw new Error(`refusing to write tutorial fixture rows: ${v.requested ? v.failures.join("; ") : "TUTORIAL_FIXTURES=1 is not set"}`);
}
