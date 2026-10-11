import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  Mail,
  RefreshCw,
  UserPlus,
} from "lucide-react";
import { apiRequest, queryClient, apiErrorMessage } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
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

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" data-testid="list-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border px-4 py-3">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export default function MailAlertsPage() {
  const { toast } = useToast();
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [category, setCategory] = useState(""),
    [severity, setSeverity] = useState(""),
    [unread, setUnread] = useState(""),
    [mapped, setMapped] = useState(""),
    [clientId, setClientId] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accountPage, setAccountPage] = useState(1),
    [manageOpen, setManageOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState(""),
    [clientPage, setClientPage] = useState(1);
  const {
    data: settings,
    error: settingsError,
    refetch: refetchSettings,
  } = useQuery<any>({
    queryKey: [`/api/mail-alerts/settings?page=${accountPage}`],
  });
  const {
    data: messages,
    isLoading,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery<any>({
    queryKey: [
      `/api/mail-alerts?${new URLSearchParams({
        q,
        page: String(page),
        category,
        severity,
        unread,
        mapped,
        ...(clientId ? { locationId: clientId } : {}),
      })}`,
    ],
    refetchInterval: pollUnlessPlanRequired(5000),
  });
  const {
    data: clients,
    error: clientsError,
    refetch: refetchClients,
  } = useQuery<any>({
    queryKey: [
      `/api/domains/locations?q=${encodeURIComponent(clientQuery)}&page=${clientPage}`,
    ],
  });
  const invalidate = () =>
    queryClient.invalidateQueries({
      predicate: (x) =>
        String(x.queryKey[0]).startsWith("/api/mail-alerts"),
    });
  /** POST and return the parsed body; the caller owns the toast, null on failure. */
  const action = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const r = await apiRequest("POST", `/api/mail-alerts${path}`, body);
      setSelected([]);
      await invalidate();
      return await r.json().catch(() => ({}));
    } catch (e) {
      setError(apiErrorMessage(e, "Operation failed"));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const markRead = async (ids: number[]) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", "/api/mail-alerts/read", { ids });
      await invalidate();
    } catch (e) {
      setError(apiErrorMessage(e, "Operation failed"));
    } finally {
      setBusy(false);
    }
  };
  const clientName = (id: string) =>
    (clients?.items || []).find((c: any) => String(c.id) === String(id))
      ?.business_name;
  const counts = messages?.counts;
  const configured = !!settings?.address;
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
  const triage = [
    {
      key: "critical",
      label: `Critical${counts?.critical != null ? ` · ${counts.critical}` : ""}`,
      on: severity === "critical",
      toggle: () => {
        setSeverity((s) => (s === "critical" ? "" : "critical"));
        setPage(1);
      },
    },
    {
      key: "unread",
      label: `Unread${counts?.unread != null ? ` · ${counts.unread}` : ""}`,
      on: unread === "1",
      toggle: () => {
        setUnread((s) => (s ? "" : "1"));
        setPage(1);
      },
    },
    {
      key: "unmapped",
      label: `Unmapped${counts?.unmapped != null ? ` · ${counts.unmapped}` : ""}`,
      on: mapped === "unmapped",
      toggle: () => {
        setMapped((s) => (s ? "" : "unmapped"));
        setClientId("");
        setPage(1);
      },
    },
  ];
  return (
    <GoogleSurface page>
    <AppPage testId="page-mail-alerts">
      {header}
      {error && <Notice tone="danger">{error}</Notice>}
      <section data-testid="section-connection-status">
        <GoogleSectionHeader
          title="Connection"
          description="Where provider alert emails land and how they reach ConstructHUB."
        />
        {settings ? (
          configured ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="g-chip g-chip--sm g-open">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Forwarding active
              </span>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-none">
                <span className="sr-only">Your private forwarding address</span>
                <Input
                  readOnly
                  aria-label="Forwarding address"
                  value={settings.address}
                  className="w-full sm:w-80"
                  onFocus={(e) => e.target.select()}
                />
                <GooglePill
                  variant="quiet"
                  size="sm"
                  icon={Copy}
                  ariaLabel="Copy forwarding address"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(settings.address);
                      toast({ title: "Address copied" });
                    } catch {
                      toast({
                        title: "Could not copy",
                        description: "Select the address and copy it manually.",
                        variant: "destructive",
                      });
                    }
                  }}
                  label="Copy"
                />
              </label>
              <div className="sm:ml-auto">
                <GooglePill
                  variant="quiet"
                  size="sm"
                  onClick={() => setManageOpen((v) => !v)}
                  ariaPressed={manageOpen}
                  label={manageOpen ? "Hide connections" : "Manage connections"}
                />
              </div>
            </div>
          ) : (
            <Notice tone="warning" testId="notice-inbound-unconfigured">
              Inbound mail is not configured. Your administrator must set the{" "}
              <code className="text-xs">INBOUND_MAIL_DOMAIN</code> environment
              variable before ConstructHUB can create your private forwarding
              address. Alerts already stored below still show; forwarding and
              the optional Gmail connection need that setting.
            </Notice>
          )
        ) : settingsError ? (
          <Notice
            tone="danger"
            action={
              <GooglePill size="sm" onClick={() => refetchSettings()} label="Try again" />
            }
          >
            {apiErrorMessage(settingsError, "Could not load the connection settings.")}
          </Notice>
        ) : (
          <Skeleton className="h-10 w-full max-w-xl" />
        )}
      </section>
      <section data-testid="section-mail-inbox">
        <GoogleSectionHeader title="Provider inbox" count={messages?.total || 0} />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Triage filters">
            {triage.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.on}
                onClick={t.toggle}
                className={`g-chip g-chip--sm ${t.on ? "g-pill--on g-pill" : "hover:bg-accent/10"}`}
                data-testid={`triage-${t.key}`}
              >
                {t.label}
              </button>
            ))}
          </div>
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
            activeFilters={
              (category ? 1 : 0) + (severity ? 1 : 0) + (mapped || clientId ? 1 : 0)
            }
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
                <select
                  aria-label="Filter by client"
                  className={selectClass}
                  value={mapped || clientId}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "unmapped") {
                      setMapped("unmapped");
                      setClientId("");
                    } else {
                      setMapped("");
                      setClientId(v);
                    }
                    setSelected([]);
                    setPage(1);
                  }}
                >
                  <option value="">All clients</option>
                  <option value="unmapped">Unmapped</option>
                  {(clients?.items || []).map((c: any) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.business_name}
                    </option>
                  ))}
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
          </div>
          {selected.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border p-2"
              data-testid="selection-bar"
            >
              <GooglePill
                icon={CheckCheck}
                size="sm"
                disabled={busy}
                onClick={async () => {
                  const ids = selected;
                  await markRead(ids);
                  toast({
                    title: `${ids.length} alert${ids.length === 1 ? "" : "s"} marked read`,
                  });
                }}
                label="Mark read"
              />
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                <Input
                  aria-label="Search client for alerts"
                  placeholder="Search client name or website"
                  className="h-9 w-full sm:w-48"
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
                  <option value="">Choose a client…</option>
                  {(clients?.items || []).map((c: any) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.business_name}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-1">
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
                  variant={mapped || clientId ? "solid" : "outline"}
                  size="sm"
                  disabled={!selected.length || busy || !clientId || !!clientsError}
                  onClick={async () => {
                    const name = clientName(clientId);
                    const d = await action("/mapping", {
                      ids: selected,
                      locationId: clientId ? Number(clientId) : null,
                    });
                    if (d)
                      toast({
                        title: `${selected.length} alert${selected.length === 1 ? "" : "s"} mapped`,
                        description: `New alerts about ${name || "that client"} attribute to them by name.`,
                      });
                  }}
                  label="Map selected alerts"
                />
                <GooglePill
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    const d = await action("/mapping", {
                      ids: selected,
                      locationId: null,
                    });
                    if (d)
                      toast({
                        title: `${selected.length} alert${selected.length === 1 ? "" : "s"} unmapped`,
                        description: "They wait in Unmapped until you assign a client.",
                      });
                  }}
                  label="Unmap"
                />
              </div>
              <GooglePill
                variant="quiet"
                size="sm"
                onClick={() => setSelected([])}
                label="Clear selection"
              />
            </div>
          )}
          {clientsError && selected.length > 0 && (
            <Notice
              tone="danger"
              action={
                <GooglePill size="sm" onClick={() => refetchClients()} label="Try again" />
              }
            >
              {apiErrorMessage(clientsError, "Could not load clients.")}
            </Notice>
          )}
          {isLoading ? (
            <ListSkeleton rows={5} />
          ) : messagesError ? (
            <Notice
              tone="danger"
              testId="alerts-error"
              action={
                <GooglePill size="sm" onClick={() => refetchMessages()} label="Try again" />
              }
            >
              {apiErrorMessage(messagesError, "Could not load provider alerts.")}
            </Notice>
          ) : !messages?.items?.length ? (
            <p className="py-4 text-sm g-text-2">
              {q || category || severity || unread || mapped || clientId
                ? "No alerts match these filters."
                : "No provider alerts yet. Forward provider mail here and recognised alerts appear in this inbox."}
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
                              : s.filter((x) => x !== Number(m.id)),
                          )
                        }
                      />
                      <span className={m.read_at ? "g-text-2" : undefined}>{m.subject}</span>
                    </label>
                  }
                  badges={
                    <>
                      {m.severity === "critical" ? <span key="sev" className="g-chip g-chip--sm g-closed">Critical</span>
                        : m.severity === "warning" ? <span key="sev" className="g-chip g-chip--sm">Warning</span>
                        : null}
                      {m.location_id ? (
                        <Link key="client" href="/locations" className="g-chip g-chip--sm g-accent">
                          {m.location_name || "Unknown client"}
                        </Link>
                      ) : (
                        <span key="client" className="g-chip g-chip--sm">
                          Unmapped
                        </span>
                      )}
                    </>
                  }
                  meta={[
                    m.category,
                    m.sender,
                    new Date(m.received_at).toLocaleString(),
                    m.read_at ? "Read" : "Unread",
                  ]}
                  actions={
                    <>
                      {m.confirmation_link && (
                        <GooglePill icon={ExternalLink} size="sm" label="Confirm forwarding at Google" href={m.confirmation_link} external />
                      )}
                      {!m.read_at && (
                        <GooglePill
                          variant="quiet"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            await markRead([Number(m.id)]);
                          }}
                          label="Mark read"
                        />
                      )}
                      {!m.location_id && (
                        <GooglePill
                          variant="quiet"
                          size="sm"
                          icon={UserPlus}
                          onClick={() => setSelected([Number(m.id)])}
                          label="Assign client"
                        />
                      )}
                    </>
                  }
                >
                  {m.confirmation_code && (
                    <p className="mt-2 text-sm">
                      Forwarding confirmation code:{" "}
                      <strong>{m.confirmation_code}</strong>
                    </p>
                  )}
                  <details
                    className="mt-2"
                    onToggle={(e) => {
                      // Reading a message marks it read, like opening mail; the counts update on refetch.
                      if (e.currentTarget.open && !m.read_at && !busy)
                        void markRead([Number(m.id)]);
                    }}
                  >
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
      {configured && (
        <section data-testid="section-manage-connections">
          {manageOpen ? (
            <>
              <GoogleSectionHeader
                title="Forwarding setup and connections"
                description="Gmail forwarding steps, the recognised senders, and the optional Gmail API connection."
              />
              <div className="space-y-3">
                <GooglePill
                  variant="quiet"
                  size="sm"
                  onClick={() => setManageOpen(false)}
                  label="Hide connections"
                />
                <label className="block space-y-1.5 text-sm">
                  <span className="g-text-2">Your private forwarding address</span>
                  <Input
                    readOnly
                    aria-label="Forwarding address"
                    value={settings?.address || ""}
                    onFocus={(e) => e.target.select()}
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
            </>
          ) : null}
        </section>
      )}
      {(manageOpen || !configured) && (
        <section>
          <GoogleSectionHeader
            title="Optional Gmail API connection"
            description="Read provider mail directly instead of forwarding. Forwarding works without it."
          />          {settings?.oauthEnabled ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <GooglePill
                  icon={Mail}
                  variant="solid"
                  disabled={busy}
                  className="w-full sm:w-auto"
                  onClick={async () => {
                    try {
                      const { requestRecentAuth } = await import("@/components/recent-auth");
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
                  onClick={async () => {
                    const d = await action("/sync", {});
                    if (d)
                      toast({
                        title: "Gmail sync queued",
                        description: "Connected accounts are checked for provider alerts.",
                      });
                  }}
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
      )}
    </AppPage>
    </GoogleSurface>
  );
}
