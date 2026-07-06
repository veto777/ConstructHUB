import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Star, Send, Plus, Trash2, RefreshCw, Loader2, ExternalLink,
  Camera, Mail, User, Building2, Link, FileText, CheckCircle2,
  XCircle, Clock, MessageSquare, Eye, ShieldCheck, TrendingUp,
  ThumbsUp, ThumbsDown, DollarSign, Sparkles, Filter, Heart, Target,
  ArrowRight, Megaphone, BadgeCheck, AlertTriangle, ChevronDown, ChevronUp,
  Settings, Edit, Copy, X, Info, Bell, Timer, Upload, ImagePlus,
  Phone, MapPin, Search, Download, Bot, PenLine, MousePointerClick,
  CalendarDays, StickyNote, BarChart3, FolderOpen
} from "lucide-react";

const formatPST = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " PST";
  } catch {
    return new Date(dateStr).toLocaleString();
  }
};

const stepLabels: Record<string, string> = {
  rating: "Rating",
  improvement: "Improvement Feedback",
  referral: "Referral Info",
  referral_feedback: "Referral Feedback",
  describe: "Describe Project",
  review: "Review Step",
  bonus_reviews: "Bonus Reviews",
  done: "Completed",
};

function FloatingParticles({ color = "#f59e0b" }: { color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles: { x: number; y: number; size: number; speedX: number; speedY: number; opacity: number; rotation: number; rotSpeed: number }[] = [];
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 6 + 2,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: Math.random() * 0.3 + 0.1,
        opacity: Math.random() * 0.15 + 0.04,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 1.5,
      });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;
        if (p.y > canvas.height + 10) { p.y = -10; p.x = Math.random() * canvas.width; }
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [color]);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
}

