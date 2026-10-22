/**
 * Client behaviour on the public estimate/invoice pages — what they read and
 * what they clicked, per visit. The page tags elements with `data-track`
 * (a click = one event, value = event name, optional `data-track-detail`) and
 * `data-track-section` (seconds on screen); the tracker
 * (client/src/components/engagement-tracker.tsx) beacons them to
 * POST /api/public/engagement/events, which stores them in
 * crm_engagement_events against the engagement session. This module is the
 * shared vocabulary: what a name is allowed to be, and how a visit's events
 * read back to the contractor ("Read Warranty — 42s").
 */

/** Event names are short snake_case; anything else is refused at the door. */
export const TRACK_NAME_RE = /^[a-z0-9_]{1,40}$/;
/** One beacon carries at most this many events. */
export const TRACK_MAX_EVENTS_PER_POST = 40;
/** A session stores at most this many rows (section/scroll rows are upserted, so this is clicks). */
export const TRACK_MAX_ROWS_PER_SESSION = 600;
/** A detail string longer than this is cut. */
export const TRACK_MAX_DETAIL_CHARS = 160;
/** Sessions this old no longer accept events. */
export const TRACK_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Rows that hold a running total (one row per session+key, upserted with the max). */
export const TRACK_CUMULATIVE = new Set(["section_time", "scroll_depth"]);

export type TrackEventIn = {
  name: string;
  /** Free text from data-track-detail (offer code, file name, tab label…). */
  detail?: string | null;
  /** section_time: which section; its running seconds go in `secs`. */
  section?: string | null;
  secs?: number | null;
  /** scroll_depth: max % of the page scrolled. */
  pct?: number | null;
  /** page_view: which page and what device. */
  page?: string | null;
  device?: string | null;
  /** ms since the session started (client clock). */
  t: number;
};

export type StoredTrackEvent = {
  sessionId: string;
  name: string;
  detail: Record<string, any> | null;
  tMs: number;
};

export type VisitSession = {
  id: string;
  startedAt: Date | string | null;
  durationSecs: number | null;
  userAgent?: string | null;
};

export type VisitSummary = {
  readTerms: boolean;
  termsSecs: number;
  pamphlets: boolean;
  model3d: boolean;
  discountsViewed: boolean;
  approveStarted: boolean;
  scrollPct: number | null;
  device: string | null;
};

export type VisitLine = { offsetSecs: number; text: string; name: string };

export type VisitDetail = { summary: VisitSummary; lines: VisitLine[] };

const SECTION_LABELS: Record<string, string> = {
  letterhead: "the letterhead / company details",
  headline: "the warranty headline",
  scopes: "the scope of work",
  totals: "the totals",
  warranty: "Warranty",
  terms: "Terms & Conditions",
  discounts: "Optional discounts",
  upsell: "the extra-scope offer",
  contact: "the contact details",
  attachments: "the attached documents (pamphlets)",
  photos: "the photos",
  model3d: "the 3D model of their home",
  financing: "financing",
  approve: "the approve / sign section",
  questions: "the ask-a-question box",
  payment: "the payment section",
};

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function sectionLabel(section: string): string {
  if (SECTION_LABELS[section]) return SECTION_LABELS[section];
  if (section.startsWith("scope:")) return `the “${section.slice(6).trim()}” scope`;
  if (section === "model3d_card") return "the 3D model card";
  const opt = /^option[-_](.+)$/.exec(section);
  if (opt) return `Option ${humanize(opt[1])}`;
  return humanize(section);
}

