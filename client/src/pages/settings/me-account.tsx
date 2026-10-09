import { Link as RouteLink } from "wouter";
import { inNativeApp } from "@/lib/app-shell";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Building2, Camera, CheckCircle, Clock, Copy, Gift, Globe, Info, Link, Mail, Pencil, Plus, Save, Shield,
  Sparkles, Trash2, X,
} from "lucide-react";
import { ReviewReferralSettings } from "@/components/review-referral-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { PLANS, effectivePlanKey } from "@shared/plans";
import { ACCESS_GRANT_MAX_DAYS, ACCESS_GRANT_MIN_DAYS, ACCESS_GRANT_QUICK_DAYS, validGrantDays } from "@shared/access-grants";
import { requestRecentAuth } from "@/components/recent-auth";
import { copyToClipboard, LoadingCard } from "./shared";
import type { SettingsSectionProps, SettingsUser } from "./types";

/**
 * Me → My account: who you are (name, photo, company and logo), the Google
 * Business Profiles review requests point at, review referral settings, the
 * account's details, trial codes and the request-deletion path.
 */
export function MyAccountSection({ user }: SettingsSectionProps) {
  return (
    <div className="space-y-6" data-testid="section-account">
      {/* The form seeds its fields from the account, so it mounts once the account is known. */}
      {user ? <ProfileSection key={String(user.id ?? user.email ?? "me")} user={user} /> : <LoadingCard label="Loading your account…" />}
      <AccountSection user={user} />
    </div>
  );
}

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

