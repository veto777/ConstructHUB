/**
 * Price-book formula evaluator.
 *
 * Leap ships a generic math evaluator and feeds it operator-authored strings.
 * We do NOT do that: a price-book formula is untrusted tenant data, and `eval`
 * (or any general expression library with property access) on tenant data in a
 * multi-tenant app is remote code execution.
 *
 * This is a hand-written shunting-yard parser that accepts ONLY:
 *   numbers, [SYMBOL] tokens, + - * / %, parentheses, unary minus,
 *   and the functions min( ) max( ) ceil( ) floor( ) round( )
 * Anything else is a syntax error. There is no identifier lookup, no property
 * access, no function table beyond the five above.
 *
 * Example: "ceil([SQUARES] * (1 + [WASTE]/100)) + 2"
 */

const FUNCS = new Set(["min", "max", "ceil", "floor", "round"]);
const MAX_LEN = 500;

type Tok =
  | { t: "num"; v: number }
  | { t: "sym"; v: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" } | { t: "rp" } | { t: "comma" };

export class FormulaError extends Error {}

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LEN) throw new FormulaError("Formula is too long.");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c >= "0" && c <= "9" || c === ".") {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new FormulaError(`Bad number near "${src.slice(i, j)}"`);
      out.push({ t: "num", v: n }); i = j; continue;
    }
    if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new FormulaError("Unclosed [ in formula.");
      const name = src.slice(i + 1, j).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{0,30}$/.test(name)) throw new FormulaError(`Bad symbol "[${name}]"`);
      out.push({ t: "sym", v: name }); i = j + 1; continue;
    }
    if ("+-*/%".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { out.push({ t: "lp" }); i++; continue; }
    if (c === ")") { out.push({ t: "rp" }); i++; continue; }
    if (c === ",") { out.push({ t: "comma" }); i++; continue; }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      const word = src.slice(i, j).toLowerCase();
      if (!FUNCS.has(word)) {
        throw new FormulaError(`Unknown function "${word}". Allowed: ${[...FUNCS].join(", ")}. Use [SYMBOL] for values.`);
      }
      out.push({ t: "fn", v: word }); i = j; continue;
    }
    throw new FormulaError(`Unexpected character "${c}" in formula.`);
  }
  return out;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3 };

/** Evaluate a formula. Unknown symbols resolve to 0, matching Leap's behaviour. */
export function evalFormula(src: string, symbols: Record<string, number> = {}): number {
  const toks = tokenize(src ?? "");
  if (!toks.length) return 0;

  const vals: number[] = [];
  const ops: string[] = [];
  const argc: number[] = [];

  const apply = (op: string) => {
    if (op === "u-") {
      const a = vals.pop(); if (a === undefined) throw new FormulaError("Malformed formula.");
      vals.push(-a); return;
    }
    if (FUNCS.has(op)) {
      const n = argc.pop() ?? 1;
      const args = vals.splice(vals.length - n, n);
      if (args.length !== n) throw new FormulaError(`${op}() got the wrong number of arguments.`);
      let r: number;
      switch (op) {
        case "min": r = Math.min(...args); break;
        case "max": r = Math.max(...args); break;
        case "ceil": r = Math.ceil(args[0]); break;
        case "floor": r = Math.floor(args[0]); break;
        default: r = Math.round(args[0]);
      }
      vals.push(r); return;
    }
    const b = vals.pop(), a = vals.pop();
    if (a === undefined || b === undefined) throw new FormulaError("Malformed formula.");
    switch (op) {
      case "+": vals.push(a + b); break;
      case "-": vals.push(a - b); break;
      case "*": vals.push(a * b); break;
      // Division by zero yields 0 rather than Infinity — a price of Infinity is
      // never what anyone meant, and NaN would poison the whole estimate.
      case "/": vals.push(b === 0 ? 0 : a / b); break;
      case "%": vals.push(b === 0 ? 0 : a % b); break;
      default: throw new FormulaError(`Unknown operator ${op}`);
    }
  };

  let prevSignificant: Tok | null = null;
  for (const tk of toks) {
    if (tk.t === "num") { vals.push(tk.v); }
    else if (tk.t === "sym") {
      const v = symbols[tk.v];
      vals.push(typeof v === "number" && Number.isFinite(v) ? v : 0);
    }
    else if (tk.t === "fn") { ops.push(tk.v); argc.push(1); }
    else if (tk.t === "lp") { ops.push("("); }
    else if (tk.t === "comma") {
      while (ops.length && ops[ops.length - 1] !== "(") apply(ops.pop()!);
      argc[argc.length - 1] = (argc[argc.length - 1] ?? 1) + 1;
    }
    else if (tk.t === "rp") {
      while (ops.length && ops[ops.length - 1] !== "(") apply(ops.pop()!);
      if (!ops.length) throw new FormulaError("Unbalanced parentheses.");
      ops.pop();
      if (ops.length && FUNCS.has(ops[ops.length - 1])) apply(ops.pop()!);
    }
    else {
      // unary minus when '-' starts an expression or follows an operator or '('
      const unary = tk.v === "-" && (
        prevSignificant === null ||
        prevSignificant.t === "op" || prevSignificant.t === "lp" || prevSignificant.t === "comma"
      );
      const op = unary ? "u-" : tk.v;
      while (ops.length && ops[ops.length - 1] !== "(" &&
             (PREC[ops[ops.length - 1]] ?? 9) >= PREC[op]) apply(ops.pop()!);
      ops.push(op);
    }
    prevSignificant = tk;
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") throw new FormulaError("Unbalanced parentheses.");
    apply(op);
  }
  if (vals.length !== 1) throw new FormulaError("Malformed formula.");
  const r = vals[0];
  if (!Number.isFinite(r)) return 0;
  return r;
}

/** Syntax-check without values — used to validate on save. */
export function validateFormula(src: string): { ok: true } | { ok: false; error: string } {
  try { evalFormula(src, {}); return { ok: true }; }
  catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
}

/** Symbols referenced by a formula, so the UI can prompt for them. */
export function formulaSymbols(src: string): string[] {
  try {
    return [...new Set(tokenize(src ?? "").filter((t) => t.t === "sym").map((t: any) => t.v))];
  } catch { return []; }
}
