/** Entirely disposable PostgreSQL cluster, Unix socket only. Never reads DATABASE_URL or .env. */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { ensureListingSchema } from "./schema";
import {
  catalogue,
  seedListingDirectories,
  unresolvedDirectories,
} from "./catalogue";
import { loadScoutedDirectories } from "./scouted";
import { ListingStore, domainAllows, type Scope } from "./store";
import { analyzeListing } from "./nap";
const bin = process.env.LISTINGS_TEST_PG_BIN ?? "/usr/lib/postgresql/16/bin";
const a: Scope = { userId: 1, actorId: 1, admin: false },
  b: Scope = { userId: 2, actorId: 2, admin: false },
  admin: Scope = { userId: 3, actorId: 3, admin: true };
let root: string,
  db: pg.Pool,
  store: ListingStore,
  profile: any,
  other: any,
  directory: number,
  listing: any;
function command(name: string, args: string[]) {
  const r = spawnSync(path.join(bin, name), args, {
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr} ${r.stdout}`);
}
describe.skipIf(!existsSync(path.join(bin, "initdb")))(
  "ledger against isolated offline PostgreSQL",
  () => {
    beforeAll(async () => {
      mkdirSync(".cache", { recursive: true });
      root = mkdtempSync(path.resolve(".cache/listings-pg-"));
      mkdirSync(path.join(root, "socket"));
      command("initdb", [
        "-D",
        path.join(root, "data"),
        "-A",
        "trust",
        "--no-locale",
        "-U",
        "ledger_test",
      ]);
      command("pg_ctl", [
        "-D",
        path.join(root, "data"),
        "-l",
        path.join(root, "postgres.log"),
        "-o",
        `-F -k ${path.join(root, "socket")} -h ''`,
        "-w",
        "start",
      ]);
      db = new pg.Pool({
        host: path.join(root, "socket"),
        database: "postgres",
        user: "ledger_test",
      });
      await db.query(`CREATE TABLE users(id integer PRIMARY KEY,email text); INSERT INTO users VALUES(1,'one@example.com'),(2,'two@example.com'),(3,'admin@example.com');
   CREATE TABLE business_locations(id integer PRIMARY KEY,user_id integer NOT NULL,business_name text,address text,phone text,gbp_location_name text);
   INSERT INTO business_locations VALUES(1,1,'Fixture Roofing','12 Main St','2125550100',NULL),(2,2,'Other Company',NULL,NULL,NULL)`);
      await ensureListingSchema(db);
      await ensureListingSchema(db);
      await seedListingDirectories(db);
      store = new ListingStore(db, async (url, p, status) =>
        analyzeListing(
          {
            url,
            status: 200,
            body: readFileSync(
              new URL("./fixtures/local-business.html", import.meta.url),
              "utf8",
            ),
          },
          p,
          status,
        ),
      );
      profile = await store.saveProfile(a, 1, {
        street_address: "12 N Main St",
        address_line2: "Ste 4",
        city: "Albany",
        state: "NY",
        postal_code: "12207",
        service_area_only: false,
      });
      other = await store.saveProfile(b, 2, null);
      directory = (
        await db.query(
          "SELECT id FROM listing_directories WHERE domain='yelp.com'",
        )
      ).rows[0].id;
    }, 30000);
    afterAll(async () => {
      await db?.end();
      if (root && existsSync(path.join(root, "data/postmaster.pid")))
        command("pg_ctl", [
          "-D",
          path.join(root, "data"),
          "-m",
          "fast",
          "-w",
          "stop",
        ]);
      if (root) rmSync(root, { recursive: true, force: true });
    });
    it("seeds idempotently, covers checklist domains, leaves unknown requirements null, preserves edits", async () => {
      const count = (
        await db.query("SELECT count(*)::int n FROM listing_directories")
      ).rows[0].n;
      expect(count).toBe(catalogue().length + unresolvedDirectories.length + loadScoutedDirectories().length);
      const routes = readFileSync(
        new URL("../routes.ts", import.meta.url),
        "utf8",
      );
      const checklist = routes
        .split("const CITATION_DIRECTORIES = [")[1]
        .split("];")[0];
      for (const [, domain] of checklist.matchAll(/url: "([^"]+)"/g))
        expect(catalogue().some((d) => d.domain === domain)).toBe(true);
      await db.query(
        "UPDATE listing_directories SET notes='owner note',active=false WHERE domain='google.com'",
      );
      await seedListingDirectories(db);
      expect(
        (await db.query("SELECT count(*)::int n FROM listing_directories"))
          .rows[0].n,
      ).toBe(count);
      const google = (
        await db.query(
          "SELECT * FROM listing_directories WHERE domain='google.com'",
        )
      ).rows[0];
      expect(google.notes).toBe("owner note");
      expect(google.active).toBe(false);
      expect(google.requires_street_address).toBeNull();
      expect(
        (
          await db.query(
            "SELECT * FROM listing_directories WHERE name='RexLocal'",
          )
        ).rows[0].domain,
      ).toBeNull();
    });
    it("scopes location/profile reads and import/edit writes, with admin access", async () => {
      for (const fn of [
        () => store.location(a, 2),
        () => store.profile(a, 2),
        () => store.saveProfile(a, 2, { name: "attack" }),
        () => store.events(a, 2, 100, 0),
      ])
        await expect(fn()).rejects.toMatchObject({ status: 404 });
      expect((await store.profile(admin, 2)).user_id).toBe(2);
      expect(
        (await store.saveProfile(admin, 2, { name: "Admin-edited" })).user_id,
      ).toBe(2);
      expect((await store.profile(b, 2)).name).toBe("Admin-edited");
    });
    it("rejects cross-account adds, unrelated domains, duplicate ledger rows and cross-account rechecks", async () => {
      await expect(
        store.add(a, other.id, directory, "https://yelp.com/biz/test"),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        store.add(
          a,
          profile.id,
          directory,
          "https://yelp.com.attacker.test/biz/test",
        ),
      ).rejects.toMatchObject({ status: 400 });
      listing = await store.add(
        a,
        profile.id,
        directory,
        "https://www.yelp.com/biz/fixture",
      );
      expect(listing.status).toBe("queued");
      expect(listing.billable).toBe(false);
      expect(listing.last_checked_at).toBeNull();
      await expect(
        store.add(a, profile.id, directory, listing.listing_url),
      ).rejects.toMatchObject({ status: 409 });
      await expect(store.recheck(b, listing.id)).rejects.toMatchObject({
        status: 404,
      });
    });
    it("scopes lists, summary, and events; crawler alone establishes billability", async () => {
      expect(await store.list(b, { limit: 50, offset: 0 })).toEqual([]);
      expect(await store.list(admin, { limit: 50, offset: 0 })).toHaveLength(1);
      const verified = await store.recheck(a, listing.id);
      expect(verified.status).toBe("live");
      expect(verified.billable).toBe(true);
      expect(await store.summary(a)).toMatchObject({
        total: 1,
        live: 1,
        billable: 1,
        by_tier: { 1: { live: 1 } },
        by_category: { general: { billable: 1 } },
      });
      expect(await store.summary(b)).toMatchObject({
        total: 0,
        live: 0,
        billable: 0,
      });
      expect(await store.summary(admin)).toMatchObject({
        total: 1,
        live: 1,
        billable: 1,
      });
      const events = await store.events(a, 1, 100, 0);
      expect(events.at(-1).type).toBe("listing_checked");
      expect(events.at(-1).detail.evidence.confirmation).toBe("confirmed");
      expect(events.map((e) => Number(e.id))).toEqual(
        events.map((e) => Number(e.id)).sort((x, y) => x - y),
      );
    });
    it("DB constraints reject billability without evidence/NAP, including SQL null semantics", async () => {
      for (const fragment of [
        "status='queued'",
        "nap_result=NULL",
        "evidence=NULL",
        "nap_result='{}'::jsonb",
        "evidence='{}'::jsonb",
        "last_checked_at=NULL",
      ]) {
        await expect(
          db.query(
            `UPDATE listings SET billable=true,${fragment} WHERE id=$1`,
            [listing.id],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      }
    });
    it("refresh preserves owner overrides and invalidates previous checks", async () => {
      await store.saveProfile(a, 1, { name: "Owner label", phone: null });
      const result = await store.saveProfile(a, 1, null, {
        title: "New Google label",
        phoneNumbers: { primaryPhone: "2125550199" },
        websiteUri: "https://example.com",
      });
      expect(result.name).toBe("Owner label");
      expect(result.phone).toBeNull();
      expect(result.website).toBe("https://example.com");
      const [l] = await store.list(a, { limit: 50, offset: 0 });
      expect(l.status).toBe("queued");
      expect(l.billable).toBe(false);
      expect(l.nap_result).toBeNull();
    });
    it("rejects stale in-flight checks after a profile edit", async () => {
      const racing = new ListingStore(db, async (url, p, status) => {
        await store.saveProfile(a, 1, { name: "Changed during fetch" });
        return analyzeListing({ url, status: 200, body: "" }, p, status);
      });
      await expect(racing.recheck(a, listing.id)).rejects.toMatchObject({
        status: 409,
      });
    });
    it("filters directory metadata without interpolating user input", async () => {
      const rows = await store.directories({ tier: 1, kind: "api" });
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.tier === 1)).toBe(true);
      expect(await store.directories({ trade: "roofer' OR true --" })).toEqual(
        [],
      );
      expect(domainAllows("yelp.com", "https://www.yelp.com/biz/fixture")).toBe(
        true,
      );
      expect(domainAllows("yelp.com", "https://yelp.com.attacker.test/")).toBe(
        false,
      );
    });
    it("admin profile lists include accounts and verified counts with bounded paging", async () => {
      await expect(
        store.adminProfiles(a, { limit: 50, offset: 0 }),
      ).rejects.toMatchObject({ status: 403 });
      const profiles = await store.adminProfiles(admin, {
        limit: 50,
        offset: 0,
      });
      expect(profiles).toHaveLength(2);
      expect(profiles.find((row) => row.user_id === 1)).toMatchObject({
        account_email: "one@example.com",
        total: 1,
        billable: 0,
      });
      expect(
        await store.adminProfiles(admin, { limit: 1, offset: 1 }),
      ).toHaveLength(1);
    });
    it("admin directory changes validate, persist, retain unknowns and protect evidence domains", async () => {
      const input = {
        name: "Research fixture",
        domain: "directory.example.com",
        kind: "submission" as const,
        tier: 4,
        category: "contractor" as const,
        source: "https://directory.example.com/about",
      };
      await expect(store.saveDirectory(a, null, input)).rejects.toMatchObject({
        status: 403,
      });
      const created = await store.saveDirectory(admin, null, input);
      expect(created).toMatchObject({
        ...input,
        active: true,
        trades: null,
        requires_street_address: null,
      });
      expect(
        await store.saveDirectory(admin, created.id, {
          active: false,
          states: ["NY"],
          notes: "Researched",
        }),
      ).toMatchObject({ active: false, states: ["NY"], notes: "Researched" });
      await expect(
        store.saveDirectory(admin, null, input),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        store.saveDirectory(admin, 2147483647, { active: false }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        store.saveDirectory(admin, directory, { domain: "other.example.com" }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        store.saveDirectory(admin, created.id, { domain: "localhost" }),
      ).rejects.toThrow();
      await store.saveDirectory(admin, created.id, { active: true });
      await expect(
        store.add(
          a,
          profile.id,
          created.id,
          "https://directory.example.com.attacker.test/business",
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  },
);
