/**
 * Personas for the Agent Studio (SPEC.md § Personas). OWNER: studio-backend lane.
 *
 * The list itself is the architect's mirror in shared/voice-personas.ts; this
 * module only fills `sampleUrl` from what the engine lane actually rendered
 * under client/public/<VOICE_SAMPLE_DIR>/<id>.mp3, so the Studio never shows a
 * play button for a file that is not there. Checked at call time (cheap stat,
 * cached for a minute) so a sample dropped in after boot shows up.
 *
 * NOTE for infra/architect (LANE-NOTES-studio-backend.md): the public path
 * /voice/samples/* sits under the /voice/* engine proxy. The proxy must skip
 * /voice/samples/ (or the samples move to /voice-samples/) before the Studio
 * can play them in production; VOICE_SAMPLE_URL_BASE is the one place to change.
 */
import { existsSync } from "fs";
import path from "path";
import { VOICE_PERSONA_LIST, type VoicePersona, type VoicePersonaId } from "@shared/voice-personas";

export const VOICE_SAMPLE_DIR = "voice/samples";
export const VOICE_SAMPLE_URL_BASE = "/voice/samples";

const CACHE_MS = 60_000;
let cache: { at: number; list: VoicePersona[] } | null = null;

/** Where the samples live: the Vite public dir in dev, dist/public in a build. */
function sampleRoots(): string[] {
  const cwd = process.cwd();
  return [path.join(cwd, "client", "public", VOICE_SAMPLE_DIR), path.join(cwd, "dist", "public", VOICE_SAMPLE_DIR)];
}

export function sampleUrlFor(id: VoicePersonaId, roots = sampleRoots()): string | null {
  for (const root of roots) {
    if (existsSync(path.join(root, `${id}.mp3`))) return `${VOICE_SAMPLE_URL_BASE}/${id}.mp3`;
    if (existsSync(path.join(root, `${id}.wav`))) return `${VOICE_SAMPLE_URL_BASE}/${id}.wav`;
  }
  return null;
}

/** The persona list with real sample URLs (null when the engine lane has not rendered one). */
export function personaList(now = Date.now()): VoicePersona[] {
  if (cache && now - cache.at < CACHE_MS) return cache.list;
  const list = VOICE_PERSONA_LIST.map((p) => ({ ...p, sampleUrl: p.sampleUrl ?? sampleUrlFor(p.id) }));
  cache = { at: now, list };
  return list;
}

/** Test hook. */
export function resetPersonaCache() { cache = null; }
