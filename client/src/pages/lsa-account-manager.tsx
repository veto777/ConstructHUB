import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Shield, Link2, Users, Settings2, RefreshCw, Plus, CheckCircle,
  AlertTriangle, Clock, X, ChevronRight, DollarSign, Pause, Play,
  FileText, Search, Eye, Wifi, WifiOff, Send, BarChart3, History, Pencil,
} from "lucide-react";
import { useLocation } from "wouter";

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

export default function LsaAccountManagerPage() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("manager");
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  if (!user) return null;

  const ADMIN_EMAILS = ["support@constructhub.us", "alpinesidingcompany@gmail.com"];
  const isAdmin = ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "");
  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-sm text-muted-foreground">This section is restricted to ConstructHUB administrators only.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedAccountId) {
    return <AccountDetailView accountId={selectedAccountId} onBack={() => setSelectedAccountId(null)} />;
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "manager", label: "Manager Connection", icon: Wifi },
    { id: "accounts", label: "All Accounts", icon: Users },
    { id: "invitations", label: "Invitations", icon: Send },
    { id: "audit", label: "Audit Log", icon: History },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-5 w-5 text-[#4285F4]" />
              <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-xs" data-testid="badge-admin-only">
                Admin Only
              </Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">LSA Account Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage all Google Ads / LSA client accounts from one place via the central MCC connection.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-6 bg-card border border-border rounded-lg p-1 w-fit">
          {tabs.map(tab => (
            <Button
              key={tab.id}
              size="sm"
              variant={activeTab === tab.id ? "default" : "ghost"}
              className={`text-sm ${activeTab === tab.id ? "bg-[#4285F4] text-white" : "text-muted-foreground"}`}
              onClick={() => setActiveTab(tab.id)}
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="h-3.5 w-3.5 mr-1.5" />
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === "manager" && <ManagerConnectionTab />}
        {activeTab === "accounts" && <AccountsTab onSelectAccount={setSelectedAccountId} />}
        {activeTab === "invitations" && <InvitationsTab />}
        {activeTab === "audit" && <AuditLogTab />}
      </div>
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
      toast({ title: "Manager account connected" });
      setShowConnect(false);
      setManagerId(""); setRefreshToken(""); setDeveloperToken("");
    },
    onError: (e: any) => toast({ title: "Connection failed", description: e.message, variant: "destructive" }),
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
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Card data-testid="card-manager-status">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="h-4 w-4 text-[#4285F4]" />
            Central MCC Manager Connection
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
                  {status.hasDeveloperToken ? "Dev Token ✓" : "No Dev Token"}
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
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-accounts">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing..." : "Sync Child Accounts"}
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
              <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                <div>
                  <p className="font-medium text-amber-600 dark:text-amber-400" data-testid="text-manager-not-connected">Not Connected</p>
                  <p className="text-sm text-muted-foreground">No central Google Ads Manager (MCC) account is connected.</p>
                </div>
              </div>
              <Button onClick={() => setShowConnect(true)} className="bg-[#4285F4] text-white" data-testid="button-connect-manager">
                <Link2 className="h-4 w-4 mr-2" /> Connect Manager Account
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">External Prerequisites</CardTitle>
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
      </Card>

      <Dialog open={showConnect} onOpenChange={setShowConnect}>
        <DialogContent data-testid="dialog-connect-manager">
          <DialogHeader>
            <DialogTitle>Connect Central Manager Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="managerId">Manager Customer ID</Label>
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
              <Label htmlFor="refreshToken">Refresh Token</Label>
              <Input
                id="refreshToken"
                type="password"
                placeholder="OAuth2 refresh token (from manager account OAuth flow)"
                value={refreshToken}
                onChange={e => setRefreshToken(e.target.value)}
                data-testid="input-refresh-token"
              />
              <p className="text-xs text-muted-foreground">Obtained via OAuth with access_type=offline + prompt=consent.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="developerToken">Developer Token <span className="text-muted-foreground">(optional)</span></Label>
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConnect(false)}>Cancel</Button>
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={!managerId || !refreshToken || connectMutation.isPending}
              className="bg-[#4285F4] text-white"
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

  const { data: accountsData, isLoading } = useQuery<{ accounts: LsaAccount[]; total: number; limit: number; offset: number }>({
    queryKey: ["/api/admin/lsa/accounts", page],
    queryFn: () => fetch(`/api/admin/lsa/accounts?limit=${pageSize}&offset=${page * pageSize}`).then(r => r.json()),
  });

  const accounts = accountsData?.accounts || [];
  const totalAccounts = accountsData?.total || 0;
  const totalPages = Math.ceil(totalAccounts / pageSize);

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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/lsa/accounts", page] });
      toast({ title: "Account added" });
      setShowAdd(false);
      setNewCustomerId(""); setNewAccountName("");
    },
    onError: (e: any) => toast({ title: "Failed to add account", description: e.message, variant: "destructive" }),
  });

  const filtered = accounts.filter(a =>
    !search || a.customerId.includes(search) || (a.accountName || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by customer ID or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-search-accounts"
          />
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="bg-[#4285F4] text-white" data-testid="button-add-account">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Account
        </Button>
      </div>

      {showAdd && (
        <Card data-testid="card-add-account">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Customer ID</Label>
                <Input placeholder="1234567890" value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)} data-testid="input-new-customer-id" />
              </div>
              <div className="space-y-1">
                <Label>Account Name (optional)</Label>
                <Input placeholder="Client name" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} data-testid="input-new-account-name" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => addAccountMutation.mutate()} disabled={!newCustomerId || addAccountMutation.isPending} className="bg-[#4285F4] text-white" data-testid="button-save-account">
                {addAccountMutation.isPending ? "Adding..." : "Add Account"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium" data-testid="text-no-accounts">No accounts yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add accounts manually or sync from the connected MCC.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="table-accounts">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left p-3 font-medium">Account</th>
                <th className="text-left p-3 font-medium">Customer ID</th>
                <th className="text-left p-3 font-medium">Owner</th>
                <th className="text-left p-3 font-medium">Link Type</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Leads</th>
                <th className="text-left p-3 font-medium">Charged</th>
                <th className="text-left p-3 font-medium">Disputed</th>
                <th className="text-left p-3 font-medium">Spend</th>
                <th className="text-left p-3 font-medium">LSA</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(account => (
                <tr key={account.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-account-${account.id}`}>
                  <td className="p-3 font-medium">{account.accountName || "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground" data-testid={`text-customer-id-${account.id}`}>{account.customerId}</td>
                  <td className="p-3 text-xs text-muted-foreground" data-testid={`text-owner-${account.id}`}>
                    {account.ownerEmail ? (
                      <span className="truncate max-w-[140px] block" title={account.ownerEmail}>{account.ownerEmail}</span>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="p-3">
                    <Badge className={
                      account.linkType === "central" ? "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20" :
                      account.linkType === "both" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                      "bg-muted text-muted-foreground"
                    }>
                      {account.linkType}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <Badge className={account.linkStatus === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"}>
                      {account.linkStatus}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground" data-testid={`text-lead-count-${account.id}`}>{account.leadCount}</td>
                  <td className="p-3">
                    {(account.chargedLeads ?? 0) > 0 ? (
                      <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-xs" data-testid={`text-charged-leads-${account.id}`}>{account.chargedLeads}</Badge>
                    ) : <span className="text-muted-foreground text-xs">0</span>}
                  </td>
                  <td className="p-3">
                    {(account.disputedLeads ?? 0) > 0 ? (
                      <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs" data-testid={`text-disputed-leads-${account.id}`}>{account.disputedLeads}</Badge>
                    ) : <span className="text-muted-foreground text-xs">0</span>}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground" data-testid={`text-total-spend-${account.id}`}>
                    {account.totalSpend ? account.totalSpend : <span className="opacity-40">—</span>}
                  </td>
                  <td className="p-3">
                    {account.isLsaEnrolled ? (
                      <Badge className="bg-[#34A853]/10 text-[#34A853] border-[#34A853]/20 text-xs">LSA ✓</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Button size="sm" variant="ghost" onClick={() => onSelectAccount(account.id)} data-testid={`button-view-account-${account.id}`}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

  const { data: invitations = [], isLoading } = useQuery<LsaInvitation[]>({
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Invite client Google Ads accounts to link under the central manager. Clients must accept the invitation in their own Google Ads account.
        </p>
        <Button size="sm" onClick={() => setShowForm(true)} className="bg-[#4285F4] text-white shrink-0" data-testid="button-new-invitation">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Invitation
        </Button>
      </div>

      {showForm && (
        <Card data-testid="card-invitation-form">
          <CardHeader>
            <CardTitle className="text-sm">Link a Client Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
              The client must log into their Google Ads account and <strong>accept the manager-link invitation</strong> before you can access their campaigns. Mark the invitation as "accepted" here once they confirm.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Client Customer ID</Label>
                <Input placeholder="1234567890 (digits only)" value={targetCustomerId} onChange={e => setTargetCustomerId(e.target.value)} data-testid="input-target-customer-id" />
              </div>
              <div className="space-y-1">
                <Label>Client Name (optional)</Label>
                <Input placeholder="ABC Roofing LLC" value={accountName} onChange={e => setAccountName(e.target.value)} data-testid="input-invitation-account-name" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Notes (optional)</Label>
                <Input placeholder="Internal notes about this account" value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-invitation-notes" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={!targetCustomerId || createMutation.isPending} className="bg-[#4285F4] text-white" data-testid="button-send-invitation">
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {createMutation.isPending ? "Sending..." : "Send Invitation"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : invitations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Send className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium" data-testid="text-no-invitations">No invitations yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {invitations.map(inv => (
            <Card key={inv.id} data-testid={`card-invitation-${inv.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
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
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white text-xs"
                        onClick={() => updateStatusMutation.mutate({ id: inv.id, status: "accepted" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid={`button-accept-invitation-${inv.id}`}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" /> Mark Accepted
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
            </Card>
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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back">
          <ChevronRight className="h-4 w-4 rotate-180 mr-1" /> Back
        </Button>
        {account && (
          <div className="flex items-center gap-2">
            <h2 className="font-semibold" data-testid="text-account-name">{account.accountName || "Unnamed Account"}</h2>
            <Badge className={account.linkType === "central" ? "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20" : "bg-muted text-muted-foreground"}>
              {account.linkType}
            </Badge>
            <span className="text-sm text-muted-foreground font-mono">{account.customerId}</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        <Button size="sm" variant={activeTab === "campaigns" ? "default" : "ghost"} className={activeTab === "campaigns" ? "bg-[#4285F4] text-white" : "text-muted-foreground"} onClick={() => setActiveTab("campaigns")} data-testid="tab-campaigns">
          <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Campaigns
        </Button>
        <Button size="sm" variant={activeTab === "leads" ? "default" : "ghost"} className={activeTab === "leads" ? "bg-[#4285F4] text-white" : "text-muted-foreground"} onClick={() => setActiveTab("leads")} data-testid="tab-leads">
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
            <Card>
              <CardContent className="p-8 text-center">
                <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                <p className="font-medium" data-testid="text-campaigns-error">Failed to load campaigns</p>
                <p className="text-sm text-muted-foreground mt-1">{(campaignsError as any)?.message || "Google Ads API error. Ensure the manager connection is active and the developer token is configured."}</p>
              </CardContent>
            </Card>
          ) : campaigns.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium" data-testid="text-no-campaigns">No campaigns found</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="list-campaigns">
              {campaigns.map(campaign => (
                <Card key={campaign.id} data-testid={`card-campaign-${campaign.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
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
                      <div className="flex gap-2 shrink-0">
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
                </Card>
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
            <Card>
              <CardContent className="p-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium" data-testid="text-no-leads">No leads yet</p>
                <p className="text-sm text-muted-foreground mt-1">Leads will appear here once synced from Google Ads.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border" data-testid="table-leads">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
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
                    <tr key={lead.id} className="border-b border-border last:border-0" data-testid={`row-lead-${lead.id}`}>
                      <td className="p-3">{lead.customerName || "—"}</td>
                      <td className="p-3 text-muted-foreground">{lead.serviceRequested || "—"}</td>
                      <td className="p-3"><Badge>{lead.status}</Badge></td>
                      <td className="p-3">{lead.charged ? <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Charged {lead.chargeAmount || ""}</Badge> : <span className="text-muted-foreground">No</span>}</td>
                      <td className="p-3">{lead.disputed ? <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Disputed</Badge> : <span className="text-muted-foreground">No</span>}</td>
                      <td className="p-3">
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
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{confirmDialog?.description}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              onClick={() => { confirmDialog?.onConfirm(); }}
              disabled={statusMutation.isPending}
              className="bg-[#4285F4] text-white"
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
            <DialogTitle>Change Daily Budget</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Campaign: <strong>{budgetDialog?.campaign.name}</strong></p>
            <div className="space-y-1">
              <Label htmlFor="newBudget">New Daily Budget (USD)</Label>
              <Input id="newBudget" type="number" min="1" step="0.01" value={newBudget} onChange={e => setNewBudget(e.target.value)} data-testid="input-new-budget" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetDialog(null)}>Cancel</Button>
            <Button
              onClick={() => budgetDialog && budgetMutation.mutate({ campaign: budgetDialog.campaign, budget: Number(newBudget) })}
              disabled={!newBudget || Number(newBudget) <= 0 || budgetMutation.isPending}
              className="bg-[#4285F4] text-white"
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
            <DialogTitle>Rename Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="newName">New Campaign Name</Label>
              <Input id="newName" value={newName} onChange={e => setNewName(e.target.value)} data-testid="input-new-name" placeholder="Campaign name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialog(null)}>Cancel</Button>
            <Button
              onClick={() => renameDialog && renameMutation.mutate({ campaign: renameDialog.campaign, name: newName })}
              disabled={!newName.trim() || newName === renameDialog?.campaign.name || renameMutation.isPending}
              className="bg-[#4285F4] text-white"
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
            <DialogTitle>Dispute Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-700 dark:text-amber-300">
              Only charged leads can be disputed. Each lead can only be disputed once. Google does not like excessive disputes — use sparingly for genuine invalid leads.
            </div>
            <div className="space-y-1">
              <Label>Dispute Reason</Label>
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
      budget_change: "Changed Budget",
      campaign_pause: "Paused Campaign",
      campaign_enable: "Enabled Campaign",
      campaign_settings_change: "Renamed Campaign",
      dispute_lead: "Disputed Lead",
    };
    return labels[action] || action;
  };

  const actionColor = (action: string) => {
    if (action === "campaign_pause") return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    if (action === "campaign_enable") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
    if (action === "dispute_lead") return "bg-red-500/10 text-red-500 border-red-500/20";
    return "bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20";
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-sm text-muted-foreground">All admin write actions are recorded here for accountability.</p>
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-6 w-6 border-2 border-[#4285F4] border-t-transparent rounded-full" />
        </div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <History className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium" data-testid="text-no-audit-logs">No audit entries yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" data-testid="table-audit-log">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
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
                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-muted/20" data-testid={`row-audit-${log.id}`}>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-xs" data-testid={`text-audit-actor-${log.id}`}>{log.actorEmail}</td>
                  <td className="p-3">
                    <Badge className={`text-xs ${actionColor(log.action)}`} data-testid={`badge-audit-action-${log.id}`}>
                      {actionLabel(log.action)}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{log.targetAccountName || log.targetCustomerId || "—"}</td>
                  <td className="p-3">
                    <Badge className={log.result === "success" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs" : "bg-red-500/10 text-red-500 border-red-500/20 text-xs"} data-testid={`badge-audit-result-${log.id}`}>
                      {log.result}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
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
