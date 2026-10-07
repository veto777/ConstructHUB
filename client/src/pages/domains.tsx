import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Eye, Globe, Link2, Plus, RefreshCw, ShieldCheck, Undo2 } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { AppPage, Toolbar, Notice } from "@/components/app-ui";
import { GoogleSurface, GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass =
  "h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";
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
          : "Saved.",
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
  // Google's format (owner, 2026-10-07): a quiet page title, section headings with a hairline, pill actions.
  const header = (
    <GoogleSectionHeader
      as="h1"
      title="Domains"
      description="Watch client domains, expiry and DNS — registration stays with your registrar."
      flush
      actions={
        <Link href="/mail-alerts" asChild>
          <GooglePill icon={ArrowRight} label="Provider mail alerts" href="/mail-alerts" testId="link-domains-mail-alerts" />
        </Link>
      }
    />
  );
  const planGate = [loadError, guidesError].find((e) => planRequiredFrom(e));
  if (planGate)
    return (
      <GoogleSurface page>
        <AppPage width="wide" testId="page-domains">
          {header}
          <PlanRequired
            module="domainsMailAlerts"
            error={planGate}
            className="max-w-3xl"
          />
        </AppPage>
      </GoogleSurface>
    );
  return (
    <GoogleSurface page>
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
      <section>
        <GoogleSectionHeader
          title="Connect registrar"
          description="Use a Porkbun or Name.com API key to sync and change client DNS."
        />
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
            <span className="g-text-2">Registrar</span>
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
            <span className="g-text-2">Connection label</span>
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
            <span className="g-text-2">
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
            <span className="g-text-2">Secret / API token</span>
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
          <GooglePill
            type="submit"
            variant="solid"
            icon={Link2}
            disabled={busy}
            className="w-full sm:w-auto"
            label={`Connect ${provider === "namecom" ? "Name.com" : "Porkbun"}`}
          />
        </form>
        {(connections?.items || []).length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 g-divider pt-4">
            {connections.items.map((c: any) => (
              <span key={c.id} className="g-chip g-chip--sm">
                {c.label} · {c.provider}
              </span>
            ))}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <GooglePill
                icon={RefreshCw}
                size="sm"
                disabled={busy}
                onClick={() =>
                  act("/sync", {
                    connectionIds: connections.items.map((c: any) =>
                      Number(c.id),
                    ),
                  })
                }
                label="Sync connections"
              />
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={connectionPage === 1}
                onClick={() => setConnectionPage((p) => p - 1)}
                label="Previous connections"
              />
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={connections?.items?.length < 25}
                onClick={() => setConnectionPage((p) => p + 1)}
                label="Next connections"
              />
            </div>
          </div>
        )}
      </section>
      <section>
        <GoogleSectionHeader
          title="Add domains"
          description="Track domains your registrar can't reach — comma-separated, up to 100 at a time."
        />
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
          <GooglePill type="submit" icon={Plus} disabled={busy} className="w-full sm:w-auto" label="Add domains" />
        </form>
        {manualError && (
          <p id="manual-domains-error" role="alert" className="mt-2 text-sm g-closed">
            {manualError}
          </p>
        )}
      </section>
      <section data-testid="section-domain-inventory">
        <GoogleSectionHeader title="Domain inventory" count={domains?.total || 0} />
        <div className="space-y-3">
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
            <label className="flex h-10 items-center gap-2 text-sm g-text-2">
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
              <span className="text-sm tabular-nums g-text-2">
                {selected.length} selected
              </span>
            )}
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <GooglePill
                icon={ShieldCheck}
                size="sm"
                disabled={!selected.length || busy}
                onClick={() => act("/monitor", { ids: selected })}
                label="Check selected domains"
              />
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
                <div className="flex flex-wrap items-center gap-2">
                  <GooglePill
                    variant="quiet"
                    size="sm"
                    disabled={locationPage === 1}
                    onClick={() => setLocationPage((p) => p - 1)}
                    label="Previous clients"
                  />
                  <GooglePill
                    variant="quiet"
                    size="sm"
                    disabled={locations?.items?.length < 25}
                    onClick={() => setLocationPage((p) => p + 1)}
                    label="Next clients"
                  />
                </div>
                <GooglePill
                  size="sm"
                  disabled={!selected.length || busy}
                  onClick={() =>
                    act("/mapping", {
                      ids: selected,
                      locationId: location ? Number(location) : null,
                    })
                  }
                  label="Map selected to client"
                />
              </div>
            </div>
          </div>
          {loadError && <Notice tone="danger">Could not load domains.</Notice>}
          {isLoading ? (
            <p className="text-sm g-text-2">Loading domains…</p>
          ) : (
            <>
              {domains?.items?.length ? (
                <GoogleList testId="list-domains">
                  {domains.items.map((d: any) => (
                    <GoogleListRow
                      key={d.id}
                      size="md"
                      testId={`row-domain-${d.id}`}
                      title={
                        <label className="inline-flex cursor-pointer items-center gap-3">
                          <input
                            aria-label={`Select ${d.domain}`}
                            type="checkbox"
                            checked={selected.includes(Number(d.id))}
                            onChange={() => toggle(Number(d.id))}
                          />
                          <span>{d.domain}</span>
                        </label>
                      }
                      meta={[
                        d.registrar,
                        d.location_name || d.location_id || "Unmapped",
                        d.state?.expires
                          ? `Expires ${new Date(d.state.expires).toLocaleDateString()}`
                          : "Expiry unknown",
                        `Auto-renew ${d.state?.autoRenew === true ? "On" : d.state?.autoRenew === false ? "Off" : "Unknown"}`,
                        d.checked_at
                          ? `DNS checked ${new Date(d.checked_at).toLocaleString()}`
                          : "DNS never checked",
                      ]}
                      line={d.state?.nameservers?.join(", ") || "Nameservers not yet checked"}
                    />
                  ))}
                </GoogleList>
              ) : (
                <p className="py-6 text-sm g-text-2">
                  No domains found. Connect a registrar or add domains above.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <GooglePill
                  size="sm"
                  disabled={page === 1}
                  onClick={() => {
                    setPage((p) => p - 1);
                    setSelected([]);
                  }}
                  label="Previous domains"
                />
                <span className="text-sm tabular-nums g-text-2">
                  Page {page} · {domains?.total || 0} domains
                </span>
                <GooglePill
                  size="sm"
                  disabled={page * 25 >= (domains?.total || 0)}
                  onClick={() => {
                    setPage((p) => p + 1);
                    setSelected([]);
                  }}
                  label="Next domains"
                />
              </div>
            </>
          )}
        </div>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <GoogleSectionHeader title="Nameservers for selected domains" />
          <div className="space-y-3">
            <p className="text-sm g-text-2">
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
              <GooglePill
                icon={Eye}
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
                label="Preview nameservers"
              />
              <GooglePill
                variant="quiet"
                disabled={!selected.length || busy}
                onClick={() => act("/cloudflare-preview", { ids: selected })}
                label="Preview assigned Cloudflare pair"
              />
            </div>
          </div>
        </section>
        <section>
          <GoogleSectionHeader title="DNS record change" />
          <div className="space-y-3">
            <p className="text-sm g-text-2">
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
                <span className="g-text-2">TTL</span>
                <Input
                  aria-label="Record TTL"
                  type="number"
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                />
              </label>
              <label className="flex-1 space-y-1.5 text-sm sm:flex-none">
                <span className="g-text-2">MX priority</span>
                <Input
                  aria-label="MX priority"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                />
              </label>
            </div>
            <GooglePill
              icon={Eye}
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
              label="Preview DNS change"
            />
          </div>
        </section>
      </div>
      <section data-testid="section-domain-jobs">
        <GoogleSectionHeader
          title="Previews and change history"
          description="Review the diff, confirm, and verify your identity. Applied changes stay pending until public DNS agrees."
          flush
        />
        <div className="space-y-3">
          {(jobs?.items || []).length > 0 && (
            <GoogleList testId="list-domain-jobs">
              {(jobs?.items || []).map((j: any) => (
                <details key={j.id} className="g-card">
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
                    <span className="g-text">{j.domain || "Registrar inventory"}</span>
                    <span className="g-text-2"> · {j.kind} · </span>
                    <strong>{j.status}</strong>
                  </summary>
                  {j.error && (
                    <p role="alert" className="mt-2 text-sm g-closed">
                      {j.error}
                    </p>
                  )}
                  {j.before_state && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <h3 className="text-sm">Before</h3>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs g-text-2">
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
                        <h3 className="text-sm">After</h3>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs g-text-2">
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
            </GoogleList>
          )}
          {!jobs?.items?.length && (
            <p className="pt-4 text-sm g-text-2">
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
            <GooglePill
              icon={ShieldCheck}
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
              label="Confirm selected previews"
            />
            <GooglePill
              icon={Undo2}
              variant="quiet"
              disabled={!jobSelection.length || busy}
              onClick={() => act("/rollback-preview", { jobIds: jobSelection })}
              label="Preview rollback of selected changes"
            />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={jobPage === 1}
                onClick={() => {
                  setJobSelection([]);
                  setJobPage((p) => p - 1);
                }}
                label="Previous jobs"
              />
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={jobs?.items?.length < 25}
                onClick={() => {
                  setJobSelection([]);
                  setJobPage((p) => p + 1);
                }}
                label="Next jobs"
              />
            </div>
          </div>
        </div>
      </section>
      <section>
        <GoogleSectionHeader title="Registrar walkthroughs" flush />
        <div className="space-y-3">
          <p className="pt-4 text-sm g-text-2">
            Server egress IP for allowlists:{" "}
            {guides?.egressIp || "Not configured — ask your administrator"}
          </p>
          {guides?.guides?.length > 0 && (
            <GoogleList testId="list-registrar-guides">
              {guides.guides.map((g: any) => (
                <details key={g.id} className="g-card">
                  <summary className="cursor-pointer text-sm">
                    <span className="g-text">{g.name}</span>
                    <span className="g-text-2"> · {g.mode}</span>
                  </summary>
                  <ol className="list-decimal py-2 pl-6 text-sm">
                    {g.steps.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  <div className="g-card__actions">
                    <GooglePill icon={Globe} size="sm" label="Official documentation" href={g.url} external />
                  </div>
                </details>
              ))}
            </GoogleList>
          )}
        </div>
      </section>
    </AppPage>
    </GoogleSurface>
  );
}
