/** Spreadsheet-safe RFC 4180 encoding. The apostrophe is retained on CSV re-import. */
export type CellValue = string | number | null;

export function csvCell(v: CellValue): string {
  if (v === null || v === undefined) return "";
  const raw = String(v);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CellValue[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

