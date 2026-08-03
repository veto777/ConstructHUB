import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Users, Building2, UserCircle, ShieldCheck, Mail, Loader2, Trash2,
  Copy, AlertTriangle, Plus, Check, ArrowRight, RefreshCw, KeyRound, History,
  CalendarDays, Unplug,
} from "lucide-react";
import {
  CrmPage, CrmPageHeader, StatusPill, EmptyState, ErrorCard, InitialAvatar, SectionTitle, roleTone,
} from "@/components/crm-ui";
import { InfoTip } from "@/components/info-tip";

// ── Types ────────────────────────────────────────────────────────────────────
type PermissionMap = Record<string, boolean>;

interface Member {
  id: string;
  userId: number | null;
  email: string;
  role: string;
  status: string;
  displayName: string | null;
  title: string | null;
  phone: string | null;
  calendarColor: string | null;
  divisionId: string | null;
  hourlyCostCents?: number | null;
  permissions: PermissionMap | null;
  effectivePermissions: PermissionMap;
  lastActiveAt: string | null;
}

interface Division {
  id: string;
  name: string;
  code: string;
  isHeadquarters: boolean;
}

interface Seats {
  plan: string;
  planName: string;
  limit: number;
  used: number;
  remaining: number;
  canAddSeat: boolean;
}

interface Org {
  id: string;
  name: string;
  legalEntityName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  industry: string | null;
  description: string | null;
  termsAndConditions: string | null;
  warrantyText: string | null;
  invoiceFooter: string | null;
  estimateFooter: string | null;
}

