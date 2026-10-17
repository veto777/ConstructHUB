/**
 * The one approve path: the Approve button (routes.ts POST /api/press/releases/:id/approve) and "Send it for me"
 * (send.ts sendDue) both run approveRelease, so the guideline check, the credit and the wire queue are the same.
 */
import { PRESS_TIER_LABEL } from "@shared/press";
import { checkRelease, hasBlockingIssue } from "./guidelines";
import * as store from "./store";
import type { PressGuidelineIssue } from "@shared/press";
import { logError } from "../ops/log";

export type ApproveResult =
  | { ok: true; row: store.ReleaseRow }
  | { ok: false; status: number; code?: "guidelines" | "no_credit" | "state" | "no_text"; message: string; issues?: PressGuidelineIssue[] };

/** The submit pass that follows an approval (a dynamic import: worker.ts imports this module's callers). */
export const approveDeps = {
  kick: () => { void import("./worker").then((w) => w.runPressPass({ inbox: false })).catch((e) => logError("[press] pass after approve:", e)); },
};

export async function approveRelease(row: store.ReleaseRow, userId: number, opts: { kick?: boolean } = {}): Promise<ApproveResult> {
  if (!["draft", "changes_requested"].includes(row.status)) return { ok: false, status: 409, code: "state", message: "This release is already on its way" };
  if (!row.text) return { ok: false, status: 400, code: "no_text", message: "Write the release first" };
  const issues = checkRelease(row.text, row.input);
  if (hasBlockingIssue(issues)) {
    await store.updateRelease(row.id, { issues });
    return { ok: false, status: 409, code: "guidelines", message: "Fix the flagged guideline problems first; the wire's editors would refuse it.", issues };
  }
  // A resend after requested changes keeps its credit; a first approval takes one.
  if (!row.order_id && !(await store.spendCredit(row.id, userId, row.tier))) {
    return { ok: false, status: 402, code: "no_credit", message: `No ${PRESS_TIER_LABEL[row.tier]} credit left. Pick a package to send it.` };
  }
  const upd = await store.updateRelease(row.id, { status: "ready", issues, last_error: null, send_at: null });
  if (opts.kick !== false) approveDeps.kick();
  return { ok: true, row: upd };
}
