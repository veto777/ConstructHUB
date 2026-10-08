/**
 * Recording databases — every walkthrough is recorded against its own fresh copy of the demo
 * workspace, so videos are reproducible and four producers can run at once (PRODUCER-GUIDE.md).
 *
 *   tsx scripts/tutorials/db.ts fresh <name>     drop + copy of constructhub_tut_template
 *   tsx scripts/tutorials/db.ts drop  <name>
 *   tsx scripts/tutorials/db.ts template [--rebuild]   build the template (schema, demo owner, demo seed)
 *   tsx scripts/tutorials/db.ts reseed [--fixtures]   apply scripts/tutorials/seed-demo.ts (and, with --fixtures,
 *                                                seed-fixtures.ts) to the EXISTING template — safe while producers
 *                                                are recording (see TEMPLATE_LOCK)
 *   tsx scripts/tutorials/db.ts list | mode
 *
 * SAFETY (not configurable):
 *   · <name> must match /^constructhub_tut_[a-z0-9_]+$/ — the dev database, a lane database and the
 *     live database can never be created, emptied or dropped by this file;
 *   · the server must be 127.0.0.1:5432. Port 5433 is PRODUCTION on this box: any other host or
 *     port is refused before a connection is opened;
 *   · the role and password are read at run time from the dev env file and never printed.
 *
 * TWO BACKENDS, one interface (`mode` says which is in use):
 *   database  `CREATE DATABASE <name> TEMPLATE constructhub_tut_template` — the intended design. It
 *             needs CREATEDB on the dev role, which it does NOT have on vb11 (2026-10-07), so this
 *             path is written but has never run here. It switches on by itself once the owner runs
 *             `ALTER ROLE constructhub_dev CREATEDB` as a superuser and `db.ts template` is run again.
 *   schema    the same names as SCHEMAS inside the dev database (constructhub_dev), reached with
 *             `search_path=<name>` on the connection — what runs today. `fresh` is pg_dump of the
 *             template schema, renamed in the stream, piped to psql (a few seconds). `public` is
 *             never on the search path, so a recording cannot read or write the dev data.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import pg from "pg";
import { ROOT, WORK_DIR, parseArgs, readEnvFile, run, withLock } from "./lib";

export const TUT_NAME = /^constructhub_tut_[a-z0-9_]+$/;
export const TEMPLATE = "constructhub_tut_template";
/**
 * Copies of the template hold this lock shared (any number at once); changing the template holds it
 * exclusively. It is a courtesy between working copies that have this code. What actually protects a
 * copy is the database: `fresh` reads the template with pg_dump (one snapshot) and `reseed` writes
 * it in one transaction of rows only — no table is created, renamed or dropped — so a copy taken at
 * any moment holds the template as it was before the reseed or as it is after, never half of it.
 * (Do not swap templates by renaming schemas: a pg_dump that is running prints the schema's NEW name
 * in its foreign keys.) `template --rebuild` drops the template and is NOT safe beside a producer.
 */
const TEMPLATE_LOCK = path.join(WORK_DIR, "template.lock");
/** Where the dev role and password live. Read-only, at run time. */
const DEV_ENV_FILE = process.env.TUTORIAL_DEV_ENV || "/home/voiceban/ConstructHUB-gstyle/.env";
const ALLOWED_HOST = "127.0.0.1", ALLOWED_PORT = "5432";

export function assertName(name: string): string {
  if (!TUT_NAME.test(name)) throw new Error(`refusing "${name}": a recording database must match ${TUT_NAME}`);
  return name;
}

type Base = { user: string; password: string; database: string };
let cachedBase: Base | null = null;
/** The dev connection, refused unless it is 127.0.0.1:5432. */
function base(): Base {
  if (cachedBase) return cachedBase;
  const raw = readEnvFile(DEV_ENV_FILE, ["DATABASE_URL"]).DATABASE_URL;
  if (!raw) throw new Error(`${DEV_ENV_FILE} has no DATABASE_URL`);
  const u = new URL(raw);
  if (u.hostname !== ALLOWED_HOST || (u.port || "5432") !== ALLOWED_PORT)
    throw new Error(`refusing ${u.hostname}:${u.port || "5432"}: recording databases live on ${ALLOWED_HOST}:${ALLOWED_PORT} only (5433 is production)`);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("the dev DATABASE_URL is not a postgres URL");
  cachedBase = { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) };
  return cachedBase;
}

