import { Tabs } from "@/components/ui/tabs";
import { AppPage, Section, AppTabsList, Toolbar, Notice, appTable, appTableCards } from "@/components/app-ui";
import { GoogleSectionHeader, GooglePill, GoogleStat, GoogleStatGrid, GoogleList, GoogleListRow } from "@/components/google";
import { SamplePreview, showSample } from "@/components/sample-preview";
import { ToolTabs } from "@/components/tool";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Shield, Link2, Users, Settings2, RefreshCw, Plus, CheckCircle,
  AlertTriangle, Clock, X, ChevronRight, DollarSign, Pause, Play,
  FileText, Search, Eye, Wifi, WifiOff, Send, BarChart3, History, Pencil,
  Loader2, ShieldCheck,
} from "lucide-react";
import { useLocation } from "wouter";
import { useRouteTab } from "@/components/google-ads-tool/use-route-tab";
import { LSA_MANAGER_TABS } from "@/components/google-ads-tool/nav";

type ManagerStatus = {
  connected: boolean;
  managerId?: string;
  connectedAt?: string;
  lastRefreshedAt?: string;
  status?: string;
  hasDeveloperToken?: boolean;
};

type LsaAccount = {
  id: number;
  customerId: string;
  accountName: string | null;
  userId: number | null;
  linkType: string;
  linkStatus: string;
  isLsaEnrolled: boolean | null;
  leadCount: number;
  totalSpend: string | null;
  createdAt: string;
  chargedLeads?: number;
  disputedLeads?: number;
  ownerEmail?: string | null;
};

type LsaInvitation = {
  id: number;
  targetCustomerId: string;
  accountName: string | null;
  status: string;
  invitedAt: string;
  resolvedAt: string | null;
  notes: string | null;
};

type Campaign = {
  resourceName: string;
  id: string;
  name: string;
  status: string;
  budgetResourceName: string;
  dailyBudgetMicros: string;
  dailyBudgetFormatted: string;
  channelType: string;
  isLsa: boolean;
};

type LsaLead = {
  id: number;
  accountId: number;
  googleLeadId: string;
  leadType: string | null;
  status: string;
  customerName: string | null;
  serviceRequested: string | null;
  charged: boolean;
  chargeAmount: string | null;
  disputed: boolean;
  disputeReason: string | null;
  leadCreatedAt: string | null;
  createdAt: string;
};

type AuditEntry = {
  id: number;
  actorEmail: string;
  action: string;
  targetCustomerId: string | null;
  targetAccountName: string | null;
  parameters: any;
  result: string;
  errorMessage: string | null;
  createdAt: string;
};

type Tab = "manager" | "accounts" | "invitations" | "audit";
// The "i" beside the title: each section mounts its own help entry (shared/help/entries/google-ads/lsa-account-manager*).
const HELP_BY_TAB: Record<Tab, string> = { manager: "lsa-account-manager", accounts: "lsa-account-manager.accounts", invitations: "lsa-account-manager.invitations", audit: "lsa-account-manager.audit-log" };
// One plain sentence under the title, per section.
const DESCRIPTION: Record<Tab, string> = {
  manager: "Connect ConstructHUB’s central Google Ads manager account and pull in the client accounts under it.",
  accounts: "Every client account the central manager knows, with its leads, charges and spend; open one for its campaigns and leads.",
  invitations: "Invite a client’s Google Ads account to link under the central manager, and record each answer.",
  audit: "Every change an admin made here, with who, when, the account and the result.",
};

/** A plain three-step card above a bare form (owner 2026-10-15: explain every form in a busy contractor's words). */
function HowThisWorks({ steps, testId }: { steps: string[]; testId?: string }) {
  return (
    <Section flush testId={testId}>
      <CardHeader><CardTitle className="g-card__title g-card__title--md">How this works</CardTitle></CardHeader>
      <CardContent><ol className="list-decimal space-y-1.5 pl-5 text-sm">{steps.map((st) => <li key={st}>{st}</li>)}</ol></CardContent>
    </Section>
  );
}
/** Obviously made-up rows, shown only while the real list is empty (components/sample-preview.tsx rules). */
function SampleAccounts() {
  return (
    <>
      <GoogleStatGrid cols={4} className="mb-3">
        <GoogleStat label="Accounts" value="2" />
        <GoogleStat label="Leads" value="31" />
        <GoogleStat label="Charged" value="19" tone="bad" />
        <GoogleStat label="Spend" value="$1,240.00" />
      </GoogleStatGrid>
      <GoogleList>
        <GoogleListRow size="md" title="Sample Roofing Co." badges={<><span className="g-chip g-chip--sm g-open">LSA</span><span className="g-chip g-chip--sm">central</span><span className="g-chip g-chip--sm">active</span></>} meta={["000-000-0001", "owner@example.com", "22 leads", <span key="c" className="g-closed">14 charged</span>, "2 disputed", "$940.00 spend"]} actions={<><GooglePill size="sm" label="View" /><GooglePill size="sm" label="Campaigns" /><GooglePill size="sm" label="Leads" /></>} />
        <GoogleListRow size="md" title="Sample Plumbing LLC" badges={<><span className="g-chip g-chip--sm">self</span><span className="g-chip g-chip--sm">active</span></>} meta={["000-000-0002", "9 leads", <span key="c" className="g-closed">5 charged</span>, "$300.00 spend"]} actions={<><GooglePill size="sm" label="View" /><GooglePill size="sm" label="Campaigns" /><GooglePill size="sm" label="Leads" /></>} />
      </GoogleList>
    </>
  );
}
function SampleInvitations() {
  return (
    <GoogleList>
      <GoogleListRow size="md" title="Sample Roofing Co." badges={<span className="g-chip g-chip--sm">pending</span>} meta={["Customer ID: 000-000-0001", "Invited today"]} line="Waiting for the client to accept in their Google Ads account" actions={<><GooglePill size="sm" label="Mark accepted" /><GooglePill size="sm" label="Cancel" /></>} />
      <GoogleListRow size="md" title="Sample Plumbing LLC" badges={<span className="g-chip g-chip--sm g-open">accepted</span>} meta={["Customer ID: 000-000-0002", "Invited last week"]} />
    </GoogleList>
  );
}

