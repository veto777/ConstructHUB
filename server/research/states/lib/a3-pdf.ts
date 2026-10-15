/**
 * Text of a PDF for the parsers of PDF-only sources (AL, AR, OK, SC, TN): `pdftotext -layout` when the binary is on
 * the PATH (poppler; on vb11 a user-space wrapper on the service PATH), else the pure-JS reader in ./g6-pdf.ts laid
 * out the same way: one text line per visual line, runs placed at their x position in character columns. So a load
 * still works without the binary. Parsers should match on content (labels, dates, case numbers), not exact columns:
 * the two layouts agree on line order and word order, not on spacing.
 *
 * A scanned PDF (images, no text layer) gives "" either way; callers skip it and count it, never guess.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pdfLines, pdfTextRuns } from "./g6-pdf";

const run = promisify(execFile);

export type PdfTextResult = { text: string; via: "pdftotext" | "js" };

let noBinary = false;

/** The PDF's text, page by page (pages separated by a form feed, as pdftotext writes them). */
export async function pdfText(buf: Uint8Array): Promise<PdfTextResult> {
  if (!noBinary && process.env.RESEARCH_PDF_JS !== "1") {
    const path = join(tmpdir(), `ch-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    try {
      await fs.writeFile(path, buf);
      const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], { maxBuffer: 128 << 20, timeout: 120_000 });
      return { text: stdout, via: "pdftotext" };
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw new Error(`pdftotext failed: ${String(err?.message ?? err).slice(0, 200)}`);
      noBinary = true;
    } finally {
      await fs.rm(path, { force: true });
    }
  }
  return { text: jsLayoutText(buf), via: "js" };
}

/** The JS reader's runs as layout text: lines top to bottom, each run at column x / (half its font size). */
export function jsLayoutText(buf: Uint8Array): string {
  let runs;
  try { runs = pdfTextRuns(buf); } catch { return ""; }
  const out: string[] = [];
  let page = 0;
  for (const line of pdfLines(runs)) {
    if (line[0].page !== page) { if (page) out.push("\f"); page = line[0].page; }
    let s = "";
    let end = -Infinity; // where the previous run ends, estimated from its length (half the font size a character)
    for (const r of line) {
      const cw = Math.max(1, r.size * 0.5);
      // A run that starts where the previous one ends continues its word (PDFs split words into runs freely).
      if (r.x - end < cw * 0.6 && s.length) s += r.text;
      else {
        const col = Math.round(r.x / cw);
        if (s.length < col) s += " ".repeat(col - s.length);
        else if (s.length && !s.endsWith(" ")) s += " ";
        s += r.text;
      }
      end = r.x + r.text.length * cw * 0.95;
    }
    out.push(s.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** Text lines with page breaks removed. */
export const textLines = (text: string): string[] => text.replace(/\f/g, "\n").split(/\r?\n/);
