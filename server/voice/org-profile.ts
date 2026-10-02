/**
 * What the post-call side needs to know about an org: the org row, the
 * profile the engine ran (published, else the draft, else the CRM default) and
 * the spam thresholds. OWNER: calls+crm lane (read-only use of the
 * studio-backend lane's tables; nothing here writes voice_profiles).
 */
import { db } from "../db";
import { crmOrgs, voiceNumbers, voiceProfiles, type VoiceNumberRow } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { voiceProfileSchema, defaultVoiceProfile, type VoiceProfile } from "@shared/voice-profile";
import { VOICE_PERSONAS } from "@shared/voice-personas";
import { DEFAULT_SPAM_THRESHOLDS, SPAM_THRESHOLDS_BY_SENSITIVITY } from "./spam";

export type OrgVoiceContext = {
  org: typeof crmOrgs.$inferSelect;
  profile: VoiceProfile;
  /** voice_profiles.published_version when live, else null. */
  version: number | null;
  spam: { flagAt: number; strikeAt: number };
  assistantName: string;
  companyName: string;
};

export async function loadOrgVoiceContext(orgId: string): Promise<OrgVoiceContext | null> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return null;
  const [row] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.orgId, orgId)).limit(1);
  let profile: VoiceProfile | null = null;
  for (const candidate of [row?.publishedProfile, row?.profile]) {
    if (!candidate) continue;
    const parsed = voiceProfileSchema.safeParse(candidate);
    if (parsed.success) { profile = parsed.data; break; }
  }
  if (!profile) profile = defaultVoiceProfile(org);
  const compiledSpam = row?.compiled?.spam;
  const spam = compiledSpam && typeof compiledSpam.flagAt === "number" && typeof compiledSpam.strikeAt === "number"
    ? { flagAt: compiledSpam.flagAt, strikeAt: compiledSpam.strikeAt }
    : SPAM_THRESHOLDS_BY_SENSITIVITY[profile.advanced.spamSensitivity] ?? DEFAULT_SPAM_THRESHOLDS;
  const assistantName = profile.persona.assistantName.trim() || VOICE_PERSONAS[profile.persona.presetId]?.name || "the assistant";
  const companyName = profile.company.spokenName.trim() || profile.company.name || org.name;
  return { org, profile, version: row?.publishedVersion ?? null, spam, assistantName, companyName };
}

/** The org's number row for an inbound `to` (E.164) or a number id; released numbers do not answer. */
export async function findVoiceNumber(where: { numberId?: string | null; to?: string | null }): Promise<VoiceNumberRow | null> {
  if (where.numberId) {
    const [byId] = await db.select().from(voiceNumbers).where(eq(voiceNumbers.id, where.numberId)).limit(1);
    if (byId) return byId;
  }
  if (where.to) {
    const [byNumber] = await db.select().from(voiceNumbers)
      .where(and(eq(voiceNumbers.phoneNumber, where.to), isNull(voiceNumbers.releasedAt))).limit(1);
    if (byNumber) return byNumber;
  }
  return null;
}
