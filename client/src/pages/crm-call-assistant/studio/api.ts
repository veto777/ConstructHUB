import { apiRequest, queryClient } from "@/lib/queryClient";
import type { VoiceProfile, CompiledProfile } from "@shared/voice-profile";
import type { VoiceProfileResponse, VoiceVersionDetail, VoiceVersionRow } from "@/lib/voice-studio";

/**
 * The Studio's calls to /api/crm/voice/profile* (SPEC § 6 → Agent Studio).
 * Every write invalidates the profile and status so the shell's badge, the
 * Overview and the editor agree. OWNER: studio-frontend lane.
 */
export const PROFILE_KEY = ["/api/crm/voice/profile"] as const;
export const STATUS_KEY = ["/api/crm/voice/status"] as const;
export const VERSIONS_KEY = ["/api/crm/voice/profile/versions"] as const;
export const PREVIEW_KEY = ["/api/crm/voice/profile/preview"] as const;

export function invalidateProfile() {
  for (const key of [PROFILE_KEY, STATUS_KEY, VERSIONS_KEY, PREVIEW_KEY]) void queryClient.invalidateQueries({ queryKey: key });
}

export async function saveDraft(profile: VoiceProfile): Promise<{ profile: VoiceProfile }> {
  const r = await apiRequest("PUT", "/api/crm/voice/profile", { profile });
  return r.json();
}

/**
 * Publish the saved draft. `setupCompleted` is the Studio's one extension to
 * SPEC § 6: the wizard's first publish sends it so voice_profiles.setup_completed_at
 * is stamped (LANE-NOTES-studio-frontend.md); the backend may also stamp it on
 * any first publish — either way the wizard stops showing.
 */
export async function publishDraft(note: string, setupCompleted = false): Promise<{ version: number; compiled: CompiledProfile }> {
  const r = await apiRequest("POST", "/api/crm/voice/profile/publish", { note: note || undefined, ...(setupCompleted ? { setupCompleted: true } : {}) });
  return r.json();
}

export async function pauseAssistant(): Promise<{ status: string }> {
  return (await apiRequest("POST", "/api/crm/voice/profile/pause")).json();
}
export async function resumeAssistant(): Promise<{ status: string }> {
  return (await apiRequest("POST", "/api/crm/voice/profile/resume")).json();
}
export async function restoreVersion(version: number): Promise<{ profile: VoiceProfile }> {
  return (await apiRequest("POST", `/api/crm/voice/profile/versions/${version}/restore`)).json();
}
export async function fetchVersion(version: number): Promise<VoiceVersionDetail> {
  return (await apiRequest("GET", `/api/crm/voice/profile/versions/${version}`)).json();
}

export type { VoiceProfileResponse, VoiceVersionRow };
