/**
 * Per-company theme colours.
 *
 * Every org picks ONE accent from this fixed palette of 20 (Settings →
 * Company theme). The pairing is always black + the chosen colour: dark
 * bands where a band exists, the accent for actions — "if they are gold it
 * will be black and gold, if they are green it will be black and green".
 *
 * The choice persists on the org at customFields->>'themeColor' (the preset
 * id); anything missing or unknown resolves to the ConstructHub brand orange
 * so documents never lose their accent.
 *
 * Where it applies: client-facing surfaces only — the public estimate/invoice
 * pages, the client portal, and the signed-contract PDF. The CRM workspace
 * shell keeps the ConstructHub CRM identity.
 */

export type CrmThemeColor = {
  id: string;
  name: string;
  /** The accent itself. */
  hex: string;
  /** Text/icon colour ON the accent (contrast pair, chosen per preset). */
  onHex: string;
};

export const CRM_THEME_COLORS: readonly CrmThemeColor[] = [
  { id: "orange", name: "Orange", hex: "#F97316", onHex: "#FFFFFF" }, // the ConstructHub brand default
  { id: "gold", name: "Gold", hex: "#C9A227", onHex: "#111111" },
  { id: "amber", name: "Amber", hex: "#D97706", onHex: "#111111" },
  { id: "rust", name: "Rust", hex: "#C2410C", onHex: "#FFFFFF" },
  { id: "red", name: "Red", hex: "#DC2626", onHex: "#FFFFFF" },
  { id: "crimson", name: "Crimson", hex: "#BE123C", onHex: "#FFFFFF" },
  { id: "pink", name: "Pink", hex: "#DB2777", onHex: "#FFFFFF" },
  { id: "plum", name: "Plum", hex: "#A21CAF", onHex: "#FFFFFF" },
  { id: "purple", name: "Purple", hex: "#7C3AED", onHex: "#FFFFFF" },
  { id: "navy", name: "Navy", hex: "#1E3A8A", onHex: "#FFFFFF" },
  { id: "blue", name: "Blue", hex: "#2563EB", onHex: "#FFFFFF" },
  { id: "sky", name: "Sky", hex: "#0284C7", onHex: "#FFFFFF" },
  { id: "cyan", name: "Cyan", hex: "#0891B2", onHex: "#FFFFFF" },
  { id: "teal", name: "Teal", hex: "#0D9488", onHex: "#FFFFFF" },
  { id: "emerald", name: "Emerald", hex: "#059669", onHex: "#FFFFFF" },
  { id: "green", name: "Green", hex: "#16A34A", onHex: "#FFFFFF" },
  { id: "forest", name: "Forest", hex: "#166534", onHex: "#FFFFFF" },
  { id: "brown", name: "Brown", hex: "#6D4C41", onHex: "#FFFFFF" },
  { id: "slate", name: "Slate", hex: "#475569", onHex: "#FFFFFF" },
  { id: "black", name: "Black", hex: "#111827", onHex: "#F9FAFB" },
] as const;

export const DEFAULT_THEME_COLOR_ID = "orange";
export const DEFAULT_THEME_HEX = "#F97316";

/** True only for a real preset id — the org PATCH rejects anything else. */
export function isThemeColorId(id: unknown): id is string {
  return typeof id === "string" && CRM_THEME_COLORS.some((c) => c.id === id);
}

/** "#F97316" → "25 95% 53%" — the triplet `hsl(var(--primary))` consumes. */
export function hexToHslTriplet(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export type ResolvedTheme = CrmThemeColor & {
  /** HSL triplet of hex, for `--primary`. */
  hsl: string;
  /** HSL triplet of onHex, for `--primary-foreground`. */
  onHsl: string;
};

/** customFields → the full preset. Unknown/missing ids resolve to orange. */
export function resolveOrgTheme(customFields: unknown): ResolvedTheme {
  const id = (customFields as Record<string, unknown> | null | undefined)?.themeColor;
  const preset =
    CRM_THEME_COLORS.find((c) => c.id === id) ??
    CRM_THEME_COLORS.find((c) => c.id === DEFAULT_THEME_COLOR_ID)!;
  return { ...preset, hsl: hexToHslTriplet(preset.hex), onHsl: hexToHslTriplet(preset.onHex) };
}

/**
 * The shape threaded into client-facing payloads (public estimate/invoice,
 * client portal). Fully server-resolved — the client sets CSS variables from
 * these values verbatim and never does colour math.
 */
export function themePayload(customFields: unknown): {
  themeColor: string;
  theme: { hex: string; onHex: string; hsl: string; onHsl: string };
} {
  const t = resolveOrgTheme(customFields);
  return { themeColor: t.id, theme: { hex: t.hex, onHex: t.onHex, hsl: t.hsl, onHsl: t.onHsl } };
}
