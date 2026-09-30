import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
const selectClass = "border rounded-md p-2 bg-background";
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
  } = useQuery<any>({ queryKey: [domainsUrl], refetchInterval: 5000 });
  const { data: guides } = useQuery<any>({ queryKey: ["/api/domains/guides"] });
  const { data: connections } = useQuery<any>({
    queryKey: [`/api/domains/connections?page=${connectionPage}`],
  });
  const { data: jobs } = useQuery<any>({
    queryKey: [`/api/domains/jobs?page=${jobPage}&q=${encodeURIComponent(q)}`],
    refetchInterval: 3000,
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
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold">Domains</h1>
        <p className="text-muted-foreground">
          Manage client DNS and nameservers. Domain registration stays with your
          registrar.
        </p>
        <Link className="underline" href="/mail-alerts">
          Provider mail alerts →
        </Link>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {guides && !guides.workerEnabled && (
        <p className="rounded border p-3">
          Domain background processing is disabled. Your administrator must
          enable it before queued previews, changes and monitoring can run.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Connect registrar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            For API automation, use Porkbun or Name.com. Keep existing
            registrations; moving DNS to Cloudflare only changes nameservers.
          </p>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("/connections", { provider, label, key, secret })) {
                setKey("");
                setSecret("");
              }
            }}
          >
            <select
              aria-label="Registrar"
              className={selectClass}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="porkbun">Porkbun</option>
              <option value="namecom">Name.com CORE</option>
            </select>
            <Input
              aria-label="Connection label"
              placeholder="Client / account label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              className="w-48"
            />
            <Input
              aria-label="API key or username"
              type="password"
              autoComplete="off"
              placeholder={provider === "namecom" ? "Username" : "API key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              className="w-48"
            />
            <Input
              aria-label="API secret or token"
              type="password"
              autoComplete="new-password"
              placeholder="Secret / API token"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              className="w-48"
            />
            <Button disabled={busy}>Connect with identity verification</Button>
          </form>
          {(connections?.items || []).map((c: any) => (
            <span key={c.id} className="inline-block border rounded p-2 mr-2">
              {c.label} · {c.provider}
            </span>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || !connections?.items?.length}
              onClick={() =>
                act("/sync", {
                  connectionIds: connections.items.map((c: any) =>
                    Number(c.id),
                  ),
                })
              }
            >
              Sync connections on this page
            </Button>
            <Button
              variant="ghost"
              disabled={connectionPage === 1}
              onClick={() => setConnectionPage((p) => p - 1)}
            >
              Previous connections
            </Button>
            <Button
              variant="ghost"
              disabled={connections?.items?.length < 25}
              onClick={() => setConnectionPage((p) => p + 1)}
            >
              Next connections
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            Add domains for manual management and monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act("/manual", {
                  domains: manual.split(/[\s,]+/).filter(Boolean),
                })
              )
                setManual("");
            }}
          >
            <Input
              aria-label="Manual domains"
              placeholder="example.com, client.example"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              required
            />
            <Button disabled={busy}>Add domains</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Domain inventory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              aria-label="Search domains"
              placeholder="Search domains"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setJobSelection([]);
                setPage(1);
                setSelected([]);
              }}
            />
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
          </div>
          {loadError && <p role="alert">Could not load domains.</p>}
          {isLoading ? (
            <p>Loading domains…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th>
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
                    </th>
                    <th>Domain</th>
                    <th>Registrar</th>
                    <th>Client location</th>
                    <th>Expiry / auto-renew</th>
                    <th>Last DNS check</th>
                  </tr>
                </thead>
                <tbody>
                  {domains?.items?.map((d: any) => (
                    <tr key={d.id} className="border-b">
                      <td className="p-3">
                        <input
                          aria-label={`Select ${d.domain}`}
                          type="checkbox"
                          checked={selected.includes(Number(d.id))}
                          onChange={() => toggle(Number(d.id))}
                        />
                      </td>
                      <td>
                        {d.domain}
                        <p className="text-xs text-muted-foreground">
                          {d.state?.nameservers?.join(", ") ||
                            "Nameservers not yet checked"}
                        </p>
                      </td>
                      <td>{d.registrar}</td>
                      <td>{d.location_id || "Unmapped"}</td>
                      <td>
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
                      <td>
                        {d.checked_at
                          ? new Date(d.checked_at).toLocaleString()
                          : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!domains?.items?.length && (
                <p className="py-4">
                  No domains found. Connect a registrar or add domains above.
                </p>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected([]);
              }}
            >
              Previous domains
            </Button>
            <span>
              Page {page} · {domains?.total || 0} domains
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= (domains?.total || 0)}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected([]);
              }}
            >
              Next domains
            </Button>
            <Button
              disabled={!selected.length || busy}
              onClick={() => act("/monitor", { ids: selected })}
            >
              Check selected domains
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Find client location"
              placeholder="Search client name or website"
              value={locationQuery}
              onChange={(e) => {
                setLocationQuery(e.target.value);
                setLocationPage(1);
              }}
              className="w-64"
            />
            <select
              aria-label="Client location"
              className={selectClass}
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
            <Button
              variant="ghost"
              disabled={locationPage === 1}
              onClick={() => setLocationPage((p) => p - 1)}
            >
              Previous clients
            </Button>
            <Button
              variant="ghost"
              disabled={locations?.items?.length < 25}
              onClick={() => setLocationPage((p) => p + 1)}
            >
              Next clients
            </Button>
            <Button
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
        </CardContent>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Nameservers for selected domains</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              First copy all website and email records to the new DNS provider.
              Review DNSSEC with your registrar before switching. A nameserver
              change can interrupt the website and email.
            </p>
            <Input
              aria-label="Nameservers"
              placeholder="Assigned nameservers, separated by commas"
              value={ns}
              onChange={(e) => setNs(e.target.value)}
            />
            <Button
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
              variant="outline"
              className="ml-2"
              disabled={!selected.length || busy}
              onClick={() => act("/cloudflare-preview", { ids: selected })}
            >
              Preview assigned Cloudflare pair
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>DNS record change</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              Applies to every selected domain. For update/delete, the worker
              must find exactly one record with this type and name.
              Cloudflare-hosted zones are managed in Cloudflare.
            </p>
            <div className="flex gap-2">
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
              <label>
                TTL
                <Input
                  aria-label="Record TTL"
                  type="number"
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                />
              </label>
              <label>
                MX priority
                <Input
                  aria-label="MX priority"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                />
              </label>
            </div>
            <Button
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
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Previews and change history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Review the diff, select ready previews, confirm, and verify your
            identity. Applied changes stay pending until public DNS agrees.
          </p>
          {(jobs?.items || []).map((j: any) => (
            <details key={j.id} className="border rounded p-3">
              <summary className="cursor-pointer">
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
              {j.error && <p role="alert">{j.error}</p>}
              {j.before_state && (
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <h3 className="font-semibold">Before</h3>
                    <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64">
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
                    <h3 className="font-semibold">After</h3>
                    <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-64">
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
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={warning}
              onChange={(e) => setWarning(e.target.checked)}
            />
            I reviewed the changes and understand that MX, TXT, CNAME or
            nameserver changes can break email and website access.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
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
              variant="outline"
              disabled={!jobSelection.length || busy}
              onClick={() => act("/rollback-preview", { jobIds: jobSelection })}
            >
              Preview rollback of selected changes
            </Button>
            <Button
              variant="ghost"
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
              disabled={jobs?.items?.length < 25}
              onClick={() => {
                setJobSelection([]);
                setJobPage((p) => p + 1);
              }}
            >
              Next jobs
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Registrar walkthroughs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Server egress IP for allowlists:{" "}
            {guides?.egressIp || "Not configured — ask your administrator"}
          </p>
          {guides?.guides?.map((g: any) => (
            <details key={g.id} className="border rounded p-3">
              <summary>
                {g.name} · {g.mode}
              </summary>
              <ol className="list-decimal pl-6 py-2">
                {g.steps.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <a
                className="underline"
                href={g.url}
                target="_blank"
                rel="noreferrer"
              >
                Official documentation
              </a>
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
