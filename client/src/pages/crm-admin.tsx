import { ACCESS_STATUSES } from "@shared/plans";
import { SiteScanLeads } from "./site-scan";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  ShieldCheck, Users, Building2, UserCircle, FileText, Receipt, CreditCard, Activity,
  Search, Mail, Copy, Check, Loader2, Rocket, Ban, MessageCircle, HardDrive,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { JOBCAM_INCLUDED_GB, JOBCAM_STORAGE_TIERS_GB, formatJobcamTier } from "@shared/jobcam-storage";
import {
  CrmPage, StatusPill, EmptyState, ErrorCard,
  InitialAvatar, SectionTitle, crmTable, roleTone, statusTone,
} from "@/components/crm-ui";
import { GoogleSectionHeader, GoogleStat } from "@/components/google";
import { DataSourceCard, type SeoStatus } from "@/pages/seo/shell";
import { InfoTip } from "@/components/info-tip";

/**
 * Platform admin — "watch all our users". Read-only monitoring across every
 * account and org on the platform, plus beta invite issuing. Gated twice:
 * the sidebar only links here when /api/crm/me says isPlatformAdmin, and every
 * /api/admin/* route re-checks the email list server-side.
 */

// ── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  users: number;
  orgs: number;
  customers: number;
  estimates: number;
  invoices: number;
  payments: { count: number; succeededCents: number };
  betaUsers: number;
}

interface AdminUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  betaAt: string | null;
  plan: { plan: string; status: string };
  orgs: { orgId: string; orgName: string; role: string; status: string }[];
}

interface AdminOrg {
  id: string;
  name: string;
  createdAt: string;
  owner: { userId: number; email: string; betaAt: string | null } | null;
  plan: { plan: string; status: string };
  counts: { members: number; customers: number; projects: number; estimates: number; invoices: number };
}

interface OrgDetail {
  org: { id: string; name: string; email: string | null; phone: string | null; createdAt: string };
  owner: { id: number; email: string; betaAt: string | null } | null;
  plan: { plan: string; status: string };
  seats: { plan: string; planName: string; limit: number; used: number };
  members: {
    id: string; userId: number | null; email: string; role: string; status: string;
    displayName: string | null; lastActiveAt: string | null; createdAt: string;
  }[];
  recentEstimates: { id: string; number: string | null; title: string; status: string; totalCents: number; createdAt: string }[];
  recentInvoices: { id: string; number: string | null; title: string; status: string; totalCents: number; paidCents: number; createdAt: string }[];
}

interface BetaInvite {
  id: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  status: "pending" | "accepted" | "expired";
}

// ── Formatting ───────────────────────────────────────────────────────────────

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
/** Six-up metric cards are ~200px wide — platform revenue needs compact
 *  notation ("$1.7M") or it clips; the exact total lives on /crm/payments. */