const OFFER_LABELS: Record<string, string> = {
  pay_in_full: "Pay-in-full", payinfull: "Pay-in-full", marketing: "Marketing", military: "Military",
  bundle: "Bundle", price_match: "Price match", pricematch: "Price match", senior: "Senior",
};
/** "pay_in_full:on" → { label: "Pay-in-full", on: true }. Unknown codes read humanized. */
export function parseOfferDetail(detail: string | null | undefined): { label: string; on: boolean | null } {
  const raw = String(detail ?? "").trim();
  const [code, state] = raw.split(/[:|=]/);
  const key = (code ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const label = OFFER_LABELS[key] ?? (key ? cap(humanize(key)) : "a");
  const s = (state ?? "").toLowerCase();
  return { label, on: s === "on" || s === "1" || s === "true" ? true : s === "off" || s === "0" || s === "false" ? false : null };
}

export function formatSecs(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/** "iPhone · Safari", "Windows · Chrome", "Android phone · Chrome" — from a user-agent. */
export function deviceFromUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Android phone" : "Android tablet")
    : /Windows/.test(ua) ? "Windows computer"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux computer"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /FxiOS|Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  if (/FBAN|FBAV|Instagram/.test(ua)) return [os, "Facebook app"].filter(Boolean).join(" · ") || null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}

/** One click/open event as a plain-English line; null = not worth a line. */
export function eventLine(name: string, detail: Record<string, any> | null): string | null {
  const d = typeof detail?.d === "string" ? detail.d : null;
  switch (name) {
    case "page_view":
      return detail?.page === "terms" ? "Opened the Terms & Conditions page"
        : detail?.page === "invoice" ? "Opened the invoice"
        : "Opened the estimate";
    case "terms_open": return "Clicked through to the Terms & Conditions";
    case "warranty_open": return "Clicked “Read the full warranty”";
    case "attachment_open": return `Opened the attached document${d ? ` “${d}”` : ""}`;
    case "model3d_open": return "Opened the 3D model of their home";
    case "model3d_tab": return `Switched the 3D viewer to ${d ? `“${d}”` : "another tab"}`;
    case "model3d_interact": return "Spun / zoomed the 3D model";
    case "option_tab": return `Looked at ${d ? `“${d}”` : "another option"}`;
    case "scope_toggle": return d ? `Ticked/unticked the scope “${d}”` : "Ticked/unticked a scope";
    case "discounts_open": return "Opened the discounts list";
    case "discount_toggle": {
      const o = parseOfferDetail(d);
      return o.on === false ? `Unticked the ${o.label} discount` : `Ticked the ${o.label} discount`;
    }
    case "discount_info": return `Clicked ⓘ on ${parseOfferDetail(d).label}`;
    case "upsell_view": return `Saw the offer to quote ${d ?? "another scope"}`;
    case "upsell_click": return `Asked for a ${d ?? "new"} bid`;
    case "info_click": return `Clicked ⓘ / Learn more${d ? ` on “${d}”` : ""}`;
    case "pdf_download": return "Downloaded the PDF";
    case "print": return "Printed the estimate";
    case "contact_call": return `Tapped to call${d ? ` ${d}` : ""}`;
    case "contact_email": return `Tapped to email${d ? ` ${d}` : ""}`;
    case "contact_text": return `Tapped to text${d ? ` ${d}` : ""}`;
    case "approve_open": return d ? `Started signing (${d})` : "Clicked Approve (started signing)";
    case "approve_cancel": return "Closed the approve box without signing";
    case "approve_submit": return "Signed / approved";
    case "decline_open": return "Clicked Decline";
    case "share_open": return "Opened “Share this estimate”";
    case "question_open": return "Started writing a question";
    case "question_send": return "Sent a question";
    case "share_send": return "Shared the estimate with someone";
    case "pay_click": return `Clicked Pay${d ? ` (${d})` : ""}`;
    case "financing_open": return `Opened financing${d ? ` (${d})` : ""}`;
    case "pay_open": return "Opened the payment section";
    case "photo_open": return `Opened a photo${d ? ` (${d})` : ""}`;
    case "back_to_estimate": return "Went back to the estimate";
    case "section_time": case "scroll_depth": return null;
    default: return cap(humanize(name)) + (d ? ` (${d})` : "");
  }
}

const startMs = (s: VisitSession) => (s.startedAt ? new Date(s.startedAt).getTime() : 0);

/**
 * One visit (one or more page sessions close together — the estimate page,
 * then its Terms page) → the summary chips and the timeline lines.
 * `approved` = the estimate was signed during this visit.
 */
export function buildVisitDetail(
  sessions: VisitSession[], events: StoredTrackEvent[], opts: { approved?: boolean } = {},
): VisitDetail {
  const ordered = [...sessions].sort((a, b) => startMs(a) - startMs(b));
  const visitStart = ordered.length ? startMs(ordered[0]) : 0;
  const sessStart = new Map(ordered.map((s) => [s.id, startMs(s)]));
  const lines: VisitLine[] = [];
  const at = (e: StoredTrackEvent) =>
    Math.max(0, Math.round(((sessStart.get(e.sessionId) ?? visitStart) - visitStart + Math.max(0, e.tMs)) / 1000));

  const summary: VisitSummary = {
    readTerms: false, termsSecs: 0, pamphlets: false, model3d: false, discountsViewed: false,
    approveStarted: false, scrollPct: null,
    device: deviceFromUserAgent(ordered.find((s) => s.userAgent)?.userAgent),
  };

  // Section time: one line per section, at the moment it first came on screen.
  const sectionSecs = new Map<string, { secs: number; first: number }>();
  let termsPageSecs = 0;
  const termsSessions = new Set<string>();
  for (const e of events) {
    if (e.name === "page_view" && e.detail?.page === "terms") termsSessions.add(e.sessionId);
    if (e.name === "page_view" && typeof e.detail?.device === "string" && !summary.device) summary.device = e.detail.device;
  }
  for (const s of ordered) if (termsSessions.has(s.id)) termsPageSecs += s.durationSecs ?? 0;

  let approveOpen = false, approveDone = !!opts.approved, lastApproveAt = 0;
  for (const e of events) {
    const off = at(e);
    if (e.name === "section_time") {
      const sec = String(e.detail?.section ?? "");
      const secs = Number(e.detail?.secs ?? 0);
      if (!sec || !(secs > 0)) continue;
      const cur = sectionSecs.get(sec);
      if (!cur || secs > cur.secs) sectionSecs.set(sec, { secs: Math.max(secs, cur?.secs ?? 0), first: cur?.first ?? off });
      continue;
    }
    if (e.name === "scroll_depth") {
      const pct = Number(e.detail?.pct ?? 0);
      if (termsSessions.has(e.sessionId)) continue;
      if (pct >= 0) summary.scrollPct = Math.max(summary.scrollPct ?? 0, Math.min(100, Math.round(pct)));
      continue;
    }
    if (e.name === "terms_open") summary.readTerms = true;
    if (e.name === "attachment_open") summary.pamphlets = true;
    if (e.name.startsWith("model3d")) summary.model3d = true;
    if (e.name.startsWith("discount")) summary.discountsViewed = true;
    if (e.name === "approve_open") { approveOpen = true; summary.approveStarted = true; lastApproveAt = off; }
    if (e.name === "approve_submit") approveDone = true;
    if (e.name === "approve_cancel") lastApproveAt = off;
    let text = eventLine(e.name, e.detail);
    if (!text) continue;
    if (e.name === "page_view" && e.detail?.page === "terms") {
      const termsScroll = events.filter((x) => x.sessionId === e.sessionId && x.name === "scroll_depth")
        .reduce((m, x) => Math.max(m, Number(x.detail?.pct ?? 0)), 0);
      const secs = ordered.find((s) => s.id === e.sessionId)?.durationSecs ?? 0;
      text = `Opened Terms & Conditions — ${formatSecs(secs)}${termsScroll ? `, scrolled ${Math.round(termsScroll)}%` : ""}`;
    }
    lines.push({ offsetSecs: off, text, name: e.name });
  }
  for (const [sec, v] of Array.from(sectionSecs.entries())) {
    if (v.secs < 2) continue;
    if (sec === "terms") summary.termsSecs += v.secs;
    if (sec === "discounts" && v.secs >= 2) summary.discountsViewed = true;
    if (sec === "model3d") summary.model3d = true;
    lines.push({ offsetSecs: v.first, text: `Read ${sectionLabel(sec)} — ${formatSecs(v.secs)}`, name: "section_time" });
  }
  summary.termsSecs += termsPageSecs;
  if (termsSessions.size) summary.readTerms = true;
  if (approveOpen && !approveDone) {
    lines.push({ offsetSecs: lastApproveAt, text: "Started approving, then backed out", name: "approve_abandoned" });
  }
  if (summary.scrollPct != null) {
    const end = ordered.reduce((m, s) => Math.max(m, Math.round((startMs(s) - visitStart) / 1000) + (s.durationSecs ?? 0)), 0);
    lines.push({ offsetSecs: end, text: `Scrolled ${summary.scrollPct}% of the estimate`, name: "scroll_depth" });
  }
  lines.sort((a, b) => a.offsetSecs - b.offsetSecs || (a.name === "page_view" ? -1 : b.name === "page_view" ? 1 : 0));
  return { summary, lines };
}

/** A visit = sessions on the same document that start within this gap of the previous one ending. */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Group one document's sessions into visits (oldest first inside each group; groups newest first). */
export function groupSessionsIntoVisits<S extends VisitSession & { lastPingAt?: Date | string | null }>(sessions: S[]): S[][] {
  const asc = [...sessions].sort((a, b) => startMs(a) - startMs(b));
  const groups: S[][] = [];
  let lastEnd = -Infinity;
  for (const s of asc) {
    const st = startMs(s);
    const end = Math.max(st + (s.durationSecs ?? 0) * 1000, s.lastPingAt ? new Date(s.lastPingAt).getTime() : st);
    if (groups.length && st - lastEnd <= VISIT_GAP_MS) {
      groups[groups.length - 1].push(s);
      lastEnd = Math.max(lastEnd, end);
    } else {
      groups.push([s]);
      lastEnd = end;
    }
  }
  return groups.reverse();
}

/** Roll several visits' summaries into one (the per-estimate line). */
export function mergeSummaries(list: VisitSummary[]): VisitSummary {
  return list.reduce<VisitSummary>((m, s) => ({
    readTerms: m.readTerms || s.readTerms,
    termsSecs: m.termsSecs + s.termsSecs,
    pamphlets: m.pamphlets || s.pamphlets,
    model3d: m.model3d || s.model3d,
    discountsViewed: m.discountsViewed || s.discountsViewed,
    approveStarted: m.approveStarted || s.approveStarted,
    scrollPct: s.scrollPct == null ? m.scrollPct : Math.max(m.scrollPct ?? 0, s.scrollPct),
    device: m.device ?? s.device,
  }), {
    readTerms: false, termsSecs: 0, pamphlets: false, model3d: false, discountsViewed: false,
    approveStarted: false, scrollPct: null, device: null,
  });
}
