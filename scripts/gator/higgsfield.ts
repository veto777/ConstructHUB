/**
 * Higgsfield's generation API — the calls, the budget and the ledger of the gator shorts
 * (docs/gator/CONCEPTS.md). Nothing here touches a disk or the network by itself: fetch, the clock
 * and the ledger's save are handed in, so the money rules are tested in server/tutorials/gator.test.ts.
 *
 * The API, as read on 2026-10-08 (https://docs.higgsfield.ai/docs/llms.txt and the model pages):
 *   base https://api.higgsfield.ai, header `Authorization: Key <KEY_ID>:<KEY_SECRET>`
 *   POST /estimate/{model_id}  the same JSON body as a generation → { type: "estimate", credits, usd }   FREE
 *   POST /{model_id}           the params as the raw JSON body, header `Idempotency-Key`
 *                              → { status: "queued", request_id, status_url, cancel_url }                 PAID
 *   GET  {status_url}          → { status: queued | in_progress | completed | failed | nsfw | canceled,
 *                                  images: [{ url }] | video: { url } }                                    FREE
 *   POST /files/generate-upload-url { content_type } → { public_url, upload_url, upload_headers }; PUT the file there
 *   `failed`, `nsfw` and `canceled` requests are not charged; outputs are kept "at least seven days".
 *   There is NO documented balance endpoint: the balance is on console.higgsfield.ai only.
 *   A repeated submission with the same Idempotency-Key and body returns the first request — no second charge.
 *
 * THE MONEY RULES (generation spends the owner's credits):
 *   1. Every paid call is priced first with /estimate; an answer that is not a number is a refusal.
 *   2. The ledger carries a cap in credits. A call whose estimate would take the total over the cap is
 *      refused before anything is sent.
 *   3. The ledger is saved BEFORE the request leaves (`reserved`) and after every answer, so an
 *      interrupted run never pays twice: the same shot is asked for again with the same
 *      Idempotency-Key, or simply polled, or — when it is finished — not asked for at all.
 *   4. A shot is paid for once. A deliberate second try is a new TAKE, with its own entry.
 */
import { createHash } from "node:crypto";

export const HF_BASE = "https://api.higgsfield.ai";
export const HF_HOST = "api.higgsfield.ai";

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => Promise<{ status: number; text: () => Promise<string>; bytes?: () => Promise<Buffer> }>;
export type Io = {
  fetch: Fetch; sleep: (ms: number) => Promise<void>; now: () => Date; log: (line: string) => void;
  /** Fetch a finished output (no credentials are sent) and return its bytes. */
  download: (url: string) => Promise<Buffer>;
  /** Write a finished output; exists() says whether one is already there. */
  write: (file: string, data: Buffer) => void; exists: (file: string) => boolean;
};
export type Creds = { id: string; secret: string };

/** Whatever is printed or thrown goes through this: neither half of the key reaches a log, a ledger or an error. */
export const redact = (text: string, c: Creds): string => [c.id, c.secret].filter(Boolean).reduce((t, k) => t.split(k).join("[key]"), text);
export const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");
/** JSON with sorted keys: the same params give the same hash whatever order they were written in. */
export const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as any)[k]])) : x));

/* ── The ledger ───────────────────────────────────────────────────────────── */

export type EntryStatus = "reserved" | "submitted" | "completed" | "failed" | "nsfw" | "canceled";
export type LedgerEntry = {
  /** `<concept>/<shot>/<still|video>/take<N>` — one paid intent. */
  key: string; kind: "image" | "video"; model: string;
  params: Record<string, unknown>; paramsSha256: string; idempotencyKey: string;
  /** What /estimate answered for exactly these params, before the call. */
  credits: number; usd: number;
  status: EntryStatus; requestId: string | null; statusUrl: string | null;
  outputUrl?: string | null; file?: string | null; sha256?: string | null; bytes?: number | null; error?: string | null;
  createdAt: string; finishedAt?: string | null;
};
export type Ledger = {
  version: 1;
  /** The most this ledger may ever hold in charged entries, and how the figure was arrived at. */
  cap: { credits: number; usd: number; derivation: string; setAt: string };
  balance: { before: string; after: string };
  entries: LedgerEntry[];
};
/** An entry whose credits are (or may be) gone: everything but a request Higgsfield did not charge. */
export const charged = (e: LedgerEntry): boolean => e.status === "reserved" || e.status === "submitted" || e.status === "completed";
const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const spent = (l: Ledger): { credits: number; usd: number; images: number; videos: number } => {
  const c = l.entries.filter(charged);
  return { credits: round3(c.reduce((n, e) => n + e.credits, 0)), usd: round3(c.reduce((n, e) => n + e.usd, 0)), images: c.filter((e) => e.kind === "image").length, videos: c.filter((e) => e.kind === "video").length };
};

