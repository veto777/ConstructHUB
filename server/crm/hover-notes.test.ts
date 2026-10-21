/**
 * HOVER job notes → the client's Notes (server/crm/hover-notes.ts). Pure parsing/scheduling tests, then the
 * import against the lane Postgres with a stand-in HOVER notes API (no live calls); fresh org, removed afterwards.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import {
  parseHoverNotes, hoverNoteAuthor, hoverNotesDue, fetchHoverJobNotes, importHoverJobNotes, syncHoverNotes,
  HOVER_NOTES_RECHECK_MS,
} from "./hover-notes";

/** The owner's example: hover.to/wr/jobs/24359764, note by "AS", October 17, 2026. */
const OWNER_NOTE = "Left side of house vs the entire house same detail bellys and shake at all gables";
const hoverNote = (id: number, jobId: number, body: string, updated = "2026-10-17T18:04:11.000Z", user: any = { email: "as@alpine.example", first_name: "Alex", last_name: "Stone" }) => ({
  id, job_id: jobId, org_id: 17, user_id: 26, body,
  created_at: "2026-10-17T18:04:11.000Z", updated_at: updated, user,
});

describe("parseHoverNotes", () => {
  it("reads HOVER's List Notes shape: id, body, writer, created date", () => {
    const [n] = parseHoverNotes({ results: [hoverNote(12, 24359764, OWNER_NOTE)] }, "24359764");
    expect(n).toMatchObject({ id: "12", jobId: "24359764", body: OWNER_NOTE, author: "Alex Stone" });
    expect(n.createdAt?.toISOString()).toBe("2026-10-17T18:04:11.000Z");
    expect(n.version).toBe("2026-10-17T18:04:11.000Z");
  });

  it("skips empty notes, notes without an id, and another job's notes", () => {
    const notes = parseHoverNotes({ results: [
      hoverNote(1, 5, "   "), { body: "no id" }, hoverNote(2, 6, "other job"), hoverNote(3, 5, " kept "),
    ] }, "5");
    expect(notes.map((n) => [n.id, n.body])).toEqual([["3", "kept"]]);
  });

  it("accepts a bare array and versions a note without updated_at by its text", () => {
    const [a] = parseHoverNotes([{ id: 9, body: "x" }], "1");
    const [b] = parseHoverNotes([{ id: 9, body: "y" }], "1");
    expect(a.version).not.toBe(b.version);
    expect(a.createdAt).toBeNull();
  });
});

describe("hoverNoteAuthor", () => {
  it("names the writer, else their e-mail, else nothing", () => {
    expect(hoverNoteAuthor({ first_name: "Alex", last_name: "Stone" })).toBe("Alex Stone");
    expect(hoverNoteAuthor({ first_name: "", last_name: "", email: "as@x.example" })).toBe("as@x.example");
    expect(hoverNoteAuthor(null)).toBeNull();
  });
});

describe("hoverNotesDue", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const old = "2026-01-01T00:00:00Z";
  it("is due when never read, when the job moved, while recent, and daily", () => {
    expect(hoverNotesDue({}, old, now)).toBe(true);
    expect(hoverNotesDue({ notesSyncedAt: "2026-10-21T11:00:00Z", notesJobUpdatedAt: old }, "2026-02-01T00:00:00Z", now)).toBe(true);
    expect(hoverNotesDue({ notesSyncedAt: "2026-10-21T11:00:00Z", notesJobUpdatedAt: "2026-10-17T00:00:00Z" }, "2026-10-17T00:00:00Z", now)).toBe(true);
    expect(hoverNotesDue({ notesSyncedAt: "2026-10-21T11:00:00Z", notesJobUpdatedAt: old }, old, now)).toBe(false);
    expect(hoverNotesDue({ notesSyncedAt: new Date(now - HOVER_NOTES_RECHECK_MS).toISOString(), notesJobUpdatedAt: old }, old, now)).toBe(true);
    expect(hoverNotesDue({ notesSyncedAt: "2026-10-21T11:00:00Z" }, null, now)).toBe(false);
  });
});

