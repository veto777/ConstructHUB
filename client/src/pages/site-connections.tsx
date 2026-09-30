import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { SiteConnectionGuide } from "./site-connection-guide";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
const sampledBlocks = (snapshot: any) =>
  Array.isArray(snapshot?.events)
    ? snapshot.events.filter((e: any) => e.action === "block").length
    : null;
const read = async (url: string) => (await apiRequest("GET", url)).json();
function Field({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Input {...props} />
    </label>
  );
}
function DataList({
  url,
  title,
  render,
  filters = [],
}: {
  url: string;
  title: string;
  render: (row: any) => ReactNode;
  filters?: string[];
}) {
  const [q, Q] = useState(""),
    [page, P] = useState(1),
    [status, S] = useState("");
  const path = `${url}${url.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}&page=${page}&limit=25&status=${encodeURIComponent(status)}`;
  const data = useQuery({
    queryKey: [path],
    queryFn: () => read(path),
    refetchInterval: 15000,
  });
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      <div className="flex gap-2">
        <Input
          aria-label={`Search ${title}`}
          placeholder={`Search ${title.toLowerCase()}`}
          value={q}
          onChange={(e) => {
            Q(e.target.value);
            P(1);
          }}
        />
        {filters.length > 0 && (
          <select
            aria-label={`Filter ${title}`}
            value={status}
            onChange={(e) => {
              S(e.target.value);
              P(1);
            }}
          >
            <option value="">All statuses</option>
            {filters.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </div>
      {data.isLoading ? (
        <p>Loading…</p>
      ) : data.error ? (
        <p role="alert">{apiErrorMessage(data.error)}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {data.data?.total ?? 0} results
          </p>
          <div className="divide-y">
            {data.data?.items?.map((r: any, i: number) => (
              <div
                className="py-3"
                key={r.id ?? r.url ?? r.path ?? `${r.date}:${r.key}:${i}`}
              >
                {render(r)}
              </div>
            ))}
          </div>
          {!data.data?.items?.length && <p>No data available yet.</p>}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => P(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 25 >= (data.data?.total ?? 0)}
              onClick={() => P(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
function MetricRows({ asset }: { asset: any }) {
  const [dimension, D] = useState("date"),
    [group, G] = useState("day"),
    [start, S] = useState(
      new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10),
    ),
    [end, E] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <label>
          Breakdown{" "}
          <select value={dimension} onChange={(e) => D(e.target.value)}>
            {["date", "query", "page", "device", "country"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Group{" "}
          <select value={group} onChange={(e) => G(e.target.value)}>
            {["day", "week", "month"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <Field
          label="From"
          type="date"
          value={start}
          onChange={(e) => S(e.target.value)}
        />
        <Field
          label="To"
          type="date"
          value={end}
          onChange={(e) => E(e.target.value)}
        />
      </div>
      <DataList
        key={`${dimension}:${group}:${start}:${end}`}
        title="Search analytics"
        url={`/api/gsc/assets/${asset.id}/analytics?dimension=${dimension}&group=${group}&start=${start}&end=${end}`}
        render={(r) => (
          <div>
            <b>
              {r.date} {r.key}
            </b>
            <p>
              Clicks: {r.clicks} · Impressions: {r.impressions} · CTR:{" "}
              {r.ctr === null ? "Unavailable" : `${(r.ctr * 100).toFixed(2)}%`}{" "}
              · Position:{" "}
              {r.position === null
                ? "Unavailable"
                : Number(r.position).toFixed(1)}
            </p>
          </div>
        )}
      />
      <p className="text-sm text-muted-foreground">
        Google provides top rows and may omit anonymized queries. Data is
        delayed; jobs still running or failed may leave incomplete results.
        General pages use sitemaps and inspection monitoring. Google’s Indexing
        API supports only JobPosting and BroadcastEvent pages.
      </p>
      <DataList
        title="Sitemaps"
        url={`/api/gsc/assets/${asset.id}/sitemaps`}
        render={(r) => (
          <p>
            {r.path} · Submitted: {r.lastSubmitted ?? "Unknown"} · Errors:{" "}
            {r.errors ?? "Unknown"}
          </p>
        )}
      />
      <DataList
        title="Inspections"
        url={`/api/gsc/assets/${asset.id}/inspections`}
        filters={["PASS", "FAIL", "NEUTRAL"]}
        render={(r) => (
          <div>
            <b>{r.url}</b>
            <p>
              {r.result?.indexStatusResult?.coverageState ?? "Unavailable"} ·{" "}
              {r.result?.indexStatusResult?.verdict ?? "Unknown"} · Checked{" "}
              {new Date(r.inspected_at).toLocaleString()}
            </p>
          </div>
        )}
      />
      <InspectionCoverage id={asset.id} />
      <p className="text-sm">
        Coverage summarizes inspected URLs only; inspection does not request
        indexing.
      </p>
    </div>
  );
}
export function LocationSearchSummary({ locationId }: { locationId: number }) {
  const { data, error } = useQuery({
    queryKey: [`/api/gsc/locations/${locationId}/summary`],
  });
  const s = (data as any)?.search;
  // Search Console is an Agency-plan module; without it this location card has nothing honest to show.
  if (planRequiredFrom(error)) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-medium">
          Google Search Console · property totals · last 30 days
        </p>
        <p>
          {s
            ? `${s.clicks} clicks · ${s.impressions} impressions`
            : "Search Console data unavailable. Connect an account and sync its property."}
        </p>
        <Link href="/search-console" className="text-primary underline">
          Open Search Console
        </Link>
      </CardContent>
    </Card>
  );
}
export default function SiteConnections({
  provider,
}: {
  provider: "cloudflare" | "gsc";
}) {
  const cf = provider === "cloudflare",
    base = `/api/${provider}`,
    { toast } = useToast();
  const [tab, T] = useState("Sites"),
    [selected, Select] = useState<number[]>([]),
    [connection, C] = useState<number | null>(null),
    [asset, A] = useState<any>(null),
    [q, Q] = useState(""),
    [page, P] = useState(1),
    [status, Status] = useState("");
  const [email, Email] = useState(""),
    [key, Key] = useState(""),
    [token, Token] = useState(""),
    [zones, Z] = useState<any>(null),
    [zonePage, ZP] = useState(1),
    [zoneSearch, ZS] = useState(""),
    [zoneIds, ZI] = useState<string[]>([]);
  const [busy, B] = useState(false),
    [preview, Preview] = useState<any[]>([]),
    [pack, Pack] = useState("ads-door"),
    [path, Path] = useState("/ads"),
    [ips, Ips] = useState(""),
    [officeIps, OfficeIps] = useState(""),
    [urls, Urls] = useState(""),
    [inviteRows, Invites] = useState(""),
    [start, Start] = useState(""),
    [end, End] = useState("");
  const listUrl = `${base}/assets?q=${encodeURIComponent(q)}&page=${page}&limit=25&status=${status}`;
  const assets = useQuery({
    queryKey: [listUrl],
    queryFn: () => read(listUrl),
    refetchInterval: pollUnlessPlanRequired(15000),
  });
  const config = useQuery({
    queryKey: [`${base}/connections?limit=1`],
    queryFn: () => read(`${base}/connections?limit=1`),
  });
  const planGate = [config.error, assets.error].find((e) => planRequiredFrom(e));
  async function act(fn: () => Promise<any>, title = "Request saved") {
    B(true);
    try {
      const r = await fn();
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith(base),
      });
      toast({
        title,
        description:
          r?.message ??
          (r?.queued !== undefined
            ? `${r.queued} queued. Watch Work queue for completion.`
            : undefined),
      });
      return r;
    } catch (e) {
      toast({
        title: "Could not complete request",
        description: apiErrorMessage(e),
        variant: "destructive",
      });
      return null;
    } finally {
      B(false);
    }
  }
  const post = (path: string, body: any) =>
    apiRequest("POST", base + path, body).then((r) => r.json());
  const toggle = (id: number) =>
    Select(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  async function discover(p: number) {
    ZP(p);
    const d = await act(
      () => post("/key-discovery", { email, key, page: p, q: zoneSearch }),
      "Cloudflare zones loaded",
    );
    if (d) Z(d);
  }
  const header = (
    <header>
      <h1 className="text-2xl font-bold">
        {cf ? "Cloudflare protection" : "Google Search Console"}
      </h1>
      <p className="text-muted-foreground">
        {cf
          ? "Connect client accounts, inspect traffic, and review changes before blocking at the edge."
          : "Manage client properties, search performance, sitemaps, and indexing monitoring."}
      </p>
    </header>
  );
  if (planGate)
    return (
      <div className="h-full overflow-y-auto">
        <main className="max-w-6xl mx-auto p-6 space-y-6">
          {header}
          <PlanRequired
            module="cloudflareSearchConsole"
            error={planGate}
            className="max-w-3xl"
          />
        </main>
      </div>
    );
  return (
    <div className="h-full overflow-y-auto">
      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {header}
        {config.data?.workerEnabled === false && (
          <p role="status" className="border rounded p-3">
            Background processing is disabled. Queued work will wait until the
            owner enables the site integration worker.
          </p>
        )}
        {new URLSearchParams(window.location.search).get("connection") ===
          "failed" && (
          <p role="alert">
            Google consent failed. Reconnect and grant Search Console access.
          </p>
        )}
        <nav className="flex gap-2 flex-wrap">
          {[
            "Sites",
            "Connections",
            "Onboarding",
            "Work queue",
            ...(cf ? ["Edge audit"] : []),
            "Guide",
          ].map((t) => (
            <Button
              key={t}
              variant={tab === t ? "default" : "outline"}
              onClick={() => T(t)}
            >
              {t}
            </Button>
          ))}
        </nav>
        {tab === "Guide" && <SiteConnectionGuide />}
        {tab === "Connections" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Connect {cf ? "Cloudflare" : "Google"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cf ? (
                  <>
                    <p>
                      Your Global Key is used once to create a limited
                      ConstructHUB key and is never saved. You can see and
                      revoke it in Cloudflare → My Profile → API Tokens.
                    </p>
                    <div className="grid md:grid-cols-2 gap-3">
                      <Field
                        label="Cloudflare login email"
                        type="email"
                        value={email}
                        onChange={(e) => Email(e.target.value)}
                      />
                      <Field
                        label="Global API Key"
                        type="password"
                        autoComplete="off"
                        value={key}
                        onChange={(e) => Key(e.target.value)}
                      />
                    </div>
                    <Field
                      label="Find zone by domain"
                      value={zoneSearch}
                      onChange={(e) => ZS(e.target.value)}
                    />
                    <Button
                      disabled={busy || !key || !email}
                      onClick={() => discover(1)}
                    >
                      Verify and choose zones
                    </Button>
                    {zones && (
                      <section className="space-y-3">
                        <p>
                          {zones.total} zones · page {zonePage}
                        </p>
                        {zones.accounts.map((a: any) => (
                          <p key={a.id} className="text-sm">
                            Account: {a.name}
                          </p>
                        ))}
                        {zones.zones.map((z: any) => (
                          <label className="flex gap-2" key={z.id}>
                            <input
                              type="checkbox"
                              checked={zoneIds.includes(z.id)}
                              onChange={() =>
                                ZI(
                                  zoneIds.includes(z.id)
                                    ? zoneIds.filter((id) => id !== z.id)
                                    : [...zoneIds, z.id],
                                )
                              }
                            />
                            {z.name} · {z.status}
                          </label>
                        ))}
                        <div className="flex gap-2">
                          <Button
                            disabled={busy || zonePage === 1}
                            onClick={() => discover(zonePage - 1)}
                          >
                            Previous zones
                          </Button>
                          <Button
                            disabled={busy || zonePage * 50 >= zones.total}
                            onClick={() => discover(zonePage + 1)}
                          >
                            Next zones
                          </Button>
                          <Button
                            disabled={busy || !zoneIds.length}
                            onClick={async () => {
                              try {
                                const r = await act(
                                  () =>
                                    post("/exchange", {
                                      email,
                                      key,
                                      zones: zoneIds,
                                    }),
                                  "Limited Cloudflare key created",
                                );
                                if (r) {
                                  Z(null);
                                  ZI([]);
                                }
                              } finally {
                                Key("");
                              }
                            }}
                          >
                            Create limited key
                          </Button>
                        </div>
                        <p className="text-sm">
                          Permissions: Zone Read, Analytics Read, Zone WAF Edit.
                          Limited to selected zones.
                        </p>
                      </section>
                    )}
                    <details>
                      <summary>Fallback: paste a scoped API token</summary>
                      <div className="space-y-3 mt-3">
                        <p>
                          Cloudflare → My Profile → API Tokens → Create Token →
                          Custom token. Add the zone permissions listed above,
                          choose Include → Specific zone for each client site,
                          then Continue to summary → Create Token.
                        </p>
                        <Field
                          label="Scoped API token"
                          type="password"
                          autoComplete="off"
                          value={token}
                          onChange={(e) => Token(e.target.value)}
                        />
                        <Button
                          disabled={busy || !token}
                          onClick={async () => {
                            try {
                              await act(
                                () => post("/token", { token }),
                                "Cloudflare connected",
                              );
                            } finally {
                              Token("");
                            }
                          }}
                        >
                          Connect scoped token
                        </Button>
                      </div>
                    </details>
                    <p>
                      Agency member email:{" "}
                      {config.data?.agencyEmail ?? "Not configured"}
                    </p>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() =>
                        act(
                          () => post("/agency", {}),
                          "Agency membership worker connected",
                        )
                      }
                    >
                      Enable agency membership connection
                    </Button>
                  </>
                ) : (
                  <>
                    <p>
                      Connect the agency’s Google account. Search Console
                      permissions are stored separately from GBP and Calendar.
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const d = await read(`${base}/connect`);
                          window.location.assign(d.url);
                        })
                      }
                    >
                      Connect Google Search Console
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
            <DataList
              title="Connections"
              url={`${base}/connections`}
              render={(c) => (
                <div className="flex justify-between gap-3 flex-wrap">
                  <div>
                    <label className="flex gap-2">
                      <input
                        type="radio"
                        name="connection"
                        checked={connection === c.id}
                        onChange={() => C(c.id)}
                      />
                      <b>{c.email ?? c.subject}</b>
                    </label>
                    <p>{c.token_name ?? c.method}</p>
                    <p className="text-sm">
                      {c.permissions
                        ?.map((p: any) =>
                          typeof p === "string" ? p : (p.name ?? p.id),
                        )
                        .join(", ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() =>
                        act(() => post("/discover", { connectionIds: [c.id] }))
                      }
                    >
                      Discover sites
                    </Button>
                    <Button
                      disabled={busy}
                      variant="destructive"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Disconnect and delete cached data? Applied Cloudflare rules remain. Revoke access at the provider if requested.",
                          )
                        )
                          act(() => post("/disconnect", { ids: [c.id] })).then(
                            (r) => {
                              if (r)
                                toast({
                                  title: "Disconnected",
                                  description: r.results
                                    .map((x: any) => x.message)
                                    .join(" "),
                                });
                            },
                          );
                      }}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              )}
            />
          </div>
        )}
        {tab === "Sites" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <Input
                aria-label="Search sites"
                placeholder="Search sites"
                value={q}
                onChange={(e) => {
                  Q(e.target.value);
                  P(1);
                  Select([]);
                }}
              />
              <select
                aria-label="Site status"
                value={status}
                onChange={(e) => {
                  Status(e.target.value);
                  P(1);
                  Select([]);
                }}
              >
                <option value="">All statuses</option>
                {(cf
                  ? ["active", "pending"]
                  : [
                      "siteOwner",
                      "siteFullUser",
                      "siteRestrictedUser",
                      "access_removed",
                    ]
                ).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Button
                disabled={busy || !selected.length}
                onClick={() =>
                  act(() =>
                    post("/sync", {
                      ids: selected,
                      ...(!cf && start ? { start, end: end || undefined } : {}),
                    }),
                  )
                }
              >
                Sync selected ({selected.length})
              </Button>
              <Button
                disabled={busy || !assets.data?.total}
                variant="outline"
                onClick={() =>
                  act(() =>
                    post("/sync", {
                      allMatching: true,
                      q,
                      status,
                      ...(!cf && start ? { start, end: end || undefined } : {}),
                    }),
                  )
                }
              >
                Sync all matching sites
              </Button>
              {!cf && (
                <>
                  <Field
                    label="Sync from (up to 16 months)"
                    type="date"
                    value={start}
                    onChange={(e) => Start(e.target.value)}
                  />
                  <Field
                    label="Sync through"
                    type="date"
                    value={end}
                    onChange={(e) => End(e.target.value)}
                  />
                </>
              )}
            </div>
            {assets.error ? (
              <p role="alert">{apiErrorMessage(assets.error)}</p>
            ) : assets.isLoading ? (
              <p>Loading sites…</p>
            ) : (
              <>
                <p>{assets.data?.total ?? 0} sites</p>
                <div className="border rounded divide-y">
                  <label className="flex gap-2 p-3">
                    <input
                      type="checkbox"
                      aria-label="Select this page"
                      checked={
                        !!assets.data?.items.length &&
                        assets.data.items.every((a: any) =>
                          selected.includes(a.id),
                        )
                      }
                      onChange={(e) =>
                        Select(
                          e.target.checked
                            ? assets.data.items.map((a: any) => a.id)
                            : [],
                        )
                      }
                    />
                    Select this page
                  </label>
                  {assets.data?.items.map((a: any) => (
                    <div className="flex items-center gap-3 p-3" key={a.id}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.name}`}
                        checked={selected.includes(a.id)}
                        onChange={() => toggle(a.id)}
                      />
                      <div className="flex-1">
                        <button
                          className="text-primary underline"
                          onClick={() => A(a)}
                        >
                          {a.name}
                        </button>
                        <p className="text-sm">
                          ID {a.id} · {a.status} · {a.locations} linked
                          locations ·{" "}
                          {a.synced_at
                            ? `Synced ${new Date(a.synced_at).toLocaleString()}`
                            : "Not synced"}
                        </p>
                        {a.error && <p role="alert">{a.error}</p>}
                      </div>
                      <Button
                        disabled={busy}
                        variant="outline"
                        onClick={() =>
                          act(() => post("/sync", { ids: [a.id] }))
                        }
                      >
                        Sync
                      </Button>
                    </div>
                  ))}
                  {!assets.data?.items.length && (
                    <p className="p-6">
                      No connected sites. Open Connections to get started.
                    </p>
                  )}
                </div>
                <div className="flex gap-3 items-center">
                  <Button disabled={page === 1} onClick={() => P(page - 1)}>
                    Previous sites
                  </Button>
                  <span>Page {page}</span>
                  <Button
                    disabled={page * 25 >= (assets.data?.total ?? 0)}
                    onClick={() => P(page + 1)}
                  >
                    Next sites
                  </Button>
                </div>
              </>
            )}
            {cf ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Preview edge protection for selected zones
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <select
                    aria-label="Rule pack"
                    value={pack}
                    onChange={(e) => Pack(e.target.value)}
                  >
                    <option value="ads-door">Ads door</option>
                    <option value="bad-ua">Site-wide bad user agents</option>
                    <option value="ips">Flagged IPs</option>
                  </select>
                  <Field
                    label="Ads path"
                    value={path}
                    onChange={(e) => Path(e.target.value)}
                  />
                  <Field
                    label="Flagged IP addresses (comma separated)"
                    value={ips}
                    onChange={(e) => Ips(e.target.value)}
                  />
                  <Field
                    label="Office IP exemptions (comma separated)"
                    value={officeIps}
                    onChange={(e) => OfficeIps(e.target.value)}
                  />
                  <p className="text-sm">
                    Review Click Guard / VPN Shield findings before adding IPs.
                    Rules affect visitors; check office-IP exemptions in
                    Cloudflare first.
                  </p>
                  <Button
                    disabled={busy || !selected.length}
                    onClick={async () => {
                      const d = await act(
                        () =>
                          post("/preview", {
                            ids: selected,
                            kind: pack,
                            path,
                            officeIps: officeIps
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                            ips: ips
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          }),
                        "Preview ready",
                      );
                      if (d) Preview(d.items);
                    }}
                  >
                    Preview rules
                  </Button>
                  {preview.length > 0 && (
                    <div className="space-y-3 border rounded p-3">
                      <h3 className="font-semibold">Review before applying</h3>
                      {preview.map((p) => (
                        <div key={p.id}>
                          <b>{p.zone}</b>
                          <p>{p.warning}</p>
                          {p.rules.map((r: any, i: number) => (
                            <div key={i}>
                              <p>{r.rule.description}</p>
                              <code className="break-all text-xs">
                                {r.rule.expression}
                              </code>
                            </div>
                          ))}
                        </div>
                      ))}
                      <Button
                        disabled={busy}
                        variant="destructive"
                        onClick={async () => {
                          const r = await act(
                            () =>
                              post("/confirm", {
                                ids: preview.map((p) => p.id),
                              }),
                            "Protection queued",
                          );
                          if (r) Preview([]);
                        }}
                      >
                        Confirm and queue edge changes
                      </Button>
                      <Button variant="outline" onClick={() => Preview([])}>
                        Cancel preview
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Bulk sitemap submission or inspection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p>
                    Enter one property ID and URL per line, separated by a
                    comma. Selected IDs: {selected.join(", ") || "None"}. URLs
                    must belong to the property.
                  </p>
                  <textarea
                    className="border rounded w-full p-2"
                    aria-label="Property IDs and URLs"
                    rows={4}
                    value={urls}
                    onChange={(e) => Urls(e.target.value)}
                    placeholder="123, https://example.com/sitemap.xml"
                  />
                  <div className="flex gap-3">
                    {["inspect", "sitemap"].map((kind) => (
                      <Button
                        key={kind}
                        disabled={busy || !urls.trim()}
                        onClick={() => {
                          if (
                            kind === "sitemap" &&
                            !window.confirm("Submit these sitemaps to Google?")
                          )
                            return;
                          act(() =>
                            post("/urls", {
                              kind,
                              confirm: kind === "sitemap",
                              items: urls
                                .trim()
                                .split("\n")
                                .map((line) => {
                                  const [id, ...rest] = line.split(",");
                                  return {
                                    assetId: Number(id),
                                    url: rest.join(",").trim(),
                                  };
                                }),
                            }),
                          );
                        }}
                      >
                        {kind === "inspect"
                          ? "Queue inspections"
                          : "Review and submit sitemaps"}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {asset && (
              <Card>
                <CardHeader>
                  <CardTitle>{asset.name}</CardTitle>
                  <Button variant="outline" onClick={() => A(null)}>
                    Close details
                  </Button>
                </CardHeader>
                <CardContent>
                  {cf ? (
                    <CloudflareDetails
                      id={asset.id}
                      onFlag={(ip) => {
                        Ips(ips ? `${ips}, ${ip}` : ip);
                        Pack("ips");
                        Select([asset.id]);
                      }}
                    />
                  ) : (
                    <MetricRows key={asset.id} asset={asset} />
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
        {tab === "Onboarding" && (
          <div className="space-y-5">
            <p>
              Select a connection under Connections, then enter one client per
              line: email, location ID{cf ? ", Cloudflare account ID" : ""}.
              Email goes to the client with steps to grant access. Active
              connection: {connection ?? "None"}.
            </p>
            <DataList
              title="Locations"
              url={`${base}/locations`}
              render={(l) => (
                <p>
                  {l.id} · {l.business_name} · {l.website ?? "Website required"}
                </p>
              )}
            />
            <textarea
              className="w-full border rounded p-2"
              aria-label="Client invitations"
              rows={4}
              value={inviteRows}
              onChange={(e) => Invites(e.target.value)}
            />
            <Button
              disabled={busy || !connection || !inviteRows.trim()}
              onClick={() =>
                act(
                  () =>
                    post("/invites", {
                      connectionId: connection,
                      clients: inviteRows
                        .trim()
                        .split("\n")
                        .map((line) => {
                          const [email, id, account] = line
                            .split(",")
                            .map((x) => x.trim());
                          return {
                            email,
                            locationId: Number(id),
                            accountId: account || undefined,
                          };
                        }),
                    }),
                  "Invitation emails queued",
                )
              }
            >
              Send onboarding emails
            </Button>
            <DataList
              title="Invitations"
              url={`${base}/invites`}
              filters={["pending", "accepted"]}
              render={(i) => (
                <p>
                  {i.email} · {i.domain} · {i.state}
                </p>
              )}
            />
          </div>
        )}
        {tab === "Work queue" && (
          <DataList
            title="Work queue"
            url={`${base}/jobs`}
            filters={["queued", "running", "done", "failed", "uncertain"]}
            render={(j) => (
              <p>
                #{j.id} · {j.kind} · {j.state} {j.error && `— ${j.error}`}
              </p>
            )}
          />
        )}
        {tab === "Edge audit" && (
          <DataList
            title="Edge audit"
            url={`${base}/actions`}
            filters={["preview", "queued", "applied", "reverted", "uncertain"]}
            render={(a) => (
              <div className="space-y-2">
                <b>
                  {a.name} · {a.kind} · {a.state}
                </b>
                <p>{new Date(a.created_at).toLocaleString()}</p>
                <p>
                  Before snapshot: {a.preview.before?.until ?? "Unavailable"} ·
                  Latest snapshot: {a.after?.until ?? "Unavailable"}.
                  Latest-event sample blocks:{" "}
                  {sampledBlocks(a.preview.before) ?? "Unavailable"} before /{" "}
                  {sampledBlocks(a.after) ?? "Unavailable"} latest. Sync after
                  applying; sampled events do not prove causation.
                </p>
                {["applied", "uncertain"].includes(a.state) && (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      act(() => post("/undo", { ids: [a.id] }), "Undo queued")
                    }
                  >
                    Undo ConstructHUB rules
                  </Button>
                )}
              </div>
            )}
          />
        )}
      </main>
    </div>
  );
}
function CloudflareDetails({
  id,
  onFlag,
}: {
  id: number;
  onFlag: (ip: string) => void;
}) {
  const { data, error } = useQuery({
    queryKey: [`/api/cloudflare/assets/${id}`],
  });
  const d = (data as any)?.data;
  if (error) return <p>{apiErrorMessage(error)}</p>;
  if (!d)
    return (
      <div className="space-y-4">
        <p>Analytics unavailable. Queue a sync and check Work queue.</p>
        <DataList
          title="Flagged IPs"
          url={`/api/cloudflare/assets/${id}/flagged-ips`}
          render={(r) => (
            <p>
              {r.ip_address} · {r.source} · {r.reason}{" "}
              <Button onClick={() => onFlag(r.ip_address)}>
                Add to preview
              </Button>
            </p>
          )}
        />
      </div>
    );
  return (
    <div className="space-y-4">
      <p>{d.notice}</p>
      <DataList
        title="Flagged IPs"
        url={`/api/cloudflare/assets/${id}/flagged-ips`}
        render={(r) => (
          <p>
            {r.ip_address} · {r.source} · {r.reason}{" "}
            <Button onClick={() => onFlag(r.ip_address)}>Add to preview</Button>
          </p>
        )}
      />
      <p>
        Bot traffic share (score 1–29 among scored requests):{" "}
        {d.botShare == null
          ? "Unavailable on this plan or permission set"
          : `${(d.botShare * 100).toFixed(1)}%`}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        {d.traffic?.map((day: any) => (
          <Card key={day.dimensions?.date}>
            <CardContent className="p-4">
              <b>{day.dimensions?.date} UTC</b>
              <p>Requests: {day.sum?.requests ?? "Unavailable"}</p>
              <p>Unique visitors: {day.uniq?.uniques ?? "Unavailable"}</p>
              <p>Page views: {day.sum?.pageViews ?? "Unavailable"}</p>
              <p>Threats: {day.sum?.threats ?? "Unavailable"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {["traffic", "events", "paths", "bots", "countries"].map((field) => (
        <DataList
          key={field}
          title={field}
          url={`/api/cloudflare/assets/${id}/cache?field=${field}`}
          render={(row) => (
            <pre className="text-xs whitespace-pre-wrap break-all">
              {JSON.stringify(row, null, 2)}
            </pre>
          )}
        />
      ))}
    </div>
  );
}
export function CloudflarePage() {
  return <SiteConnections provider="cloudflare" />;
}
export function SearchConsolePage() {
  return <SiteConnections provider="gsc" />;
}

export function ScanIndexingSummary({ scanId }: { scanId: string }) {
  // Same cached query the Search Console page uses; a 402 means the plan has no Search Console module.
  const access = useQuery({ queryKey: ["/api/gsc/connections?limit=1"] });
  if (access.isLoading || planRequiredFrom(access.error)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Search Console indexing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataList
          title="Scanned URL indexing"
          url={`/api/gsc/scans/${scanId}/indexing`}
          render={(r) => (
            <p>
              {r.url} ·{" "}
              {r.result?.indexStatusResult?.coverageState ?? "Not inspected"}{" "}
              {r.inspected_at &&
                `· ${new Date(r.inspected_at).toLocaleString()}`}
            </p>
          )}
        />
        <Link className="text-primary underline" href="/search-console">
          Queue inspections in Search Console
        </Link>
      </CardContent>
    </Card>
  );
}

function InspectionCoverage({ id }: { id: number }) {
  const { data } = useQuery<any>({
    queryKey: [`/api/gsc/assets/${id}/inspections?limit=1`],
  });
  return (
    <p>
      Inspected URL coverage:{" "}
      {data?.coverage?.length
        ? data.coverage
            .map((c: any) => `${c.verdict ?? "Unknown"}: ${c.count}`)
            .join(" · ")
        : "Unavailable"}
    </p>
  );
}
