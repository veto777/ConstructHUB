import type { DashboardTileKey } from "@shared/dashboard";
import { growTiles } from "./grow";
import { protectTiles } from "./protect";
import { winTiles } from "./win";
import { runTiles } from "./run";
import { learnTiles } from "./learn";
import type { TileSource, TileSources } from "./types";

export * from "./types";

/** One source per data tile. callAssistant is "coming_soon" by its gate unless its add-on module is on (run.ts). */
export const TILE_SOURCES: TileSources = { ...growTiles, ...protectTiles, ...winTiles, ...runTiles, ...learnTiles };

export const tileSource = (key: DashboardTileKey, overrides?: TileSources): TileSource | undefined =>
  overrides?.[key] ?? TILE_SOURCES[key];