/**
 * The pilot's cap: "the cost of about twelve short videos and twelve images", priced with /estimate
 * on 2026-10-08 for the models the pipeline uses by default. One credit is $0.0625.
 */
export const PILOT = {
  image: { model: "xai/grok-imagine-image-2.0", credits: 1.44, usd: 0.09, what: "Grok Image 2.0 edit, 2k, 9:16, medium, with the mascot as reference" },
  video: { model: "kling-video/v2.5-turbo/standard/image-to-video", credits: 3.36, usd: 0.21, what: "Kling 2.5 Turbo Standard image-to-video, 5 s" },
  images: 12, videos: 12,
};
export const pilotCap = (now: Date): Ledger["cap"] => ({
  credits: round3(PILOT.images * PILOT.image.credits + PILOT.videos * PILOT.video.credits),
  usd: round3(PILOT.images * PILOT.image.usd + PILOT.videos * PILOT.video.usd),
  derivation: `${PILOT.videos} × ${PILOT.video.credits} credits ($${PILOT.video.usd.toFixed(2)}; ${PILOT.video.what}) + ${PILOT.images} × ${PILOT.image.credits} credits ($${PILOT.image.usd.toFixed(2)}; ${PILOT.image.what}) — prices from POST /estimate on 2026-10-08, 1 credit = $0.0625`,
  setAt: now.toISOString(),
});
/**
 * Phase 2 (2026-10-08, after the owner saw the pilot): a hard cap for the phase, on top of what the pilot
 * spent — $25.00 at first, raised to $40.00 the same day when the talking shots moved to a model with its
 * own voice (dearer). The ledger's cap becomes the pilot's spend + 1600 credits.
 */
export const PHASE2 = { usd: 100, credits: 1600, pilotSpentCredits: 41.12 };
export const phase2Cap = (now: Date): Ledger["cap"] => ({
  credits: round3(PHASE2.pilotSpentCredits + PHASE2.credits), usd: round3((PHASE2.pilotSpentCredits + PHASE2.credits) * 0.0625),
  derivation: `phase 2: $${PHASE2.usd.toFixed(2)} = ${PHASE2.credits} credits (1 credit = $0.0625) on top of the pilot's ${PHASE2.pilotSpentCredits} credits ($2.57) — a hard cap (the styles experiment; raised from $25.00, $40.00 and $60.00 on 2026-10-08 by the owner's coordinator: long shots with native audio cost more)`,
  setAt: now.toISOString(),
});
export const emptyLedger = (now: Date): Ledger => ({
  version: 1, cap: pilotCap(now),
  balance: { before: "not readable: the API has no balance endpoint (console.higgsfield.ai only)", after: "see `spent` — the sum of this ledger's charged entries" },
  entries: [],
});

export class BudgetError extends Error { constructor(m: string) { super(m); this.name = "BudgetError"; } }
/** Refuse a call that would take the ledger over its cap. Thrown BEFORE anything is sent. */
export function assertWithinBudget(l: Ledger, credits: number, what: string): void {
  if (!(credits > 0) || !Number.isFinite(credits)) throw new BudgetError(`REFUSING ${what}: its price is not known (${credits})`);
  const s = spent(l);
  if (s.credits + credits > l.cap.credits + 1e-9) throw new BudgetError(`REFUSING ${what}: ${credits} credits on top of the ${s.credits} already spent would pass the cap of ${l.cap.credits} credits ($${l.cap.usd.toFixed(2)})`);
}

/* ── The calls ────────────────────────────────────────────────────────────── */

