import { AgencyWorkspace, Pager, useAgencyFilter } from "@/components/agency-workspace";
import { GoogleReport } from "@/components/profile-guard";
import { AiReplySettings } from "@/components/ai-review-replies";
import { GoogleSurface, GoogleAvatar, GoogleStarRow, GooglePill, GoogleAiOverview, relativeTime } from "@/components/google";
import { GbpConnection } from "@/components/gbp-connection";
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { inNativeApp } from "@/lib/app-shell";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AppPage, AppTabsList, EmptyState, Notice, PageHeader, Section, Stat, StatGrid, StatusPill, Toolbar,
} from "@/components/app-ui";
import {
  Star, Send, Plus, Trash2, RefreshCw, Loader2, ExternalLink,
  Camera, Mail, User, Building2, Link, FileText, CheckCircle2,
  Clock, MessageSquare, Eye, ShieldCheck, TrendingUp,
  ThumbsUp, ThumbsDown, Sparkles, Filter, Heart, Target,
  Megaphone, BadgeCheck, AlertTriangle, ChevronDown, ChevronUp,
  Edit, Copy, X, Info, Bell, Timer, ImagePlus,
  Phone, MapPin, Search, Download, Bot, PenLine, MousePointerClick,
  CalendarDays, StickyNote, FolderOpen,
} from "lucide-react";
import { useUrlParam } from "@/hooks/use-url-param";

// Pacific time with the real abbreviation (PDT in summer, PST in winter).
const formatPST = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
  } catch {
    return new Date(dateStr).toLocaleString();
  }
};

// The browser's own calendar date (YYYY-MM-DD). toISOString() is the UTC date,
// which is already "tomorrow" every US evening.
const localYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tomorrowYmd = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localYmd(d); };

// "Eastern Time" for America/New_York; the IANA id if the browser can't name it.
const timeZoneLabel = (tz: string) => {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" as any })
      .formatToParts(new Date()).find(p => p.type === "timeZoneName");
    return part?.value || tz;
  } catch {
    return tz;
  }
};

// Server upload limit per request (multer upload.array("photos", 10)).
const PHOTO_UPLOAD_BATCH = 10;

/** Same hosts the server accepts for review links: google.<tld> (not the bare homepage), g.page, goo.gl, share.google. */
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

const stepLabels: Record<string, string> = {
  rating: "Rating",
  improvement: "Improvement feedback",
  referral: "Referral info",
  referral_feedback: "Referral feedback",
  describe: "Describe project",
  review: "Review step",
  bonus_reviews: "Bonus reviews",
  done: "Completed",
};

