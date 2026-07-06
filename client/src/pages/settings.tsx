import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  User, Bell, Shield, CreditCard, Mail, Lock, Eye, EyeOff,
  Settings, ChevronRight, Camera, Save, LogOut, Trash2, Building2,
  Globe, BarChart3, AlertTriangle, CheckCircle, Monitor,
  Smartphone, FileText, Megaphone, ShieldCheck, Activity,
  Gift, Copy, Clock, Sparkles, Plus, X, Pencil, Link, Info,
} from "lucide-react";
import { useLocation } from "wouter";

type SettingsTab = "profile" | "account" | "notifications" | "security" | "billing";

export default function SettingsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const tabs: { id: SettingsTab; label: string; icon: any }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "account", label: "Account", icon: Settings },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
    { id: "billing", label: "Billing & Plans", icon: CreditCard },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your account, profile, notifications, and preferences.</p>
          </div>
          <button
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                navigate("/");
              }
            }}
            className="inline-flex items-center justify-center rounded-md h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
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
            {activeTab === "notifications" && <NotificationsSection />}
            {activeTab === "security" && <SecuritySection user={user} />}
            {activeTab === "billing" && <BillingSection user={user} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ user }: { user: any }) {
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [email] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState(user?.companyName || "");
  const [companyLogoUrl, setCompanyLogoUrl] = useState(user?.companyLogoUrl || "");
  const [googleProfileUrl, setGoogleProfileUrl] = useState(user?.googleProfileUrl || "");
  const [bio, setBio] = useState("");
  const logoInputRef = useState<HTMLInputElement | null>(null);

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/profile", {
        displayName,
        companyName,
        companyLogoUrl,
        googleProfileUrl,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    },
    onError: () => {
      toast({ title: "Failed to update profile", variant: "destructive" });
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
      } catch {
        toast({ title: "Failed to upload photo", variant: "destructive" });
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
      } catch {
        setCompanyLogoUrl(dataUrl);
        toast({ title: "Upload failed, using local preview", variant: "destructive" });
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
                data-testid="input-display-name"
              />
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
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-phone"
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Tell us about your business..."
                rows={3}
                data-testid="textarea-bio"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => updateProfileMutation.mutate()}
              disabled={updateProfileMutation.isPending}
              data-testid="button-save-profile"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <GmbProfilesSection />
    </div>
  );
}

