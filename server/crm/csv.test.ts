import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";
import { parseCsv } from "./migrate-lib";

describe("CSV spreadsheet safety", () => {
  it.each(["=1+1", "+SUM(1,2)", "-1", "@SUM(A1)", "\t=1", "\r=1", '=HYPERLINK("bad","click")'])
    ("round-trips %j as literal prefixed text", (value) => {
      expect(parseCsv(toCsv(["value"], [[value]])).rows[0][0]).toBe(`'${value}`);
      expect(parseCsv(`value\n${csvCell(value)}\n`).rows[0][0]).toBe(`'${value}`);
    });
  it("preserves ordinary quotes, delimiters and existing apostrophes", () => {
    for (const value of ['a,b', 'a"b', 'a\nb', "'=1", "plain"]) {
      expect(parseCsv(toCsv(["value"], [[value]])).rows[0][0]).toBe(value);
    }
  });
});
