import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  AppPage,
  PageHeader,
  Section,
  Toolbar,
  Notice,
  appTable,
  appTableCards,
} from "@/components/app-ui";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";
// Mirrors the server's domainName check (server/domains/types.ts).
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export default function DomainsPage() {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [registrar, setRegistrar] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("porkbun"),
    [label, setLabel] = useState(""),
    [key, setKey] = useState(""),
    [secret, setSecret] = useState(""),
    [manual, setManual] = useState(""),
    [manualError, setManualError] = useState(""),
    [ns, setNs] = useState("");
  const [kind, setKind] = useState("create"),
    [type, setType] = useState("A"),
    [recordName, setRecordName] = useState("@"),
    [content, setContent] = useState(""),
    [ttl, setTtl] = useState(600),
    [priority, setPriority] = useState(0);
  const [jobPage, setJobPage] = useState(1),
    [jobSelection, setJobSelection] = useState<string[]>([]),
    [warning, setWarning] = useState(false),
    [locationQuery, setLocationQuery] = useState(""),
    [location, setLocation] = useState(""),
    [locationPage, setLocationPage] = useState(1),
    [connectionPage, setConnectionPage] = useState(1);
  const domainsUrl = `/api/domains?${new URLSearchParams({ q, page: String(page), registrar })}`;
  const {
    data: domains,
    isLoading,
    error: loadError,
  } = useQuery<any>({
    queryKey: [domainsUrl],
    refetchInterval: pollUnlessPlanRequired(5000),
  });
  const { data: guides, error: guidesError } = useQuery<any>({
    queryKey: ["/api/domains/guides"],
  });
  const { data: connections } = useQuery<any>({
    queryKey: [`/api/domains/connections?page=${connectionPage}`],
  });
  const { data: jobs } = useQuery<any>({
    queryKey: [`/api/domains/jobs?page=${jobPage}&q=${encodeURIComponent(q)}`],
    refetchInterval: pollUnlessPlanRequired(3000),
  });
  const { data: locations } = useQuery<any>({
    queryKey: [
      `/api/domains/locations?q=${encodeURIComponent(locationQuery)}&page=${locationPage}`,
    ],
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (x) => String(x.queryKey[0]).startsWith("/api/domains"),
    });
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await apiRequest("POST", `/api/domains${path}`, body);
      const d = await r.json();
      setNotice(
        d.jobs
          ? "Preview jobs queued. Review their before/after values below before confirming."
          : "Saved. Background work will appear below.",
      );
      await refresh();
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, "Operation failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: number) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const header = (
    <PageHeader
      title="Domains"
      description="Watch client domains, expiry and DNS — registration stays with your registrar."
      actions={
        <Button variant="ghost" asChild>
          <Link href="/mail-alerts" data-testid="link-domains-mail-alerts">
            Provider mail alerts <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      }
    />
  );
  const planGate = [loadError, guidesError].find((e) => planRequiredFrom(e));
  if (planGate)
    return (
      <AppPage width="wide" testId="page-domains">
        {header}
        <PlanRequired
          module="domainsMailAlerts"
          error={planGate}
          className="max-w-3xl"
        />
      </AppPage>
    );
  return (
    <AppPage width="wide" testId="page-domains">
      {header}
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {guides && !guides.workerEnabled && (
        <Notice tone="warning">
          Domain background processing is off. Your administrator must enable
          it before queued previews, changes and monitoring can run.
        </Notice>
      )}
      <Section
        title="Connect registrar"
        description="Use a Porkbun or Name.com API key to sync and change client DNS."
      >
        <form
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("/connections", { provider, label, key, secret })) {
              setKey("");
              setSecret("");
            }
          }}
        >
          <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:flex-none">
            <span className="text-muted-foreground">Registrar</span>
            <select
              aria-label="Registrar"
              className={selectClass}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="porkbun">Porkbun</option>
              <option value="namecom">Name.com CORE</option>
            </select>
          </label>
          <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:flex-none">
            <span className="text-muted-foreground">Connection label</span>
            <Input
              aria-label="Connection label"
              placeholder="Client / account label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              className="sm:w-56"
            />
          </label>
          <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:flex-none">
            <span className="text-muted-foreground">
              {provider === "namecom" ? "Username" : "API key"}
            </span>
            <Input
              aria-label="API key or username"
              type="password"
              autoComplete="off"
              placeholder={provider === "namecom" ? "Username" : "API key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              className="sm:w-56"
            />
          </label>
          <label className="block min-w-0 flex-1 space-y-1.5 text-sm sm:flex-none">
            <span className="text-muted-foreground">Secret / API token</span>
            <Input
              aria-label="API secret or token"
              type="password"
              autoComplete="new-password"
              placeholder="Secret / API token"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              className="sm:w-56"
            />
          </label>
          <Button disabled={busy} className="w-full sm:w-auto">
            Connect {provider === "namecom" ? "Name.com" : "Porkbun"}
          </Button>
        </form>
        {(connections?.items || []).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            {connections.items.map((c: any) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
              >
                {c.label} · {c.provider}
              </span>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  act("/sync", {
                    connectionIds: connections.items.map((c: any) =>
                      Number(c.id),
                    ),
                  })
                }
              >
                Sync connections
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={connectionPage === 1}
                onClick={() => setConnectionPage((p) => p - 1)}
              >
                Previous connections
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={connections?.items?.length < 25}
                onClick={() => setConnectionPage((p) => p + 1)}
              >
                Next connections
              </Button>
            </div>
          </div>
        )}
      </Section>
      <Section
        title="Add domains"
        description="Track domains your registrar can't reach — comma-separated, up to 100 at a time."
      >
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            // Checked here so blank or malformed entries are named without a round trip.
            const domains = manual.split(/[\s,]+/).filter(Boolean);
            const invalid = domains.filter(
              (d) => d.length > 253 || !domainPattern.test(d.toLowerCase()),
            );
            if (!domains.length || invalid.length || domains.length > 100) {
              setManualError(
                !domains.length
                  ? "Enter at least one domain, like example.com."
                  : invalid.length
                    ? `Not a valid domain name: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ""}. Use the bare domain, like example.com.`
                    : "Add up to 100 domains at a time.",
              );
              return;
            }
            setManualError("");
            if (await act("/manual", { domains })) setManual("");
          }}
        >
          <Input
            aria-label="Manual domains"
            placeholder="example.com, client.example"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
              setManualError("");
            }}
            aria-invalid={!!manualError}
            aria-describedby={manualError ? "manual-domains-error" : undefined}
            required
            className="w-full sm:max-w-md"
          />
          <Button variant="outline" disabled={busy} className="w-full sm:w-auto">
            Add domains
          </Button>
        </form>
        {manualError && (
          <p id="manual-domains-error" role="alert" className="mt-2 text-sm text-destructive">
            {manualError}
          </p>
        )}
      </Section>
      <Section
        title="Domain inventory"
        flush
        testId="section-domain-inventory"
      >
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          <Toolbar
            search={{
              value: q,
              onChange: (v) => {
                setQ(v);
                setJobSelection([]);
                setPage(1);
                setSelected([]);
              },
              placeholder: "Search domains",
            }}
            activeFilters={registrar ? 1 : 0}
            filters={
              <select
                className={selectClass}
                aria-label="Filter registrar"
                value={registrar}
                onChange={(e) => {
                  setRegistrar(e.target.value);
                  setPage(1);
                  setSelected([]);
                }}
              >
                <option value="">All registrars</option>
                {[
                  "porkbun",
                  "namecom",
                  "manual",
                  "squarespace",
                  "wix",
                  "hover",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <input
                aria-label="Select page"
                type="checkbox"
                checked={
                  !!domains?.items?.length &&
                  domains.items.every((d: any) =>
                    selected.includes(Number(d.id)),
                  )
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? domains.items.map((d: any) => Number(d.id))
                      : [],
                  )
                }
              />
              Select page
            </label>
            {selected.length > 0 && (
              <span className="text-sm tabular-nums text-muted-foreground">
                {selected.length} selected
              </span>
            )}
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                variant="outline"
                size="sm"
                disabled={!selected.length || busy}
                onClick={() => act("/monitor", { ids: selected })}
              >
                Check selected domains
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Input
                  aria-label="Find client location"
                  placeholder="Search client name or website"
                  value={locationQuery}
                  onChange={(e) => {
                    setLocationQuery(e.target.value);
                    setLocationPage(1);
                  }}
                  className="h-9 w-full sm:w-56"
                />
                <select
                  aria-label="Client location"
                  className={`${selectClass} h-9`}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="">Unmapped</option>
                  {locations?.items?.map((l: any) => (
                    <option key={l.id} value={l.id}>
                      {l.business_name} · {l.website || "No website"}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={locationPage === 1}
                    onClick={() => setLocationPage((p) => p - 1)}
                  >
                    Previous clients
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={locations?.items?.length < 25}
                    onClick={() => setLocationPage((p) => p + 1)}
                  >
                    Next clients
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selected.length || busy}
                  onClick={() =>
                    act("/mapping", {
                      ids: selected,
                      locationId: location ? Number(location) : null,
                    })
                  }
                >
                  Map selected to client
                </Button>
              </div>
            </div>
          </div>
          {loadError && <Notice tone="danger">Could not load domains.</Notice>}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading domains…</p>
          ) : (
            <>
              <div className={appTable.wrapper}>
                <table className={appTable.table}>
                  <thead className={appTable.thead}>
                    <tr>
                      <th className={appTable.th} />
                      <th className={appTable.th}>Domain</th>
                      <th className={appTable.th}>Registrar</th>
                      <th className={appTable.th}>Client location</th>
                      <th className={`${appTable.th} hidden sm:table-cell`}>
                        Expiry / auto-renew
                      </th>
                      <th className={`${appTable.th} hidden sm:table-cell`}>
                        Last DNS check
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains?.items?.map((d: any) => (
                      <tr
                        key={d.id}
                        className={`${appTable.tr} ${appTableCards.tr}`}
                      >
                        <td className={`${appTable.td} ${appTableCards.td}`}>
                          <input
                            aria-label={`Select ${d.domain}`}
                            type="checkbox"
                            checked={selected.includes(Number(d.id))}
                            onChange={() => toggle(Number(d.id))}
                          />
                        </td>
                        <td className={`${appTable.td} ${appTableCards.td}`}>
                          <span className="font-medium">{d.domain}</span>
                          <p className="break-all text-xs text-muted-foreground">
                            {d.state?.nameservers?.join(", ") ||
                              "Nameservers not yet checked"}
                          </p>
                        </td>
                        <td className={`${appTable.td} ${appTableCards.td}`}>
                          <span className="sm:hidden text-muted-foreground">
                            Registrar:{" "}
                          </span>
                          {d.registrar}
                        </td>
                        <td className={`${appTable.td} ${appTableCards.td}`}>
                          <span className="sm:hidden text-muted-foreground">
                            Client location:{" "}
                          </span>
                          {d.location_id || "Unmapped"}
                        </td>
                        <td
                          className={`${appTable.td} ${appTableCards.td} hidden sm:table-cell`}
                        >
                          {d.state?.expires
                            ? new Date(d.state.expires).toLocaleDateString()
                            : "Unknown"}{" "}
                          /{" "}
                          {d.state?.autoRenew === true
                            ? "On"
                            : d.state?.autoRenew === false
                              ? "Off"
                              : "Unknown"}
                        </td>
                        <td
                          className={`${appTable.td} ${appTableCards.td} hidden sm:table-cell`}
                        >
                          {d.checked_at
                            ? new Date(d.checked_at).toLocaleString()
                            : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!domains?.items?.length && (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    No domains found. Connect a registrar or add domains above.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => {
                    setPage((p) => p - 1);
                    setSelected([]);
                  }}
                >
                  Previous domains
                </Button>
                <span className="text-sm tabular-nums text-muted-foreground">
                  Page {page} · {domains?.total || 0} domains
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 25 >= (domains?.total || 0)}
                  onClick={() => {
                    setPage((p) => p + 1);
                    setSelected([]);
                  }}
                >
                  Next domains
                </Button>
              </div>
            </>
          )}
        </div>
      </Section>
      <div className="grid gap-4 md:grid-cols-2 sm:gap-5">
        <Section title="Nameservers for selected domains">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Copy website and email records first. A nameserver change can
              interrupt the website and email.
            </p>
            <Input
              aria-label="Nameservers"
              placeholder="Assigned nameservers, separated by commas"
              value={ns}
              onChange={(e) => setNs(e.target.value)}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                variant="outline"
                disabled={!selected.length || busy}
                onClick={() =>
                  act("/preview", {
                    ids: selected,
                    change: {
                      kind: "nameservers",
                      nameservers: ns.split(/[\s,]+/).filter(Boolean),
                    },
                  })
                }
              >
                Preview nameservers
              </Button>
              <Button
                variant="ghost"
                disabled={!selected.length || busy}
                onClick={() => act("/cloudflare-preview", { ids: selected })}
              >
                Preview assigned Cloudflare pair
              </Button>
            </div>
          </div>
        </Section>
        <Section title="DNS record change">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Applies to every selected domain. Cloudflare-hosted zones are
              managed in Cloudflare.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={selectClass}
                aria-label="DNS operation"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {["create", "update", "delete"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <select
                className={selectClass}
                aria-label="Record type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {["A", "AAAA", "CNAME", "TXT", "MX", "CAA"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <Input
                aria-label="Record name"
                value={recordName}
                onChange={(e) => setRecordName(e.target.value)}
                placeholder="@ or www"
              />
            </div>
            <Input
              aria-label="Record value"
              placeholder="DNS record value (current value for delete)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="flex gap-2">
              <label className="flex-1 space-y-1.5 text-sm sm:flex-none">
                <span className="text-muted-foreground">TTL</span>
                <Input
                  aria-label="Record TTL"
                  type="number"
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 space-y-1.5 text-sm sm:flex-none">
                <span className="text-muted-foreground">MX priority</span>
                <Input
                  aria-label="MX priority"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                />
              </label>
            </div>
            <Button
              variant="outline"
              disabled={!selected.length || busy}
              onClick={() =>
                act("/preview", {
                  ids: selected,
                  change: {
                    kind,
                    record: { type, name: recordName, content, ttl, priority },
                  },
                })
              }
            >
              Preview DNS change
            </Button>
          </div>
        </Section>
      </div>
      <Section
        title="Previews and change history"
        description="Review the diff, confirm, and verify your identity. Applied changes stay pending until public DNS agrees."
        flush
        testId="section-domain-jobs"
      >
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          {(jobs?.items || []).map((j: any) => (
            <details key={j.id} className="rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-sm">
                <input
                  aria-label={`Select job ${j.id}`}
                  type="checkbox"
                  checked={jobSelection.includes(j.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setJobSelection((s) =>
                      e.target.checked
                        ? [...s, j.id]
                        : s.filter((x) => x !== j.id),
                    )
                  }
                  className="mr-3"
                />
                {j.domain || "Registrar inventory"} · {j.kind} ·{" "}
                <strong>{j.status}</strong>
              </summary>
              {j.error && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {j.error}
                </p>
              )}
              {j.before_state && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold">Before</h3>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(
                        {
                          nameservers: j.before_state.nameservers,
                          records: j.before_state.records,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">After</h3>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(
                        {
                          nameservers: j.after_state?.nameservers,
                          records: j.after_state?.records,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                </div>
              )}
            </details>
          ))}
          {!jobs?.items?.length && (
            <p className="text-sm text-muted-foreground">
              No previews yet. Select domains above and preview a change.
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={warning}
              onChange={(e) => setWarning(e.target.checked)}
            />
            I reviewed the changes and understand that MX, TXT, CNAME or
            nameserver changes can break email and website access.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={!jobSelection.length || busy}
              onClick={async () => {
                if (
                  await act("/confirm", {
                    jobIds: jobSelection,
                    confirmed: true,
                    emailWarningAccepted: warning,
                  })
                ) {
                  setJobSelection([]);
                  setWarning(false);
                }
              }}
            >
              Confirm selected previews
            </Button>
            <Button
              variant="ghost"
              disabled={!jobSelection.length || busy}
              onClick={() => act("/rollback-preview", { jobIds: jobSelection })}
            >
              Preview rollback of selected changes
            </Button>
            <div className="flex items-center gap-1 sm:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                disabled={jobPage === 1}
                onClick={() => {
                  setJobSelection([]);
                  setJobPage((p) => p - 1);
                }}
              >
                Previous jobs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={jobs?.items?.length < 25}
                onClick={() => {
                  setJobSelection([]);
                  setJobPage((p) => p + 1);
                }}
              >
                Next jobs
              </Button>
            </div>
          </div>
        </div>
      </Section>
      <Section title="Registrar walkthroughs">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Server egress IP for allowlists:{" "}
            {guides?.egressIp || "Not configured — ask your administrator"}
          </p>
          {guides?.guides?.map((g: any) => (
            <details key={g.id} className="rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-sm">
                {g.name} · {g.mode}
              </summary>
              <ol className="list-decimal py-2 pl-6 text-sm">
                {g.steps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <a
                className="text-sm text-primary underline"
                href={g.url}
                target="_blank"
                rel="noreferrer"
              >
                Official documentation
              </a>
            </details>
          ))}
        </div>
      </Section>
    </AppPage>
  );
}
