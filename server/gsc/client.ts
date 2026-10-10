import { ProviderError, pace } from "../cloudflare/common";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters";
export class SearchConsoleClient {
  constructor(
    private token: () => Promise<string>,
    private http: typeof fetch = fetch,
    private limit: () => Promise<void> = () => pace("gsc"),
  ) {}
  async call(path: string, method = "GET", body?: unknown): Promise<any> {
    if (!path.startsWith("/sites") && path !== "/urlInspection/index:inspect")
      throw new ProviderError("Invalid Search Console resource", 400);
    await this.limit();
    const token = await this.token();
    const base = path.startsWith("/urlInspection")
      ? "https://searchconsole.googleapis.com/v1"
      : "https://www.googleapis.com/webmasters/v3";
    let r: Response, d: any;
    try {
      r = await this.http(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      const raw = await r.text();
      if (!raw && r.ok && method !== "PUT" && r.status !== 204)
        throw new Error("Empty response");
      d = raw ? JSON.parse(raw) : {};
    } catch {
      throw new ProviderError("Search Console request failed");
    }
    if (!r.ok || d.error)
      throw new ProviderError(
        r.status === 401
          ? "Reconnect Search Console"
          : r.status === 403
            // Google's 403 is usually not a property permission at all: on 2026-10-10 every connection failed
            // because the Search Console API was disabled in the Cloud project. Say what Google said.
            ? /not been used in project|is disabled/i.test(d?.error?.message ?? "")
              ? "Search Console API is disabled in the Google Cloud project; enable it and retry"
              : "Search Console access denied; check property permissions"
            : r.status === 429
              ? "Search Console quota reached"
              : "Search Console request rejected",
        [401, 403, 429].includes(r.status) ? r.status : 502,
      );
    return d;
  }
}
