/** The wire's outlet lists (its 2026 U.S. Budget and Premium sheets, parsed): server/data/press-outlets.json. */
import fs from "node:fs";
import path from "node:path";
import type { PressOutlets } from "@shared/press";

let cache: PressOutlets | null = null;
/** dev: server/data/press-outlets.json, built: dist/data/… (script/build.ts copies server/data). */
export function loadOutlets(): PressOutlets {
  if (cache) return cache;
  const here = import.meta.dirname || __dirname;
  const file = [path.join(here, "data", "press-outlets.json"), path.join(here, "..", "data", "press-outlets.json")].find((p) => fs.existsSync(p));
  const raw = file ? (JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PressOutlets>) : {};
  cache = { budget: raw.budget ?? [], national: raw.national ?? [], premium: raw.premium ?? [] };
  return cache;
}
export const pressOutletCounts = () => { const o = loadOutlets(); return { budget: o.budget.length, national: o.national.length, premium: o.premium.length }; };
