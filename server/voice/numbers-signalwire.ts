/**
 * SignalWire LaML REST (Twilio-compatible) client for phone numbers
 * (docs/call-assistant/SPEC.md §13). OWNER: numbers+billing lane.
 *
 * Reads the same env the texting integration uses (server/crm/sms.ts):
 * SIGNALWIRE_SPACE_URL / SIGNALWIRE_PROJECT_ID / SIGNALWIRE_API_TOKEN. No env
 * → `signalwireConfigured()` is false and every call throws
 * SignalWireNotConfiguredError; the routes turn that into an honest 503 and
 * nothing is bought. Tests point SIGNALWIRE_SPACE_URL at a local stub with an
 * explicit `http://` scheme (a space URL without a scheme is always https).
 *
 * Endpoints (all under {base}/api/laml/2010-04-01/Accounts/{project}/):
 *   GET    AvailablePhoneNumbers/US/Local.json?InRegion=WA[&AreaCode=360][&InLocality=Bellingham][&Contains=…]
 *   POST   IncomingPhoneNumbers.json  PhoneNumber, FriendlyName, VoiceUrl, VoiceMethod, StatusCallback, StatusCallbackMethod
 *   GET    IncomingPhoneNumbers.json
 *   DELETE IncomingPhoneNumbers/{sid}.json
 */

export const SIGNALWIRE_NUMBER_ENV_VARS = ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN"] as const;

/** The 50 states + DC, the only `InRegion` values the search accepts. */
export const US_STATE_CODES: readonly string[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];
export const isUsStateCode = (v: unknown): v is string => typeof v === "string" && US_STATE_CODES.includes(v.toUpperCase()) && v.length === 2;

export class SignalWireNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = "signalwire_unconfigured";
  constructor() {
    super("Phone numbers aren't set up on this server yet (no SignalWire credentials). Nothing was bought.");
    this.name = "SignalWireNotConfiguredError";
  }
}

/** A refusal or failure from SignalWire, with its HTTP status and message (never the credentials). */
export class SignalWireError extends Error {
  constructor(readonly status: number, message: string, readonly swCode?: number | string) {
    super(message);
    this.name = "SignalWireError";
  }
}

export type SignalWireConfig = { baseUrl: string; project: string; token: string };

export function signalwireConfig(): SignalWireConfig | null {
  const space = process.env.SIGNALWIRE_SPACE_URL?.trim();
  const project = process.env.SIGNALWIRE_PROJECT_ID?.trim();
  const token = process.env.SIGNALWIRE_API_TOKEN?.trim();
  if (!space || !project || !token) return null;
  const baseUrl = /^https?:\/\//i.test(space) ? space.replace(/\/+$/, "") : `https://${space.replace(/\/+$/, "")}`;
  return { baseUrl, project, token };
}

export const signalwireConfigured = () => signalwireConfig() !== null;

/** One available number as the search returns it. */
export type AvailableNumber = {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  areaCode: string | null;
  /** Local numbers have these; SignalWire marks what each number supports. */
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
};

/** A number the account owns, as IncomingPhoneNumbers lists it. */
export type OwnedNumber = {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string | null;
  statusCallback: string | null;
  dateCreated: string | null;
};

export type SearchParams = {
  state: string;
  areaCode?: string;
  city?: string;
  /** Digit/letter pattern SignalWire's `Contains` understands (e.g. "555"). */
  contains?: string;
  limit?: number;
};

export type PurchaseParams = {
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string;
  statusCallbackUrl: string;
};

/** E.164 for US numbers: "+1" + 10 digits. Returns null when the input can't be one. */
export function toE164(input: string): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const areaCodeOf = (e164: string): string | null => (/^\+1\d{10}$/.test(e164) ? e164.slice(2, 5) : null);

const MAX_SEARCH = 20;

