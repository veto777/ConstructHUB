import { expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import modulesSource from "./data/master-class-modules.json";
import guidesSource from "./data/state-guides.json";
import stepsSource from "./data/state-guide-steps.json";

// Importing the seeder must not open the application pool in this fixture.
vi.mock("./db", () => ({ db: {}, pool: {} }));
import { seedCourseReferenceData } from "./seed-reference-data";

it("uses neutral agency/adviser prompts for every item-14 step", () => {
  const selected = stepsSource.filter(s => s.state_code === "WA" ? s.step_number !== 2 : [1, 3, 4, 7].includes(s.step_number));
  expect(selected).toHaveLength(11);
  for (const step of selected) {
    const copy = `${step.description} ${step.tips}`;
    expect(copy).not.toMatch(/\$|\d|recommend|Gusto|Intuit|ADP|PSI|Pearson|liability protection|pass-through/i);
    expect(copy).toMatch(/check|review/i);
    expect(copy).toMatch(/agency|accountant|attorney|Labor & Industries/i);
  }
});

it.skipIf(!process.env.DATABASE_URL)("seeds empty catalogs, syncs only copy by stable keys, then updates zero", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/constructhub_dev_fs" || url.port === "5433") {
    throw new Error("This fixture requires constructhub_dev_fs and forbids port 5433");
  }
  const pool = new pg.Pool({ connectionString: url.toString() });
  const client = await pool.connect();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect((await client.query("SELECT current_database() AS name")).rows[0].name).toBe("constructhub_dev_fs");
    // Temporary tables shadow the application tables on this connection only.
    await client.query(`CREATE TEMP TABLE state_guides (id integer PRIMARY KEY, state_code text, overview text, untouched text DEFAULT 'keep');
      INSERT INTO state_guides (id, state_code) VALUES (9001,'WA'),(9002,'FL');
      CREATE TEMP TABLE master_class_modules (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text NOT NULL,
        description text NOT NULL, price integer NOT NULL, category text NOT NULL,
        sort_order integer DEFAULT 0 NOT NULL, is_active boolean DEFAULT true,
        features text[], created_at timestamp DEFAULT now() NOT NULL);
      CREATE TEMP TABLE state_guide_steps (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, state_guide_id integer NOT NULL,
        step_number integer NOT NULL, title text NOT NULL, description text NOT NULL,
        url text, url_label text, category text NOT NULL, is_required boolean DEFAULT true, tips text);
      CREATE TEMP TABLE user_progress (user_id integer, done boolean);
      INSERT INTO user_progress VALUES (123,true);`);
    const database = drizzle(client, { schema });
    const modules = structuredClone(modulesSource);
    const steps = structuredClone(stepsSource);
    const guides = structuredClone(guidesSource);
    expect(await seedCourseReferenceData(database, modules, steps, guides)).toEqual({ modules: 0, steps: 0, guides: 2 });
    expect((await client.query("SELECT DISTINCT state_guide_id FROM state_guide_steps ORDER BY 1")).rows)
      .toEqual([{ state_guide_id: 9001 }, { state_guide_id: 9002 }]);
    const beforeGuides = (await client.query("SELECT * FROM state_guides ORDER BY id")).rows;
    const beforeModules = (await client.query("SELECT * FROM master_class_modules ORDER BY id")).rows;
    const beforeSteps = (await client.query("SELECT * FROM state_guide_steps ORDER BY id")).rows;
    expect(beforeModules).toHaveLength(modules.length);
    expect(beforeSteps).toHaveLength(steps.length);
    guides.find(g => g.state_code === "WA")!.overview += " Updated fixture copy.";
    guides.push({ ...guides[0], state_code: "XX" });
    modules[0].description += " Updated fixture copy.";
    modules[0].features = ["Updated fixture topic"];
    modules[0].price += 1;
    modules[0].is_active = !modules[0].is_active;
    modules[0].category = "ignored";
    modules[0].sort_order += 1;
    steps[0].description += " Updated fixture copy.";
    steps[0].tips = "Updated fixture tip";
    steps[0].title = "Ignored title";
    steps[0].url = "https://example.invalid/ignored";
    steps[0].is_required = !steps[0].is_required;
    steps[0].state_guide_id = -1;
    // Unmatched source rows must not overwrite existing rows or create new ones.
    modules.push({ ...modules[0], title: "Unmatched fixture module" });
    steps.push({ ...steps[0], state_code: "XX" });
    expect(await seedCourseReferenceData(database, modules, steps, guides)).toEqual({ modules: 1, steps: 1, guides: 1 });
    expect((await client.query("SELECT * FROM master_class_modules ORDER BY id")).rows)
      .toEqual(beforeModules.map((m, i) => i ? m : { ...m, description: modules[0].description, features: modules[0].features }));
    expect((await client.query("SELECT * FROM state_guide_steps ORDER BY id")).rows)
      .toEqual(beforeSteps.map((s, i) => i ? s : { ...s, description: steps[0].description, tips: steps[0].tips }));
    expect(await seedCourseReferenceData(database, modules, steps, guides)).toEqual({ modules: 0, steps: 0, guides: 0 });
    expect((await client.query("SELECT * FROM state_guides ORDER BY id")).rows).toEqual(beforeGuides.map(g => g.state_code === "WA" ? { ...g, overview: guides.find(s => s.state_code === "WA")!.overview } : g));
    expect(log).toHaveBeenLastCalledWith("Updated reference copy: 0 module(s), 0 state guide step(s), 0 state guide overview(s).");
    expect((await client.query("SELECT * FROM user_progress")).rows).toEqual([{ user_id: 123, done: true }]);
  } finally {
    log.mockRestore();
    // Closing the dedicated connection removes its temporary tables, even after failure.
    client.release(true);
    await pool.end();
  }
});

it("generates an overview-only sync by state code with a no-change guard and logs its count", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const queries: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (query: any) => {
    const compiled = dialect.sqlToQuery(query);
    queries.push(compiled);
    if (compiled.sql.includes("COUNT(*)")) return { rows: [{ count: 1 }], rowCount: 1 };
    return { rows: [], rowCount: compiled.sql.startsWith("UPDATE state_guides g") ? 2 : 0 };
  });
  const database = { transaction: (run: any) => run({ execute }) };
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const source = [{ state_code: "WA", overview: "Existing factual overview." }];
    expect(await seedCourseReferenceData(database as any, [], [], source)).toEqual({ modules: 0, steps: 0, guides: 2 });
    const update = queries.find(q => q.sql.startsWith("UPDATE state_guides g"))!;
    expect(update.sql).toMatch(/SET overview = j.overview\s+FROM/);
    expect(update.sql).toContain("g.state_code = j.state_code AND g.overview IS DISTINCT FROM j.overview");
    expect(JSON.parse(update.params[0] as string)).toEqual(source);
    expect(log).toHaveBeenLastCalledWith("Updated reference copy: 0 module(s), 0 state guide step(s), 2 state guide overview(s).");
  } finally { log.mockRestore(); }
});
