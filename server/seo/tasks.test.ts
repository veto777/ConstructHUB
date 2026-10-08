import { describe, expect, it } from "vitest";
import { markResolved, taskInput, taskPatch, tasksInput, toTask, type Task } from "./tasks";

const row = (extra: Record<string, unknown> = {}) => ({ id: 1, kind: "keyword", title: "Move \"roof repair\" up from position 7", target: "https://alpine.example/roofing", detail: { position: 7, volume: 880 }, source: "kw:roof repair", status: "todo", note: null, created_at: "2026-10-08T09:00:00Z", done_at: null, ...extra });

describe("action plan", () => {
  it("takes a finding with a few plain facts, and nothing else", () => {
    expect(taskInput.parse({ kind: "keyword", title: "  Move it up ", target: "https://a.example/x", facts: { position: 7, volume: 880, page: "/x" }, source: "kw:roof repair" }))
      .toEqual({ kind: "keyword", title: "Move it up", target: "https://a.example/x", facts: { position: 7, volume: 880, page: "/x" }, source: "kw:roof repair" });
    expect(taskInput.parse({ kind: "other", title: "Call the chamber" })).toMatchObject({ target: null, facts: {}, source: null });
    expect(taskInput.safeParse({ kind: "spam", title: "x" }).success).toBe(false);
    expect(taskInput.safeParse({ kind: "other", title: "" }).success).toBe(false);
    expect(taskInput.safeParse({ kind: "other", title: "x", facts: { nested: { a: 1 } } }).success).toBe(false);
    expect(taskInput.safeParse({ kind: "other", title: "x", facts: { "bad key!": 1 } }).success).toBe(false);
    expect(taskInput.safeParse({ kind: "other", title: "x", extra: 1 }).success).toBe(false);
    expect(tasksInput.safeParse({ tasks: [] }).success).toBe(false);
    expect(tasksInput.safeParse({ tasks: Array.from({ length: 51 }, () => ({ kind: "other", title: "x" })) }).success).toBe(false);
  });
  it("a change must change something, and only to a known status", () => {
    expect(taskPatch.safeParse({}).success).toBe(false);
    expect(taskPatch.safeParse({ status: "finished" }).success).toBe(false);
    expect(taskPatch.parse({ status: "done" })).toEqual({ status: "done" });
    expect(taskPatch.parse({ note: "  emailed Sam  " })).toEqual({ note: "emailed Sam" });
    expect(taskPatch.parse({ note: null })).toEqual({ note: null });
  });
  it("links only to a real web address or a plain domain", () => {
    expect(toTask(row()).url).toBe("https://alpine.example/roofing");
    expect(toTask(row({ target: "Chamber.Example" })).url).toBe("https://chamber.example");
    expect(toTask(row({ target: "roof repair bellingham" })).url).toBeNull();
    expect(toTask(row({ target: "javascript:alert(1)" })).url).toBeNull();
    expect(toTask(row({ target: null })).url).toBeNull();
    // A row with something unexpected in it is still a task, not a crash.
    expect(toTask(row({ kind: "weird", status: "weird", detail: [1, 2] }))).toMatchObject({ kind: "other", status: "todo", facts: {} });
  });
  it("claims an audit issue is no longer found only when a newer, comparable crawl really re-checked it", () => {
    const added = "2026-10-08T09:00:00Z";
    const task = (id: number, key: string, extra: Record<string, unknown> = {}) => toTask(row({ id, kind: "audit", source: `audit:${key}`, status: "todo", created_at: added, detail: { crawled: 100 }, ...extra }));
    const tasks: Task[] = [task(1, "missing-title"), task(2, "broken-links", { status: "doing" }), task(3, "slow-page", { status: "done" }), toTask(row({ id: 4, kind: "keyword", source: "kw:roof repair" })), task(5, "thin-content"), task(6, "no-crawl-size", { detail: {} })];
    const crawl = (o: Partial<{ scannedAt: string | null; crawled: number; issues: string[]; skipped: string[]; newerFailed: boolean }> = {}) =>
      ({ issueKeys: new Set(o.issues ?? ["broken-links"]), notRechecked: new Set(o.skipped ?? ["thin-content"]), scannedAt: o.scannedAt === undefined ? "2026-10-09T09:00:00Z" : o.scannedAt, crawled: o.crawled ?? 100, newerFailed: o.newerFailed ?? false });
    const say = (out: Task[]) => out.map((t) => [t.id, t.resolved?.on ?? null, t.recheck ?? null]);
    // A newer crawl of the same size: 1 is no longer found; 2 is still there; 3 is done and 4 is not an audit task (nothing said);
    // 5 could not be re-checked; 6 has no recorded crawl size and is judged on the rest.
    expect(say(markResolved(tasks, crawl()))).toEqual([[1, "2026-10-09T09:00:00Z", null], [2, null, null], [3, null, null], [4, null, null], [5, null, "not_rechecked"], [6, "2026-10-09T09:00:00Z", null]]);
    // The only finished crawl is the one the task came from (or an older one): not rechecked.
    expect(say(markResolved(tasks, crawl({ scannedAt: "2026-10-08T08:00:00Z" }))).filter(([id]) => id === 1 || id === 2)).toEqual([[1, null, "none"], [2, null, "none"]]);
    // A newer crawl that covered far fewer pages proves nothing about an issue it does not list.
    expect(say(markResolved(tasks, crawl({ crawled: 40 })))[0]).toEqual([1, null, "smaller"]);
    expect(say(markResolved(tasks, crawl({ crawled: 85 })))[0]).toEqual([1, "2026-10-09T09:00:00Z", null]);
    // The newest crawl failed: said, whether or not an older newer-than-the-task crawl cleared it.
    expect(say(markResolved(tasks, crawl({ scannedAt: "2026-10-08T08:00:00Z", newerFailed: true })))[0]).toEqual([1, null, "failed"]);
    expect(say(markResolved(tasks, crawl({ newerFailed: true })))[0]).toEqual([1, "2026-10-09T09:00:00Z", "failed"]);
    // No crawl to go by at all.
    expect(say(markResolved(tasks, null))[0]).toEqual([1, null, "none"]);
    // Nothing is ever marked done here.
    expect(markResolved(tasks, crawl()).map((t) => t.status)).toEqual(tasks.map((t) => t.status));
  });
});