describe("fetchHoverJobNotes", () => {
  it("asks GET /v2/notes.json?job_id=… and follows HOVER's pages", async () => {
    const asked: string[] = [];
    const r = await fetchHoverJobNotes(async (p) => {
      asked.push(p);
      const page = Number(new URLSearchParams(p.split("?")[1]).get("page") ?? 1);
      return { status: 200, json: { results: [hoverNote(page, 7, `n${page}`)], pagination: { total_pages: 2 } } };
    }, "7");
    expect(asked).toEqual(["/v2/notes.json?job_id=7", "/v2/notes.json?job_id=7&page=2"]);
    expect(r.ok && r.notes.map((n) => n.body)).toEqual(["n1", "n2"]);
  });

  it("reports the status when HOVER refuses", async () => {
    expect(await fetchHoverJobNotes(async () => ({ status: 403, json: null }), "7")).toEqual({ ok: false, status: 403 });
  });
});

// ── Against the lane database ───────────────────────────────────────────────

let orgId = "", otherOrgId = "", userId = 0;
const C: Record<string, string> = {};

async function customer(org: string, name: string) {
  const id = randomUUID();
  await pool.query(`INSERT INTO crm_customers(id,org_id,display_name,portal_token) VALUES($1,$2,$3,gen_random_uuid())`, [id, org, name]);
  return id;
}
async function capture(org: string, customerId: string | null, jobId: string) {
  const id = randomUUID();
  await pool.query(`INSERT INTO crm_measurements(id,org_id,customer_id,provider,status,external_id,raw_payload)
    VALUES($1,$2,$3,'hover','ready',$4,'{}'::jsonb)`, [id, org, customerId, `hover:${jobId}`]);
  return id;
}
const notesOf = (customerId: string) => pool.query(
  "SELECT id, body, author_member_id, source, source_author, created_at::text AS created_at FROM crm_customer_notes WHERE customer_id=$1 ORDER BY created_at",
  [customerId]).then((r) => r.rows);

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(target.pathname) || !["localhost", "127.0.0.1"].includes(target.hostname)) throw Error("Local development DB required");
  await (await import("./schema-ensure")).ensureCrmSchema();
  userId = (await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`hover-notes-${randomUUID()}@example.invalid`])).rows[0].id;
  orgId = randomUUID();
  otherOrgId = randomUUID();
  await pool.query("INSERT INTO crm_orgs(id,name,owner_user_id) VALUES($1,'hover notes',$3),($2,'other org',$3)", [orgId, otherOrgId, userId]);
  C.forrest = await customer(orgId, "Forrest Hild");
  C.second = await customer(orgId, "Second Client");
  C.other = await customer(otherOrgId, "Other Org Client");
  await capture(orgId, C.forrest, "24359764");
  await capture(orgId, null, "555");            // not linked to a client: nothing to land on
  await capture(otherOrgId, C.other, "777");     // another org's job: never touched by this org's pass
}, 60_000);

afterAll(async () => {
  for (const o of [orgId, otherOrgId]) {
    for (const t of ["crm_hover_note_links", "crm_customer_notes", "crm_measurements", "crm_customers"]) await pool.query(`DELETE FROM ${t} WHERE org_id=$1`, [o]);
    await pool.query("DELETE FROM crm_orgs WHERE id=$1", [o]);
  }
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});

