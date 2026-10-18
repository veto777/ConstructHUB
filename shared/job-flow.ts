/**
 * The job flow (owner, 2026-10-18): the six built-in stages of shared/job-stage.ts are the starting point, and an
 * account can add as many phases of its own as it needs ("Deposit received", "Materials ordered", …), rename and
 * reorder them, and attach alerts to any phase — an email or a text to the client or to a staff member, sent the
 * moment a job enters that phase (by hand on the tracker or by one of the automatic moves).
 *
 * Stored in crm_orgs.custom_fields.jobFlow = { phases: [{ key, label, builtin?, alerts: [...] }] }. Always read
 * through `normalizeJobFlow`, which is pure and forgiving: the six built-in phases ("anchors") are always present,
 * always in their relative order (Bid … Closed out), never removed — the automatic moves, the punch list (from
 * Job Scheduled on) and the Google Reviews list (Closed out) all rely on them. Custom phases sit between the anchors
 * wherever the owner put them.
 *
 * Per project a custom phase is `crm_projects.stage_key`; a built-in phase is still derived from the project status
 * (`jobStageOf`). `currentPhaseKey` combines the two for the tracker.
 */
import { JOB_STAGES, STAGE_PROJECT_STATUS, stageIndex, type JobStage } from "./job-stage";

export type FlowRecipient = "client" | "staff";
export type FlowChannel = "email" | "sms";
/** Who on the team: the project's PM, its sales rep, the owner(s), or one named member (their member id). */
export type FlowStaff = "pm" | "sales" | "owner" | (string & {});
export type FlowAlert = { to: FlowRecipient; staff?: FlowStaff; channel: FlowChannel; template: string };
export type FlowPhase = { key: string; label: string; builtin?: JobStage; alerts: FlowAlert[] };
export type JobFlow = { phases: FlowPhase[] };

export const MAX_FLOW_PHASES = 30;
export const MAX_PHASE_ALERTS = 8;
export const MAX_PHASE_LABEL = 40;
export const MAX_ALERT_TEMPLATE = 600;

/** One-click phases offered in Settings → Job flow. */
export const FLOW_SUGGESTIONS: { key: string; label: string; after: JobStage }[] = [
  { key: "deposit_received", label: "Deposit received", after: "approved" },
  { key: "materials_ordered", label: "Materials ordered", after: "approved" },
  { key: "permit_approved", label: "Permit approved", after: "approved" },
  { key: "crew_assigned", label: "Crew assigned", after: "job_scheduled" },
  { key: "inspection_passed", label: "Inspection passed", after: "in_progress" },
  { key: "final_payment", label: "Final payment", after: "in_progress" },
  { key: "warranty_follow_up", label: "Warranty follow-up", after: "closed_out" },
  { key: "review_requested", label: "Review requested", after: "closed_out" },
];

/** What a template may contain. */
export const FLOW_PLACEHOLDERS: { token: string; meaning: string }[] = [
  { token: "{client}", meaning: "the client's full name" },
  { token: "{first}", meaning: "the client's first name" },
  { token: "{job}", meaning: "the job's name" },
  { token: "{phase}", meaning: "the phase it just entered" },
  { token: "{company}", meaning: "your company name" },
  { token: "{date}", meaning: "today's date" },
];

export function defaultAlertTemplate(to: FlowRecipient, channel: FlowChannel): string {
  if (to === "client") {
    return channel === "sms"
      ? "Hi {first}, good news — your {job} is now at {phase}. Reply here with any questions."
      : "Hi {first},\n\nA quick update from {company}: your {job} has moved to {phase} as of {date}.\n\nReply to this email with any questions — we're happy to help.";
  }
  return channel === "sms"
    ? "{client}'s {job} is now at {phase} ({date})."
    : "{client}'s {job} moved to {phase} on {date}. Open the client in the CRM for the details.";
}

export const newFlowAlert = (to: FlowRecipient = "client", channel: FlowChannel = "email"): FlowAlert =>
  ({ to, ...(to === "staff" ? { staff: "pm" } : {}), channel, template: defaultAlertTemplate(to, channel) });

const BUILTIN = new Set<string>(JOB_STAGES.map((s) => s.key));
export const isBuiltinKey = (k: unknown): k is JobStage => typeof k === "string" && BUILTIN.has(k);

export const DEFAULT_JOB_FLOW: JobFlow = { phases: JOB_STAGES.map((s) => ({ key: s.key, label: s.label, builtin: s.key, alerts: [] })) };

const KEY_RE = /^[a-z0-9_]{1,40}$/;
const MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A key for a new custom phase from its label: "Materials ordered" → "materials_ordered"; never a built-in key. */
export function phaseKeyOf(label: string, taken: string[] = []): string {
  let base = label.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "phase";
  if (BUILTIN.has(base)) base = `${base}_custom`;
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

const cleanLabel = (v: unknown, fallback: string) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_PHASE_LABEL) : "";
  return s || fallback;
};

function normalizeAlert(raw: unknown): FlowAlert | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Partial<FlowAlert> | null;
  if (!r) return null;
  if (r.to !== "client" && r.to !== "staff") return null;
  if (r.channel !== "email" && r.channel !== "sms") return null;
  const to: FlowRecipient = r.to, channel: FlowChannel = r.channel;
  const template = (typeof r.template === "string" ? r.template.trim().slice(0, MAX_ALERT_TEMPLATE) : "") || defaultAlertTemplate(to, channel);
  if (to === "client") return { to, channel, template };
  const staff = typeof r.staff === "string" && (r.staff === "pm" || r.staff === "sales" || r.staff === "owner" || MEMBER_ID_RE.test(r.staff)) ? r.staff : "pm";
  return { to, staff, channel, template };
}

