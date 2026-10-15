/**
 * A small .xlsx reader for the state bulk files of group g1 (NJ Department of Labor lists). Reads one worksheet's
 * cells as text: shared strings, inline strings and numbers. Dates come back as Excel serial numbers ("45478"); the
 * caller converts the columns it knows are dates with excelDate(). Uses the system unzip, like ../../bulk-sources.ts.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { decodeEntities } from "../../bulk-sources";

const run = promisify(execFile);

const text = (xml: string) => decodeEntities(Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) => m[1]).join(""));

/** "AB12" → 27 (zero-based column index). */
export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Rows of cells from worksheet XML, given the shared-string table. */
export function sheetRows(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const r of Array.from(sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g))) {
    const row: string[] = [];
    for (const c of Array.from(r[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const attrs = c[1], body = c[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v != null) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = text(body);
      else if (v != null) value = decodeEntities(v);
      const i = ref ? columnIndex(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = value;
    }
    rows.push(row);
  }
  return rows;
}

/** Every row of the first worksheet (or the one named), as text cells. Deletes nothing: the caller owns `path`. */
export async function readXlsx(path: string, sheet = 1): Promise<string[][]> {
  const dir = await fs.mkdtemp(join(tmpdir(), "ch-xlsx-"));
  try {
    await run("unzip", ["-q", "-o", path, "xl/sharedStrings.xml", `xl/worksheets/sheet${sheet}.xml`, "-d", dir], { maxBuffer: 1 << 20 })
      .catch(async (err) => { // a workbook without shared strings
        if (!(await fs.stat(join(dir, "xl", "worksheets", `sheet${sheet}.xml`)).catch(() => null))) throw err;
      });
    const sst = await fs.readFile(join(dir, "xl", "sharedStrings.xml"), "utf8").catch(() => "");
    const shared = Array.from(sst.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => text(m[1]));
    return sheetRows(await fs.readFile(join(dir, "xl", "worksheets", `sheet${sheet}.xml`), "utf8"), shared);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** An Excel serial day number (1900 date system) → YYYY-MM-DD; anything else → null. */
export function excelDate(v: string | null | undefined): string | null {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n < 1 || n > 80000) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}
