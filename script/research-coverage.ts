/**
 * Prints the research coverage manifest (server/research/coverage-manifest.ts) as JSON, for /compliance/research/coverage.
 *
 *   npx tsx script/research-coverage.ts [out.json]
 *
 * Needs no database and touches no network: every search is probed under a guard that makes network calls throw.
 * vite.config.ts runs it for the `virtual:research-coverage` module, so each build carries the sources of that build.
 */
import { writeFileSync } from "node:fs";

// The registry imports the database module; nothing here queries it (connections are refused by the guard anyway).
process.env.DATABASE_URL ||= "postgres://coverage@127.0.0.1:1/none";
const { installNetworkGuard, buildCoverageManifest } = await import("../server/research/coverage-manifest");
installNetworkGuard();
// Probes that hit the guard log their failures; keep stdout for the JSON.
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(`${a.join(" ")}\n`);
const manifest = await buildCoverageManifest();
const json = JSON.stringify(manifest);
if (process.argv[2]) writeFileSync(process.argv[2], json);
else process.stdout.write(json);
process.exit(0);
