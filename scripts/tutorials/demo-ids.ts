/**
 * The ids of the demo rows that MUST be uuids — pure (no database, no environment), so the seed, the
 * page walk (check-demo.ts) and the tests share one definition.
 *
 * WHY: every CRM id column is `varchar` (shared/schema.ts), so a readable id like
 * `demo-project-p-1997` inserts fine — and then the app refuses it wherever it checks the shape:
 *   · GET /api/crm/projects/:id (server/crm/entities.ts) answers "Project not found" for any id
 *     that is not a uuid — the whole project page;
 *   · the client-portal preview grant (server/crm/client-auth.ts verifyPortalPreviewGrant) only
 *     accepts a 36-character hex id for the client — "Preview portal" silently lands signed out.
 * So the rows of crm_projects and crm_customers this seed creates carry a uuid: a version-5 uuid of
 * a fixed namespace and the row's old readable key, the same on every run and in every copy.
 *
 * The other demo tables (crm_members, crm_appointments, crm_client_comments, crm_payments,
 * crm_estimates, crm_invoices and their lines, jobcam_tags, jobcam_media) keep their readable
 * `demo-…` ids ON PURPOSE: no route checks their shape (check-demo.ts opens every one of them),
 * step scripts select them by those ids (`appointment-demo-appt-04`, `invoice-demo-invoice-inv-2000`),
 * and working copies with an older seed-demo.ts insert the Florida ones by id on every fresh
 * database — a new id there would give those producers every such row twice. If a route ever starts
 * checking one of those tables, add the table to UUID_ID_TABLES and its rows to legacyIdMap().
 */
import { createHash } from "crypto";

/** Fixed for ever: changing it changes every demo uuid, and every step script that names one. */
export const DEMO_ID_NAMESPACE = "3d6f0c52-7b1e-4c8a-9a54-c0de5eed0d01";
/** The shape the app's own checks accept (entities.ts is looser on the version nibble; this is the strict form). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** RFC 4122 version 5 (SHA-1) uuid of `key` in DEMO_ID_NAMESPACE — deterministic. */
export function demoUuid(key: string): string {
  if (!key) throw new Error("demoUuid needs a key");
  const ns = Buffer.from(DEMO_ID_NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(ns).update(key, "utf8").digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The New York and Texas clients, by the short key their old id ended in. */
export const DEMO_CLIENT_KEYS = ["ferrante", "oyelaran", "lindqvist", "wrenhaven", "hadley", "brewster", "quintanilla", "halvorsen-quist"] as const;
export type DemoClientKey = (typeof DEMO_CLIENT_KEYS)[number];
/** Their jobs, by project number. */
export const DEMO_PROJECT_NUMBERS = ["P-1993", "P-1994", "P-1995", "P-1996", "P-1997", "P-1998", "P-1999", "P-2000"] as const;
export type DemoProjectNumber = (typeof DEMO_PROJECT_NUMBERS)[number];

/** What these rows were called before 2026-10-08 — the uuid is derived from it, and the seed renames it away. */
export const legacyClientId = (key: DemoClientKey): string => `demo-client-${key}`;
export const legacyProjectId = (number: DemoProjectNumber): string => `demo-project-${number.toLowerCase()}`;

export const demoClientId = (key: DemoClientKey): string => demoUuid(legacyClientId(key));
export const demoProjectId = (number: DemoProjectNumber): string => demoUuid(legacyProjectId(number));

/** Tables whose ids the app shape-checks somewhere: no demo row in them may have a non-uuid id. */
export const UUID_ID_TABLES = ["crm_customers", "crm_projects"] as const;

/** Every id seed-demo.ts writes into a UUID_ID_TABLES table. */
export function demoUuidIds(): Record<(typeof UUID_ID_TABLES)[number], string[]> {
  return { crm_customers: DEMO_CLIENT_KEYS.map(demoClientId), crm_projects: DEMO_PROJECT_NUMBERS.map(demoProjectId) };
}

/** old readable id → uuid, for the one-off rename of a workspace seeded before 2026-10-08. */
export function legacyIdMap(): { table: (typeof UUID_ID_TABLES)[number]; from: string; to: string }[] {
  return [
    ...DEMO_CLIENT_KEYS.map((k) => ({ table: "crm_customers" as const, from: legacyClientId(k), to: demoClientId(k) })),
    ...DEMO_PROJECT_NUMBERS.map((n) => ({ table: "crm_projects" as const, from: legacyProjectId(n), to: demoProjectId(n) })),
  ];
}
