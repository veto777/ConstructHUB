import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ current: {} as any }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...await importOriginal<typeof import("@tanstack/react-query")>(), useQuery: () => query.current, useQueryClient: () => null }));
import { ModuleLessons, LessonBlocks } from "@/components/master-class/lesson-body";
import { LessonOutline } from "@/components/master-class/lesson";

const lessons = [{ id: "retained", title: "Previously loaded lesson" }];
const data = { module: "seo", lessons: [{ ...lessons[0], blocks: [{ type: "p", text: "Readable cached body" }] }], footer: [] };
const render = () => renderToStaticMarkup(createElement(ModuleLessons, {
  module: "seo", lessons, storageKey: "recovery-test", open: true,
  renderLesson: (meta, body) => createElement("article", { key: meta.id }, body && createElement(LessonBlocks, { blocks: body.blocks })),
}));

describe("lesson refresh recovery", () => {
  it("keeps cached bodies on transient failure and provides a retry", () => {
    query.current = { data, isError: true, error: new Error("503: unavailable"), refetch: vi.fn() };
    const html = render();
    expect(html).toContain("Readable cached body");
    expect(html).toContain("lessons-stale");
    expect(html).toContain("button-lessons-retry");
  });
  it.each(["401: signed out", "403: access revoked"])("hides protected bodies after %s", (message) => {
    query.current = { data, isError: true, error: new Error(message), refetch: vi.fn() };
    const html = render();
    expect(html).not.toContain("Readable cached body");
    expect(html).toContain("lessons-error");
  });
  it("offers retry without an empty lesson list after initial failure", () => {
    query.current = { isError: true, error: new Error("Network error"), refetch: vi.fn() };
    expect(render()).toContain("lessons-error");
    expect(render()).not.toContain("lessons-stale");
  });
  it("hides bodies when the parent revokes access", () => {
    query.current = { data, isSuccess: true };
    expect(renderToStaticMarkup(createElement(ModuleLessons, { module: "seo", lessons, storageKey: "test", open: false }))).toBe("");
  });
  it("stacks stats on phones and uses readable labels", () => {
    const html = renderToStaticMarkup(createElement(LessonBlocks, { blocks: [{ type: "stats", items: ["one", "two", "three"].map((value) => ({ value, label: value })) }] }));
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-3");
    expect(html).not.toContain("text-[10px]");
  });
  it("offers account recovery next to the paused note without zero progress", () => {
    query.current = { isError: true, isSuccess: false, isFetching: false, refetch: vi.fn() };
    const html = renderToStaticMarkup(createElement(LessonOutline, { lessons, storageKey: "test" }));
    expect(html).toContain("Account unavailable");
    expect(html).toContain("Check account");
    expect(html).not.toContain("0 of 1");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("focus-visible:ring-2");
  });
});

it.each([{ bodies: [] }, { bodies: [{ id: "retained", title: "Empty", blocks: [] }] }])("never completes absent or empty content, even with a custom renderer", ({ bodies }) => {
  query.current = { isSuccess: true, data: { ...data, lessons: bodies }, refetch: vi.fn() };
  const html = render();
  expect(html).toContain("text-lesson-missing");
  expect(html).toContain("Reload lesson");
  expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="checkbox-retained-done"/);
});
