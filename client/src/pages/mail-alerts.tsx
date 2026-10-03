import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { requestRecentAuth } from "@/components/recent-auth";
import {
  AppPage,
  PageHeader,
  Section,
  Toolbar,
  Notice,
  StatusPill,
} from "@/components/app-ui";
import {
  PlanRequired,
  planRequiredFrom,
  pollUnlessPlanRequired,
} from "@/components/plan-required";
const selectClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto";
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
  const { data: settings, error: settingsError } = useQuery<any>({
    queryKey: [`/api/mail-alerts/settings?page=${accountPage}`],
  });
  const {
    data: messages,
    isLoading,
    error: messagesError,
  } = useQuery<any>({
    queryKey: [
      `/api/mail-alerts?${new URLSearchParams({ q, page: String(page), category, severity })}`,
    ],
    refetchInterval: pollUnlessPlanRequired(5000),
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
  const header = (
    <PageHeader
      title="Mail alerts"
      description="Known provider alerts for your client accounts. Matched messages expire within 30 days."
      actions={
        <Button variant="ghost" asChild>
          <Link href="/domains" data-testid="link-mail-alerts-domains">
            Manage domains <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      }
    />
  );
  const planGate = [settingsError, messagesError].find((e) =>
    planRequiredFrom(e),
  );
  if (planGate)
    return (
      <AppPage testId="page-mail-alerts">
        {header}
        <PlanRequired
          module="domainsMailAlerts"
          error={planGate}
          className="max-w-3xl"
        />
      </AppPage>
    );
  return (
    <AppPage testId="page-mail-alerts">
      {header}
      {error && <Notice tone="danger">{error}</Notice>}
      <Section
        title="Set up Gmail forwarding"
        description="Forward provider mail to your private address and alerts appear below."
      >
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="text-muted-foreground">
              Your private forwarding address
            </span>
            <Input
              readOnly
              aria-label="Forwarding address"
              value={settings?.address || "Inbound mail domain is not configured"}
            />
          </label>
          <details className="rounded-xl border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              How to set up
            </summary>
            <ol className="list-decimal py-2 pl-6 text-sm text-muted-foreground">
              <li>
                In Gmail, open Settings → See all settings → Forwarding and
                POP/IMAP.
              </li>
              <li>
                Choose Add a forwarding address and paste the address above.
              </li>
              <li>
                Find the forwarding confirmation below. Use its code or the
                Google confirmation link to finish setup.
              </li>
              <li>
                Create a Gmail filter for the provider senders, then choose
                “Forward it to” your private address. Keep general inbox
                forwarding off to avoid sending unrelated mail.
              </li>
            </ol>
          </details>
          <details className="rounded-xl border px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              Known senders
            </summary>
            <p className="break-words py-2 text-sm text-muted-foreground">
              {Object.values(settings?.senders || {}).flat().join(", ")}
            </p>
            <p className="text-sm text-muted-foreground">
              Registrar domains: {settings?.registrarSenders?.join(", ")}.
              Blotato: blotato.com. Only recognized alert subjects are
              retained.
            </p>
          </details>
          <p className="text-xs text-muted-foreground">
            Treat forwarded email as a reported alert, not proof of the
            sender's identity. Open provider dashboards directly for security
            and billing actions.
          </p>
        </div>
      </Section>
      <Section
        title="Optional Gmail API connection"
        description="Read provider mail directly instead of forwarding. Forwarding works without it."
      >
        {settings?.oauthEnabled ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                disabled={busy}
                className="w-full sm:w-auto"
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
                variant="outline"
                disabled={busy}
                onClick={() => action("/sync", {})}
              >
                Sync all connected Gmail accounts
              </Button>
            </div>
            {settings?.grants?.map((g: any) => (
              <div
                key={g.google_subject}
                className="flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1">
                  {g.email}{" "}
                  <span className="text-muted-foreground">
                    · {g.needs_reconnect ? "Reconnect required" : "Connected"}
                  </span>{" "}
                  {g.last_error && (
                    <span role="alert" className="text-destructive">
                      {g.last_error}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("/oauth/disconnect", { subject: g.google_subject })
                  }
                >
                  Disconnect
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={accountPage === 1}
                onClick={() => setAccountPage((p) => p - 1)}
              >
                Previous accounts
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={settings?.grants?.length < 25}
                onClick={() => setAccountPage((p) => p + 1)}
              >
                Next accounts
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Gmail API access is disabled. Forwarding works without Gmail
            restricted scopes. Public API use requires Google restricted-scope
            verification and the applicable annual CASA security assessment.
          </p>
        )}
      </Section>
      <Section title="Provider inbox" flush testId="section-mail-inbox">
        <div className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
          <Toolbar
            search={{
              value: q,
              onChange: (v) => {
                setQ(v);
                setSelected([]);
                setPage(1);
              },
              placeholder: "Search alerts",
            }}
            activeFilters={(category ? 1 : 0) + (severity ? 1 : 0)}
            filters={
              <>
                <select
                  aria-label="Alert category"
                  className={selectClass}
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
                  className={selectClass}
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
              </>
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
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
                onClick={() => action("/read", { ids: selected })}
              >
                Mark selected as read
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Input
                  aria-label="Search client for alerts"
                  placeholder="Search client name or website"
                  className="h-9 w-full sm:w-56"
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
                  className={`${selectClass} h-9`}
                >
                  <option value="">Unmapped</option>
                  {clients?.items?.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.business_name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={clientPage === 1}
                    onClick={() => setClientPage((p) => p - 1)}
                  >
                    Previous clients
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={clients?.items?.length < 25}
                    onClick={() => setClientPage((p) => p + 1)}
                  >
                    Next clients
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
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
            </div>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading alerts…</p>
          ) : !messages?.items?.length ? (
            <p className="text-sm text-muted-foreground">
              No matching provider alerts.
            </p>
          ) : (
            <div className="space-y-2">
              {messages.items.map((m: any) => (
                <article
                  key={m.id}
                  className={`rounded-xl border p-4 ${
                    m.severity === "critical"
                      ? "border-red-200 dark:border-red-900/60"
                      : ""
                  }`}
                  data-testid={`card-alert-${m.id}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select alert ${m.id}`}
                      checked={selected.includes(Number(m.id))}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, Number(m.id)]
                            : s.filter((x) => x !== m.id),
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
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
                    {m.severity === "critical" && (
                      <StatusPill tone="danger">Critical</StatusPill>
                    )}
                    {m.severity === "warning" && (
                      <StatusPill tone="warning">Warning</StatusPill>
                    )}
                  </div>
                  {m.confirmation_code && (
                    <p className="mt-2">
                      Forwarding confirmation code:{" "}
                      <strong>{m.confirmation_code}</strong>
                    </p>
                  )}
                  {m.confirmation_link && (
                    <a
                      className="mt-2 inline-block text-primary underline"
                      href={m.confirmation_link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Confirm forwarding at Google
                    </a>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm">
                      Read matched message
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {m.body}
                    </p>
                  </details>
                </article>
              ))}
            </div>
          )}
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
              Previous alerts
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              Page {page} · {messages?.total || 0} alerts
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * 25 >= (messages?.total || 0)}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected([]);
              }}
            >
              Next alerts
            </Button>
          </div>
        </div>
      </Section>
    </AppPage>
  );
}
