/**
 * Read the first sheet of a plain .xlsx file (shared strings and inline strings, no formulas) into rows keyed by the
 * header row. Uses Info-ZIP's unzip, which ./bulk-sources.ts already relies on.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { decodeEntities } from "../../bulk-sources";

const run = promisify(execFile);

const unzipMember = async (path: string, member: string): Promise<string> => {
  try { return (await run("unzip", ["-p", path, member], { maxBuffer: 512 << 20 })).stdout; }
  catch (err: any) { if (/filename not matched/i.test(String(err?.stderr ?? err))) return ""; throw err; }
};

const colIndex = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/** Parse sheet XML with its shared strings into rows of cell text (by column position). */
export function sheetRows(sheetXml: string, sharedXml: string): string[][] {
  const shared = Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => decodeEntities(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join("")));
  const rows: string[][] = [];
  for (const r of Array.from(sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g))) {
    const row: string[] = [];
    for (const c of Array.from(r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const type = c[1].match(/\bt="([^"]+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = c[2]?.match(/<is>([\s\S]*?)<\/is>/)?.[1];
      const text = type === "s" && v != null ? shared[Number(v)] ?? "" : inline != null ? decodeEntities(inline.replace(/<[^>]+>/g, "")) : v != null ? decodeEntities(v) : "";
      row[colIndex(ref)] = text;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

/** The first sheet as objects keyed by its header row. */
export async function xlsxRecords(path: string): Promise<Record<string, string>[]> {
  const rows = sheetRows(await unzipMember(path, "xl/worksheets/sheet1.xml"), await unzipMember(path, "xl/sharedStrings.xml"));
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
