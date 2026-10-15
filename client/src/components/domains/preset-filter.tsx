import { useEffect, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GooglePill } from "@/components/google";

/**
 * A filter select whose list is only a start (owner's program 2026-10-15, rule 6): the presets are offered,
 * and "Type your own…" turns the select into a text box so a value the list does not know can be filtered on
 * too. The caller decides what a typed value means (sent to the server as-is, or matched on the loaded page).
 *
 * `value` is the filter's current value: "" (the first, "All …" option), a preset, or anything else — which
 * shows as the typed value. A typed value is applied on Enter or when the box loses focus; the × clears it.
 */
const CUSTOM = "__custom__";

export function PresetFilter({ label, value, onChange, presets, allLabel, placeholder, selectClass, testId }: {
  /** The accessible name of the control ("Filter registrar"). */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** [value, shown label] pairs; a bare string shows as itself. */
  presets: readonly (string | readonly [string, string])[];
  /** The "" option: "All registrars". */
  allLabel: string;
  placeholder?: string;
  selectClass: string;
  testId?: string;
}) {
  const pairs = presets.map((p): [string, string] => (typeof p === "string" ? [p, p] : [p[0], p[1]]));
  const isPreset = value === "" || pairs.some(([v]) => v === value);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(isPreset ? "" : value);
  // A value set from outside (a chip, a reset) moves the control with it.
  useEffect(() => { if (!isPreset) { setCustom(true); setDraft(value); } else if (value === "" && draft === "") setCustom(false); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => { const v = draft.trim(); if (v !== value) onChange(v); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") clear(); };
  const clear = () => { setDraft(""); setCustom(false); if (value !== "") onChange(""); };
  if (custom) {
    return (
      <div className="flex w-full items-center gap-1 sm:w-auto" data-testid={testId ? `${testId}-custom` : undefined}>
        <Input
          aria-label={`${label} — your own value`}
          className="h-10 w-full rounded-full sm:w-44"
          placeholder={placeholder ?? "Type a value and press Enter"}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          data-testid={testId ? `${testId}-input` : undefined}
        />
        <GooglePill variant="quiet" size="sm" icon={X} ariaLabel={`Clear ${label.toLowerCase()}`} label="" className="min-h-0 px-1.5" onClick={clear} />
      </div>
    );
  }
  return (
    <select
      className={selectClass}
      aria-label={label}
      value={value}
      data-testid={testId}
      onChange={(e) => {
        const v = e.target.value;
        if (v === CUSTOM) { setCustom(true); setDraft(""); return; }
        onChange(v);
      }}
    >
      <option value="">{allLabel}</option>
      {pairs.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      <option value={CUSTOM}>Type your own…</option>
    </select>
  );
}
