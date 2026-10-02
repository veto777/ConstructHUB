/**
 * Scrubbing for the issue desk: everything stored in ops_issues (detail JSON,
 * titles, Claude's report) passes through here first. The rules are blunt on
 * purpose — an issue needs the shape of a failure, never a customer's data:
 *
 *   - a key that names a secret (password, token, secret, api key, cookie,
 *     authorization, card, cvc, signature, …) keeps its key, loses its value;
 *   - in any string: bearer tokens, credentials in URLs, secret-looking query
 *     parameters, known key formats (Stripe, OpenAI, Google, GitHub, Slack,
 *     AWS, JWTs, chub_/chk_ keys), long hex runs and Luhn-valid card numbers
 *     are replaced; emails and phone numbers are masked (first letter + domain,
 *     last two digits); an IPv4 address loses its last octet;
 *   - depth, array length, string length and the total size are capped, and a
 *     cycle, a throwing getter or a BigInt never escapes as an exception.
 */

const SECRET_KEY_RE = /pass(word|wd|phrase)|^pass$|^pwd$|secret|token|api[-_]?key|apikey|authorization|^auth$|cookie|^session$|session[-_]?(id|secret)|credential|private[-_]?key|signature|^sig$|^card|card[-_]?(number|num|no)$|^cvc$|^cvv|^pan$|iban|account[-_]?number|routing[-_]?number|^ssn$|^otp$|totp|recovery[-_]?code|database[-_]?url|^dsn$|connection[-_]?string|refresh[-_]?token/i;

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 60;
const MAX_STRING = 2000;
/** The whole scrubbed detail, serialized. */
export const MAX_DETAIL_BYTES = 16 * 1024;

const REDACTED = "[redacted]";

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function maskEmailAddress(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "[email]";
  return `${email[0]}***${email.slice(at)}`;
}

function maskPhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `[phone …${digits.slice(-2)}]`;
}

/**
 * Patterns applied to every string, in order. Secrets first (a token can
 * contain digits that would otherwise read as a phone number).
 */