/** The LaML REST client. One instance per config; stateless beyond that. */
export class SignalWireNumbersClient {
  constructor(private readonly cfg: SignalWireConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private url(path: string, query?: Record<string, string | undefined>): string {
    const u = new URL(`${this.cfg.baseUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(this.cfg.project)}/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  private async call(method: "GET" | "POST" | "DELETE", path: string, opts: { query?: Record<string, string | undefined>; form?: Record<string, string> } = {}): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.project}:${this.cfg.token}`).toString("base64")}`,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (opts.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.form).toString();
    }
    let resp: Response;
    try {
      resp = await this.fetchImpl(this.url(path, opts.query), { method, headers, body, signal: AbortSignal.timeout(20_000) });
    } catch (e: any) {
      throw new SignalWireError(502, `SignalWire could not be reached (${String(e?.message || e).slice(0, 120)}).`);
    }
    if (resp.status === 204) return null;
    const text = await resp.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!resp.ok) {
      const msg = String(payload?.message ?? payload?.error ?? `SignalWire HTTP ${resp.status}`).slice(0, 300);
      throw new SignalWireError(resp.status, msg, payload?.code);
    }
    return payload;
  }

  /** Local US numbers in a state, optionally narrowed by area code, city or a digit pattern. */
  async searchAvailable(p: SearchParams): Promise<AvailableNumber[]> {
    const state = p.state.toUpperCase();
    if (!isUsStateCode(state)) throw new SignalWireError(400, "Pick a US state (two-letter code).");
    const areaCode = p.areaCode ? p.areaCode.replace(/\D/g, "") : "";
    if (areaCode && !/^\d{3}$/.test(areaCode)) throw new SignalWireError(400, "An area code is three digits.");
    const limit = Math.max(1, Math.min(MAX_SEARCH, Math.floor(p.limit ?? 10)));
    const payload = await this.call("GET", "AvailablePhoneNumbers/US/Local.json", {
      query: {
        InRegion: state,
        AreaCode: areaCode || undefined,
        InLocality: p.city?.trim() || undefined,
        Contains: p.contains?.trim() || undefined,
        PageSize: String(limit),
      },
    });
    const rows: any[] = Array.isArray(payload?.available_phone_numbers) ? payload.available_phone_numbers : [];
    return rows.slice(0, limit).map((r) => {
      const e164 = toE164(String(r.phone_number ?? "")) ?? String(r.phone_number ?? "");
      return {
        phoneNumber: e164,
        friendlyName: String(r.friendly_name ?? e164),
        locality: r.locality ? String(r.locality) : null,
        region: r.region ? String(r.region) : state,
        areaCode: areaCodeOf(e164),
        capabilities: {
          voice: r.capabilities?.voice !== false,
          sms: r.capabilities?.SMS === true || r.capabilities?.sms === true,
          mms: r.capabilities?.MMS === true || r.capabilities?.mms === true,
        },
      };
    });
  }

  /** Buy a number and point its voice webhook + status callback at the app. */
  async purchase(p: PurchaseParams): Promise<OwnedNumber> {
    const r = await this.call("POST", "IncomingPhoneNumbers.json", {
      form: {
        PhoneNumber: p.phoneNumber,
        FriendlyName: p.friendlyName.slice(0, 64),
        VoiceUrl: p.voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: p.statusCallbackUrl,
        StatusCallbackMethod: "POST",
      },
    });
    if (!r?.sid) throw new SignalWireError(502, "SignalWire answered without a number SID.");
    return ownedFrom(r);
  }

  /** Every number the project owns (first page; the add-on never buys more than a page). */
  async listOwned(): Promise<OwnedNumber[]> {
    const payload = await this.call("GET", "IncomingPhoneNumbers.json", { query: { PageSize: "100" } });
    const rows: any[] = Array.isArray(payload?.incoming_phone_numbers) ? payload.incoming_phone_numbers : [];
    return rows.map(ownedFrom);
  }

  /** Release a number. A 404 means it is already gone, which is the outcome we wanted. */
  async release(sid: string): Promise<{ released: true; alreadyGone: boolean }> {
    try {
      await this.call("DELETE", `IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`);
      return { released: true, alreadyGone: false };
    } catch (e) {
      if (e instanceof SignalWireError && e.status === 404) return { released: true, alreadyGone: true };
      throw e;
    }
  }
}

function ownedFrom(r: any): OwnedNumber {
  const e164 = toE164(String(r.phone_number ?? "")) ?? String(r.phone_number ?? "");
  return {
    sid: String(r.sid),
    phoneNumber: e164,
    friendlyName: String(r.friendly_name ?? e164),
    voiceUrl: r.voice_url ? String(r.voice_url) : null,
    statusCallback: r.status_callback ? String(r.status_callback) : null,
    dateCreated: r.date_created ? String(r.date_created) : null,
  };
}

/** The client for the configured space, or a throwing stand-in when nothing is configured. */
export function signalwireNumbers(fetchImpl: typeof fetch = fetch): SignalWireNumbersClient {
  const cfg = signalwireConfig();
  if (!cfg) throw new SignalWireNotConfiguredError();
  return new SignalWireNumbersClient(cfg, fetchImpl);
}
