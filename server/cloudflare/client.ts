import { ProviderError, pace } from "./common";
export const ZONE_PERMISSIONS = [
  "Zone Read",
  "Analytics Read",
  "Zone WAF Edit",
];
/** No provider response/error is ever reflected: it may echo the Global Key. */
export class CloudflareClient {
  constructor(
    private auth: { token: string } | { email: string; key: string },
    private http: typeof fetch = fetch,
    private limit: () => Promise<void> = () => pace("cloudflare"),
  ) {}
  async call(path: string, method = "GET", body?: unknown): Promise<any> {
    if (
      !/^\/(user|accounts|zones|memberships|graphql)(\/|\?|$)/.test(path) ||
      path.includes("..")
    )
      throw new ProviderError("Invalid Cloudflare resource", 400);
    await this.limit();
    let r: Response, d: any;
    try {
      r = await this.http(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...("token" in this.auth
            ? { Authorization: `Bearer ${this.auth.token}` }
            : { "X-Auth-Email": this.auth.email, "X-Auth-Key": this.auth.key }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      d = await r.json();
    } catch {
      throw new ProviderError(
        "Cloudflare request failed; check the connection before retrying",
      );
    }
    if (!r.ok || d.success === false || d.errors?.length)
      throw new ProviderError(
        r.status === 429
          ? "Cloudflare quota reached"
          : r.status === 403
            ? "Cloudflare denied access; check permissions and plan"
            : "Cloudflare rejected the request",
        [401, 403, 404, 429].includes(r.status) ? r.status : 502,
      );
    return path === "/graphql" ? d.data : d;
  }
}
export function tokenPolicies(groups: any[], zones: string[]) {
  return [
    {
      effect: "allow",
      resources: Object.fromEntries(
        zones.map((id) => [`com.cloudflare.api.account.zone.${id}`, "*"]),
      ),
      permission_groups: ZONE_PERMISSIONS.map((name) => {
        const g = groups.find(
          (g) =>
            (g.name === name || g.name === name.replace(/ Edit$/, " Write")) &&
            (!g.scopes || g.scopes.includes("com.cloudflare.api.account.zone")),
        );
        if (!g?.id)
          throw new ProviderError(
            `Cloudflare permission unavailable: ${name}`,
            400,
          );
        return { id: g.id };
      }),
    },
  ];
}
