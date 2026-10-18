/**
 * Face selection in the 3D viewer (client/src/components/hover-3d-dialog.tsx) — pure, so it is unit-tested.
 *
 * One mode, two behaviours:
 *   • single: a tap picks that face (and only it); a tap on the sky clears.
 *   • several: taps add and remove faces; the sky does nothing, so an orbit that ends on empty space keeps the picks.
 * A tap with Shift, Ctrl or ⌘ held adds (or removes a face already picked) and switches to "several" — the first wall the
 * user clicked stays in the set. Turning "several" on by the button keeps the current face as the first pick;
 * turning it off keeps the first pick as the single selection, so nothing the user chose is thrown away.
 */
export interface PickState<F extends { id: string }> {
  several: boolean;
  picked: F[];
}

export const EMPTY_PICK: PickState<never> = { several: false, picked: [] };

export function pickFace<F extends { id: string }>(s: PickState<F>, face: F | null, add = false): PickState<F> {
  if (!face) return s.several ? s : { several: false, picked: [] };
  if (!s.several && !add) return { several: false, picked: [face] };
  const has = s.picked.some((f) => f.id === face.id);
  return { several: true, picked: has ? s.picked.filter((f) => f.id !== face.id) : [...s.picked, face] };
}

export function setSeveral<F extends { id: string }>(s: PickState<F>, on: boolean): PickState<F> {
  if (on) return s.several ? s : { several: true, picked: s.picked };
  return s.several ? { several: false, picked: s.picked.slice(0, 1) } : s;
}

export const pickedArea = (picked: { areaSqft: number | null }[]) => picked.reduce((a, f) => a + (f.areaSqft ?? 0), 0);
