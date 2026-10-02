import type { PillTone } from "@/components/crm-ui";

/**
 * Types and formatters shared by the Calls tab files (calls.tsx,
 * calls-detail.tsx). OWNER: calls+crm lane (LANES.md). Shapes mirror the
 * JSON server/voice/calls.ts answers.
 */

export type VoiceCallListRow = {
  id: string;
  numberId: string | null;
  callSid: string;
  direction: string;
  fromNumber: string | null;
  toNumber: string | null;
  persona: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  billedMinutes: number | null;
  outcome: string | null;
  callerName: string | null;
  callerCity: string | null;
  serviceNeeded: string | null;
  summary: string | null;
  recordingKey: string | null;
  recordingSeconds: number | null;
  customerId: string | null;
  projectId: string | null;
  leadDeliveredAt: string | null;
  spamConfidence: number | null;
  spamReason: string | null;
  hasRecording: boolean;
};

export type VoiceCallList = { calls: VoiceCallListRow[]; total: number; page: number; limit: number };

export type VoiceEscalation = {
  id: number;
  orgId: string;
  callId: string | null;
  kind: string;
  kindLabel: string;
  ruleId: string | null;
  channel: "sms" | "email" | string;
  recipient: string;
  recipientName: string | null;
  body: string;
  sentCount: number;
  lastSentAt: string | null;
  confirmedAt: string | null;
  replyText: string | null;
  followupSentAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  lastError: string | null;
  createdAt: string | null;
  state: "waiting" | "confirmed" | "followed_up" | "closed";
};

export type VoiceTranscriptTurn = { role: "caller" | "assistant" | "system"; text: string; t?: string };

export type VoiceCallDetail = VoiceCallListRow & {
  model: string | null;
  engine: string | null;
  profileVersion: number | null;
  callerEmail: string | null;
  callerAddress: string | null;
  transcript: VoiceTranscriptTurn[];
  slots: Record<string, string> | null;
  recordingUrl: string | null;
  customer: { id: string; displayName: string; phone: string | null; email: string | null; city: string | null } | null;
  project: { id: string; name: string; status: string } | null;
  number: { id: string; label: string | null; phoneNumber: string; location: string | null } | null;
  escalations: VoiceEscalation[];
};

export type VoiceSpamEntry = {
  id: number;
  phoneNumber: string;
  strikes: number;
  calls: number;
  lastConfidence: number | null;
  lastReason: string | null;
  lastCallId: string | null;
  blockedAt: string | null;
  unblockedAt: string | null;
  blockedBy: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  blocked: boolean;
};

/** Every outcome the engine reports (shared/voice-profile.ts CALL_OUTCOMES), in the order the filter lists them. */
export const OUTCOME_LABELS: Record<string, string> = {
  lead_submitted: "Lead",
  booked: "Booked",
  alerted: "Escalated",
  info: "Info only",
  declined: "Declined",
  out_of_area: "Out of area",
  voicemail: "Voicemail",
  hangup: "Hung up",
  error: "Error",
  spam: "Spam",
  blocked: "Blocked",
};

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return "In progress";
  return OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, " ");
}

export function outcomeTone(outcome: string | null | undefined): PillTone {
  switch (outcome) {
    case "lead_submitted":
    case "booked":
      return "success";
    case "alerted":
      return "warning";
    case "info":
    case "voicemail":
      return "info";
    case "spam":
    case "blocked":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

/** "(813) 555-0100" for a US number, the raw value otherwise. */
export function fmtPhone(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : raw || "Unknown number";
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/**
 * Server timestamps are UTC wall time without a zone (the CRM's convention):
 * read them as UTC, show them in the viewer's local time.
 */
export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtWhen(value: string | null | undefined): string {
  const d = parseServerTime(value);
  if (!d) return "—";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `Today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