const moneyCompact = (cents: number) =>
  Math.abs(cents) >= 100_000_00
    ? new Intl.NumberFormat("en-US", {
        style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
      }).format(cents / 100)
    : money(cents);
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function PlanPill({ plan, beta }: { plan: { plan: string; status: string }; beta?: boolean }) {
  if (beta) return <StatusPill tone="violet" data-testid="pill-beta">Beta</StatusPill>;
  const active = ACCESS_STATUSES.includes(plan.status);
  return (
    <StatusPill tone={active ? "success" : "neutral"}>
      {active ? plan.plan : "free"}
    </StatusPill>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type JobcamStorageOrg = {
  id: string; name: string; ownerEmail: string | null; mediaCount: number;
  usedBytes: number; tierGb: number; limitBytes: number; label: string; warn: boolean; full: boolean; overLimit: boolean;
  request: { id: string; requestedAt: string; tierGb: number } | null;
};

/**
 * JobCam storage per org: used / size, a size select, and the "Request more
 * storage" notes workspaces send. Sizes above the included one have no price
 * yet, so this select is the only way an org gets one.
 */
function JobcamStorageAdminCard({ enabled }: { enabled: boolean }) {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const { data, isError } = useQuery<{ tiersGb: number[]; orgs: JobcamStorageOrg[] }>({ queryKey: ["/api/admin/jobcam/storage"], enabled });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/jobcam/storage"] });
  const setTier = useMutation({
    mutationFn: async (v: { orgId: string; tierGb: number }) => (await apiRequest("POST", "/api/admin/jobcam/storage-tier", v)).json(),
    onSuccess: (r: { tierGb: number; previousGb: number; overLimit: boolean }) => {
      refresh();
      toast({
        title: `Storage set to ${formatJobcamTier(r.tierGb)}`,
        description: r.overLimit ? "This org already stores more than that: nothing is deleted, but its new uploads are blocked until it is under the limit." : `Was ${formatJobcamTier(r.previousGb)}.`,
      });
    },
    onError: (e: any) => { refresh(); toast({ title: "Couldn't change the size", description: apiErrorMessage(e), variant: "destructive" }); },
  });
  const dismiss = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/jobcam/storage-requests/${id}/dismiss`)).json(),
    onSuccess: () => { refresh(); toast({ title: "Request dismissed" }); },
    onError: (e: any) => toast({ title: "Couldn't dismiss", description: apiErrorMessage(e), variant: "destructive" }),
  });
  const orgs = data?.orgs ?? [];
  const requests = orgs.filter((o) => o.request).length;
  // Orgs that have never used JobCam and sit on the included size are noise until asked for.
  const active = orgs.filter((o) => o.request || o.usedBytes > 0 || o.tierGb !== JOBCAM_INCLUDED_GB);
  const shown = showAll ? orgs : active;
  return (
    <Card data-testid="card-jobcam-storage" id="card-jobcam-storage" className="scroll-mt-6">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <SectionTitle icon={HardDrive} title="JobCam storage"
          description={`Every org gets ${formatJobcamTier(JOBCAM_INCLUDED_GB)}. Larger sizes are not priced yet, so they are set here.${requests ? ` ${requests} open request${requests === 1 ? "" : "s"}.` : ""}`} />
        <p className="text-xs text-muted-foreground" data-testid="text-jobcam-storage-lowering">
          Setting a size below what an org already stores is allowed: nothing is deleted, but its new uploads are blocked until it is under the limit.
        </p>
        {isError ? (
          <p className="text-sm text-destructive">Couldn't load JobCam storage — refresh to try again.</p>
        ) : !shown.length ? (
          <p className="text-sm text-muted-foreground">No org has used JobCam yet.</p>
        ) : (
          <div className={crmTable.wrapper}>
            <table className={crmTable.table} data-testid="table-jobcam-storage">
              <thead className={crmTable.thead}>
                <tr>
                  <th className={crmTable.th}>Org</th>
                  <th className={crmTable.th}>Used</th>
                  <th className={crmTable.th}>Size</th>
                  <th className={crmTable.th}>Request</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} className={crmTable.tr} data-testid={`row-jobcam-storage-${o.id}`}>
                    <td className={crmTable.td}>
                      <span className="font-medium">{o.name}</span>
                      <div className="text-xs text-muted-foreground">{o.ownerEmail ?? "—"}</div>
                    </td>
                    <td className={crmTable.td}>
                      <span className={`tabular-nums ${o.full ? "text-destructive font-medium" : ""}`} data-testid={`text-jobcam-storage-used-${o.id}`}>{o.label}</span>
                      <div className="text-xs text-muted-foreground">
                        {o.mediaCount.toLocaleString("en-US")} item{o.mediaCount === 1 ? "" : "s"}{o.overLimit ? " · over the limit, uploads blocked" : o.full ? " · full" : o.warn ? " · almost full" : ""}
                      </div>
                    </td>
                    <td className={crmTable.td}>
                      <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={o.tierGb}
                        disabled={setTier.isPending}
                        aria-label={`Storage size for ${o.name}`}
                        data-testid={`select-jobcam-tier-${o.id}`}
                        onChange={(e) => setTier.mutate({ orgId: o.id, tierGb: Number(e.target.value) })}
                      >
                        {(data?.tiersGb ?? JOBCAM_STORAGE_TIERS_GB).map((t) => <option key={t} value={t}>{formatJobcamTier(t)}</option>)}
                      </select>
                    </td>
                    <td className={crmTable.td}>
                      {o.request ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" data-testid={`badge-jobcam-request-${o.id}`}>Asked {day(o.request.requestedAt)}</Badge>
                          <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(o.request!.id)} data-testid={`button-jobcam-request-dismiss-${o.id}`}>Dismiss</Button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {orgs.length > active.length && (
          <Button size="sm" variant="outline" onClick={() => setShowAll((v) => !v)} data-testid="button-jobcam-storage-all">
            {showAll ? "Only orgs using JobCam" : `Show all ${orgs.length} orgs`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function CrmAdminPage() {
  const { toast } = useToast();
  const [userSearch, setUserSearch] = useState("");
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null);
  const [betaEmail, setBetaEmail] = useState("");
  // Optional: text the invite too.
  const [betaPhone, setBetaPhone] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: me, isLoading: meLoading, isError: meError } = useQuery<any>({ queryKey: ["/api/crm/me"] });
  const { data: seoStatus } = useQuery<SeoStatus>({ queryKey: ["/api/seo/status"], enabled: !!me?.isPlatformAdmin });
  const isAdmin = me?.isPlatformAdmin === true;

  // The /admin login wall — the passphrase second factor (enforced when the
  // server has credentials configured). Data queries hold until it passes.
  const { data: gate, isLoading: gateLoading, isError: gateError } = useQuery<{ gateConfigured: boolean; gatePassed: boolean }>({
    queryKey: ["/api/admin/gate"],
  });
  const gateOpen = !!gate && (!gate.gateConfigured || gate.gatePassed);
  const [gateUser, setGateUser] = useState("");
  const [gatePass, setGatePass] = useState("");
  const gateLogin = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/admin/gate", { username: gateUser, password: gatePass })).json(),
    onSuccess: () => {
      setGatePass("");
      queryClient.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Sign-in failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const { data: overview } = useQuery<Overview>({
    queryKey: ["/api/admin/overview"],
    enabled: isAdmin && gateOpen,
  });
  const { data: users, isError: usersError } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin && gateOpen,
  });
  const { data: orgs, isError: orgsError } = useQuery<AdminOrg[]>({
    queryKey: ["/api/admin/orgs"],
    enabled: isAdmin && gateOpen,
  });
  const { data: invites, isError: invitesError } = useQuery<BetaInvite[]>({
    queryKey: ["/api/admin/beta-invites"],
    enabled: isAdmin && gateOpen,
  });
  const { data: analytics, isError: analyticsError } = useQuery<any>({
    queryKey: ["/api/admin/analytics"],
    enabled: isAdmin && gateOpen,
    refetchInterval: 60_000,
  });
  // Hub (the corner assistant): outcome counts only — no messages, replies or people.
  const { data: hubStats, isError: hubStatsError } = useQuery<{ days: number; rows: { tier: string; outcome: string; reason: string; count: number }[] }>({
    queryKey: ["/api/admin/hub-stats"],
    enabled: isAdmin && gateOpen,
  });
  const { data: orgDetail, isError: orgDetailError } = useQuery<OrgDetail>({
    queryKey: ["/api/admin/orgs", detailOrgId],
    enabled: isAdmin && gateOpen && !!detailOrgId,
  });

  const sendInvite = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", "/api/admin/beta-invites", {
        email,
        phone: betaPhone.trim() || null,
        sms: Boolean(betaPhone.trim()),
      });
      return res.json();
    },
    onSuccess: (data: { link: string; emailed: boolean; texted?: boolean; smsError?: string | null }) => {
      setBetaEmail("");
      setBetaPhone("");
      setLastLink(data.emailed ? null : data.link);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/beta-invites"] });
      toast({
        title: data.emailed ? "Beta invite sent" : "Invite created",
        description: data.texted
          ? "Emailed and texted."
          : data.smsError
            ? `Emailed — text failed: ${data.smsError}`
            : data.emailed ? undefined : "Email delivery failed — copy the link below.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Invite failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // Revoke = delete the pending row; the emailed link dies with its token hash.
  const revokeInvite = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/admin/beta-invites/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/beta-invites"] });
      toast({ title: "Invite revoked", description: "The invite link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Could not revoke", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  if (meLoading) {
    return (
      <CrmPage>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </CrmPage>
    );
  }

  if (meError) {
    return (
      <ErrorCard
        title="Couldn't load your account"
        description="Check your connection and refresh the page."
      />
    );
  }

  if (!isAdmin) {
    return (
      <ErrorCard
        title="Platform admins only"
        description="This console is for the ConstructHUB team. Your account isn't on the platform admin list."
      />
    );
  }

  if (gateLoading) {
    return (
      <CrmPage>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </CrmPage>
    );
  }

  if (!gateOpen) {
    return (
      <CrmPage>
        <div className="max-w-sm mx-auto mt-16">
          {gateError && (
            <p className="text-sm text-destructive mb-3">Couldn't check the gate — refresh the page to try again.</p>
          )}
          <Card data-testid="card-admin-gate">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" /> Platform Admin sign-in
              </CardTitle>
              <CardDescription>The cross-account console needs its own credentials.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={(e) => {
                e.preventDefault();
                if (gateUser && gatePass && !gateLogin.isPending) gateLogin.mutate();
              }} className="space-y-3">
              <div>
                <Label htmlFor="gate-user">Username</Label>
                <Input id="gate-user" autoComplete="username" value={gateUser}
                  onChange={(e) => setGateUser(e.target.value)} data-testid="input-admin-gate-user" />
              </div>
              <div>
                <Label htmlFor="gate-pass">Password</Label>
                <Input id="gate-pass" type="password" autoComplete="current-password" value={gatePass}
                  onChange={(e) => setGatePass(e.target.value)} data-testid="input-admin-gate-pass" />
              </div>
              <Button type="submit" className="w-full" disabled={!gateUser || !gatePass || gateLogin.isPending}
                data-testid="button-admin-gate-login">
                {gateLogin.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Sign in
              </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </CrmPage>
    );
  }

  const needle = userSearch.trim().toLowerCase();
  const filteredUsers = (users ?? []).filter(
    (u) =>
      !needle ||
      u.email.toLowerCase().includes(needle) ||
      (u.displayName ?? "").toLowerCase().includes(needle) ||
      u.orgs.some((o) => o.orgName.toLowerCase().includes(needle)),
  );

  return (
    <CrmPage wide className="space-y-8">
      <div data-testid="crm-admin-page" className="contents">
      {/* Google's page format (owner, 2026-10-07): a quiet header, stat tiles, hairline cards. */}
      <GoogleSectionHeader
        as="h1"
        title={<>Platform admin <InfoTip k="admin" /></>}
        description="Every account and organization on ConstructHub — read-only monitoring."
        flush
      />

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="section-overview">
        {/* Users/orgs have no dedicated page — the destination is the section below. */}
        <a href="#card-users" className="block h-full rounded-lg [&>.g-stat]:hover:bg-[var(--g-surface-2)]">
          <GoogleStat label="Users" value={overview?.users ?? "—"} testId="metric-users"
            hint={overview ? `${overview.betaUsers} beta` : undefined} />
        </a>
        <a href="#card-orgs" className="block h-full rounded-lg [&>.g-stat]:hover:bg-[var(--g-surface-2)]">
          <GoogleStat label="Orgs" value={overview?.orgs ?? "—"} testId="metric-orgs" />
        </a>
        {/* Platform-wide totals: no link, because /crm/clients etc. show only
            the admin's own workspace, not the numbers on these cards. */}
        <GoogleStat label="Clients" value={overview?.customers ?? "—"} testId="metric-customers"
          hint="all orgs" />
        <GoogleStat label="Estimates" value={overview?.estimates ?? "—"} testId="metric-estimates"
          hint="all orgs" />
        <GoogleStat label="Invoices" value={overview?.invoices ?? "—"} testId="metric-invoices"
          hint="all orgs" />
        <GoogleStat label="Payments" value={overview ? moneyCompact(overview.payments.succeededCents) : "—"}
          testId="metric-payments"
          hint={overview ? `${overview.payments.count} charges, all orgs` : undefined} />
      </div>

      {/* Growth-site Site Scan leads, after the metrics. The component is its
          own Card (data-testid section-sitescan-leads) and its table scrolls
          sideways on a phone — no second card around it. */}
      <SiteScanLeads />

      {/* ── Users ────────────────────────────────────────────────────────── */}
      <Card data-testid="card-users" id="card-users" className="scroll-mt-6">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionTitle
            icon={Users}
            title="Users"
            description={`${users?.length ?? 0} accounts`}
            actions={
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search email, name or org…"
                  className="h-8 w-56 pl-8 text-xs"
                  data-testid="input-user-search"
                />
              </div>
            }
          />
          {usersError ? (
            <p className="text-sm text-destructive">Couldn't load users — refresh to try again.</p>
          ) : filteredUsers.length === 0 ? (
            <EmptyState icon={Users} title="No users found" compact />
          ) : (
            <div className={crmTable.wrapper}>
              <table className={crmTable.table} data-testid="table-users">
                <thead className={crmTable.thead}>
                  <tr>
                    <th className={crmTable.th}>User</th>
                    <th className={crmTable.th}>Plan</th>
                    <th className={crmTable.th}>Organizations</th>
                    <th className={crmTable.th}>Joined</th>
                    <th className={crmTable.th}>Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className={crmTable.tr} data-testid={`row-user-${u.id}`}>
                      <td className={crmTable.td}>
                        <div className="flex items-center gap-2.5">
                          <InitialAvatar name={u.displayName || u.email} className="h-7 w-7 text-[10px]" />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{u.displayName || "—"}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className={crmTable.td}><PlanPill plan={u.plan} beta={!!u.betaAt} /></td>
                      <td className={crmTable.td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {u.orgs.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                          {u.orgs.map((o) => (
                            <StatusPill key={o.orgId} tone={roleTone(o.role)} dot={false}>
                              {o.orgName} · {o.role}
                            </StatusPill>
                          ))}
                        </div>
                      </td>
                      <td className={crmTable.td}><span className="text-xs text-muted-foreground">{day(u.createdAt)}</span></td>
                      <td className={crmTable.td}><span className="text-xs text-muted-foreground">{day(u.lastActiveAt)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Orgs ─────────────────────────────────────────────────────────── */}
      <Card data-testid="card-orgs" id="card-orgs" className="scroll-mt-6">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionTitle icon={Building2} title="Organizations" description={`${orgs?.length ?? 0} orgs — click one for detail`} />
          {orgsError ? (
            <p className="text-sm text-destructive">Couldn't load organizations — refresh to try again.</p>
          ) : (
          <div className={crmTable.wrapper}>
            <table className={crmTable.table} data-testid="table-orgs">
              <thead className={crmTable.thead}>
                <tr>
                  <th className={crmTable.th}>Org</th>
                  <th className={crmTable.th}>Owner</th>
                  <th className={crmTable.th}>Plan</th>
                  <th className={crmTable.thRight}>Members</th>
                  <th className={crmTable.thRight}>Clients</th>
                  <th className={crmTable.thRight}>Projects</th>
                  <th className={crmTable.thRight}>Estimates</th>
                  <th className={crmTable.thRight}>Invoices</th>
                  <th className={crmTable.th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {(orgs ?? []).map((o) => (
                  <tr
                    key={o.id}
                    className={`${crmTable.tr} cursor-pointer`}
                    data-testid={`row-org-${o.id}`}
                    onClick={() => setDetailOrgId(o.id)}
                  >
                    <td className={crmTable.td}><span className="font-medium">{o.name}</span></td>
                    <td className={crmTable.td}><span className="text-xs text-muted-foreground">{o.owner?.email ?? "—"}</span></td>
                    <td className={crmTable.td}><PlanPill plan={o.plan} beta={!!o.owner?.betaAt} /></td>
                    <td className={crmTable.tdRight}>{o.counts.members}</td>
                    <td className={crmTable.tdRight}>{o.counts.customers}</td>
                    <td className={crmTable.tdRight}>{o.counts.projects}</td>
                    <td className={crmTable.tdRight}>{o.counts.estimates}</td>
                    <td className={crmTable.tdRight}>{o.counts.invoices}</td>
                    <td className={crmTable.td}><span className="text-xs text-muted-foreground">{day(o.createdAt)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </CardContent>
      </Card>

      {/* ── JobCam storage ───────────────────────────────────────────────── */}
      <JobcamStorageAdminCard enabled={isAdmin && gateOpen} />

      {/* ── Beta invites ─────────────────────────────────────────────────── */}
      <Card data-testid="card-beta-invites">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <SectionTitle
            icon={Rocket}
            title="Beta invites"
            description="Invited accounts get unlimited CRM access for the duration of the beta."
            infoKey="beta-invites"
          />
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (betaEmail.trim()) sendInvite.mutate(betaEmail.trim());
            }}
          >
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="email"
                value={betaEmail}
                onChange={(e) => setBetaEmail(e.target.value)}
                placeholder="contractor@example.com"
                className="h-9 w-64 pl-8"
                required
                data-testid="input-beta-email"
              />
            </div>
            <Input
              type="tel"
              value={betaPhone}
              onChange={(e) => setBetaPhone(e.target.value)}
              placeholder="mobile (optional)"
              className="h-9 w-44"
              data-testid="input-beta-phone"
            />
            <Button type="submit" size="sm" disabled={sendInvite.isPending} data-testid="button-send-beta-invite">
              {sendInvite.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Send invite
            </Button>
          </form>

          {lastLink && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs" data-testid="beta-invite-link">
              <span className="truncate flex-1 font-mono">{lastLink}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                data-testid="button-copy-beta-link"
                onClick={async () => {
                  // A denied clipboard must not throw unhandled or tick "copied".
                  try {
                    await navigator.clipboard.writeText(lastLink);
                  } catch {
                    toast({ title: "Copy failed", description: "Select the link and copy it by hand.", variant: "destructive" });
                    return;
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}

          {invitesError ? (
            <p className="text-sm text-destructive">Couldn't load beta invites — refresh to try again.</p>
          ) : (invites ?? []).length === 0 ? (
            <EmptyState icon={Rocket} title="No invites yet" description="Invite a contractor to start the beta." compact />
          ) : (
            <div className={crmTable.wrapper}>
              <table className={crmTable.table} data-testid="table-beta-invites">
                <thead className={crmTable.thead}>
                  <tr>
                    <th className={crmTable.th}>Email</th>
                    <th className={crmTable.th}>Status</th>
                    <th className={crmTable.th}>Sent</th>
                    <th className={crmTable.th}>Expires</th>
                    <th className={crmTable.thRight}></th>
                  </tr>
                </thead>
                <tbody>
                  {(invites ?? []).map((inv) => (
                    <tr key={inv.id} className={crmTable.tr} data-testid={`row-beta-${inv.id}`}>
                      <td className={crmTable.td}><span className="font-medium">{inv.email}</span></td>
                      <td className={crmTable.td}>
                        <StatusPill tone={statusTone(inv.status)}>{inv.status}</StatusPill>
                      </td>
                      <td className={crmTable.td}><span className="text-xs text-muted-foreground">{day(inv.createdAt)}</span></td>
                      <td className={crmTable.td}><span className="text-xs text-muted-foreground">{day(inv.expiresAt)}</span></td>
                      <td className={crmTable.tdRight}>
                        {inv.status === "pending" && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (window.confirm(`Revoke the beta invite for ${inv.email}? The emailed link stops working.`)) {
                                revokeInvite.mutate(inv.id);
                              }
                            }}
                            disabled={revokeInvite.isPending}
                            data-testid={`button-revoke-beta-${inv.id}`}>
                            {revokeInvite.isPending
                              ? <Loader2 className="h-3.5 w-3.5 mr-1" />
                              : <Ban className="h-3.5 w-3.5 mr-1" />}
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Org detail drawer ────────────────────────────────────────────── */}
      <Sheet open={!!detailOrgId} onOpenChange={(open) => !open && setDetailOrgId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto" data-testid="sheet-org-detail">
          <SheetHeader>
            <SheetTitle>{orgDetail?.org.name ?? "Organization"}</SheetTitle>
            <SheetDescription>
              {orgDetail?.owner?.email ?? ""} · <PlanPill plan={orgDetail?.plan ?? { plan: "free", status: "inactive" }} beta={!!orgDetail?.owner?.betaAt} />
            </SheetDescription>
          </SheetHeader>
          {orgDetailError ? (
            <p className="px-4 py-8 text-sm text-destructive">Couldn't load this organization — close the drawer and try again.</p>
          ) : !orgDetail ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-6 px-4 pb-8">
              <div className="text-sm text-muted-foreground" data-testid="text-org-seats">
                Seats: {orgDetail.seats.used} used
                {orgDetail.seats.limit < 0 ? ` · unlimited${orgDetail.seats.plan === "beta" ? " (beta)" : ""}` : ` of ${orgDetail.seats.limit}`}
                {/* Without a plan the server reports plan "none" (planName "current"). */}
                {" · "}{orgDetail.seats.plan === "none" ? "no active plan" : `${orgDetail.seats.planName} plan`}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Members ({orgDetail.members.length})</div>
                <div className={crmTable.wrapper}>
                  <table className={crmTable.table}>
                    <tbody>
                      {orgDetail.members.map((m) => (
                        <tr key={m.id} className={crmTable.tr}>
                          <td className={crmTable.td}>
                            <div className="font-medium">{m.displayName || m.email}</div>
                            <div className="text-xs text-muted-foreground">{m.email}</div>
                          </td>
                          <td className={crmTable.td}><StatusPill tone={roleTone(m.role)} dot={false}>{m.role}</StatusPill></td>
                          <td className={crmTable.td}><span className="text-xs text-muted-foreground">{m.status}</span></td>
                          <td className={crmTable.tdRight}><span className="text-xs text-muted-foreground">{day(m.lastActiveAt)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Recent estimates</div>
                {orgDetail.recentEstimates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <div className={crmTable.wrapper}>
                    <table className={crmTable.table}>
                      <tbody>
                        {orgDetail.recentEstimates.map((e) => (
                          <tr key={e.id} className={crmTable.tr}>
                            <td className={crmTable.td}>{e.number ? `#${e.number} · ` : ""}{e.title}</td>
                            <td className={crmTable.td}><StatusPill tone={statusTone(e.status)}>{e.status}</StatusPill></td>
                            <td className={crmTable.tdRight}>{money(e.totalCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Recent invoices</div>
                {orgDetail.recentInvoices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                ) : (
                  <div className={crmTable.wrapper}>
                    <table className={crmTable.table}>
                      <tbody>
                        {orgDetail.recentInvoices.map((inv) => (
                          <tr key={inv.id} className={crmTable.tr}>
                            <td className={crmTable.td}>{inv.number ? `#${inv.number} · ` : ""}{inv.title}</td>
                            <td className={crmTable.td}><StatusPill tone={statusTone(inv.status)}>{inv.status}</StatusPill></td>
                            <td className={crmTable.tdRight}>{money(inv.totalCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── SEO data source (vendor + wholesale spend; customers never see this) ── */}
      <div className="space-y-3" data-testid="section-admin-seo">
        <SectionTitle icon={Search} title="SEO data source"
          description="The rank tracker, keyword research and backlinks run on a wholesale data API. Customers see plan units only; this is the real state and spend." />
        {seoStatus?.admin ? <DataSourceCard admin={seoStatus.admin} /> : <p className="g-text-2 text-[13px]">Loading…</p>}
      </div>

      {/* ── Visitor analytics (consent-gated first-party tracking) ────────── */}
      <div className="space-y-3" data-testid="section-admin-analytics">
        <SectionTitle icon={Activity} title="Visitor analytics"
          description="Consent-gated first-party tracking — pages, visitors, IPs. Only visitors who accepted the cookie banner appear here." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GoogleStat label="Visitors · 24h" value={analytics?.last24h?.visitors ?? "—"} />
          <GoogleStat label="Pageviews · 24h" value={analytics?.last24h?.events ?? "—"} />
          <GoogleStat label="Visitors · 7d" value={analytics?.last7d?.visitors ?? "—"} />
          <GoogleStat label="Pageviews · 7d" value={analytics?.last7d?.events ?? "—"} />
        </div>
        {(analytics?.topPages?.length ?? 0) > 0 && (
          <Card><CardContent className="p-4">
            <div className="text-sm font-medium mb-2">Top pages · 7d</div>
            <div className="space-y-1">
              {analytics.topPages.map((tp: any) => (
                <div key={tp.path} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{tp.path}</span>
                  <span className="tabular-nums font-medium shrink-0">{tp.views}</span>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>When</th>
                <th className={crmTable.th}>Who</th>
                <th className={crmTable.th}>Page</th>
                <th className={crmTable.th}>IP</th>
                <th className={`${crmTable.th} hidden lg:table-cell`}>Device</th>
              </tr>
            </thead>
            <tbody>
              {analyticsError && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-destructive">
                  Couldn't load visitor analytics — refresh to try again.
                </td></tr>
              )}
              {!analyticsError && (analytics?.recent ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No tracked visits yet — they appear once visitors accept the cookie banner.
                </td></tr>
              )}
              {(analytics?.recent ?? []).map((r: any) => (
                <tr key={r.id} className={crmTable.tr}>
                  <td className={`${crmTable.td} whitespace-nowrap text-muted-foreground`}>
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className={crmTable.td}>
                    {r.email
                      ? <span className="font-medium">{r.email}</span>
                      : <span className="text-muted-foreground">visitor {r.visitorId}</span>}
                  </td>
                  <td className={`${crmTable.td} max-w-[220px] truncate`}>{r.path}</td>
                  <td className={`${crmTable.td} tabular-nums text-muted-foreground`}>{r.ip || "—"}</td>
                  <td className={`${crmTable.td} hidden lg:table-cell max-w-[260px] truncate text-muted-foreground`}>{r.userAgent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Hub assistant, Gabe (counts only; Gabe never stores what anyone asked) ── */}
      <div className="space-y-3" data-testid="section-admin-hub">
        <SectionTitle icon={MessageCircle} title="Hub assistant"
          description="Outcome counts for Gabe, the corner assistant, over the last 30 days. Gabe keeps no messages, replies or identities." />
        <div className={crmTable.wrapper}>
          <table className={crmTable.table}>
            <thead className={crmTable.thead}>
              <tr>
                <th className={crmTable.th}>Visitor</th>
                <th className={crmTable.th}>Outcome</th>
                <th className={crmTable.th}>Reason</th>
                <th className={crmTable.thRight}>Count</th>
              </tr>
            </thead>
            <tbody>
              {hubStatsError && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-destructive">
                  Couldn't load Hub stats — refresh to try again.
                </td></tr>
              )}
              {!hubStatsError && (hubStats?.rows ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No Hub activity in the last 30 days.
                </td></tr>
              )}
              {(hubStats?.rows ?? []).map((r) => (
                <tr key={`${r.tier}-${r.outcome}-${r.reason}`} className={crmTable.tr}>
                  <td className={crmTable.td}>{r.tier === "builder" ? "Signed in" : "Signed out"}</td>
                  <td className={crmTable.td}>{r.outcome.replace(/_/g, " ")}</td>
                  <td className={`${crmTable.td} text-muted-foreground`}>{r.reason}</td>
                  <td className={crmTable.tdRight}>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </CrmPage>
  );
}
