import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSchema } from "../../shared/social";

let storage: Map<string, string>;
let sessionStorage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
const empty = { text: "", tweaks: {}, destinations: [], mediaText: "", schedule: "" };
const payload = () => postSchema.parse({
  requestId: crypto.randomUUID(), text: "Recovery fixture", draft: true,
  destinations: [{ accountId: "fixture-x", platform: "twitter" }, { accountId: "fixture-threads", platform: "threads" }],
  tweaks: { threads: "Threads fixture" }, mediaUrls: ["https://example.com/fixture.jpg"],
  scheduledTime: "2030-10-05T10:00:00.000Z",
});

beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  sessionStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn((key: string) => { storage.delete(key); }),
  };
  vi.stubGlobal("window", { sessionStorage });
});
afterEach(() => vi.unstubAllGlobals());

describe("composer submission recovery", () => {
  it("restores the exact id and payload after module memory is lost", async () => {
    const store = await import("../../client/src/components/social-drafts");
    const submission = payload();
    const draft = { ...empty, text: submission.text, destinations: submission.destinations, submission };
    store.saveComposerDraft(101, "1", draft);
    vi.resetModules();
    const restored = await import("../../client/src/components/social-drafts");
    expect(restored.loadComposerDraft(101, "1")).toEqual(draft);
    expect(restored.loadComposerDraft(101, "1")?.submission).toEqual(submission);
  });

  it("isolates account and business drafts, including late authentication", async () => {
    const store = await import("../../client/src/components/social-drafts");
    for (const [account, business, text] of [[101, "1", "A"], [102, "1", "B"], [101, "2", "C"]] as const) {
      store.saveComposerDraft(account, business, { ...empty, text, submission: payload() });
    }
    expect(store.loadComposerDraft(101, "1")?.text).toBe("A");
    expect(store.loadComposerDraft(102, "1")?.text).toBe("B");
    expect(store.loadComposerDraft(101, "2")?.text).toBe("C");
    expect(store.loadComposerDraft(103, "1")).toBeNull();
    store.saveComposerDraft(null, "1", { ...empty, text: "Anonymous" });
    expect(store.loadComposerDraft(null, "1")).toBeNull();
  });

  it("does not resurrect cleared submissions or row edits when storage removal fails", async () => {
    const store = await import("../../client/src/components/social-drafts");
    store.saveComposerDraft(101, "1", { ...empty, text: "Accepted", submission: payload() });
    store.saveRowEdits(101, { post: "Old edit" });
    sessionStorage.removeItem.mockImplementation(() => { throw new Error("Blocked"); });
    store.saveComposerDraft(101, "1", empty);
    store.saveRowEdits(101, {});
    expect(storage.size).toBe(2); // Stale storage still exists, but must lose to the tombstones.
    expect(store.loadComposerDraft(101, "1")).toBeNull();
    expect(store.loadRowEdits(101)).toEqual({});
  });

  it("keeps the latest request in memory when storage writes and reads fail", async () => {
    const store = await import("../../client/src/components/social-drafts");
    sessionStorage.setItem.mockImplementation(() => { throw new Error("Quota"); });
    sessionStorage.getItem.mockImplementation(() => { throw new Error("Blocked"); });
    const submission = payload();
    store.saveComposerDraft(101, "1", { ...empty, submission });
    expect(store.loadComposerDraft(101, "1")?.submission).toEqual(submission);
    store.saveComposerDraft(101, "1", empty);
    expect(store.loadComposerDraft(101, "1")).toBeNull();
  });

  it("loads legacy drafts without inventing an already submitted request", async () => {
    const store = await import("../../client/src/components/social-drafts");
    store.saveComposerDraft(101, "1", { ...empty, text: "Legacy composition" });
    expect(store.loadComposerDraft(101, "1")?.submission).toBeUndefined();
  });
});
