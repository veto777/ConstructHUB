import { describe, expect, it, vi } from "vitest";
import { createProgressStore, progressKey } from "@/components/guides/progress-store";
import { stateStepId, type StateGuideStep } from "@/components/master-class/state-guide";

function device() {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
  return storage;
}

describe("education progress", () => {
  it("shares lesson/outline ticks, unticks and reset with blocked reads", () => {
    const store = createProgressStore(() => { throw new Error("SecurityError"); });
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.toggle(1, "mc:gmb", "setup");
    store.toggle(1, "mc:gmb", "reviews");
    expect(store.read(1, "mc:gmb")).toEqual({ ids: ["setup", "reviews"], persistent: false });
    store.toggle(1, "mc:gmb", "setup");
    expect(store.read(1, "mc:gmb").ids).toEqual(["reviews"]);
    store.reset(1, "mc:gmb");
    expect(store.read(1, "mc:gmb").ids).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("retains optimistic state when writes fail but stale reads succeed, then persists on recovery", () => {
    const storage = device();
    const store = createProgressStore(() => storage);
    store.toggle(1, "mc:gmb", "setup");
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    store.toggle(1, "mc:gmb", "reviews");
    store.toggle(1, "mc:gmb", "photos");
    store.storageChanged(null);
    expect(store.read(1, "mc:gmb")).toEqual({ ids: ["setup", "reviews", "photos"], persistent: false });
    store.reset(1, "mc:gmb");
    expect(store.read(1, "mc:gmb").ids).toEqual([]);
    write.mockRestore();
    store.toggle(1, "mc:gmb", "reviews");
    expect(createProgressStore(() => storage).read(1, "mc:gmb")).toEqual({ ids: ["reviews"], persistent: true });
  });

  it("isolates accounts, modules and signed-out state and never adopts unscoped legacy ticks", () => {
    const storage = device();
    storage.setItem("constructhub.checklist.mc:gmb", '["photos"]');
    const store = createProgressStore(() => storage);
    expect(store.read(1, "mc:gmb").ids).toEqual([]);
    store.toggle(1, "mc:gmb", "setup");
    store.toggle(2, "mc:gmb", "reviews");
    store.toggle(null, "mc:gmb", "photos");
    expect(store.read(null, "mc:gmb").ids).toEqual(["photos"]);
    expect(createProgressStore(() => storage).read(null, "mc:gmb").ids).toEqual([]);
    expect(store.read(1, "mc:gmb").ids).toEqual(["setup"]);
    expect(store.read(2, "mc:gmb").ids).toEqual(["reviews"]);
    expect(store.read(1, "mc:seo").ids).toEqual([]);
    expect(progressKey(1, "mc:gmb")).not.toBe(progressKey(2, "mc:gmb"));
    store.reset(2, "mc:gmb");
    expect(createProgressStore(() => storage).read(1, "mc:gmb").ids).toEqual(["setup"]);
  });

  for (const blocked of [false, true]) it(`migrates unchanged IDs only across versions, blocked=${blocked}`, () => {
    const storage = device();
    const store = createProgressStore(() => { if (blocked) throw new Error("blocked"); return storage; });
    store.toggle(1, "course", "keep", true, { version: "v1" });
    store.toggle(1, "course", "removed", true, { version: "v1" });
    const next = { version: "v2", previousVersions: ["v1"], itemIds: ["new", "keep"] };
    expect(store.read(1, "course", next).ids).toEqual(["keep"]);
    expect(store.read(2, "course", next).ids).toEqual([]);
    store.toggle(1, "course", "removed", true, next);
    expect(store.read(1, "course", next).ids).toEqual(["keep"]);
    store.toggle(1, "course", "new", true, next);
    expect(store.read(1, "course", next).ids).toEqual(["keep", "new"]);
    expect(store.read(1, "course", { version: "v3" }).ids).toEqual([]);
  });

  it("loads migrated ticks after reload and does not restore an old version after reset", () => {
    const storage = device();
    storage.setItem(progressKey(1, "course", "v1"), '["keep","removed"]');
    const next = { version: "v2", previousVersions: ["v1"], itemIds: ["keep", "new"] };
    const store = createProgressStore(() => storage);
    expect(store.read(1, "course", next).ids).toEqual(["keep"]);
    store.reset(1, "course", next);
    expect(createProgressStore(() => storage).read(1, "course", next).ids).toEqual([]);
  });

  it("retains a migration in memory if loading succeeds but its first write fails", () => {
    const storage = device();
    storage.setItem(progressKey(1, "course", "v1"), '["keep","removed"]');
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const store = createProgressStore(() => storage);
    expect(store.read(1, "course", { version: "v2", previousVersions: ["v1"], itemIds: ["keep"] })).toEqual({ ids: ["keep"], persistent: false });
  });

  it("handles corrupt records and reflects another tab's persisted changes", () => {
    const storage = device();
    const store = createProgressStore(() => storage);
    storage.setItem(progressKey(1, "course"), "bad json");
    expect(store.read(1, "course").ids).toEqual([]);
    store.toggle(1, "course", "first");
    storage.setItem(progressKey(1, "course"), '["second",4,"second"]');
    store.storageChanged(progressKey(1, "course"));
    expect(store.read(1, "course").ids).toEqual(["second"]);
  });

  it("does not attribute a renumbered state's completion to a different instruction", () => {
    const step: StateGuideStep = { stepNumber: 1, title: "Check requirements", description: "Read the agency guidance", category: "formation", url: null, urlLabel: null, isRequired: null, tips: null };
    expect(stateStepId(step)).toBe(stateStepId({ ...step, stepNumber: 3 }));
    expect(stateStepId(step)).not.toBe(stateStepId({ ...step, description: "Complete the revised agency process" }));
  });
});
