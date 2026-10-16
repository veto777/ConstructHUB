import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GooglePill } from "@/components/google";

/**
 * A filter select whose list is only a start (owner's program 2026-10-15, rule 6): the presets are offered,
 * and a "Type your own…" button beside the select turns it into a text box so a value the list does not know
 * can be filtered on too. The caller decides what a typed value means (sent to the server as-is, or matched on
 * the loaded page).
 *
 * `value` is the filter's current value: "" (the first, "All …" option), a preset, or anything else — which
 * shows as the typed value. A typed value is applied on Enter or when the box loses focus; the × (or Escape)
 * clears it and brings the select back, with focus on it.
 *
 * The switch is a real button, not an option in the select: a keyboard user arrows through a native select's
 * options, and in Chrome every arrow press is a change — an option that swapped the control out would fire
 * on the way past it.
 */
export function PresetFilter({ label, value, onChange, presets, allLabel, placeholder, maxLength, selectClass, testId }: {
  /** The accessible name of the control ("Filter registrar"). */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** [value, shown label] pairs; a bare string shows as itself. */
  presets: readonly (string | readonly [string, string])[];
  /** The "" option: "All registrars". */
  allLabel: string;
  placeholder?: string;
  /** The longest typed value the server takes (e.g. Mail Alerts' 40-character category/severity). */
  maxLength?: number;
  selectClass: string;
  testId?: string;
}) {
  const pairs = presets.map((p): [string, string] => (typeof p === "string" ? [p, p] : [p[0], p[1]]));
  const isPreset = value === "" || pairs.some(([v]) => v === value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : value);
  const selectRef = useRef<HTMLSelectElement>(null);
  const backToSelect = useRef(false);
  // A value set from outside (a chip, a reset) moves the control with it.
  useEffect(() => { if (!isPreset) { setCustom(true); setDraft(value); } else if (value === "" && draft === "") setCustom(false); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  // After a clear, focus goes back to the select the text box replaced (never lost to the page).
  useEffect(() => { if (!custom && backToSelect.current) { backToSelect.current = false; selectRef.current?.focus(); } }, [custom]);
  const commit = () => { const v = draft.trim(); if (v !== value) onChange(v); };
  const clear = () => { backToSelect.current = true; setDraft(""); setCustom(false); if (value !== "") onChange(""); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { e.preventDefault(); clear(); } };
  if (custom) {
    return (
      <div className="flex w-full items-center gap-1 sm:w-auto" data-testid={testId ? `${testId}-custom` : undefined}>
        <Input
          aria-label={`${label} — your own value`}
          className="h-10 w-full rounded-full max-sm:h-11 sm:w-44"
          placeholder={placeholder ?? "Type a value and press Enter"}
          value={draft}
          maxLength={maxLength}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <GooglePill variant="quiet" size="sm" icon={X} ariaLabel={`Clear ${label.toLowerCase()} and go back to the list`} label="" className="min-h-0 px-1.5 max-sm:!min-h-11 max-sm:min-w-11" onClick={clear} testId={testId ? `${testId}-clear` : undefined} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <select
        ref={selectRef}
        className={selectClass}
        aria-label={label}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allLabel}</option>
        {pairs.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
      <button
        type="button"
        className="g-pill g-pill--sm g-pill--quiet min-h-0 whitespace-nowrap px-2 max-sm:!min-h-11"
        aria-label={`${label}: type your own value`}
        onClick={() => { setCustom(true); setDraft(""); }}
        data-testid={testId ? `${testId}-own` : undefined}
      >
        Type your own…
      </button>
    </div>
  );
}
