import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  DEMO_CLIENT_KEYS, DEMO_ID_NAMESPACE, DEMO_PROJECT_NUMBERS, UUID_ID_TABLES, UUID_RE,
  demoClientId, demoProjectId, demoUuid, demoUuidIds, legacyIdMap,
} from "../../scripts/tutorials/demo-ids";

/**
 * The demo workspace's ids (scripts/tutorials/demo-ids.ts, seed-demo.ts). On 2026-10-08 the New
 * York and Texas jobs shipped to the recording template with readable ids (`demo-project-p-1997`)
 * and every one of their project pages said "Project not found": the app only accepts a uuid
 * there. Pure — no database, no browser. The page walk is scripts/tutorials/check-demo.ts.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
/** Source without comments, so a rule about code is not satisfied (or broken) by prose. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The two shape checks of the app itself, copied here on purpose: the test must fail if an id
// would be refused by what is deployed, not by what demo-ids.ts believes.
const PROJECT_ROUTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;      // GET /api/crm/projects/:id
const PREVIEW_GRANT = /^([0-9a-fA-F-]{36})\.(\d{10,16})\.([0-9a-f]{32})$/;                    // verifyPortalPreviewGrant

describe("demo ids", () => {
  it("every id the seed writes into a shape-checked table is a uuid the app accepts", () => {
    const ids = demoUuidIds();
    expect(Object.keys(ids).sort()).toEqual([...UUID_ID_TABLES].sort());
    for (const [table, list] of Object.entries(ids)) {
      expect(list.length, table).toBe(8);
      for (const id of list) {
        expect(id, `${table} ${id}`).toMatch(UUID_RE);
        expect(id, `${table} ${id}`).toMatch(PROJECT_ROUTE);
        expect(`${id}.${Date.now()}.${"0".repeat(32)}`, `${table} ${id}`).toMatch(PREVIEW_GRANT);
        expect(id.startsWith("demo-")).toBe(false);
      }
    }
    const all = Object.values(ids).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("is deterministic: version 5 of a fixed namespace and the row's old key (pinned — step scripts name these)", () => {
    expect(DEMO_ID_NAMESPACE).toBe("3d6f0c52-7b1e-4c8a-9a54-c0de5eed0d01");
    expect(demoUuid("demo-client-hadley")).toBe(demoUuid("demo-client-hadley"));
    expect(demoUuid("demo-client-hadley")).not.toBe(demoUuid("demo-client-hadleY"));
    expect(() => demoUuid("")).toThrow();
    // Checked against Python's uuid.uuid5 for the same namespace and name.
    expect(Object.fromEntries(DEMO_CLIENT_KEYS.map((k) => [k, demoClientId(k)]))).toEqual({
      ferrante: "e3d0aeaa-fa3e-5c70-847c-c758e5d4cf13", oyelaran: "3d523658-5af0-5414-a9fc-23d1bd383a4e",
      lindqvist: "c81a2dac-e323-5227-a95f-31409db3fc00", wrenhaven: "51c23c0b-f6a4-5421-8722-3ded98941a9e",
      hadley: "b5ac6e7a-ce39-50b1-a39e-5b326d166d80", brewster: "8b05f9de-dd79-5719-bbc6-622c2d75e07c",
      quintanilla: "106e2cea-befe-51ee-b75a-64890a2e5648", "halvorsen-quist": "922d4e0c-ba4f-5af1-882a-e3446b1f3772",
    });
    expect(Object.fromEntries(DEMO_PROJECT_NUMBERS.map((n) => [n, demoProjectId(n)]))).toEqual({
      "P-1993": "3f0147f4-5e28-5a22-8909-78d326b3a525", "P-1994": "e809dd9f-f4f3-5a0f-b8e7-b5bfda4c464a",
      "P-1995": "a8f16f80-e572-5aa3-8b17-685c69a55304", "P-1996": "8e76e74e-9392-58fc-ae7f-6100a679dc3b",
      "P-1997": "51f02ef8-0dfa-50a4-8247-eb2012cb5482", "P-1998": "a8b8ca24-bbe4-5d0a-9771-c35aad18e517",
      "P-1999": "60e6b77c-b3f2-5866-850a-608ad8271f61", "P-2000": "00f12701-566f-50c4-acab-6b00c417dc58",
    });
  });

  it("renames each old readable id to exactly one uuid", () => {
    const map = legacyIdMap();
    expect(map.length).toBe(16);
    expect(new Set(map.map((m) => m.from)).size).toBe(16);
    expect(new Set(map.map((m) => m.to)).size).toBe(16);
    for (const m of map) {
      expect(m.from).toMatch(m.table === "crm_customers" ? /^demo-client-[a-z-]+$/ : /^demo-project-p-\d{4}$/);
      expect(m.to).toBe(demoUuid(m.from));
      expect(demoUuidIds()[m.table]).toContain(m.to);
    }
  });
});

describe("seed-demo.ts", () => {
  const seed = code("scripts/tutorials/seed-demo.ts");

  it("writes no readable id into a shape-checked table: clients and projects take theirs from demo-ids.ts", () => {
    expect(seed).not.toMatch(/["'`]demo-(client|project)-/);
    // The eight clients, by key, in the order demo-ids.ts lists them.
    expect([...seed.matchAll(/\{ id: demoClientId\("([a-z-]+)"\), name: "/g)].map((m) => m[1])).toEqual([...DEMO_CLIENT_KEYS]);
    // The eight projects: typed by number, id derived from it at the insert.
    const numbers = [...seed.matchAll(/\{ number: "(P-\d{4})", client: "[^"]+", name: "/g)].map((m) => m[1]);
    expect(numbers).toEqual([...DEMO_PROJECT_NUMBERS]);
    expect(seed).toContain("[demoProjectId(p.number), orgId, customer(p.client), p.number,");
    // One insert per table, and the id is its first value.
    for (const table of UUID_ID_TABLES) expect(seed.split(`insert into ${table} (id, org_id,`).length - 1, table).toBe(1);
  });

  it("renames a workspace seeded with the old ids inside its one transaction, and refuses to finish with a non-uuid id", () => {
    expect(seed).toMatch(/const orgId: string = org\.id;\s+const seeded = demoUuidIds\(\);\s+const renamed = await renameLegacyIds\(orgId\);/);
    // The rename rewrites values only — it never deletes or re-makes a row — and proves it left nothing behind.
    const rename = seed.slice(seed.indexOf("async function renameLegacyIds"), seed.indexOf("async function main"));
    expect(rename).not.toMatch(/delete from|insert into|drop |alter |truncate/i);
    expect(rename).toContain("still holds an old demo id");
    expect(rename).toContain("the rename changed the row count");
    expect(seed).toContain("has a row whose id is not a uuid");
    // Still one transaction for everything the seed writes.
    expect(seed.match(/client\.query\("begin"\)/g)?.length).toBe(1);
    expect(seed.match(/client\.query\("commit"\)/g)?.length).toBe(1);
  });

  it("no other seed writes clients or projects", () => {
    const fixtures = code("scripts/tutorials/seed-fixtures.ts");
    for (const table of UUID_ID_TABLES) expect(fixtures, table).not.toContain(`insert into ${table}`);
    // The base workspace (scripts/seed-crm-demo.ts) lets the database make its ids: gen_random_uuid().
    expect(code("scripts/seed-crm-demo.ts")).not.toMatch(/id: ["'`]/);
  });
});

describe("the app's id shape checks", () => {
  it("are the ones demo-ids.ts knows — a new one means deciding whether that table's demo rows need uuids", () => {
    const shape = /\[0-9a-f(A-F)?-?\]\{(8|36)\}/;
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const f = `${dir}/${d.name}`;
        if (d.isDirectory()) walk(f);
        else if (/\.ts$/.test(d.name) && !/\.test\.ts$/.test(d.name) && shape.test(read(f))) found.push(f);
      }
    };
    walk("server/crm"); walk("server/jobcam");
    // entities.ts: the project page · hover.ts: the WORKSPACE id in a HOVER connect state (the base seed's own
    // uuid). (client-auth.ts used to be here: the portal-preview grant only took a 36-character client id —
    // fix-crm-defects on main, 2026-10-08, made it accept any id. The demo clients keep their uuids all the same.)
    expect(found.sort()).toEqual(["server/crm/entities.ts", "server/crm/hover.ts"]);
    expect(read("server/crm/entities.ts")).toContain('return res.status(404).json({ message: "Project not found" });');
  });

  it("the reseed refuses a template that still has a non-uuid client or project", () => {
    const db = code("scripts/tutorials/db.ts");
    expect(db).toContain("if (after.nonUuidIds) throw new Error(");
    expect(db).toMatch(/UUID_ID_TABLES\.map\(\(t\) => of\(t, ` and id !~\* \$\{uuid\}`\)\)/);
  });
});
