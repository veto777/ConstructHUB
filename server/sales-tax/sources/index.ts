/**
 * Every official rate adapter. One adapter may cover several states. A state
 * missing here has no machine-readable official file we can load — see
 * docs/ops/SALES-TAX-RATES.md for the per-state coverage list and why.
 *
 * Not registered on purpose: ak.ts (the Alaska Remote Seller Sales Tax Commission is a commission of municipalities,
 * not a state revenue department; Alaska construction is not taxable to the customer anyway — the treatment table
 * stops there).
 */
import type { SalesTaxSource } from "../types";
import { waSource } from "./wa";
import { caSource } from "./ca";
import { txSource } from "./tx";
import { moSource } from "./mo";
import { ilSource } from "./il";
import { nmSource } from "./nm";
import { sstSource } from "./sst";
import { flSource } from "./fl";
import { vaSource } from "./va";
import { paSource } from "./pa";
import { ctSource } from "./ct";
import { maSource } from "./ma";
import { meSource } from "./me";
import { hiSource } from "./hi";
import { noSalesTaxSource } from "./no-sales-tax";

export const SALES_TAX_SOURCES: SalesTaxSource[] = [
  waSource,
  caSource, txSource, moSource, ilSource, nmSource,
  sstSource,
  flSource, vaSource, paSource, ctSource, maSource, meSource, hiSource,
  noSalesTaxSource,
];
