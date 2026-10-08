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
  it("says when the newest crawl no longer finds an audit issue — and leaves the decision to the customer", () => {
    const tasks: Task[] = [
      toTask(row({ id: 1, kind: "audit", source: "audit:missing-title", status: "todo" })),
      toTask(row({ id: 2, kind: "audit", source: "audit:broken-links", status: "doing" })),
      toTask(row({ id: 3, kind: "audit", source: "audit:slow-page", status: "done" })),
      toTask(row({ id: 4, kind: "keyword", source: "kw:roof repair" })),
    ];
    const out = markResolved(tasks, new Set(["broken-links"]), "2026-10-08");
    expect(out.map((t) => [t.id, t.status, t.resolved?.on ?? null])).toEqual([[1, "todo", "2026-10-08"], [2, "doing", null], [3, "done", null], [4, "todo", null]]);
    // No crawl to go by: nothing is claimed.
    expect(markResolved(tasks, null, null).every((t) => t.resolved === undefined)).toBe(true);
  });
});