function GmbProfilesSection() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [name, setName] = useState("");
  const [googleProfileUrl, setGoogleProfileUrl] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [gmbLogo, setGmbLogo] = useState("");

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/review-templates"],
  });

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
      toast({ title: "Failed to add profile", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/review-templates/${editingTemplate.id}`, {
        name,
        googleProfileUrl,
        projectDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "GMB profile updated" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Failed to update profile", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/review-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      toast({ title: "GMB profile removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove profile", variant: "destructive" });
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
  });

  const [gmbLogoUploading, setGmbLogoUploading] = useState(false);

  function handleGmbLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
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
      setGmbLogoUploading(true);
      try {
        const res = await apiRequest("POST", "/api/upload/logo", { imageData: dataUrl, type: "gmb-logo" });
        const data = await res.json();
        setGmbLogo(data.url);
      } catch {
        setGmbLogo(dataUrl);
      } finally {
        setGmbLogoUploading(false);
      }
    };
    img.src = URL.createObjectURL(file);
  }

  function closeDialog() {
    setShowDialog(false);
    setEditingTemplate(null);
    setName("");
    setGoogleProfileUrl("");
    setProjectDescription("");
    setGmbLogo("");
  }

  function openEdit(t: any) {
    setEditingTemplate(t);
    setName(t.name);
    setGoogleProfileUrl(t.googleProfileUrl);
    setProjectDescription(t.projectDescription || "");
    setGmbLogo("");
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
                    data-testid={`button-edit-gmb-${t.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(t.id)}
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

      {showDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" data-testid="overlay-gmb-dialog">
          <div className="absolute inset-0 bg-black/50" onClick={closeDialog} />
          <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{editingTemplate ? "Edit GMB Profile" : "Add GMB Profile"}</h3>
              <button onClick={closeDialog} className="h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground" data-testid="button-close-gmb-dialog">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label><Camera className="h-3.5 w-3.5 inline mr-1" />Business Logo</Label>
                <div className="flex items-center gap-3">
                  {gmbLogo ? (
                    <div className="relative">
                      <img src={gmbLogo} alt="Logo" className="h-14 w-14 rounded-lg object-contain border border-border bg-white dark:bg-gray-900 p-1" data-testid="img-gmb-logo" />
                      <button onClick={() => setGmbLogo("")} className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[10px]" data-testid="button-remove-gmb-logo">x</button>
                    </div>
                  ) : (
                    <div className="h-14 w-14 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <label htmlFor="gmbLogoUpload" className="cursor-pointer">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors">
                        <Camera className="h-3.5 w-3.5" />
                        {gmbLogo ? "Change" : "Upload Logo"}
                      </div>
                    </label>
                    <input id="gmbLogoUpload" type="file" accept="image/*" onChange={handleGmbLogoUpload} className="hidden" data-testid="input-gmb-logo-upload" />
                    <p className="text-xs text-muted-foreground mt-1">Shown in review request emails</p>
                  </div>
                </div>
              </div>
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
                  data-testid="input-gmb-url"
                />
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
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-gmb">Cancel</Button>
              <Button
                onClick={() => editingTemplate ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!name.trim() || !googleProfileUrl.trim() || createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-gmb"
              >
                {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingTemplate ? "Save Changes" : "Add Profile"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AccountSection({ user }: { user: any }) {
  const { toast } = useToast();
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [dateFormat, setDateFormat] = useState("MM/DD/YYYY");

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

      <Card data-testid="card-preferences">
        <CardHeader>
          <CardTitle className="text-lg">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-timezone"
              >
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Denver">Mountain (MT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="America/Anchorage">Alaska (AKT)</option>
                <option value="Pacific/Honolulu">Hawaii (HST)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateFormat">Date Format</Label>
              <select
                id="dateFormat"
                value={dateFormat}
                onChange={e => setDateFormat(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-date-format"
              >
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => toast({ title: "Preferences saved" })}
              data-testid="button-save-preferences"
            >
              <Save className="h-4 w-4 mr-2" /> Save Preferences
            </Button>
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
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
            </div>
            <Button variant="destructive" size="sm" data-testid="button-delete-account">
              <Trash2 className="h-4 w-4 mr-2" /> Delete Account
            </Button>
          </div>
        </CardContent>
      </Card>
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
  const ADMIN_EMAILS = ["alpinesidingcompany@gmail.com", "support@constructhub.us"];
  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

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
    onError: async (err: any) => {
      const msg = err?.message || "Failed to redeem code";
      toast({ title: "Invalid Code", description: msg, variant: "destructive" });
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
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/beta-codes"] });
      navigator.clipboard.writeText(data.code);
      const emailMsg = recipientEmail.trim() ? ` and emailed to ${recipientEmail}` : "";
      toast({ title: "Trial Code Created & Copied!", description: `Code: ${data.code}${emailMsg}` });
      setRecipientEmail("");
      setRecipientName("");
      setShowCreateForm(false);
    },
    onError: () => {
      toast({ title: "Failed to generate code", variant: "destructive" });
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
    onError: () => {
      toast({ title: "Failed to revoke", variant: "destructive" });
    },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: "Code copied to clipboard" });
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
                          <button onClick={() => copyCode(c.code)} className="text-muted-foreground hover:text-foreground" data-testid={`button-copy-code-${c.id}`}>
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

function NotificationsSection() {
  const { toast } = useToast();
  const [notifEmail, setNotifEmail] = useState("");
  const [notifEmails, setNotifEmails] = useState<string[]>([]);

  const [settings, setSettings] = useState({
    clickGuardAlerts: false,
    clickGuardWeeklyReport: true,
    clickGuardMonthlyReport: true,
    competitorAlerts: true,
    gmbChanges: true,
    rankingChanges: true,
    permitUpdates: false,
    newFeatures: true,
    marketingEmails: false,
  });

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const addEmail = () => {
    if (notifEmail && notifEmails.length < 5 && !notifEmails.includes(notifEmail)) {
      setNotifEmails([...notifEmails, notifEmail]);
      setNotifEmail("");
    }
  };

  const removeEmail = (email: string) => {
    setNotifEmails(notifEmails.filter(e => e !== email));
  };

  const notifications = [
    {
      category: "Click Guard",
      icon: ShieldCheck,
      items: [
        { key: "clickGuardAlerts" as const, title: "Google Ads Alerts", desc: "Get notified by email every time an IP has been detected and blocked." },
        { key: "clickGuardWeeklyReport" as const, title: "Weekly Report", desc: "Get weekly reports regarding domain traffic and security performance." },
        { key: "clickGuardMonthlyReport" as const, title: "Monthly Analytics Report", desc: "Receive a monthly report detailing all click fraud insights on your domain including personalized recommendations." },
      ],
    },
    {
      category: "Google Business",
      icon: Globe,
      items: [
        { key: "gmbChanges" as const, title: "GMB Listing Changes", desc: "Get notified when changes are detected on your Google Business listings." },
        { key: "rankingChanges" as const, title: "Ranking Changes", desc: "Get alerts when your local rankings change significantly." },
      ],
    },
    {
      category: "Competitor Intel",
      icon: BarChart3,
      items: [
        { key: "competitorAlerts" as const, title: "Competitor Activity", desc: "Get notified about significant changes in competitor profiles and reviews." },
      ],
    },
    {
      category: "Permits & Updates",
      icon: FileText,
      items: [
        { key: "permitUpdates" as const, title: "Permit Updates", desc: "Get notified when new permits match your saved searches." },
        { key: "newFeatures" as const, title: "New Features & Tips", desc: "Stay updated on new ConstructHUB features and tips for contractors." },
        { key: "marketingEmails" as const, title: "Marketing Emails", desc: "Receive promotional offers, discounts, and partnership opportunities." },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <Card data-testid="card-notification-emails">
        <CardHeader>
          <CardTitle className="text-lg">Notification Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter an email address to receive notifications (up to 5 addresses).
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              value={notifEmail}
              onChange={e => setNotifEmail(e.target.value)}
              placeholder="you@company.com"
              onKeyDown={e => e.key === "Enter" && addEmail()}
              data-testid="input-notification-email"
            />
            <Button
              variant="outline"
              onClick={addEmail}
              disabled={!notifEmail || notifEmails.length >= 5}
              className="shrink-0"
              data-testid="button-add-notification-email"
            >
              Add New
            </Button>
          </div>
          {notifEmails.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {notifEmails.map(email => (
                <Badge key={email} variant="secondary" className="gap-1.5 py-1 px-3">
                  {email}
                  <button
                    onClick={() => removeEmail(email)}
                    className="text-destructive hover:text-destructive/80"
                    data-testid={`button-remove-email-${email}`}
                  >
                    &times;
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {notifications.map(group => (
        <Card key={group.category} data-testid={`card-notif-${group.category.toLowerCase().replace(/\s+/g, "-")}`}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <group.icon className="h-5 w-5 text-primary" />
              {group.category}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {group.items.map((item, idx) => (
              <div
                key={item.key}
                className={`flex items-center justify-between py-4 ${idx < group.items.length - 1 ? "border-b border-border/50" : ""}`}
              >
                <div className="flex-1 pr-4">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
                <Switch
                  checked={settings[item.key]}
                  onCheckedChange={() => toggleSetting(item.key)}
                  data-testid={`switch-notif-${item.key}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end">
        <Button
          onClick={() => toast({ title: "Notification preferences saved" })}
          data-testid="button-save-notifications"
        >
          <Save className="h-4 w-4 mr-2" /> Save Notification Settings
        </Button>
      </div>
    </div>
  );
}

function TwoFactorSection({ user }: { user: any }) {
  const { toast } = useToast();
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
      toast({ title: err.message || "Failed to start 2FA setup", variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/2fa/verify", { code: verifyCode });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Two-factor authentication enabled!" });
      setSetupData(null);
      setVerifyCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: err.message || "Invalid code", variant: "destructive" });
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
      toast({ title: err.message || "Invalid code", variant: "destructive" });
    },
  });

  const is2FAEnabled = user?.totpEnabled;

  return (
    <Card data-testid="card-two-factor">
      <CardHeader>
        <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
                  onClick={() => {
                    navigator.clipboard.writeText(setupData.secret);
                    toast({ title: "Secret key copied" });
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
      toast({ title: err.message || "Failed to change password", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {!user?.googleId && (
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

      <Card data-testid="card-active-sessions">
        <CardHeader>
          <CardTitle className="text-lg">Active Sessions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <Monitor className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Current Session</p>
                <p className="text-xs text-muted-foreground">This browser · Active now</p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:bg-emerald-950">
              Active
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            If you notice any suspicious activity, sign out of all sessions and change your password.
          </p>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/20 hover:bg-destructive/5" data-testid="button-sign-out-all">
            <LogOut className="h-4 w-4 mr-2" /> Sign Out All Other Sessions
          </Button>
        </CardContent>
      </Card>

      <TwoFactorSection user={user} />
    </div>
  );
}

function BillingSection({ user }: { user: any }) {
  return (
    <div className="space-y-6">
      <Card data-testid="card-current-plan">
        <CardHeader>
          <CardTitle className="text-lg">Current Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/10 rounded-lg">
            <div>
              <p className="font-semibold text-primary" data-testid="text-current-plan">Free Plan</p>
              <p className="text-xs text-muted-foreground mt-0.5">Basic access to permit search and database directory</p>
            </div>
            <Button size="sm" data-testid="button-upgrade">
              Upgrade Plan
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Standard", price: "$15/mo", features: "Search + Schedules" },
              { label: "Professional", price: "$30/mo", features: "+ GMB Tools" },
              { label: "Premium", price: "$100/mo", features: "+ Click Guard" },
              { label: "Platinum", price: "$995/mo", features: "Everything + Competitor Intel" },
            ].map(plan => (
              <div key={plan.label} className="p-3 border rounded-lg text-center" data-testid={`card-plan-${plan.label.toLowerCase()}`}>
                <p className="text-sm font-semibold">{plan.label}</p>
                <p className="text-lg font-bold text-primary mt-1">{plan.price}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{plan.features}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-payment-method">
        <CardHeader>
          <CardTitle className="text-lg">Payment Method</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">No payment method on file</p>
                <p className="text-xs text-muted-foreground">Add a card to upgrade your plan</p>
              </div>
            </div>
            <Button variant="outline" size="sm" data-testid="button-add-payment">
              Add Card
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-billing-history">
        <CardHeader>
          <CardTitle className="text-lg">Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No billing history yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">Invoices will appear here after your first purchase</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
