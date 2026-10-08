/** Pick the place a rank check is run from: type a city, ZIP code, county or state (GET /api/seo/locations). Free to use. */
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, X } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";

export type Place = { code: number; label: string; kind: string };

export function LocationPicker({ value, onChange, placeholder = "City, ZIP code or state", defaultLabel = "the site's default (United States)" }: {
  value: Place | null; onChange: (p: Place | null) => void; placeholder?: string;
  /** What is used when nothing is picked. */
  defaultLabel?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  // Wait for a pause in typing before searching.
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const search = useQuery<{ items: Place[] }>({ queryKey: [`/api/seo/locations?q=${encodeURIComponent(q)}`], enabled: q.length >= 2 && !value, staleTime: 10 * 60_000 });
  const items = search.data?.items ?? [];
  useEffect(() => { setActive(0); }, [q, items.length]);
  if (value) {
    return (
      <span className="g-chip" data-testid="chip-location"><MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />{value.label} <span className="g-text-2 text-[12px]">· {value.kind}</span>
        <button type="button" className="ml-1 align-middle" aria-label={`Remove ${value.label}`} onClick={() => { onChange(null); setText(""); }}><X className="h-3 w-3" /></button>
      </span>
    );
  }
  const open = text.trim().length >= 2;
  const pick = (p: Place) => { onChange(p); setText(""); setQ(""); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Escape") { e.preventDefault(); setText(""); setQ(""); }
    else if (e.key === "Enter") {
      // Typed text that is not a chosen place must never be submitted as "no place": pick the highlighted one or stay put.
      e.preventDefault();
      if (items[active]) pick(items[active]);
    }
  };
  return (
    <div className="relative" data-testid="location-picker">
      <label htmlFor={id} className="sr-only">Where to check from</label>
      <input id={id} className="g-input w-full" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && items[active] ? `${id}-opt-${items[active].code}` : undefined} data-testid="input-location" />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Places" className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border py-1 text-[13px] shadow" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
          {(search.isLoading || q !== text.trim()) && <li className="g-text-2 flex items-center gap-2 px-3 py-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</li>}
          {search.isError && <li className="g-text-2 px-3 py-2" role="alert">Couldn't search places: {apiErrorMessage(search.error)}</li>}
          {search.isSuccess && q === text.trim() && items.length === 0 && <li className="g-text-2 px-3 py-2">No place starts with "{q}". Try the city name or a ZIP code.</li>}
          {items.map((p, i) => (
            <li key={p.code} id={`${id}-opt-${p.code}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className="g-text flex cursor-pointer items-baseline gap-2 px-3 py-1.5" style={i === active ? { background: "var(--g-hover)" } : undefined} data-testid={`option-location-${p.code}`}>
              {p.label} <span className="g-text-2 ml-auto text-[12px]">{p.kind}</span>
            </li>
          ))}
        </ul>
      )}
      {!open && <p className="g-text-2 mt-1 text-[12px]">Leave empty to use {defaultLabel}. Arrow keys and Enter choose a place.</p>}
    </div>
  );
}
