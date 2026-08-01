/**
 * Pure iCal (RFC 5545) primitives for the CRM calendar feed — no database, no
 * Express, so the unit tests can import this module without booting the server
 * stack. server/crm/calendar.ts wires these to the org's appointments.
 */

/** RFC 5545 TEXT escaping: backslash first, then ; , and newlines. */
export function icalEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 line folding: content lines SHOULD NOT exceed 75 octets; fold with
 * CRLF + single space. Byte-wise so a multi-byte UTF-8 character is never
 * split across the fold.
 */
export function icalFold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75; // continuation lines budget one octet for the leading space
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === start) end = Math.min(start + limit, bytes.length); // pathological; never loop
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** UTC basic format: 20260731T201500Z. VTIMEZONE-free by design. */
export function icalDateTimeUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** DATE value for all-day events: 20260731. */
export function icalDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export type ICalEvent = {
  id: string;
  title: string;
  projectName?: string | null;
  customerName?: string | null;
  location?: string | null;
  notes?: string | null;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  arrivalWindowMinutes?: number | null;
  updatedAt?: Date | null;
};

/** The event end: an explicit endsAt wins; otherwise the arrival window. */
export function icalEventEnd(e: ICalEvent): Date {
  return e.endsAt ?? new Date(e.startsAt.getTime() + (e.arrivalWindowMinutes ?? 60) * 60000);
}

/** summary = project + customer, falling back to the appointment title. */
export function icalSummary(e: ICalEvent): string {
  return [e.projectName, e.customerName].filter(Boolean).join(" — ") || e.title;
}

export function icalDescription(e: ICalEvent): string {
  return [
    e.title,
    e.arrivalWindowMinutes
      ? `Arrival window: ${e.arrivalWindowMinutes} minutes from start`
      : null,
    e.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One VEVENT. uid is stable (the appointment id) so subscribers see edits,
 *  not duplicates. dtstart/dtend come from the arrival window: when no explicit
 *  end exists the event spans startsAt → startsAt + arrivalWindowMinutes. */
export function buildVEvent(e: ICalEvent, now: Date): string[] {
  const lines: string[] = ["BEGIN:VEVENT"];
  lines.push(`UID:${e.id}@constructhub-crm`);
  lines.push(`DTSTAMP:${icalDateTimeUtc(now)}`);
  if (e.updatedAt) lines.push(`LAST-MODIFIED:${icalDateTimeUtc(e.updatedAt)}`);

  if (e.allDay) {
    const endDay = e.endsAt ?? e.startsAt;
    // DTEND for DATE values is exclusive — add a day.
    const exclusive = new Date(endDay.getTime() + 86400000);
    lines.push(`DTSTART;VALUE=DATE:${icalDate(e.startsAt)}`);
    lines.push(`DTEND;VALUE=DATE:${icalDate(exclusive)}`);
  } else {
    lines.push(`DTSTART:${icalDateTimeUtc(e.startsAt)}`);
    lines.push(`DTEND:${icalDateTimeUtc(icalEventEnd(e))}`);
  }

  lines.push(`SUMMARY:${icalEscape(icalSummary(e))}`);
  if (e.location) lines.push(`LOCATION:${icalEscape(e.location)}`);
  const description = icalDescription(e);
  if (description) lines.push(`DESCRIPTION:${icalEscape(description)}`);

  lines.push(`STATUS:${e.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  return lines;
}

/** A complete VCALENDAR document, CRLF-joined, 75-octet folded. */
export function buildICalendar(orgName: string, events: ICalEvent[], now = new Date()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ConstructHub CRM//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icalEscape(`${orgName} — ConstructHub CRM`)}`,
  ];
  for (const e of events) lines.push(...buildVEvent(e, now));
  lines.push("END:VCALENDAR");
  return lines.map(icalFold).join("\r\n") + "\r\n";
}
