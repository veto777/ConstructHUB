import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCheck, ExternalLink, Mail, RefreshCw } from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { requestRecentAuth } from "@/components/recent-auth";
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
  // Google's format (owner, 2026-10-07): a quiet page title, section headings with a hairline, alerts as rows.
  const header = (
    <GoogleSectionHeader
      as="h1"
      title="Mail alerts"
      description="Known provider alerts for your client accounts. Matched messages expire within 30 days."
      flush
      actions={
        <Link href="/domains" asChild>
          <GooglePill icon={ArrowRight} label="Manage domains" href="/domains" testId="link-mail-alerts-domains" />
        </Link>
      }
    />
  );
  const planGate = [settingsError, messagesError].find((e) =>
    planRequiredFrom(e),
  );
  if (planGate)
    return (
      <GoogleSurface page>
        <AppPage testId="page-mail-alerts">
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
    <AppPage testId="page-mail-alerts">
      {header}
      {error && <Notice tone="danger">{error}</Notice>}
      <section>
        <GoogleSectionHeader
          title="Set up Gmail forwarding"
          description="Forward provider mail to your private address and alerts appear below."
        />
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span className="g-text-2">
              Your private forwarding address
            </span>
            <Input
              readOnly
              aria-label="Forwarding address"
              value={settings?.address || "Inbound mail domain is not configured"}
            />
          </label>
          <GoogleList>
            <details className="g-card">
              <summary className="cursor-pointer text-sm font-medium">
                How to set up
              </summary>
              <ol className="list-decimal py-2 pl-6 text-sm g-text-2">
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
            <details className="g-card">
              <summary className="cursor-pointer text-sm font-medium">
                Known senders
              </summary>
              <p className="break-words py-2 text-sm g-text-2">
                {Object.values(settings?.senders || {}).flat().join(", ")}
              </p>
              <p className="text-sm g-text-2">
                Registrar domains: {settings?.registrarSenders?.join(", ")}.
                Blotato: blotato.com. Only recognized alert subjects are
                retained.
              </p>
            </details>
          </GoogleList>
          <p className="text-xs g-text-2">
            Treat forwarded email as a reported alert, not proof of the
            sender's identity. Open provider dashboards directly for security
            and billing actions.
          </p>
        </div>
      </section>
      <section>
        <GoogleSectionHeader
          title="Optional Gmail API connection"
          description="Read provider mail directly instead of forwarding. Forwarding works without it."
        />
        {settings?.oauthEnabled ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <GooglePill
                icon={Mail}
                variant="solid"
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
                label="Connect Gmail with read-only access"
              />
              <GooglePill
                icon={RefreshCw}
                disabled={busy}
                onClick={() => action("/sync", {})}
                label="Sync all connected Gmail accounts"
              />
            </div>
            {settings?.grants?.length > 0 && (
              <GoogleList testId="list-gmail-grants">
                {settings.grants.map((g: any) => (
                  <GoogleListRow
                    key={g.google_subject}
                    size="md"
                    title={g.email}
                    meta={[
                      g.needs_reconnect ? <span key="state" className="g-closed">Reconnect required</span> : <span key="state" className="g-open">Connected</span>,
                      g.last_error ? <span key="err" role="alert" className="g-closed">{g.last_error}</span> : null,
                    ]}
                    trailing={
                      <GooglePill
                        variant="quiet"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          action("/oauth/disconnect", { subject: g.google_subject })
                        }
                        label="Disconnect"
                      />
                    }
                  />
                ))}
              </GoogleList>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={accountPage === 1}
                onClick={() => setAccountPage((p) => p - 1)}
                label="Previous accounts"
              />
              <GooglePill
                variant="quiet"
                size="sm"
                disabled={settings?.grants?.length < 25}
                onClick={() => setAccountPage((p) => p + 1)}
                label="Next accounts"
              />
            </div>
          </div>
        ) : (
          <p className="text-sm g-text-2">
            Gmail API access is disabled. Forwarding works without Gmail
            restricted scopes. Public API use requires Google restricted-scope
            verification and the applicable annual CASA security assessment.
          </p>
        )}
      </section>
      <section data-testid="section-mail-inbox">
        <GoogleSectionHeader title="Provider inbox" count={messages?.total || 0} />
        <div className="space-y-3">
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
            <label className="flex h-10 items-center gap-2 text-sm g-text-2">
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
              <span className="text-sm tabular-nums g-text-2">
                {selected.length} selected
              </span>
            )}
            <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <GooglePill
                icon={CheckCheck}
                size="sm"
                disabled={!selected.length || busy}
                onClick={() => action("/read", { ids: selected })}
                label="Mark selected as read"
              />
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
                <div className="flex flex-wrap items-center gap-2">
                  <GooglePill
                    variant="quiet"
                    size="sm"
                    disabled={clientPage === 1}
                    onClick={() => setClientPage((p) => p - 1)}
                    label="Previous clients"
                  />
                  <GooglePill
                    variant="quiet"
                    size="sm"
                    disabled={clients?.items?.length < 25}
                    onClick={() => setClientPage((p) => p + 1)}
                    label="Next clients"
                  />
                </div>
                <GooglePill
                  size="sm"
                  disabled={!selected.length || busy}
                  onClick={() =>
                    action("/mapping", {
                      ids: selected,
                      locationId: clientId ? Number(clientId) : null,
                    })
                  }
                  label="Map selected alerts"
                />
              </div>
            </div>
          </div>
          {isLoading ? (
            <p className="text-sm g-text-2">Loading alerts…</p>
          ) : !messages?.items?.length ? (
            <p className="py-4 text-sm g-text-2">
              No matching provider alerts.
            </p>
          ) : (
            <GoogleList testId="list-alerts">
              {messages.items.map((m: any) => (
                <GoogleListRow
                  key={m.id}
                  size="md"
                  testId={`card-alert-${m.id}`}
                  title={
                    <label className="inline-flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1.5"
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
                      <span className={m.read_at ? "g-text-2" : undefined}>{m.subject}</span>
                    </label>
                  }
                  badges={
                    m.severity === "critical" ? <span className="g-chip g-chip--sm g-closed">Critical</span>
                      : m.severity === "warning" ? <span className="g-chip g-chip--sm">Warning</span>
                      : null
                  }
                  meta={[
                    m.category,
                    m.severity === "critical" ? <span key="sev" className="g-closed">{m.severity}</span> : m.severity,
                    m.sender,
                    new Date(m.received_at).toLocaleString(),
                    m.read_at ? "Read" : "Unread",
                    m.location_id
                      ? `Client location ${m.location_id}`
                      : "Unmapped / ambiguous client",
                  ]}
                  actions={m.confirmation_link ? (
                    <GooglePill icon={ExternalLink} size="sm" label="Confirm forwarding at Google" href={m.confirmation_link} external />
                  ) : undefined}
                >
                  {m.confirmation_code && (
                    <p className="mt-2 text-sm">
                      Forwarding confirmation code:{" "}
                      <strong>{m.confirmation_code}</strong>
                    </p>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm g-accent">
                      Read matched message
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm g-text-2">
                      {m.body}
                    </p>
                  </details>
                </GoogleListRow>
              ))}
            </GoogleList>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <GooglePill
              size="sm"
              disabled={page === 1}
              onClick={() => {
                setPage((p) => p - 1);
                setSelected([]);
              }}
              label="Previous alerts"
            />
            <span className="text-sm tabular-nums g-text-2">
              Page {page} · {messages?.total || 0} alerts
            </span>
            <GooglePill
              size="sm"
              disabled={page * 25 >= (messages?.total || 0)}
              onClick={() => {
                setPage((p) => p + 1);
                setSelected([]);
              }}
              label="Next alerts"
            />
          </div>
        </div>
      </section>
    </AppPage>
    </GoogleSurface>
  );
}
