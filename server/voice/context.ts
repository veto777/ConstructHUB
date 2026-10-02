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
 * Architect-owned (LANES.md).
 */
import type { Request, Response } from "express";
import { requireOrg, requirePermission, type OrgContext } from "../crm/tenancy";
import { getEntitlements, moduleEnabled, sendModuleRequired, callAssistantAllowance, type Entitlements } from "../entitlements";
import type { CrmPermission } from "@shared/schema";

export type GetUser = (req: any, res: any) => any;

export type VoiceContext = {
  user: { id: number; email?: string };
  ctx: OrgContext;
  /** The org owner's entitlements (the subscription that holds the add-on). */
  ent: Entitlements;
  /** Numbers and monthly minutes the add-on buys. */
  allowance: { numbers: number; minutes: number };
};

export async function voiceContext(
  req: Request, res: Response, getDevUser: GetUser,
  opts: { perm?: CrmPermission; /** Skip the add-on check (the Overview reads status without it). */ skipModule?: boolean } = {},
): Promise<VoiceContext | null> {
  const user = getDevUser(req, res);
  if (!user) return null;
  const ctx = await requireOrg(req, res, user.id);
  if (!ctx) return null;
  const ent = await getEntitlements(ctx.org.ownerUserId);
  if (!opts.skipModule && !moduleEnabled(ent, "callAssistant")) {
    sendModuleRequired(res, "callAssistant");
    return null;
  }
  if (opts.perm && !requirePermission(res, ctx, opts.perm)) return null;
  return { user, ctx, ent, allowance: callAssistantAllowance(ent) };
}

/** The 501 every stub answers until its lane lands (SPEC.md lists the real contracts). */
export function notImplemented(res: Response, lane: string, todo: string) {
  return res.status(501).json({ code: "not_implemented", lane, todo });
}
