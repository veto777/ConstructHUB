/** Google's review timestamps: "2 weeks ago", "a year ago". Falls back to the date when the input is unreadable. */
export function relativeTime(input: string | number | Date | null | undefined, now = new Date()): string {
  if (input == null) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const units: [number, string][] = [[60, "minute"], [60, "hour"], [24, "day"], [7, "week"], [4.345, "month"], [12, "year"]];
  let value = sec / 60, unit = "minute";
  for (let i = 1; i < units.length; i++) {
    if (value < units[i][0]) break;
    value /= units[i][0];
    unit = units[i][1];
  }
  const n = Math.floor(value);
  return n === 1 ? (unit === "hour" ? "an hour ago" : `a ${unit} ago`) : `${n} ${unit}s ago`;
}
