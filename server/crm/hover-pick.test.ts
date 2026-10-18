/** Face selection in the 3D viewer — pure rules in shared/hover-pick.ts. */
import { describe, it, expect } from "vitest";
import { EMPTY_PICK, pickFace, setSeveral, pickedArea, type PickState } from "@shared/hover-pick";

type F = { id: string; areaSqft: number | null };
const a: F = { id: "a", areaSqft: 100 };
const b: F = { id: "b", areaSqft: 50.5 };
const c: F = { id: "c", areaSqft: null };
const ids = (s: PickState<F>) => s.picked.map((f) => f.id);

describe("single mode", () => {
  it("a tap picks one face, the next tap replaces it, the sky clears", () => {
    const s1 = pickFace<F>(EMPTY_PICK, a);
    expect(s1).toEqual({ several: false, picked: [a] });
    const s2 = pickFace(s1, b);
    expect(ids(s2)).toEqual(["b"]);
    expect(pickFace(s2, null)).toEqual({ several: false, picked: [] });
  });
});

describe("shift / ctrl / cmd click", () => {
  it("adds to the face already chosen and switches to several", () => {
    const s = pickFace(pickFace<F>(EMPTY_PICK, a), b, true);
    expect(s.several).toBe(true);
    expect(ids(s)).toEqual(["a", "b"]);
  });
  it("on an already-picked face removes it", () => {
    const s = pickFace(pickFace(pickFace<F>(EMPTY_PICK, a), b, true), a, true);
    expect(ids(s)).toEqual(["b"]);
  });
  it("with nothing chosen starts the set with that face", () => {
    expect(pickFace<F>(EMPTY_PICK, c, true)).toEqual({ several: true, picked: [c] });
  });
});

describe("several mode", () => {
  const several = setSeveral(pickFace<F>(EMPTY_PICK, a), true);
  it("turning it on keeps the current face as the first pick", () => {
    expect(several).toEqual({ several: true, picked: [a] });
  });
  it("plain taps toggle faces; the sky keeps the picks (an orbit ending on empty space is not a clear)", () => {
    const s = pickFace(pickFace(several, b), c);
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(pickFace(s, null)).toBe(s);
    expect(ids(pickFace(s, b))).toEqual(["a", "c"]);
  });
  it("turning it off keeps the first pick as the single selection", () => {
    const s = pickFace(pickFace(several, b), c);
    expect(setSeveral(s, false)).toEqual({ several: false, picked: [a] });
    expect(setSeveral(setSeveral(EMPTY_PICK, true), false)).toEqual({ several: false, picked: [] });
  });
  it("set calls are no-ops when already in that mode", () => {
    expect(setSeveral(several, true)).toBe(several);
    const single = pickFace<F>(EMPTY_PICK, a);
    expect(setSeveral(single, false)).toBe(single);
  });
});

it("adds up the areas it knows", () => {
  expect(pickedArea([a, b, c])).toBe(150.5);
  expect(pickedArea([])).toBe(0);
});