export type DbMode = "database" | "schema";
let cachedMode: DbMode | null = null;
/** `database` when the dev role may create databases, else `schema`. TUTORIAL_DB_MODE overrides. */
export async function dbMode(): Promise<DbMode> {
  if (cachedMode) return cachedMode;
  const forced = process.env.TUTORIAL_DB_MODE;
  if (forced === "database" || forced === "schema") return (cachedMode = forced);
  const rows = await query(base().database, null, "select rolcreatedb or rolsuper as ok from pg_roles where rolname = current_user");
  return (cachedMode = rows[0]?.ok ? "database" : "schema");
}

const pgConfig = (database: string, schema: string | null): pg.ClientConfig => ({
  host: ALLOWED_HOST, port: Number(ALLOWED_PORT), user: base().user, password: base().password, database,
  options: schema ? `-c TimeZone=UTC -c search_path=${schema}` : "-c TimeZone=UTC",
});
async function query(database: string, schema: string | null, sql: string, params?: unknown[]): Promise<any[]> {
  const client = new pg.Client(pgConfig(database, schema));
  await client.connect();
  try { return (await client.query(sql, params as any[])).rows; } finally { await client.end(); }
}
/** Where a named recording database is: [database, schema-or-null]. */
async function locate(name: string): Promise<[string, string | null]> {
  assertName(name);
  return (await dbMode()) === "database" ? [name, null] : [base().database, name];
}

/**
 * The DATABASE_URL the app and the seeds use for a recording database. It carries the password:
 * hand it to a child process in its environment, never print it and never put it on a command line.
 */
export async function databaseUrl(name: string): Promise<string> {
  const [database, schema] = await locate(name);
  const b = base();
  const url = new URL(`postgres://${ALLOWED_HOST}:${ALLOWED_PORT}/${database}`);
  url.username = encodeURIComponent(b.user); url.password = encodeURIComponent(b.password);
  // node-postgres lets the URL's `options` replace the pool's own, so the UTC pin of server/db.ts is repeated here.
  if (schema) url.searchParams.set("options", `-c TimeZone=UTC -c search_path=${schema}`);
  return url.toString();
}
/** libpq environment for psql / pg_dump — the password never appears in a process list. */
async function libpqEnv(name: string): Promise<NodeJS.ProcessEnv> {
  const [database, schema] = await locate(name);
  return { PATH: process.env.PATH, PGHOST: ALLOWED_HOST, PGPORT: ALLOWED_PORT, PGUSER: base().user, PGPASSWORD: base().password, PGDATABASE: database,
    PGOPTIONS: schema ? `-c search_path=${schema}` : "" };
}

export async function exists(name: string): Promise<boolean> {
  const [database, schema] = await locate(name);
  if (schema) return (await query(database, null, "select 1 from pg_namespace where nspname = $1", [schema])).length > 0;
  return (await query(base().database, null, "select 1 from pg_database where datname = $1", [name])).length > 0;
}

export async function drop(name: string): Promise<void> {
  const [database, schema] = await locate(name);
  // FORCE / a short lock wait: a crashed app may have left connections behind, and a hung drop would hold a slot for ever.
  if (schema) await query(database, null, `set lock_timeout = '20s'; drop schema if exists "${schema}" cascade`);
  else await query(base().database, null, `drop database if exists "${name}" with (force)`);
}

/** Rename the template schema in a plain pg_dump stream — everywhere except inside COPY data. */
function renameSchema(from: string, to: string) {
  const word = new RegExp(`\\b${from}\\b`, "g");
  let inCopy = false, carry = "";
  const line = (l: string): string => {
    if (inCopy) { if (l === "\\.") inCopy = false; return l; }
    if (/^COPY .* FROM stdin;$/.test(l)) { inCopy = true; return l.replace(word, to); }
    return l.replace(word, to);
  };
  return {
    push(chunk: string): string {
      const lines = (carry + chunk).split("\n");
      carry = lines.pop()!;
      return lines.length ? lines.map(line).join("\n") + "\n" : "";
    },
    end: (): string => (carry ? line(carry) : ""),
  };
}

