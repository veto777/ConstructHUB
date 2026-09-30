import { pool } from "../db";
import { encryptToken, decryptToken } from "../gbp/token-crypto";
import { CloudflareClient, tokenPolicies, ZONE_PERMISSIONS } from "./client";
import { ProviderError, domain, mapLocations, queue } from "./common";
import { logActivity, notifyUser } from "../account-events";
import { isIP } from "node:net";
export const cfFor = (c: any, http: typeof fetch = fetch) =>
  new CloudflareClient(
    c.method === "member"
      ? { token: process.env.CLOUDFLARE_AGENCY_TOKEN! }
      : { token: decryptToken(c.token)! },
    http,
  );
export async function saveConnection(
  user: number,
  input: {
    subject: string;
    email?: string;
    token: string;
    tokenId?: string;
    tokenName?: string;
    created?: boolean;
    method: string;
    permissions?: unknown;
  },
) {
  // Replacing a created token can orphan its remote credential: require explicit disconnect first.
  if (
    (
      await pool.query(
        `SELECT id FROM edge_connections WHERE user_id=$1 AND provider='cloudflare' AND subject=$2`,
        [user, input.subject],
      )
    ).rowCount
  )
    throw new ProviderError(
      "This connection already exists; disconnect it first",
      409,
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const {
      rows: [c],
    } = await db.query(
      `INSERT INTO edge_connections(user_id,provider,subject,email,token,token_id,token_name,created_token,method,permissions)
      VALUES($1,'cloudflare',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        user,
        input.subject,
        input.email ?? null,
        encryptToken(input.token),
        input.tokenId ?? null,
        input.tokenName ?? null,
        !!input.created,
        input.method,
        JSON.stringify(input.permissions ?? []),
      ],
    );
    await db.query(
      "INSERT INTO edge_jobs(user_id,connection_id,kind) VALUES($1,$2,'discover')",
      [user, c.id],
    );
    await db.query("COMMIT");
    return c.id;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function exchangeKey(
  user: number,
  email: string,
  key: string,
  zones: string[],
  http: typeof fetch = fetch,
) {
  const client = new CloudflareClient({ email, key }, http);
  const who = (await client.call("/user")).result;
  if (!who?.id || String(who.email).toLowerCase() !== email.toLowerCase())
    throw new ProviderError("Cloudflare identity verification failed", 400);
  const groups = (await client.call("/user/tokens/permission_groups")).result;
  const policies = tokenPolicies(groups, zones),
    name = `ConstructHUB (${new Date().toISOString().slice(0, 10)})`;
  const created = (
    await client.call("/user/tokens", "POST", { name, policies })
  ).result;
  if (!created?.id || !created?.value)
    throw new ProviderError(
      "Cloudflare did not return a scoped token; check API Tokens in Cloudflare",
    );
  try {
    const verify = (
      await new CloudflareClient({ token: created.value }, http).call(
        "/user/tokens/verify",
      )
    ).result;
    if (verify?.status !== "active")
      throw new ProviderError("Scoped token is not active", 400);
    const id = await saveConnection(user, {
      subject: created.id,
      email,
      token: created.value,
      tokenId: created.id,
      tokenName: name,
      created: true,
      method: "exchange",
      permissions: ZONE_PERMISSIONS,
    });
    return { id, tokenName: name, permissions: ZONE_PERMISSIONS };
  } catch (e) {
    // Global credential still only exists in this request. Clean up a token whose persistence failed.
    await client.call(`/user/tokens/${created.id}`, "DELETE").catch(() => {});
    throw e;
  }
}
export async function discoverZones(
  c: any,
  page = 1,
  http: typeof fetch = fetch,
) {
  const client = cfFor(c, http),
    query = new URLSearchParams({ page: String(page), per_page: "50" });
  if (c.method === "member") query.set("account.id", c.subject);
  const data = await client.call(`/zones?${query}`);
  for (const z of data.result ?? []) {
    if (!/^[a-f0-9]{32}$/.test(z.id) || !z.name) continue;
    if (c.method === "member" && z.account?.id !== c.subject) continue;
    const {
      rows: [a],
    } = await pool.query(
      `INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,account_id,status,data)
      VALUES($1,$2,'cloudflare',$3,$4,$5,$6,$7,jsonb_build_object('nameServers',$8::jsonb))
      ON CONFLICT(connection_id,external_id) DO UPDATE SET name=$4,domain=$5,status=$7,
        data=coalesce(edge_assets.data,'{}'::jsonb)||jsonb_build_object('nameServers',$8::jsonb) RETURNING id`,
      [c.user_id, c.id, z.id, z.name, domain(z.name), z.account?.id, z.status,
        JSON.stringify(Array.isArray(z.name_servers) ? z.name_servers.filter((n: unknown) => typeof n === "string").slice(0, 4) : [])],
    );
    await mapLocations(c.user_id, a.id, z.name);
  }
  if (page < Number(data.result_info?.total_pages ?? 1))
    await queue(c.user_id, c.id, null, "discover", { page: page + 1 });
}
export async function cloudflareAnalytics(
  c: any,
  a: any,
  http: typeof fetch = fetch,
) {
  const client = cfFor(c, http),
    since = new Date(Date.now() - 86400000).toISOString(),
    until = new Date().toISOString();
  const variables = { zone: a.external_id, since, until };
  const d = await client.call("/graphql", "POST", {
    variables,
    query: `query($zone:string!,$since:Time!,$until:Time!){viewer{zones(filter:{zoneTag:$zone}){
    traffic:httpRequests1dGroups(limit:2,filter:{date_geq:"${since.slice(0, 10)}",date_leq:"${until.slice(0, 10)}"}){dimensions{date}sum{requests threats pageViews countryMap{clientCountryName requests threats}}uniq{uniques}}
    events:firewallEventsAdaptive(limit:100,filter:{datetime_geq:$since,datetime_leq:$until},orderBy:[datetime_DESC]){datetime action source clientIP clientCountryName clientRequestPath ruleId}
    paths:httpRequestsAdaptiveGroups(limit:20,filter:{datetime_geq:$since,datetime_leq:$until},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
  }}}`,
  });
  const zone = d?.viewer?.zones?.[0];
  if (!zone)
    throw new ProviderError("Cloudflare analytics unavailable for this zone");
  let bots: any = null;
  try {
    bots =
      (
        await client.call("/graphql", "POST", {
          variables,
          query: `query($zone:string!,$since:Time!,$until:Time!){viewer{zones(filter:{zoneTag:$zone}){bots:httpRequestsAdaptiveGroups(limit:100,filter:{datetime_geq:$since,datetime_leq:$until}){count dimensions{botScore}}}}}`,
        })
      )?.viewer?.zones?.[0]?.bots ?? null;
  } catch {}
  const scored = Array.isArray(bots)
    ? bots.filter((b: any) => Number(b.dimensions?.botScore) > 0)
    : null;
  const scoredRequests =
    scored?.reduce((n: number, b: any) => n + Number(b.count), 0) ?? 0;
  const botShare = scoredRequests
    ? scored!
        .filter((b: any) => Number(b.dimensions.botScore) < 30)
        .reduce((n: number, b: any) => n + Number(b.count), 0) / scoredRequests
    : null;
  const countries = new Map<
    string,
    { country: string; requests: number; threats: number }
  >();
  for (const day of zone.traffic ?? [])
    for (const item of day.sum?.countryMap ?? []) {
      const key = item.clientCountryName;
      const prior = countries.get(key) ?? {
        country: key,
        requests: 0,
        threats: 0,
      };
      prior.requests += Number(item.requests);
      prior.threats += Number(item.threats);
      countries.set(key, prior);
    }
  return {
    countries: [...countries.values()].sort((a, b) => b.requests - a.requests),
    botShare,
    source: "Cloudflare GraphQL Analytics",
    since,
    until,
    traffic: zone.traffic ?? null,
    events: zone.events ?? null,
    paths: zone.paths ?? null,
    bots,
    notice:
      "Traffic uses UTC calendar days. Events are the latest 100, paths the top 20; adaptive datasets may be sampled. Bot classification requires an eligible plan. Unknown data stays unavailable.",
  };
}
export type RuleSpec = { phase: string; rule: any };
export function rulePack(
  kind: string,
  path: string,
  ips: string[] = [],
  officeIps: string[] = [],
): RuleSpec[] {
  if (officeIps.length > 100 || officeIps.some((ip) => !isIP(ip)))
    throw new ProviderError(
      "Office exemptions must be valid IP addresses",
      400,
    );
  const rules: RuleSpec[] = [];
  const finish = () => {
    if (officeIps.length)
      for (const spec of rules)
        spec.rule.expression = `(${spec.rule.expression}) and not ip.src in {${[...new Set(officeIps)].join(" ")}}`;
    return rules;
  };
  const add = (expression: string, description: string) =>
    rules.push({
      phase: "http_request_firewall_custom",
      rule: { action: "block", expression, description, enabled: true },
    });
  if (kind === "ips") {
    if (!ips.length || ips.length > 100 || ips.some((ip) => !isIP(ip)))
      throw new ProviderError("Choose 1–100 valid IP addresses", 400);
    add(
      `ip.src in {${[...new Set(ips)].join(" ")}}`,
      "ConstructHUB flagged IPs",
    );
    return finish();
  }
  if (kind === "bad-ua") {
    add(
      '(http.user_agent eq "" or lower(http.user_agent) contains "sqlmap" or lower(http.user_agent) contains "masscan") and not cf.client.bot',
      "ConstructHUB bad user agents",
    );
    rules.push({
      phase: "http_ratelimit",
      rule: {
        action: "block",
        expression: "not cf.client.bot",
        description: "ConstructHUB site flood limit",
        enabled: true,
        ratelimit: {
          characteristics: ["cf.colo.id", "ip.src"],
          period: 10,
          requests_per_period: 120,
          mitigation_timeout: 10,
        },
      },
    });
    return finish();
  }
  if (kind !== "ads-door" || !/^\/[A-Za-z0-9/_-]{1,150}$/.test(path))
    throw new ProviderError("Use an exact ads path such as /ads", 400);
  const on = `http.request.uri.path eq ${JSON.stringify(path)}`;
  add(
    `(${on}) and not cf.client.bot and (http.user_agent eq "" or not (any(http.request.uri.args["gclid"][*] ne "") or any(http.request.uri.args["gbraid"][*] ne "") or any(http.request.uri.args["wbraid"][*] ne "")) or not http.request.method in {"GET" "HEAD"})`,
    "ConstructHUB ads click ID and user agent",
  );
  // Verified-bot category does not establish Google identity. ASN alone is also insufficient.
  add(
    `(${on}) and cf.client.bot and not (ip.geoip.asnum eq 15169 and (http.user_agent contains "Googlebot" or http.user_agent contains "AdsBot-Google" or http.user_agent contains "GoogleOther"))`,
    "ConstructHUB ads non-Google verified bots",
  );
  rules.push({
    phase: "http_ratelimit",
    rule: {
      action: "block",
      expression: `(${on}) and not cf.client.bot`,
      description: "ConstructHUB ads rate limit",
      enabled: true,
      ratelimit: {
        characteristics: ["cf.colo.id", "ip.src"],
        period: 10,
        requests_per_period: 10,
        mitigation_timeout: 10,
      },
    },
  });
  return finish();
}
export async function applyAction(
  c: any,
  a: any,
  action: any,
  undo: boolean,
  http: typeof fetch = fetch,
) {
  const client = cfFor(c, http);
  const remote: any[] = action.remote ?? [];
  if (undo) {
    // Recover a rule accepted by Cloudflare just before a worker crash/DB failure.
    const prefix = `ch_${action.id.replaceAll("-", "")}_`;
    for (const phase of [
      ...new Set((action.preview.rules as RuleSpec[]).map((r) => r.phase)),
    ]) {
      try {
        const set = (
          await client.call(
            `/zones/${a.external_id}/rulesets/phases/${phase}/entrypoint`,
          )
        ).result;
        for (const rule of set?.rules ?? [])
          if (
            rule.ref?.startsWith(prefix) &&
            !remote.some((r) => r.rule === rule.id)
          )
            remote.push({ ruleset: set.id, rule: rule.id });
      } catch (e) {
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
      }
    }
    for (const r of remote) {
      try {
        await client.call(
          `/zones/${a.external_id}/rulesets/${r.ruleset}/rules/${r.rule}`,
          "DELETE",
        );
      } catch (e) {
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
      }
    }
    await pool.query(
      "UPDATE edge_actions SET state='reverted' WHERE id=$1 AND user_id=$2",
      [action.id, c.user_id],
    );
  } else {
    for (const [i, spec] of (action.preview.rules as RuleSpec[]).entries()) {
      if (remote[i]) continue;
      const ref = `ch_${action.id.replaceAll("-", "")}_${i}`;
      let set: any;
      try {
        set = (
          await client.call(
            `/zones/${a.external_id}/rulesets/phases/${spec.phase}/entrypoint`,
          )
        ).result;
      } catch (e) {
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
      }
      let rule = set?.rules?.find((r: any) => r.ref === ref);
      if (!rule) {
        if (set) {
          const updated = (
            await client.call(
              `/zones/${a.external_id}/rulesets/${set.id}/rules`,
              "POST",
              { ...spec.rule, ref },
            )
          ).result;
          rule = updated?.rules?.find((r: any) => r.ref === ref);
        } else {
          set = (
            await client.call(`/zones/${a.external_id}/rulesets`, "POST", {
              name: "ConstructHUB protection",
              kind: "zone",
              phase: spec.phase,
              rules: [{ ...spec.rule, ref }],
            })
          ).result;
          rule = set?.rules?.find((r: any) => r.ref === ref);
        }
      }
      if (!rule?.id || !set?.id)
        throw new ProviderError(
          "Rule result uncertain; reconcile in Cloudflare before retrying",
        );
      remote.push({ ruleset: set.id, rule: rule.id });
      await pool.query(
        "UPDATE edge_actions SET remote=$2 WHERE id=$1 AND user_id=$3",
        [action.id, JSON.stringify(remote), c.user_id],
      );
    }
    await pool.query(
      "UPDATE edge_actions SET state='applied',applied_at=now() WHERE id=$1 AND user_id=$2",
      [action.id, c.user_id],
    );
  }
  await logActivity(null, c.user_id, "cloudflare.edge_changed", {
    actionId: action.id,
    assetId: a.id,
    operation: undo ? "reverted" : "applied",
  });
  await notifyUser(c.user_id, "cloudflare.edge_changed", {
    title: undo
      ? "Cloudflare protection reverted"
      : "Cloudflare protection applied",
    body: a.name,
    link: "/cloudflare",
  });
}