function ProfileSection({ user }: { user: SettingsUser }) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [email] = useState(user.email || "");
  const [companyName, setCompanyName] = useState(user.companyName || "");
  const [companyLogoUrl, setCompanyLogoUrl] = useState(user.companyLogoUrl || "");
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

  /** Downscale to 256px and squeeze under ~400KB before upload (the profile accepts an inline image). */
  function resizeForUpload(file: File, onReady: (dataUrl: string) => void) {
    const img = new Image();
    img.onload = () => {
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
      onReady(dataUrl);
    };
    img.src = URL.createObjectURL(file);
  }

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resizeForUpload(file, async (dataUrl) => {
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
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resizeForUpload(file, async (dataUrl) => {
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
        toast({ title: "Logo not uploaded to storage", description: `${apiErrorMessage(err).replace(/\.?\s*$/, ".")} The image is kept in this form; click Save changes to store it with your profile.`, variant: "destructive" });
      } finally {
        setLogoUploading(false);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-profile">
        <CardHeader>
          <CardTitle className="text-base">Profile information</CardTitle>
          <div className="flex justify-end [&>button]:w-full sm:[&>button]:w-auto">
            <Button
              onClick={() => updateProfileMutation.mutate()}
              disabled={updateProfileMutation.isPending || nameMissing}
              data-testid="button-save-profile"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateProfileMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover border-2 border-border"
                  referrerPolicy="no-referrer"
                  data-testid="img-avatar"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center border-2 border-border" data-testid="img-avatar-placeholder">
                  <span className="text-base font-semibold text-foreground">
                    {(user.displayName || user.email)?.[0]?.toUpperCase() || "?"}
                  </span>
                </div>
              )}
              <label htmlFor="avatarUpload" className="cursor-pointer">
                <div
                  className="absolute -bottom-1 -right-1 h-10 w-10 rounded-full border bg-background text-foreground flex items-center justify-center hover:bg-muted transition-colors"
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
              <p className="font-medium" data-testid="text-profile-name">{user.displayName || "No name set"}</p>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{user.email}</p>
              {user.emailVerified && (
                <Badge variant="outline" className="mt-1 text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950">
                  <CheckCircle className="h-3 w-3" /> Verified
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
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
              <Label htmlFor="companyName"><Building2 className="h-3.5 w-3.5 inline mr-1" />Company name</Label>
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
              <Label><Camera className="h-3.5 w-3.5 inline mr-1" />Company logo</Label>
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
                      type="button"
                      onClick={() => setCompanyLogoUrl("")}
                      aria-label="Remove logo"
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
                      {logoUploading ? "Uploading…" : companyLogoUrl ? "Change Logo" : "Upload Logo"}
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


        </CardContent>
      </Card>

      <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Review referral settings</summary><div className="mt-4"><ReviewReferralSettings /></div></details>
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
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Google Business Profiles</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Manage your GMB locations for review requests</p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowDialog(true)} data-testid="button-add-gmb-profile">
          <Plus className="h-4 w-4 mr-1" /> Add profile
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
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
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
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingTemplate ? "Save changes" : "Add profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AccountSection({ user }: { user: SettingsUser | undefined }) {
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
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Account ID</p>
              <p className="text-xs text-muted-foreground mt-0.5">Your unique identifier</p>
            </div>
            <code className="text-xs bg-muted px-2.5 py-1 rounded font-mono" data-testid="text-account-id">
              {user?.accountId || "—"}
            </code>
          </div>
          <SupportNumbersRow />
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Member since</p>
              <p className="text-xs text-muted-foreground mt-0.5">When you joined ConstructHUB</p>
            </div>
            <span className="text-sm" data-testid="text-member-since">
              {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border/50">
            <div>
              <p className="text-sm font-medium">Login method</p>
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

      {/* Open for platform admins: inviting people is something the owner does from here (Dennis, 2026-10-02). */}
      {!inNativeApp() && <details className="border-t pt-4" open={user?.isPlatformAdmin === true || undefined}><summary className="cursor-pointer text-sm font-medium">Trials and invite codes</summary><div className="mt-4"><BetaAccessSection user={user} /></div></details>}

      <Card className="border-destructive/20" data-testid="card-danger-zone">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Delete account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {inNativeApp() ? "Permanently delete your account and its data." : "Ask our support team to permanently delete your account and its data."}
              </p>
            </div>
            {/* The iPhone apps delete the account themselves (App Store 5.1.1(v)); the website keeps the support
                request (owner, 2026-10-04: "just dont delete in the original site/mobile"). */}
            {inNativeApp() ? (
              <Button asChild variant="destructive" size="sm" data-testid="button-delete-account">
                <RouteLink href="/account/delete"><Trash2 className="h-4 w-4 mr-2" /> Delete account</RouteLink>
              </Button>
            ) : (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} data-testid="button-delete-account">
                <Trash2 className="h-4 w-4 mr-2" /> Request deletion
              </Button>
            )}
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

function BetaAccessSection({ user }: { user: SettingsUser | undefined }) {
  const { toast } = useToast();
  const [betaCode, setBetaCode] = useState("");
  // 1–1000 days (owner, 2026-10-02), typed or picked; the server checks the same bounds.
  const [trialDaysText, setTrialDaysText] = useState("7");
  const trialDays = /^\d+$/.test(trialDaysText.trim()) ? Number(trialDaysText.trim()) : NaN;
  const trialDaysOk = validGrantDays(trialDays);
  const [unlimited, setUnlimited] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  // /api/auth/me reports the server's own platform-admin check; the admin endpoints enforce it.
  const isAdmin = user?.isPlatformAdmin === true;

  const { data: betaStatus } = useQuery<{ active: boolean; expiresAt?: string; trialDays?: number; plan?: string }>({
    queryKey: ["/api/beta-codes/status"],
    enabled: !!user,
  });
  // A trial code grants the Agency plan (older grants were stored as the legacy key that maps to it).
  const trialPlanName = PLANS[effectivePlanKey({ plan: betaStatus?.plan, status: "active" }) ?? "agency"].name;

  const { data: generatedCodes, error: codesError, refetch: refetchCodes } = useQuery<any[]>({
    queryKey: ["/api/beta-codes"],
    enabled: isAdmin,
  });
  // Production's admin second factor (403 reauth): the list waits for an identity check; the buttons
  // go through apiRequest, which opens the verify-identity dialog and retries by itself.
  const codesNeedGate = /^403:/.test(String((codesError as Error | null)?.message ?? "")) && /"reauth":\s*true/.test(String((codesError as Error).message));

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/beta-codes/redeem", { code: betaCode.trim() });
      return res.json();
    },
    onSuccess: (data: any) => {
      setBetaCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/beta-codes/status"] });
      // The trial is a plan grant: billing, limits and the Agency-only pages all change with it.
      queryClient.invalidateQueries({ queryKey: ["/api/stripe/subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agency/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Trial activated", description: data.message });
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
      const to = recipientEmail.trim();
      const link: string = typeof data.inviteUrl === "string" ? data.inviteUrl : data.code;
      const copied = await copyToClipboard(link);
      const copiedMsg = copied ? " The invite link is copied, so you can also text it." : "";
      if (to && data.emailed) {
        toast({ title: `Invite emailed to ${recipientName.trim() || to}`, description: `They click "Accept your invite", sign in or sign up, and the trial starts. Code ${data.code}.${copiedMsg}` });
      } else if (to) {
        toast({ title: "Invite created, but the email didn't send", description: `Send them this link yourself: ${link}${copied ? " (copied)" : ""}`, variant: "destructive" });
      } else {
        toast({ title: "Invite link created", description: `Send this link: ${link}${copied ? " (copied)" : ""}. Opening it signs them in and starts the trial.` });
      }
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

  // The invite link, not the bare code: opening it signs the person in (or up) and starts the trial.
  const copyCode = async (code: string) => {
    const link = `${window.location.origin}/invite/${encodeURIComponent(code)}`;
    if (await copyToClipboard(link)) toast({ title: "Invite link copied", description: "Send it by text or email. Opening it starts the trial." });
    else toast({ title: "Couldn't copy the link", description: `Your browser blocked clipboard access. Send this link: ${link}`, variant: "destructive" });
  };

  const getTimeRemaining = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    // "Until revoked" codes end in 2099; a long code (up to 1000 days) still counts down.
    if (new Date(expiresAt).getUTCFullYear() >= 2099) return "Unlimited Access";
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
      <Card className="border-border bg-card" data-testid="card-beta-access">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="h-5 w-5 text-emerald-500" />
            Trial Access Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {betaStatus?.active ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20" data-testid="text-beta-active">
              <Sparkles className="h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400" data-testid="text-trial-plan">{trialPlanName} trial active</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Clock className="h-3 w-3" />
                  {betaStatus.expiresAt ? getTimeRemaining(betaStatus.expiresAt) : "Active"}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Have a trial access code? Enter it below to use the {PLANS.agency.name} plan for the length of the trial.
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Enter code (e.g. TRIAL-A1B2C3D4)"
                  value={betaCode}
                  onChange={e => setBetaCode(e.target.value.toUpperCase())}
                  className="font-mono tracking-wider flex-1 min-w-[12rem]"
                  aria-label="Trial access code"
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
        <Card className="border-border bg-card" data-testid="card-admin-beta">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-5 w-5 text-violet-500" />
                Admin: Trial Management
              </CardTitle>
              <Button
                size="sm"
                onClick={() => setShowCreateForm(!showCreateForm)}
                className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
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
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={ACCESS_GRANT_MIN_DAYS}
                          max={ACCESS_GRANT_MAX_DAYS}
                          step={1}
                          value={trialDaysText}
                          onChange={e => setTrialDaysText(e.target.value)}
                          aria-label={`Trial length in days (${ACCESS_GRANT_MIN_DAYS}–${ACCESS_GRANT_MAX_DAYS})`}
                          aria-invalid={!trialDaysOk}
                          className="w-28"
                          data-testid="input-trial-days"
                        />
                        <span className={`text-sm font-bold ${trialDaysOk ? "text-violet-600 dark:text-violet-400" : "text-destructive"}`} data-testid="text-trial-days">
                          {trialDaysOk ? `${trialDays.toLocaleString("en-US")} day${trialDays > 1 ? "s" : ""}` : `${ACCESS_GRANT_MIN_DAYS}–${ACCESS_GRANT_MAX_DAYS.toLocaleString("en-US")} days`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick picks">
                        {ACCESS_GRANT_QUICK_DAYS.map(n => (
                          <Button
                            key={n}
                            type="button"
                            size="sm"
                            variant={trialDays === n ? "default" : "outline"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setTrialDaysText(String(n))}
                            data-testid={`button-trial-days-${n}`}
                          >
                            {n === 365 ? "1 year" : n === 1000 ? "1,000 days" : `${n} days`}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium" htmlFor="trial-recipient-name">Recipient Name (optional)</Label>
                    <Input
                      id="trial-recipient-name"
                      placeholder="John Smith"
                      value={recipientName}
                      onChange={e => setRecipientName(e.target.value)}
                      data-testid="input-recipient-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium" htmlFor="trial-recipient-email">Recipient Email (optional)</Label>
                    <Input
                      id="trial-recipient-email"
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
                    They get an invite email with an "Accept your invite" button. One click, sign in or sign up, and the trial starts.
                  </p>
                )}
                <Button
                  onClick={() => generateMutation.mutate()}
                  disabled={generateMutation.isPending || (!unlimited && !trialDaysOk)}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  data-testid="button-generate-trial"
                >
                  {generateMutation.isPending ? "Creating..." : `${recipientEmail.trim() ? "Email" : "Create"} ${unlimited ? "Unlimited " : trialDaysOk ? `${trialDays.toLocaleString("en-US")}-Day ` : ""}Trial Invite${recipientEmail.trim() ? "" : " Link"}`}
                </Button>
              </div>
            )}

            {codesNeedGate ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3" data-testid="text-trial-codes-gate">
                <p className="text-sm text-muted-foreground">Verify it's you to see and manage trial codes.</p>
                <Button size="sm" variant="outline" onClick={() => { requestRecentAuth().then(() => refetchCodes(), () => {}); }} data-testid="button-trial-codes-verify">
                  Verify identity
                </Button>
              </div>
            ) : generatedCodes && generatedCodes.length > 0 ? (
              <div className="space-y-2">
                {generatedCodes.map((c: any) => {
                  const status = getCodeStatus(c);
                  return (
                    <div
                      key={c.id}
                      className={`p-3 rounded-lg border bg-muted/30 ${status === "revoked" ? "opacity-50 border-red-500/20" : "border-border/50"}`}
                      data-testid={`row-beta-code-${c.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-sm font-semibold tracking-wider" data-testid={`text-beta-code-${c.id}`}>{c.code}</code>
                          <button type="button" onClick={() => copyCode(c.code)} aria-label={`Copy invite link for ${c.code}`} className="text-muted-foreground hover:text-foreground" data-testid={`button-copy-code-${c.id}`}>
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <Badge variant="outline" className="text-xs">{c.trialDays === 0 ? "∞" : `${c.trialDays || 2}d`}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {status === "revoked" ? (
                            <Badge variant="outline" className="text-red-500 border-red-500/30" data-testid={`badge-status-${c.id}`}>Revoked</Badge>
                          ) : status === "redeemed" ? (
                            <Badge variant="outline" data-testid={`badge-status-${c.id}`}>Redeemed</Badge>
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
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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


/** The numbers a caller reads to Gabe on the support line (server/support): the customer number, and a CRM number per CRM account. */
function SupportNumbersRow() {
  const { data } = useQuery<{ customerNumber: string; crmNumbers: string[] }>({ queryKey: ["/api/support/my-numbers"] });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border/50">
      <div>
        <p className="text-sm font-medium">Customer number</p>
        <p className="text-xs text-muted-foreground mt-0.5">Read this to Gabe when you call support{data?.crmNumbers?.length ? " (CRM accounts: the CRM number)" : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <code className="text-xs bg-muted px-2.5 py-1 rounded font-mono" data-testid="text-customer-number">{data?.customerNumber || "—"}</code>
        {(data?.crmNumbers ?? []).map((n) => <code key={n} className="text-xs bg-muted px-2.5 py-1 rounded font-mono" data-testid={`text-crm-number-${n}`}>{n}</code>)}
      </div>
    </div>
  );
}
