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
  it("claims an audit issue is no longer found only on positive evidence from the crawl the task came from", () => {
    const task = (id: number, key: string, extra: Record<string, unknown> = {}) => toTask(row({ id, kind: "audit", source: `audit:${key}`, status: "todo", detail: { crawlId: "crawl-a" }, ...extra }));
    const tasks: Task[] = [task(1, "missing-title"), task(2, "broken-links", { status: "doing" }), task(3, "slow-page", { status: "done" }), toTask(row({ id: 4, kind: "keyword", source: "kw:roof repair" })), task(5, "thin-content"), task(6, "renamed-check"), task(7, "old-task", { detail: {} }), task(8, "from-b", { detail: { crawlId: "crawl-b" } })];
    const verdict = { present: new Set(["broken-links"]), fixed: new Set(["missing-title"]), notRechecked: new Set(["thin-content"]) };
    const ev = (o: Partial<{ latestId: string | null; newerFailed: boolean; crawls: [string, typeof verdict][] }> = {}) => ({ latestId: o.latestId === undefined ? "crawl-c" : o.latestId, scannedAt: "2026-10-09T09:00:00Z", newerFailed: o.newerFailed ?? false, byCrawl: new Map(o.crawls ?? [["crawl-a", verdict]]) });
    const say = (out: Task[]) => out.map((t) => [t.id, t.resolved?.on ?? null, t.recheck ?? null]);
    expect(say(markResolved(tasks, ev()))).toEqual([
      [1, "2026-10-09T09:00:00Z", null], // gone, and every page it was on was crawled again
      [2, null, null],                    // still there
      [3, null, null], [4, null, null],   // done, or not an audit task: nothing said
      [5, null, "not_rechecked"],         // gone from the list, but its pages were not all crawled again
      [6, null, "unverifiable"],          // the crawl it came from does not list an issue of that name
      [7, null, "unverifiable"],          // no crawl on record for the task
      [8, null, "unverifiable"],          // its crawl is not among those the newest could be compared with
    ]);
    // The newest finished crawl IS the one the task came from: nothing has been rechecked.
    expect(say(markResolved(tasks, ev({ latestId: "crawl-a", crawls: [] })))[0]).toEqual([1, null, "none"]);
    // No finished crawl at all, or the newest attempt failed.
    expect(say(markResolved(tasks, ev({ latestId: null, crawls: [] })))[0]).toEqual([1, null, "none"]);
    expect(say(markResolved(tasks, ev({ latestId: "crawl-a", crawls: [], newerFailed: true })))[0]).toEqual([1, null, "failed"]);
    expect(say(markResolved(tasks, ev({ newerFailed: true })))[0]).toEqual([1, "2026-10-09T09:00:00Z", "failed"]);
    expect(say(markResolved(tasks, null))[0]).toEqual([1, null, "none"]);
    // Nothing is ever marked done here.
    expect(markResolved(tasks, ev()).map((t) => t.status)).toEqual(tasks.map((t) => t.status));
  });
});
