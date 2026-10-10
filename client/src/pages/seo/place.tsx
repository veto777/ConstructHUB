/**
 * The US place a lookup is narrowed to — a state, county, city, ZIP code or metro area — across the SEO Suite (owner,
 * 2026-10-10: "all the searches should be per city or state as well as per county searches. For all features in SEO").
 * One choice, remembered on this device, cleared when the country is not the United States. Pages put its code in the
 * address (`place`), so a link and a pick are one thing; a code arriving by link is looked up for its name (free).
 */
import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { LocationPicker, type Place } from "./location-picker";

export type SeoPlace = Place;
const KEY = "seo.place";
const listeners = new Set<() => void>();
function stored(): SeoPlace | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && Number.isInteger(p.code) && p.code > 0 && typeof p.label === "string" ? { code: p.code, label: p.label, kind: String(p.kind ?? "") } : null;
  } catch { return null; }
}
let current: SeoPlace | null = stored();
function choose(p: SeoPlace | null) {
  current = p;
  try { if (p) window.localStorage.setItem(KEY, JSON.stringify(p)); else window.localStorage.removeItem(KEY); } catch { /* private window: the choice lasts for this visit */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/**
 * The place chosen (null = the whole country), and how to choose one. `fromAddress` is the code in the address, which
 * wins: a code the store does not know is looked up and becomes the choice. Only the United States has places.
 */
export function usePlace(market: { locationCode: number }, fromAddress?: number): [SeoPlace | null, (p: SeoPlace | null) => void] {
  const place = useSyncExternalStore(subscribe, () => current);
  const us = market.locationCode === 2840;
  const wanted = us && fromAddress && fromAddress !== 2840 && fromAddress !== place?.code ? fromAddress : null;
  const lookup = useQuery<{ place: SeoPlace | null }>({ queryKey: [`/api/seo/locations/${wanted}`], enabled: !!wanted, staleTime: 24 * 3600_000 });
  useEffect(() => { if (wanted && lookup.data?.place) choose(lookup.data.place); }, [wanted, lookup.data]);
  useEffect(() => { if (!us && current) choose(null); }, [us]);
  return [us ? place : null, choose];
}

/** The address words for a place (none for the whole country). */
export const placeParams = (place: SeoPlace | null | undefined) => (place ? { place: place.code } : {});
/** The request-body field for a place. */
export const placeBody = (place: SeoPlace | null | undefined) => (place ? { placeCode: place.code } : {});

/** "Bellingham, Washington" / "the United States": where the numbers are for, in a sentence. */
export const placeWords = (place: SeoPlace | null | undefined, country = "the United States") => (place ? place.label : country);

/** The picker as the pages show it: a chip with the place, or a box to type one (only for the United States). */
export function PlacePicker({ value, onChange, market, disabled, className = "" }: { value: SeoPlace | null; onChange: (p: SeoPlace | null) => void; market: { locationCode: number }; disabled?: boolean; className?: string }) {
  if (market.locationCode !== 2840) return null;
  return (
    <div className={`min-w-0 sm:w-[300px] ${className}`} data-testid="place-picker" aria-disabled={disabled || undefined}>
      <LocationPicker value={value} onChange={onChange} placeholder="City, county, ZIP or state (optional)" defaultLabel="the whole United States" />
    </div>
  );
}