const STRING_RULES: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  // Authorization headers and bearer tokens.
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (_m, scheme: string) => `${scheme} ${REDACTED}`],
  // Credentials inside URLs: scheme://user:pass@host → scheme://[redacted]@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (_m, scheme: string) => `${scheme}${REDACTED}@`],
  // Secret-looking query / form parameters.
  [/([?&;](?:access_token|refresh_token|id_token|token|key|api_key|apikey|secret|password|pass|sig|signature|code|state|auth|session|client_secret)=)[^&#\s"']+/gi, (_m, k: string) => `${k}${REDACTED}`],
  // Known key formats.
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{8,}\b/g, REDACTED],
  [/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\b(?:chub|chk)_[A-Za-z0-9_]{8,}\b/g, REDACTED],
  [/\bya29\.[A-Za-z0-9._-]{20,}\b/g, REDACTED],
  [/\b1\/\/[A-Za-z0-9._-]{20,}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
  // Long hex runs (keys, report tokens, hashes): the ids that matter are UUIDs, which stay.
  [/\b[A-Fa-f0-9]{32,}\b/g, "[hex]"],
  // Card numbers: 13–19 digits, optionally grouped by spaces/dashes, that pass Luhn.
  [/\b\d(?:[ -]?\d){12,18}\b/g, (m: string) => (luhnValid(m.replace(/\D/g, "")) ? "[card]" : m)],
  // Emails.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m: string) => maskEmailAddress(m)],
  // Phones: +E.164, or a North American number written with separators.
  [/\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, (m: string) => maskPhoneDigits(m)],
  [/\+\d{8,15}\b/g, (m: string) => maskPhoneDigits(m)],
  [/(?<![\d.:-])\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b(?![.:-]?\d)/g, (m: string) => maskPhoneDigits(m)],
  [/\(\d{3}\)\s?\d{3}[\s.-]?\d{4}\b/g, (m: string) => maskPhoneDigits(m)],
  // IPv4: keep the network, drop the host.
  [/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, (m: string, a: string, b: string, c: string) =>
    [a, b, c].every((x) => Number(x) <= 255) ? `${a}.${b}.${c}.x` : m],
];

/** One string, scrubbed and capped. */
export function scrubText(input: unknown, max = MAX_STRING): string {
  let s: string;
  try { s = typeof input === "string" ? input : String(input); } catch { return "[unprintable]"; }
  const cut = s.length > max * 4 ? s.length : 0;
  if (cut) s = s.slice(0, max * 4);
  for (const [re, rep] of STRING_RULES) s = s.replace(re, rep as any);
  return s.length > max ? `${s.slice(0, max)}… [${(cut || s.length) - max} more chars]` : s;
}

const isSecretKey = (k: string) => SECRET_KEY_RE.test(k.replace(/([a-z])([A-Z])/g, "$1_$2"));

/** Where this process runs from; stack frames show paths relative to it. */
const CWD = (() => { try { return process.cwd(); } catch { return ""; } })();

/** The top stack frames of an error, shortened ("at fn (server/x.ts:12:3)"), without node internals. */
export function stackFrames(stack: unknown, max = 8): string[] {
  if (typeof stack !== "string") return [];
  return stack.split("\n").slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at ") && !/\(node:|\bnode:internal|node_modules\/(express|router)\//.test(l))
    .slice(0, max)
    .map((l) => scrubText(CWD ? l.split(`${CWD}/`).join("").split("file://").join("") : l, 300));
}

/** An Error (or anything thrown) as plain, scrubbed facts. */
export function errorFacts(err: unknown): Record<string, unknown> {
  try {
    if (err instanceof Error) {
      const e = err as Error & { code?: unknown; status?: unknown; statusCode?: unknown; kind?: unknown; type?: unknown };
      const out: Record<string, unknown> = { name: e.name, message: scrubText(e.message, 1000) };
      if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
      const status = e.status ?? e.statusCode;
      if (typeof status === "number") out.status = status;
      if (typeof e.kind === "string") out.kind = e.kind;
      const frames = stackFrames(e.stack);
      if (frames.length) out.stack = frames;
      if (e.cause !== undefined && e.cause !== err) out.cause = e.cause instanceof Error ? { name: e.cause.name, message: scrubText(e.cause.message, 500) } : scrubText(e.cause, 500);
      return out;
    }
    if (err && typeof err === "object") return { thrown: scrubDetail(err) };
    return { thrown: scrubText(err, 1000) };
  } catch {
    return { thrown: "[unreadable error]" };
  }
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value ?? null;
  switch (typeof value) {
    case "string": return scrubText(value);
    case "number": return Number.isFinite(value) ? value : String(value);
    case "boolean": return value;
    case "bigint": return value.toString();
    case "function": case "symbol": return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return errorFacts(value);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (ArrayBuffer.isView(value)) return `[binary ${(value as ArrayBufferView).byteLength} bytes]`;
  const obj = value as object;
  if (seen.has(obj)) return "[circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(obj) ? `[array(${obj.length})]` : "[object]";
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_ARRAY).map((v) => scrubValue(v, depth + 1, seen) ?? null);
      if (obj.length > MAX_ARRAY) out.push(`[${obj.length - MAX_ARRAY} more]`);
      return out;
    }
    if (obj instanceof Map) return scrubValue(Object.fromEntries([...obj.entries()].slice(0, MAX_KEYS).map(([k, v]) => [String(k), v])), depth, seen);
    if (obj instanceof Set) return scrubValue([...obj].slice(0, MAX_ARRAY), depth, seen);
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const key of Object.keys(obj)) {
      if (n++ >= MAX_KEYS) { out["…"] = `${Object.keys(obj).length - MAX_KEYS} more keys`; break; }
      const safeKey = scrubText(key, 80);
      if (isSecretKey(key)) { out[safeKey] = REDACTED; continue; }
      let v: unknown;
      try { v = (obj as Record<string, unknown>)[key]; } catch { v = "[unreadable]"; }
      const s = scrubValue(v, depth + 1, seen);
      if (s !== undefined) out[safeKey] = s;
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Anything → a JSON-safe, scrubbed object no larger than MAX_DETAIL_BYTES
 * serialized. Never throws. A non-object becomes { value }.
 */
export function scrubDetail(detail: unknown): Record<string, unknown> {
  try {
    const v = scrubValue(detail, 0, new WeakSet());
    const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v ?? null };
    const json = JSON.stringify(obj);
    if (Buffer.byteLength(json) <= MAX_DETAIL_BYTES) return obj;
    // Too big: keep the keys, shorten every value until it fits.
    const trimmed: Record<string, unknown> = { truncated: true };
    const budget = Math.floor(MAX_DETAIL_BYTES / Math.max(1, Object.keys(obj).length)) - 40;
    for (const [k, val] of Object.entries(obj)) {
      const s = typeof val === "string" ? val : JSON.stringify(val);
      trimmed[k] = s.length > budget ? `${s.slice(0, Math.max(0, budget))}…` : val;
    }
    const again = JSON.stringify(trimmed);
    return Buffer.byteLength(again) <= MAX_DETAIL_BYTES ? trimmed : { truncated: true, preview: again.slice(0, MAX_DETAIL_BYTES - 200) };
  } catch {
    return { value: "[unserializable detail]" };
  }
}