interface MeResponse {
  user: { id: number; email?: string; displayName?: string | null };
  org: Org;
  member: Member;
  permissions: PermissionMap;
  orgs: { id: string; name: string; role: string }[];
  seats: Seats;
  roles: string[];
  permissionKeys: string[];
  roleDefaults: Record<string, PermissionMap>;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  divisionId: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

const ROLE_BLURB: Record<string, string> = {
  owner: "Full control, holds the subscription. Cannot be removed or demoted.",
  admin: "Everything except integrations. For a co-owner or general manager.",
  pm: "Runs jobs, estimates and clients across the whole book. Sees prices, never costs.",
  office: "Scheduling, clients, estimates, invoices and payments. No costs or margins.",
  field: "Sees only their own assigned jobs. Price-blind by default.",
  subcontractor: "Outside crew. Sees only assigned work — never clients or pricing.",
};

const PERM_LABEL: Record<string, string> = {
  viewAllJobs: "See all jobs (not just their own)",
  manageJobs: "Create and edit jobs",
  manageCustomers: "Manage clients",
  manageEstimates: "Create and send estimates",
  manageInvoices: "Create and send invoices",
  takePayment: "Take payments",
  seePrices: "See prices",
  seeCosts: "See costs and margins",
  approveChangeOrders: "Approve change orders",
  managePriceBook: "Manage the price book",
  manageTeam: "Manage team and invitations",
  manageSettings: "Manage company settings",
  seeReporting: "See reporting",
  manageIntegrations: "Manage integrations",
  exportData: "Export client data (CSV)",
};

/** Owner-only expandable audit feed for one member — everything they did, newest first. */
function MemberActivity({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const { data: rows, isLoading } = useQuery<any[]>({
    queryKey: [`/api/crm/members/${memberId}/activity`],
    enabled: open,
  });
  return (
    <div>
      <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground"
        onClick={() => setOpen((o) => !o)}
        data-testid={`button-activity-${memberId}`}>
        <History className="h-4 w-4 mr-1.5" />
        {open ? "Hide activity" : "Activity"}
      </Button>
      {open && (
        <div className="mt-1 space-y-1.5">
          {isLoading ? (
            <p className="text-xs text-muted-foreground px-2 py-1">Loading…</p>
          ) : !rows?.length ? (
            <p className="text-xs text-muted-foreground px-2 py-1" data-testid="text-activity-empty">
              No activity recorded yet.
            </p>
          ) : (
            rows.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5"
                data-testid={`row-activity-${r.id}`}>
                <span className="text-sm truncate">{r.text}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function humanMoney(cents?: number | null) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Every member's own Google Calendar hookup — THEIR appointments in THEIR
 * Google account. Independent of the company-wide calendar the owner/admin
 * may (optionally) connect in Settings: if the company one exists it carries
 * everything; either way each member handles their own scheduling here.
 */
function MyGoogleCalendarCard() {
  const { toast } = useToast();
  const { data: status } = useQuery<any>({ queryKey: ["/api/crm/calendar/google/status"] });
  const mine = status?.myConnection ?? null;

  // The OAuth round-trip lands back on /crm/team?calendar=connected|error=….
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const cal = q.get("calendar");
    if (!cal) return;
    if (cal === "connected" || q.get("connected")) {
      toast({ title: "Google Calendar connected", description: "Your appointments will sync to your own calendar." });
    } else {
      toast({ title: "Google Calendar connection failed", description: q.get("error") ?? cal, variant: "destructive" });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("calendar");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/crm/calendar/google/connect?scope=me")).json(),
    onSuccess: (r: any) => { if (r.url) window.location.href = r.url; },
    onError: (e: any) => toast({ title: "Couldn't start Google connect", description: String(e.message ?? e), variant: "destructive" }),
  });
  const syncNow = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/sync?scope=me", {})).json(),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Calendar synced", description: `${r.upserted ?? 0} updated · ${r.deleted ?? 0} removed.` });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: String(e.message ?? e), variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/crm/calendar/google/disconnect?scope=me", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/calendar/google/status"] });
      toast({ title: "Google Calendar disconnected" });
    },
    onError: (e: any) => toast({ title: "Couldn't disconnect", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (status && !status.configured) return null; // server has no Google OAuth app set up

  return (
    <Card className="mt-4" data-testid="card-my-google-calendar">
      <CardHeader>
        <SectionTitle
          icon={CalendarDays}
          title="My Google Calendar"
          description="Your appointments, synced to your own Google account. The company calendar (if your admin connects one in Settings) is separate and carries everyone's."
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {mine ? (
          <>
            <div className="text-sm text-muted-foreground" data-testid="text-my-gcal-status">
              Connected{mine.connectedAt ? ` since ${new Date(mine.connectedAt).toLocaleDateString()}` : ""}
              {mine.lastSyncAt ? ` · last synced ${new Date(mine.lastSyncAt).toLocaleString()}` : " · not synced yet"}
            </div>
            {mine.lastSyncError && (
              <p className="text-sm text-destructive" data-testid="text-my-gcal-error">
                Last sync failed: {mine.lastSyncError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}
                data-testid="button-my-gcal-sync">
                {syncNow.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
                data-testid="button-my-gcal-disconnect">
                {disconnect.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5 mr-1.5" />}
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}
              data-testid="button-my-gcal-connect">
              {connect.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Connect my Google Calendar
            </Button>
            <span className="text-xs text-muted-foreground">
              Only appointments assigned to you are synced — into a dedicated calendar in your account.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CrmTeamPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Deep-link support: /crm/team?tab=company lands on the right tab, which is
  // what the onboarding checklist links to.
  const initialTab = (() => {
    if (typeof window === "undefined") return "profile";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "company" || t === "team" || t === "profile" ? t : "profile";
  })();
  const [tab, setTab] = useState(initialTab);

  // Switching tabs also rewrites ?tab= so the URL, the banner and a page
  // refresh can never disagree about which step you're on.
  const goToTab = (t: string) => {
    setTab(t);
    navigate(`/crm/team?tab=${t}`, { replace: true });
  };

  const { data: onboarding } = useQuery<any>({ queryKey: ["/api/crm/onboarding"] });
  const advance = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/onboarding"] });
    queryClient.refetchQueries({ queryKey: ["/api/crm/onboarding"] }).then(() => {
      const ob: any = queryClient.getQueryData(["/api/crm/onboarding"]);
      // Follow the server's opinion of what comes next; fall back to home so
      // the user is never stranded on a saved form.
      if (!ob || !ob.nextStep) {
        navigate("/"); // nothing left — back to the portal home
        return;
      }
      const nextTab = new URLSearchParams((ob.nextPath || "").split("?")[1] || "").get("tab");
      if (nextTab && nextTab !== tab) goToTab(nextTab);
      else if (!nextTab) navigate(ob.nextPath);
    });
  };

  const { data: me, isLoading, isError } = useQuery<MeResponse>({ queryKey: ["/api/crm/me"] });
  const { data: teamData } = useQuery<{ members: Member[]; seats: Seats }>({
    queryKey: ["/api/crm/members"],
  });
  const canManageTeam = me?.permissions?.manageTeam === true;
  const { data: invites } = useQuery<Invitation[]>({
    queryKey: ["/api/crm/invitations"],
    enabled: canManageTeam,
  });
  const { data: divisions } = useQuery<Division[]>({ queryKey: ["/api/crm/divisions"] });
  const divisionLabel = (id: string | null | undefined) =>
    id ? divisions?.find((d) => d.id === id)?.code ?? null : null;

  // ── Profile ────────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({ displayName: "", title: "", phone: "" });
  useEffect(() => {
    if (me?.member) {
      setProfile({
        displayName: me.member.displayName ?? "",
        title: me.member.title ?? "",
        phone: me.member.phone ?? "",
      });
    }
  }, [me?.member?.id]);

  const saveProfile = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/crm/profile", profile)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/members"] });
      toast({ title: "Profile saved" });
      advance();
    },
    onError: (e: any) => toast({ title: "Could not save profile", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Company ────────────────────────────────────────────────────────────────
  const [org, setOrg] = useState<Partial<Org>>({});
  useEffect(() => {
    if (me?.org) setOrg(me.org);
  }, [me?.org?.id]);

  const saveOrg = useMutation({
    mutationFn: async () => {
      const { id, ...rest } = org as Org;
      return (await apiRequest("PATCH", "/api/crm/org", rest)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/me"] });
      toast({ title: "Company profile saved" });
      advance();
    },
    onError: (e: any) => toast({ title: "Could not save company", description: String(e.message ?? e), variant: "destructive" }),
  });

  // ── Team ───────────────────────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("field");
  const [inviteDivision, setInviteDivision] = useState("all");
  const [lastLink, setLastLink] = useState<string | null>(null);
  // Optional: text the invite too (a field tech reads a text, not an inbox).
  const [invitePhone, setInvitePhone] = useState("");
  const { data: smsStatus } = useQuery<any>({ queryKey: ["/api/crm/sms/status"] });

  const invite = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/crm/invitations", {
        email: inviteEmail,
        role: inviteRole,
        divisionId: inviteDivision === "all" ? null : inviteDivision,
        phone: invitePhone.trim() || null,
        sms: Boolean(invitePhone.trim()),
      })).json(),
    onSuccess: (data: any) => {
      setInviteEmail("");
      setInvitePhone("");
      setLastLink(data.link ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/members"] });
      toast({
        title: data.emailed ? "Invitation sent" : "Invitation created",
        description: data.texted
          ? "Emailed and texted."
          : data.smsError
            ? `Emailed — text failed: ${data.smsError}`
            : data.emailed ? undefined : "Email delivery failed — copy the link below instead.",
      });
    },
    onError: (e: any) => toast({ title: "Could not invite", description: String(e.message ?? e), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/invitations/${id}`, undefined)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/members"] });
      toast({ title: "Invitation revoked" });
    },
    onError: (e: any) => toast({ title: "Could not revoke", description: String(e.message ?? e), variant: "destructive" }),
  });

  const resendInvite = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/crm/invitations/${id}/resend`, {})).json(),
    onSuccess: (data: any) => {
      // Delivery failed — surface the fresh link for manual copy, same as the
      // create flow does.
      if (!data.emailed) setLastLink(data.link ?? null);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/invitations"] });
      toast({
        title: "Invitation resent",
        description: data.emailed ? undefined : "Email delivery failed — copy the link below instead.",
      });
    },
    onError: (e: any) => toast({ title: "Could not resend", description: String(e.message ?? e), variant: "destructive" }),
  });

  const updateMember = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      (await apiRequest("PATCH", `/api/crm/members/${id}`, patch)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/members"] });
      toast({ title: "Team member updated" });
    },
    onError: (e: any) => toast({ title: "Could not update", description: String(e.message ?? e), variant: "destructive" }),
  });

  const sendPasswordReset = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("POST", `/api/crm/members/${id}/send-password-reset`, {})).json(),
    onSuccess: (data: any) => {
      if (data.emailed) {
        toast({ title: "Password reset email sent" });
      } else {
        toast({
          title: "Couldn't send the reset email",
          description: "Email delivery failed — ask them to use \"Forgot password\" on the sign-in page instead.",
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => toast({ title: "Could not send reset email", description: String(e.message ?? e), variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/crm/members/${id}`, undefined)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/members"] });
      // Removing an invited member also revokes their pending invitation.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/invitations"] });
      toast({ title: "Team member deactivated" });
    },
    onError: (e: any) => toast({ title: "Could not remove", description: String(e.message ?? e), variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16" data-testid="crm-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !me) {
    return (
      <ErrorCard
        title="Couldn't load your workspace"
        description="Check your connection and refresh the page."
      />
    );
  }

  const seats = teamData?.seats ?? me.seats;
  const members = teamData?.members ?? [];

  return (
    <CrmPage>
      <CrmPageHeader
        icon={Users}
        title="Team & Company"
        infoKey="team"
        subtitle="Your profile, your company details, and who can do what."
      />

      {onboarding?.nextStep && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3"
             data-testid="banner-next-step">
          <div className="text-sm">
            <span className="font-medium">Next: </span>
            {onboarding.steps?.find((x: any) => x.key === onboarding.nextStep)?.label}
            <span className="text-muted-foreground">
              {" — "}
              {onboarding.completedCount} of {onboarding.totalCount} set-up steps done
            </span>
          </div>
          {(() => {
            const p = (onboarding.nextPath as string) || "";
            const t = new URLSearchParams(p.split("?")[1] || "").get("tab");
            // Already looking at the step in question — a "Go" here would be a
            // button that does nothing, so say what to do instead.
            if (t && t === tab) {
              return (
                <span className="text-xs text-muted-foreground" data-testid="text-next-step-here">
                  Fill in the fields below and save.
                </span>
              );
            }
            return (
              <Button size="sm" variant="outline" data-testid="button-next-step"
                onClick={() => (t ? goToTab(t) : navigate(p))}>
                Go <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            );
          })()}
        </div>
      )}

      <Tabs value={tab} onValueChange={goToTab}>
        <TabsList>
          <TabsTrigger value="profile" data-testid="tab-profile">
            <UserCircle className="h-4 w-4 mr-2" /> My profile
          </TabsTrigger>
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="h-4 w-4 mr-2" /> Company
          </TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team">
            <ShieldCheck className="h-4 w-4 mr-2" /> Team
          </TabsTrigger>
        </TabsList>

        {/* ── My profile ─────────────────────────────────────────────────── */}
        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="My profile"
                description={`How you appear to your crew and on the schedule. Signed in as ${me.user.email}.`}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="p-name">Name</Label>
                  <Input id="p-name" data-testid="input-profile-name" value={profile.displayName}
                    onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="p-title">Title</Label>
                  <Input id="p-title" data-testid="input-profile-title" placeholder="Project Manager"
                    value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="p-phone">Mobile</Label>
                  <Input id="p-phone" data-testid="input-profile-phone" value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                </div>
                <div>
                  <Label>Role</Label>
                  <div className="mt-2">
                    <StatusPill tone={roleTone(me.member.role)} data-testid="badge-my-role">{me.member.role}</StatusPill>
                  </div>
                </div>
              </div>
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending} data-testid="button-save-profile">
                {saveProfile.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save profile
              </Button>
            </CardContent>
          </Card>

          <MyGoogleCalendarCard />
        </TabsContent>

        {/* ── Company ────────────────────────────────────────────────────── */}
        <TabsContent value="company" className="mt-4">
          <Card>
            <CardHeader>
              <SectionTitle
                title="Company profile"
                description="These details appear on your estimates, invoices and contracts."
              />
            </CardHeader>
            <CardContent className="space-y-4">
              {!me.permissions.manageSettings && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground rounded-lg border bg-muted/30 p-3">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  You can view these details but not change them.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="o-name">Business name</Label>
                  <Input id="o-name" data-testid="input-org-name" value={org.name ?? ""}
                    onChange={(e) => setOrg({ ...org, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-legal">Legal entity name</Label>
                  <Input id="o-legal" data-testid="input-org-legal" value={org.legalEntityName ?? ""}
                    onChange={(e) => setOrg({ ...org, legalEntityName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-license">License number</Label>
                  <Input id="o-license" data-testid="input-org-license" value={org.licenseNumber ?? ""}
                    onChange={(e) => setOrg({ ...org, licenseNumber: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-license-state">License state</Label>
                  <Input id="o-license-state" data-testid="input-org-license-state" placeholder="WA"
                    value={org.licenseState ?? ""}
                    onChange={(e) => setOrg({ ...org, licenseState: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-phone">Business phone</Label>
                  <Input id="o-phone" data-testid="input-org-phone" value={org.phone ?? ""}
                    onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-website">Website</Label>
                  <Input id="o-website" data-testid="input-org-website" value={org.website ?? ""}
                    onChange={(e) => setOrg({ ...org, website: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="o-addr">Address</Label>
                  <Input id="o-addr" data-testid="input-org-address" value={org.addressLine1 ?? ""}
                    onChange={(e) => setOrg({ ...org, addressLine1: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="o-city">City</Label>
                  <Input id="o-city" value={org.city ?? ""} onChange={(e) => setOrg({ ...org, city: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="o-state">State</Label>
                    <Input id="o-state" value={org.state ?? ""} onChange={(e) => setOrg({ ...org, state: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="o-zip">ZIP</Label>
                    <Input id="o-zip" value={org.postalCode ?? ""} onChange={(e) => setOrg({ ...org, postalCode: e.target.value })} />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <Label htmlFor="o-terms">Terms and conditions</Label>
                <Textarea id="o-terms" data-testid="input-org-terms" rows={6} value={org.termsAndConditions ?? ""}
                  onChange={(e) => setOrg({ ...org, termsAndConditions: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="o-warranty">Warranty statement</Label>
                <Textarea id="o-warranty" data-testid="input-org-warranty" rows={3} value={org.warrantyText ?? ""}
                  onChange={(e) => setOrg({ ...org, warrantyText: e.target.value })} />
              </div>

              <Button onClick={() => saveOrg.mutate()} disabled={saveOrg.isPending || !me.permissions.manageSettings}
                data-testid="button-save-org">
                {saveOrg.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save company profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Team ───────────────────────────────────────────────────────── */}
        <TabsContent value="team" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-5 flex flex-wrap items-center justify-between gap-3">
              <SectionTitle
                title="Seats"
                description={`Your ${seats.planName} plan includes ${
                  seats.limit < 0 ? "unlimited seats" : `${seats.limit} seat${seats.limit === 1 ? "" : "s"}`
                }. Deactivated members don't use a seat.`}
              />
              <StatusPill tone={seats.canAddSeat ? "success" : "danger"} data-testid="badge-seats">
                {seats.used} of {seats.limit < 0 ? "unlimited" : seats.limit} used
              </StatusPill>
            </CardContent>
          </Card>

          {canManageTeam && (
            <Card>
              <CardHeader>
                <SectionTitle
                  infoKey="team-invite"
                  title="Invite someone"
                  description="They'll get an email with a link that expires in 14 days — add a mobile to text it too."
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input placeholder="name@company.com" value={inviteEmail} type="email"
                    data-testid="input-invite-email"
                    onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
                  {smsStatus?.configured && (
                    <Input placeholder="mobile (optional) — also text it" value={invitePhone} type="tel"
                      data-testid="input-invite-phone"
                      onChange={(e) => setInvitePhone(e.target.value)} className="sm:w-56" />
                  )}
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="sm:w-48" data-testid="select-invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {me.roles.filter((r) => r !== "owner" || me.member.role === "owner").map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {divisions && divisions.length > 0 && (
                    <Select value={inviteDivision} onValueChange={setInviteDivision}>
                      <SelectTrigger className="sm:w-48" data-testid="select-invite-division">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All divisions</SelectItem>
                        {divisions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button onClick={() => invite.mutate()}
                    disabled={!inviteEmail || invite.isPending || !seats.canAddSeat}
                    data-testid="button-send-invite">
                    {invite.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                    Invite
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{ROLE_BLURB[inviteRole]}</p>
                {!seats.canAddSeat && (
                  <p className="text-sm text-destructive" data-testid="text-seat-limit">
                    You've used every seat on the {seats.planName} plan. Upgrade to add more.
                  </p>
                )}
                {lastLink && (
                  <div className="flex items-center gap-2 text-sm border rounded-md p-2">
                    <code className="flex-1 truncate text-xs">{lastLink}</code>
                    <Button size="sm" variant="outline" data-testid="button-copy-link"
                      onClick={() => { navigator.clipboard?.writeText(lastLink); toast({ title: "Link copied" }); }}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {canManageTeam && invites && invites.length > 0 && (
            <Card>
              <CardHeader><SectionTitle title="Pending invitations" /></CardHeader>
              <CardContent className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-lg border px-4 py-3"
                    data-testid={`invite-${inv.id}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate text-sm">{inv.email}</span>
                      <StatusPill tone={roleTone(inv.role)}>{inv.role}</StatusPill>
                      {divisionLabel(inv.divisionId) && (
                        <StatusPill tone="neutral">{divisionLabel(inv.divisionId)}</StatusPill>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" title="Resend invitation"
                        onClick={() => resendInvite.mutate(inv.id)} disabled={resendInvite.isPending}
                        data-testid={`button-resend-invite-${inv.id}`}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Revoke invitation"
                        onClick={() => revoke.mutate(inv.id)}
                        data-testid={`button-revoke-${inv.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <SectionTitle
                infoKey="team-members"
                title="Team members"
                description="Roles set the defaults. Toggle any individual permission to override them for one person."
              />
            </CardHeader>
            <CardContent className="space-y-3">
              {members.map((m) => {
                const isOwner = m.role === "owner";
                return (
                  <div key={m.id} className="rounded-lg border p-4 space-y-3" data-testid={`member-${m.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <InitialAvatar name={m.displayName || m.email} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.displayName || m.email}</div>
                          <div className="text-sm text-muted-foreground truncate">{m.email}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        {m.status !== "active" && <StatusPill tone="neutral">{m.status}</StatusPill>}
                        {canManageTeam && !isOwner ? (
                          <Select value={m.role}
                            onValueChange={(role) => updateMember.mutate({ id: m.id, patch: { role } })}>
                            {/* Full-width rows on a phone; fixed inline widths at sm+. */}
                            <SelectTrigger className="w-full sm:w-40" data-testid={`select-role-${m.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {me.roles.filter((r) => r !== "owner" || me.member.role === "owner").map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <StatusPill tone={roleTone(m.role)}>{m.role}</StatusPill>
                        )}
                        <InfoTip k={`role-${m.role}`} />
                        {divisions && divisions.length > 0 && (
                          canManageTeam && !isOwner ? (
                            <Select value={m.divisionId ?? "all"}
                              onValueChange={(v) => updateMember.mutate({ id: m.id, patch: { divisionId: v === "all" ? null : v } })}>
                              <SelectTrigger className="w-full sm:w-44" data-testid={`select-division-${m.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All divisions</SelectItem>
                                {divisions.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            divisionLabel(m.divisionId) && <StatusPill tone="neutral">{divisionLabel(m.divisionId)}</StatusPill>
                          )
                        )}
                        {canManageTeam && !isOwner && (
                          <>
                            <Button size="sm" variant="ghost" title="Send password reset email"
                              onClick={() => sendPasswordReset.mutate(m.id)} disabled={sendPasswordReset.isPending}
                              data-testid={`button-reset-password-${m.id}`}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost"
                              title={m.status === "invited" ? "Revoke invite and remove" : "Remove from team"}
                              onClick={() => removeMember.mutate(m.id)}
                              data-testid={`button-remove-${m.id}`}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {me.permissions.seeCosts && canManageTeam && !isOwner && (
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground w-28">Cost rate / hr</Label>
                        <Input className="w-32 h-8" defaultValue={humanMoney(m.hourlyCostCents)} placeholder="0.00"
                          data-testid={`input-cost-${m.id}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const cents = v === "" ? null : Math.round(Number(v) * 100);
                            if (cents !== null && !Number.isFinite(cents)) return;
                            updateMember.mutate({ id: m.id, patch: { hourlyCostCents: cents } });
                          }} />
                      </div>
                    )}

                    {canManageTeam && !isOwner && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {me.permissionKeys.map((p) => (
                          <label key={p} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">{PERM_LABEL[p] ?? p}</span>
                            <Switch checked={m.effectivePermissions[p] === true}
                              data-testid={`switch-${p}-${m.id}`}
                              onCheckedChange={(checked) =>
                                updateMember.mutate({
                                  id: m.id,
                                  patch: { permissions: { ...(m.permissions ?? {}), [p]: checked } },
                                })
                              } />
                          </label>
                        ))}
                      </div>
                    )}

                    {isOwner && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Check className="h-3 w-3" /> The owner has every permission and can't be changed here.
                      </p>
                    )}

                    {/* The audit feed is owner-eyes-only (server enforces the
                        same gate — the dropdown is just the UI for it). */}
                    {me.member.role === "owner" && <MemberActivity memberId={m.id} />}
                  </div>
                );
              })}
              {members.length === 0 && (
                <EmptyState compact icon={Users} title="No team members yet" description="Invite your crew above — they'll get an email with a link." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </CrmPage>
  );
}
