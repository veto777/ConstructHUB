import { useEffect, useState } from "react";
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
import { GoogleSurface, GoogleSectionHeader, GoogleList, GoogleListRow, GooglePill, GoogleStat, GoogleStatGrid } from "@/components/google";
import { HelpButton } from "@/components/help-button";
import { SAMPLE_BUSINESS, SamplePreview, sampleAgo, showSample } from "@/components/sample-preview";
import { PresetFilter } from "@/components/domains/preset-filter";
import { MAIL_ALERT_FILTER_MAX } from "@shared/mail-alerts";
import {
  PlanRequired,
  planRequiredFrom,
} from "@/components/plan-required";
import { pollWithinBudget } from "@/components/domains/polling";
import { AdminSetupNote } from "@/hooks/use-platform-admin";
// Google's rounded field shape for the native selects (the surface supplies the hairline colour).
const selectClass =
  "h-10 w-full rounded-full border bg-background px-4 text-sm sm:w-auto";

/** The categories and severities the matcher assigns (server/mail-alerts/classify.ts); any other word can be typed and is matched as-is. */
const CATEGORIES: readonly [string, string][] = [["gbp", "Google Business Profile"], ["gsc", "Search Console"], ["ads", "Google Ads"], ["cloudflare", "Cloudflare"], ["registrar", "Registrar"], ["forwarding", "Gmail forwarding"]];
const SEVERITIES: readonly [string, string][] = [["critical", "Critical"], ["warning", "Warning"], ["info", "Info"]];
const categoryLabel = (c: string) => CATEGORIES.find(([v]) => v === c)?.[1] ?? c;

