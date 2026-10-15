/**
 * A minimal reader for the first worksheet of an .xlsx file (shared and inline strings, numbers as text), enough for
 * the licensee reports some boards publish as Excel. Uses the system `unzip`, like ../../bulk-sources.ts.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, "&");

async function member(path: string, name: string): Promise<string | null> {
  try { return (await run("unzip", ["-p", path, name], { maxBuffer: 512 << 20, encoding: "utf8" })).stdout; }
  catch { return null; }
}

/** Column letters → 0-based index ("A" → 0, "AB" → 27). */
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** Rows of the first sheet as arrays of strings ("" for an empty cell), in sheet order. */
export async function xlsxRows(path: string): Promise<string[][]> {
  const shared: string[] = [];
  const sst = await member(path, "xl/sharedStrings.xml");
  if (sst) for (const si of Array.from(sst.matchAll(/<si>([\s\S]*?)<\/si>/g))) {
    shared.push(decode(Array.from(si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join("")));
  }
  const sheet = await member(path, "xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("no first worksheet in the workbook");
  const rows: string[][] = [];
  for (const row of Array.from(sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g))) {
    const out: string[] = [];
    for (const c of Array.from(row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const inner = c[2] ?? "";
      let v = "";
      if (type === "s") v = shared[Number(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? -1)] ?? "";
      else if (type === "inlineStr") v = decode(Array.from(inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join(""));
      else v = decode(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? "");
      const i = ref ? colIndex(ref) : out.length;
      while (out.length < i) out.push("");
      out[i] = v;
    }
    rows.push(out);
  }
  return rows;
}