/** Drop <name> and make it a copy of the template. */
export async function fresh(name: string): Promise<void> {
  assertName(name);
  if (name === TEMPLATE) throw new Error("the template is built with `db.ts template`, not `fresh`");
  await withLock(TEMPLATE_LOCK, () => copyTemplate(name), { shared: true });
}
async function copyTemplate(name: string): Promise<void> {
  if (!(await exists(TEMPLATE))) throw new Error(`${TEMPLATE} does not exist — run: npx tsx scripts/tutorials/db.ts template`);
  await drop(name);
  if ((await dbMode()) === "database") { await query(base().database, null, `create database "${name}" template "${TEMPLATE}"`); return; }
  const dump = spawn("pg_dump", ["--no-owner", "--no-privileges", "--schema", TEMPLATE], { env: await libpqEnv(TEMPLATE), stdio: ["ignore", "pipe", "pipe"] });
  const restore = spawn("psql", ["-q", "-X", "-v", "ON_ERROR_STOP=1", "--single-transaction"], { env: { ...(await libpqEnv(TEMPLATE)), PGOPTIONS: "" }, stdio: ["pipe", "ignore", "pipe"] });
  const rename = renameSchema(TEMPLATE, name);
  let dumpErr = "", restoreErr = "";
  dump.stderr.on("data", (d) => { dumpErr += d; });
  restore.stderr.on("data", (d) => { restoreErr += d; });
  dump.stdout.setEncoding("utf8");
  restore.stdin.on("error", () => { /* psql stopped early; its exit code says why */ });
  dump.stdout.on("data", (chunk: string) => {
    // This box's pg_dump can emit a setting the running server predates; it is harmless to leave out.
    const out = rename.push(chunk).replace(/^SET transaction_timeout.*\n/m, "");
    if (out && !restore.stdin.write(out)) { dump.stdout.pause(); restore.stdin.once("drain", () => dump.stdout.resume()); }
  });
  const dumped = new Promise<number>((r) => dump.on("close", (c) => { restore.stdin.end(rename.end()); r(c ?? 1); }));
  const restored = new Promise<number>((r) => restore.on("close", (c) => r(c ?? 1)));
  const [a, b] = await Promise.all([dumped, restored]);
  if (a !== 0 || b !== 0) { await drop(name).catch(() => {}); throw new Error(`copying the template failed (pg_dump ${a}, psql ${b})\n${(dumpErr + restoreErr).slice(-1500)}`); }
  // A restored copy has no planner statistics; without them the app's first boot takes a minute longer.
  await query(base().database, name, "analyze");
}

/** Run the date-refreshing demo seed against a recording database (after `fresh`, before the app starts). */
export async function seedDemo(name: string): Promise<string> {
  return (await run(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "scripts/tutorials/seed-demo.ts")], { env: { ...process.env, DATABASE_URL: await databaseUrl(name) }, cwd: ROOT })).stdout.trim();
}

/**
 * The tutorial fixture rows (a connected payment account, online payments in every state, the
 * calendar / texting / HOVER connection settings) — after seedDemo, one transaction, idempotent.
 * seed-fixtures.ts itself refuses without TUTORIAL_FIXTURES=1 and outside a recording database.
 */
export async function seedFixtures(name: string): Promise<string> {
  return (await run(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "scripts/tutorials/seed-fixtures.ts")], { env: { ...process.env, TUTORIAL_FIXTURES: "1", DATABASE_URL: await databaseUrl(name) }, cwd: ROOT })).stdout.trim();
}

/**
 * Apply the demo seed to the template that exists: new demo rows reach every copy made from now on,
 * also copies made by a working copy whose own seed-demo.ts is older. One transaction (seed-demo.ts).
 */
export async function reseedTemplate(opts: { fixtures?: boolean } = {}): Promise<string> {
  if (!(await exists(TEMPLATE))) throw new Error(`${TEMPLATE} does not exist — run: npx tsx scripts/tutorials/db.ts template`);
  return withLock(TEMPLATE_LOCK, async () => {
    let out = await seedDemo(TEMPLATE);
    // `--fixtures`: also the fixture rows, each seed its own single transaction of rows only, under
    // this one exclusive lock. Every copy made afterwards carries them — also the copies of working
    // copies WITHOUT the fixture code, whose Payments page then lists the five online payments
    // (their pages still say "not configured"). produce.ts applies them per slot anyway, so the
    // template only needs them once every producer has this code.
    if (opts.fixtures) out += `\n${await seedFixtures(TEMPLATE)}`;
    const [database, schema] = await locate(TEMPLATE);
    await query(database, schema, "analyze");
    return out;
  });
}

/** Every recording database that exists now. */
export async function list(): Promise<string[]> {
  const mode = await dbMode();
  const rows = mode === "database"
    ? await query(base().database, null, "select datname as n from pg_database where datname ~ '^constructhub_tut_' order by 1")
    : await query(base().database, null, "select nspname as n from pg_namespace where nspname ~ '^constructhub_tut_' order by 1");
  return rows.map((r) => r.n as string);
}

/**
 * Build the template: an empty database, the schema from shared/schema.ts (drizzle-kit export) and
 * scripts/apply-schema-migration.ts, one boot of the app (its own ensure/seed path creates the
 * rest), the demo owner as user 1 (the dev bypass signs every request in as user 1), then the CRM
 * demo seed and scripts/tutorials/seed-demo.ts.
 */
