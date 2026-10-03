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
  AppPage,
  PageHeader,
  Section,
  Toolbar,
  Notice,
} from "@/components/app-ui";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";
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
    <label className="block min-w-0 space-y-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input {...props} />
    </label>
  );
}
/**
 * Tab strip that behaves like the kit's AppTabsList (scrolls sideways on
 * phones, never wraps) but keeps plain buttons: e2e reaches tabs by role
 * "button" (e.g. getByRole("button", { name: "Work queue" })).
 */
function TabStrip({ tabs, active, onChange }: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
      <div className="inline-flex h-10 w-max min-w-full gap-1 rounded-xl bg-muted p-1 sm:min-w-0">
        {tabs.map((t) => (
          <Button
            key={t}
            variant={t === active ? "default" : "ghost"}
            className="shrink-0 rounded-lg px-3.5"
            onClick={() => onChange(t)}
            aria-selected={active === t}
            data-testid={`tab-connection-${t.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {t}
          </Button>
        ))}
      </div>
    </div>
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
      <h3 className="text-base font-semibold leading-6">{title}</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Input
          aria-label={`Search ${title}`}
          placeholder={`Search ${title.toLowerCase()}`}
          value={q}
          onChange={(e) => {
            Q(e.target.value);
            P(1);
          }}
          className="h-10 sm:w-72"
        />
        {filters.length > 0 && (
          <select
            aria-label={`Filter ${title}`}
            className={selectClass}
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.error ? (
        <p role="alert" className="text-sm text-destructive">
          {apiErrorMessage(data.error)}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {data.data?.total ?? 0} results
          </p>
          <div className="divide-y rounded-xl border">
            {data.data?.items?.map((r: any, i: number) => (
              <div
                className="px-4 py-3"
                key={r.id ?? r.url ?? r.path ?? `${r.date}:${r.key}:${i}`}
              >
                {render(r)}
              </div>
            ))}
            {!data.data?.items?.length && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No data available yet.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => P(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              Page {page}
            </span>
            <Button
              variant="outline"
              size="sm"
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
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Breakdown</span>
          <select
            aria-label="Breakdown"
            className={`${selectClass} block`}
            value={dimension}
            onChange={(e) => D(e.target.value)}
          >
            {["date", "query", "page", "device", "country"].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-muted-foreground">Group</span>
          <select
            aria-label="Group"
            className={`${selectClass} block`}
            value={group}
            onChange={(e) => G(e.target.value)}
          >
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
          <div className="text-sm">
            <p className="font-medium">
              {r.date} {r.key}
            </p>
            <p className="text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
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
          <div className="text-sm">
            <p className="break-all font-medium">{r.url}</p>
            <p className="text-muted-foreground">
              {r.result?.indexStatusResult?.coverageState ?? "Unavailable"} ·{" "}
              {r.result?.indexStatusResult?.verdict ?? "Unknown"} · Checked{" "}
              {new Date(r.inspected_at).toLocaleString()}
            </p>
          </div>
        )}
      />
      <InspectionCoverage id={asset.id} />
      <p className="text-sm text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">
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
    <PageHeader
      title={cf ? "Cloudflare protection" : "Google Search Console"}
      description={
        cf
          ? "Connect client accounts, inspect traffic, and review changes before blocking at the edge."
          : "Manage client properties, search performance, sitemaps, and indexing monitoring."
      }
    />
  );
  const TABS = [
    "Sites",
    "Connections",
    "Onboarding",
    "Work queue",
    ...(cf ? ["Edge audit"] : []),
    "Guide",
  ];
  if (planGate)
    return (
      <AppPage testId={`page-site-connections-${provider}`}>
        {header}
        <PlanRequired
          module="cloudflareSearchConsole"
          error={planGate}
          className="max-w-3xl"
        />
      </AppPage>
    );
  return (
    <AppPage testId={`page-site-connections-${provider}`}>
      {header}
      {config.data?.workerEnabled === false && (
        <Notice tone="warning">
          Background processing is disabled. Queued work will wait until the
          owner enables the site integration worker.
        </Notice>
      )}
      {new URLSearchParams(window.location.search).get("connection") ===
        "failed" && (
        <Notice tone="danger">
          Google consent failed. Reconnect and grant Search Console access.
        </Notice>
      )}
      <TabStrip tabs={TABS} active={tab} onChange={T} />
      {tab === "Guide" && <SiteConnectionGuide />}
      {tab === "Connections" && (
        <div className="space-y-5 sm:space-y-6">
          <Section
            title={`Connect ${cf ? "Cloudflare" : "Google"}`}
            description={
              cf
                ? "Your Global Key is used once to create a limited ConstructHUB key and is never saved."
                : "Connect the agency’s Google account. Search Console permissions are stored separately from GBP and Calendar."
            }
          >
            {cf ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
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
                  className="w-full sm:w-auto"
                  onClick={() => discover(1)}
                >
                  Verify and choose zones
                </Button>
                {zones && (
                  <section className="space-y-3 rounded-xl border p-4">
                    <p className="text-sm text-muted-foreground">
                      {zones.total} zones · page {zonePage}
                    </p>
                    {zones.accounts.map((a: any) => (
                      <p key={a.id} className="text-sm">
                        Account: {a.name}
                      </p>
                    ))}
                    {zones.zones.map((z: any) => (
                      <label className="flex gap-2 text-sm" key={z.id}>
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
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <Button
                        variant="outline"
                        disabled={busy || zonePage === 1}
                        onClick={() => discover(zonePage - 1)}
                      >
                        Previous zones
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || zonePage * 50 >= zones.total}
                        onClick={() => discover(zonePage + 1)}
                      >
                        Next zones
                      </Button>
                      <Button
                        variant="outline"
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
                    <p className="text-sm text-muted-foreground">
                      Permissions: Zone Read, Analytics Read, Zone WAF Edit.
                      Limited to selected zones.
                    </p>
                  </section>
                )}
                <details className="rounded-xl border px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Fallback: paste a scoped API token
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Cloudflare → My Profile → API Tokens → Create Token →
                      Custom token. Add the zone permissions listed above,
                      choose Include → Specific zone for each client site, then
                      Continue to summary → Create Token.
                    </p>
                    <Field
                      label="Scoped API token"
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => Token(e.target.value)}
                    />
                    <Button
                      variant="outline"
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
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
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
                </div>
              </div>
            ) : (
              <Button
                disabled={busy}
                className="w-full sm:w-auto"
                onClick={() =>
                  act(async () => {
                    const d = await read(`${base}/connect`);
                    window.location.assign(d.url);
                  })
                }
              >
                Connect Google Search Console
              </Button>
            )}
          </Section>
          <DataList
            title="Connections"
            url={`${base}/connections`}
            render={(c) => (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <label className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="connection"
                      checked={connection === c.id}
                      onChange={() => C(c.id)}
                    />
                    <b>{c.email ?? c.subject}</b>
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {c.token_name ?? c.method}
                  </p>
                  <p className="text-sm text-muted-foreground">
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
                    size="sm"
                    onClick={() =>
                      act(() => post("/discover", { connectionIds: [c.id] }))
                    }
                  >
                    Discover sites
                  </Button>
                  <Button
                    disabled={busy}
                    variant="destructive"
                    size="sm"
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
        <div className="space-y-4 sm:space-y-5">
          <Toolbar
            search={{
              value: q,
              onChange: (v) => {
                Q(v);
                P(1);
                Select([]);
              },
              placeholder: "Search sites",
            }}
            activeFilters={status ? 1 : 0}
            filters={
              <select
                aria-label="Site status"
                className={selectClass}
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
            }
          />
          <div className="flex flex-wrap items-end gap-3">
            {!cf && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
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
              </div>
            )}
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row">
              <Button
                disabled={busy || !selected.length}
                className="w-full sm:w-auto"
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
                className="w-full sm:w-auto"
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
            </div>
          </div>
          {assets.error ? (
            <p role="alert" className="text-sm text-destructive">
              {apiErrorMessage(assets.error)}
            </p>
          ) : assets.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading sites…</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {assets.data?.total ?? 0} sites
              </p>
              <div className="rounded-xl border">
                <label className="flex gap-2 border-b p-3 text-sm text-muted-foreground">
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
                  <div
                    className="flex flex-wrap items-center gap-3 border-b p-3 last:border-b-0"
                    key={a.id}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.name}`}
                      checked={selected.includes(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        className="text-sm font-medium text-primary underline"
                        onClick={() => A(a)}
                      >
                        {a.name}
                      </button>
                      <p className="text-sm text-muted-foreground">
                        ID {a.id} · {a.status} · {a.locations} linked locations
                        ·{" "}
                        {a.synced_at
                          ? `Synced ${new Date(a.synced_at).toLocaleString()}`
                          : "Not synced"}
                      </p>
                      {a.error && (
                        <p role="alert" className="text-sm text-destructive">
                          {a.error}
                        </p>
                      )}
                    </div>
                    <Button
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      onClick={() => act(() => post("/sync", { ids: [a.id] }))}
                    >
                      Sync
                    </Button>
                  </div>
                ))}
                {!assets.data?.items.length && (
                  <p className="p-6 text-sm text-muted-foreground">
                    No connected sites. Open Connections to get started.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => P(page - 1)}
                >
                  Previous sites
                </Button>
                <span className="text-sm tabular-nums text-muted-foreground">
                  Page {page}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 25 >= (assets.data?.total ?? 0)}
                  onClick={() => P(page + 1)}
                >
                  Next sites
                </Button>
              </div>
            </>
          )}
          {cf ? (
            <Section
              title="Preview edge protection for selected zones"
              description="Review Click Guard / VPN Shield findings before adding IPs. Rules affect visitors."
            >
              <div className="space-y-3">
                <select
                  aria-label="Rule pack"
                  className={selectClass}
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
                <p className="text-sm text-muted-foreground">
                  Check office-IP exemptions in Cloudflare first.
                </p>
                <Button
                  variant="outline"
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
                  <div className="space-y-3 rounded-xl border p-4">
                    <h3 className="text-base font-semibold leading-6">
                      Review before applying
                    </h3>
                    {preview.map((p) => (
                      <div key={p.id} className="text-sm">
                        <b>{p.zone}</b>
                        <p className="text-muted-foreground">{p.warning}</p>
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
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
                  </div>
                )}
              </div>
            </Section>
          ) : (
            <Section
              title="Bulk sitemap submission or inspection"
              description="One property ID and URL per line, separated by a comma. URLs must belong to the property."
            >
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Selected IDs: {selected.join(", ") || "None"}.
                </p>
                <textarea
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  aria-label="Property IDs and URLs"
                  rows={4}
                  value={urls}
                  onChange={(e) => Urls(e.target.value)}
                  placeholder="123, https://example.com/sitemap.xml"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  {["inspect", "sitemap"].map((kind) => (
                    <Button
                      key={kind}
                      variant="outline"
                      className="w-full sm:w-auto"
                      disabled={busy || !urls.trim()}
                      onClick={() => {
                        if (
                          kind === "sitemap" &&
                          !window.confirm(
                            "Submit these sitemaps to Google?",
                          )
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
              </div>
            </Section>
          )}
          {asset && (
            <Section
              title={asset.name}
              actions={
                <Button variant="ghost" size="sm" onClick={() => A(null)}>
                  Close details
                </Button>
              }
            >
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
            </Section>
          )}
        </div>
      )}
      {tab === "Onboarding" && (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Select a connection under Connections, then enter one client per
            line: email, location ID{cf ? ", Cloudflare account ID" : ""}.
            Email goes to the client with steps to grant access. Active
            connection: {connection ?? "None"}.
          </p>
          <DataList
            title="Locations"
            url={`${base}/locations`}
            render={(l) => (
              <p className="text-sm text-muted-foreground">
                {l.id} · {l.business_name} · {l.website ?? "Website required"}
              </p>
            )}
          />
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">Client invitations</span>
            <textarea
              className="w-full rounded-md border bg-background p-2 text-sm"
              aria-label="Client invitations"
              rows={4}
              value={inviteRows}
              onChange={(e) => Invites(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !connection || !inviteRows.trim()}
            className="w-full sm:w-auto"
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
              <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
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
            <div className="space-y-2 text-sm">
              <b>
                {a.name} · {a.kind} · {a.state}
              </b>
              <p className="text-muted-foreground">
                {new Date(a.created_at).toLocaleString()}
              </p>
              <p className="text-muted-foreground">
                Before snapshot: {a.preview.before?.until ?? "Unavailable"} ·
                Latest snapshot: {a.after?.until ?? "Unavailable"}. Latest-event
                sample blocks: {sampledBlocks(a.preview.before) ?? "Unavailable"}{" "}
                before / {sampledBlocks(a.after) ?? "Unavailable"} latest. Sync
                after applying; sampled events do not prove causation.
              </p>
              {["applied", "uncertain"].includes(a.state) && (
                <Button
                  disabled={busy}
                  variant="outline"
                  size="sm"
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
    </AppPage>
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
  if (error) return <p className="text-sm text-destructive">{apiErrorMessage(error)}</p>;
  if (!d)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Analytics unavailable. Queue a sync and check Work queue.
        </p>
        <DataList
          title="Flagged IPs"
          url={`/api/cloudflare/assets/${id}/flagged-ips`}
          render={(r) => (
            <p className="text-sm text-muted-foreground">
              {r.ip_address} · {r.source} · {r.reason}{" "}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFlag(r.ip_address)}
              >
                Add to preview
              </Button>
            </p>
          )}
        />
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm">{d.notice}</p>
      <DataList
        title="Flagged IPs"
        url={`/api/cloudflare/assets/${id}/flagged-ips`}
        render={(r) => (
          <p className="text-sm text-muted-foreground">
            {r.ip_address} · {r.source} · {r.reason}{" "}
            <Button variant="outline" size="sm" onClick={() => onFlag(r.ip_address)}>
              Add to preview
            </Button>
          </p>
        )}
      />
      <p className="text-sm text-muted-foreground">
        Bot traffic share (score 1–29 among scored requests):{" "}
        {d.botShare == null
          ? "Unavailable on this plan or permission set"
          : `${(d.botShare * 100).toFixed(1)}%`}
      </p>
      <div className="divide-y rounded-xl border">
        {d.traffic?.map((day: any) => (
          <p key={day.dimensions?.date} className="px-4 py-2.5 text-sm text-muted-foreground">
            <b className="text-foreground">{day.dimensions?.date} UTC</b> ·
            Requests: {day.sum?.requests ?? "Unavailable"} · Unique visitors:{" "}
            {day.uniq?.uniques ?? "Unavailable"} · Page views:{" "}
            {day.sum?.pageViews ?? "Unavailable"} · Threats:{" "}
            {day.sum?.threats ?? "Unavailable"}
          </p>
        ))}
      </div>
      {["traffic", "events", "paths", "bots", "countries"].map((field) => (
        <DataList
          key={field}
          title={field}
          url={`/api/cloudflare/assets/${id}/cache?field=${field}`}
          render={(row) => (
            <pre className="whitespace-pre-wrap break-all text-xs">
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
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Search Console indexing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataList
          title="Scanned URL indexing"
          url={`/api/gsc/scans/${scanId}/indexing`}
          render={(r) => (
            <p className="text-sm text-muted-foreground">
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
    <p className="text-sm text-muted-foreground">
      Inspected URL coverage:{" "}
      {data?.coverage?.length
        ? data.coverage
            .map((c: any) => `${c.verdict ?? "Unknown"}: ${c.count}`)
            .join(" · ")
        : "Unavailable"}
    </p>
  );
}