/**
 * A stored flow made whole (pure): bad phases and unknown shapes dropped, keys deduplicated (first wins), the six
 * anchors always present in order with the custom phases interleaved where they were (each custom phase stays
 * after the last anchor that preceded it), labels trimmed, alerts normalized, at most MAX_FLOW_PHASES phases.
 */
export function normalizeJobFlow(raw: unknown): JobFlow {
  const r = (raw && typeof raw === "object" ? raw : {}) as { phases?: unknown };
  const list = Array.isArray(r.phases) ? r.phases : [];
  const seen = new Set<string>();
  const anchors = new Map<JobStage, FlowPhase>();
  // Custom phases bucketed by the anchor they follow (-1 = before Bid).
  const customAfter = new Map<number, FlowPhase[]>();
  let lastAnchor = -1;
  for (const item of list) {
    const p = (item && typeof item === "object" ? item : null) as Partial<FlowPhase> | null;
    if (!p || typeof p.key !== "string") continue;
    const key = p.key.trim();
    if (!KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const alerts = (Array.isArray(p.alerts) ? p.alerts : []).map(normalizeAlert).filter((a): a is FlowAlert => !!a).slice(0, MAX_PHASE_ALERTS);
    if (isBuiltinKey(key)) {
      const label = cleanLabel(p.label, JOB_STAGES.find((s) => s.key === key)!.label);
      anchors.set(key, { key, label, builtin: key, alerts });
      lastAnchor = Math.max(lastAnchor, stageIndex(key));
    } else {
      const bucket = customAfter.get(lastAnchor) ?? [];
      bucket.push({ key, label: cleanLabel(p.label, key.replace(/_/g, " ")), alerts });
      customAfter.set(lastAnchor, bucket);
    }
  }
  const phases: FlowPhase[] = [...(customAfter.get(-1) ?? [])];
  JOB_STAGES.forEach((s, i) => {
    phases.push(anchors.get(s.key) ?? { key: s.key, label: s.label, builtin: s.key, alerts: [] });
    phases.push(...(customAfter.get(i) ?? []));
  });
  // Over the cap: custom phases go first (the anchors never do), from the end.
  while (phases.length > MAX_FLOW_PHASES) {
    const i = phases.map((p) => !p.builtin).lastIndexOf(true);
    if (i < 0) break;
    phases.splice(i, 1);
  }
  return { phases };
}

/** The built-in keys a raw flow leaves out — the API refuses to save such a flow (anchors cannot be removed). */
export function missingAnchors(raw: unknown): JobStage[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as { phases?: unknown };
  const keys = new Set((Array.isArray(r.phases) ? r.phases : []).map((p: any) => (p && typeof p === "object" ? p.key : null)));
  return JOB_STAGES.map((s) => s.key).filter((k) => !keys.has(k));
}

export const isDefaultJobFlow = (flow: JobFlow) => JSON.stringify(flow) === JSON.stringify(DEFAULT_JOB_FLOW);

export const phaseIndex = (flow: JobFlow, key: string | null | undefined): number => (key ? flow.phases.findIndex((p) => p.key === key) : -1);
export const phaseOf = (flow: JobFlow, key: string | null | undefined): FlowPhase | null => flow.phases.find((p) => p.key === key) ?? null;
export const phaseLabel = (flow: JobFlow, key: string | null | undefined): string | null => phaseOf(flow, key)?.label ?? null;

/** The phase the tracker shows: the project's custom phase when it has one the flow still knows, else its built-in stage. */
export function currentPhaseKey(flow: JobFlow, stage: JobStage | null, stageKey: string | null | undefined): string | null {
  if (stageKey && !isBuiltinKey(stageKey) && phaseOf(flow, stageKey)) return stageKey;
  return stage;
}

/** The built-in stage at or before a phase (Bid for anything before it) — the status a job created AT a custom phase gets. */
export function anchorBefore(flow: JobFlow, key: string): JobStage {
  const i = phaseIndex(flow, key);
  for (let j = i; j >= 0; j--) {
    const b = flow.phases[j]?.builtin;
    if (b) return b;
  }
  return "bid";
}
export const anchorStatusBefore = (flow: JobFlow, key: string) => STAGE_PROJECT_STATUS[anchorBefore(flow, key)];

/**
 * Whether an automatic move to `to` (always a built-in stage) leaves a custom phase behind: only when the anchor is
 * AHEAD of the custom phase in the flow. A move to an anchor behind it keeps the custom phase as the current one.
 */
export function anchorPassesPhase(flow: JobFlow, to: JobStage, stageKey: string | null | undefined): boolean {
  if (!stageKey) return false;
  const custom = phaseIndex(flow, stageKey);
  if (custom < 0) return true; // the flow no longer has it: nothing to keep
  return phaseIndex(flow, to) > custom;
}

/** Fill a template's placeholders (unknown {tokens} are left as typed). */
export function renderPhaseTemplate(template: string, vars: { client: string; first: string; job: string; phase: string; company: string; date: string }): string {
  return template.replace(/\{(client|first|job|phase|company|date)\}/g, (_, k: keyof typeof vars) => vars[k] ?? "");
}
