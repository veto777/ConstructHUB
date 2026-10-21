/**
 * Every official rate adapter. One adapter may cover several states. A state
 * missing here has no machine-readable official file we can load — see
 * docs/ops/SALES-TAX-RATES.md for the per-state coverage list and why.
 */
import type { SalesTaxSource } from "../types";
import { waSource } from "./wa";

export const SALES_TAX_SOURCES: SalesTaxSource[] = [
  waSource,
];
