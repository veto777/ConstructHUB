import { Sun, Moon, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme } from "./theme-provider";
import { ThemeShadeSlider } from "./theme-shade-slider";

/** The header's appearance button: opens the light-to-dark slider (theme-shade-slider.tsx). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, shade } = useTheme();
  // The two ends keep their familiar icons; anything in between shows the half-and-half one.
  const Icon = shade === 0 ? Moon : theme === "dark" && shade === 4 ? Sun : SunMoon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={className}
          aria-label="Appearance: light to dark"
          title="Appearance"
          data-testid="button-theme-toggle"
        >
          <Icon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" data-testid="theme-popover">
        <ThemeShadeSlider />
      </PopoverContent>
    </Popover>
  );
}