/** Obviously made-up alerts for the sample shown while the inbox is empty (never stored, never sent). */
const SAMPLE_ALERTS = [
  { id: -1, subject: `Action needed: verify your Business Profile for ${SAMPLE_BUSINESS.name}`, category: "gbp", severity: "warning", sender: "profile-alerts@sample-provider.example", received_at: sampleAgo({ hours: 3 }), read_at: null, location_name: "Sample Roofing Co." },
  { id: -2, subject: "Transfer request for example-plumbing.example", category: "registrar", severity: "critical", sender: "support@sample-registrar.example", received_at: sampleAgo({ hours: 26 }), read_at: null, location_name: "Example Plumbing LLC" },
  { id: -3, subject: "Your Google Ads account: policy update", category: "ads", severity: "warning", sender: "ads-alerts@sample-provider.example", received_at: sampleAgo({ hours: 50 }), read_at: sampleAgo({ hours: 40 }), location_name: null },
];

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
    // The inbox filter and the map-target are separate concerns: choosing a map
    // target must not re-filter the inbox, and filtering must not clear the
    // chosen target (2026-10-11 findings).
    [filterClient, setFilterClient] = useState(""),
    [assignClient, setAssignClient] = useState(""),
    [assignName, setAssignName] = useState(""),
    [selected, setSelected] = useState<number[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accountPage, setAccountPage] = useState(1),
    [manageOpen, setManageOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState(""),
    [clientPage, setClientPage] = useState(1);
  // Names of clients seen or chosen, so a selected filter/assignment keeps its
  // label even when the client falls off the picker's current search/page.
  const [knownClients, setKnownClients] = useState<Record<string, string>>({});
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
        ...(filterClient ? { locationId: filterClient } : {}),
      })}`,
    ],
    // 15 s: 40 requests/10 min of the route's 120 — see components/domains/polling.ts.
    refetchInterval: pollWithinBudget(15_000),
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
  const loadedClients: { id: string | number; name: string }[] = (
    clients?.items || []
  ).map((c: any) => ({ id: c.id, name: c.business_name }));
  // Every client seen on any page/search stays nameable in both selects.
  useEffect(() => {
    const fresh = loadedClients.filter((c) => !knownClients[String(c.id)]);
    if (fresh.length)
      setKnownClients((k) => ({
        ...k,
        ...Object.fromEntries(fresh.map((c) => [String(c.id), c.name])),
      }));
  }, [clients]);
  // A selected client that isn't on the picker's current page/search still
  // renders as a labelled option instead of a blank select.
  const clientOptions = [...loadedClients];
  for (const [id, name] of Object.entries(knownClients))
    if (!clientOptions.some((c) => String(c.id) === id))
      clientOptions.push({ id, name });
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
  /** True only when the request persisted — callers toast success on true only. */
  const markRead = async (ids: number[]) => {
    setBusy(true);
    setError("");
    try {
      await apiRequest("POST", "/api/mail-alerts/read", { ids });
      await invalidate();
      return true;
    } catch (e) {
      setError(apiErrorMessage(e, "Operation failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const counts = messages?.counts;
  const configured = !!settings?.address;
  // The stat row's first number whatever the filters say: every alert kept (30 days).
  const { data: overview } = useQuery<{ total: number }>({ queryKey: ["/api/mail-alerts?limit=1"], refetchInterval: pollWithinBudget(60_000) });
  const totalAlerts: number | null = overview ? Number(overview.total || 0) : null;
  const filtering = !!(q || category || severity || unread || mapped || filterClient);
  // Google's format (owner, 2026-10-07): a quiet page title, section headings with a hairline, alerts as rows.
  const header = (
    <GoogleSectionHeader
      as="h1"
      title="Mail alerts"
      description="The important emails from Google, Cloudflare and your registrar about each client’s accounts, in one inbox and matched to the client."
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
        <AppPage className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-mail-alerts">
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
        setFilterClient("");
        setPage(1);
      },
    },
  ];
  return (
    <GoogleSurface page>
    <AppPage className="max-sm:[&_.g-pill]:!min-h-11 max-sm:[&_button.g-chip]:!min-h-11" testId="page-mail-alerts">
      {header}
      {error && <Notice tone="danger">{error}</Notice>}
      {totalAlerts !== null && totalAlerts > 0 && (
        <GoogleStatGrid cols={4}>
          <GoogleStat label="Alerts kept" value={totalAlerts.toLocaleString()} hint="Recognised alerts from the last 30 days" testId="stat-alerts-total" />
          <GoogleStat label="Unread" value={(counts?.unread ?? 0).toLocaleString()} hint="Opening an alert marks it read" testId="stat-alerts-unread" />
          <GoogleStat label="Critical" value={(counts?.critical ?? 0).toLocaleString()} tone={counts?.critical ? "bad" : "default"} hint="Suspensions, ownership and transfer requests, manual actions" testId="stat-alerts-critical" />
          <GoogleStat label="Unmapped" value={(counts?.unmapped ?? 0).toLocaleString()} hint="Not yet matched to a client" testId="stat-alerts-unmapped" />
        </GoogleStatGrid>
      )}
      {totalAlerts === 0 && (
        <div className="g-callout" data-testid="mail-alerts-how-it-works">
          <h2>How this works</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Copy your private forwarding address below.</li>
            <li>In Gmail, forward mail from the provider senders (Google Business Profile, Search Console, Google Ads, Cloudflare, your registrar) to it.</li>
            <li>Recognised alerts land here, graded critical, warning or info and matched to the client they mention; they are kept for 30 days.</li>
          </ol>
        </div>
      )}
      <section data-testid="section-connection-status">
        <GoogleSectionHeader
          title="Connection"
          titleAfter={<HelpButton k="mail-alerts.forwarding-setup" />}
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
            <Notice tone="info" title="Your forwarding address isn’t ready yet" testId="notice-inbound-unconfigured">
              Mail forwarding isn’t switched on yet, so there is no address to forward to; there is nothing for you
              to do. Alerts already stored still show below.
              <AdminSetupNote>set <code className="text-xs">INBOUND_MAIL_DOMAIN</code> in the server environment; each account’s address is made from it.</AdminSetupNote>
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
              (category ? 1 : 0) + (severity ? 1 : 0) + (mapped || filterClient ? 1 : 0)
            }
            filters={
              <>
                <PresetFilter
                  label="Alert category"
                  allLabel="All providers"
                  presets={CATEGORIES}
                  placeholder="Provider"
                  maxLength={MAIL_ALERT_FILTER_MAX}
                  selectClass={selectClass}
                  testId="filter-category"
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setSelected([]);
                    setPage(1);
                  }}
                />
                <PresetFilter
                  label="Alert severity"
                  allLabel="All severity levels"
                  presets={SEVERITIES}
                  placeholder="Severity"
                  maxLength={MAIL_ALERT_FILTER_MAX}
                  selectClass={selectClass}
                  testId="filter-severity"
                  value={severity}
                  onChange={(v) => {
                    setSeverity(v);
                    setSelected([]);
                    setPage(1);
                  }}
                />
                <select
                  aria-label="Filter by client"
                  className={selectClass}
                  value={mapped || filterClient}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "unmapped") {
                      setMapped("unmapped");
                      setFilterClient("");
                    } else {
                      setMapped("");
                      setFilterClient(v);
                    }
                    setSelected([]);
                    setPage(1);
                  }}
                >
                  <option value="">All clients</option>
                  <option value="unmapped">Unmapped</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </>
            }
          />
          {!!messages?.items?.length && (
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
          )}
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
                  if (await markRead(ids))
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
                  value={assignClient}
                  onChange={(e) => {
                    setAssignClient(e.target.value);
                    // The toast names the chosen option, not a lookup that may
                    // fail when the client isn't on the picker's current page.
                    setAssignName(e.target.selectedOptions[0]?.text || "");
                  }}
                  className={`${selectClass} h-9`}
                >
                  <option value="">Choose a client…</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
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
                  variant={assignClient ? "solid" : "outline"}
                  size="sm"
                  disabled={!selected.length || busy || !assignClient || !!clientsError}
                  onClick={async () => {
                    const name = assignName;
                    const d = await action("/mapping", {
                      ids: selected,
                      locationId: assignClient ? Number(assignClient) : null,
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
            filtering ? (
              <p className="py-4 text-sm g-text-2" data-testid="alerts-empty-filtered">No alerts match these filters.</p>
            ) : !showSample({ isLoading, isError: !!messagesError, total: messages?.items?.length, filtered: filtering, page: page - 1 }) ? (
              <p className="py-4 text-sm g-text-2" data-testid="alerts-empty-page">No alerts on this page.</p>
            ) : (
              <SamplePreview
                what="what the inbox shows once provider mail is forwarded here"
                testId="sample-alerts"
                cta={configured
                  ? <GooglePill size="sm" icon={Copy} label="Copy forwarding address" onClick={async () => { try { await navigator.clipboard.writeText(settings.address); toast({ title: "Address copied" }); } catch { toast({ title: "Could not copy", description: "Select the address and copy it manually.", variant: "destructive" }); } }} testId="sample-alerts-cta" />
                  : undefined}
              >
                <GoogleStatGrid cols={4} className="mb-3">
                  <GoogleStat label="Alerts kept" value="3" hint="Recognised alerts from the last 30 days" />
                  <GoogleStat label="Unread" value="2" hint="Opening an alert marks it read" />
                  <GoogleStat label="Critical" value="1" tone="bad" hint="Suspensions, ownership and transfer requests, manual actions" />
                  <GoogleStat label="Unmapped" value="1" hint="Not yet matched to a client" />
                </GoogleStatGrid>
                <GoogleList>
                  {SAMPLE_ALERTS.map((m) => (
                    <GoogleListRow
                      key={m.id}
                      size="md"
                      title={<span className={m.read_at ? "g-text-2" : undefined}>{m.subject}</span>}
                      badges={
                        <>
                          {m.severity === "critical" ? <span className="g-chip g-chip--sm g-closed">Critical</span> : <span className="g-chip g-chip--sm">Warning</span>}
                          {m.location_name ? <span className="g-chip g-chip--sm g-accent">{m.location_name}</span> : <span className="g-chip g-chip--sm">Unmapped</span>}
                        </>
                      }
                      meta={[categoryLabel(m.category), m.sender, new Date(m.received_at).toLocaleString(), m.read_at ? "Read" : "Unread"]}
                      actions={<><GooglePill variant="quiet" size="sm" label="Mark read" /><GooglePill variant="quiet" size="sm" icon={UserPlus} label="Assign client" /></>}
                    />
                  ))}
                </GoogleList>
              </SamplePreview>
            )
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
                    categoryLabel(m.category),
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
          {(page > 1 || (messages?.total || 0) > 25) && (
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
          )}
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
                      Only recognized alert subjects are retained.
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