describe("HOVER notes land in the client's Notes", () => {
  let hoverNotes: Record<string, any[]> = {};
  const asked: string[] = [];
  const api = async (p: string) => {
    asked.push(p);
    const jobId = new URLSearchParams(p.split("?")[1]).get("job_id")!;
    return { status: 200, json: { results: hoverNotes[jobId] ?? [] } };
  };
  const run = () => syncHoverNotes(orgId, [{ id: 24359764, updated_at: "2026-10-17T18:05:00.000Z" }], api, { paceMs: 0 });

  it("imports the job's note onto its linked client with HOVER's writer, date and source", async () => {
    hoverNotes = { "24359764": [hoverNote(9001, 24359764, OWNER_NOTE)] };
    const r = await run();
    expect(r).toMatchObject({ checked: 1, inserted: 1, updated: 0, error: null });
    expect(asked).toEqual(["/v2/notes.json?job_id=24359764"]); // the unlinked job 555 and the other org's 777 are never read
    const rows = await notesOf(C.forrest);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: OWNER_NOTE, author_member_id: null, source: "hover", source_author: "Alex Stone" });
    expect(rows[0].created_at).toBe("2026-10-17 18:04:11"); // HOVER's date, UTC wall time like every timestamp here
    expect(await notesOf(C.other)).toHaveLength(0);
  });

  it("never duplicates on a re-sync", async () => {
    await importHoverJobNotes(orgId, C.forrest, "24359764", parseHoverNotes({ results: hoverNotes["24359764"] }, "24359764"));
    await run();
    expect(await notesOf(C.forrest)).toHaveLength(1);
  });

  it("updates the note when it was edited in HOVER, and adds new ones", async () => {
    hoverNotes = { "24359764": [
      hoverNote(9001, 24359764, `${OWNER_NOTE} (and the garage)`, "2026-10-18T09:00:00.000Z"),
      hoverNote(9002, 24359764, "Second note"),
    ] };
    const r = await importHoverJobNotes(orgId, C.forrest, "24359764", parseHoverNotes({ results: hoverNotes["24359764"] }, "24359764"));
    expect(r).toEqual({ inserted: 1, updated: 1 });
    expect((await notesOf(C.forrest)).map((n) => n.body).sort()).toEqual([`${OWNER_NOTE} (and the garage)`, "Second note"]);
  });

  it("keeps an edit made here while HOVER's note is unchanged", async () => {
    const [n] = (await notesOf(C.forrest)).filter((x) => x.body === "Second note");
    await pool.query("UPDATE crm_customer_notes SET body='Second note — called them' WHERE id=$1", [n.id]);
    await importHoverJobNotes(orgId, C.forrest, "24359764", parseHoverNotes({ results: hoverNotes["24359764"] }, "24359764"));
    expect((await notesOf(C.forrest)).some((x) => x.body === "Second note — called them")).toBe(true);
  });

  it("leaves the note alone when it was deleted in HOVER, and does not bring back one deleted here", async () => {
    const [second] = (await notesOf(C.forrest)).filter((x) => x.body.startsWith("Second note"));
    await pool.query("DELETE FROM crm_customer_notes WHERE id=$1", [second.id]);
    hoverNotes = { "24359764": [hoverNote(9002, 24359764, "Second note")] }; // 9001 deleted at HOVER
    await importHoverJobNotes(orgId, C.forrest, "24359764", parseHoverNotes({ results: hoverNotes["24359764"] }, "24359764"));
    const rows = await notesOf(C.forrest);
    expect(rows.map((n) => n.body)).toEqual([`${OWNER_NOTE} (and the garage)`]);
  });

  it("moves the notes with the job when the job is re-filed onto another client", async () => {
    hoverNotes = { "24359764": [hoverNote(9001, 24359764, `${OWNER_NOTE} (and the garage)`, "2026-10-18T09:00:00.000Z")] };
    await importHoverJobNotes(orgId, C.second, "24359764", parseHoverNotes({ results: hoverNotes["24359764"] }, "24359764"));
    expect(await notesOf(C.forrest)).toHaveLength(0);
    expect((await notesOf(C.second)).map((n) => n.body)).toEqual([`${OWNER_NOTE} (and the garage)`]);
  });

  it("stamps the read so an untouched old job is not re-read every sync", async () => {
    const listed = [{ id: 24359764, updated_at: "2026-01-02T00:00:00.000Z" }];
    await syncHoverNotes(orgId, listed, api, { paceMs: 0 });
    const n = asked.length;
    const r = await syncHoverNotes(orgId, listed, api, { paceMs: 0 });
    expect(r.due).toBe(0);
    expect(asked.length).toBe(n);
  });

  it("stops on a rate limit and leaves the rest due", async () => {
    await pool.query("UPDATE crm_measurements SET raw_payload='{}'::jsonb WHERE org_id=$1", [orgId]);
    const r = await syncHoverNotes(orgId, [], async () => ({ status: 429, json: null }), { paceMs: 0 });
    expect(r).toMatchObject({ checked: 0, deferred: 1 });
    expect(r.error).toMatch(/rate limit/);
  });
});
