/**
 * CRM beta invites — the acceptance half. Issuing lives with the platform
 * admin routes (server/crm/admin.ts); this module is what the auth flows call
 * when a brand-new account arrives carrying a ?beta= token.
 *
 * Semantics: a token is single-use, expires after 30 days, and only flags the
 * account whose email the invite was addressed to (same rule as org
 * invitations — a beta invite grants unlimited seats, so it must not be
 * forwardable). An invalid/expired/used token never blocks signup; it just
 * doesn't flag the account.
 */
import { createHash } from "crypto";
import { db } from "../db";
import { crmBetaInvites, users } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

export const BETA_INVITE_DAYS = 30;

export function hashBetaToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Redeem a beta token for a newly created account. Returns the beta stamp to
 * store on users.beta_at, or null when the token is absent, unknown, expired,
 * already used, or addressed to a different email.
 *
 * The accept UPDATE carries `accepted_at IS NULL` in its WHERE clause, so two
 * concurrent signups with the same link can't both flag — the loser's update
 * matches zero rows and gets no stamp.
 */
export async function consumeBetaInvite(
  token: string | undefined | null,
  email: string,
): Promise<Date | null> {
  if (!token) return null;
  const tokenHash = hashBetaToken(token);
  const [invite] = await db
    .select()
    .from(crmBetaInvites)
    .where(eq(crmBetaInvites.tokenHash, tokenHash))
    .limit(1);
  if (!invite) return null;
  if (invite.acceptedAt) return null;
  if (invite.expiresAt.getTime() < Date.now()) return null;
  if (invite.email.toLowerCase() !== email.toLowerCase()) return null;

  const stamp = new Date();
  const [accepted] = await db
    .update(crmBetaInvites)
    .set({ acceptedAt: stamp })
    .where(and(eq(crmBetaInvites.id, invite.id), isNull(crmBetaInvites.acceptedAt)))
    .returning({ id: crmBetaInvites.id });
  if (!accepted) return null; // lost a concurrent-accept race
  return stamp;
}

/** Is this user a beta account? One cheap lookup for the billing gates. */
export async function isBetaUser(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ betaAt: users.betaAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(row?.betaAt);
}
