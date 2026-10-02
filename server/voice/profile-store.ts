/**
 * Persistence for the Agent Studio (voice_profiles + voice_profile_versions).
 * OWNER: studio-backend lane. Pure data access: no Express, no entitlements.
 *
 * Model (SPEC.md § Data):
 *   voice_profiles.profile            the Studio DRAFT (always a valid VoiceProfile)
 *   voice_profiles.published_profile  the copy the engine runs
 *   voice_profiles.compiled           compileVoiceProfile(published_profile, published_version)
 *   voice_profiles.status             draft (never published) | live | paused
 *   voice_profile_versions            one row per publish (version = max + 1 per org)
 *
 * Every write re-validates with parseVoiceProfile so a row can never hold a
 * profile the compiler cannot read.
 */
import { and, desc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import { db } from "../db";
import { crmOrgs, crmMembers, voiceProfiles, voiceProfileVersions, voiceNumbers, crmCustomers, type VoiceProfileRow, type VoiceProfileVersionRow, type VoiceNumberRow } from "@shared/schema";
import { defaultVoiceProfile, parseVoiceProfile, type VoiceProfile, type CompiledProfile } from "@shared/voice-profile";
import { compileVoiceProfile } from "./prompt-compiler";
import { callerSpamStatus } from "./spam";

export type VoiceProfileStatus = "draft" | "live" | "paused";

export type OrgLike = Pick<typeof crmOrgs.$inferSelect, "id" | "name" | "timezone" | "phone" | "website" | "state" | "licenseNumber" | "licenseState" | "description"> &
  Partial<Pick<typeof crmOrgs.$inferSelect, "industry">>;

/**
 * A new org's first draft, from the CRM's own company fields only (nothing
 * invented): the org phone normalized to E.164 (the CRM stores what the owner
 * typed, e.g. "(813) 555-0100"), a two-letter state, the industry as the
 * trade line. Everything else is the shared defaults.
 */
export function seedProfileFromOrg(org: Omit<OrgLike, "id">): VoiceProfile {
  const state = org.state?.trim().toUpperCase() ?? "";
  const licenseState = org.licenseState?.trim().toUpperCase() ?? "";
  const base = defaultVoiceProfile({
    name: org.name?.trim() || "Our company",
    timezone: org.timezone,
    phone: normalizeE164(org.phone),
    website: org.website?.trim() || "",
    state: /^[A-Z]{2}$/.test(state) ? state : null,
    licenseNumber: org.licenseNumber?.trim() || null,
    licenseState: /^[A-Z]{2}$/.test(licenseState) ? licenseState : null,
    description: org.description?.trim() || null,
  });
  const industry = org.industry?.trim() ?? "";
  if (!industry) return base;
  return parseVoiceProfile({ ...base, company: { ...base.company, trade: industry.slice(0, 200) } });
}

/** The org's row, created from the CRM's own company fields on first access. */
export async function getOrCreateProfile(org: OrgLike, memberId?: string | null): Promise<VoiceProfileRow> {
  const [existing] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.orgId, org.id)).limit(1);
  if (existing) return existing;
  const profile = seedProfileFromOrg(org);
  const [row] = await db.insert(voiceProfiles)
    .values({ orgId: org.id, profile, status: "draft", updatedByMemberId: memberId ?? null })
    .onConflictDoNothing({ target: voiceProfiles.orgId })
    .returning();
  if (row) return row;
  const [again] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.orgId, org.id)).limit(1);
  return again;
}

export async function getProfileRow(orgId: string): Promise<VoiceProfileRow | null> {
  const [row] = await db.select().from(voiceProfiles).where(eq(voiceProfiles.orgId, orgId)).limit(1);
  return row ?? null;
}

/** Saves the draft. `input` is validated (throws ZodError → the route answers 400). */
export async function saveDraft(orgId: string, input: unknown, memberId?: string | null, opts: { setupCompleted?: boolean } = {}): Promise<VoiceProfileRow> {
  const profile = parseVoiceProfile(input);
  const [row] = await db.update(voiceProfiles)
    .set({
      profile, updatedByMemberId: memberId ?? null, updatedAt: new Date(),
      ...(opts.setupCompleted ? { setupCompletedAt: sql`coalesce(${voiceProfiles.setupCompletedAt}, now())` } : {}),
    })
    .where(eq(voiceProfiles.orgId, orgId))
    .returning();
  if (!row) throw new Error("voice profile row missing");
  return row;
}