export default function GoogleReviewsPage() {
  const { toast } = useToast();
  const [pageTab, setPageTab] = useState<"requests" | "profile-reviews">("requests");
  const [createOpen, setCreateOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(true);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
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

  const { data: subscription } = useQuery<any>({
    queryKey: ["/api/stripe/subscription"],
  });

  const planLimits: Record<string, number> = {
    free: 1, standard: 1, professional: 5, business: 5, premium: 20, gold: 20, platinum: 20
  };
  const currentPlan = subscription?.plan || "free";
  const maxTemplates = planLimits[currentPlan] || 1;

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
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("photos", file);
      }
      const res = await fetch("/api/upload/review-photos", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setAttachedPhotos(prev => [...prev, ...data.photos]);
      toast({ title: "Photos uploaded", description: `${data.photos.length} photo${data.photos.length > 1 ? "s" : ""} attached.` });
    } catch {
      toast({ title: "Upload failed", description: "Could not upload photos. Try again.", variant: "destructive" });
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
      toast({
        title: scheduleEnabled ? "Scheduled!" : "Review request sent!",
        description: data?.message || `Feedback request emailed to ${clientEmail}`,
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
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/reviews/${id}/resend`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Resent!", description: "Review request email sent again." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/list"] });
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
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/reviews/${id}/permanent`);
    },
    onSuccess: () => {
      toast({ title: "Permanently Deleted", description: "Review request permanently removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/reviews/trash"] });
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
    onSuccess: () => {
      toast({ title: "Template saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      setTemplateDialogOpen(false);
      resetTemplateForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
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
      toast({ title: "Template updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
      setTemplateDialogOpen(false);
      setEditingTemplate(null);
      resetTemplateForm();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update template", description: err.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/review-templates/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Template deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/review-templates"] });
    },
  });

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
    if (review.reviewSubmitted) return <Badge className="bg-green-600 text-white" data-testid={`badge-status-${review.id}`}><CheckCircle2 className="w-3 h-3 mr-1" />Reviewed</Badge>;
    if (review.status === "positive_feedback") return <Badge className="bg-blue-600 text-white" data-testid={`badge-status-${review.id}`}><Star className="w-3 h-3 mr-1" />Positive</Badge>;
    if (review.status === "negative_feedback") return <Badge variant="secondary" data-testid={`badge-status-${review.id}`}><MessageSquare className="w-3 h-3 mr-1" />Feedback</Badge>;
    if (review.status === "scheduled") return <Badge className="bg-amber-500/80 text-white" data-testid={`badge-status-${review.id}`}><CalendarDays className="w-3 h-3 mr-1" />Scheduled{review.scheduledFor ? ` · ${new Date(review.scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</Badge>;
    return <Badge variant="outline" data-testid={`badge-status-${review.id}`}><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  };

  const hasProfileSetup = user?.companyName && user?.googleProfileUrl;
  const selectedTemplate = templates.find((t: any) => String(t.id) === selectedTemplateId);
  const hasGoogleUrl = !!(user?.googleProfileUrl || selectedTemplate?.googleProfileUrl);
  const canSend = !!(clientName && clientEmail && hasGoogleUrl);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 relative">
      <FloatingParticles color="#f59e0b" />
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <Star className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-reviews-title">Google Reviews</h1>
            <p className="text-sm text-muted-foreground">
              {pageTab === "requests" ? "Request reviews from clients with a professional feedback-gated system" : "Monitor and manage your Google Business Profile reviews"}
            </p>
          </div>
        </div>
        {pageTab === "requests" && (
          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={openSendDialog} data-testid="button-new-review-request">
            <Plus className="w-4 h-4 mr-2" />
            New Review Request
          </Button>
        )}
      </div>

      <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as any)} className="relative z-10">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="requests" className="flex-1 gap-1.5" data-testid="tab-review-requests">
            <Send className="w-3.5 h-3.5" />
            Review Requests
          </TabsTrigger>
          <TabsTrigger value="profile-reviews" className="flex-1 gap-1.5" data-testid="tab-profile-reviews">
            <Star className="w-3.5 h-3.5" />
            Google Profile Reviews
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {pageTab === "requests" && (<div className="contents">

      {createOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" data-testid="modal-send-review">
          <div className="fixed inset-0 bg-black/80" onClick={() => setCreateOpen(false)} />
          <div className="relative z-[101] bg-background border rounded-lg shadow-lg w-[95vw] sm:max-w-xl max-h-[85vh] overflow-y-auto p-6">
            <button
              onClick={() => setCreateOpen(false)}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
              data-testid="button-close-send-dialog"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col space-y-1.5 mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Send className="w-5 h-5 text-amber-500" />
                Send Review Request
              </h2>
              <p className="text-sm text-muted-foreground">
                Send a feedback request to your client. They'll rate their experience, and happy clients will be guided to leave a Google review.
              </p>
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <Label><Building2 className="w-3.5 h-3.5 inline mr-1" />Google Business Profile *</Label>
                {templates.length > 0 ? (
                  <>
                    <Select value={selectedTemplateId} onValueChange={(val) => {
                      if (val === "__create__") {
                        window.location.href = "/settings";
                      } else {
                        setSelectedTemplateId(val);
                      }
                    }}>
                      <SelectTrigger data-testid="select-gmb-profile">
                        <SelectValue placeholder="Select a Google Business Profile..." />
                      </SelectTrigger>
                      <SelectContent className="z-[200]">
                        {templates.map((t: any) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name} {t.isDefault ? "(Default)" : ""}
                          </SelectItem>
                        ))}
                        <SelectItem value="__create__">
                          <span className="flex items-center gap-1 text-primary">
                            <Plus className="w-3.5 h-3.5" /> Add another profile...
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Reviews will be directed to this profile's Google review link</p>
                  </>
                ) : (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300/50 dark:border-amber-700/50 rounded-lg p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      No Google Business Profiles set up yet.
                    </p>
                    <a href="/settings" className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-primary hover:underline" data-testid="link-create-profile">
                      <Plus className="w-3.5 h-3.5" /> Create one in Settings
                    </a>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clientName"><User className="w-3.5 h-3.5 inline mr-1" />Client Name *</Label>
                  <Input
                    id="clientName"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="John Smith"
                    data-testid="input-client-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="clientEmail"><Mail className="w-3.5 h-3.5 inline mr-1" />Client Email *</Label>
                  <Input
                    id="clientEmail"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="john@example.com"
                    data-testid="input-client-email"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="clientPhone"><Phone className="w-3.5 h-3.5 inline mr-1" />Phone Number</Label>
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
                  <Label htmlFor="clientAddress"><MapPin className="w-3.5 h-3.5 inline mr-1" />Address</Label>
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
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="bccEmail"><Mail className="w-3.5 h-3.5 inline mr-1" />BCC Email</Label>
                  <div className="relative">
                    <button type="button" onClick={() => setBccInfoOpen(!bccInfoOpen)} className="text-amber-500 hover:text-amber-600 transition-colors" data-testid="icon-bcc-info">
                      <Info className="w-3.5 h-3.5" />
                    </button>
                    {bccInfoOpen && (
                      <>
                        <div className="fixed inset-0 z-[299]" onClick={() => setBccInfoOpen(false)} />
                        <div className="absolute top-0 left-full ml-2 w-72 p-3 rounded-lg bg-popover border border-border shadow-lg text-xs text-popover-foreground z-[300]" data-testid="tooltip-bcc-info">
                          <button type="button" onClick={() => setBccInfoOpen(false)} className="absolute top-1.5 right-1.5 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>
                          <p className="font-semibold text-amber-500 mb-1.5">Why this is critical for deliverability</p>
                          <p className="mb-1.5">Adding a BCC of your existing business email helps the review request avoid spam folders. Email providers like Gmail track sender-recipient relationships — if this client has already received emails from you, that trust carries over.</p>
                          <p className="mb-1.5"><strong>Use the same email you've been communicating with this client through.</strong> If you used a CRM, use a well-established, trusted email address instead.</p>
                          <p className="text-muted-foreground">The client will never see this address — it's completely hidden. It simply helps email providers recognize this as a legitimate, expected message.</p>
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
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {savedBccEmails.map((email) => (
                      <div
                        key={email}
                        className={`flex items-center gap-1 text-[11px] rounded-full border px-2.5 py-1 transition-colors cursor-pointer ${bccEmail === email ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/50 border-border hover:bg-muted text-muted-foreground hover:text-foreground"}`}
                        data-testid={`chip-bcc-${email}`}
                      >
                        <button
                          type="button"
                          onClick={() => setBccEmail(bccEmail === email ? "" : email)}
                          className="truncate max-w-[160px]"
                          data-testid={`button-select-bcc-${email}`}
                        >
                          {email}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = savedBccEmails.filter(e => e !== email);
                            setSavedBccEmails(updated);
                            localStorage.setItem("savedBccEmails", JSON.stringify(updated));
                            if (bccEmail === email) setBccEmail("");
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                          data-testid={`button-remove-bcc-${email}`}
                        >
                          <X className="w-3 h-3" />
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
                    className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors mt-1"
                    data-testid="button-save-bcc"
                  >
                    <Plus className="w-3 h-3" />
                    Save this email for quick access
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <button
                    type="button"
                    onClick={() => setMessageMode("description")}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${messageMode === "description" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    data-testid="button-mode-description"
                  >
                    <FileText className="w-3 h-3 inline mr-1" />Project Description
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageMode("personal")}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${messageMode === "personal" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                    data-testid="button-mode-personal"
                  >
                    <MessageSquare className="w-3 h-3 inline mr-1" />Personal Message
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
                <Label><Camera className="w-3.5 h-3.5 inline mr-1" />Project Photos (optional)</Label>
                <p className="text-xs text-muted-foreground">Attach up to 30 project photos. Clients can download these to include with their Google review. All photo metadata is preserved.</p>
                <div className="flex flex-wrap gap-2">
                  {attachedPhotos.map((photo, i) => (
                    <div key={i} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-border">
                      <img src={photo.url} alt={photo.originalName} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setAttachedPhotos(prev => prev.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-remove-photo-${i}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate">{photo.originalName}</p>
                    </div>
                  ))}
                  {attachedPhotos.length < 30 && (
                    <label
                      className={`w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-amber-400 dark:hover:border-amber-500 transition-colors flex flex-col items-center justify-center cursor-pointer ${uploadingPhotos ? "pointer-events-none opacity-50" : ""}`}
                      data-testid="button-add-photos"
                    >
                      {uploadingPhotos ? (
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      ) : (
                        <>
                          <ImagePlus className="w-5 h-5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
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
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-amber-300 dark:border-amber-600 hover:border-amber-400 dark:hover:border-amber-500 transition-colors flex flex-col items-center justify-center"
                      data-testid="button-media-library-picker"
                    >
                      <FolderOpen className="w-4 h-4 text-amber-500" />
                      <span className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5 leading-tight text-center">Media<br/>Library</span>
                    </button>
                  )}
                </div>
                {attachedPhotos.length > 0 && (
                  <p className="text-xs text-muted-foreground">{attachedPhotos.length}/30 photos attached</p>
                )}
              </div>

              {showMediaPicker && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setShowMediaPicker(false)}>
                  <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 p-5 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="modal-media-picker">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-amber-500" />
                        Media Library
                      </h3>
                      <button onClick={() => setShowMediaPicker(false)} className="text-muted-foreground hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {mediaPickerLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : !mediaPickerFolderId ? (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Select a folder to browse photos.</p>
                        {mediaPickerFolders.length === 0 ? (
                          <div className="text-center py-6 text-muted-foreground">
                            <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No folders yet</p>
                            <p className="text-xs mt-1">Process photos in the Photo Optimizer and save them to create folders.</p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {mediaPickerFolders.map(f => (
                              <button
                                key={f.id}
                                onClick={() => loadFolderPhotos(f.id)}
                                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-muted flex items-center gap-2 transition-colors"
                                data-testid={`media-folder-${f.id}`}
                              >
                                <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
                                {f.name}
                                <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground -rotate-90" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <button onClick={() => setMediaPickerFolderId(null)} className="text-xs text-primary hover:underline flex items-center gap-1" data-testid="button-back-to-folders">
                          <ChevronDown className="h-3 w-3 rotate-90" /> Back to folders
                        </button>
                        {mediaPickerPhotos.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-6">This folder is empty.</p>
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
                                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${mediaPickerSelected.has(p.id) ? "border-amber-500 ring-2 ring-amber-500/30" : "border-border hover:border-amber-300"}`}
                                  data-testid={`media-photo-${p.id}`}
                                >
                                  <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                                  {mediaPickerSelected.has(p.id) && (
                                    <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                                      <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                      </div>
                                    </div>
                                  )}
                                  <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-1 truncate">{p.name}</p>
                                </button>
                              ))}
                            </div>
                            <div className="flex items-center justify-between pt-1">
                              <p className="text-xs text-muted-foreground">{mediaPickerSelected.size} selected</p>
                              <Button
                                size="sm"
                                className="bg-amber-500 hover:bg-amber-600 text-white"
                                onClick={attachFromMediaLibrary}
                                disabled={mediaPickerSelected.size === 0}
                                data-testid="button-attach-from-library"
                              >
                                Attach {mediaPickerSelected.size > 0 ? `${mediaPickerSelected.size} Photo${mediaPickerSelected.size !== 1 ? "s" : ""}` : "Selected"}
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label><Mail className="w-3.5 h-3.5 inline mr-1" />Email Theme</Label>
                <p className="text-xs text-muted-foreground">Choose a color scheme for the review request email your client receives.</p>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
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
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all ${
                        emailTheme === theme.id
                          ? "border-foreground ring-1 ring-foreground/20 scale-105"
                          : "border-border hover:border-foreground/30"
                      }`}
                      data-testid={`button-theme-${theme.id}`}
                    >
                      <div className="w-full h-7 rounded-md overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700">
                        <div className="flex-1" style={{ background: theme.header }} />
                        <div className="h-1.5" style={{ background: theme.accent }} />
                      </div>
                      <span className="text-[9px] text-muted-foreground leading-tight text-center">{theme.label}</span>
                      {emailTheme === theme.id && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-foreground text-background flex items-center justify-center">
                          <CheckCircle2 className="w-3 h-3" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  <strong>How it works:</strong> The client will receive an email from <strong>your company</strong> asking them to rate their experience (1-10). If they rate 8 or above, they'll be guided through leaving a Google review with AI-generated review text. Ratings below 8 are kept private for your improvement.
                </p>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-schedule-toggle">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={e => setScheduleEnabled(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <CalendarDays className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">Schedule for later</span>
                </label>

                {scheduleEnabled && (
                  <div className="pl-6 space-y-3 border-l-2 border-amber-500/30">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Date</Label>
                        <Input
                          type="date"
                          value={scheduleDate}
                          onChange={e => setScheduleDate(e.target.value)}
                          min={new Date().toISOString().split("T")[0]}
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
                        { label: "Tomorrow 9am", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; }, time: "09:00" },
                        { label: "Tomorrow 3pm", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; }, time: "15:00" },
                        { label: "Tomorrow 6pm", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; }, time: "18:00" },
                      ].map(preset => (
                        <button
                          key={preset.label}
                          type="button"
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            scheduleDate === preset.getDate() && scheduleTime === preset.time
                              ? "bg-amber-500 text-white border-amber-500"
                              : "border-border hover:border-amber-500/50 text-muted-foreground hover:text-foreground"
                          }`}
                          onClick={() => { setScheduleDate(preset.getDate()); setScheduleTime(preset.time); }}
                          data-testid={`button-preset-${preset.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {scheduleDate && scheduleTime && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Will be sent on {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {!hasGoogleUrl && !selectedTemplateId && clientName && clientEmail && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Select a Google Business Profile above to send requests.
                </p>
              )}

              <Button
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => createMutation.mutate()}
                disabled={!canSend || createMutation.isPending || (scheduleEnabled && (!scheduleDate || !scheduleTime))}
                data-testid="button-send-review-request"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />{scheduleEnabled ? "Scheduling..." : "Sending..."}</>
                ) : scheduleEnabled ? (
                  <><CalendarDays className="w-4 h-4 mr-2" />Schedule Feedback Request</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" />Send Feedback Request</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {templateDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" data-testid="modal-template">
          <div className="fixed inset-0 bg-black/80" onClick={() => { setTemplateDialogOpen(false); setEditingTemplate(null); resetTemplateForm(); }} />
          <div className="relative z-[101] bg-background border rounded-lg shadow-lg w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto p-6">
            <button
              onClick={() => { setTemplateDialogOpen(false); setEditingTemplate(null); resetTemplateForm(); }}
              className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
              data-testid="button-close-template-dialog"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex flex-col space-y-1.5 mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5 text-amber-500" />
                {editingTemplate ? "Edit GMB Profile" : "Add GMB Profile"}
              </h2>
              <p className="text-sm text-muted-foreground">
                Each profile links to a different Google Business listing. When you send a review request, just pick which profile it's for.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tplName">Profile / Location Name *</Label>
                <Input
                  id="tplName"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., ABC Roofing - Dallas, Main Street Office"
                  data-testid="input-template-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tplUrl"><Link className="w-3.5 h-3.5 inline mr-1" />Google Review Link *</Label>
                <Input
                  id="tplUrl"
                  value={templateGoogleUrl}
                  onChange={(e) => setTemplateGoogleUrl(e.target.value)}
                  placeholder="https://g.page/r/..."
                  data-testid="input-template-google-url"
                />
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/50">
                  <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Find this in your Google Business Profile: go to your profile, click <strong>"Ask for reviews"</strong> (or "Get more reviews"), and copy the <strong>Review link</strong> that looks like <span className="font-mono text-[10px] bg-blue-100 dark:bg-blue-900/50 px-1 rounded">https://g.page/r/xxxx/review</span>
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tplDesc">Default Project Description</Label>
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
                  className="rounded border-gray-300"
                  data-testid="checkbox-template-default"
                />
                <Label htmlFor="tplDefault" className="text-sm cursor-pointer">Set as default template</Label>
              </div>
              <Button
                className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => editingTemplate ? updateTemplateMutation.mutate() : createTemplateMutation.mutate()}
                disabled={!templateName || !templateGoogleUrl || createTemplateMutation.isPending || updateTemplateMutation.isPending}
                data-testid="button-save-template"
              >
                {(createTemplateMutation.isPending || updateTemplateMutation.isPending) ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</>
                ) : (
                  <>{editingTemplate ? "Update Template" : "Save Template"}</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold" data-testid="stat-total-sent">{reviews.length}</p>
            <p className="text-xs text-muted-foreground">Total Sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600" data-testid="stat-reviews-received">{reviews.filter((r: any) => r.reviewSubmitted).length}</p>
            <p className="text-xs text-muted-foreground">Reviews Received</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600" data-testid="stat-positive">{reviews.filter((r: any) => r.status === "positive_feedback" || r.reviewSubmitted).length}</p>
            <p className="text-xs text-muted-foreground">Positive Feedback</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600" data-testid="stat-pending">{reviews.filter((r: any) => r.status === "sent").length}</p>
            <p className="text-xs text-muted-foreground">Awaiting Response</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base">
              <Building2 className="w-4 h-4" />
              GMB Profiles & Templates
              <Badge variant="outline" className="text-xs" data-testid="badge-template-count">{templates.length}/{maxTemplates}</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={openNewTemplate}
              disabled={templates.length >= maxTemplates}
              data-testid="button-new-template"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add Profile
            </Button>
          </CardTitle>
          <p className="text-sm text-muted-foreground -mt-1">Each template links to a different Google Business Profile — perfect if you manage multiple locations or GMB pages</p>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <Building2 className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="font-medium text-sm">No GMB profiles added</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Add a profile for each Google Business listing you manage. Each one gets its own Google review link, so review requests go to the right page. Got 5 locations? Add 5 profiles.
              </p>
              <Button variant="outline" size="sm" onClick={openNewTemplate} data-testid="button-create-first-template">
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Your First GMB Profile
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template: any) => (
                <div
                  key={template.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
                  data-testid={`card-template-${template.id}`}
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm" data-testid={`text-template-name-${template.id}`}>{template.name}</p>
                      {template.isDefault && <Badge className="bg-amber-500 text-white text-[10px]">Default</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Link className="w-3 h-3 shrink-0" />{template.googleProfileUrl}
                    </p>
                    {template.projectDescription && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{template.projectDescription}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditTemplate(template)}
                      title="Edit template"
                      data-testid={`button-edit-template-${template.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteTemplateMutation.mutate(template.id)}
                      title="Delete template"
                      data-testid={`button-delete-template-${template.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {templates.length >= maxTemplates && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Template limit reached ({maxTemplates}). <a href="/pricing" className="underline text-amber-600">Upgrade your plan</a> for more templates.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" />
            Review Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!isLoading && reviews.length > 0 && (
            <div className="relative mb-4">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, phone, or address..."
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
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <Star className="w-10 h-10 text-muted-foreground mx-auto" />
              <p className="font-medium">No review requests yet</p>
              <p className="text-sm text-muted-foreground">Send your first review request to start collecting Google reviews from happy clients.</p>
            </div>
          ) : filteredReviews.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Search className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">No results for "{searchQuery}"</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReviews.map((review: any) => {
                const isExpanded = expandedReviewId === review.id;
                const hasPhotos = Array.isArray(review.photos) && review.photos.length > 0;
                return (
                <div
                  key={review.id}
                  className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden"
                  data-testid={`card-review-request-${review.id}`}
                >
                  <div
                    className="flex items-center gap-4 p-4 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                    data-testid={`button-expand-${review.id}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-amber-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" data-testid={`text-client-name-${review.id}`}>{review.clientName}</p>
                        {getStatusBadge(review)}
                        {review.feedbackRating && (
                          <Badge variant="outline" className="text-xs">
                            <Star className="w-3 h-3 mr-0.5 text-amber-500" />
                            {review.feedbackRating}/10
                          </Badge>
                        )}
                        {review.status === "sent" && review.remindersSent > 0 && (
                          <Badge variant="outline" className="text-xs border-blue-200 text-blue-600 dark:border-blue-800 dark:text-blue-400">
                            <Bell className="w-3 h-3 mr-0.5" />
                            {review.remindersSent} reminder{review.remindersSent > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {review.unsubscribed && (
                          <Badge variant="outline" className="text-xs border-red-200 text-red-600 dark:border-red-800 dark:text-red-400">
                            Unsubscribed
                          </Badge>
                        )}
                        {review.referralFeedback === "up" && (
                          <Badge variant="outline" className="text-xs border-green-200 text-green-600">
                            <ThumbsUp className="w-3 h-3 mr-0.5" />
                            Referral
                          </Badge>
                        )}
                        {review.referralFeedback === "down" && (
                          <Badge variant="outline" className="text-xs border-red-200 text-red-600">
                            <ThumbsDown className="w-3 h-3 mr-0.5" />
                            Referral
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                        <span className="truncate">{review.clientEmail}</span>
                        {review.clientPhone && (
                          <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{review.clientPhone}</span>
                        )}
                      </div>
                      {review.clientAddress && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{review.clientAddress}</p>
                      )}
                      {review.projectDescription && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{review.projectDescription}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); window.open(`/review/${review.token}`, "_blank"); }}
                        title="Preview review page"
                        data-testid={`button-preview-${review.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => { e.stopPropagation(); resendMutation.mutate(review.id); }}
                        disabled={resendMutation.isPending}
                        title="Resend email"
                        data-testid={`button-resend-${review.id}`}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      {confirmDeleteId === review.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive hover:text-white font-semibold"
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
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-border/30" data-testid={`panel-tracking-${review.id}`}>
                      {(() => {
                        const reviewUrl = `${window.location.origin}/review/${review.token}`;
                        const emailBody = `Hi ${review.clientName?.split(" ")[0] || "there"},\n\nThanks again for choosing us! We'd really appreciate it if you could take a moment to share your experience using the link below:\n\n${reviewUrl}\n\nIt only takes a minute and means a lot to our small business.\n\nThank you!`;
                        const mailto = `mailto:${encodeURIComponent(review.clientEmail || "")}?subject=${encodeURIComponent("Quick favor — share your experience")}&body=${encodeURIComponent(emailBody)}`;
                        return (
                          <div className="mt-3 p-3 rounded-lg border border-border/50 bg-muted/30 space-y-2" data-testid={`panel-share-link-${review.id}`}>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Personal Review Link</p>
                              <span className="text-[10px] text-muted-foreground">Send manually if needed</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                value={reviewUrl}
                                readOnly
                                onClick={(e) => { e.stopPropagation(); (e.currentTarget as HTMLInputElement).select(); }}
                                className="h-8 text-xs font-mono bg-background"
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
                                <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Link
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
                                <FileText className="w-3.5 h-3.5 mr-1.5" /> Copy Email
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
                                  <Mail className="w-3.5 h-3.5 mr-1.5" /> Email
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                        {(() => {
                          const emailWasOpened = review.emailOpened || review.linkClicked;
                          const emailOpenTime = review.emailOpenedAt || (review.linkClicked ? review.linkClickedAt : null);
                          return (
                            <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${emailWasOpened ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" : "bg-muted/30 border-border/50"}`}>
                              <Mail className={`w-4 h-4 shrink-0 ${emailWasOpened ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} />
                              <div className="min-w-0">
                                <p className={`text-xs font-medium ${emailWasOpened ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
                                  {emailWasOpened ? "Email Opened" : "Not Opened"}
                                </p>
                                {emailOpenTime && (
                                  <p className="text-[10px] text-muted-foreground truncate">{formatPST(emailOpenTime)}</p>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${review.linkClicked ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800" : "bg-muted/30 border-border/50"}`}>
                          <MousePointerClick className={`w-4 h-4 shrink-0 ${review.linkClicked ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <p className={`text-xs font-medium ${review.linkClicked ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`}>
                              {review.linkClicked ? "Link Clicked" : "Not Clicked"}
                            </p>
                            {review.linkClickedAt && (
                              <p className="text-[10px] text-muted-foreground truncate">{formatPST(review.linkClickedAt)}</p>
                            )}
                          </div>
                        </div>

                        <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${review.photosDownloaded ? "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800" : hasPhotos ? "bg-muted/30 border-border/50" : "bg-muted/10 border-border/30"}`}>
                          <Download className={`w-4 h-4 shrink-0 ${review.photosDownloaded ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <p className={`text-xs font-medium ${review.photosDownloaded ? "text-purple-700 dark:text-purple-300" : "text-muted-foreground"}`}>
                              {!hasPhotos ? "No Photos" : review.photosDownloaded ? "Photos Downloaded" : "Not Downloaded"}
                            </p>
                            {review.photosDownloadedAt && (
                              <p className="text-[10px] text-muted-foreground truncate">{formatPST(review.photosDownloadedAt)}</p>
                            )}
                          </div>
                        </div>

                        <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${review.reviewMethod === "ai" ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" : review.reviewMethod === "own" ? "bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800" : "bg-muted/30 border-border/50"}`}>
                          {review.reviewMethod === "ai" ? (
                            <Bot className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          ) : review.reviewMethod === "own" ? (
                            <PenLine className="w-4 h-4 shrink-0 text-sky-600 dark:text-sky-400" />
                          ) : (
                            <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <p className={`text-xs font-medium ${review.reviewMethod === "ai" ? "text-amber-700 dark:text-amber-300" : review.reviewMethod === "own" ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground"}`}>
                              {review.reviewMethod === "ai" ? "AI Generated" : review.reviewMethod === "own" ? "Wrote Their Own" : "No Review Yet"}
                            </p>
                          </div>
                        </div>

                        {review.lastStep && !review.reviewSubmitted && (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                            <Target className="w-4 h-4 shrink-0 text-orange-600 dark:text-orange-400" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                                Bounced: {stepLabels[review.lastStep] || review.lastStep}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {(review.feedbackComments || review.feedbackCategories || (review.feedbackRating && review.feedbackRating < 9)) && (
                        <div className="mt-3 p-3 bg-muted/30 rounded-lg border border-border/30">
                          <p className="text-xs font-medium mb-1">Private Feedback</p>
                          {review.feedbackCategories && Array.isArray(review.feedbackCategories) && review.feedbackCategories.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {review.feedbackCategories.map((cat: string) => (
                                <Badge key={cat} variant="outline" className="text-[10px]">{cat}</Badge>
                              ))}
                            </div>
                          )}
                          {review.feedbackComments && (
                            <p className="text-xs text-muted-foreground">{review.feedbackComments}</p>
                          )}
                          {review.feedbackRating && review.feedbackRating < 9 && !review.feedbackComments && !(review.feedbackCategories && Array.isArray(review.feedbackCategories) && review.feedbackCategories.length > 0) && (
                            <p className="text-xs text-muted-foreground italic">No written feedback provided</p>
                          )}
                        </div>
                      )}
                      {review.referralFeedback && (
                        <div className="mt-2 p-3 bg-muted/30 rounded-lg border border-border/30">
                          <p className="text-xs font-medium mb-1">Referral Response</p>
                          <p className="text-xs text-muted-foreground">{review.referralFeedback === "up" ? "👍 Would refer others" : review.referralFeedback === "down" ? "👎 Would not refer" : review.referralFeedback}</p>
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
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
        </CardContent>
      </Card>

      <Card data-testid="card-other-platforms">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ExternalLink className="w-5 h-5 text-amber-500" />
            Other Review Platforms
          </CardTitle>
          <p className="text-sm text-muted-foreground">Quick links to manage your reviews across all major platforms</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { name: "Yelp", url: "https://biz.yelp.com", color: "bg-red-500", letter: "Y" },
              { name: "BBB", url: "https://www.bbb.org/near-me", color: "bg-blue-600", letter: "B" },
              { name: "Angi", url: "https://www.angi.com/pro/login", color: "bg-green-600", letter: "A" },
              { name: "GuildQuality", url: "https://www.guildquality.com/login", color: "bg-indigo-600", letter: "G" },
              { name: "HomeAdvisor", url: "https://pro.homeadvisor.com", color: "bg-orange-500", letter: "H" },
              { name: "Houzz", url: "https://www.houzz.com/pro/login", color: "bg-emerald-600", letter: "H" },
              { name: "Thumbtack", url: "https://pro.thumbtack.com", color: "bg-sky-500", letter: "T" },
              { name: "Facebook", url: "https://business.facebook.com", color: "bg-blue-500", letter: "F" },
            ].map((platform) => (
              <a
                key={platform.name}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:border-amber-500/40 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-all group"
                data-testid={`link-platform-${platform.name.toLowerCase()}`}
              >
                <div className={`w-8 h-8 rounded-lg ${platform.color} flex items-center justify-center shrink-0`}>
                  <span className="text-white font-bold text-sm">{platform.letter}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{platform.name}</p>
                  <p className="text-[10px] text-muted-foreground">Manage reviews</p>
                </div>
                <ExternalLink className="w-3 h-3 text-muted-foreground ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white dark:bg-card border-border/50">
        <CardContent className="p-0">
          <button
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="w-full flex items-center justify-between p-6 pb-4 cursor-pointer hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors rounded-t-xl"
            data-testid="button-toggle-how-it-works"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-lg">Why This Is the Best Review System on the Planet</h3>
                <p className="text-sm text-muted-foreground">The smartest way to build a 5-star reputation while avoiding bad reviews entirely</p>
              </div>
            </div>
            {showHowItWorks ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </button>

          {showHowItWorks && (
            <div className="px-6 pb-6 space-y-6">
              <Separator />

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <p className="text-sm font-medium leading-relaxed">
                  Most contractors ask every client for a Google review and hope for the best. That's a gamble. One bad review from an unhappy client can tank your rating, push you down in search results, and cost you thousands in lost jobs. This system eliminates that risk completely.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-base mb-4 flex items-center gap-2">
                  <Target className="w-4 h-4 text-gray-500" />
                  How the Feedback Funnel Works
                </h4>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">1</div>
                      <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 mt-2"></div>
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Filter className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">The Feedback Gate (Rating 1-10)</p>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Instead of sending clients directly to Google, you send them a private feedback link first. They rate their experience on a scale of 1 to 10. This is the magic — <strong className="text-foreground">you're filtering before the review ever happens.</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">2a</div>
                      <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 mt-2"></div>
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">Below 8 = Private Feedback Only</p>
                        <Badge variant="outline" className="text-xs">Bad Review Blocked</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        If the client rates below 8, they <strong className="text-foreground">never see a Google review link.</strong> Instead, they get a private improvement form — what areas could you improve? Communication? Timeliness? Quality? This feedback goes only to you. The unhappy client feels heard, and their frustration stays private. <strong className="text-foreground">No bad review. No damage to your reputation. Just actionable feedback to help you get better.</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">2b</div>
                      <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 mt-2"></div>
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <ThumbsUp className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">8 or Above = Review Path Unlocked</p>
                        <Badge variant="outline" className="text-xs">Guaranteed Positive</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Happy clients (8, 9, or 10) are guided to the next step — leaving a real Google review. <strong className="text-foreground">Since you already know they're happy, every review that makes it to Google is guaranteed to be positive.</strong> No more rolling the dice.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">3</div>
                      <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 mt-2"></div>
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <DollarSign className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">The Referral Cash Incentive</p>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Before the review page, clients see your referral program: <strong className="text-foreground">3% referral fee</strong> when they send you a new customer, plus an extra <strong className="text-foreground">1% bonus</strong> for leaving an impactful Google review. This does two powerful things — it motivates them to leave a thoughtful, detailed review (not a lazy "great job"), and it turns happy clients into active promoters who tell friends, family, and neighbors about your business <strong className="text-foreground">because there's real money on the line.</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">4</div>
                      <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 mt-2"></div>
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">AI Writes Their Review For Them</p>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Most people want to leave a review but don't know what to write. So they either write something short and generic, or they don't bother at all. Our AI generates a <strong className="text-foreground">detailed, keyword-rich, authentic-sounding review</strong> based on the actual project. The client just copies, pastes, and hits submit. It takes 30 seconds. The review reads like they spent 10 minutes writing it — and it's loaded with SEO-friendly keywords that help your Google listing rank higher.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">5</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <ExternalLink className="w-4 h-4 text-gray-500" />
                        <p className="font-bold text-sm">One-Click Google Review Submission</p>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        The client clicks one button, Google opens with your profile ready to go, they paste the AI-written review, select 5 stars, and submit. Done. <strong className="text-foreground">Maximum friction removed, maximum review quality guaranteed.</strong>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-bold text-base mb-4 flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4 text-gray-500" />
                  Why This Beats Every Other Method
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <ShieldCheck className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Zero Bad Reviews</p>
                      <p className="text-xs text-muted-foreground">Unhappy clients never see a Google link. Their frustration stays private. Your public rating stays perfect.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <TrendingUp className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Higher Ranking on Google</p>
                      <p className="text-xs text-muted-foreground">AI-generated reviews are packed with industry keywords. More detailed reviews = higher search ranking for your Google Business Profile.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <Megaphone className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Clients Become Promoters</p>
                      <p className="text-xs text-muted-foreground">The 3% referral fee turns every happy client into a salesperson for your business. They actively tell people about you because there's money in it.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <Heart className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Real Improvement Feedback</p>
                      <p className="text-xs text-muted-foreground">Low ratings come with specific improvement categories. You learn exactly what to fix — without the public embarrassment of a 1-star review.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <DollarSign className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Higher Quality Reviews</p>
                      <p className="text-xs text-muted-foreground">The 1% review bonus motivates clients to write detailed, thoughtful reviews instead of "good job." Better reviews convert more leads.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background border border-border/50">
                    <Target className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Completely Automated</p>
                      <p className="text-xs text-muted-foreground">Send a request, the system handles the rest. Feedback gate, referral pitch, AI review, Google link — all automatic. You just collect 5-star reviews.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-sm mb-1">What Most Contractors Do Wrong</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      They finish a job, hand the client a card that says "Leave us a Google review!" and hope for the best. The problem? Happy clients forget. Unhappy clients remember. The result is a review profile skewed toward complaints. With this system, you control the narrative. Happy clients are guided to Google with a pre-written review. Unhappy clients are intercepted before they ever reach your profile. <strong className="text-foreground">It's not manipulation — it's smart business.</strong> You're simply making it easy for happy clients and creating a private channel for unhappy ones.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {trashQuery.data && trashQuery.data.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setShowTrash(!showTrash)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-muted-foreground" />
                Trash
                <Badge variant="secondary" className="text-xs">{trashQuery.data.length}</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Auto-deletes after 14 days</span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showTrash ? "rotate-180" : ""}`} />
              </div>
            </div>
          </CardHeader>
          {showTrash && (
            <CardContent className="pt-0 space-y-2">
              {trashQuery.data.map((item: any) => {
                const daysLeft = Math.max(0, Math.ceil(14 - (Date.now() - new Date(item.deletedAt).getTime()) / (1000 * 60 * 60 * 24)));
                return (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20" data-testid={`trash-item-${item.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{item.clientName}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.clientEmail}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {item.feedbackRating ? `${item.feedbackRating}/10` : item.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground shrink-0">{daysLeft}d left</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                        onClick={() => restoreMutation.mutate(item.id)}
                        disabled={restoreMutation.isPending}
                        data-testid={`button-restore-${item.id}`}
                      >
                        <RefreshCw className="w-3 h-3 mr-1" />
                        Restore
                      </Button>
                      {confirmPermanentDeleteId === item.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive hover:text-white font-semibold"
                            onClick={() => { permanentDeleteMutation.mutate(item.id); setConfirmPermanentDeleteId(null); }}
                            data-testid={`button-confirm-perm-delete-${item.id}`}
                          >
                            Delete Forever
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
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      )}

      <ReminderSettingsCard />
      </div>)}

      {pageTab === "profile-reviews" && (
        <GoogleProfileReviewsTab />
      )}
    </div>
  );
}

function GoogleProfileReviewsTab() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [responseFilter, setResponseFilter] = useState("all");
  const [expandedReviewId, setExpandedReviewId] = useState<number | null>(null);
  const [replyingToId, setReplyingToId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [noteEditId, setNoteEditId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/review-templates"],
  });

  const queryParams = new URLSearchParams();
  if (locationFilter !== "all") queryParams.set("locationId", locationFilter);
  if (ratingFilter !== "all") queryParams.set("rating", ratingFilter);
  if (responseFilter !== "all") queryParams.set("response", responseFilter);
  if (searchQuery.trim()) queryParams.set("search", searchQuery.trim());
  const qs = queryParams.toString();

  const { data: reviews = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/google-profile-reviews", qs],
    queryFn: async () => {
      const res = await fetch(`/api/google-profile-reviews${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json();
    },
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, replyComment }: { id: number; replyComment: string }) => {
      const res = await apiRequest("PATCH", `/api/google-profile-reviews/${id}/reply`, { replyComment });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-profile-reviews"] });
      toast({ title: "Reply saved" });
      setReplyingToId(null);
      setReplyText("");
    },
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
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/google-profile-reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/google-profile-reviews"] });
      toast({ title: "Review deleted" });
    },
  });

  const totalReviews = reviews.length;
  const unanswered = reviews.filter(r => !r.replyComment).length;
  const avgRating = totalReviews > 0 ? (reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / totalReviews) : 0;
  const ratingDistribution = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter((r: any) => r.rating === star).length,
    pct: totalReviews > 0 ? Math.round((reviews.filter((r: any) => r.rating === star).length / totalReviews) * 100) : 0,
  }));

  const clearFilters = () => {
    setSearchQuery("");
    setLocationFilter("all");
    setRatingFilter("all");
    setResponseFilter("all");
  };

  const hasFilters = searchQuery || locationFilter !== "all" || ratingFilter !== "all" || responseFilter !== "all";

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
    ? "All Locations"
    : allLocations.find(l => l.id === locationFilter)?.name || "Unknown";

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`w-3.5 h-3.5 ${s <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-gray-600"}`} />
      ))}
    </div>
  );

  return (
    <div className="space-y-6 relative z-10">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-medium">Search</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by review or comment"
              className="pl-9"
              data-testid="input-search-profile-reviews"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-medium">Location</Label>
          <div className="relative">
            <button
              onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md border border-input bg-background text-sm hover:bg-accent/50 transition-colors"
              data-testid="dropdown-location-filter"
            >
              <span className="truncate">{selectedLocationName}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />
            </button>
            {locationDropdownOpen && (
              <>
                <div className="fixed inset-0 z-[49]" onClick={() => setLocationDropdownOpen(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 z-[50] bg-popover border border-border rounded-lg shadow-lg max-h-72 overflow-hidden">
                  <div className="p-2 border-b border-border">
                    <Input
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      placeholder="Search by name, address, place id or store code"
                      className="text-xs h-8"
                      autoFocus
                      data-testid="input-location-search"
                    />
                  </div>
                  <div className="overflow-y-auto max-h-56">
                    <button
                      onClick={() => { setLocationFilter("all"); setLocationDropdownOpen(false); setLocationSearch(""); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors ${locationFilter === "all" ? "bg-accent" : ""}`}
                      data-testid="option-location-all"
                    >
                      All Locations
                    </button>
                    {filteredLocations.map((loc) => (
                      <button
                        key={loc.id}
                        onClick={() => { setLocationFilter(loc.id); setLocationDropdownOpen(false); setLocationSearch(""); }}
                        className={`w-full text-left px-3 py-2.5 hover:bg-accent transition-colors border-t border-border/30 ${locationFilter === loc.id ? "bg-accent" : ""}`}
                        data-testid={`option-location-${loc.id}`}
                      >
                        <p className="text-sm font-medium truncate">{loc.name}</p>
                        <p className="text-xs text-muted-foreground">{loc.type}</p>
                        <p className="text-xs text-muted-foreground/60 truncate">{loc.detail}</p>
                      </button>
                    ))}
                    {filteredLocations.length === 0 && (
                      <p className="text-center text-xs text-muted-foreground py-4">No locations found</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-medium">Rating</Label>
          <Select value={ratingFilter} onValueChange={setRatingFilter}>
            <SelectTrigger className="w-[120px]" data-testid="select-rating-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="5">5 Stars</SelectItem>
              <SelectItem value="4">4 Stars</SelectItem>
              <SelectItem value="3">3 Stars</SelectItem>
              <SelectItem value="2">2 Stars</SelectItem>
              <SelectItem value="1">1 Star</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground font-medium">Response</Label>
          <Select value={responseFilter} onValueChange={setResponseFilter}>
            <SelectTrigger className="w-[140px]" data-testid="select-response-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="answered">Answered</SelectItem>
              <SelectItem value="unanswered">Unanswered</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-amber-600 hover:text-amber-700 gap-1" data-testid="button-clear-filters">
            <RefreshCw className="w-3.5 h-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Reviews</p>
          <p className="text-3xl font-bold" data-testid="stat-total-profile-reviews">{totalReviews}</p>
          <p className="text-xs text-muted-foreground">Showing statistics for all time</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Unanswered</p>
          <p className="text-3xl font-bold text-amber-600" data-testid="stat-unanswered">{unanswered}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">Average rating</p>
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
            <span className="text-3xl font-bold" data-testid="stat-avg-rating">{avgRating.toFixed(2)}</span>
          </div>
          <div className="space-y-1 mt-2">
            {ratingDistribution.map(({ star, count, pct }) => (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="text-amber-500 font-medium flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                  {star}
                </span>
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-muted-foreground min-w-[80px] text-right">
                  {pct}% ({count})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Separator />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Star className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="font-medium">No Google profile reviews yet</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Reviews from your Google Business Profiles will appear here once synced. Currently awaiting Google API access approval.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
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

            return (
              <Card key={review.id} data-testid={`card-profile-review-${review.id}`}>
                <CardContent className="p-0">
                  {locationName && (
                    <div className="px-4 pt-3 pb-2 border-b border-border/30 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Building2 className="w-3.5 h-3.5" />
                        <span className="font-medium text-foreground">{locationName}</span>
                        {locationCategories && (
                          <>
                            <span className="text-border">|</span>
                            <span>{locationCategories}</span>
                          </>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 gap-1"
                        onClick={() => {
                          setNoteEditId(review.id);
                          setNoteText(review.internalNote || "");
                        }}
                        data-testid={`button-add-note-${review.id}`}
                      >
                        <StickyNote className="w-3 h-3" />
                        {review.internalNote ? "Edit Note" : "Add Internal Note"}
                      </Button>
                    </div>
                  )}

                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center shrink-0">
                        {review.reviewerPhotoUrl ? (
                          <img src={review.reviewerPhotoUrl} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <span className="text-white font-bold text-sm">{review.reviewerName?.charAt(0)?.toUpperCase() || "?"}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="font-semibold text-sm" data-testid={`text-reviewer-name-${review.id}`}>{review.reviewerName}</p>
                          {renderStars(review.rating)}
                          <span className="text-xs text-muted-foreground">
                            {new Date(review.reviewDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                            {" "}
                            {new Date(review.reviewDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                        {review.comment && (
                          <p className="text-sm mt-2 leading-relaxed" data-testid={`text-review-comment-${review.id}`}>
                            {isExpanded ? review.comment : review.comment.length > 200 ? review.comment.slice(0, 200) + "..." : review.comment}
                          </p>
                        )}
                        {review.comment?.length > 200 && (
                          <button
                            onClick={() => setExpandedReviewId(isExpanded ? null : review.id)}
                            className="text-xs text-amber-600 hover:text-amber-700 mt-1"
                            data-testid={`button-expand-review-${review.id}`}
                          >
                            {isExpanded ? "Show less" : "Read more"}
                          </button>
                        )}

                        {review.internalNote && noteEditId !== review.id && (
                          <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800/40 rounded text-xs">
                            <span className="font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1 mb-0.5">
                              <StickyNote className="w-3 h-3" /> Internal Note:
                            </span>
                            <span className="text-yellow-800 dark:text-yellow-300">{review.internalNote}</span>
                          </div>
                        )}

                        {noteEditId === review.id && (
                          <div className="mt-3 space-y-2">
                            <Textarea
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Add an internal note (only visible to you)..."
                              className="text-sm min-h-[60px]"
                              data-testid={`input-note-${review.id}`}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => noteMutation.mutate({ id: review.id, internalNote: noteText })}
                                disabled={noteMutation.isPending}
                                data-testid={`button-save-note-${review.id}`}
                              >
                                {noteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                                Save Note
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setNoteEditId(null)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!review.replyComment && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => { setReplyingToId(review.id); setReplyText(""); }}
                            title="Reply"
                            data-testid={`button-reply-${review.id}`}
                          >
                            <MessageSquare className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate(review.id)}
                          title="Delete"
                          data-testid={`button-delete-review-${review.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {replyingToId === review.id && !review.replyComment && (
                      <div className="mt-4 ml-13 pl-4 border-l-2 border-amber-300 space-y-2">
                        <Label className="text-xs font-medium">Reply to this review:</Label>
                        <Textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write your reply..."
                          className="text-sm min-h-[80px]"
                          data-testid={`input-reply-${review.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={() => replyMutation.mutate({ id: review.id, replyComment: replyText })}
                            disabled={!replyText.trim() || replyMutation.isPending}
                            data-testid={`button-submit-reply-${review.id}`}
                          >
                            {replyMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
                            Post Reply
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setReplyingToId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {review.replyComment && (
                      <div className="mt-4 ml-4 sm:ml-13 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Reply:</span>
                          <div className="flex items-center gap-2">
                            {review.replyDate && (
                              <span className="text-xs text-muted-foreground">
                                {new Date(review.replyDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                {" "}
                                {new Date(review.replyDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => replyMutation.mutate({ id: review.id, replyComment: "" })}
                              title="Delete reply"
                              data-testid={`button-delete-reply-${review.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed">{review.replyComment}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  function updateField(field: string, value: any) {
    const updated = { ...currentSettings, [field]: value };
    setLocalSettings(updated);
  }

  function updateTimeWindow(index: number, field: "start" | "end", value: number) {
    const windows = [...(currentSettings.timeWindows || [])];
    windows[index] = { ...windows[index], [field]: value };
    setLocalSettings({ ...currentSettings, timeWindows: windows });
  }

  const formatHour = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${hr}:00 ${ampm}`;
  };

  const reminderLabels = ["1st Reminder", "2nd Reminder", "3rd Reminder"];

  return (
    <Card data-testid="card-reminder-settings">
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Follow-Up Reminders</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Automatically remind clients who haven't responded
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={currentSettings.enabled ? "default" : "secondary"} className={currentSettings.enabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : ""} data-testid="badge-reminder-status">
              {currentSettings.enabled ? "Active" : "Disabled"}
            </Badge>
            {expanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6 pt-0">
          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">Enable Automatic Reminders</Label>
              <p className="text-sm text-muted-foreground mt-1">Send follow-up emails to clients who haven't responded</p>
            </div>
            <Switch
              checked={currentSettings.enabled}
              onCheckedChange={v => updateField("enabled", v)}
              data-testid="switch-reminders-enabled"
            />
          </div>

          {currentSettings.enabled && (
            <>
              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Timer className="h-4 w-4" />
                    Interval Between Reminders
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
                    <RefreshCw className="h-4 w-4" />
                    Max Reminders Per Client
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
                <Label className="flex items-center gap-2 text-base font-medium">
                  <Clock className="h-4 w-4" />
                  Delivery Time Windows (EST)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Each reminder is sent during a different time window for better open rates. Times rotate through the windows below.
                </p>

                <div className="grid gap-3">
                  {(currentSettings.timeWindows || []).slice(0, currentSettings.maxReminders).map((window: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
                      <Badge variant="outline" className="shrink-0 text-xs min-w-[100px] justify-center">
                        {reminderLabels[i] || `Reminder ${i + 1}`}
                      </Badge>
                      <Select
                        value={String(window.start)}
                        onValueChange={v => updateTimeWindow(i, "start", parseInt(v))}
                      >
                        <SelectTrigger className="w-[130px]" data-testid={`select-window-start-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 15 }, (_, h) => h + 6).map(h => (
                            <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">to</span>
                      <Select
                        value={String(window.end)}
                        onValueChange={v => updateTimeWindow(i, "end", parseInt(v))}
                      >
                        <SelectTrigger className="w-[130px]" data-testid={`select-window-end-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 15 }, (_, h) => h + 7).map(h => (
                            <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-800/50">
                <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p><strong>How it works:</strong> When you send a review request, the system automatically schedules follow-up reminders at the intervals and times configured above.</p>
                  <p>Reminders automatically stop when the client submits feedback, unsubscribes, or the max reminder count is reached. Every reminder includes a visible unsubscribe link.</p>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate(currentSettings)}
              disabled={saveMutation.isPending}
              data-testid="button-save-reminder-settings"
            >
              {saveMutation.isPending ? "Saving..." : "Save Reminder Settings"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
