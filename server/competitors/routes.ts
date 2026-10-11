import { Router } from "express";
import { requirePlan } from "../entitlements";
import { cancelCompetitorScan, systemClock } from "./worker";

/**
 * Stop a running (or queued) market scan without deleting it: the worker's
 * liveness check makes it stop indexing, the scan shows "Cancelled", and its
 * month is refunded. Mounted by the shared-routes lane at
 * `app.use("/api/competitors/scans", competitorScanActions)`.
 */
export const competitorScanActions = Router();

competitorScanActions.post("/:id/cancel", async (req, res) => {
  const authed = req.user ? (res.locals.agencyOwner ? { ...req.user, id: res.locals.agencyOwner } : req.user) : null;
  if (!authed) return res.status(401).json({ message: "Login required" });
  try {
    const ent = await requirePlan(res, authed.id, "Competitor Intel", (a) => a.competitorScans !== 0);
    if (!ent) return;
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Could not check your plan." });
  }
  try {
    const scanId = parseInt(req.params.id);
    const outcome = await cancelCompetitorScan(authed.id, scanId, systemClock.now());
    if (!("ok" in outcome)) return res.status(outcome.status).json({ message: outcome.message });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Could not cancel the scan." });
  }
});
