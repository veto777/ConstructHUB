import { describe, it, expect } from "vitest";
import { researchAdminOrderSchema, researchOrderSchema, STATE_CODES } from "@shared/research-reports";
describe("admin orders have no ceilings", () => {
  it("accepts 200 names in every state with 60 of each identifier; a customer order of that size is refused", () => {
    const subjects = Array.from({ length: 200 }, (_, i) => ({
      name: `Acme Builders ${i}`, kind: "company",
      licenseNumbers: Array.from({ length: 60 }, (_, j) => `CGC15${String(i * 100 + j).padStart(5, "0")}`),
      phones: Array.from({ length: 60 }, (_, j) => `(813) 555-${String(1000 + j)}`),
      addresses: [], websites: Array.from({ length: 60 }, (_, j) => `acme${i}-${j}.com`),
    }));
    const order = { subjects, states: [...STATE_CODES], agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true };
    const r = researchAdminOrderSchema.safeParse(order);
    expect(r.success, JSON.stringify(!r.success && r.error.issues[0])).toBe(true);
    expect(researchOrderSchema.safeParse(order).success).toBe(false);
  });
});
