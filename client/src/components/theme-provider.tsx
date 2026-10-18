import { useState, useEffect, createContext, useContext } from "react";

/**
 * Appearance: five shades from light to dark, picked with a slider (owner 2026-10-17: "a scroller that can go from
 * dark mode to light mode and a bunch in between, and once it's set it saves that way").
 *
 *   0 Light · 1 Soft (light, dimmer surfaces) · 2 Dusk (dark, lighter surfaces) · 3 Dim · 4 Dark
 *
 * Shades 2–4 carry the `dark` class (every dark: rule and the .dark token palettes apply); the shade itself is
 * `data-shade` on <html>, which index.css reads to lift or lower the surface tokens. Saved in localStorage:
 * "themeShade" (0–4) plus the old "theme" (light|dark) the boot script in index.html and older code still read.
 */
export type Theme = "light" | "dark";
export const THEME_SHADES = [
  { value: 0, label: "Light" },
  { value: 1, label: "Soft" },
  { value: 2, label: "Dusk" },
  { value: 3, label: "Dim" },
  { value: 4, label: "Dark" },
] as const;
export const MAX_SHADE = THEME_SHADES.length - 1;
/** The first shade that is dark. */
const DARK_FROM = 2;
export const themeOfShade = (shade: number): Theme => (shade >= DARK_FROM ? "dark" : "light");

interface ThemeContextType {
  theme: Theme;
  shade: number;
  setShade: (shade: number) => void;
  /** Jumps between the two ends: dark → Light, light → Dark. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  shade: 0,
  setShade: () => {},
  toggleTheme: () => {},
});

const clampShade = (n: number) => Math.min(MAX_SHADE, Math.max(0, Math.round(n)));

function readShade(): number {
  if (typeof window === "undefined") return 0;
  try {
    const saved = localStorage.getItem("themeShade");
    // The same test as the boot script in index.html, so both paint the same shade; anything else falls back.
    if (saved !== null && /^[0-4]$/.test(saved)) return Number(saved);
    // Accounts from before the slider: their light/dark choice maps to the two ends.
    return localStorage.getItem("theme") === "dark" ? MAX_SHADE : 0;
  } catch {
    return 0;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [shade, setShadeState] = useState<number>(readShade);
  const theme = themeOfShade(shade);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-shade", String(shade));
    try {
      localStorage.setItem("theme", theme);
      localStorage.setItem("themeShade", String(shade));
    } catch { /* private mode: the choice lasts the page */ }
  }, [shade, theme]);

  const setShade = (n: number) => setShadeState(clampShade(n));
  const toggleTheme = () => setShadeState((s) => (themeOfShade(s) === "dark" ? 0 : MAX_SHADE));

  return (
    <ThemeContext.Provider value={{ theme, shade, setShade, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
