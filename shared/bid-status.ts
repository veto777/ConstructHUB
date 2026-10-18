/**
 * Where every client stands on their bid — the owner's four statuses (2026-10-18), derived from what is on file,
 * never typed by hand except "Dead lead":
 *
 *   - **open**      nobody has scheduled anything: no visit on the calendar, no HOVER report, no estimate.
 *   - **pending**   a visit is scheduled or a HOVER report was run, but no bid has been sent to the client yet.
 *                   `bidNotSubmitted` flags the sharper case inside it: a HOVER report exists and NO estimate sits in
 *                   the client's file at all — the lead is still open and needs a bid written.
 *   - **complete**  the bid is done and in front of the client (an estimate was sent, viewed, approved or declined).
 *   - **dead**      marked a dead lead by staff (no response, dead end, tire kicker) — with who, when and why.
 *
 * The pipeline **stage** is the job's phase (shared/job-stage.ts) when the client has a live project; without one,
 * a sent estimate reads Bid Submitted and any estimate or HOVER report reads Bid.
 */
import { stageOfProjectStatus, type JobStage } from "./job-stage";

export type BidState = "open" | "pending" | "complete" | "dead";

export const BID_STATES: { key: BidState; label: string; hint: string }[] = [
  { key: "open", label: "Open", hint: "Nobody has scheduled anything yet" },
  { key: "pending", label: "Pending", hint: "Visit scheduled or HOVER run — bid not sent yet" },
  { key: "complete", label: "Complete", hint: "Bid sent to the client" },
  { key: "dead", label: "Dead lead", hint: "Marked dead: no response, dead end or tire kicker" },
];

export type BidFacts = {
  /** customFields.bidDead on the client (set by staff). */
  dead: boolean;
  /** Any estimate at all on the client (draft included). */
  anyEstimate: boolean;
  /** An estimate the client has seen: sent / viewed / approved / declined. */
  sentEstimate: boolean;
  /** Any appointment on the calendar for the client (past or future, not cancelled). */
  appointment: boolean;
  /** A HOVER measurement report on file. */
  hover: boolean;
  /** The newest live project's status, when there is one. */
  projectStatus: string | null;
};

export function bidStateOf(f: BidFacts): BidState {
  if (f.dead) return "dead";
  if (f.sentEstimate) return "complete";
  if (f.appointment || f.hover || f.anyEstimate) return "pending";
  return "open";
}

/** "Bid not submitted": a HOVER report was run but no estimate sits in the client's file. */
export const bidNotSubmitted = (f: BidFacts): boolean => f.hover && !f.anyEstimate && !f.dead;

/** The pipeline stage the client reads at on the list. */
export function clientStageOf(f: BidFacts): JobStage | null {
  const fromProject = stageOfProjectStatus(f.projectStatus);
  if (fromProject) return fromProject;
  if (f.sentEstimate) return "bid_submitted";
  if (f.anyEstimate || f.hover) return "bid";
  return null;
}

export type DeadLeadMark = { at: string; memberId: string | null; reason: string | null };

/** The stored mark, when the client is a dead lead. */
export function deadLeadOf(customFields: unknown): DeadLeadMark | null {
  const v = (customFields as Record<string, any> | null | undefined)?.bidDead;
  if (!v || typeof v !== "object" || !v.at) return null;
  return { at: String(v.at), memberId: v.memberId ? String(v.memberId) : null, reason: v.reason ? String(v.reason) : null };
}
