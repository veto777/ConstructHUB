import { NotificationPreferences, SecurityActivity } from "@/components/account-security";
import { ReviewReferralSettings } from "@/components/review-referral-settings";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useUrlParam } from "@/hooks/use-url-param";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import {
  User, Bell, Shield, CreditCard, Mail, Lock, Eye, EyeOff,
  Settings, ChevronRight, Camera, Save, LogOut, Trash2, Building2,
  Globe, BarChart3, AlertTriangle, CheckCircle, Monitor,
  Smartphone, FileText, Megaphone, ShieldCheck, Activity,
  Gift, Copy, Clock, Sparkles, Plus, X, Pencil, Link, Info, Minus, Loader2,
} from "lucide-react";
import { useLocation } from "wouter";
import { VerificationCancelled } from "@/components/recent-auth";
import { TalkToSalesButton } from "@/components/talk-to-sales";
import {
  ADDONS, AGENCY_SELF_SERVE_MAX_LOCATIONS, PLANS, PLAN_KEYS, TRIAL_DAYS,
  type AddonKey, type BillingInterval,
} from "@shared/plans";
import {
  AGENCY_INCLUDED_LOCATIONS, PAYMENT_PROBLEM_STATUSES, addonPriceCents, addonsForPlan, agencyQuote, describeSubscription,
  formatUsd, intervalSuffix, intervalWord, normalizeLocations, planPriceCents, type SubscriptionInfo,
} from "@/lib/pricing-display";

type SettingsTab = "profile" | "account" | "notifications" | "security" | "billing";

// Same host rule as the server's googleReviewLink (and google-reviews.tsx): google.<tld>
// but not the bare homepage, g.page, goo.gl or share.google. The server has the final say.
const GOOGLE_REVIEW_LINK_HINT = "Paste your Google review link (https://g.page/r/... or a Google Maps link).";
function looksLikeGoogleReviewLink(input: string): boolean {
  let v = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  const google = /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host);
  if (google) return !(u.pathname === "/" && !u.search);
  return /^(?:[a-z0-9-]+\.)*(?:goo\.gl|g\.page|share\.google)$/.test(host);
}
const SETTINGS_TABS: SettingsTab[] = ["profile", "account", "notifications", "security", "billing"];

/**
 * Close (X) should go back only when the previous history entry is part of
 * the app. A document opened straight at /settings (typed URL, a link from
 * another site, an email) has no in-app entry behind it — go home instead.
 */
