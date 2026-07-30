/**
 * The formula evaluator suite — this is the 24-case suite §7a of
 * analysis/CRM-BRAIN.md says existed at build time but was never committed.
 *
 * The evaluator is a security boundary: price-book formulas are untrusted
 * tenant data, and anything beyond numbers, [SYMBOL] tokens, + - * / %,
 * parentheses, unary minus and min/max/ceil/floor/round must be a syntax
 * error. If any of the "rejects" cases below starts passing, the evaluator
 * has grown an attack surface.
 */
import { describe, it, expect } from "vitest";
import { evalFormula, validateFormula, formulaSymbols, FormulaError } from "./formula";

describe("evalFormula — arithmetic", () => {
  it("1: plain addition", () => expect(evalFormula("1+2")).toBe(3));
  it("2: operator precedence", () => expect(evalFormula("1+2*3")).toBe(7));
  it("3: parentheses override precedence", () => expect(evalFormula("(1+2)*3")).toBe(9));
  it("4: division yields fractions", () => expect(evalFormula("10/4")).toBe(2.5));
  it("5: modulo", () => expect(evalFormula("10%3")).toBe(1));
  it("6: unary minus at start", () => expect(evalFormula("-3+1")).toBe(-2));
  it("7: unary minus after an operator", () => expect(evalFormula("2*-3")).toBe(-6));
  it("8: unary minus after an open paren", () => expect(evalFormula("(-2)*3")).toBe(-6));
  it("9: mixed expression", () => expect(evalFormula("2+3*4-1")).toBe(13));
  it("10: decimals", () => expect(evalFormula("0.1+0.2")).toBeCloseTo(0.3, 10));
});

describe("evalFormula — symbols and functions", () => {
  it("11: [SYMBOL] resolves from the map", () =>
    expect(evalFormula("[SQUARES]*2", { SQUARES: 32 })).toBe(64));
  it("12: unknown symbols resolve to 0 (Leap-compatible)", () =>
    expect(evalFormula("[NOPE]+5")).toBe(5));
  it("13: min/max with multiple args", () => {
    expect(evalFormula("min(4,2,8)")).toBe(2);
    expect(evalFormula("max(4,2,8)")).toBe(8);
  });
  it("14: ceil/floor/round", () => {
    expect(evalFormula("ceil(4.1)")).toBe(5);
    expect(evalFormula("floor(4.9)")).toBe(4);
    expect(evalFormula("round(4.5)")).toBe(5);
  });
  it("15: the documented roofing example", () =>
    expect(evalFormula("ceil([SQUARES] * (1 + [WASTE]/100)) + 2", { SQUARES: 32, WASTE: 10 })).toBe(38));
  it("16: empty formula is 0", () => expect(evalFormula("")).toBe(0));
});

describe("evalFormula — division by zero is 0, never Infinity/NaN", () => {
  it("17: x/0 = 0", () => expect(evalFormula("1/0")).toBe(0));
  it("18: 0/0 = 0", () => expect(evalFormula("0/0")).toBe(0));
  it("19: computed zero denominator", () => expect(evalFormula("5/(2-2)")).toBe(0));
  it("20: x%0 = 0", () => expect(evalFormula("7%(3-3)")).toBe(0));
});

describe("evalFormula — rejects anything that smells like code", () => {
  const bad: [string, string][] = [
    ["21", "require('fs')"],
    ["22", "process.exit(1)"],
    ["23", "constructor"],
    ["24", "this"],
    ["25", "eval('1')"],
    ["26", "1;2"],
    ["27", "(1+2"],
    ["28", "`1`"],
    ["29", "2**3"],
    ["30", "a.b"],
    ["31", "foo(1)"],
    ["32", "[1BAD]"],
  ];
  for (const [n, src] of bad) {
    it(`${n}: rejects ${JSON.stringify(src)}`, () => expect(() => evalFormula(src)).toThrow(FormulaError));
  }
  it("33: rejects over-long formulas", () =>
    expect(() => evalFormula("1+".repeat(300) + "1")).toThrow(FormulaError));
});

describe("validateFormula / formulaSymbols", () => {
  it("validateFormula reports ok and the error message", () => {
    expect(validateFormula("ceil([SQ]*1.1)")).toEqual({ ok: true });
    const bad = validateFormula("require('fs')");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/require/);
  });
  it("formulaSymbols lists unique referenced symbols", () =>
    expect(formulaSymbols("[SQ]*2+[WASTE]+[SQ]")).toEqual(["SQ", "WASTE"]));
  it("formulaSymbols returns [] for garbage instead of throwing", () =>
    expect(formulaSymbols("eval('1')")).toEqual([]));
});
