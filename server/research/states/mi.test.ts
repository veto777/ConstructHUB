import { describe, expect, it } from "vitest";
import { miHolder, miRow } from "./mi";

describe("Michigan LARA holder and components (audit round 2, decisions 2 and 10)", () => {
  it("the license type says who holds it", () => {
    expect(miHolder("Residential Builder Company")).toBe("business");
    expect(miHolder("Electrical Contractor")).toBe("business");
    expect(miHolder("Electrical Registered Fire Alarm Cont")).toBe("business");
    expect(miHolder("Residential Builder Individual")).toBe("individual");
    expect(miHolder("Electrical Journey")).toBe("individual");
    expect(miHolder(null)).toBeNull();
  });
  it("each row carries its export as its component; a person with a business name is still the person's license", () => {
    const h = miRow({ "License Number": "6101234567", "License Type": "Electrical Master", "Business Name": "Acme Electric LLC", "First Name": "Jane", "Middle Initial": "", "Last Name": "Doe", City: "Lansing", State: "MI" }, "Electrical Master");
    expect(h?.component).toBe("Electrical Master");
    expect(h?.kind === "license" && h.hit.holder).toBe("individual");
  });
});
