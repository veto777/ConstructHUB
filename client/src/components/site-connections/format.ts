const numbers = new Intl.NumberFormat("en-US");
/** Counts from provider APIs may arrive as numeric strings. Missing data is never zero. */
export function formatNumber(
  value: unknown,
  unavailable = "Unavailable",
  fractionDigits?: number,
): string {
  if (
    value == null ||
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  ) return unavailable;
  const number = Number(value);
  if (!Number.isFinite(number)) return unavailable;
  const formatter = fractionDigits == null ? numbers : new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return formatter.format(number);
}
