import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Search-as-you-type pickers for long CRM lists. A Radix Select renders every
 * option up front and can't search, and the client list it was fed is the
 * API's newest-500 page — an org with 2,500 clients simply couldn't pick its
 * oldest ones. These search the server (clients) or filter a list in place
 * (projects), and show the first matches with a "keep typing" nudge.
 */

export type PickOption = { id: string; label: string; detail?: string | null };

const SHOWN = 25;

function PickerShell({
  value, onChange, q, setQ, results, loading, placeholder, testid, clearLabel, emptyText,
}: {
  value: PickOption | null;
  onChange: (o: PickOption | null) => void;
  q: string;
  setQ: (q: string) => void;
  results: PickOption[];
  loading?: boolean;
  placeholder: string;
  testid: string;
  /** Shown on the "clear" button when a pick is optional ("No project"). */
  clearLabel?: string;
  emptyText: string;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focusNext, setFocusNext] = useState(false);
  useEffect(() => {
    if (focusNext && !value) { inputRef.current?.focus(); setFocusNext(false); }
  }, [focusNext, value]);
  useEffect(() => setActive(0), [q]);

  if (value) {
    // The picked row: tap it to search again; the × (optional picks only)
    // clears it. Icon-only so the name keeps the room in a half-width field.
    return (
      <div className="flex items-center gap-1 rounded-md border pl-3 pr-1 py-1 min-h-9"
        data-testid={`${testid}-picked`}>
        <button type="button" className="min-w-0 flex-1 text-left" title={`${value.label} — click to change`}
          onClick={() => { onChange(null); setFocusNext(true); }} data-testid={`${testid}-change`}>
          <span className="block text-sm font-medium truncate">{value.label}</span>
          {value.detail && <span className="block text-xs text-muted-foreground truncate">{value.detail}</span>}
        </button>
        {clearLabel && (
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0"
            aria-label={clearLabel} title={clearLabel}
            onClick={() => onChange(null)} data-testid={`${testid}-clear`}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  const shown = results.slice(0, SHOWN);
  const open = focused || q.trim().length > 0;
  const pick = (o: PickOption) => { onChange(o); setQ(""); setFocused(false); };

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={q}
          placeholder={placeholder}
          className="pl-8"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter" && shown[active]) { e.preventDefault(); pick(shown[active]); }
          }}
          data-testid={`${testid}-search`}
        />
      </div>
      {open && (
        <div className="max-h-48 overflow-y-auto rounded-md border divide-y" role="listbox"
          data-testid={`${testid}-results`}>
          {shown.map((o, i) => (
            <button key={o.id} type="button" role="option" aria-selected={i === active}
              // mousedown, not click: keep the input focused so the list
              // doesn't collapse under the pointer before the pick lands.
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              data-testid={`${testid}-option-${o.id}`}
              className={cn(
                "flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-accent",
                i === active && "bg-accent",
              )}>
              <span className="block w-full text-sm font-medium truncate">{o.label}</span>
              {o.detail && <span className="block w-full text-xs text-muted-foreground truncate">{o.detail}</span>}
            </button>
          ))}
          {loading && shown.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!loading && shown.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
          )}
          {results.length > SHOWN && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              Showing the first {SHOWN} — keep typing to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ClientRow = { id: string; displayName: string; email?: string | null; phone?: string | null };

export const clientOption = (c: ClientRow): PickOption => ({
  id: c.id,
  label: c.displayName,
  detail: [c.email, c.phone].filter(Boolean).join(" · ") || null,
});

/** Pick a client by searching the whole org server-side (?q=). */
export function ClientSearchPicker({
  value, onChange, placeholder = "Search clients by name, email or phone", testid = "client-picker",
  clearLabel, exclude,
}: {
  value: PickOption | null;
  onChange: (o: PickOption | null) => void;
  placeholder?: string;
  testid?: string;
  clearLabel?: string;
  /** Client ids to leave out of the results (e.g. already on a list). */
  exclude?: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery<ClientRow[]>({
    queryKey: ["/api/crm/customers", debounced ? `?q=${encodeURIComponent(debounced)}` : ""],
    queryFn: async () => {
      const r = await fetch(`/api/crm/customers${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`,
        { credentials: "include", cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !value,
  });
  const results = (data ?? []).filter((c) => !exclude?.has(c.id)).map(clientOption);
  return (
    <PickerShell value={value} onChange={onChange} q={q} setQ={setQ} results={results}
      loading={isFetching || q.trim() !== debounced} placeholder={placeholder} testid={testid}
      clearLabel={clearLabel} emptyText={debounced ? "No clients match." : "No clients yet."} />
  );
}

/** Pick from a list already in memory (a client's projects, the board). */
export function ListSearchPicker({
  value, onChange, options, placeholder, testid, clearLabel, emptyText = "Nothing matches.",
}: {
  value: PickOption | null;
  onChange: (o: PickOption | null) => void;
  options: PickOption[];
  placeholder: string;
  testid: string;
  clearLabel?: string;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const results = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.detail ?? "").toLowerCase().includes(needle))
    : options;
  return (
    <PickerShell value={value} onChange={onChange} q={q} setQ={setQ} results={results}
      placeholder={placeholder} testid={testid} clearLabel={clearLabel} emptyText={emptyText} />
  );
}
