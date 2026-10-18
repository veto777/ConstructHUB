import { Sun, Moon } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { MAX_SHADE, THEME_SHADES, useTheme } from "./theme-provider";
import { cn } from "@/lib/utils";

/**
 * The appearance slider: sun to moon across the five shades (theme-provider.tsx). Dragging previews live and
 * saves at once; there is no OK button. Used in the header's theme popover and the phone ribbon's More sheet.
 */
export function ThemeShadeSlider({ className }: { className?: string }) {
  const { shade, setShade } = useTheme();
  const current = THEME_SHADES[shade] ?? THEME_SHADES[0];
  return (
    <div className={cn("space-y-2", className)} data-testid="theme-shade">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span id="theme-shade-label">Appearance</span>
        <span className="text-foreground" data-testid="theme-shade-current">{current.label}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <Sun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Slider
          min={0} max={MAX_SHADE} step={1}
          value={[shade]}
          onValueChange={([v]) => { if (typeof v === "number") setShade(v); }}
          aria-labelledby="theme-shade-label"
          aria-valuetext={current.label}
          data-testid="theme-shade-slider"
        />
        <Moon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex justify-between px-6 text-[10px] text-muted-foreground" aria-hidden="true">
        {THEME_SHADES.map((s) => (
          <button key={s.value} type="button" tabIndex={-1} onClick={() => setShade(s.value)}
            className={cn("rounded px-0.5 hover:text-foreground", s.value === shade && "font-semibold text-foreground")}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}
