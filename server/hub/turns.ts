/**
 * Signed assistant turns (guardrails §1 "No client-trusted history"). The
 * browser keeps the transcript; the server stores none. Every assistant turn
 * the server returns carries
 *
 *   sig = HMAC-SHA256(HUB_TURN_KEY, userId ‖ conversationId ‖ index ‖ sha256(content) ‖ sha256(question))
 *
 * where `question` is the user turn it answered. A forged, edited, re-indexed
 * or replayed-from-another-user assistant turn — or an edited earlier question —
 * fails verification and the whole request is rejected before any model call.
 * `index` is the turn's absolute position in the conversation (user turns are
 * even, assistant turns odd), which also counts the user turns for the cap.
 */
import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const MAX_USER_TURNS = 20;

let key: Buffer | null = null;
/** HUB_TURN_KEY, else HKDF(SESSION_SECRET, "hub-turn"), else a per-boot random key (dev). */
export function turnKey(): Buffer {
  if (key) return key;
  const explicit = process.env.HUB_TURN_KEY?.trim();
  const session = process.env.SESSION_SECRET?.trim();
  if (explicit) key = createHash("sha256").update(explicit).digest();
  else if (session) key = Buffer.from(hkdfSync("sha256", session, "constructhub-hub", "hub-turn", 32));
  else key = randomBytes(32);
  return key;
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function signTurn(userId: number, conversationId: string, index: number, content: string, question: string, k: Buffer = turnKey()): string {
  return createHmac("sha256", k).update(`${userId}\u0000${conversationId}\u0000${index}\u0000${sha(content)}\u0000${sha(question)}`).digest("hex");
}

export function verifyTurn(userId: number, conversationId: string, index: number, content: string, question: string, sig: string, k: Buffer = turnKey()): boolean {
  const expected = Buffer.from(signTurn(userId, conversationId, index, content, question, k), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(sig) ? sig : "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type InTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; index?: number; sig?: string };

export type ConversationCheck =
  | { ok: true; conversationId: string; newIndex: number; userTurn: number; capped: boolean }
  | { ok: false };

/**
 * Checks the shape and every signature of a request's turns. The window may
 * start at any earlier question (the browser trims old turns in pairs), but it
 * must start and end on a user turn, roles must alternate, and every assistant
 * turn must sit at the absolute index its signature was issued for, right
 * after the question it answered.
 */
export function checkConversation(userId: number, conversationId: string | undefined, turns: readonly InTurn[], k: Buffer = turnKey()): ConversationCheck {
  if (!turns.length || turns[0].role !== "user" || turns[turns.length - 1].role !== "user") return { ok: false };
  for (let i = 1; i < turns.length; i++) if (turns[i].role === turns[i - 1].role) return { ok: false };

  const assistants = turns.map((t, pos) => ({ t, pos })).filter((x) => x.t.role === "assistant");
  if (!assistants.length) {
    // A brand-new conversation is exactly one user message.
    if (turns.length !== 1) return { ok: false };
    return { ok: true, conversationId: conversationId ?? randomUUID(), newIndex: 0, userTurn: 1, capped: false };
  }
  if (!conversationId) return { ok: false };

  const first = assistants[0].t as Extract<InTurn, { role: "assistant" }>;
  if (typeof first.index !== "number") return { ok: false };
  const base = first.index - assistants[0].pos;
  if (base < 0) return { ok: false };
  for (const { t, pos } of assistants) {
    const a = t as Extract<InTurn, { role: "assistant" }>;
    if (typeof a.index !== "number" || typeof a.sig !== "string") return { ok: false };
    if (a.index !== base + pos || a.index % 2 !== 1) return { ok: false };
    if (!verifyTurn(userId, conversationId, a.index, a.content, turns[pos - 1].content, a.sig, k)) return { ok: false };
  }
  const newIndex = base + turns.length - 1;
  if (newIndex % 2 !== 0) return { ok: false };
  const userTurn = newIndex / 2 + 1;
  return { ok: true, conversationId, newIndex, userTurn, capped: userTurn > MAX_USER_TURNS };
}
