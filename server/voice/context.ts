/**
 * The one gate every /api/crm/voice/* route goes through (SPEC.md § CRM API):
 *
 *   const v = await voiceContext(req, res, getDevUser, { perm: "manageSettings" });
 *   if (!v) return;                      // 401 / 402 / 403 already sent
 *   v.ctx.org, v.ctx.member, v.ent, v.allowance
 *
 * Order of checks: session (401) → org membership (requireOrg) → the
 * callAssistant add-on module on the ORG OWNER's subscription (402
 * plan_required with `addon: "call_assistant"`, the standard body the client's
 * plan prompt understands) → optional CRM permission (403).
 *
 * The entitlement is the org owner's, not the signed-in member's: a field
 * member of a paying org may read the call log; the owner's add-on pays.
 *
 * A bought add-on whose subscription needs a payment (past_due, unpaid, …) is
 * PAUSED (owner, 2026-10-02: "As soon as they stop paying the agent stops
 * working"): reads (GET/HEAD) stay open so the owner still sees the Studio,
 * the numbers and the call log; anything that changes or spends (edits,
 * buying or releasing numbers, the Simulator) answers 402 payment_required
 * with "update your payment method". The engine is refused separately
 * (internal-profile.ts → 423 paused).
 *
 * Architect-owned (LANES.md).
 */
import type { Request, Response } from "express";
import { requireOrg, requirePermission, type OrgContext } from "../crm/tenancy";
import {
  getEntitlements, moduleEnabled, modulePaused, sendModuleRequired, sendModulePaymentNeeded, callAssistantAllowance, type Entitlements,
} from "../entitlements";
import type { CrmPermission } from "@shared/schema";

export type GetUser = (req: any, res: any) => any;

export type VoiceContext = {
  user: { id: number; email?: string };
  ctx: OrgContext;
  /** The org owner's entitlements (the subscription that holds the add-on). */
  ent: Entitlements;
  /** Numbers and monthly minutes the add-on buys. */
  allowance: { numbers: number; minutes: number };
  /** The add-on is bought but paused until a payment goes through (only ever true on a read). */
  paused: boolean;
};

const READ_METHODS = new Set(["GET", "HEAD"]);

export async function voiceContext(
  req: Request, res: Response, getDevUser: GetUser,
  opts: { perm?: CrmPermission; /** Skip the add-on check (the Overview reads status without it). */ skipModule?: boolean } = {},
): Promise<VoiceContext | null> {
  const user = getDevUser(req, res);
  if (!user) return null;
  const ctx = await requireOrg(req, res, user.id);
  if (!ctx) return null;
  const ent = await getEntitlements(ctx.org.ownerUserId);
  const paused = modulePaused(ent, "callAssistant");
  if (!opts.skipModule && !moduleEnabled(ent, "callAssistant")) {
    if (!paused) {
      sendModuleRequired(res, "callAssistant");
      return null;
    }
    if (!READ_METHODS.has(String(req.method ?? "GET").toUpperCase())) {
      sendModulePaymentNeeded(res, "callAssistant");
      return null;
    }
  }
  if (opts.perm && !requirePermission(res, ctx, opts.perm)) return null;
  return { user, ctx, ent, allowance: callAssistantAllowance(ent), paused };
}

/** The 501 every stub answers until its lane lands (SPEC.md lists the real contracts). */
export function notImplemented(res: Response, lane: string, todo: string) {
  return res.status(501).json({ code: "not_implemented", lane, todo });
}