function previousEntryIsInApp(): boolean {
  if (window.history.length <= 1) return false;
  const entry = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  // Reached through in-app navigation: the document was loaded elsewhere.
  if (entry && new URL(entry.name).pathname !== window.location.pathname) return true;
  try {
    return !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

export default function SettingsPage() {
  const [, navigate] = useLocation();
  // The open tab lives in ?tab= so a reload or shared link reopens it.
  const [tabParam, setTabParam] = useUrlParam("tab");
  const activeTab: SettingsTab = SETTINGS_TABS.includes(tabParam as SettingsTab) ? tabParam as SettingsTab : "profile";
  const setActiveTab = (tab: SettingsTab) => setTabParam(tab === "profile" ? null : tab);

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "account", label: "Account", icon: Settings },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security & activity", icon: Shield },
    { id: "billing", label: "Billing & Plans", icon: CreditCard },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your profile, account, notifications, security and billing.</p>
          </div>
          <button
            onClick={() => {
              if (previousEntryIsInApp()) {
                window.history.back();
              } else {
                navigate("/");
              }
            }}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            aria-label="Close settings"
            data-testid="button-close-settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-full md:w-56 shrink-0">
            <nav className="space-y-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`button-settings-tab-${tab.id}`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex-1 min-w-0">
            {activeTab === "profile" && <ProfileSection user={user} />}
            {activeTab === "account" && <AccountSection user={user} />}
            {activeTab === "notifications" && <NotificationPreferences />}
            {activeTab === "security" && <SecuritySection user={user} />}
            {activeTab === "billing" && <BillingSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

// Clipboard writes can be refused (no permission, insecure context, some
// browsers); report the outcome instead of assuming the copy worked.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ProfileSection({ user }: { user: any }) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [email] = useState(user?.email || "");
  const [companyName, setCompanyName] = useState(user?.companyName || "");
  const [companyLogoUrl, setCompanyLogoUrl] = useState(user?.companyLogoUrl || "");
  const nameMissing = !displayName.trim();

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      // This form has no review-link field, so googleProfileUrl is never sent: a saved
      // legacy (non-Google) value must not block an unrelated name or logo change.
      const res = await apiRequest("PATCH", "/api/auth/profile", {
        displayName: displayName.trim(),
        companyName,
        companyLogoUrl,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const [logoUploading, setLogoUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const MAX = 256;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const scale = MAX / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > 400_000 && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      setAvatarUploading(true);
      try {
        const res = await apiRequest("POST", "/api/upload/logo", { imageData: dataUrl, type: "avatar" });
        const data = await res.json();
        await apiRequest("PATCH", "/api/auth/profile", { avatarUrl: data.url });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        toast({ title: "Profile photo updated" });
      } catch (err) {
        toast({ title: "Failed to upload photo", description: apiErrorMessage(err), variant: "destructive" });
      } finally {
        setAvatarUploading(false);
      }
    };
    img.src = URL.createObjectURL(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const maxSize = 256;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      let quality = 0.85;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > 400_000 && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      setLogoUploading(true);
      try {
        const res = await apiRequest("POST", "/api/upload/logo", { imageData: dataUrl, type: "company-logo" });
        const data = await res.json();
        setCompanyLogoUrl(data.url);
        toast({ title: "Logo uploaded" });
      } catch (err) {
        // The profile accepts an inline image, so the logo is still kept — but
        // only once the form is saved.
        setCompanyLogoUrl(dataUrl);
        toast({ title: "Logo not uploaded to storage", description: `${apiErrorMessage(err).replace(/\.?\s*$/, ".")} The image is kept in this form; click Save Changes to store it with your profile.`, variant: "destructive" });
      } finally {
        setLogoUploading(false);
      }
    };
    img.src = URL.createObjectURL(file);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-profile">
        <CardHeader>
          <CardTitle className="text-lg">Profile Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-20 w-20 rounded-full object-cover border-2 border-border"
                  referrerPolicy="no-referrer"
                  data-testid="img-avatar"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center border-2 border-border" data-testid="img-avatar-placeholder">
                  <span className="text-2xl font-bold text-primary">
                    {(user?.displayName || user?.email)?.[0]?.toUpperCase() || "?"}
                  </span>
                </div>
              )}
              <label htmlFor="avatarUpload" className="cursor-pointer">
                <div
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                  data-testid="button-change-avatar"
                >
                  {avatarUploading ? (
                    <div className="h-3.5 w-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                </div>
              </label>
              <input
                id="avatarUpload"
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
                data-testid="input-avatar-upload"
              />
            </div>
            <div>
              <p className="font-medium" data-testid="text-profile-name">{user?.displayName || "No name set"}</p>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{user?.email}</p>
              {user?.emailVerified && (
                <Badge variant="outline" className="mt-1 text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950">
                  <CheckCircle className="h-3 w-3" /> Verified
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                required
                aria-invalid={nameMissing}
                aria-describedby={nameMissing ? "displayName-hint" : undefined}
                data-testid="input-display-name"
              />
              {nameMissing && (
                <p id="displayName-hint" className="text-xs text-destructive" data-testid="text-display-name-required">
                  Enter a display name to save your profile.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={email}
                disabled
                className="opacity-60"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName"><Building2 className="h-3.5 w-3.5 inline mr-1" />Company Name</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Your contracting business"
                data-testid="input-company-name"
              />
              <p className="text-xs text-muted-foreground">Used in review request emails sent to your clients</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label><Camera className="h-3.5 w-3.5 inline mr-1" />Company Logo</Label>
              <div className="flex items-center gap-4">
                {companyLogoUrl ? (
                  <div className="relative">
                    <img
                      src={companyLogoUrl}
                      alt="Company logo"
                      className="h-16 w-16 rounded-lg object-contain border border-border bg-white dark:bg-gray-900 p-1"
                      data-testid="img-company-logo"
                    />
                    <button
                      onClick={() => setCompanyLogoUrl("")}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs"
                      data-testid="button-remove-logo"
                    >
                      x
                    </button>
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center" data-testid="logo-placeholder">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <label htmlFor="logoUpload" className="cursor-pointer">
                    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors">
                      <Camera className="h-4 w-4" />
                      {companyLogoUrl ? "Change Logo" : "Upload Logo"}
                    </div>
                  </label>
                  <input
                    id="logoUpload"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    data-testid="input-logo-upload"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Any size image accepted. Auto-resized for emails.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => updateProfileMutation.mutate()}
              disabled={updateProfileMutation.isPending || nameMissing}
              data-testid="button-save-profile"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ReviewReferralSettings />
      <GmbProfilesSection />
    </div>
  );
}

function GmbProfilesSection() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [name, setName] = useState("");
  const [googleProfileUrl, setGoogleProfileUrl] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/review-templates"],
  });
  const urlChanged = !editingTemplate || googleProfileUrl.trim() !== String(editingTemplate.googleProfileUrl ?? "").trim();
  const urlInvalid = urlChanged && googleProfileUrl.trim() !== "" && !looksLikeGoogleReviewLink(googleProfileUrl);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/review-templates", {
        name,
        googleProfileUrl,
        projectDescription,
        isDefault: templates.length === 0,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "GMB profile added" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/review-templates/${editingTemplate.id}`, {
        name,
        // Only a changed link is re-checked, so an older saved link doesn't block a rename.
        ...(urlChanged ? { googleProfileUrl } : {}),
        projectDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "GMB profile updated" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/review-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "GMB profile removed" });
      setDeleting(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/review-templates/${id}`, { isDefault: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "Default profile updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to set default", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  function closeDialog() {
    setShowDialog(false);
    setEditingTemplate(null);
    setName("");
    setGoogleProfileUrl("");
    setProjectDescription("");
  }

  function openEdit(t: any) {
    setEditingTemplate(t);
    setName(t.name);
    setGoogleProfileUrl(t.googleProfileUrl);
    setProjectDescription(t.projectDescription || "");
    setShowDialog(true);
  }

  return (
    <Card data-testid="card-gmb-profiles">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg">Google Business Profiles</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Manage your GMB locations for review requests</p>
        </div>
        <Button size="sm" onClick={() => setShowDialog(true)} data-testid="button-add-gmb-profile">
          <Plus className="h-4 w-4 mr-1" /> Add Profile
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : templates.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed rounded-lg" data-testid="empty-gmb-profiles">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No GMB profiles added yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add your Google Business Profile so clients can leave reviews</p>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                data-testid={`gmb-profile-${t.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate" data-testid={`text-gmb-name-${t.id}`}>{t.name}</p>
                      {t.isDefault && (
                        <Badge variant="outline" className="text-[10px] shrink-0">Default</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                      <Link className="h-3 w-3 shrink-0" />
                      <span className="truncate">{t.googleProfileUrl}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {!t.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setDefaultMutation.mutate(t.id)}
                      data-testid={`button-set-default-${t.id}`}
                    >
                      Set Default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(t)}
                    aria-label={`Edit ${t.name}`}
                    data-testid={`button-edit-gmb-${t.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(t)}
                    aria-label={`Remove ${t.name}`}
                    data-testid={`button-delete-gmb-${t.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !deleteMutation.isPending) setDeleting(null); }}>
        <AlertDialogContent data-testid="dialog-confirm-delete-gmb">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You won't be able to choose it for new review requests. Requests you already sent keep their own review link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending} data-testid="button-cancel-delete-gmb">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={e => { e.preventDefault(); if (deleting) deleteMutation.mutate(deleting.id); }}
              data-testid="button-confirm-delete-gmb"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove profile"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showDialog} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="overlay-gmb-dialog">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit GMB Profile" : "Add GMB Profile"}</DialogTitle>
            <DialogDescription>
              Review request emails show the company logo from your profile above.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="gmb-name">Profile / Location Name</Label>
              <Input
                id="gmb-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Premier Roofing - Denver"
                data-testid="input-gmb-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gmb-url">Google Review Link</Label>
              <Input
                id="gmb-url"
                value={googleProfileUrl}
                onChange={e => setGoogleProfileUrl(e.target.value)}
                placeholder="https://g.page/r/... or any Google Maps URL"
                aria-invalid={urlInvalid}
                aria-describedby={urlInvalid ? "gmb-url-error" : undefined}
                data-testid="input-gmb-url"
              />
              {urlInvalid && (
                <p id="gmb-url-error" className="text-xs text-destructive" data-testid="text-gmb-url-error">
                  {GOOGLE_REVIEW_LINK_HINT}
                </p>
              )}
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/50">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Paste any Google link: a review link (<span className="font-mono text-[10px] bg-blue-100 dark:bg-blue-900/50 px-1 rounded">https://g.page/r/xxxx/review</span>), a Google Maps URL, a <span className="font-mono text-[10px] bg-blue-100 dark:bg-blue-900/50 px-1 rounded">share.google</span> link, or a <span className="font-mono text-[10px] bg-blue-100 dark:bg-blue-900/50 px-1 rounded">maps.app.goo.gl</span> short link.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gmb-desc">Description (optional)</Label>
              <Textarea
                id="gmb-desc"
                value={projectDescription}
                onChange={e => setProjectDescription(e.target.value)}
                placeholder="Brief description of this location..."
                rows={2}
                data-testid="input-gmb-description"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-gmb">Cancel</Button>
            <Button
              onClick={() => editingTemplate ? updateMutation.mutate() : createMutation.mutate()}
              disabled={!name.trim() || !googleProfileUrl.trim() || urlInvalid || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-gmb"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingTemplate ? "Save Changes" : "Add Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AccountSection({ user }: { user: any }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // No self-serve deletion endpoint exists: the request goes to support, who
  // handle it under the privacy policy. The mail is prefilled so it names the
  // account unambiguously.
  const deletionMailto = `mailto:support@constructhub.us?subject=${encodeURIComponent("Account deletion request")}&body=${encodeURIComponent(
    `Please delete my ConstructHUB account and its data.\n\nAccount email: ${user?.email || ""}\nAccount ID: ${user?.accountId || ""}\n`,
  )}`;

  return (
    <div className="space-y-6">
      <Card data-testid="card-account">
        <CardHeader>
          <CardTitle className="text-lg">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Account ID</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your unique identifier</p>
            </div>
            <code className="text-xs bg-muted px-2.5 py-1 rounded font-mono" data-testid="text-account-id">
              {user?.accountId || "—"}
            </code>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Member Since</p>
              <p className="text-xs text-muted-foreground mt-0.5">When you joined ConstructHUB</p>
            </div>
            <span className="text-sm" data-testid="text-member-since">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Login Method</p>
              <p className="text-xs text-muted-foreground mt-0.5">How you sign in</p>
            </div>
            <Badge variant="outline" className="gap-1" data-testid="text-login-method">
              {user?.googleId ? (
                <>
                  <Globe className="h-3 w-3" /> Google
                </>
              ) : (
                <>
                  <Mail className="h-3 w-3" /> Email & Password
                </>
              )}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <BetaAccessSection user={user} />

      <Card className="border-destructive/20" data-testid="card-danger-zone">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete Account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ask our support team to permanently delete your account and its data.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} data-testid="button-delete-account">
              <Trash2 className="h-4 w-4 mr-2" /> Request deletion
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="dialog-request-deletion">
          <AlertDialogHeader>
            <AlertDialogTitle>Request account deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Account deletion is handled by our support team. Send the prefilled email from {user?.email ? <strong>{user.email}</strong> : "your account's email address"} so
              we can confirm the request comes from you. Nothing is deleted until support processes it; the{" "}
              <a href="/privacy" className="underline">privacy policy</a> explains what is removed and what must be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-request-deletion">Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <a href={deletionMailto} data-testid="link-request-deletion-email">Email support@constructhub.us</a>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BetaAccessSection({ user }: { user: any }) {
  const { toast } = useToast();
  const [betaCode, setBetaCode] = useState("");
  const [trialDays, setTrialDays] = useState(7);
  const [unlimited, setUnlimited] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  // /api/auth/me reports the server's own platform-admin check; the admin endpoints enforce it.
  const isAdmin = user?.isPlatformAdmin === true;

  const { data: betaStatus } = useQuery<{ active: boolean; expiresAt?: string; trialDays?: number }>({
    queryKey: ["/api/beta-codes/status"],
    enabled: !!user,
  });

  const { data: generatedCodes } = useQuery<any[]>({
    queryKey: ["/api/beta-codes"],
    enabled: isAdmin,
  });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/beta-codes/redeem", { code: betaCode.trim() });
      return res.json();
    },
    onSuccess: (data: any) => {
      setBetaCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/beta-codes/status"] });
      toast({ title: "Trial Activated!", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't activate code", description: apiErrorMessage(err, "Failed to redeem code"), variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/beta-codes/generate", {
        trialDays: unlimited ? 0 : trialDays,
        recipientEmail: recipientEmail.trim() || undefined,
        recipientName: recipientName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: async (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/beta-codes"] });
      const emailMsg = recipientEmail.trim() ? ` and emailed to ${recipientEmail}` : "";
      const copied = await copyToClipboard(data.code);
      toast(copied
        ? { title: "Trial Code Created & Copied!", description: `Code: ${data.code}${emailMsg}` }
        : { title: "Trial Code Created", description: `Code: ${data.code}${emailMsg}. It couldn't be copied automatically; select it in the list below to copy it.` });
      setRecipientEmail("");
      setRecipientName("");
      setShowCreateForm(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate code", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/beta-codes/revoke/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/beta-codes"] });
      toast({ title: "Trial revoked", description: "Access has been removed." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to revoke", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const copyCode = async (code: string) => {
    if (await copyToClipboard(code)) toast({ title: "Code copied to clipboard" });
    else toast({ title: "Couldn't copy the code", description: `Your browser blocked clipboard access. Select the code (${code}) and copy it manually.`, variant: "destructive" });
  };

  const getTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 365) return "Unlimited Access";
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h remaining`;
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m remaining`;
  };

  const getCodeStatus = (c: any) => {
    if (c.revoked) return "revoked";
    if (c.redeemedByUserId) return "redeemed";
    if (new Date(c.expiresAt) < new Date()) return "expired";
    return "available";
  };

  return (
    <>
      <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-teal-500/5" data-testid="card-beta-access">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Gift className="h-5 w-5 text-emerald-500" />
            Trial Access Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {betaStatus?.active ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20" data-testid="text-beta-active">
              <Sparkles className="h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Platinum Trial Active</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  {betaStatus.expiresAt ? getTimeRemaining(betaStatus.expiresAt) : "Active"}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Have a trial access code? Enter it below to unlock full Platinum access.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter code (e.g. TRIAL-A1B2C3D4)"
                  value={betaCode}
                  onChange={e => setBetaCode(e.target.value.toUpperCase())}
                  className="font-mono tracking-wider"
                  data-testid="input-beta-code"
                />
                <Button
                  onClick={() => redeemMutation.mutate()}
                  disabled={!betaCode.trim() || redeemMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                  data-testid="button-redeem-beta"
                >
                  {redeemMutation.isPending ? "Activating..." : "Activate"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5" data-testid="card-admin-beta">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-violet-500" />
                Admin: Trial Management
              </CardTitle>
              <Button
                size="sm"
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="bg-violet-600 hover:bg-violet-700 text-white"
                data-testid="button-toggle-create-trial"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Trial
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {showCreateForm && (
              <div className="p-4 rounded-lg border border-violet-500/20 bg-violet-500/5 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Trial Duration</Label>
                  <div className="flex items-center gap-3 mb-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={unlimited}
                        onChange={e => setUnlimited(e.target.checked)}
                        className="accent-violet-600 h-4 w-4"
                        data-testid="input-unlimited-toggle"
                      />
                      <span className="text-sm font-medium">Unlimited (∞)</span>
                    </label>
                  </div>
                  {!unlimited && (
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={14}
                        value={trialDays}
                        onChange={e => setTrialDays(parseInt(e.target.value))}
                        className="flex-1 accent-violet-600"
                        data-testid="input-trial-days-slider"
                      />
                      <span className="text-sm font-bold text-violet-600 dark:text-violet-400 w-16 text-right" data-testid="text-trial-days">{trialDays} day{trialDays > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Recipient Name (optional)</Label>
                    <Input
                      placeholder="John Smith"
                      value={recipientName}
                      onChange={e => setRecipientName(e.target.value)}
                      data-testid="input-recipient-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Recipient Email (optional)</Label>
                    <Input
                      type="email"
                      placeholder="john@example.com"
                      value={recipientEmail}
                      onChange={e => setRecipientEmail(e.target.value)}
                      data-testid="input-recipient-email"
                    />
                  </div>
                </div>
                {recipientEmail.trim() && (
                  <p className="text-xs text-violet-600 dark:text-violet-400 flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Trial code will be emailed automatically
                  </p>
                )}
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  data-testid="button-generate-trial"
                >
                  {generateMutation.isPending ? "Creating..." : `Create ${unlimited ? "Unlimited" : `${trialDays}-Day`} Trial${recipientEmail.trim() ? " & Send Email" : ""}`}
                </Button>
              </div>
            )}

            {generatedCodes && generatedCodes.length > 0 ? (
              <div className="space-y-2">
                {generatedCodes.map((c: any) => {
                  const status = getCodeStatus(c);
                  return (
                    <div
                      key={c.id}
                      className={`p-3 rounded-lg border bg-muted/30 ${status === "revoked" ? "opacity-50 border-red-500/20" : "border-border/50"}`}
                      data-testid={`row-beta-code-${c.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm font-semibold tracking-wider" data-testid={`text-beta-code-${c.id}`}>{c.code}</code>
                          <button type="button" onClick={() => copyCode(c.code)} aria-label={`Copy code ${c.code}`} className="text-muted-foreground hover:text-foreground" data-testid={`button-copy-code-${c.id}`}>
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <Badge variant="outline" className="text-xs">{c.trialDays === 0 ? "∞" : `${c.trialDays || 2}d`}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {status === "revoked" ? (
                            <Badge variant="outline" className="text-red-500 border-red-500/30" data-testid={`badge-status-${c.id}`}>Revoked</Badge>
                          ) : status === "redeemed" ? (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-500/30" data-testid={`badge-status-${c.id}`}>Active</Badge>
                          ) : status === "expired" ? (
                            <Badge variant="outline" className="text-red-500 border-red-500/30" data-testid={`badge-status-${c.id}`}>Expired</Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-500 border-amber-500/30" data-testid={`badge-status-${c.id}`}>Pending</Badge>
                          )}
                          {(status === "redeemed" || status === "available") && !c.revoked && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              onClick={() => revokeMutation.mutate(c.id)}
                              disabled={revokeMutation.isPending}
                              data-testid={`button-revoke-${c.id}`}
                            >
                              <X className="h-3 w-3 mr-1" />
                              Revoke
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {c.recipientEmail && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {c.recipientName ? `${c.recipientName} (${c.recipientEmail})` : c.recipientEmail}
                          </span>
                        )}
                        {c.redeemedByUser && (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle className="h-3 w-3" />
                            {c.redeemedByUser.displayName || c.redeemedByUser.email}
                            {c.redeemedByUser.companyName ? ` — ${c.redeemedByUser.companyName}` : ""}
                          </span>
                        )}
                        {status === "redeemed" && c.redeemedAt && (
                          <span>Activated {new Date(c.redeemedAt).toLocaleDateString()}</span>
                        )}
                        <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-codes">
                No trial codes yet. Click "New Trial" to create one.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function TwoFactorSection({ user }: { user: any }) {
  const { toast } = useToast();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/setup");
      return res.json();
    },
    onSuccess: (data: any) => {
      setSetupData({ secret: data.secret, qrCode: data.qrCode });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start 2FA setup", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", { code: verifyCode });
      return res.json();
    },
    onSuccess: (data: any) => {
      setRecoveryCodes(data.codes || []);
      toast({ title: "Two-factor authentication enabled!" });
      setSetupData(null);
      setVerifyCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't enable 2FA", description: apiErrorMessage(err, "Invalid code"), variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/disable", { code: disableCode });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Two-factor authentication disabled" });
      setDisableCode("");
      setShowDisable(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't disable 2FA", description: apiErrorMessage(err, "Invalid code"), variant: "destructive" });
    },
  });

  const is2FAEnabled = user?.totpEnabled;

  return (
    <Card data-testid="card-two-factor">
      <CardHeader>
        <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {recoveryCodes.length > 0 && <div role="status"><p>Save these recovery codes now. Each works once; they will not be shown again.</p><pre className="select-all">{recoveryCodes.join("\n")}</pre><Button variant="outline" onClick={()=>setRecoveryCodes([])}>I saved my codes</Button></div>}
        {is2FAEnabled && <Button variant="outline" onClick={async()=>{try {const r=await apiRequest('POST','/api/auth/2fa/recovery-codes');setRecoveryCodes((await r.json()).codes);}catch(e:any){toast({title:"Couldn't generate recovery codes",description:apiErrorMessage(e),variant:'destructive'});}}}>Generate new recovery codes</Button>}
        {is2FAEnabled && !showDisable && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">2FA is enabled</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">Your account is protected with an authenticator app.</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/20 hover:bg-destructive/5"
              onClick={() => setShowDisable(true)}
              data-testid="button-disable-2fa"
            >
              Disable 2FA
            </Button>
          </div>
        )}

        {is2FAEnabled && showDisable && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Enter a code from your authenticator app to disable 2FA.</p>
            <div className="flex gap-2">
              <Input
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6-digit code"
                className="max-w-[160px] font-mono text-center tracking-widest"
                maxLength={6}
                data-testid="input-disable-2fa-code"
              />
              <Button
                onClick={() => disableMutation.mutate()}
                disabled={disableCode.length !== 6 || disableMutation.isPending}
                variant="destructive"
                size="sm"
                data-testid="button-confirm-disable-2fa"
              >
                {disableMutation.isPending ? "Verifying..." : "Confirm Disable"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowDisable(false); setDisableCode(""); }} data-testid="button-cancel-disable-2fa">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!is2FAEnabled && !setupData && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enhance your account security</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add an extra layer of security by requiring a verification code when signing in.
              </p>
            </div>
            <Button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
              size="sm"
              data-testid="button-enable-2fa"
            >
              <Shield className="h-4 w-4 mr-2" />
              {setupMutation.isPending ? "Setting up..." : "Enable 2FA"}
            </Button>
          </div>
        )}

        {!is2FAEnabled && setupData && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">1. Scan the QR code with your authenticator app</p>
              <p className="text-xs text-muted-foreground">Use Google Authenticator, Authy, or any TOTP-compatible app.</p>
              <div className="flex justify-center p-4 bg-white rounded-lg border">
                <img src={setupData.qrCode} alt="2FA QR Code" className="w-48 h-48" data-testid="img-2fa-qr" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Or enter this key manually</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-3 py-2 rounded font-mono select-all break-all" data-testid="text-2fa-secret">
                  {setupData.secret}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (await copyToClipboard(setupData.secret)) toast({ title: "Secret key copied" });
                    else toast({ title: "Couldn't copy the key", description: "Your browser blocked clipboard access. Select the key shown here and copy it manually.", variant: "destructive" });
                  }}
                  data-testid="button-copy-2fa-secret"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">2. Enter the 6-digit code from your app to verify</p>
              <div className="flex gap-2">
                <Input
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  className="max-w-[160px] font-mono text-center tracking-widest"
                  maxLength={6}
                  data-testid="input-verify-2fa-code"
                />
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyCode.length !== 6 || verifyMutation.isPending}
                  data-testid="button-verify-2fa"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {verifyMutation.isPending ? "Verifying..." : "Verify & Enable"}
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSetupData(null); setVerifyCode(""); }} data-testid="button-cancel-2fa-setup">
              Cancel Setup
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SecuritySection({ user }: { user: any }) {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error("Passwords don't match");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const res = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to change password", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {user?.hasPassword && (
        <Card data-testid="card-change-password">
          <CardHeader>
            <CardTitle className="text-lg">Change Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  data-testid="input-current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min 8 characters)"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="input-confirm-password"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => changePasswordMutation.mutate()}
                disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                <Lock className="h-4 w-4 mr-2" />
                {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <TwoFactorSection user={user} />
      <SecurityActivity />
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment past due", unpaid: "Unpaid",
  canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", inactive: "Inactive",
};

/**
 * Reads the real subscription (never a hardcoded plan) and the price book in
 * shared/plans.ts. A legacy plan shows by the name it was bought under, with
 * the new plan its features now follow. Cards and invoices live in Stripe's
 * portal; plan changes go through /pricing (one subscription, changed in place).
 */
function BillingSection() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: subscription, isLoading, error } = useQuery<SubscriptionInfo>({ queryKey: ["/api/stripe/subscription"] });
  const view = describeSubscription(subscription);
  const plan = view.live && view.planKey ? PLANS[view.planKey] : null;
  const interval: BillingInterval = view.interval ?? "month";

  const showError = (title: string) => (err: unknown) => {
    if (err instanceof VerificationCancelled) return;
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });
  };
  const refreshBilling = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
  };

  const portalMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/stripe/create-portal", {})).json(),
    onSuccess: (data: any) => { if (data?.url) window.location.href = data.url; },
    onError: showError("Couldn't open billing"),
  });

  // The billing route takes { addons: { key: quantity } }; the quantity is the new total, so a repeat is harmless.
  const addonMutation = useMutation({
    mutationFn: async (v: { addon: AddonKey; quantity: number }) =>
      (await apiRequest("POST", "/api/stripe/addons", { addons: { [v.addon]: v.quantity } })).json(),
    onSuccess: (_data, v) => {
      refreshBilling();
      toast({ title: "Add-ons updated", description: `${ADDONS[v.addon].name}: ${v.quantity}` });
    },
    onError: showError("Couldn't update add-ons"),
  });

  const [locationsInput, setLocationsInput] = useState<string | null>(null);
  const billedLocations = view.locations ?? AGENCY_INCLUDED_LOCATIONS;
  const wantedLocations = normalizeLocations(locationsInput ?? billedLocations);
  const locationsQuote = agencyQuote(wantedLocations);
  // Add-ons and location counts change a Stripe subscription on a current plan;
  // a legacy plan keeps its old price until it switches plans in Pricing.
  const editable = view.changesInPlace && !view.isLegacy;
  const locationsMutation = useMutation({
    // Without a known interval the server keeps the subscription's own.
    mutationFn: async (locations: number) =>
      (await apiRequest("POST", "/api/stripe/change-plan", { plan: "agency", ...(view.interval ? { interval: view.interval } : {}), locations })).json(),
    onSuccess: (data: any, locations) => {
      if (data?.url) { window.location.href = data.url; return; }
      setLocationsInput(null);
      refreshBilling();
      toast({ title: "Locations updated", description: `Agency is now billed for ${locations.toLocaleString("en-US")} locations.` });
    },
    onError: showError("Couldn't change locations"),
  });

  const status = subscription?.status || "";
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const openEnded = !!periodEnd && periodEnd.getUTCFullYear() >= 2099;
  const periodText = !periodEnd ? null
    : openEnded ? "No end date"
    : !view.viaStripe ? `Access through ${periodEnd.toLocaleDateString()}`
    : status === "trialing" ? `Trial ends ${periodEnd.toLocaleDateString()}`
    : subscription?.cancelAtPeriodEnd === true ? `Ends ${periodEnd.toLocaleDateString()}`
    : subscription?.cancelAtPeriodEnd === false ? `Renews ${periodEnd.toLocaleDateString()}`
    // Not told whether it renews (it may be set to cancel in Stripe's portal).
    : `Current period ends ${periodEnd.toLocaleDateString()}`;
  // Legacy subscriptions keep the Stripe price they were sold at until they change plans.
  const priceText = !plan || view.isLegacy || !view.interval ? null
    : plan.key === "agency"
      ? (() => {
          if (!view.locations) return null;
          const q = agencyQuote(view.locations);
          return q.sales ? null : `${formatUsd(view.interval === "year" ? q.annualCents : q.monthlyCents)}${intervalSuffix(view.interval)} for ${view.locations.toLocaleString("en-US")} locations`;
        })()
      : `${formatUsd(planPriceCents(plan, view.interval))}${intervalSuffix(view.interval)}`;
  const addons = plan ? addonsForPlan(plan.key) : [];
  const pendingAddon = addonMutation.isPending ? addonMutation.variables?.addon : null;

  return (
    <div className="space-y-6">
      <Card data-testid="card-current-plan">
        <CardHeader>
          <CardTitle className="text-lg">Current plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-primary/5 border border-primary/10 rounded-lg">
            <div className="min-w-0 space-y-0.5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground" data-testid="text-current-plan">Loading your plan…</p>
              ) : error ? (
                <p className="text-sm text-destructive" role="alert" data-testid="text-current-plan">
                  Couldn't load your plan. {apiErrorMessage(error)}
                </p>
              ) : plan ? (
                <>
                  <div className="font-semibold text-primary flex flex-wrap items-center gap-2" data-testid="text-current-plan">
                    {view.displayName} plan
                    <Badge variant="outline" className="text-[10px]" data-testid="badge-plan-status">
                      {STATUS_LABELS[status] || status}
                    </Badge>
                  </div>
                  {view.isLegacy && (
                    <p className="text-xs text-muted-foreground" data-testid="text-legacy-match">
                      Your features now match {plan.name}.{view.viaStripe ? " Your existing price stays until you change plans." : ""}
                    </p>
                  )}
                  {(view.interval || priceText) && (
                    <p className="text-xs text-muted-foreground" data-testid="text-plan-interval">
                      {view.interval ? `Billed ${intervalWord(view.interval)}` : ""}{view.interval && priceText ? " · " : ""}{priceText ?? ""}
                    </p>
                  )}
                  {periodText && (
                    <p className="text-xs text-muted-foreground" data-testid="text-plan-period">{periodText}</p>
                  )}
                  {PAYMENT_PROBLEM_STATUSES.includes(status) && (
                    <p className="text-xs text-destructive" role="alert">Your last payment didn't go through. Update your card in Manage billing.</p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold text-primary" data-testid="text-current-plan">No active plan</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-plan-inactive">
                    {view.storedPlan
                      ? `Your ${view.displayName} subscription is ${(STATUS_LABELS[status] || status).toLowerCase()}.`
                      : `No subscription on this account. Every plan starts with a ${TRIAL_DAYS}-day free trial.`}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate(view.interval === "year" ? "/pricing?interval=year" : "/pricing")} data-testid="button-upgrade">
                {plan ? "Change plan" : "Choose a plan"}
              </Button>
              {view.viaStripe && (
                <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending} data-testid="button-manage-billing">
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PLAN_KEYS.map((key) => (
              <a
                key={key}
                href="/pricing"
                onClick={e => { e.preventDefault(); navigate("/pricing"); }}
                className={`p-3 border rounded-lg text-center hover:border-primary/50 hover:bg-muted/40 transition-colors ${plan?.key === key ? "border-primary/50" : ""}`}
                data-testid={`card-plan-${key}`}
              >
                <div className="text-sm font-semibold flex items-center justify-center gap-1.5">
                  {PLANS[key].name}
                  {plan?.key === key && <Badge variant="outline" className="text-[9px] px-1 py-0">{view.isLegacy ? "Matches" : "Current"}</Badge>}
                </div>
                <p className="text-lg font-bold text-primary mt-1">{formatUsd(planPriceCents(PLANS[key], interval))}{intervalSuffix(interval)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{PLANS[key].tagline}</p>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {plan && (
        <Card data-testid="card-addons">
          <CardHeader>
            <CardTitle className="text-lg">Add-ons</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pay only for the extra you need; add-ons are billed with your plan{view.interval ? `, ${intervalWord(view.interval)}` : ""}.
            </p>
            {!view.viaStripe ? (
              <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-3" data-testid="text-addons-no-stripe">
                Add-ons are billed on a Stripe subscription, and this plan wasn't bought through Stripe checkout. Choose a plan in Pricing to add them.
              </p>
            ) : view.isLegacy && (
              <p className="text-sm text-muted-foreground rounded-lg bg-muted/50 p-3" data-testid="text-addons-legacy">
                Add-ons and location counts ride on the current plans. Your {view.displayName} price stays as it is; switch to {plan.name} in Pricing to add them.
              </p>
            )}
            {plan.key === "agency" && editable && (
              <div className="rounded-lg border p-3 space-y-2" data-testid="row-billing-locations">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Client locations</p>
                    <p className="text-xs text-muted-foreground">
                      {AGENCY_INCLUDED_LOCATIONS} included{view.locations ? `; billed for ${view.locations.toLocaleString("en-US")} now` : ""}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className="w-24 h-9"
                      aria-label="Billed client locations"
                      value={locationsInput ?? String(billedLocations)}
                      onChange={(e) => setLocationsInput(e.target.value)}
                      data-testid="input-billing-locations"
                    />
                    {!locationsQuote.sales && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={wantedLocations === billedLocations || locationsMutation.isPending}
                        onClick={() => locationsMutation.mutate(wantedLocations)}
                        data-testid="button-billing-locations"
                      >
                        {locationsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
                      </Button>
                    )}
                  </div>
                </div>
                {locationsQuote.sales ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>More than {AGENCY_SELF_SERVE_MAX_LOCATIONS.toLocaleString("en-US")} locations is priced with a sales rep.</span>
                    <TalkToSalesButton topic={`Agency plan — ${wantedLocations.toLocaleString("en-US")} locations`} size="sm" variant="outline" data-testid="button-billing-locations-sales" />
                  </div>
                ) : wantedLocations !== billedLocations && (
                  <p className="text-xs text-muted-foreground" data-testid="text-billing-locations-quote">
                    {wantedLocations.toLocaleString("en-US")} locations = {formatUsd(interval === "year" ? locationsQuote.annualCents : locationsQuote.monthlyCents)}{intervalSuffix(interval)}
                  </p>
                )}
              </div>
            )}
            {addons.map((addon) => {
              const qty = Math.max(0, Number(subscription?.addons?.[addon.key] ?? 0) || 0);
              const pending = pendingAddon === addon.key;
              const disabled = !editable || addonMutation.isPending;
              return (
                <div key={addon.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" data-testid={`row-billing-addon-${addon.key}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{addon.name}</p>
                    <p className="text-xs text-muted-foreground">{addon.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatUsd(addonPriceCents(addon, interval))}{intervalSuffix(interval)} each
                      {addon.setupCents ? ` + ${formatUsd(addon.setupCents)} one-time setup` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      aria-label={`Remove one ${addon.name}`}
                      disabled={disabled || qty === 0}
                      onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty - 1 })}
                      data-testid={`button-addon-dec-${addon.key}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" data-testid={`text-addon-qty-${addon.key}`}>
                      {pending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : qty}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8"
                      aria-label={`Add one ${addon.name}`}
                      disabled={disabled}
                      onClick={() => addonMutation.mutate({ addon: addon.key, quantity: qty + 1 })}
                      data-testid={`button-addon-inc-${addon.key}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-payment-method">
        <CardHeader>
          <CardTitle className="text-lg">Payment method &amp; invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <CreditCard className="h-5 w-5 text-muted-foreground shrink-0" />
              {view.viaStripe ? (
                <p className="text-sm text-muted-foreground" data-testid="text-billing-portal">
                  Your card, invoices and cancellation are managed in Stripe's secure billing portal.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-billing-portal">
                  This account has no Stripe subscription, so there's no card or invoice to show. You enter a card at checkout when you choose a plan.
                </p>
              )}
            </div>
            {view.viaStripe ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
                data-testid="button-portal-billing"
              >
                {portalMutation.isPending ? "Opening…" : "Manage billing"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => navigate("/pricing")} data-testid="button-add-payment">
                See plans
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
