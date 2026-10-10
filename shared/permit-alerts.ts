/**
 * Permit alerts — the shared vocabulary of a watch (client form + server
 * validation + matching). Pure data: no DB, no DOM.
 *
 * A watch is one thing a customer wants to hear about:
 *   address     — any permit at one street address (or parcel) in a jurisdiction
 *   trade_area  — permits of certain trades (roofing, HVAC, …) within a radius
 *                 of a point, or anywhere in the chosen jurisdictions when the
 *                 address could not be geocoded / the permit has no coordinates
 *   contractor  — permits naming a contractor (by name or license)
 *   parcel      — permits on one parcel number
 *
 * Coverage is honest: a jurisdiction is polled only when its portal's adapter
 * can list permits by date (PortalAdapter.capabilities.listRecent). The UI
 * shows "Alerts supported" per jurisdiction from that flag, never a promise.
 */

export const WATCH_KINDS = ["address", "trade_area", "contractor", "parcel"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export const WATCH_KIND_LABELS: Record<WatchKind, string> = {
  address: "An address",
  trade_area: "Trades in an area",
  contractor: "A contractor",
  parcel: "A parcel",
};

/** Trade keys the picker offers. Keywords are matched (case-insensitive, word-ish) against permit type + work class + description. */
export const TRADES = [
  { key: "roofing", label: "Roofing", keywords: ["roof", "re-roof", "reroof", "shingle"] },
  { key: "hvac", label: "HVAC", keywords: ["hvac", "mechanical", "furnace", "heat pump", "air condition", "a/c", "ac unit", "ductwork", "mini split", "mini-split"] },
  { key: "electrical", label: "Electrical", keywords: ["electric", "electrical", "panel upgrade", "service upgrade", "ev charger", "generator"] },
  { key: "plumbing", label: "Plumbing", keywords: ["plumb", "water heater", "sewer", "repipe", "re-pipe", "backflow", "gas line", "gas piping"] },
  { key: "solar", label: "Solar", keywords: ["solar", "photovoltaic", " pv ", "pv system", "battery storage"] },
  { key: "pool", label: "Pool & spa", keywords: ["pool", "spa", "hot tub"] },
  { key: "remodel", label: "Remodel / addition", keywords: ["remodel", "renovat", "addition", "alteration", "tenant improvement", "kitchen", "bathroom", "interior"] },
  { key: "new_construction", label: "New construction", keywords: ["new construction", "new single family", "new sfr", "new residential", "new commercial", "new building", "new dwelling", "new home"] },
  { key: "demolition", label: "Demolition", keywords: ["demo", "demolition", "demolish"] },
  { key: "fence_deck", label: "Fence / deck / patio", keywords: ["fence", "deck", "patio", "pergola"] },
  { key: "windows_doors", label: "Windows & doors", keywords: ["window", "door", "glazing"] },
  { key: "siding_stucco", label: "Siding / stucco / paint", keywords: ["siding", "stucco", "exterior paint"] },
  { key: "foundation", label: "Foundation / structural", keywords: ["foundation", "structural", "retaining wall", "seismic", "pier"] },
  { key: "fire", label: "Fire protection", keywords: ["fire sprinkler", "fire alarm", "fire suppression", "fire protection"] },
  { key: "grading_site", label: "Grading / site work", keywords: ["grading", "excavat", "site work", "drainage", "driveway", "paving"] },
  { key: "signs", label: "Signs", keywords: ["sign ", "signage", "sign permit"] },
] as const;
export type TradeKey = (typeof TRADES)[number]["key"];
export const TRADE_KEYS: readonly TradeKey[] = TRADES.map((t) => t.key);

export type WatchChannels = {
  email: boolean;
  sms: boolean;
  /** E.164-ish phone for the text; falls back to the CRM owner's phone when empty. */
  smsTo?: string | null;
  telegram: boolean;
};

export type WatchParams = {
  /** address | parcel | trade_area center. */
  address?: string | null;
  parcel?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** trade_area: miles around (lat,lng). Absent/0 = the whole jurisdiction(s). */
  radiusMiles?: number | null;
  /** trade_area: trade keys from TRADES, plus free keywords. */
  trades?: TradeKey[];
  keywords?: string[];
  /** contractor */
  contractorName?: string | null;
  contractorLicense?: string | null;
};

export type PermitWatchDto = {
  id: number;
  userId: number;
  kind: WatchKind;
  name: string;
  params: WatchParams;
  channels: WatchChannels;
  /** permit_databases.id rows this watch polls. */
  databaseIds: number[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastMatchedAt: string | null;
  hitCount: number;
  jurisdictions: Array<{ databaseId: number; name: string; jurisdiction: string; platform: string | null; alertsSupported: boolean; lastPolledAt: string | null; lastSuccessAt: string | null; lastError: string | null; failingSince: string | null }>;
};

/** Up to this many permits per watch per poll in one digest message. */
export const DIGEST_MAX_PERMITS = 10;
export const MAX_WATCHES_PER_USER = 50;
export const MAX_DATABASES_PER_WATCH = 25;
export const MAX_RADIUS_MILES = 100;