export default function GoogleReviewsPage() {
  const { toast } = useToast();
  const [tabParam, setTabParam] = useUrlParam("tab");
  const pageTab: "requests" | "profile-reviews" = tabParam === "profile-reviews" ? "profile-reviews" : "requests";
  const setPageTab = (v: "requests" | "profile-reviews") => setTabParam(v === "requests" ? null : v);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<number | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState<number | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [projectDescription, setProjectDescription] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");
  const [messageMode, setMessageMode] = useState<"description" | "personal">("description");
  const [attachedPhotos, setAttachedPhotos] = useState<{ url: string; originalName: string; size: number }[]>([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaPickerFolders, setMediaPickerFolders] = useState<{id: number; name: string}[]>([]);
  const [mediaPickerFolderId, setMediaPickerFolderId] = useState<number | null>(null);
  const [mediaPickerPhotos, setMediaPickerPhotos] = useState<{id: number; name: string; url: string; size: number}[]>([]);
  const [mediaPickerLoading, setMediaPickerLoading] = useState(false);
  const [mediaPickerSelected, setMediaPickerSelected] = useState<Set<number>>(new Set());
  const [emailTheme, setEmailTheme] = useState("navy-orange");
  const [bccEmail, setBccEmail] = useState("");
  const [bccInfoOpen, setBccInfoOpen] = useState(false);
  const [savedBccEmails, setSavedBccEmails] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("savedBccEmails") || "[]").slice(0, 3); } catch { return []; }
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const [templateName, setTemplateName] = useState("");
  const [templateGoogleUrl, setTemplateGoogleUrl] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateIsDefault, setTemplateIsDefault] = useState(false);

  const { data: reviews = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reviews/list"],
  });

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/review-templates"],
  });

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  // The allowance the server checks when a template is saved (allowances.reviewTemplates:
  // -1 unlimited, 0 not in the plan). null while it loads — the server still has the final say.
  const { data: entitlements } = useQuery<{ allowances: { reviewTemplates: number } | null }>({
    queryKey: ["/api/entitlements"],
    enabled: !!user,
  });
  const templateLimit: number | null = entitlements ? (entitlements.allowances?.reviewTemplates ?? 0) : null;
  const atTemplateLimit = templateLimit !== null && templateLimit >= 0 && templates.length >= templateLimit;
  const templateCount = templateLimit === null || templateLimit < 0 ? `${templates.length}` : `${templates.length}/${templateLimit}`;

  const filteredReviews = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return reviews;
    return reviews.filter((r: any) =>
      r.clientName?.toLowerCase().includes(q) ||
      r.clientEmail?.toLowerCase().includes(q) ||
      r.clientPhone?.toLowerCase().includes(q) ||
      r.clientAddress?.toLowerCase().includes(q)
    );
  }, [reviews, searchQuery]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (attachedPhotos.length + files.length > 30) {
      toast({ title: "Too many photos", description: "Maximum 30 photos per review request.", variant: "destructive" });
      return;
    }
    setUploadingPhotos(true);
    const all = Array.from(files);
    let uploaded = 0;
    try {
      // The server takes at most PHOTO_UPLOAD_BATCH files per request, so a
      // bigger selection goes up in consecutive batches.
      for (let i = 0; i < all.length; i += PHOTO_UPLOAD_BATCH) {
        const formData = new FormData();
        for (const file of all.slice(i, i + PHOTO_UPLOAD_BATCH)) {
          formData.append("photos", file);
        }
        const res = await fetch("/api/upload/review-photos", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        uploaded += data.photos.length;
        setAttachedPhotos(prev => [...prev, ...data.photos]);
      }
      toast({ title: "Photos uploaded", description: `${uploaded} photo${uploaded !== 1 ? "s" : ""} attached.` });
    } catch (err: any) {
      const detail = err?.message || "Could not upload photos.";
      toast({
        title: "Upload failed",
        description: uploaded > 0 ? `${uploaded} of ${all.length} photos attached. ${detail}` : detail,
        variant: "destructive",
      });
    } finally {
      setUploadingPhotos(false);
      e.target.value = "";
    }
  };

  const openMediaPicker = async () => {
    setShowMediaPicker(true);
    setMediaPickerFolderId(null);
    setMediaPickerPhotos([]);
    setMediaPickerSelected(new Set());
    setMediaPickerLoading(true);
    try {
      const res = await fetch("/api/media/folders", { credentials: "include" });
      if (res.ok) setMediaPickerFolders(await res.json());
    } catch {} finally { setMediaPickerLoading(false); }
  };

  const loadFolderPhotos = async (folderId: number) => {
    setMediaPickerFolderId(folderId);
    setMediaPickerLoading(true);
    setMediaPickerSelected(new Set());
    try {
      const res = await fetch(`/api/media/folders/${folderId}/photos`, { credentials: "include" });
      if (res.ok) setMediaPickerPhotos(await res.json());
    } catch {} finally { setMediaPickerLoading(false); }
  };

  const attachFromMediaLibrary = () => {
    const selectedPhotos = mediaPickerPhotos.filter(p => mediaPickerSelected.has(p.id));
    const remaining = 30 - attachedPhotos.length;
    const toAttach = selectedPhotos.slice(0, remaining).map(p => ({ url: p.url, originalName: p.name, size: p.size || 0 }));
    setAttachedPhotos(prev => [...prev, ...toAttach]);
    setShowMediaPicker(false);
    toast({ title: "Photos attached", description: `${toAttach.length} photo${toAttach.length !== 1 ? "s" : ""} from Media Library.` });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let scheduledFor: string | undefined;
      if (scheduleEnabled && scheduleDate && scheduleTime) {
        scheduledFor = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      }
      const res = await apiRequest("POST", "/api/reviews/create", {
        clientName,
        clientEmail,
        clientPhone: clientPhone || undefined,
        clientAddress: clientAddress || undefined,
        templateId: selectedTemplateId ? parseInt(selectedTemplateId) : undefined,
        projectDescription: messageMode === "description" ? (projectDescription || undefined) : undefined,
        personalMessage: messageMode === "personal" ? (personalMessage || undefined) : undefined,
        photos: attachedPhotos.map(p => ({ url: p.url, originalName: p.originalName })),
        emailTheme,
        bccEmail: bccEmail.trim() || undefined,
        scheduledFor,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (bccEmail.trim()) {
        const email = bccEmail.trim().toLowerCase();
        const updated = [email, ...savedBccEmails.filter(e => e !== email)].slice(0, 3);
        setSavedBccEmails(updated);
        localStorage.setItem("savedBccEmails", JSON.stringify(updated));
      }
      // A scheduled send is described in the browser's own time zone (the
      // server's message is formatted in the server's zone).
      const picked = scheduleEnabled && scheduleDate && scheduleTime ? new Date(`${scheduleDate}T${scheduleTime}`) : null;
      const scheduledAt = picked && /scheduled/i.test(data?.message || "") ? picked : null;
      toast({
        title: scheduledAt ? "Scheduled!" : "Review request sent!",
        description: scheduledAt
          ? `Review request will be sent ${scheduledAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
          : data?.message || `Feedback request emailed to ${clientEmail}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/list"] });
      setCreateOpen(false);
      setClientName("");
      setClientEmail("");
      setClientPhone("");
      setClientAddress("");
      setProjectDescription("");
      setPersonalMessage("");
      setMessageMode("description");
      setAttachedPhotos([]);
      setEmailTheme("navy-orange");
      setBccEmail("");
      setScheduleEnabled(false);
      setScheduleDate("");
      setScheduleTime("09:00");
    },
    onError: (err: any) => {
      toast({ title: "Failed to send", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/reviews/${id}/resend`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast(data?.alreadyResponded
        ? { title: "Email resent", description: data.message || "This customer already responded, so their answer is kept." }
        : { title: "Resent!", description: "Review request email sent again." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/list"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not resend", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/reviews/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Moved to Trash", description: "Review request moved to trash. It will be permanently deleted after 14 days." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/trash"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const trashQuery = useQuery<any[]>({
    queryKey: ["/api/reviews/trash"],
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/reviews/${id}/restore`);
    },
    onSuccess: () => {
      toast({ title: "Restored", description: "Review request restored from trash." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/trash"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not restore", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/reviews/${id}/permanent`);
    },
    onSuccess: () => {
      toast({ title: "Permanently Deleted", description: "Review request permanently removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/trash"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/review-templates", {
        name: templateName,
        googleProfileUrl: templateGoogleUrl,
        projectDescription: templateDescription || undefined,
        isDefault: templateIsDefault || templates.length === 0,
      });
      return res.json();
    },
    onSuccess: (template: any) => {
      toast({ title: "Profile saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      // Added from inside the send dialog: pick the new profile for this request.
      if (createOpen && template?.id) setSelectedTemplateId(String(template.id));
      setTemplateDialogOpen(false);
      resetTemplateForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/review-templates/${editingTemplate.id}`, {
        name: templateName,
        googleProfileUrl: templateGoogleUrl,
        projectDescription: templateDescription || undefined,
        isDefault: templateIsDefault,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      setTemplateDialogOpen(false);
      setEditingTemplate(null);
      resetTemplateForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/review-templates/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Profile deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete profile", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // Mirrors the server check (the server also resolves short links): only Google-hosted review links.
  const templateUrlInvalid = templateGoogleUrl.trim() !== "" && !looksLikeGoogleReviewLink(templateGoogleUrl);

  const resetTemplateForm = () => {
    setTemplateName("");
    setTemplateGoogleUrl("");
    setTemplateDescription("");
    setTemplateIsDefault(false);
  };

  const openEditTemplate = (template: any) => {
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateGoogleUrl(template.googleProfileUrl);
    setTemplateDescription(template.projectDescription || "");
    setTemplateIsDefault(template.isDefault);
    setTemplateDialogOpen(true);
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    resetTemplateForm();
    if (user?.googleProfileUrl) {
      setTemplateGoogleUrl(user.googleProfileUrl);
    }
    setTemplateDialogOpen(true);
  };

  const openSendDialog = () => {
    const defaultTemplate = templates.find((t: any) => t.isDefault);
    if (defaultTemplate) {
      setSelectedTemplateId(String(defaultTemplate.id));
    } else if (templates.length > 0) {
      setSelectedTemplateId(String(templates[0].id));
    }
    setCreateOpen(true);
  };

  const getStatusBadge = (review: any) => {
    if (review.googleLinkOpened) return <StatusPill tone="success" data-testid={`badge-status-${review.id}`}>Google link opened</StatusPill>;
    if (review.status === "positive_feedback") return <StatusPill tone="success" data-testid={`badge-status-${review.id}`}>Positive</StatusPill>;
    if (review.status === "negative_feedback") return <StatusPill tone="info" data-testid={`badge-status-${review.id}`}>Feedback</StatusPill>;
    // No response and unsubscribed: the card's own "Unsubscribed" badge says it all — never "Pending".
    if (review.unsubscribed) return null;
    if (review.status === "scheduled") return <StatusPill tone="warning" data-testid={`badge-status-${review.id}`}>Scheduled{review.scheduledFor ? ` · ${new Date(review.scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</StatusPill>;
    return <StatusPill tone="neutral" data-testid={`badge-status-${review.id}`}>Pending</StatusPill>;
  };

  const hasGoogleUrl = !!((user?.googleProfileUrl || templates.find((t: any) => String(t.id) === selectedTemplateId)?.googleProfileUrl));
  const canSend = !!(clientName && clientEmail && hasGoogleUrl);

  // Google look (owner, 2026-10-06): the page sits on a GoogleSurface; profile reviews read like Google's.
  return (
    <GoogleSurface page><AppPage className="before:hidden">
      <PageHeader
        title={<span data-testid="text-reviews-title">Google Reviews</span>}
        description={pageTab === "requests"
          ? "Ask every client for a Google review with one professional feedback flow."
          : "Read and reply to the reviews on your Google Business Profiles."}
        actions={pageTab === "requests" ? (
          <Button onClick={openSendDialog} data-testid="button-new-review-request">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />New review request
          </Button>
        ) : undefined}
      />

      <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as any)}>
        <AppTabsList>
          <TabsTrigger value="requests" data-testid="tab-review-requests">Review requests</TabsTrigger>
          <TabsTrigger value="profile-reviews" data-testid="tab-profile-reviews">Google profile reviews</TabsTrigger>
        </AppTabsList>

        <TabsContent value="requests" className="mt-5 sm:mt-6">
          <div className="space-y-5 sm:space-y-6">
            <StatGrid cols={4}>
              <Stat label="Total sent" testId="stat-total-sent" value={reviews.filter((r: any) => r.status !== "scheduled" && r.status !== "suppressed").length} />
              <Stat label="Google links opened" testId="stat-google-links-opened" tone="good" value={reviews.filter((r: any) => r.googleLinkOpened).length} />
              <Stat label="Positive feedback" testId="stat-positive" tone="good" value={reviews.filter((r: any) => r.feedbackRating >= 9).length} />
              <Stat label="Awaiting response" testId="stat-pending" value={reviews.filter((r: any) => r.status === "sent" && !r.unsubscribed).length} />
            </StatGrid>

            <Section title="Review requests">
              {!isLoading && reviews.length > 0 && (
                <div className="relative mb-4">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, email, phone or address…"
                    className="pl-9"
                    data-testid="input-search-reviews"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-clear-search"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                </div>
              ) : reviews.length === 0 ? (
                <EmptyState
                  icon={Star}
                  title="No review requests yet"
                  description="Send your first review request to start collecting Google reviews from your clients."
                  action={<Button onClick={openSendDialog} data-testid="button-first-review-request">New review request</Button>}
                />
              ) : filteredReviews.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">No results for &ldquo;{searchQuery}&rdquo;</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredReviews.map((review: any) => {
                    const isExpanded = expandedReviewId === review.id;
                    const hasPhotos = Array.isArray(review.photos) && review.photos.length > 0;
                    return (
                      <div
                        key={review.id}
                        className="overflow-hidden rounded-xl border"
                        data-testid={`card-review-request-${review.id}`}
                      >
                        <div
                          className="flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-muted/40"
                          onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                          data-testid={`button-expand-${review.id}`}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <User className="h-5 w-5" aria-hidden="true" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium" data-testid={`text-client-name-${review.id}`}>{review.clientName}</p>
                              {getStatusBadge(review)}
                              {review.feedbackRating && (
                                <Badge variant="outline" className="text-xs">
                                  <Star className="mr-0.5 h-3 w-3 text-amber-500" aria-hidden="true" />
                                  {review.feedbackRating}/10
                                </Badge>
                              )}
                              {review.status === "sent" && review.remindersSent > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  <Bell className="mr-0.5 h-3 w-3" aria-hidden="true" />
                                  {review.remindersSent} reminder{review.remindersSent > 1 ? "s" : ""}
                                </Badge>
                              )}
                              {review.unsubscribed && (
                                <Badge variant="outline" className="text-xs border-red-200 text-red-600 dark:border-red-800 dark:text-red-400">
                                  Unsubscribed
                                </Badge>
                              )}
                              {review.referralFeedback === "up" && (
                                <Badge variant="outline" className="text-xs">
                                  <ThumbsUp className="mr-0.5 h-3 w-3" aria-hidden="true" />Referral
                                </Badge>
                              )}
                              {review.referralFeedback === "down" && (
                                <Badge variant="outline" className="text-xs">
                                  <ThumbsDown className="mr-0.5 h-3 w-3" aria-hidden="true" />Referral
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span className="truncate">{review.clientEmail}</span>
                              {review.clientPhone && (
                                <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" aria-hidden="true" />{review.clientPhone}</span>
                              )}
                            </div>
                            {review.clientAddress && (
                              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />{review.clientAddress}</p>
                            )}
                            {review.projectDescription && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">{review.projectDescription}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => { e.stopPropagation(); window.open(`/review/${review.token}`, "_blank"); }}
                              title="Preview review page"
                              data-testid={`button-preview-${review.id}`}
                            >
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            {!review.unsubscribed && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => { e.stopPropagation(); resendMutation.mutate(review.id); }}
                                disabled={resendMutation.isPending}
                                title={review.feedbackRating != null ? "Resend email (this customer already responded)" : "Resend email"}
                                data-testid={`button-resend-${review.id}`}
                              >
                                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                            {confirmDeleteId === review.id ? (
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs font-semibold text-destructive hover:bg-destructive hover:text-white"
                                  onClick={() => { deleteMutation.mutate(review.id); setConfirmDeleteId(null); }}
                                  data-testid={`button-confirm-delete-${review.id}`}
                                >
                                  Delete
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => setConfirmDeleteId(null)}
                                  data-testid={`button-cancel-delete-${review.id}`}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(review.id); }}
                                title="Delete"
                                data-testid={`button-delete-${review.id}`}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t px-4 pb-4 pt-0" data-testid={`panel-tracking-${review.id}`}>
                            {(() => {
                              const reviewUrl = `${window.location.origin}/review/${review.token}`;
                              const emailBody = `Hi ${review.clientName?.split(" ")[0] || "there"},\n\nThanks again for choosing us! We'd really appreciate it if you could take a moment to share your experience using the link below:\n\n${reviewUrl}\n\nIt only takes a minute and means a lot to our small business.\n\nThank you!`;
                              const mailto = `mailto:${encodeURIComponent(review.clientEmail || "")}?subject=${encodeURIComponent("Quick favor — share your experience")}&body=${encodeURIComponent(emailBody)}`;
                              return (
                                <div className="mt-3 space-y-2 rounded-xl border bg-muted/30 p-3" data-testid={`panel-share-link-${review.id}`}>
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-muted-foreground">Personal review link</p>
                                    <span className="text-[10px] text-muted-foreground">Send manually if needed</span>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Input
                                      value={reviewUrl}
                                      readOnly
                                      onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLInputElement).select(); }}
                                      className="h-8 w-full min-w-0 bg-background text-xs font-mono sm:w-auto sm:flex-1"
                                      data-testid={`input-review-link-${review.id}`}
                                    />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(reviewUrl).then(
                                          () => toast({ title: "Link copied", description: "Personal review link is on your clipboard." }),
                                          () => toast({ title: "Copy failed", description: "Select the text manually and copy.", variant: "destructive" }),
                                        );
                                      }}
                                      data-testid={`button-copy-link-${review.id}`}
                                    >
                                      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Copy link
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(emailBody).then(
                                          () => toast({ title: "Email body copied", description: "Paste it into your email client." }),
                                          () => toast({ title: "Copy failed", variant: "destructive" }),
                                        );
                                      }}
                                      data-testid={`button-copy-email-body-${review.id}`}
                                    >
                                      <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Copy email
                                    </Button>
                                    {review.clientEmail && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 shrink-0"
                                        onClick={(e) => { e.stopPropagation(); window.location.href = mailto; }}
                                        title={`Open mail app addressed to ${review.clientEmail}`}
                                        data-testid={`button-open-mailto-${review.id}`}
                                      >
                                        <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Email
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              {(() => {
                                const emailWasOpened = review.emailOpened || review.linkClicked;
                                const emailOpenTime = review.emailOpenedAt || (review.linkClicked ? review.linkClickedAt : null);
                                return (
                                  <div className="flex items-center gap-2 rounded-lg border p-2.5">
                                    <span className={`h-2 w-2 shrink-0 rounded-full ${emailWasOpened ? "bg-emerald-500" : "bg-muted-foreground/30"}`} aria-hidden="true" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium">{emailWasOpened ? "Email opened" : "Not opened"}</p>
                                      {emailOpenTime && (
                                        <p className="truncate text-[10px] text-muted-foreground">{formatPST(emailOpenTime)}</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}

                              <div className="flex items-center gap-2 rounded-lg border p-2.5">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${review.linkClicked ? "bg-emerald-500" : "bg-muted-foreground/30"}`} aria-hidden="true" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium">{review.linkClicked ? "Link clicked" : "Not clicked"}</p>
                                  {review.linkClickedAt && (
                                    <p className="truncate text-[10px] text-muted-foreground">{formatPST(review.linkClickedAt)}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 rounded-lg border p-2.5">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${review.photosDownloaded ? "bg-emerald-500" : "bg-muted-foreground/30"}`} aria-hidden="true" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium">{!hasPhotos ? "No photos" : review.photosDownloaded ? "Photos downloaded" : "Not downloaded"}</p>
                                  {review.photosDownloadedAt && (
                                    <p className="truncate text-[10px] text-muted-foreground">{formatPST(review.photosDownloadedAt)}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 rounded-lg border p-2.5">
                                {review.reviewMethod === "ai" ? (
                                  <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                ) : review.reviewMethod === "own" ? (
                                  <PenLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                ) : (
                                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs font-medium">{review.reviewMethod === "ai" ? "AI generated" : review.reviewMethod === "own" ? "Wrote their own" : "No review yet"}</p>
                                </div>
                              </div>

                              {review.lastStep === "done" || review.lastStep === "bonus_reviews" ? (
                                // ConstructHUB can't see whether a review was actually posted on Google — only that the flow was finished.
                                <div className="flex items-center gap-2 rounded-lg border p-2.5" data-testid={`tile-flow-completed-${review.id}`}>
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium">Completed flow</p>
                                  </div>
                                </div>
                              ) : review.lastStep && !review.reviewSubmitted ? (
                                <div className="flex items-center gap-2 rounded-lg border p-2.5" data-testid={`tile-flow-bounced-${review.id}`}>
                                  <Target className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium">Bounced: {stepLabels[review.lastStep] || review.lastStep}</p>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            {(review.feedbackComments || review.feedbackCategories || (review.feedbackRating && review.feedbackRating < 9)) && (
                              <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                                <p className="mb-1 text-xs font-medium">Private feedback</p>
                                {review.feedbackCategories && Array.isArray(review.feedbackCategories) && review.feedbackCategories.length > 0 && (
                                  <div className="mb-1.5 flex flex-wrap gap-1">
                                    {review.feedbackCategories.map((cat: string) => (
                                      <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
                                    ))}
                                  </div>
                                )}
                                {review.feedbackComments && (
                                  <p className="text-xs text-muted-foreground">{review.feedbackComments}</p>
                                )}
                                {review.feedbackRating && review.feedbackRating < 9 && !review.feedbackComments && !(review.feedbackCategories && Array.isArray(review.feedbackCategories) && review.feedbackCategories.length > 0) && (
                                  <p className="text-xs italic text-muted-foreground">No written feedback provided</p>
                                )}
                              </div>
                            )}
                            {review.referralFeedback && (
                              <div className="mt-2 rounded-lg border bg-muted/30 p-3">
                                <p className="mb-1 text-xs font-medium">Referral response</p>
                                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {review.referralFeedback === "up" && <><ThumbsUp className="h-3 w-3" aria-hidden="true" />Would refer others</>}
                                  {review.referralFeedback === "down" && <><ThumbsDown className="h-3 w-3" aria-hidden="true" />Would not refer</>}
                                  {review.referralFeedback !== "up" && review.referralFeedback !== "down" && review.referralFeedback}
                                </p>
                              </div>
                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground">
                              <span>Sent: {formatPST(review.createdAt)}</span>
                              {review.remindersSent > 0 && review.lastReminderAt && (
                                <span>Last reminder: {formatPST(review.lastReminderAt)}</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section
              title={<span className="flex items-center gap-2">Google Business Profiles<Badge variant="outline" className="text-xs" data-testid="badge-template-count">{templateCount}</Badge></span>}
              description="One profile per Google Business listing — each gets its own review link."
              actions={<Button variant="outline" size="sm" onClick={openNewTemplate} disabled={atTemplateLimit} data-testid="button-new-template"><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add profile</Button>}
            >
              {templates.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No profiles yet"
                  description="Add a profile for each Google Business listing you manage, so review requests go to the right page."
                  action={<Button variant="outline" size="sm" onClick={openNewTemplate} data-testid="button-create-first-template"><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add your first profile</Button>}
                />
              ) : (
                <div className="space-y-2">
                  {templates.map((template: any) => (
                    <div
                      key={template.id}
                      className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/40"
                      data-testid={`card-template-${template.id}`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium" data-testid={`text-template-name-${template.id}`}>{template.name}</p>
                          {template.isDefault && <Badge className="text-[10px]" data-testid={`badge-template-default-${template.id}`}>Default</Badge>}
                        </div>
                        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <Link className="h-3 w-3 shrink-0" aria-hidden="true" />{template.googleProfileUrl}
                        </p>
                        {template.projectDescription && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{template.projectDescription}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditTemplate(template)}
                          title="Edit profile"
                          data-testid={`button-edit-template-${template.id}`}
                        >
                          <Edit className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {confirmDeleteTemplateId === template.id ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs font-semibold text-destructive hover:bg-destructive hover:text-white"
                              onClick={() => { deleteTemplateMutation.mutate(template.id); setConfirmDeleteTemplateId(null); }}
                              data-testid={`button-confirm-delete-template-${template.id}`}
                            >
                              Delete
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              onClick={() => setConfirmDeleteTemplateId(null)}
                              data-testid={`button-cancel-delete-template-${template.id}`}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmDeleteTemplateId(template.id)}
                            title="Delete profile"
                            data-testid={`button-delete-template-${template.id}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {atTemplateLimit && (
                    <p className="pt-2 text-center text-xs text-muted-foreground" data-testid="text-template-limit">
                      {/* The iPhone apps sell nothing (App Store 3.1.3(f)): no "included with every plan" / "See plans". */}
                      {inNativeApp()
                        ? (templateLimit === 0 ? "Saving profiles isn't on this account." : `Profile limit reached (${templateLimit}).`)
                        : templateLimit === 0
                          ? <>Saving profiles is included with every plan. <a href="/pricing" className="underline">See plans</a>.</>
                          : <>Profile limit reached ({templateLimit}). <a href="/pricing" className="underline">See plans</a> for more.</>}
                    </p>
                  )}
                </div>
              )}
            </Section>

            <ReminderSettingsCard />

            <Section
              title={<button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setShowHowItWorks(!showHowItWorks)} data-testid="button-toggle-how-it-works">
                <span>How review requests work</span>
                {showHowItWorks ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </button>}
            >
              {showHowItWorks && (
                <div className="space-y-5">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Happy clients forget to leave reviews; this makes it easy for every client to do it while the job is fresh. It asks everyone the same way — Google prohibits &ldquo;review gating&rdquo; (only sending happy customers to Google) and incentivized reviews, and profiles caught doing either can have reviews removed or be suspended.
                  </p>

                  <div>
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />The flow
                    </h4>
                    <div className="space-y-4">
                      {[
                        { n: "1", Icon: Filter, title: "A quick private rating (1–10)", body: "The client rates the project. The score comes only to you, so you can track satisfaction across jobs. It never decides whether they are allowed to review you." },
                        { n: "2", Icon: ExternalLink, title: "Every client is invited to Google", body: "Whatever the score, the client gets the same button to open your Google Business Profile and leave a review. Low scores are a signal to reach out and make it right, not a reason to hide the link." },
                        { n: "3", Icon: ShieldCheck, title: "Optional private improvement notes", body: "Anyone can also tell you privately what to improve — communication, timeliness, quality, cleanup. It's in addition to a public review, never instead of the option." },
                        { n: "4", Icon: Megaphone, title: "Your referral program, kept separate", body: "Clients can opt in to your referral program. Referral rewards are paid for referred customers only — never for leaving a review or for its star rating." },
                        { n: "5", Icon: Sparkles, title: "Optional writing help", body: "If a client wants help getting started, AI can draft a starting point from the highlights they type. They edit it into their own words and choose their own star rating — the review must reflect their real experience." },
                      ].map(({ n, Icon, title, body }) => (
                        <div key={n} className="flex gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">{n}</div>
                          <div className="pb-1">
                            <div className="mb-0.5 flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              <p className="text-sm font-medium">{title}</p>
                            </div>
                            <p className="text-sm text-muted-foreground">{body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <BadgeCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Why it works
                    </h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        { Icon: TrendingUp, title: "More reviews, steadily", body: "Automatic requests and reminders mean more of your satisfied clients actually follow through — review volume and recency both help your profile." },
                        { Icon: Heart, title: "Catch problems early", body: "A low private score alerts you to call the client while there's still time to fix the issue." },
                        { Icon: Megaphone, title: "Clients become promoters", body: "The opt-in referral program rewards clients who send you new customers." },
                        { Icon: ThumbsUp, title: "Reviews you can trust", body: "Reviews earned by asking everyone hold up to Google's filters and to homeowners reading them." },
                      ].map(({ Icon, title, body }) => (
                        <div key={title} className="flex items-start gap-3 rounded-xl border p-3">
                          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <div>
                            <p className="text-sm font-medium">{title}</p>
                            <p className="text-xs text-muted-foreground">{body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Notice tone="warning" title="Rules that protect your profile">
                    Ask every client, not just happy ones. Never offer discounts, gifts, drawings, or referral bonuses in exchange for a review. Never write a review for a client or tell them what rating to give. Breaking these can get reviews removed or your Business Profile suspended, and paying for positive reviews violates the FTC's consumer-review rule.
                  </Notice>
                </div>
              )}
            </Section>

            <Section title="Other review platforms" description="Quick links to manage your reviews elsewhere.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { name: "Yelp", url: "https://biz.yelp.com" },
                  { name: "BBB", url: "https://www.bbb.org/near-me" },
                  { name: "Angi", url: "https://www.angi.com/pro/login" },
                  { name: "GuildQuality", url: "https://www.guildquality.com/login" },
                  { name: "HomeAdvisor", url: "https://pro.homeadvisor.com" },
                  { name: "Houzz", url: "https://www.houzz.com/pro/login" },
                  { name: "Thumbtack", url: "https://pro.thumbtack.com" },
                  { name: "Facebook", url: "https://business.facebook.com" },
                ].map((platform) => (
                  <a
                    key={platform.name}
                    href={platform.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors hover:bg-muted/40"
                    data-testid={`link-platform-${platform.name.toLowerCase()}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{platform.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </a>
                ))}
              </div>
            </Section>

            {trashQuery.data && trashQuery.data.length > 0 && (
              <Section
                title={<span className="flex items-center gap-2">Trash<Badge variant="secondary" className="text-xs">{trashQuery.data.length}</Badge></span>}
                description="Auto-deletes after 14 days."
              >
                <button
                  className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowTrash(!showTrash)}
                  data-testid="button-toggle-trash"
                >
                  {showTrash ? "Hide" : "Show"} trashed requests
                  <ChevronDown className={`h-4 w-4 transition-transform ${showTrash ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {showTrash && (
                  <div className="space-y-2">
                    {trashQuery.data.map((item: any) => {
                      const daysLeft = Math.max(0, Math.ceil(14 - (Date.now() - new Date(item.deletedAt).getTime()) / (1000 * 60 * 60 * 24)));
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3" data-testid={`trash-item-${item.id}`}>
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{item.clientName}</p>
                              <p className="truncate text-xs text-muted-foreground">{item.clientEmail}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {item.feedbackRating ? `${item.feedbackRating}/10` : item.status}
                            </Badge>
                            <span className="shrink-0 text-[10px] text-muted-foreground">{daysLeft}d left</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                              onClick={() => restoreMutation.mutate(item.id)}
                              disabled={restoreMutation.isPending}
                              data-testid={`button-restore-${item.id}`}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />Restore
                            </Button>
                            {confirmPermanentDeleteId === item.id ? (
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs font-semibold text-destructive hover:bg-destructive hover:text-white"
                                  onClick={() => { permanentDeleteMutation.mutate(item.id); setConfirmPermanentDeleteId(null); }}
                                  data-testid={`button-confirm-perm-delete-${item.id}`}
                                >
                                  Delete forever
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => setConfirmPermanentDeleteId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => setConfirmPermanentDeleteId(item.id)}
                                title="Permanently delete"
                                data-testid={`button-perm-delete-${item.id}`}
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            )}
          </div>
        </TabsContent>

        <TabsContent value="profile-reviews" className="mt-5 sm:mt-6">
          <GoogleProfileReviewsTab />
        </TabsContent>
      </Tabs>

      {/* ── Send review request ─────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-testid="modal-send-review">
          <DialogHeader>
            <DialogTitle>Send review request</DialogTitle>
            <DialogDescription>
              Your client rates the experience and every client is invited to leave a Google review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Google Business Profile *</Label>
              {templates.length > 0 ? (
                <>
                  <Select value={selectedTemplateId} onValueChange={(val) => {
                    if (val === "__create__") {
                      // Opens on top of this dialog, so the request typed so far is kept.
                      openNewTemplate();
                    } else {
                      setSelectedTemplateId(val);
                    }
                  }}>
                    <SelectTrigger data-testid="select-gmb-profile">
                      <SelectValue placeholder="Select a Google Business Profile…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t: any) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} {t.isDefault ? "(Default)" : ""}
                        </SelectItem>
                      ))}
                      {!atTemplateLimit && (
                        <SelectItem value="__create__">
                          <span className="flex items-center gap-1 text-primary">
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />Add another profile…
                          </span>
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Reviews will be directed to this profile&rsquo;s Google review link.</p>
                </>
              ) : (
                <Notice tone="warning">
                  No Google Business Profiles set up yet.{" "}
                  <button type="button" onClick={openNewTemplate} className="font-medium text-primary hover:underline" data-testid="link-create-profile">
                    Add a Google Business Profile
                  </button>
                </Notice>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client name *</Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="John Smith"
                  data-testid="input-client-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientEmail">Client email *</Label>
                <Input
                  id="clientEmail"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="john@example.com"
                  data-testid="input-client-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientPhone">Phone</Label>
                <Input
                  id="clientPhone"
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  data-testid="input-client-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientAddress">Address</Label>
                <Input
                  id="clientAddress"
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                  data-testid="input-client-address"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="mb-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMessageMode("description")}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${messageMode === "description" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  data-testid="button-mode-description"
                >
                  <FileText className="mr-1 inline h-3 w-3" aria-hidden="true" />Project description
                </button>
                <button
                  type="button"
                  onClick={() => setMessageMode("personal")}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${messageMode === "personal" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                  data-testid="button-mode-personal"
                >
                  <MessageSquare className="mr-1 inline h-3 w-3" aria-hidden="true" />Personal message
                </button>
              </div>
              {messageMode === "description" ? (
                <>
                  <Textarea
                    id="projectDesc"
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                    placeholder="Brief description of the work done (e.g., Kitchen remodel, bathroom renovation, roof replacement...)"
                    rows={3}
                    data-testid="input-project-description"
                  />
                  <p className="text-xs text-muted-foreground">Used by AI to generate the review. Overrides the template description if provided.</p>
                </>
              ) : (
                <>
                  <Textarea
                    id="personalMsg"
                    value={personalMessage}
                    onChange={(e) => setPersonalMessage(e.target.value)}
                    placeholder="Write a personal note to your client (e.g., Hey Jennifer, it was great working on your kitchen! We'd love to hear how everything turned out...)"
                    rows={3}
                    data-testid="input-personal-message"
                  />
                  <p className="text-xs text-muted-foreground">Replaces the default email body with your own message. The feedback link is still included automatically.</p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label>Project photos (optional)</Label>
              <p className="text-xs text-muted-foreground">Attach up to 30 photos — clients can download them to include with their Google review.</p>
              <div className="flex flex-wrap gap-2">
                {attachedPhotos.map((photo, i) => (
                  <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg border">
                    <img src={photo.url} alt={photo.originalName} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setAttachedPhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      data-testid={`button-remove-photo-${i}`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <p className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 text-[9px] text-white">{photo.originalName}</p>
                  </div>
                ))}
                {attachedPhotos.length < 30 && (
                  <label
                    className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors hover:border-primary ${uploadingPhotos ? "pointer-events-none opacity-50" : ""}`}
                    data-testid="button-add-photos"
                  >
                    {uploadingPhotos ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <>
                        <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        <span className="mt-0.5 text-[10px] text-muted-foreground">Add</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={handlePhotoUpload}
                      className="hidden"
                      data-testid="input-photo-upload"
                    />
                  </label>
                )}
                {attachedPhotos.length < 30 && (
                  <button
                    type="button"
                    onClick={openMediaPicker}
                    className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors hover:border-primary"
                    data-testid="button-media-library-picker"
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="mt-0.5 text-center text-[9px] leading-tight text-muted-foreground">Media<br />Library</span>
                  </button>
                )}
              </div>
              {attachedPhotos.length > 0 && (
                <p className="text-xs text-muted-foreground">{attachedPhotos.length}/30 photos attached</p>
              )}
            </div>

            {showMediaPicker && (
              <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowMediaPicker(false)}>
                <div className="mx-4 max-h-[80vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border bg-background p-5 shadow-2xl" onClick={e => e.stopPropagation()} data-testid="modal-media-picker">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Media Library
                    </h3>
                    <button onClick={() => setShowMediaPicker(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {mediaPickerLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                    </div>
                  ) : !mediaPickerFolderId ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Select a folder to browse photos.</p>
                      {mediaPickerFolders.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground">
                          <FolderOpen className="mx-auto mb-2 h-8 w-8 opacity-30" aria-hidden="true" />
                          <p className="text-sm">No folders yet</p>
                          <p className="mt-1 text-xs">Process photos in the Photo Optimizer and save them to create folders.</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {mediaPickerFolders.map(f => (
                            <button
                              key={f.id}
                              onClick={() => loadFolderPhotos(f.id)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                              data-testid={`media-folder-${f.id}`}
                            >
                              <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              {f.name}
                              <ChevronDown className="ml-auto h-3 w-3 -rotate-90 text-muted-foreground" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button onClick={() => setMediaPickerFolderId(null)} className="flex items-center gap-1 text-xs text-primary hover:underline" data-testid="button-back-to-folders">
                        <ChevronDown className="h-3 w-3 rotate-90" aria-hidden="true" />Back to folders
                      </button>
                      {mediaPickerPhotos.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">This folder is empty.</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-4 gap-2">
                            {mediaPickerPhotos.map(p => (
                              <button
                                key={p.id}
                                onClick={() => setMediaPickerSelected(prev => {
                                  const next = new Set(prev);
                                  next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                                  return next;
                                })}
                                className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${mediaPickerSelected.has(p.id) ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"}`}
                                data-testid={`media-photo-${p.id}`}
                              >
                                <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
                                {mediaPickerSelected.has(p.id) && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-primary/20">
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                                    </div>
                                  </div>
                                )}
                                <p className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 text-[8px] text-white">{p.name}</p>
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <p className="text-xs text-muted-foreground">{mediaPickerSelected.size} selected</p>
                            <Button
                              size="sm"
                              onClick={attachFromMediaLibrary}
                              disabled={mediaPickerSelected.size === 0}
                              data-testid="button-attach-from-library"
                            >
                              Attach {mediaPickerSelected.size > 0 ? `${mediaPickerSelected.size} photo${mediaPickerSelected.size !== 1 ? "s" : ""}` : "selected"}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Collapsible>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-4 w-4" aria-hidden="true" />Email appearance and deliverability
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-5">
                <div className="space-y-2">
                  <Label>Email theme</Label>
                  <p className="text-xs text-muted-foreground">Choose a color scheme for the review request email your client receives.</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {([
                      { id: "navy-orange", label: "Navy & Orange", header: "#1a1a2e", accent: "#F97316" },
                      { id: "green-black", label: "Green & Black", header: "#0a0a0a", accent: "#22c55e" },
                      { id: "blue-white", label: "Blue & White", header: "#2563eb", accent: "#3b82f6" },
                      { id: "black-gold", label: "Black & Gold", header: "#0a0a0a", accent: "#eab308" },
                      { id: "red-white", label: "Red & White", header: "#dc2626", accent: "#ef4444" },
                      { id: "purple-white", label: "Purple & White", header: "#7c3aed", accent: "#8b5cf6" },
                      { id: "teal-white", label: "Teal & White", header: "#0d9488", accent: "#14b8a6" },
                      { id: "white-gray", label: "White & Gray", header: "#dee2e6", accent: "#374151" },
                      { id: "black-white", label: "Black & White", header: "#000000", accent: "#ffffff" },
                    ] as const).map(theme => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setEmailTheme(theme.id)}
                        className={`relative flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-all ${
                          emailTheme === theme.id
                            ? "border-foreground ring-1 ring-foreground/20"
                            : "border-border hover:border-foreground/30"
                        }`}
                        data-testid={`button-theme-${theme.id}`}
                      >
                        <div className="flex h-7 w-full flex-col overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                          <div className="flex-1" style={{ background: theme.header }} />
                          <div className="h-1.5" style={{ background: theme.accent }} />
                        </div>
                        <span className="text-center text-[9px] leading-tight text-muted-foreground">{theme.label}</span>
                        {emailTheme === theme.id && (
                          <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="relative flex items-center gap-1.5">
                    <Label htmlFor="bccEmail">BCC email</Label>
                    <div className="sm:relative">
                      {/* Above the click-away overlay while open, so clicking it again closes the explainer. */}
                      <button type="button" onClick={() => setBccInfoOpen(!bccInfoOpen)} aria-label="Why add a BCC email?" aria-expanded={bccInfoOpen} aria-controls="bcc-info-tooltip" className={`text-muted-foreground hover:text-foreground transition-colors ${bccInfoOpen ? "relative z-[301]" : ""}`} data-testid="icon-bcc-info">
                        <Info className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {bccInfoOpen && (
                        <>
                          <div className="fixed inset-0 z-[299]" onClick={() => setBccInfoOpen(false)} />
                          <div id="bcc-info-tooltip" className="absolute left-0 right-0 top-full mt-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg z-[300] sm:left-full sm:right-auto sm:top-0 sm:ml-2 sm:mt-0 sm:w-72" data-testid="tooltip-bcc-info">
                            <button type="button" onClick={() => setBccInfoOpen(false)} aria-label="Close" className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" aria-hidden="true" /></button>
                            <p className="mb-1.5 font-semibold">Why this matters for deliverability</p>
                            <p className="mb-1.5">Adding a BCC of your existing business email helps the review request avoid spam folders. Email providers like Gmail track sender-recipient relationships — if this client has already received emails from you, that trust carries over.</p>
                            <p className="mb-1.5"><strong>Use the same email you&rsquo;ve been communicating with this client through.</strong> If you used a CRM, use a well-established, trusted email address instead.</p>
                            <p className="text-muted-foreground">The client will never see this address — it simply helps email providers recognize this as a legitimate, expected message.</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <Input
                    id="bccEmail"
                    type="email"
                    value={bccEmail}
                    onChange={(e) => setBccEmail(e.target.value)}
                    placeholder="you@yourcompany.com"
                    data-testid="input-bcc-email"
                  />
                  {savedBccEmails.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {savedBccEmails.map((email) => (
                        <div
                          key={email}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${bccEmail === email ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                          data-testid={`chip-bcc-${email}`}
                        >
                          <button
                            type="button"
                            onClick={() => setBccEmail(bccEmail === email ? "" : email)}
                            className="max-w-[160px] truncate"
                            data-testid={`button-select-bcc-${email}`}
                          >
                            {email}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const updated = savedBccEmails.filter(x => x !== email);
                              setSavedBccEmails(updated);
                              localStorage.setItem("savedBccEmails", JSON.stringify(updated));
                              if (bccEmail === email) setBccEmail("");
                            }}
                            className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive"
                            data-testid={`button-remove-bcc-${email}`}
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {bccEmail.trim() && !savedBccEmails.includes(bccEmail.trim().toLowerCase()) && savedBccEmails.length < 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        const email = bccEmail.trim().toLowerCase();
                        const updated = [email, ...savedBccEmails].slice(0, 3);
                        setSavedBccEmails(updated);
                        localStorage.setItem("savedBccEmails", JSON.stringify(updated));
                      }}
                      className="mt-1 flex items-center gap-1 text-[11px] text-primary transition-colors hover:text-primary/80"
                      data-testid="button-save-bcc"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />Save this email for quick access
                    </button>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            <Notice tone="info">
              Every client — whatever their rating — is invited to leave a Google review; Google&rsquo;s policy prohibits asking only happy customers. They can also send you private improvement notes.
            </Notice>

            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2" data-testid="checkbox-schedule-toggle">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={e => setScheduleEnabled(e.target.checked)}
                />
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">Schedule for later</span>
              </label>

              {scheduleEnabled && (
                <div className="space-y-3 border-l-2 pl-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        min={localYmd(new Date())}
                        className="text-sm"
                        data-testid="input-schedule-date"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Time</Label>
                      <Input
                        type="time"
                        value={scheduleTime}
                        onChange={e => setScheduleTime(e.target.value)}
                        className="text-sm"
                        data-testid="input-schedule-time"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Tomorrow 9am", getDate: tomorrowYmd, time: "09:00" },
                      { label: "Tomorrow 3pm", getDate: tomorrowYmd, time: "15:00" },
                      { label: "Tomorrow 6pm", getDate: tomorrowYmd, time: "18:00" },
                    ].map(preset => (
                      <button
                        key={preset.label}
                        type="button"
                        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          scheduleDate === preset.getDate() && scheduleTime === preset.time
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                        onClick={() => { setScheduleDate(preset.getDate()); setScheduleTime(preset.time); }}
                        data-testid={`button-preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {scheduleDate && scheduleTime && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      Will be sent on {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              )}
            </div>

            {!hasGoogleUrl && !selectedTemplateId && clientName && clientEmail && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Select a Google Business Profile above to send requests.
              </p>
            )}

            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={!canSend || createMutation.isPending || (scheduleEnabled && (!scheduleDate || !scheduleTime))}
              data-testid="button-send-review-request"
            >
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{scheduleEnabled ? "Scheduling…" : "Sending…"}</>
              ) : scheduleEnabled ? (
                <><CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" />Schedule feedback request</>
              ) : (
                <><Send className="mr-2 h-4 w-4" aria-hidden="true" />Send feedback request</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add / edit Google Business Profile ──────────────────────────── */}
      <Dialog open={templateDialogOpen} onOpenChange={(open) => { setTemplateDialogOpen(open); if (!open) { setEditingTemplate(null); resetTemplateForm(); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="modal-template">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Google Business Profile" : "Add Google Business Profile"}</DialogTitle>
            <DialogDescription>
              Each profile links to a different Google Business listing. When you send a review request, just pick which profile it&rsquo;s for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tplName">Profile or location name *</Label>
              <Input
                id="tplName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., ABC Roofing - Dallas, Main Street Office"
                data-testid="input-template-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tplUrl">Google review link *</Label>
              <Input
                id="tplUrl"
                type="url"
                inputMode="url"
                value={templateGoogleUrl}
                onChange={(e) => setTemplateGoogleUrl(e.target.value)}
                placeholder="https://g.page/r/..."
                aria-invalid={templateUrlInvalid}
                aria-describedby={templateUrlInvalid ? "tplUrl-error" : undefined}
                data-testid="input-template-google-url"
              />
              {templateUrlInvalid && (
                <p id="tplUrl-error" className="text-xs text-destructive" data-testid="text-template-url-error">
                  Paste your Google review link (https://g.page/r/... or a Google Maps link).
                </p>
              )}
              <Notice tone="info">
                In your Google Business Profile, click <strong>&ldquo;Ask for reviews&rdquo;</strong> and copy the review link that looks like <span className="font-mono text-[10px]">https://g.page/r/xxxx/review</span>.
              </Notice>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tplDesc">Default project description</Label>
              <Textarea
                id="tplDesc"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="e.g., Full kitchen renovation including cabinets, countertops, backsplash, and flooring..."
                rows={3}
                data-testid="input-template-description"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tplDefault"
                checked={templateIsDefault}
                onChange={(e) => setTemplateIsDefault(e.target.checked)}
                data-testid="checkbox-template-default"
              />
              <Label htmlFor="tplDefault" className="cursor-pointer text-sm">Set as default profile</Label>
            </div>
            <Button
              className="w-full"
              onClick={() => editingTemplate ? updateTemplateMutation.mutate() : createTemplateMutation.mutate()}
              disabled={!templateName.trim() || !templateGoogleUrl.trim() || templateUrlInvalid || createTemplateMutation.isPending || updateTemplateMutation.isPending}
              data-testid="button-save-template"
            >
              {(createTemplateMutation.isPending || updateTemplateMutation.isPending) ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Saving…</>
              ) : (
                <>{editingTemplate ? "Save changes" : "Save profile"}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppPage></GoogleSurface>
  );
}

function GoogleProfileReviewsTab() {
  const f = useAgencyFilter();
  const [reviewOffset, setReviewOffset] = useState(0);
  const { data: gbp } = useQuery<any>({ queryKey: ["/api/gbp/status"] });
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  // The Locations page's "Reviews" pill arrives with ?location=<id>: start filtered to that business.
  const [locationParam] = useUrlParam("location");
  const [locationFilter, setLocationFilter] = useState(locationParam && /^\d+$/.test(locationParam) ? `loc-${locationParam}` : "all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [responseFilter, setResponseFilter] = useState("all");
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [noteEditId, setNoteEditId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [confirmDeleteReviewId, setConfirmDeleteReviewId] = useState<number | null>(null);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: [`/api/locations?${f.params}`],
  });

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/review-templates"],
  });

  const queryParams = new URLSearchParams(f.params);
  queryParams.set("paged","true");
  queryParams.set("offset",String(reviewOffset));
  if (locationFilter !== "all") queryParams.set("locationId", locationFilter);
  if (ratingFilter !== "all") queryParams.set("rating", ratingFilter);
  if (responseFilter !== "all") queryParams.set("response", responseFilter);
  if (searchQuery.trim()) queryParams.set("search", searchQuery.trim());
  const qs = queryParams.toString();

  const { data: reviewData, isLoading } = useQuery<any>({
    queryKey: ["/api/google-profile-reviews", qs],
    queryFn: async () => {
      const res = await fetch(`/api/google-profile-reviews${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, replyComment, action = "draft" }: { id: number; replyComment: string; action?: "draft" | "publish" | "delete" }) => {
      const res = await apiRequest(action === "delete" ? "DELETE" : "PATCH", `/api/google-profile-reviews/${id}/reply`, { replyComment, action });
      return res.json();
    },
    onSuccess: (_data, { replyComment, action = "draft" }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-profile-reviews"] });
      toast({
        title: action === "publish" ? "Reply published to Google"
          : action === "delete" ? "Reply deleted from Google"
          : replyComment.trim() ? "Draft saved in ConstructHUB" : "Draft discarded",
      });
      setReplyingToId(null);
      setReplyText("");
    },
    onError: (e: Error) => { queryClient.invalidateQueries({queryKey:["/api/gbp/status"]}); queryClient.invalidateQueries({queryKey:["/api/google-profile-reviews"]}); toast({title:"Reply failed",description:apiErrorMessage(e),variant:"destructive"}); },
  });

  const noteMutation = useMutation({
    mutationFn: async ({ id, internalNote }: { id: number; internalNote: string }) => {
      const res = await apiRequest("PATCH", `/api/google-profile-reviews/${id}/note`, { internalNote });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-profile-reviews"] });
      toast({ title: "Note saved" });
      setNoteEditId(null);
      setNoteText("");
    },
    onError: (err: any) => {
      toast({ title: "Could not save note", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/google-profile-reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-profile-reviews"] });
      toast({ title: "Review deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete review", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  const reviews:any[]=reviewData?.items??[];
  const totalReviews = reviewData?.total??0;
  const unanswered = reviewData?.unanswered??0;
  const avgRating = reviewData?.average??0;
  const ratingDistribution = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviewData?.distribution?.[5-star]??0,
    pct: totalReviews > 0 ? Math.round((reviewData?.distribution?.[5-star]??0) / totalReviews * 100) : 0,
  }));

  const clearFilters = () => {
    setSearchQuery("");
    setLocationFilter("all");
    setRatingFilter("all");
    setResponseFilter("all");
  };

  const activeFilters = (locationFilter !== "all" ? 1 : 0) + (ratingFilter !== "all" ? 1 : 0) + (responseFilter !== "all" ? 1 : 0);
  const hasFilters = searchQuery || activeFilters > 0;

  const allLocations = locations.map((l: any) => ({
    id: `loc-${l.id}`,
    name: l.businessName,
    type: l.categories?.join(", ") || "Business",
    detail: l.address || l.placeId || "",
  }));

  const filteredLocations = locationSearch
    ? allLocations.filter(l =>
        l.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
        l.detail.toLowerCase().includes(locationSearch.toLowerCase())
      )
    : allLocations;

  const selectedLocationName = locationFilter === "all"
    ? "All locations"
    : allLocations.find(l => l.id === locationFilter)?.name || "Unknown";

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`h-3.5 w-3.5 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} aria-hidden="true" />
      ))}
    </div>
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <GbpConnection />
      <AiReplySettings locations={locations} />

      <StatGrid cols={3}>
        <Stat label="Reviews" value={totalReviews} testId="stat-total-profile-reviews" hint="matching the filters below" />
        <Stat label="Unanswered" value={unanswered} testId="stat-unanswered" tone={unanswered > 0 ? "warn" : "default"} hint={unanswered > 0 ? "need a reply" : "all replied"} />
        <Stat label="Average rating" value={avgRating ? avgRating.toFixed(2) : "—"} testId="stat-avg-rating" hint="across matching reviews" />
      </StatGrid>

      <Section title="Rating breakdown">
        <div className="space-y-1.5">
          {ratingDistribution.map(({ star, count, pct }) => (
            <div key={star} className="flex items-center gap-2 text-xs">
              <span className="flex w-6 items-center gap-0.5 font-medium text-muted-foreground">
                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" aria-hidden="true" />{star}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="min-w-[70px] text-right text-muted-foreground">{pct}% ({count})</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Reviews"
        flush
        actions={<Pager offset={reviewOffset} total={totalReviews} onChange={setReviewOffset} />}
      >
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Toolbar
            search={{ value: searchQuery, onChange: setSearchQuery, placeholder: "Search reviews", testId: "input-search-profile-reviews" }}
            filters={<>
              <div className="relative sm:w-56">
                <button
                  onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
                  className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent/50"
                  data-testid="dropdown-location-filter"
                >
                  <span className="truncate">{selectedLocationName}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
                {locationDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-[49]" onClick={() => setLocationDropdownOpen(false)} />
                    <div className="absolute left-0 right-0 top-full z-[50] mt-1 max-h-72 overflow-hidden rounded-lg border bg-popover shadow-lg">
                      <div className="border-b p-2">
                        <Input
                          value={locationSearch}
                          onChange={(e) => setLocationSearch(e.target.value)}
                          placeholder="Search by name, address, place id or store code"
                          className="h-8 text-xs"
                          autoFocus
                          data-testid="input-location-search"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        <button
                          onClick={() => { setLocationFilter("all"); setLocationDropdownOpen(false); setLocationSearch(""); }}
                          className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${locationFilter === "all" ? "bg-accent" : ""}`}
                          data-testid="option-location-all"
                        >
                          All locations
                        </button>
                        {filteredLocations.map((loc) => (
                          <button
                            key={loc.id}
                            onClick={() => { setLocationFilter(loc.id); setLocationDropdownOpen(false); setLocationSearch(""); }}
                            className={`w-full border-t border-border/30 px-3 py-2.5 text-left transition-colors hover:bg-accent ${locationFilter === loc.id ? "bg-accent" : ""}`}
                            data-testid={`option-location-${loc.id}`}
                          >
                            <p className="truncate text-sm font-medium">{loc.name}</p>
                            <p className="text-xs text-muted-foreground">{loc.type}</p>
                            <p className="truncate text-xs text-muted-foreground/60">{loc.detail}</p>
                          </button>
                        ))}
                        {filteredLocations.length === 0 && (
                          <p className="py-4 text-center text-xs text-muted-foreground">No locations found</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <Select value={ratingFilter} onValueChange={setRatingFilter}>
                <SelectTrigger className="h-10 w-full sm:w-[130px]" data-testid="select-rating-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ratings</SelectItem>
                  <SelectItem value="5">5 stars</SelectItem>
                  <SelectItem value="4">4 stars</SelectItem>
                  <SelectItem value="3">3 stars</SelectItem>
                  <SelectItem value="2">2 stars</SelectItem>
                  <SelectItem value="1">1 star</SelectItem>
                </SelectContent>
              </Select>
              <Select value={responseFilter} onValueChange={setResponseFilter}>
                <SelectTrigger className="h-10 w-full sm:w-[140px]" data-testid="select-response-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="answered">Answered</SelectItem>
                  <SelectItem value="unanswered">Unanswered</SelectItem>
                </SelectContent>
              </Select>
            </>}
            activeFilters={activeFilters}
            actions={hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1" data-testid="button-clear-filters">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Clear filters
              </Button>
            ) : undefined}
          />
        </div>

        <div className="p-4 pt-3 sm:p-5 sm:pt-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : reviews.length === 0 ? (
            <EmptyState
              icon={Star}
              title="No Google profile reviews yet"
              description="Reviews from your Google Business Profiles appear here once synced. Connect your Google account, import a location, then choose Sync now."
            />
          ) : (
            <div className="-mt-2">
              {reviews.map((review: any) => {
                const isExpanded = expandedReviewId === review.id;
                const locationName = (() => {
                  if (review.locationId) {
                    const loc = locations.find((l: any) => l.id === review.locationId);
                    if (loc) return loc.businessName;
                  }
                  if (review.templateId) {
                    const tpl = templates.find((t: any) => t.id === review.templateId);
                    if (tpl) return tpl.name;
                  }
                  return null;
                })();
                const locationCategories = (() => {
                  if (review.locationId) {
                    const loc = locations.find((l: any) => l.id === review.locationId);
                    return loc?.categories?.join(", ") || "";
                  }
                  return "";
                })();

                const reviewDate = new Date(review.reviewDate);
                const absoluteDate = `${reviewDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${reviewDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
                const canPublish = !!(gbp?.connected && review.googleReviewId);
                return (
                  <article key={review.id} className="g-review" data-testid={`card-profile-review-${review.id}`}>
                    {locationName && (
                      <p className="g-card__meta mb-2 flex min-w-0 items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate g-text">{locationName}</span>
                        {locationCategories && <><span aria-hidden="true">·</span><span className="truncate">{locationCategories}</span></>}
                      </p>
                    )}

                    <div className="g-review__head">
                      <GoogleAvatar src={review.reviewerPhotoUrl} initial={review.reviewerName?.charAt(0)?.toUpperCase() || "?"} alt="" />
                      <div className="min-w-0 flex-1">
                        <p className="g-review__name" data-testid={`text-reviewer-name-${review.id}`}>{review.reviewerName}</p>
                        {!review.googleReviewId && <p className="g-review__sub">Manually entered record — not synced from Google.</p>}
                      </div>
                    </div>
                    <div className="g-review__rating">
                      <GoogleStarRow rating={review.rating} />
                      <span title={absoluteDate}>{relativeTime(review.reviewDate) || absoluteDate}</span>
                    </div>
                    {review.comment && (
                      <p className="g-review__text" data-testid={`text-review-comment-${review.id}`}>
                        {isExpanded ? review.comment : review.comment.length > 200 ? review.comment.slice(0, 200) + "..." : review.comment}
                      </p>
                    )}
                    {review.comment?.length > 200 && (
                      <button
                        onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                        className="g-link mt-1 text-sm"
                        data-testid={`button-expand-review-${review.id}`}
                      >
                        {isExpanded ? "Show less" : "Read more"}
                      </button>
                    )}

                    {review.internalNote && noteEditId !== review.id && (
                      <div className="mt-2 rounded-lg border-l-2 border-amber-400 bg-muted/40 p-2 text-xs">
                        <span className="mb-0.5 flex items-center gap-1 font-medium text-muted-foreground">
                          <StickyNote className="h-3 w-3" aria-hidden="true" />Internal note
                        </span>
                        <span className="text-muted-foreground">{review.internalNote}</span>
                      </div>
                    )}

                    {noteEditId === review.id && (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="Add an internal note (only visible to you)..."
                          className="min-h-[60px] text-sm"
                          data-testid={`input-note-${review.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => noteMutation.mutate({ id: review.id, internalNote: noteText })}
                            disabled={noteMutation.isPending}
                            data-testid={`button-save-note-${review.id}`}
                          >
                            {noteMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                            Save note
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setNoteEditId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    <div className="g-review__actions">
                      {!review.replyComment && (
                        <GooglePill
                          icon={MessageSquare}
                          label="Reply"
                          onClick={() => { setReplyingToId(review.id); setReplyText(review.replyDraft || ""); }}
                          title="Reply"
                          testId={`button-reply-${review.id}`}
                        />
                      )}
                      <GooglePill
                        icon={StickyNote}
                        label={review.internalNote ? "Edit note" : "Add internal note"}
                        onClick={() => { setNoteEditId(review.id); setNoteText(review.internalNote || ""); }}
                        testId={`button-add-note-${review.id}`}
                      />
                      {confirmDeleteReviewId === review.id ? (
                        <>
                          <GooglePill
                            icon={Trash2}
                            variant="danger"
                            label="Delete"
                            onClick={() => { deleteMutation.mutate(review.id); setConfirmDeleteReviewId(null); }}
                            testId={`button-confirm-delete-review-${review.id}`}
                          />
                          <GooglePill
                            label="Cancel"
                            className="g-text-2"
                            onClick={() => setConfirmDeleteReviewId(null)}
                            testId={`button-cancel-delete-review-${review.id}`}
                          />
                        </>
                      ) : (
                        <GooglePill
                          icon={Trash2}
                          label="Delete"
                          className="g-text-2"
                          onClick={() => setConfirmDeleteReviewId(review.id)}
                          title={review.googleReviewId ? "Remove local copy (returns on sync)" : "Delete local record"}
                          testId={`button-delete-review-${review.id}`}
                        />
                      )}
                    </div>

                    {replyingToId === review.id && !review.replyComment && (
                      <div className="mt-3 space-y-2 border-l-2 pl-4 sm:ml-11">
                        <Label className="text-xs font-medium">Reply to this review:</Label>
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write your reply..."
                          className="min-h-[80px] text-sm"
                          data-testid={`input-reply-${review.id}`}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => replyMutation.mutate({ id: review.id, replyComment: replyText, action: canPublish ? "publish" : "draft" })}
                            disabled={!replyText.trim() || replyMutation.isPending}
                            data-testid={`button-submit-reply-${review.id}`}
                          >
                            {replyMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <Send className="mr-1 h-3 w-3" aria-hidden="true" />}
                            {canPublish ? "Publish reply to Google" : "Save draft in ConstructHUB"}
                          </Button>
                          {canPublish && <Button size="sm" variant="outline" disabled={replyMutation.isPending} onClick={() => replyMutation.mutate({id:review.id,replyComment:replyText})}>Save draft</Button>}
                          <Button size="sm" variant="ghost" onClick={() => setReplyingToId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    <GoogleReport type="reviews" id={review.id} />
                    {review.replyDraft && (
                      /* The AI (or hand-saved) reply draft: Google's "AI Overview" shape for our own suggestion. */
                      <GoogleAiOverview
                        label="AI reply suggestion"
                        testId={`reply-draft-${review.id}`}
                        footnote="Draft saved in ConstructHUB — nothing is posted until you publish it."
                        actions={<>
                          {!review.replyComment && (
                            <GooglePill
                              icon={Send}
                              label={canPublish ? "Use this reply" : "Edit draft"}
                              onClick={() => { setReplyingToId(review.id); setReplyText(review.replyDraft || ""); }}
                              testId={`button-use-draft-${review.id}`}
                            />
                          )}
                          <GooglePill
                            label="Discard draft"
                            className="g-text-2"
                            disabled={replyMutation.isPending}
                            onClick={() => replyMutation.mutate({ id: review.id, replyComment: "", action: "draft" })}
                            testId={`button-discard-draft-${review.id}`}
                          />
                        </>}
                      >
                        <p className="break-words">{review.replyDraft}</p>
                      </GoogleAiOverview>
                    )}
                    {review.replyError && <p role="alert" className="mt-2 text-sm text-destructive">{review.replyError}</p>}
                    {review.replyComment && (
                      <div className="g-review__reply">
                        <div className="g-review__reply-head">
                          <b>Response from the owner</b>
                          <span>{review.replyStatus === "posted" ? "Posted on Google" : "Local draft (not posted)"}</span>
                          {review.replyDate && <span title={`${new Date(review.replyDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${new Date(review.replyDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}>{relativeTime(review.replyDate)}</span>}
                          <button
                            type="button"
                            className="g-link ml-auto inline-flex items-center gap-1 text-xs"
                            onClick={() => replyMutation.mutate({ id: review.id, replyComment: "", action: "delete" })}
                            title="Delete reply"
                            data-testid={`button-delete-reply-${review.id}`}
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" /> Delete reply
                          </button>
                        </div>
                        <p className="mt-1 text-sm leading-relaxed">{review.replyComment}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <AgencyWorkspace compact />
    </div>
  );
}

function ReminderSettingsCard() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/review-reminder-settings"],
  });

  const [localSettings, setLocalSettings] = useState<any>(null);
  const currentSettings = localSettings || settings || {
    enabled: true,
    maxReminders: 3,
    intervalHours: 48,
    timeWindows: [{ start: 9, end: 12 }, { start: 15, end: 18 }, { start: 18, end: 21 }],
    timezone: "America/New_York",
  };

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", "/api/review-reminder-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-reminder-settings"] });
      toast({ title: "Reminder settings saved" });
    },
    onError: (err: any) => {
      // 400 bodies carry zod's flatten(): { errors: { fieldErrors: { timeWindows: ["Window end must follow its start"] } } }
      let detail = apiErrorMessage(err);
      try {
        const body = JSON.parse(String(err?.message ?? "").replace(/^\d{3}:\s*/, ""));
        const fieldErrors = body?.errors?.fieldErrors ?? {};
        const first = Object.values(fieldErrors).flat().find((m): m is string => typeof m === "string");
        if (first) detail = first;
      } catch { /* not JSON — keep apiErrorMessage */ }
      toast({ title: "Failed to save settings", description: detail, variant: "destructive" });
    },
  });

  function updateField(field: string, value: any) {
    const updated = { ...currentSettings, [field]: value };
    setLocalSettings(updated);
  }

  function updateTimeWindow(index: number, field: "start" | "end", value: number) {
    const windows = [...(currentSettings.timeWindows || [])];
    windows[index] = { ...windows[index], [field]: value };
    // A window must end after it starts — moving the start past the end pushes the end along.
    if (field === "start" && windows[index].end <= value) windows[index] = { ...windows[index], end: value + 1 };
    setLocalSettings({ ...currentSettings, timeWindows: windows });
  }

  const formatHour = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hr}:00 ${ampm}`;
  };

  const reminderLabels = ["1st reminder", "2nd reminder", "3rd reminder"];

  return (
    <Section
      testId="card-reminder-settings"
      title="Follow-up reminders"
      description={expanded ? undefined : "Automatically remind clients who haven&rsquo;t responded."}
      actions={<>
        <StatusPill tone={currentSettings.enabled ? "success" : "neutral"} data-testid="badge-reminder-status">
          {currentSettings.enabled ? "Active" : "Disabled"}
        </StatusPill>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Close" : "Manage"}
          {expanded ? <ChevronUp className="ml-1 h-4 w-4" aria-hidden="true" /> : <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />}
        </Button>
      </>}
    >
      {expanded && (
        <div className="space-y-5 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Automatic reminders</Label>
              <p className="text-sm text-muted-foreground">Send follow-up emails to clients who haven&rsquo;t responded.</p>
            </div>
            <Switch
              checked={currentSettings.enabled}
              onCheckedChange={v => updateField("enabled", v)}
              data-testid="switch-reminders-enabled"
            />
          </div>

          {currentSettings.enabled && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Interval between reminders
                  </Label>
                  <Select
                    value={String(currentSettings.intervalHours)}
                    onValueChange={v => updateField("intervalHours", parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">Every 24 hours</SelectItem>
                      <SelectItem value="48">Every 48 hours</SelectItem>
                      <SelectItem value="72">Every 72 hours</SelectItem>
                      <SelectItem value="96">Every 4 days</SelectItem>
                      <SelectItem value="168">Every 7 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Max reminders per client
                  </Label>
                  <Select
                    value={String(currentSettings.maxReminders)}
                    onValueChange={v => updateField("maxReminders", parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-max-reminders">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 reminder</SelectItem>
                      <SelectItem value="2">2 reminders</SelectItem>
                      <SelectItem value="3">3 reminders</SelectItem>
                      <SelectItem value="5">5 reminders</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Delivery windows ({timeZoneLabel(currentSettings.timezone || "America/New_York")})
                </Label>
                <p className="text-sm text-muted-foreground">
                  Each reminder is sent during a different window; times rotate through the windows below.
                </p>

                <div className="grid gap-3">
                  {(currentSettings.timeWindows || []).slice(0, currentSettings.maxReminders).map((window: any, i: number) => (
                    <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
                      <Badge variant="outline" className="min-w-[100px] shrink-0 justify-center text-xs">
                        {reminderLabels[i] || `Reminder ${i + 1}`}
                      </Badge>
                      <Select
                        value={String(window.start)}
                        onValueChange={v => updateTimeWindow(i, "start", parseInt(v))}
                      >
                        <SelectTrigger className="w-full sm:w-[130px]" data-testid={`select-window-start-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 15 }, (_, h) => h + 6).map(h => (
                            <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">to</span>
                      <Select
                        value={String(window.end)}
                        onValueChange={v => updateTimeWindow(i, "end", parseInt(v))}
                      >
                        <SelectTrigger className="w-full sm:w-[130px]" data-testid={`select-window-end-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 15 }, (_, h) => h + 7).filter(h => h > window.start || h === window.end).map(h => (
                            <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <Notice tone="info" title="How it works">
                Reminders are scheduled automatically when you send a request, and stop when the client responds, unsubscribes, or the max count is reached. Every reminder includes an unsubscribe link.
              </Notice>
            </>
          )}

          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate(currentSettings)}
              disabled={saveMutation.isPending}
              data-testid="button-save-reminder-settings"
            >
              {saveMutation.isPending ? "Saving…" : "Save reminder settings"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
