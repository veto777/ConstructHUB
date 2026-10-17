/**
 * The one approve path: the Approve button (routes.ts POST /api/press/releases/:id/approve) and "Send it for me"
 * (send.ts sendOne) both run approveRelease, so the guideline check, the credit and the wire queue are the same.
 *
 * It is ONE transaction on the release row (SELECT … FOR UPDATE): the checks run on the locked row, the credit is
 * taken, and the row becomes 'ready' with approved_hash = what was checked. Every text/input write elsewhere is an
 * UPDATE guarded on an editable status (store.updateEditable), which waits for this lock; so an edit either lands
 * before (and is what gets checked) or finds the release approved and is refused. Never an unchecked text on 'ready'.
 *
 * For an automatic send (`auto`), the same transaction also claims the schedule (send_at must still be the one the
 * worker found) and compares the locked row with the hash recorded when it was scheduled.
 */
import { PRESS_TIER_LABEL, type PressGuidelineIssue } from "@shared/press";
import { pool } from "../db";
import { checkRelease, hasBlockingIssue } from "./guidelines";
import * as store from "./store";
import { logError } from "../ops/log";

export type ApproveFailure = { ok: false; status: number; code: "guidelines" | "no_credit" | "state" | "no_text" | "not_found" | "lost_race" | "edited"; message: string; issues?: PressGuidelineIssue[]; row?: store.ReleaseRow };
export type ApproveResult = { ok: true; row: store.ReleaseRow } | ApproveFailure;

/** The submit pass that follows an approval (a dynamic import: worker.ts imports this module's callers). */
export const approveDeps = {
  kick: () => { void import("./worker").then((w) => w.runPressPass({ inbox: false })).catch((e) => logError("[press] pass after approve:", e)); },
  /** Tests: runs inside the transaction, after the row is locked and before anything is checked. */
  afterLock: async (_id: number): Promise<void> => undefined,
};

export async function approveRelease(releaseId: number, opts: { userId?: number; kick?: boolean; auto?: { sendAt: Date; note: (why: string) => string } } = {}): Promise<ApproveResult> {
  const c = await pool.connect();
  let result: ApproveResult;
  try {
    await c.query("BEGIN");
    const { rows: [row] } = await c.query<store.ReleaseRow>(`SELECT * FROM press_releases WHERE id=$1 FOR UPDATE`, [releaseId]);
    await approveDeps.afterLock(releaseId);
    const fail = async (f: Omit<ApproveFailure, "ok">, patch: string = ""): Promise<ApproveFailure> => {
      // An automatic send that does not go out stops for good, with the reason on the release.
      if (opts.auto && row && f.code !== "lost_race") {
        await c.query(`UPDATE press_releases SET send_at=NULL, send_for_me=false, send_note=$2, updated_at=now()${patch} WHERE id=$1`, [row.id, opts.auto.note(f.message)]);
      } else if (patch) {
        await c.query(`UPDATE press_releases SET updated_at=now()${patch} WHERE id=$1`, [row!.id]);
      }
      await c.query("COMMIT");
      return { ok: false, ...f, row };
    };
    if (!row || (opts.userId != null && row.user_id !== opts.userId)) { result = await fail({ status: 404, code: "not_found", message: "Release not found" }); return result; }
    if (opts.auto) {
      const claimed = row.status === "draft" && row.send_at && new Date(row.send_at).getTime() === opts.auto.sendAt.getTime();
      if (!claimed) { result = await fail({ status: 409, code: "lost_race", message: "Already handled" }); return result; }
      if (!row.send_hash || row.send_hash !== store.releaseHash(row)) {
        result = await fail({ status: 409, code: "edited", message: "It was changed after it was scheduled, so it was not sent. Read it and approve it, or turn on Send it for me again." });
        return result;
      }
    }
    if (!(store.EDITABLE as readonly string[]).includes(row.status)) { result = await fail({ status: 409, code: "state", message: "This release is already on its way" }); return result; }
    if (!row.text) { result = await fail({ status: 400, code: "no_text", message: "Write the release first" }); return result; }
    const issues = checkRelease(row.text, row.input);
    if (hasBlockingIssue(issues)) {
      await c.query(`UPDATE press_releases SET issues=$2 WHERE id=$1`, [row.id, JSON.stringify(issues)]);
      result = await fail({ status: 409, code: "guidelines", message: "Fix the flagged guideline problems first; the wire's editors would refuse it.", issues });
      return result;
    }
    // A resend after requested changes keeps its credit; a first approval takes one (in this same transaction).
    if (!row.order_id && !(await store.spendCreditWith(c, row.id, row.user_id, row.tier))) {
      result = await fail({ status: 402, code: "no_credit", message: `No ${PRESS_TIER_LABEL[row.tier]} credit left. Pick a package to send it.` });
      return result;
    }
    const { rows: [upd] } = await c.query<store.ReleaseRow>(
      `UPDATE press_releases SET status='ready', issues=$2, last_error=NULL, send_at=NULL, send_for_me=false, approved_hash=$3, updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id, JSON.stringify(issues), store.releaseHash(row)],
    );
    await c.query("COMMIT");
    result = { ok: true, row: upd };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  if (result.ok && opts.kick !== false) approveDeps.kick();
  return result;
}
