/**
 * Per-agent e2e lane databases. Each swarm agent gets an isolated clone of
 * the shared dev database so N agents run the suite simultaneously without
 * serialising on constructhub_dev.
 *
 *   npx tsx script/e2e-lane.ts create   constructhub_dev_a1
 *   npx tsx script/e2e-lane.ts recreate constructhub_dev_a1
 *   npx tsx script/e2e-lane.ts drop     constructhub_dev_a1
 *
 * create: CREATE DATABASE owned by the app role, pg_dump | psql clone of
 * constructhub_dev (schema + seeded demo orgs the specs depend on — an empty
 * DB would trigger the full US-counties seed on server boot), then the
 * idempotent schema bootstrap (server/crm + server/lsa schema-ensure) as a
 * safety net for any drift.
 *
 * Safety: the name MUST match constructhub_dev_<lane>. This script can never
 * create or drop the shared constructhub_dev database itself, and can never
 * touch the live constructhub database.
 *
 * CREATE/DROP DATABASE needs a superuser; constructhub_dev has no createdb,
 * so those two statements go through passwordless sudo to the postgres OS
 * user (verified on this box). The clone runs as constructhub_dev over TCP.
 */
import { execSync } from "child_process";

const NAME_RE = /^constructhub_dev_[a-z0-9]+$/;
const TEMPLATE = "constructhub_dev";
const APP_URL = (db: string) =>
  `postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/${db}`;

const [cmd, name] = process.argv.slice(2);

if (!["create", "recreate", "drop"].includes(cmd ?? "") || !name) {
  console.error("usage: tsx script/e2e-lane.ts <create|recreate|drop> constructhub_dev_<lane>");
  process.exit(1);
}
if (!NAME_RE.test(name)) {
  console.error(
    `refusing: database name must match constructhub_dev_<lane> (got "${name}").\n` +
      `The shared dev DB and the live constructhub database are not valid lane targets.`,
  );
  process.exit(1);
}

const sh = (cmdline: string, env: Record<string, string> = {}) =>
  execSync(cmdline, { stdio: "inherit", env: { ...process.env, ...env } });

function dropDb() {
  // FORCE terminates any connections a crashed lane server left behind.
  sh(`sudo -n -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \\"${name}\\" WITH (FORCE)"`);
}

function createDb() {
  sh(`sudo -n -u postgres createdb -O constructhub_dev "${name}"`);
  sh(
    // grep -v: this box's pg_dump emits SET transaction_timeout (a param the
    // long-running server binary predates) — harmless to drop for a restore.
    `pg_dump --no-owner --no-privileges -h 127.0.0.1 -U constructhub_dev "${TEMPLATE}"` +
      ` | grep -v '^SET transaction_timeout'` +
      ` | psql -h 127.0.0.1 -U constructhub_dev -d "${name}" -v ON_ERROR_STOP=1 -q`,
    { PGPASSWORD: "crmdev_local_only" },
  );
}

async function bootstrap() {
  // Point the app's own pool at the new lane DB before importing it.
  process.env.DATABASE_URL = APP_URL(name);
  const { ensureCrmSchema } = await import("../server/crm/schema-ensure");
  const { ensureLsaSchema } = await import("../server/lsa/schema-ensure");
  await ensureCrmSchema();
  await ensureLsaSchema();
}

try {
  if (cmd === "drop") {
    dropDb();
    console.log(`dropped ${name}`);
  } else {
    if (cmd === "recreate") dropDb();
    createDb();
    await bootstrap();
    console.log(`created ${name} (clone of ${TEMPLATE}, schema bootstrap applied)`);
  }
  process.exit(0);
} catch (err) {
  console.error(`e2e-lane ${cmd} ${name} failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
}