const auth = (c: Creds) => ({ Authorization: `Key ${c.id}:${c.secret}` });
async function call(io: Io, c: Creds, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: any; raw: string }> {
  if (!c.id || !c.secret) throw new Error("TUTORIAL_HIGGSFIELD_KEY_ID / TUTORIAL_HIGGSFIELD_KEY_SECRET are not set (run with --env-file=/home/voiceban/ConstructHUB-live/.env)");
  // The key goes to Higgsfield's own host and nowhere else — a status_url is checked before it is asked.
  if (new URL(url).protocol !== "https:" || new URL(url).host !== HF_HOST) throw new Error(`refusing to send the key to ${new URL(url).host}`);
  const res = await io.fetch(url, { method, headers: { ...auth(c), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
  return { status: res.status, json, raw: redact(raw, c) };
}
const detail = (r: { json: any; raw: string }) => String(typeof r.json?.detail === "string" ? r.json.detail : r.raw).slice(0, 300);

/** What a generation would cost — free. Throws when Higgsfield does not answer with a number. */
export async function estimate(io: Io, c: Creds, model: string, params: Record<string, unknown>): Promise<{ credits: number; usd: number }> {
  const r = await call(io, c, "POST", `${HF_BASE}/estimate/${model}`, params);
  if (r.status !== 200) throw new Error(`Higgsfield answered ${r.status} to the estimate of ${model}: ${detail(r)}`);
  const credits = Number(r.json?.credits), usd = Number(r.json?.usd);
  if (r.json?.type !== "estimate" || !(credits > 0) || !(usd > 0)) throw new BudgetError(`REFUSING ${model}: Higgsfield gives no fixed price for it (${String(r.json?.pricing_description ?? r.raw).slice(0, 160)})`);
  return { credits, usd };
}

/** Put a local image where a model can fetch it (a presigned upload; free). The key is not sent to the storage host. */
export async function uploadInput(io: Io, c: Creds, data: Buffer, contentType: "image/png" | "image/jpeg" | "image/webp" | "audio/wav"): Promise<string> {
  const r = await call(io, c, "POST", `${HF_BASE}/files/generate-upload-url`, { content_type: contentType });
  if (r.status !== 200 || !r.json?.upload_url || !r.json?.public_url) throw new Error(`Higgsfield answered ${r.status} to the upload request: ${detail(r)}`);
  const put = await io.fetch(String(r.json.upload_url), { method: "PUT", headers: { ...(r.json.upload_headers ?? { "Content-Type": contentType }) }, body: data });
  if (put.status < 200 || put.status >= 300) throw new Error(`the upload was refused (${put.status})`);
  return String(r.json.public_url);
}

const TERMINAL: readonly string[] = ["completed", "failed", "nsfw", "canceled"];
export const outputUrlOf = (j: any): string | null => j?.video?.url ?? j?.images?.[0]?.url ?? null;

export type GenerateInput = {
  key: string; kind: "image" | "video"; model: string; params: Record<string, unknown>;
  /**
   * What makes this shot THIS shot, when that is not the body itself: an input uploaded again gets a
   * new address without becoming a new intent. Default: the params.
   */
  identity?: unknown;
  /** Where the finished file is written. */
  file: string;
  /** Give up waiting after this long (the request stays `submitted` and is picked up by the next run). */
  timeoutMs?: number;
};
export type GenerateResult = { entry: LedgerEntry; paid: boolean };

/**
 * One shot, paid for at most once. `paid` says whether THIS call spent credits.
 *   · finished before, file in place        → nothing is asked
 *   · finished before, file gone            → downloaded again (free)
 *   · submitted, answer never seen          → polled (free)
 *   · reserved, the request may have left   → sent again with the SAME Idempotency-Key (Higgsfield returns the first request)
 *   · the same key with other params        → refused: that is a new take
 *   · failed / nsfw / canceled before       → refused: ask for a new take (it was not charged)
 */
export async function generate(o: {
  input: GenerateInput; ledger: Ledger; save: (l: Ledger) => void; creds: Creds; io: Io;
  /**
   * Serialises the paid step across processes (several producers at once): the cap check and the
   * reservation run inside it, after `refresh` has read in what other runs reserved — so two runs can never
   * both pass the cap check on the same headroom.
   */
  paidLock?: <T>(fn: () => Promise<T>) => Promise<T>; refresh?: (l: Ledger) => void;
}): Promise<GenerateResult> {
  const { input: g, ledger, save, creds, io } = o;
  const paidLock = o.paidLock ?? (<T>(fn: () => Promise<T>) => fn());
  const paramsSha256 = sha(canonical({ model: g.model, params: g.identity ?? g.params }));
  let e = ledger.entries.find((x) => x.key === g.key), paid = false;
  if (e && e.paramsSha256 !== paramsSha256) throw new Error(`${g.key} is in the ledger with other parameters — a changed prompt or model is a new take, never a silent second charge`);
  if (e && !charged(e)) throw new Error(`${g.key} ended as ${e.status}${e.error ? ` (${e.error})` : ""} and was not charged — ask for a new take`);

  if (!e) {
    const price = await estimate(io, creds, g.model, g.params);
    e = await paidLock(async () => {
      o.refresh?.(ledger);
      const again = ledger.entries.find((x) => x.key === g.key);
      if (again) throw new Error(`${g.key} was reserved by another run meanwhile — run again to pick it up (nothing is paid twice)`);
      assertWithinBudget(ledger, price.credits, g.key);
      const r: LedgerEntry = {
        key: g.key, kind: g.kind, model: g.model, params: g.params, paramsSha256, idempotencyKey: `gator-${sha(`${g.key}\n${paramsSha256}`).slice(0, 40)}`,
        credits: price.credits, usd: price.usd, status: "reserved", requestId: null, statusUrl: null, createdAt: io.now().toISOString(),
      };
      ledger.entries.push(r); save(ledger);
      return r;
    });
    paid = true;
  }
  if (e.status === "reserved") {
    let r: Awaited<ReturnType<typeof call>>;
    // Always the body that was recorded with the reservation: a retry is the same request, byte for byte.
    try { r = await call(io, creds, "POST", `${HF_BASE}/${g.model}`, e.params, { "Idempotency-Key": e.idempotencyKey }); }
    catch (err) { throw new Error(`no answer from Higgsfield for ${g.key} (${redact(err instanceof Error ? err.message : String(err), creds)}) — left as “reserved”; run again and the same Idempotency-Key is used`); }
    if (r.status >= 500) throw new Error(`Higgsfield answered ${r.status} for ${g.key} — left as “reserved”; run again and the same Idempotency-Key is used`);
    if (r.status < 200 || r.status >= 300 || !r.json?.request_id || !r.json?.status_url) {
      // Refused before acceptance (validation, concurrency, no credits): nothing was created or charged.
      e.status = "failed"; e.error = `not accepted (${r.status}): ${detail(r)}`; e.finishedAt = io.now().toISOString(); save(ledger);
      throw new Error(`Higgsfield did not accept ${g.key}: ${e.error}`);
    }
    e.requestId = String(r.json.request_id); e.statusUrl = String(r.json.status_url); e.status = "submitted"; save(ledger);
    io.log(`  ${g.key}: accepted (${e.requestId}) — ${e.credits} credits, $${e.usd.toFixed(3)}`);
  }
  if (e.status === "submitted") {
    const deadline = io.now().getTime() + (g.timeoutMs ?? 15 * 60_000);
    for (let delay = 3000; ; delay = Math.min(delay * 1.4, 10_000)) {
      const r = await call(io, creds, "GET", e.statusUrl!);
      if (r.status === 401 || r.status === 404) throw new Error(`Higgsfield answered ${r.status} to the status of ${g.key} (${e.requestId})`);
      const st = String(r.json?.status ?? "");
      if (r.status === 200 && TERMINAL.includes(st)) {
        e.finishedAt = io.now().toISOString();
        if (st !== "completed") { e.status = st as EntryStatus; e.error = String(r.json?.error ?? r.json?.detail ?? "").slice(0, 300) || null; save(ledger); throw new Error(`${g.key} ended as ${st}${e.error ? `: ${e.error}` : ""} — not charged`); }
        const url = outputUrlOf(r.json);
        if (!url) throw new Error(`${g.key} completed without an output address`);
        e.outputUrl = url; e.status = "completed"; save(ledger);
        break;
      }
      if (io.now().getTime() > deadline) throw new Error(`${g.key} is still ${st || r.status} after the wait — it stays “submitted”; run again to pick it up (nothing is paid twice)`);
      await io.sleep(delay);
    }
  }
  // completed: the file is fetched once and checked against what the ledger remembers of it.
  if (!io.exists(g.file) || !e.sha256) {
    if (!e.outputUrl) throw new Error(`${g.key} is completed but its output address was never recorded`);
    const data = await io.download(e.outputUrl);
    if (e.sha256 && sha(data) !== e.sha256) throw new Error(`${g.key}: the output at its address is no longer the file the ledger recorded`);
    io.write(g.file, data);
    e.file = g.file; e.bytes = data.length; e.sha256 = sha(data); save(ledger);
  }
  return { entry: e, paid };
}