export default function LsaAccountManagerPage() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [, navigate] = useLocation();
  // Each section is its own address (/lsa-account-manager/accounts …); old ?tab= links move there.
  const [activeTab, setActiveTab] = useRouteTab<Tab>("/lsa-account-manager", LSA_MANAGER_TABS);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  // Who counts as a platform admin is the server's decision (server/admin.ts,
  // including the dev-bypass account); /api/auth/me reports it, so the client
  // keeps no second, drifting email list. The admin API still enforces it.
  const isAdmin = user?.isPlatformAdmin === true;
  // The admin passphrase wall (same one the /crm/admin console uses). Its status
  // route only reads the session, unlike the old probe of the LSA data route.
  const { data: gate, isLoading: gateLoading, isError: gateCheckFailed } = useQuery<{ gateConfigured: boolean; gatePassed: boolean }>({
    queryKey: ["/api/admin/gate"],
    enabled: isAdmin,
  });

  if (!user) return null;

  if (isAdmin && gateLoading) {
    return (
      <div className="h-full flex items-center justify-center p-8" data-testid="view-lsa-access-checking">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isAdmin && gate && gate.gateConfigured && !gate.gatePassed) return <AdminGateCard />;

  if (isAdmin && (gateCheckFailed || !gate)) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Section flush className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-base font-semibold mb-2" data-testid="text-access-check-failed">Couldn't check access</h2>
            <p className="text-sm text-muted-foreground">Refresh the page to try again.</p>
          </CardContent>
        </Section>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Section flush className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-base font-semibold mb-2" data-testid="text-access-denied">Access denied</h2>
            <p className="text-sm text-muted-foreground">This section is restricted to ConstructHUB administrators only.</p>
          </CardContent>
        </Section>
      </div>
    );
  }

  if (selectedAccountId) {
    return <AppPage><GoogleSectionHeader as="h1" helpKey="lsa-account-manager.accounts" title="LSA account details" description="This account’s campaigns and leads, live from Google; every change here is recorded in the audit log." flush actions={<GooglePill icon={RefreshCw} variant="solid" label="Refresh account" onClick={() => queryClient.invalidateQueries({queryKey:["/api/admin/lsa/accounts", selectedAccountId]})} />} /><AccountDetailView accountId={selectedAccountId} onBack={() => setSelectedAccountId(null)} /></AppPage>;
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "manager", label: "Manager connection", icon: Wifi },
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "invitations", label: "Invitations", icon: Send },
    { id: "audit", label: "Audit log", icon: History },
  ];

  const helpKey = HELP_BY_TAB[activeTab];
  return (
    <AppPage className="[&_button]:min-h-10">
      {/* Google's page format (owner, 2026-10-07): a quiet header, pill tabs and actions, hairline cards. */}
      <GoogleSectionHeader
        as="h1"
        helpKey={helpKey}
        titleTestId="text-page-title"
        title={activeTab === "manager" ? "LSA account manager" : tabs.find((t) => t.id === activeTab)!.label}
        description={<>{DESCRIPTION[activeTab]} <span className="g-chip g-chip--sm ml-1 align-middle" data-testid="badge-admin-only">Admin only</span></>}
        flush
        actions={activeTab === "audit" ? <GooglePill icon={RefreshCw} variant="solid" label="Refresh audit" onClick={() => queryClient.invalidateQueries({queryKey:["/api/admin/lsa/audit-log"]})} /> : undefined} />
        <ToolTabs as="tablist" label="LSA account manager sections">
          {tabs.map(tab => (
            <GooglePill
              key={tab.id}
              icon={tab.icon}
              label={tab.label}
              selected={activeTab === tab.id}
              role="tab"
              ariaPressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              testId={`tab-${tab.id}`}
            />
          ))}
        </ToolTabs>

        {activeTab === "manager" && <ManagerConnectionTab />}
        {activeTab === "accounts" && <AccountsTab onSelectAccount={setSelectedAccountId} />}
        {activeTab === "invitations" && <InvitationsTab />}
        {activeTab === "audit" && <AuditLogTab />}
    </AppPage>
  );
}

