import type { CSSProperties } from "react";

/**
 * CSS variables that re-point a page's accent (`--primary`, `--ring`) at the
 * org's company theme colour (shared/theme-colors.ts). The values arrive
 * server-resolved in the payload — the client sets them verbatim and never
 * does colour math.
 *
 * Applied as an inline style on the page root, so every `text-primary`,
 * `bg-primary/…`, `border-primary/…` and Button below it picks the theme up;
 * the CRM workspace shell outside the root keeps the ConstructHub identity.
 */
export function orgThemeStyle(
  theme?: { hex: string; onHex: string; hsl: string; onHsl: string } | null,
): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    "--primary": theme.hsl,
    "--primary-foreground": theme.onHsl,
    "--ring": theme.hsl,
    "--primary-border": theme.hex,
  } as CSSProperties;
}