const buildTemplate = (rebuild: boolean): Promise<void> => withLock(TEMPLATE_LOCK, () => buildTemplateLocked(rebuild));
async function buildTemplateLocked(rebuild: boolean): Promise<void> {
  const { startApp } = await import("./app");
  if (await exists(TEMPLATE)) {
    if (!rebuild) throw new Error(`${TEMPLATE} already exists — pass --rebuild to replace it (no producer may be running)`);
    await drop(TEMPLATE);
  }
  const mode = await dbMode();
  if (mode === "database") await query(base().database, null, `create database "${TEMPLATE}"`);
  else await query(base().database, null, `create schema "${TEMPLATE}"`);
  const url = await databaseUrl(TEMPLATE);
  const env = { ...process.env, DATABASE_URL: url };
  const tsx = path.join(ROOT, "node_modules/.bin/tsx");
  const step = async (what: string, fn: () => Promise<unknown>) => { const t = Date.now(); process.stdout.write(`  ${what} … `); await fn(); console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`); };

  await step("schema from shared/schema.ts", async () => {
    const ddl = (await run(path.join(ROOT, "node_modules/.bin/drizzle-kit"), ["export", "--config", path.join(ROOT, "drizzle.config.ts")], { env, cwd: ROOT })).stdout;
    if (!/CREATE TABLE/.test(ddl)) throw new Error("drizzle-kit export produced no tables");
    const [database, schema] = await locate(TEMPLATE);
    await query(database, schema, ddl);
  });
  await step("scripts/apply-schema-migration.ts", () => run(tsx, [path.join(ROOT, "scripts/apply-schema-migration.ts")], { env, cwd: ROOT }));
  // User 1 before the first boot: the app's seeds and the dev bypass both expect it.
  await step("demo owner (user 1)", async () => {
    const [database, schema] = await locate(TEMPLATE);
    const rows = await query(database, schema,
      `insert into users (email, display_name, email_verified, company_name) values ('demo@example.com', 'Demo Account', true, 'Aspire Interiors') returning id`);
    if (rows[0].id !== 1) throw new Error(`the demo owner got id ${rows[0].id}, not 1`);
  });
  await step("first boot (the app's own ensure + seed path)", async () => {
    const app = await startApp({ slot: 0, database: TEMPLATE, bootTimeoutMs: 15 * 60_000 });
    try {
      const me = await fetch(`http://127.0.0.1:${app.port}/api/crm/me`);
      if (me.status >= 500) throw new Error(`/api/crm/me answered ${me.status}`);
    } finally { await app.stop(); }
  });
  await step("scripts/seed-crm-demo.ts", () => run(tsx, [path.join(ROOT, "scripts/seed-crm-demo.ts")], { env, cwd: ROOT }));
  await step("scripts/tutorials/seed-demo.ts", () => run(tsx, [path.join(ROOT, "scripts/tutorials/seed-demo.ts")], { env, cwd: ROOT }));
  await step("scripts/tutorials/seed-fixtures.ts", () => seedFixtures(TEMPLATE));
  // A second boot settles whatever the app creates lazily or re-checks after its first run (seed_state,
  // the appraiser and portal passes), so the copies start in seconds instead of redoing it.
  for (const n of ["second", "third"])
    await step(`${n} boot`, async () => { const app = await startApp({ slot: 0, database: TEMPLATE, bootTimeoutMs: 15 * 60_000 }); await app.stop(); });
  { const [database, schema] = await locate(TEMPLATE); await query(database, schema, "analyze"); }
  console.log(`${TEMPLATE} is ready (${mode} mode)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ["rebuild", "fixtures"]);
  const [cmd, name] = args._;
  if (cmd === "mode") { console.log(await dbMode()); return; }
  if (cmd === "list") { console.log((await list()).join("\n")); return; }
  if (cmd === "template") { await buildTemplate(!!args.flags.rebuild); return; }
  if (cmd === "reseed") { console.log(await reseedTemplate({ fixtures: !!args.flags.fixtures })); console.log(`${TEMPLATE} reseeded at ${new Date().toISOString()}`); return; }
  if ((cmd !== "fresh" && cmd !== "drop") || !name) throw new Error("Usage: tsx scripts/tutorials/db.ts <fresh|drop> constructhub_tut_<name> | template [--rebuild] | reseed [--fixtures] | list | mode");
  assertName(name);
  if (cmd === "drop" && name === TEMPLATE && !args.flags.rebuild) throw new Error("dropping the template takes --rebuild on `template`, not `drop`");
  const t = Date.now();
  if (cmd === "fresh") await fresh(name); else await drop(name);
  console.log(`${cmd} ${name}: done in ${((Date.now() - t) / 1000).toFixed(1)}s (${await dbMode()} mode)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
