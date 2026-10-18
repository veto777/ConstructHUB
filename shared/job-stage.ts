/**
 * A client's job stage (owner, 2026-10-17): Bid → Approved → In progress → Closed out. The tracker on the CRM
 * client page (click a stage to move the job there; Closed out offers to text the client) and the status pill
 * next to clients in Google Reviews.
 *
 * Derived, never stored (pure). The client's NEWEST live project decides (cancelled ones never count):
 *   lead / estimating / proposal_sent → Bid · approved / scheduled → Approved
 *   in_progress / waiting_on_trades / punch_list → In progress · complete / invoiced / paid → Closed out
 * With no live project, the estimates decide: one approved (won) → Approved; one out (draft / sent / viewed) → Bid.
 * Declined / expired / cancelled estimates never count; nothing at all → null.
 */
export const JOB_STAGES = [
  { key: "bid", label: "Bid" },
  { key: "approved", label: "Approved" },
  { key: "in_progress", label: "In progress" },
  { key: "closed_out", label: "Closed out" },
] as const;
export type JobStage = (typeof JOB_STAGES)[number]["key"];

const PROJECT_STAGE: Record<string, JobStage> = {
  lead: "bid", estimating: "bid", proposal_sent: "bid",
  approved: "approved", scheduled: "approved",
  in_progress: "in_progress", waiting_on_trades: "in_progress", punch_list: "in_progress",
  complete: "closed_out", invoiced: "closed_out", paid: "closed_out",
};
/** The project status a stage toggle writes (the first status of that stage). */
export const STAGE_PROJECT_STATUS: Record<JobStage, string> = {
  bid: "proposal_sent", approved: "approved", in_progress: "in_progress", closed_out: "complete",
};
const ESTIMATE_BID = new Set(["draft", "sent", "viewed"]);

type P = { status?: string | null; createdAt?: string | Date | null };
const time = (p: P) => (p.createdAt ? new Date(p.createdAt).getTime() : 0);

/** The project a stage belongs to: the newest one that is not cancelled. */
export function currentProject<T extends P>(projects: T[] | undefined): T | null {
  const live = (projects ?? []).filter((p) => p.status && p.status !== "cancelled" && PROJECT_STAGE[p.status]);
  return live.length ? live.reduce((a, b) => (time(b) > time(a) ? b : a)) : null;
}
export const stageOfProjectStatus = (s: string | null | undefined): JobStage | null => (s ? PROJECT_STAGE[s] ?? null : null);

export function jobStageOf(input: { estimates?: { status?: string | null }[]; projects?: P[] }): JobStage | null {
  const p = currentProject(input.projects);
  if (p) return PROJECT_STAGE[p.status!];
  const es = (input.estimates ?? []).map((e) => String(e.status ?? ""));
  if (es.includes("approved")) return "approved";
  if (es.some((s) => ESTIMATE_BID.has(s))) return "bid";
  return null;
}

export const jobStageLabel = (s: JobStage | null | undefined) => JOB_STAGES.find((x) => x.key === s)?.label ?? null;
