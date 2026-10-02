/**
 * Call recordings in R2 (docs/call-assistant/SPEC.md § 2 "Recordings") —
 * OWNER: calls+crm lane.
 *
 * Key: voice/<orgId>/recordings/<callSid>.wav (8 kHz mono PCM WAV from the
 * engine). The engine uploads through POST /api/voice-internal/recordings/:callSid;
 * the CRM streams through GET /api/crm/voice/calls/:id/recording. Nothing is
 * ever served from a public bucket URL.
 *
 * Why four segments and not SPEC's voice/<orgId>/<callSid>.wav: the app's
 * public, unauthenticated GET /api/files/:folder/:subfolder/:filename
 * (server/routes.ts) serves ANY three-segment R2 key, so a three-segment
 * recording key would be world-readable to anyone holding the org id and call
 * sid. A four-segment key cannot match that route. (LANE-NOTES-calls-crm.md)
 */
import { getFromR2, putToR2Key, r2Configured } from "../r2";

export function recordingKeyFor(orgId: string, callSid: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(orgId) || !/^[A-Za-z0-9_-]{4,64}$/.test(callSid)) throw new Error("Invalid recording key parts");
  return `voice/${orgId}/recordings/${callSid}.wav`;
}

/** Seconds of audio in a PCM WAV, from its header (null when it is not a WAV we can read). */
export function wavSeconds(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12;
  let channels = 0, sampleRate = 0, bits = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt " && body + 16 <= buf.length) {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (!channels || !sampleRate || !bits) return null;
      // A streamed WAV may carry a 0 / oversized data length: trust the bytes we have.
      const dataBytes = Math.min(size || buf.length - body, buf.length - body);
      return Math.round(dataBytes / (sampleRate * channels * (bits / 8)));
    }
    off = body + size + (size % 2);
  }
  return null;
}

export const recordingsConfigured = r2Configured;

export async function putRecording(orgId: string, callSid: string, wav: Buffer): Promise<{ recordingKey: string; seconds: number | null }> {
  const key = recordingKeyFor(orgId, callSid);
  await putToR2Key(key, wav, "audio/wav");
  return { recordingKey: key, seconds: wavSeconds(wav) };
}

/** The R2 object for streaming; the caller pipes `body` to the response. */
export async function openRecording(key: string): Promise<{ body: ReadableStream | null; contentType: string }> {
  return getFromR2(key);
}