/** The platform-admin passphrase wall (same one the /crm/admin console uses). */
function AdminGateCard() {
  const { toast } = useToast();
  const [gateUser, setGateUser] = useState("");
  const [gatePass, setGatePass] = useState("");
  const gateLogin = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/admin/gate", { username: gateUser, password: gatePass })).json(),
    onSuccess: () => {
      setGatePass("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/gate"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/manager"] });
    },
    onError: (e: any) => toast({ title: "Sign-in failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="h-full flex items-center justify-center p-8">
      <Section flush className="max-w-sm w-full" testId="card-admin-gate">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" /> Platform admin sign-in
          </CardTitle>
          <p className="text-sm text-muted-foreground">The LSA Account Manager needs the admin console credentials.</p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (gateUser && gatePass && !gateLogin.isPending) gateLogin.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="lsa-gate-user">Username</Label>
              <Input id="lsa-gate-user" autoComplete="username" value={gateUser}
                onChange={(e) => setGateUser(e.target.value)} data-testid="input-admin-gate-user" />
            </div>
            <div>
              <Label htmlFor="lsa-gate-pass">Password</Label>
              <Input id="lsa-gate-pass" type="password" autoComplete="current-password" value={gatePass}
                onChange={(e) => setGatePass(e.target.value)} data-testid="input-admin-gate-pass" />
            </div>
            <Button type="submit" className="w-full" disabled={!gateUser || !gatePass || gateLogin.isPending}
              data-testid="button-admin-gate-login">
              {gateLogin.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Sign in
            </Button>
          </form>
        </CardContent>
      </Section>
    </div>
  );
}

function ManagerConnectionTab() {
  const { toast } = useToast();
  const [showConnect, setShowConnect] = useState(false);
  const [managerId, setManagerId] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [developerToken, setDeveloperToken] = useState("");

  const { data: status, isLoading } = useQuery<ManagerStatus>({
    queryKey: ["/api/admin/lsa/manager"],
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/lsa/manager/connect", { managerId, refreshToken, developerToken });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/manager"] });
      toast({ title: "Manager account connected", description: "Google accepted the refresh token. The manager ID is checked when you sync child accounts." });
      setShowConnect(false);
      setManagerId(""); setRefreshToken(""); setDeveloperToken("");
    },
    // The dialog stays open with the entered values so the admin can correct them.
    onError: (e: unknown) => toast({ title: "Connection failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/lsa/manager/disconnect", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/manager"] });
      toast({ title: "Manager account disconnected" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/lsa/manager/sync-accounts", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts"] });
      toast({ title: `Synced ${data.synced} child accounts` });
    },
    onError: (e: unknown) => toast({ title: "Sync failed", description: apiErrorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Section flush testId="card-manager-status">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            Manager connection
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-16 flex items-center justify-center">
              <div className="animate-spin h-5 w-5 border-2 border-[#4285F4] border-t-transparent rounded-full" />
            </div>
          ) : status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-emerald-600 dark:text-emerald-400" data-testid="text-manager-connected">Connected</p>
                  <p className="text-sm text-muted-foreground">Manager ID: <span className="font-mono" data-testid="text-manager-id">{status.managerId}</span></p>
                </div>
                <Badge className={status.hasDeveloperToken ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"}>
                  {status.hasDeveloperToken ? "API access" : "API access needed"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Connected at</p>
                  <p className="font-medium" data-testid="text-connected-at">{status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last refreshed</p>
                  <p className="font-medium">{status.lastRefreshedAt ? new Date(status.lastRefreshedAt).toLocaleDateString() : "Never"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-accounts">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing..." : "Sync accounts"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowConnect(true)} data-testid="button-reconfigure">
                  <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Reconfigure
                </Button>
                <Button size="sm" variant="destructive" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} data-testid="button-disconnect">
                  <WifiOff className="h-3.5 w-3.5 mr-1.5" /> Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Notice tone="warning"><span data-testid="text-manager-not-connected">Not connected</span> · Connect a Google Ads manager account.</Notice>
              <HowThisWorks testId="how-manager-connection" steps={["Choose Connect manager and enter the MCC customer ID (digits only) and a refresh token from the manager account’s OAuth flow; it is checked with Google before anything is saved.", "Choose Sync accounts: every client account under the MCC appears under Accounts, marked when it runs Local Services Ads.", "Use Invitations to link more clients; each client accepts the invitation in their own Google Ads account."]} />
              <Button onClick={() => setShowConnect(true)} className="w-full sm:w-auto" data-testid="button-connect-manager">
                <Link2 className="h-4 w-4 mr-2" /> Connect manager
              </Button>
            </div>
          )}
        </CardContent>
      </Section>

      <details><summary className="cursor-pointer py-3 text-sm font-medium">Advanced · Setup requirements</summary>
      <Section flush>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Setup requirements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            "Create a Google Ads Manager (MCC) account owned by ConstructHUB / support@constructhub.us",
            "Apply for a Google Ads API developer token (Standard access) under that manager account",
            "Publish the OAuth consent screen and register the manager redirect URI in Google Cloud",
            "Use access_type=offline + prompt=consent when obtaining the manager refresh token",
            "Each client must accept the manager-link invitation inside their own Google Ads account",
          ].map((req, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{req}</span>
            </div>
          ))}
        </CardContent>
      </Section>

      </details>
      <Dialog open={showConnect} onOpenChange={open => { setShowConnect(open); if (!open) connectMutation.reset(); }}>
        <DialogContent data-testid="dialog-connect-manager">
          <DialogHeader>
            <DialogTitle>Connect manager account</DialogTitle>
            <DialogDescription>Link the Google Ads manager account that holds your Local Services accounts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="managerId">Manager customer ID</Label>
              <Input
                id="managerId"
                placeholder="1234567890 (digits only, no dashes)"
                value={managerId}
                onChange={e => setManagerId(e.target.value)}
                data-testid="input-manager-id"
              />
              <p className="text-xs text-muted-foreground">Your Google Ads MCC customer ID — digits only.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="refreshToken">Refresh token</Label>
              <Input
                id="refreshToken"
                type="password"
                placeholder="OAuth2 refresh token (from manager account OAuth flow)"
                value={refreshToken}
                onChange={e => setRefreshToken(e.target.value)}
                data-testid="input-refresh-token"
              />
              <p className="text-xs text-muted-foreground">Obtained via OAuth with access_type=offline + prompt=consent. Checked with Google before anything is saved.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="developerToken">Developer token <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="developerToken"
                type="password"
                placeholder="Google Ads API developer token"
                value={developerToken}
                onChange={e => setDeveloperToken(e.target.value)}
                data-testid="input-developer-token"
              />
              <p className="text-xs text-muted-foreground">Falls back to GOOGLE_ADS_DEVELOPER_TOKEN env var if left blank.</p>
            </div>
            {connectMutation.isError && (
              <p role="alert" className="text-sm text-destructive" data-testid="error-connect-manager">{apiErrorMessage(connectMutation.error)}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowConnect(false); connectMutation.reset(); }}>Cancel</Button>
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={!managerId || !refreshToken || connectMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-save-connect"
            >
              {connectMutation.isPending ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountsTab({ onSelectAccount }: { onSelectAccount: (id: number) => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");

  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: accountsData, isLoading, isError: accountsError } = useQuery<{ accounts: LsaAccount[]; total: number; limit: number; offset: number }>({
    queryKey: ["/api/admin/lsa/accounts", page, search],
    // A 4xx/5xx is an error, not an empty list (no sample on a failed request).
    queryFn: () => fetch(`/api/admin/lsa/accounts?limit=${pageSize}&offset=${page * pageSize}&q=${encodeURIComponent(search)}`).then(r => { if (!r.ok) throw new Error(`Couldn't load accounts (${r.status})`); return r.json(); }),
  });

  const accounts = accountsData?.accounts || [];
  const totalAccounts = accountsData?.total || 0;
  const totalPages = Math.ceil(totalAccounts / pageSize);
  // The summary row adds up the accounts on this page only, and says so.
  const spendOf = (a: LsaAccount) => { const n = Number(String(a.totalSpend ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
  const sums = accounts.reduce((n, a) => ({ leads: n.leads + (a.leadCount ?? 0), charged: n.charged + (a.chargedLeads ?? 0), disputed: n.disputed + (a.disputedLeads ?? 0), spend: n.spend + spendOf(a), lsa: n.lsa + (a.isLsaEnrolled ? 1 : 0) }), { leads: 0, charged: 0, disputed: 0, spend: 0, lsa: 0 });
  const scope = totalPages > 1 ? `Accounts on this page (${accounts.length} of ${totalAccounts})` : undefined;
  const linkChip = (t: string) => t === "central" ? "g-chip g-chip--sm" : t === "both" ? "g-chip g-chip--sm g-open" : "g-chip g-chip--sm";

  const addAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/lsa/accounts", {
        customerId: newCustomerId,
        accountName: newAccountName || undefined,
        linkType: "self",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts"] });
      toast({ title: "Account added" });
      setShowAdd(false);
      setNewCustomerId(""); setNewAccountName("");
    },
    onError: (e: any) => toast({ title: "Failed to add account", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="g-search w-full flex-1 min-w-[200px]" role="search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by customer ID or name..."
            aria-label="Search by customer ID or name"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            data-testid="input-search-accounts"
          />
        </div>
        <GooglePill icon={Plus} variant={showAdd ? "outline" : "solid"} label="Add account" onClick={() => setShowAdd(true)} className="w-full sm:w-auto" testId="button-add-account" />
      </div>

      {showAdd && (
        <Section flush testId="card-add-account">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Customer ID</Label>
                <Input placeholder="1234567890" value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)} data-testid="input-new-customer-id" />
              </div>
              <div className="space-y-1">
                <Label>Account name (optional)</Label>
                <Input placeholder="Client name" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} data-testid="input-new-account-name" />
              </div>
            </div>
            <div className="flex gap-2">
              <GooglePill variant="solid" label={addAccountMutation.isPending ? "Adding..." : "Add account"} onClick={() => addAccountMutation.mutate()} disabled={!newCustomerId || addAccountMutation.isPending} className="w-full sm:w-auto" testId="button-save-account" />
              <GooglePill variant="quiet" label="Cancel" onClick={() => setShowAdd(false)} />
            </div>
          </CardContent>
        </Section>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : accounts.length === 0 ? (
        accountsError ? (
          <Section flush><CardContent className="p-8 text-center"><p className="text-sm text-destructive" role="alert" data-testid="text-accounts-error">Couldn't load accounts — refresh to try again.</p></CardContent></Section>
        ) : search ? (
          <Section flush><CardContent className="p-8 text-center"><p className="font-medium" data-testid="text-no-accounts">No account matches “{search}”</p></CardContent></Section>
        ) : !showSample({ isLoading, isError: accountsError, total: accountsData ? totalAccounts : undefined, filtered: !!search, page }) ? (
          <Section flush><CardContent className="p-8 text-center"><p className="font-medium" data-testid="text-no-accounts-page">No accounts on this page.</p></CardContent></Section>
        ) : (
          <SamplePreview what="what you’ll see once accounts are synced or added" testId="sample-lsa-manager-accounts" cta={<GooglePill size="sm" variant="solid" icon={Plus} label="Add account" onClick={() => setShowAdd(true)} />}>
            <p className="sr-only" data-testid="text-no-accounts">No accounts yet</p>
            <SampleAccounts />
          </SamplePreview>
        )
      ) : (
        <>
          {/* The SEO Suite look (owner 2026-10-15): a quiet summary row, then one card per account with its numbers and actions. */}
          <GoogleStatGrid cols={4}>
            <GoogleStat label="Accounts" value={totalAccounts.toLocaleString()} hint={sums.lsa ? `${sums.lsa} with Local Services Ads${scope ? " on this page" : ""}` : undefined} testId="stat-accounts" />
            <GoogleStat label="Leads" value={sums.leads.toLocaleString()} hint={scope} testId="stat-leads-total" />
            <GoogleStat label="Charged" value={sums.charged.toLocaleString()} tone={sums.charged > 0 ? "bad" : "default"} hint={sums.disputed ? `${sums.disputed} disputed` : scope} testId="stat-charged-total" />
            <GoogleStat label="Spend" value={sums.spend ? `$${sums.spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"} hint={sums.spend ? (scope ?? "Across these accounts") : "No spend recorded"} testId="stat-spend-total" />
          </GoogleStatGrid>
          <GoogleList testId="table-accounts">
            {accounts.map(account => (
              <GoogleListRow
                key={account.id}
                size="md"
                testId={`row-account-${account.id}`}
                title={account.accountName || `Account ${account.customerId}`}
                onOpen={() => onSelectAccount(account.id)}
                badges={<>
                  {account.isLsaEnrolled && <span className="g-chip g-chip--sm g-open">LSA</span>}
                  <span className={linkChip(account.linkType)}>{account.linkType}</span>
                  <span className={account.linkStatus === "active" ? "g-chip g-chip--sm g-open" : "g-chip g-chip--sm g-closed"}>{account.linkStatus}</span>
                </>}
                meta={[
                  <span key="id" data-testid={`text-customer-id-${account.id}`}>{account.customerId}</span>,
                  account.ownerEmail ? <span key="owner" data-testid={`text-owner-${account.id}`} title={account.ownerEmail}>{account.ownerEmail}</span> : null,
                  <span key="leads" data-testid={`text-lead-count-${account.id}`}>{account.leadCount} leads</span>,
                  (account.chargedLeads ?? 0) > 0 ? <span key="charged" className="g-closed" data-testid={`text-charged-leads-${account.id}`}>{account.chargedLeads} charged</span> : "0 charged",
                  (account.disputedLeads ?? 0) > 0 ? <span key="disputed" data-testid={`text-disputed-leads-${account.id}`}>{account.disputedLeads} disputed</span> : null,
                  <span key="spend" data-testid={`text-total-spend-${account.id}`}>{account.totalSpend ? `${account.totalSpend} spend` : "No spend recorded"}</span>,
                ]}
                line={`Added ${new Date(account.createdAt).toLocaleDateString()}`}
                actions={<>
                  <GooglePill size="sm" icon={Eye} label="View" onClick={() => onSelectAccount(account.id)} testId={`button-view-account-${account.id}`} />
                  <GooglePill size="sm" icon={BarChart3} label="Campaigns" onClick={() => onSelectAccount(account.id)} />
                  <GooglePill size="sm" icon={FileText} label="Leads" onClick={() => onSelectAccount(account.id)} />
                </>}
              />
            ))}
          </GoogleList>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground" data-testid="text-accounts-pagination">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalAccounts)} of {totalAccounts} accounts
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} data-testid="button-accounts-prev">
              Previous
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} data-testid="button-accounts-next">
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InvitationsTab() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [notes, setNotes] = useState("");

  const { data: invitations = [], isLoading, isError: invitationsError } = useQuery<LsaInvitation[]>({
    queryKey: ["/api/admin/lsa/invitations"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/lsa/invitations", { targetCustomerId, accountName, notes });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/invitations"] });
      const googleOk = data.googleResult?.ok;
      toast({
        title: googleOk ? "Invitation sent" : "Invitation recorded (API error)",
        description: googleOk
          ? "The client must accept the invitation in their own Google Ads account."
          : data.googleResult?.error || "Invitation saved locally but Google API call failed.",
        variant: googleOk ? "default" : "destructive",
      });
      setShowForm(false);
      setTargetCustomerId(""); setAccountName(""); setNotes("");
    },
    onError: (e: any) => toast({ title: "Failed to create invitation", description: e.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/lsa/invitations/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts"] });
      toast({ title: "Invitation updated" });
    },
  });

  const statusColor = (s: string) => {
    if (s === "accepted") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (s === "pending") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    if (s === "refused" || s === "cancelled") return "bg-red-500/10 text-red-500 border-red-500/20";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Invite client Google Ads accounts to link under the central manager. Clients must accept the invitation in their own Google Ads account.
        </p>
        <Button variant={showForm ? "outline" : "default"} size="sm" onClick={() => setShowForm(true)} className="bg-primary text-white shrink-0" data-testid="button-new-invitation">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New invitation
        </Button>
      </div>

      {showForm && (
        <HowThisWorks testId="how-invitations" steps={["Type the client’s 10-digit Google Ads customer ID (digits only); a name and notes are for your own list.", "Choose Send invitation: Google creates a pending manager-link invitation from the central manager and it is recorded below.", "The client accepts it in their own Google Ads account; when they confirm, choose Mark accepted and the account joins the Accounts list."]} />
      )}
      {showForm && (
        <Section flush testId="card-invitation-form">
          <CardHeader>
            <CardTitle className="text-sm">Link a client account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              The client must log into their Google Ads account and <strong>accept the manager-link invitation</strong> before you can access their campaigns. Mark the invitation as "accepted" here once they confirm.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Client customer ID</Label>
                <Input placeholder="1234567890 (digits only)" value={targetCustomerId} onChange={e => setTargetCustomerId(e.target.value)} data-testid="input-target-customer-id" />
              </div>
              <div className="space-y-1">
                <Label>Client name (optional)</Label>
                <Input placeholder="ABC Roofing LLC" value={accountName} onChange={e => setAccountName(e.target.value)} data-testid="input-invitation-account-name" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notes (optional)</Label>
                <Input placeholder="Internal notes about this account" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-invitation-notes" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={!targetCustomerId || createMutation.isPending} className="w-full sm:w-auto" data-testid="button-send-invitation">
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {createMutation.isPending ? "Sending..." : "Send invitation"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Section>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : invitationsError && invitations.length === 0 ? (
        <Section flush><CardContent className="p-8 text-center"><p className="text-sm text-destructive" role="alert" data-testid="text-invitations-error">Couldn't load invitations — refresh to try again.</p></CardContent></Section>
      ) : showSample({ isLoading, isError: invitationsError, total: invitations.length }) ? (
        <SamplePreview what="what you’ll see once an invitation is sent" testId="sample-lsa-invitations" cta={<GooglePill size="sm" variant="solid" icon={Plus} label="New invitation" onClick={() => setShowForm(true)} />}>
          <p className="sr-only" data-testid="text-no-invitations">No invitations yet</p>
          <SampleInvitations />
        </SamplePreview>
      ) : (
        <div className="space-y-3">
          {invitations.map(inv => (
            <Section flush key={inv.id} testId={`card-invitation-${inv.id}`}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium" data-testid={`text-inv-name-${inv.id}`}>{inv.accountName || "Unnamed Account"}</span>
                      <Badge className={statusColor(inv.status)} data-testid={`badge-inv-status-${inv.id}`}>
                        {inv.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                        {inv.status === "accepted" && <CheckCircle className="h-3 w-3 mr-1" />}
                        {inv.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono" data-testid={`text-inv-customer-id-${inv.id}`}>Customer ID: {inv.targetCustomerId}</p>
                    {inv.notes && <p className="text-xs text-muted-foreground mt-1">{inv.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Invited {new Date(inv.invitedAt).toLocaleDateString()}</p>
                  </div>
                  {inv.status === "pending" && (
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white text-xs"
                        onClick={() => updateStatusMutation.mutate({ id: inv.id, status: "accepted" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-accept-invitation-${inv.id}`}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" /> Mark accepted
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => updateStatusMutation.mutate({ id: inv.id, status: "cancelled" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-cancel-invitation-${inv.id}`}
                      >
                        <X className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountDetailView({ accountId, onBack }: { accountId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"campaigns" | "leads">("campaigns");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; description: string; onConfirm: () => void;
  } | null>(null);
  const [budgetDialog, setBudgetDialog] = useState<{ campaign: Campaign } | null>(null);
  const [newBudget, setNewBudget] = useState("");
  const [renameDialog, setRenameDialog] = useState<{ campaign: Campaign } | null>(null);
  const [newName, setNewName] = useState("");
  const [disputeDialog, setDisputeDialog] = useState<{ lead: LsaLead } | null>(null);
  const [disputeReason, setDisputeReason] = useState("");

  const { data: detail, isLoading } = useQuery<{ account: LsaAccount; leads: LsaLead[] }>({
    queryKey: ["/api/admin/lsa/accounts", accountId],
    queryFn: () => fetch(`/api/admin/lsa/accounts/${accountId}`).then(r => r.json()),
  });

  const { data: campaigns = [], isLoading: campaignsLoading, error: campaignsError } = useQuery<Campaign[]>({
    queryKey: ["/api/admin/lsa/accounts", accountId, "campaigns"],
    queryFn: () => fetch(`/api/admin/lsa/accounts/${accountId}/campaigns`).then(r => r.json()),
    enabled: activeTab === "campaigns",
    retry: false,
  });

  const budgetMutation = useMutation({
    mutationFn: async ({ campaign, budget }: { campaign: Campaign; budget: number }) => {
      const res = await apiRequest("PATCH", `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/budget`, {
        newDailyBudgetDollars: budget,
        budgetResourceName: campaign.budgetResourceName,
        campaignResourceName: campaign.resourceName,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", accountId, "campaigns"] });
      toast({ title: "Budget updated" });
      setBudgetDialog(null);
      setNewBudget("");
    },
    onError: (e: any) => toast({ title: "Budget update failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ campaign, newStatus }: { campaign: Campaign; newStatus: "ENABLED" | "PAUSED" }) => {
      const res = await apiRequest("PATCH", `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/status`, {
        newStatus,
        campaignResourceName: campaign.resourceName,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", accountId, "campaigns"] });
      toast({ title: "Campaign status updated" });
      setConfirmDialog(null);
    },
    onError: (e: any) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ campaign, name }: { campaign: Campaign; name: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/lsa/accounts/${accountId}/campaigns/${campaign.id}/settings`, {
        campaignResourceName: campaign.resourceName,
        name,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", accountId, "campaigns"] });
      toast({ title: "Campaign renamed" });
      setRenameDialog(null);
      setNewName("");
    },
    onError: (e: any) => toast({ title: "Rename failed", description: e.message, variant: "destructive" }),
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ leadId, reason }: { leadId: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/lsa/leads/${leadId}/dispute`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", accountId] });
      toast({ title: "Lead disputed" });
      setDisputeDialog(null);
      setDisputeReason("");
    },
    onError: (e: any) => toast({ title: "Dispute failed", description: e.message, variant: "destructive" }),
  });

  const syncLeadsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/lsa/accounts/${accountId}/sync-leads`, {});
      return res.json();
    },
    onSuccess: (data: { imported: number; newCharged: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", accountId] });
      toast({ title: `Synced ${data.imported} lead${data.imported === 1 ? "" : "s"}${data.newCharged > 0 ? ` — ${data.newCharged} newly charged` : ""}` });
    },
    onError: (e: any) => toast({ title: "Lead sync failed", description: e.message, variant: "destructive" }),
  });

  const account = detail?.account;
  const leads = detail?.leads || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" /> Back
        </Button>
        {account && (
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2 className="font-semibold" data-testid="text-account-name">{account.accountName || "Unnamed Account"}</h2>
            <Badge className={account.linkType === "central" ? "bg-primary/10 text-muted-foreground border-[#4285F4]/20" : "bg-muted text-muted-foreground"}>
              {account.linkType}
            </Badge>
            <span className="text-sm text-muted-foreground font-mono">{account.customerId}</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto bg-muted rounded-xl p-1 w-full sm:w-fit">
        <Button size="sm" variant={activeTab === "campaigns" ? "secondary" : "ghost"} className={activeTab === "campaigns" ? "bg-muted text-foreground" : "text-muted-foreground"} onClick={() => setActiveTab("campaigns")} data-testid="tab-campaigns">
          <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Campaigns
        </Button>
        <Button size="sm" variant={activeTab === "leads" ? "secondary" : "ghost"} className={activeTab === "leads" ? "bg-muted text-foreground" : "text-muted-foreground"} onClick={() => setActiveTab("leads")} data-testid="tab-leads">
          <FileText className="h-3.5 w-3.5 mr-1.5" /> Leads
        </Button>
      </div>

      {activeTab === "campaigns" && (
        <div>
          {campaignsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
            </div>
          ) : campaignsError ? (
            <Section flush>
              <CardContent className="p-8 text-center">
                <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                <p className="font-medium" data-testid="text-campaigns-error">Failed to load campaigns</p>
                <p className="text-sm text-muted-foreground mt-1">{(campaignsError as any)?.message || "Google Ads API error. Ensure the manager connection is active and the developer token is configured."}</p>
              </CardContent>
            </Section>
          ) : campaigns.length === 0 ? (
            <Section flush>
              <CardContent className="p-12 text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium" data-testid="text-no-campaigns">No campaigns found</p>
              </CardContent>
            </Section>
          ) : (
            <div className="space-y-3" data-testid="list-campaigns">
              {campaigns.map(campaign => (
                <Section flush key={campaign.id} testId={`card-campaign-${campaign.id}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium truncate" data-testid={`text-campaign-name-${campaign.id}`}>{campaign.name}</span>
                          {campaign.isLsa && <Badge className="bg-[#34A853]/10 text-[#34A853] border-[#34A853]/20 text-xs">LSA</Badge>}
                          <Badge className={campaign.status === "ENABLED" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs" : "bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs"} data-testid={`badge-campaign-status-${campaign.id}`}>
                            {campaign.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /><span data-testid={`text-campaign-budget-${campaign.id}`}>{campaign.dailyBudgetFormatted}/day</span></span>
                          <span className="text-xs">{campaign.channelType}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => { setRenameDialog({ campaign }); setNewName(campaign.name); }}
                          data-testid={`button-rename-campaign-${campaign.id}`}
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={() => { setBudgetDialog({ campaign }); setNewBudget(String(Number(campaign.dailyBudgetMicros) / 1_000_000)); }}
                          data-testid={`button-edit-budget-${campaign.id}`}
                        >
                          <DollarSign className="h-3 w-3 mr-1" /> Budget
                        </Button>
                        {campaign.status === "ENABLED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => setConfirmDialog({
                              title: "Pause Campaign",
                              description: `Pause "${campaign.name}"? This will stop it from serving ads immediately.`,
                              onConfirm: () => statusMutation.mutate({ campaign, newStatus: "PAUSED" }),
                            })}
                            data-testid={`button-pause-campaign-${campaign.id}`}
                          >
                            <Pause className="h-3 w-3 mr-1" /> Pause
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs text-emerald-600"
                            onClick={() => setConfirmDialog({
                              title: "Enable Campaign",
                              description: `Enable "${campaign.name}"? This will start serving ads.`,
                              onConfirm: () => statusMutation.mutate({ campaign, newStatus: "ENABLED" }),
                            })}
                            data-testid={`button-enable-campaign-${campaign.id}`}
                          >
                            <Play className="h-3 w-3 mr-1" /> Enable
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Section>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "leads" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground">Leads sync automatically every few minutes. Pull the latest now if needed.</p>
            <Button size="sm" variant="outline" onClick={() => syncLeadsMutation.mutate()} disabled={syncLeadsMutation.isPending} data-testid="button-sync-leads">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncLeadsMutation.isPending ? "animate-spin" : ""}`} />
              {syncLeadsMutation.isPending ? "Syncing..." : "Sync Leads"}
            </Button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
            </div>
          ) : leads.length === 0 ? (
            <Section flush>
              <CardContent className="p-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium" data-testid="text-no-leads">No leads yet</p>
                <p className="text-sm text-muted-foreground mt-1">Leads will appear here once synced from Google Ads.</p>
              </CardContent>
            </Section>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border" data-testid="table-leads">
              <table className={appTable.table}>
                <thead className={appTableCards.thead}>
                  <tr className={appTableCards.tr + " bg-muted/50 border-b border-border"}>
                    <th className="text-left p-3 font-medium">Customer</th>
                    <th className="text-left p-3 font-medium">Service</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Charged</th>
                    <th className="text-left p-3 font-medium">Disputed</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr key={lead.id} className={appTableCards.tr + " border-b border-border last:border-0"} data-testid={`row-lead-${lead.id}`}>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Customer: </span>{lead.customerName || "—"}</td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Service: </span>{lead.serviceRequested || "—"}</td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Status: </span><Badge>{lead.status}</Badge></td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Charged: </span>{lead.charged ? <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Charged {lead.chargeAmount || ""}</Badge> : <span className="text-muted-foreground">No</span>}</td>
                      <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Disputed: </span>{lead.disputed ? <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Disputed</Badge> : <span className="text-muted-foreground">No</span>}</td>
                      <td className={appTableCards.td + " min-w-0 break-words"}>
                        {lead.charged && !lead.disputed && (
                          <Button size="sm" variant="outline" className="text-xs" onClick={() => { setDisputeDialog({ lead }); setDisputeReason(""); }} data-testid={`button-dispute-lead-${lead.id}`}>
                            Dispute
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent data-testid="dialog-confirm-action">
          <DialogHeader>
            <DialogTitle>{confirmDialog?.title}</DialogTitle>
            <DialogDescription>{confirmDialog?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              onClick={() => { confirmDialog?.onConfirm(); }}
              disabled={statusMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-confirm-action"
            >
              {statusMutation.isPending ? "Updating..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!budgetDialog} onOpenChange={() => setBudgetDialog(null)}>
        <DialogContent data-testid="dialog-budget">
          <DialogHeader>
            <DialogTitle>Change daily budget</DialogTitle>
            <DialogDescription>Set how much this campaign may spend per day.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Campaign: <strong>{budgetDialog?.campaign.name}</strong></p>
            <div className="space-y-1">
              <Label htmlFor="newBudget">New daily budget (USD)</Label>
              <Input id="newBudget" type="number" min="1" step="0.01" value={newBudget} onChange={e => setNewBudget(e.target.value)} data-testid="input-new-budget" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetDialog(null)}>Cancel</Button>
            <Button
              onClick={() => budgetDialog && budgetMutation.mutate({ campaign: budgetDialog.campaign, budget: Number(newBudget) })}
              disabled={!newBudget || Number(newBudget) <= 0 || budgetMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-confirm-budget"
            >
              {budgetMutation.isPending ? "Updating..." : "Update Budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameDialog} onOpenChange={() => setRenameDialog(null)}>
        <DialogContent data-testid="dialog-rename">
          <DialogHeader>
            <DialogTitle>Rename campaign</DialogTitle>
            <DialogDescription>The new name shows in Google Ads and here.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="newName">New campaign name</Label>
              <Input id="newName" value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-new-name" placeholder="Campaign name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialog(null)}>Cancel</Button>
            <Button
              onClick={() => renameDialog && renameMutation.mutate({ campaign: renameDialog.campaign, name: newName })}
              disabled={!newName.trim() || newName === renameDialog?.campaign.name || renameMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-confirm-rename"
            >
              {renameMutation.isPending ? "Renaming..." : "Save Name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!disputeDialog} onOpenChange={() => setDisputeDialog(null)}>
        <DialogContent data-testid="dialog-dispute">
          <DialogHeader>
            <DialogTitle>Dispute lead</DialogTitle>
            <DialogDescription>Ask Google to credit a charged lead that wasn't a real job inquiry.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-300">
              Only charged leads can be disputed. Each lead can only be disputed once. Google does not like excessive disputes — use sparingly for genuine invalid leads.
            </div>
            <div className="space-y-1">
              <Label>Dispute reason</Label>
              <Select value={disputeReason} onValueChange={setDisputeReason}>
                <SelectTrigger data-testid="select-dispute-reason">
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spam_or_robot_call">Spam or robot call</SelectItem>
                  <SelectItem value="wrong_service">Wrong service type</SelectItem>
                  <SelectItem value="wrong_location">Wrong location / outside service area</SelectItem>
                  <SelectItem value="already_customer">Already a customer</SelectItem>
                  <SelectItem value="job_already_booked">Job already booked elsewhere</SelectItem>
                  <SelectItem value="solicitation">Solicitation / sales call</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisputeDialog(null)}>Cancel</Button>
            <Button
              onClick={() => disputeDialog && disputeMutation.mutate({ leadId: disputeDialog.lead.id, reason: disputeReason })}
              disabled={!disputeReason || disputeMutation.isPending}
              variant="destructive"
              data-testid="button-confirm-dispute"
            >
              {disputeMutation.isPending ? "Disputing..." : "Dispute Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AuditLogTab() {
  const { data: logs = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/admin/lsa/audit-log"],
  });

  const actionLabel = (action: string) => {
    const labels: Record<string, string> = {
      manager_connect: "Connected Manager",
      manager_disconnect: "Disconnected Manager",
      manager_invite: "Sent Manager Invite",
      sync_accounts: "Synced Child Accounts",
      sync_leads: "Synced Leads",
      budget_change: "Changed Budget",
      campaign_pause: "Paused Campaign",
      campaign_enable: "Enabled Campaign",
      campaign_settings_change: "Renamed Campaign",
      dispute_lead: "Disputed Lead",
      access_grant: "Granted Access",
      access_grant_revoke: "Revoked Access",
    };
    return labels[action] || action;
  };

  const actionColor = (action: string) => {
    if (action === "campaign_pause") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    if (action === "campaign_enable") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (action === "dispute_lead" || action === "access_grant_revoke") return "bg-red-500/10 text-red-500 border-red-500/20";
    if (action === "access_grant") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    return "bg-primary/10 text-muted-foreground border-[#4285F4]/20";
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-sm text-muted-foreground">All admin write actions are recorded here for accountability.</p>
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : logs.length === 0 ? (
        <Section flush>
          <CardContent className="p-12 text-center">
            <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium" data-testid="text-no-audit-logs">No audit entries yet</p>
          </CardContent>
        </Section>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" data-testid="table-audit-log">
          <table className={appTable.table}>
            <thead className={appTableCards.thead}>
              <tr className={appTableCards.tr + " bg-muted/50 border-b border-border"}>
                <th className="text-left p-3 font-medium">When</th>
                <th className="text-left p-3 font-medium">Admin</th>
                <th className="text-left p-3 font-medium">Action</th>
                <th className="text-left p-3 font-medium">Account</th>
                <th className="text-left p-3 font-medium">Result</th>
                <th className="text-left p-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className={appTableCards.tr + " border-b border-border last:border-0 hover:bg-muted/20"} data-testid={`row-audit-${log.id}`}>
                  <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">When: </span>{new Date(log.createdAt).toLocaleString()}</td>
                  <td className={appTableCards.td + " min-w-0 break-words"} data-testid={`text-audit-actor-${log.id}`}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Admin: </span>{log.actorEmail}</td>
                  <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Action: </span>
                    <Badge className={`text-xs ${actionColor(log.action)}`} data-testid={`badge-audit-action-${log.id}`}>
                      {actionLabel(log.action)}
                    </Badge>
                  </td>
                  <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Account: </span>{log.targetAccountName || log.targetCustomerId || "—"}</td>
                  <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Result: </span>
                    <Badge className={log.result === "success" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs" : "bg-red-500/10 text-red-500 border-red-500/20 text-xs"} data-testid={`badge-audit-result-${log.id}`}>
                      {log.result}
                    </Badge>
                  </td>
                  <td className={appTableCards.td + " min-w-0 break-words"}><span className="mr-2 text-xs font-medium text-muted-foreground sm:hidden">Details: </span>
                    {log.errorMessage || (log.parameters ? JSON.stringify(log.parameters) : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
