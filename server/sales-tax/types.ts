/**
 * Official sales-tax rate reference data — shared row shape.
 *
 * Every row comes from a state revenue department's own published file (or, for a
 * state with one statewide rate and no local sales taxes, its DOR rate page). Rates
 * are never derived, estimated or filled in: a state without an official
 * machine-readable source simply has no rows (see docs/ops/SALES-TAX-RATES.md).
 */

export type SalesTaxRowKind =
  /** An incorporated city/town/village with its own combined rate. */
  | "city"
  /** The unincorporated part of a county (WA "Whatcom County Unincorp. Areas"). */
  | "unincorporated"
  /** A county-wide rate (states whose local tax is county-level only). */
  | "county"
  /** One statewide rate — the state has no local sales taxes. */
  | "state"
  /** Anything narrower than a city the state publishes separately (tribal area, PTBA, special district). */
  | "special";

export type SalesTaxRow = {
  /** Two-letter USPS code, upper case. */
  state: string;
  /** Place name as the state publishes it (title case), null for county/state rows. */
  city: string | null;
  county: string | null;
  /** The state's own location/jurisdiction code, when it has one (WA "3701"). */
  locationCode: string | null;
  /** A 5-digit ZIP, when the source is ZIP-keyed. */
  zip: string | null;
  kind: SalesTaxRowKind;
  /** Combined state + local rate, in percent (9.2 = 9.2%), exactly as published. */
  ratePct: number;
  /** YYYY-MM-DD the rate is effective from. */
  effectiveDate: string;
};

/** One state's load: where it came from and what it holds. */
export type SalesTaxSourceResult = {
  state: string;
  /** Short label shown to users, e.g. "WA DOR". */
  sourceName: string;
  /** The exact file (or page) the rows were read from. */
  sourceUrl: string;
  /** Effective date of the published table (YYYY-MM-DD). */
  effectiveDate: string;
  /** Human period label, e.g. "Q4 2026" or "Oct 2026". */
  periodLabel: string;
  rows: SalesTaxRow[];
  notes?: string;
};

export type FetchCtx = {
  get(url: string): Promise<Buffer>;
  getText(url: string): Promise<string>;
};

export type SalesTaxSource = {
  /** States this adapter loads (one adapter may cover several, e.g. the SST files). */
  states: string[];
  name: string;
  load(ctx: FetchCtx): Promise<SalesTaxSourceResult[]>;
};

/** Percent → basis points as the estimate stores them (integer; 8.875% → 888). */
export const pctToBps = (pct: number): number => Math.round(pct * 100);

/** "Q4 2026" for a YYYY-MM-DD effective date. */
export function quarterLabel(effectiveDate: string): string {
  const [y, m] = effectiveDate.split("-").map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
