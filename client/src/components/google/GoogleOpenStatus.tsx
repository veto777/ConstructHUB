import type { ReactNode } from "react";

/**
 * Google's status line: "Open · 10810 US Highway 19 North" (Open in green, Closed in red). `open` null means
 * we do not know — then only the address shows. Nothing here is ever assumed.
 */
export function GoogleOpenStatus({ open, hours, address, closedLabel, openLabel, title, testId }: {
  open: boolean | null;
  /** A short hours note shown after the status, e.g. "Closes 5 PM". */
  hours?: string | null;
  address?: ReactNode;
  openLabel?: string;
  closedLabel?: string;
  title?: string;
  testId?: string;
}) {
  const parts: ReactNode[] = [];
  if (open === true) parts.push(<span key="status" className="g-open" title={title}>{openLabel ?? "Open"}{hours ? <span className="g-text-2"> · {hours}</span> : null}</span>);
  else if (open === false) parts.push(<span key="status" className="g-closed" title={title}>{closedLabel ?? "Closed"}{hours ? <span className="g-text-2"> · {hours}</span> : null}</span>);
  if (address) parts.push(<span key="address">{address}</span>);
  if (!parts.length) return null;
  return (
    <p className="g-card__line" data-testid={testId}>
      {parts.map((p, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>)}
    </p>
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8:00 AM" / "5 PM" / "17:00" → minutes since midnight, or null when the text is not a clock time. */
function parseClock(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?\s*$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Derives "open now" from the Google hours we synced ({Monday: "8:00 AM – 5:00 PM", …}, "Closed",
 * "Open 24 hours"), judged on the viewer's clock. Returns `null` whenever the stored hours cannot be read,
 * so the card omits the status rather than guessing. `hint` is the "Closes 5:00 PM" / "Opens 8:00 AM" note.
 */
export function openNowFromHours(hours: unknown, now = new Date()): { open: boolean; hint: string | null; today: string } | null {
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return null;
  const h = hours as Record<string, unknown>;
  const day = WEEKDAYS[now.getDay()];
  const raw = h[day];
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (/^closed$/i.test(text)) return { open: false, hint: null, today: text };
  if (/open 24 hours/i.test(text)) return { open: true, hint: "Open 24 hours", today: text };
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Several ranges a day ("8:00 AM – 12:00 PM, 1:00 PM – 5:00 PM") are each checked.
  const ranges = text.split(/\s*,\s*/).map((r) => r.split(/\s*[–—-]\s*/));
  if (ranges.some((r) => r.length !== 2)) return null;
  const parsed = ranges.map(([a, b]) => [parseClock(a), parseClock(b)] as const);
  if (parsed.some(([a, b]) => a == null || b == null)) return null;
  for (let i = 0; i < parsed.length; i++) {
    const [start, end] = parsed[i] as [number, number];
    const closesNextDay = end <= start;
    const inRange = closesNextDay ? minutes >= start || minutes < end : minutes >= start && minutes < end;
    if (inRange) return { open: true, hint: `Closes ${ranges[i][1].trim()}`, today: text };
    if (minutes < start) return { open: false, hint: `Opens ${ranges[i][0].trim()}`, today: text };
  }
  return { open: false, hint: null, today: text };
}
