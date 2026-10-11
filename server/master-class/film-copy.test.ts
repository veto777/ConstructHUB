import { expect, it } from "vitest";
import modules from "../data/master-class-modules.json";

it("describes lessons without ranking, lead, revenue, or owner-success promises", () => {
  const text = modules.map(m => [m.description, ...m.features].join(" ")).join(" ");
  expect(text).not.toMatch(/autopilot|rank #1|7 figures|built by owners|dominates|boosts rankings|that ranks|close deals|proven system|top-performing|converts visitors into booked jobs/i);
  for (const module of modules) expect(module.description).toMatch(/^Learn /);
});