/** The next version number for an org (max + 1; versions are per org, not per profile row). */
async function nextVersion(orgId: string): Promise<number> {
  const [r] = await db.select({ max: sql<number>`coalesce(max(${voiceProfileVersions.version}), 0)` }).from(voiceProfileVersions).where(eq(voiceProfileVersions.orgId, orgId));
  return Number(r?.max ?? 0) + 1;
}

/**
 * Publish the draft: validate → compile → version row → copy onto the profile
 * row → status live. Serialized per org with an advisory lock so two publishes
 * cannot race to the same version number.
 */
export async function publishProfile(orgId: string, memberId: string | null, note?: string | null, now = new Date()): Promise<{ row: VoiceProfileRow; version: number; compiled: CompiledProfile }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7180, hashtext(${orgId}))`);
    const [row] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.orgId, orgId)).limit(1);
    if (!row) throw new Error("voice profile row missing");
    const profile = parseVoiceProfile(row.profile);
    const [r] = await tx.select({ max: sql<number>`coalesce(max(${voiceProfileVersions.version}), 0)` }).from(voiceProfileVersions).where(eq(voiceProfileVersions.orgId, orgId));
    const version = Number(r?.max ?? 0) + 1;
    const compiled = compileVoiceProfile(profile, version, now);
    await tx.insert(voiceProfileVersions).values({
      orgId, profileId: row.id, version, profile, compiled, note: note?.trim() || null, createdByMemberId: memberId,
    });
    const [updated] = await tx.update(voiceProfiles)
      // A publish finishes setup too (the Studio's wizard stops showing either way).
      .set({ profile, publishedVersion: version, publishedProfile: profile, compiled, status: "live", updatedByMemberId: memberId, updatedAt: now, setupCompletedAt: sql`coalesce(${voiceProfiles.setupCompletedAt}, now())` })
      .where(eq(voiceProfiles.orgId, orgId))
      .returning();
    return { row: updated, version, compiled };
  });
}

/** The compiled output for the current draft, without publishing (version = next). */
export async function previewDraft(orgId: string, now = new Date()): Promise<{ compiled: CompiledProfile; version: number } | null> {
  const row = await getProfileRow(orgId);
  if (!row) return null;
  const version = await nextVersion(orgId);
  return { compiled: compileVoiceProfile(parseVoiceProfile(row.profile), version, now), version };
}

export async function setProfileStatus(orgId: string, status: "paused" | "live", memberId: string | null): Promise<VoiceProfileRow | { error: "unpublished" }> {
  const row = await getProfileRow(orgId);
  if (!row) throw new Error("voice profile row missing");
  if (row.publishedVersion === null || !row.compiled) return { error: "unpublished" };
  const [updated] = await db.update(voiceProfiles).set({ status, updatedByMemberId: memberId, updatedAt: new Date() }).where(eq(voiceProfiles.orgId, orgId)).returning();
  return updated;
}

// ── Versions ─────────────────────────────────────────────────────────────────

export type VersionSummary = {
  version: number;
  note: string | null;
  createdAt: string | null;
  /** crm_members.id of the publisher. */
  createdBy: string | null;
  /** The publisher's display name or email (null when the member is gone or unknown). */
  author: string | null;
  /** The org's first published version (nothing to diff against). */
  first: boolean;
  /** Top-level sections whose JSON differs from the previous version ("company", "intake", …). */
  changed: string[];
  /** Leaf-level count of changed paths (an honest size for the diff, not a full diff). */
  changedPaths: number;
  published: boolean;
};

/** Leaf paths that differ between two JSON values (keys of objects, indexes of arrays). */
export function diffPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (a === b) return [];
  const isObj = (v: unknown) => v !== null && typeof v === "object";
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [prefix || "$"];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  const out: string[] = [];
  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(...diffPaths((a as any)[k], (b as any)[k], path));
  }
  return out;
}

export function diffSummary(prev: unknown, next: unknown): { changed: string[]; changedPaths: number } {
  const paths = diffPaths(prev, next);
  const changed = [...new Set(paths.map((p) => p.split(".")[0]))];
  return { changed, changedPaths: paths.length };
}

/** member id → "Display Name" or email, org-scoped (a removed member keeps their id, shown as null). */
async function memberNames(orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.select({ id: crmMembers.id, displayName: crmMembers.displayName, email: crmMembers.email })
    .from(crmMembers).where(and(eq(crmMembers.orgId, orgId), inArray(crmMembers.id, want)));
  return new Map(rows.map((r) => [r.id, r.displayName?.trim() || r.email]));
}

export async function listVersions(orgId: string): Promise<VersionSummary[]> {
  const rows = await db.select().from(voiceProfileVersions).where(eq(voiceProfileVersions.orgId, orgId)).orderBy(desc(voiceProfileVersions.version));
  const current = await getProfileRow(orgId);
  const names = await memberNames(orgId, rows.map((r) => r.createdByMemberId));
  const out: VersionSummary[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], prev = rows[i + 1];
    const d = prev ? diffSummary(prev.profile, r.profile) : { changed: [], changedPaths: 0 };
    out.push({
      version: r.version, note: r.note, createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      createdBy: r.createdByMemberId, author: r.createdByMemberId ? names.get(r.createdByMemberId) ?? null : null,
      first: !prev, ...d, published: current?.publishedVersion === r.version,
    });
  }
  return out;
}

export async function getVersion(orgId: string, version: number): Promise<VoiceProfileVersionRow | null> {
  const [row] = await db.select().from(voiceProfileVersions).where(and(eq(voiceProfileVersions.orgId, orgId), eq(voiceProfileVersions.version, version))).limit(1);
  return row ?? null;
}

/** Copies a version's profile into the draft (does not publish). */
export async function restoreVersion(orgId: string, version: number, memberId: string | null): Promise<VoiceProfileRow | null> {
  const v = await getVersion(orgId, version);
  if (!v) return null;
  return saveDraft(orgId, v.profile, memberId);
}

// ── For the engine (internal API) ────────────────────────────────────────────

export type NumberLookup = {
  number: VoiceNumberRow;
  org: typeof crmOrgs.$inferSelect;
  profile: VoiceProfileRow | null;
};

/** The active number row + org + profile row for an inbound E.164 number, or null when nobody owns it. */
export async function lookupNumber(to: string): Promise<NumberLookup | null> {
  // `releasing` too: the number still rings until the carrier takes it back, and the
  // profile route answers it 423 paused (internal-profile.ts) instead of "unknown number".
  const [number] = await db.select().from(voiceNumbers).where(and(eq(voiceNumbers.phoneNumber, to), inArray(voiceNumbers.status, ["active", "releasing"]))).limit(1);
  if (!number) return null;
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, number.orgId)).limit(1);
  if (!org) return null;
  const profile = await getProfileRow(org.id);
  return { number, org, profile };
}

export type CallerStatus = {
  blocked: boolean;
  strikes: number;
  customer: { id: string; firstName: string | null; email: string | null } | null;
};

/** Normalized E.164 (server/crm/sms.ts normalizePhone, but ≥ 10 digits; not imported so this path stays free of the SMS module). */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/[^\d]/g, "");
  // Ten digits minimum: a 7-digit local number has no area code and cannot be dialled back.
  if (digits.length < 10 || digits.length > 15) return null;
  return s.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

/** Spam-ledger block status and the CRM match for a caller, org-scoped. Unknown/withheld caller → not blocked, no match. */
export async function callerStatus(orgId: string, from: string | null | undefined): Promise<CallerStatus> {
  const phone = normalizeE164(from);
  if (!phone) return { blocked: false, strikes: 0, customer: null };
  // One source of truth for the ledger: spam.ts (calls+crm lane) writes and reads voice_spam.
  const spam = await callerSpamStatus(orgId, phone);
  // The CRM stores phones as typed ("(813) 555-0100"), so match on the last ten digits like entities.ts/hover.ts do.
  const last10 = phone.replace(/\D/g, "").slice(-10);
  const digitsOf = (col: AnyColumn) => sql`right(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), 10)`;
  const [cust] = await db.select({ id: crmCustomers.id, firstName: crmCustomers.firstName, email: crmCustomers.email, displayName: crmCustomers.displayName })
    .from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), sql`${crmCustomers.archivedAt} is null`, sql`(${digitsOf(crmCustomers.phone)} = ${last10} or ${digitsOf(crmCustomers.altPhone)} = ${last10})`))
    .orderBy(desc(crmCustomers.updatedAt))
    .limit(1);
  return {
    blocked: spam.blocked, strikes: spam.strikes,
    customer: cust ? { id: cust.id, firstName: cust.firstName || cust.displayName?.split(/\s+/)[0] || null, email: cust.email } : null,
  };
}

/** The profile a call must run: the published compiled output, or why not. */
export function publishedState(row: VoiceProfileRow | null): { state: "live"; compiled: CompiledProfile; version: number; profile: VoiceProfile } | { state: "paused" | "unpublished" } {
  if (!row || row.publishedVersion === null || !row.compiled || !row.publishedProfile) return { state: "unpublished" };
  if (row.status === "paused") return { state: "paused" };
  return { state: "live", compiled: row.compiled, version: row.publishedVersion, profile: row.publishedProfile };
}
