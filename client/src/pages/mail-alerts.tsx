import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { requestRecentAuth } from "@/components/recent-auth";
export default function MailAlertsPage() {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [category, setCategory] = useState(""),
    [severity, setSeverity] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accountPage, setAccountPage] = useState(1);
  const [clientQuery, setClientQuery] = useState(""),
    [clientPage, setClientPage] = useState(1),
    [clientId, setClientId] = useState("");
  const { data: settings } = useQuery<any>({
    queryKey: [`/api/mail-alerts/settings?page=${accountPage}`],
  });
  const { data: messages, isLoading } = useQuery<any>({
    queryKey: [
      `/api/mail-alerts?${new URLSearchParams({ q, page: String(page), category, severity })}`,
    ],
    refetchInterval: 5000,
  });
  const { data: clients } = useQuery<any>({
    queryKey: [
      `/api/domains/locations?q=${encodeURIComponent(clientQuery)}&page=${clientPage}`,
    ],
  });
  const action = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", `/api/mail-alerts${path}`, body);
      setSelected([]);
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("/api/mail-alerts"),
      });
    } catch (e) {
      setError(apiErrorMessage(e, "Operation failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold">Mail alerts</h1>
        <p className="text-muted-foreground">
          Known provider alerts for your client accounts. Matched messages
          expire within 30 days.
        </p>
        <Link href="/domains" className="underline">
          Manage domains →
        </Link>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Set up Gmail forwarding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>Your private forwarding address:</p>
          <Input
            readOnly
            aria-label="Forwarding address"
            value={settings?.address || "Inbound mail domain is not configured"}
          />
          <ol className="list-decimal pl-6 space-y-1">
            <li>
              In Gmail, open Settings → See all settings → Forwarding and
              POP/IMAP.
            </li>
            <li>
              Choose Add a forwarding address and paste the address above.
            </li>
            <li>
              Find the forwarding confirmation below. Use its code or the Google
              confirmation link to finish setup.
            </li>
            <li>
              Create a Gmail filter for the provider senders below, then choose
              “Forward it to” your private address. Keep general inbox
              forwarding off to avoid sending unrelated mail.
            </li>
          </ol>
          <details>
            <summary>Known senders</summary>
            <p className="text-sm break-words">
              {Object.values(settings?.senders || {})
                .flat()
                .join(", ")}
            </p>
            <p>
              Registrar domains: {settings?.registrarSenders?.join(", ")}.
              Blotato: blotato.com. Only recognized alert subjects are retained.
            </p>
          </details>
          <p className="text-sm text-muted-foreground">
            Treat forwarded email as a reported alert. Sender matching alone
            does not verify that the sender is authentic. Open provider
            dashboards directly for security and billing actions.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Optional Gmail API connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings?.oauthEnabled ? (
            <>
              <Button
                onClick={async () => {
                  try {
                    await requestRecentAuth();
                    window.location.assign("/api/mail-alerts/oauth/connect");
                  } catch {
                    setError("Identity verification was not completed");
                  }
                }}
              >
                Connect Gmail with read-only access
              </Button>
              <Button
                className="ml-2"
                variant="outline"
                disabled={busy}
                onClick={() => action("/sync", {})}
              >
                Sync all connected Gmail accounts
              </Button>
              {settings?.grants?.map((g: any) => (
                <div key={g.google_subject} className="border p-3 rounded">
                  {g.email} ·{" "}
                  {g.needs_reconnect ? "Reconnect required" : "Connected"}{" "}
                  {g.last_error && <span role="alert">{g.last_error}</span>}
                  <Button
                    variant="outline"
                    className="ml-3"
                    disabled={busy}
                    onClick={() =>
                      action("/oauth/disconnect", { subject: g.google_subject })
                    }
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={accountPage === 1}
                  onClick={() => setAccountPage((p) => p - 1)}
                >
                  Previous accounts
                </Button>
                <Button
                  variant="ghost"
                  disabled={settings?.grants?.length < 25}
                  onClick={() => setAccountPage((p) => p + 1)}
                >
                  Next accounts
                </Button>
              </div>
            </>
          ) : (
            <p>
              Gmail API access is disabled. Forwarding works without Gmail
              restricted scopes. Public API use requires Google restricted-scope
              verification and the applicable annual CASA security assessment.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Provider inbox</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-md"
              aria-label="Search alerts"
              placeholder="Search subject or sender"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSelected([]);
                setPage(1);
              }}
            />
            <select
              aria-label="Alert category"
              className="border rounded p-2 bg-background"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSelected([]);
                setPage(1);
              }}
            >
              <option value="">All providers</option>
              {[
                "gbp",
                "gsc",
                "ads",
                "cloudflare",
                "registrar",
                "blotato",
                "forwarding",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Alert severity"
              className="border rounded p-2 bg-background"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setSelected([]);
                setPage(1);
              }}
            >
              <option value="">All severity levels</option>
              <option>critical</option>
              <option>warning</option>
              <option>info</option>
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <label>
              <input
                type="checkbox"
                aria-label="Select alert page"
                checked={
                  !!messages?.items?.length &&
                  messages.items.every((m: any) =>
                    selected.includes(Number(m.id)),
                  )
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? messages.items.map((m: any) => Number(m.id))
                      : [],
                  )
                }
              />{" "}
              Select page
            </label>
            <Button
              disabled={!selected.length || busy}
              onClick={() => action("/read", { ids: selected })}
            >
              Mark selected as read
            </Button>
          </div>
          {isLoading ? (
            <p>Loading alerts…</p>
          ) : !messages?.items?.length ? (
            <p>No matching provider alerts.</p>
          ) : (
            messages.items.map((m: any) => (
              <article
                key={m.id}
                className={`border rounded p-4 space-y-2 ${m.severity === "critical" ? "border-red-500" : ""}`}
              >
                <div className="flex gap-3 items-start">
                  <input
                    type="checkbox"
                    aria-label={`Select alert ${m.id}`}
                    checked={selected.includes(Number(m.id))}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, Number(m.id)]
                          : s.filter((x) => x !== Number(m.id)),
                      )
                    }
                  />
                  <div>
                    <h3 className="font-semibold">{m.subject}</h3>
                    <p className="text-xs text-muted-foreground">
                      {m.category} · {m.severity} · {m.sender} ·{" "}
                      {new Date(m.received_at).toLocaleString()} ·{" "}
                      {m.read_at ? "Read" : "Unread"} ·{" "}
                      {m.location_id
                        ? `Client location ${m.location_id}`
                        : "Unmapped / ambiguous client"}
                    </p>
                  </div>
                </div>
                {m.confirmation_code && (
                  <p className="text-lg">
                    Forwarding confirmation code:{" "}
                    <strong>{m.confirmation_code}</strong>
                  </p>
                )}
                {m.confirmation_link && (
                  <a
                    className="underline"
                    href={m.confirmation_link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Confirm forwarding at Google
                  </a>
                )}
                <details>
                  <summary>Read matched message</summary>
                  <p className="whitespace-pre-wrap break-words text-sm mt-2">
                    {m.body}
                  </p>
                </details>
              </article>
            ))
          )}
          <div className="flex gap-3 items-center">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected([]);
              }}
            >
              Previous alerts
            </Button>
            <span>
              Page {page} · {messages?.total || 0} alerts
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= (messages?.total || 0)}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected([]);
              }}
            >
              Next alerts
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Search client for alerts"
              placeholder="Search client name or website"
              className="w-64"
              value={clientQuery}
              onChange={(e) => {
                setClientQuery(e.target.value);
                setClientPage(1);
              }}
            />
            <select
              aria-label="Map alerts to client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="border rounded p-2 bg-background"
            >
              <option value="">Unmapped</option>
              {clients?.items?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.business_name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              disabled={clientPage === 1}
              onClick={() => setClientPage((p) => p - 1)}
            >
              Previous clients
            </Button>
            <Button
              variant="ghost"
              disabled={clients?.items?.length < 25}
              onClick={() => setClientPage((p) => p + 1)}
            >
              Next clients
            </Button>
            <Button
              disabled={!selected.length || busy}
              onClick={() =>
                action("/mapping", {
                  ids: selected,
                  locationId: clientId ? Number(clientId) : null,
                })
              }
            >
              Map selected alerts
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
