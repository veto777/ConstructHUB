import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, MoreHorizontal, Menu, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TAB_SLOTS, resolveTabs, type TabOption } from "@shared/tab-bar";

/**
 * Pick the four tabs of a phone tab bar (owner, 2026-10-04: "Let the settings allow you to pick what's in your lower
 * Ribbon on mobile and app"). The fifth slot is always Menu / More. Shows the bar as it will look, lets the order be
 * changed, and saves through `onSave` (the caller's PUT /api/account/ui-prefs).
 */
export function TabBarPicker({ options, defaults, value, icons, can = () => true, lastLabel, onSave, saving, testIdPrefix }: {
  options: readonly TabOption[];
  defaults: readonly string[];
  value: string[] | null | undefined;
  icons: Record<string, LucideIcon>;
  can?: (o: TabOption) => boolean;
  lastLabel: "Menu" | "More";
  onSave: (keys: string[] | null) => Promise<unknown> | void;
  saving?: boolean;
  testIdPrefix: string;
}) {
  const current = resolveTabs(value, options, defaults, can).map((o) => o.key);
  const [picked, setPicked] = useState<string[]>(current);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setPicked(resolveTabs(value, options, defaults, can).map((o) => o.key)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(value)]);
  const byKey = new Map(options.map((o) => [o.key, o]));
  const dirty = picked.join() !== current.join();
  const toggle = (k: string) => {
    setSaved(false);
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= TAB_SLOTS ? p : [...p, k]));
  };
  const move = (i: number, d: -1 | 1) => {
    setSaved(false);
    setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const Last = lastLabel === "Menu" ? Menu : MoreHorizontal;

  return (
    <div className="space-y-4" data-testid={`${testIdPrefix}-picker`}>
      {/* The bar as it will look on the phone. */}
      <div className="flex rounded-xl border bg-background/90 shadow-sm" aria-label="Preview">
        {picked.map((k, i) => {
          const o = byKey.get(k)!; const Icon = icons[k];
          return (
            <div key={k} className="flex flex-1 flex-col items-center gap-1 py-2 text-muted-foreground" data-testid={`${testIdPrefix}-preview-${k}`}>
              {Icon && <Icon className="h-5 w-5" strokeWidth={1.8} />}
              <span className="text-[10px] font-semibold leading-none">{o.label}</span>
              <div className="flex gap-1 pt-0.5">
                <button type="button" aria-label={`Move ${o.label} left`} disabled={i === 0} onClick={() => move(i, -1)}
                  className="rounded p-1 hover:bg-accent disabled:opacity-30"><ArrowLeft className="h-3 w-3" /></button>
                <button type="button" aria-label={`Move ${o.label} right`} disabled={i === picked.length - 1} onClick={() => move(i, 1)}
                  className="rounded p-1 hover:bg-accent disabled:opacity-30"><ArrowRight className="h-3 w-3" /></button>
              </div>
            </div>
          );
        })}
        {Array.from({ length: TAB_SLOTS - picked.length }, (_, i) => (
          <div key={`empty-${i}`} className="flex flex-1 items-center justify-center py-2 text-[10px] text-muted-foreground/60">Empty</div>
        ))}
        <div className="flex flex-1 flex-col items-center gap-1 py-2 text-muted-foreground/70">
          <Last className="h-5 w-5" strokeWidth={1.8} />
          <span className="text-[10px] font-semibold leading-none">{lastLabel}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Pick up to {TAB_SLOTS}. {lastLabel} always stays last, so every page is one tap away.</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.filter(can).map((o) => {
          const on = picked.includes(o.key); const Icon = icons[o.key];
          const full = !on && picked.length >= TAB_SLOTS;
          return (
            <button key={o.key} type="button" onClick={() => toggle(o.key)} disabled={full} aria-pressed={on}
              data-testid={`${testIdPrefix}-option-${o.key}`}
              className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                on ? "border-primary bg-primary/10 text-foreground" : "hover:bg-accent", full && "opacity-50")}>
              {Icon && <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />}
              <span className="flex-1">{o.label}</span>
              {on && <Check className="h-4 w-4 text-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={async () => { await onSave(picked.length ? picked : null); setSaved(true); }} disabled={!dirty || saving || !picked.length}
          data-testid={`${testIdPrefix}-save`}>
          {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : "Save"}
        </Button>
        <Button variant="ghost" onClick={async () => { await onSave(null); setSaved(true); }} disabled={saving} data-testid={`${testIdPrefix}-reset`}>
          Reset to default
        </Button>
        {saved && !dirty && <span className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-saved`}>Saved</span>}
      </div>
    </div>
  );
}
