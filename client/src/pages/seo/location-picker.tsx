/** Pick the place a rank check is run from: type a city, ZIP code, county or state (GET /api/seo/locations). Free to use. */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, X } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";

export type Place = { code: number; label: string; kind: string };

export function LocationPicker({ value, onChange, onTyped, error = null, placeholder = "City, ZIP code or state", defaultLabel = "the site's default (United States)" }: {
  value: Place | null; onChange: (p: Place | null) => void;
  /**
   * Text in the box that is not a chosen place, each time it changes ("" once a place is picked or the box is cleared).
   * The form must not go out while this is non-empty: that text would quietly become "no place" (shared/seo-place.ts).
   */
  onTyped?: (text: string) => void;
  /** The form's message about that text: shown under the box, linked to it and announced. */
  error?: string | null;
  placeholder?: string;
  /** What is used when nothing is picked. */
  defaultLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Wait for a pause in typing before searching.
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  // A message about the text puts the cursor back in the box, so the fix is one keystroke away.
  useEffect(() => { if (error) input.current?.focus(); }, [error]);
  const search = useQuery<{ items: Place[] }>({ queryKey: [`/api/seo/locations?q=${encodeURIComponent(q)}`], enabled: q.length >= 2 && !value, staleTime: 10 * 60_000 });
  const items = search.data?.items ?? [];
  useEffect(() => { setActive(0); }, [q, items.length]);
  const type = (v: string) => { setText(v); onTyped?.(v.trim()); };
  const clear = () => { setText(""); setQ(""); onTyped?.(""); };
  if (value) {
    return (
      <span className="g-chip" data-testid="chip-location"><MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />{value.label} <span className="g-text-2 text-[12px]">· {value.kind}</span>
        {/* A 44 × 44 tap area that does not make the chip taller (the negative margins give the extra height back). */}
        <button type="button" className="-my-3 -mr-2 ml-0.5 inline-grid min-h-11 min-w-11 place-items-center rounded-full align-middle hover:bg-[var(--g-hover)]" aria-label={`Remove ${value.label}`} onClick={() => { onChange(null); clear(); }} data-testid="button-remove-location"><X className="h-3.5 w-3.5" /></button>
      </span>
    );
  }
  const open = text.trim().length >= 2;
  const pick = (p: Place) => { onChange(p); clear(); };
  /** The list on screen answers the text in the box (not an earlier keystroke still on its way). */
  const current = q === text.trim() && search.isSuccess;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Text in the box that is not a chosen place must never go out with the form as "no place".
    if (e.key === "Enter" && text.trim()) { e.preventDefault(); if (open && current && items[active]) pick(items[active]); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Escape") { e.preventDefault(); clear(); }
  };
  return (
    <div className="relative" data-testid="location-picker">
      <label htmlFor={id} className="sr-only">Where to check from</label>
      <input id={id} ref={input} className="g-input w-full" value={text} onChange={(e) => type(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && items[active] ? `${id}-opt-${items[active].code}` : undefined}
        aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} data-testid="input-location" />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Places" className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border py-1 text-[13px] shadow" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
          {(search.isLoading || q !== text.trim()) && <li className="g-text-2 flex items-center gap-2 px-3 py-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</li>}
          {search.isError && <li className="g-text-2 px-3 py-2" role="alert">Couldn't search places: {apiErrorMessage(search.error)}</li>}
          {search.isSuccess && q === text.trim() && items.length === 0 && <li className="g-text-2 px-3 py-2">No place starts with "{q}". Try the city name or a ZIP code.</li>}
          {items.map((p, i) => (
            <li key={p.code} id={`${id}-opt-${p.code}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className="g-text flex cursor-pointer items-baseline gap-2 px-3 py-1.5 max-sm:min-h-11 max-sm:items-center" style={i === active ? { background: "var(--g-hover)" } : undefined} data-testid={`option-location-${p.code}`}>
              {p.label} <span className="g-text-2 ml-auto text-[12px]">{p.kind}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-[12px]" style={{ color: "var(--g-red, #c5221f)" }} data-testid="text-location-error">{error}</p>}
      {!open && <p className="g-text-2 mt-1 text-[12px]">Leave empty to use {defaultLabel}. Arrow keys and Enter choose a place.</p>}
    </div>
  );
}
