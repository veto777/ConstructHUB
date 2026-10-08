import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Star, Loader2, Copy, ExternalLink, CheckCircle2,
  ThumbsUp, ThumbsDown, MessageSquare, DollarSign, Camera, Download,
  AlertCircle, Heart, Sparkles, ArrowRight, ShieldCheck, X,
  Clock, Lock, Award, Zap, PenLine,
} from "lucide-react";

function FloatingParticles({ color = "#d4d4d8" }: { color?: string }) {
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
        ctx.beginPath();
        const s = p.size;
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.6, -s * 0.3);
        ctx.lineTo(s * 0.4, s * 0.6);
        ctx.lineTo(-s * 0.4, s * 0.6);
        ctx.lineTo(-s * 0.6, -s * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, [color]);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />;
}

type Step = "rating" | "improvement" | "referral" | "referral_feedback" | "describe" | "review" | "bonus_reviews" | "done";

const improvementCategories = [
  "Communication",
  "Timeliness",
  "Quality of Work",
  "Cleanliness",
  "Professionalism",
  "Pricing / Value",
  "Project Management",
  "Follow-up / Warranty",
];

const ratingEmojis: Record<number, string> = {
  1: "😞", 2: "😟", 3: "😐", 4: "🤔", 5: "😊",
  6: "😄", 7: "😃", 8: "🤩", 9: "🌟", 10: "🏆",
};

const THEME_COLOR = "#f59e0b";

export default function ReviewFeedbackPage() {
  const [, params] = useRoute("/review/:token");
  const token = params?.token || "";

  const [step, setStep] = useState<Step>("rating");
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [comments, setComments] = useState("");
  const [referralOptIn, setReferralOptIn] = useState(false);
  const [referralFeedback, setReferralFeedback] = useState<"up" | "down" | null>(null);
  const [generatedReview, setGeneratedReview] = useState("");
  const [highlights, setHighlights] = useState("");
  const [copied, setCopied] = useState(false);
  // The browser refused the clipboard write: the customer is asked to copy the text by hand.
  const [copyError, setCopyError] = useState(false);
  const reviewBox = useRef<HTMLTextAreaElement>(null);
  const [photosDownloaded, setPhotosDownloaded] = useState(false);
  // "Skip Photos" is a real choice: without it the photo reminder reopened on every Google click.
  const [photosSkipped, setPhotosSkipped] = useState(false);
  const [showCopyWarning, setShowCopyWarning] = useState(false);
  const [showPhotoReminder, setShowPhotoReminder] = useState(false);
  const [skippedDescribe, setSkippedDescribe] = useState(false);
  const isHighRating = rating >= 9;
  const isCompleted = step === "done" || step === "bonus_reviews";
  const restored = useRef(false);
  const skipTrackStep = useRef<Step | null>(null);

  const positiveSteps: Step[] = ["describe", "review"];
  const getStepProgress = () => {
    if (!isHighRating) return null;
    const idx = positiveSteps.indexOf(step);
    if (idx === -1) return null;
    return { current: idx + 1, total: positiveSteps.length };
  };

  const { data: reviewData, isLoading, error } = useQuery<any>({
    queryKey: ["/api/review", token],
    queryFn: async () => {
      const res = await fetch(`/api/review/${token}`);
      if (!res.ok) throw new Error("Review request not found");
      if (!res.ok) throw new Error("Unable to save your request. Please try again.");
      return res.json();
    },
    enabled: !!token,
  });
  // The signed-in owner opening their own link (the eye icon): the server records nothing,
  // so the page sends nothing either and always starts at the rating step.
  const preview = reviewData?.preview === true;
  /** Customer-progress beacons; never sent from the owner's preview. */
  const track = (path: string, body?: unknown, keepalive = false) => {
    if (preview || !token) return;
    void fetch(`/api/review/${token}/${path}`, {
      method: "POST",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      keepalive,
    }).catch(() => {});
  };

  useEffect(() => {
    if (!isHighRating || isCompleted || preview) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isHighRating, isCompleted, preview]);

  useEffect(() => {
    if (skipTrackStep.current === step) {
      skipTrackStep.current = null;
      return;
    }
    if (step !== "rating") track("track-step", { step });
  }, [step, token, preview]);

  // A reload (or a second visit) resumes after the rating that was already
  // saved instead of asking for it again.
  useEffect(() => {
    if (restored.current || !reviewData) return;
    restored.current = true;
    if (reviewData.preview === true) return;
    const saved = Number(reviewData.feedbackRating);
    if (!Number.isInteger(saved) || saved < 1 || saved > 10) return;
    const next: Step = reviewData.lastStep === "done" || reviewData.lastStep === "bonus_reviews"
      ? "done"
      : saved >= 9 ? (reviewData.referralOffer ? "referral" : "describe") : "improvement";
    setRating(saved);
    skipTrackStep.current = next;
    setStep(next);
  }, [reviewData]);

  const postFeedback = async () => {
    if (preview) return { success: true, preview: true, recorded: false };
    const res = await fetch(`/api/review/${token}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        categories: selectedCategories.length > 0 ? selectedCategories : undefined,
        comments: comments || undefined,
      }),
    });
    if (!res.ok) throw new Error("Unable to save your request. Please try again.");
    return res.json();
  };

  const feedbackMutation = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => {
      if (isHighRating) {
        setStep(reviewData?.referralOffer ? "referral" : "describe");
      } else {
        setStep("improvement");
      }
    },
  });

  const improvementMutation = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => {
      setStep("done");
    },
  });

  // "Help me draft my honest review" keeps the private notes already typed.
  const saveImprovementMutation = useMutation({
    mutationFn: postFeedback,
    onSuccess: () => {
      setStep("describe");
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${token}/generate-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectType: reviewData?.projectDescription,
          highlights: highlights || undefined,
        }),
      });
      if (!res.ok) {
        // 4xx carry a reason worth showing (e.g. the draft limit); a 5xx doesn't.
        const body = res.status < 500 ? await res.json().catch(() => null) : null;
        const reason = String(body?.message || "AI help is unavailable right now.");
        throw new Error(/[.!?]$/.test(reason) ? reason : `${reason}.`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedReview(data.review);
    },
  });

  const acceptOwnWords = () => {
    generateMutation.reset();
    setGeneratedReview(highlights);
    track("track-review-method", { method: "own" });
  };

  const completeFlowMutation = useMutation({
    mutationFn: async () => {
      if (preview) return { success: true, preview: true, recorded: false };
      const res = await fetch(`/api/review/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referralOptIn, referralFeedback }),
      });
      if (!res.ok) throw new Error("Unable to save your request. Please try again.");
      return res.json();
    },
    onSuccess: () => {
      if (rating === 10) {
        setStep("bonus_reviews");
      } else {
        setStep("done");
      }
    },
  });

  const trackGoogleOpen = () => track("google-link-opened", undefined, true);

  // Only a completed clipboard write counts as copied (it can be blocked by permissions, an
  // insecure page or an in-app browser). "Copied" then lasts until the text changes.
  const copyReview = async () => {
    try {
      await navigator.clipboard.writeText(generatedReview);
      setCopied(true);
      setCopyError(false);
      return true;
    } catch {
      setCopied(false);
      setCopyError(true);
      // Select the text so a manual copy is one keystroke or long-press away.
      setTimeout(() => {
        reviewBox.current?.focus();
        reviewBox.current?.select();
      }, 0);
      return false;
    }
  };

  const handleCopyReview = () => {
    if (photosPending) {
      setShowPhotoReminder(true);
      return;
    }
    void copyReview();
  };

  const handleGoogleClick = () => {
    if (photosPending) {
      setShowPhotoReminder(true);
      return;
    }
    // After a blocked copy the customer was told to copy by hand, so Google opens directly.
    if (!copied && !copyError) {
      setShowCopyWarning(true);
      return;
    }
    window.open(reviewData.googleProfileUrl, "_blank", "noopener,noreferrer");
    trackGoogleOpen();
    completeFlowMutation.mutate();
  };

  const handleCopyAndGo = async () => {
    const ok = await copyReview();
    setShowCopyWarning(false);
    // A failed copy stays on the page with the manual-copy instructions instead of opening Google empty-handed.
    if (!ok) return;
    setTimeout(() => {
      window.open(reviewData.googleProfileUrl, "_blank", "noopener,noreferrer");
    trackGoogleOpen();
      completeFlowMutation.mutate();
    }, 300);
  };

  const handleSkipAndGo = () => {
    setShowCopyWarning(false);
    window.open(reviewData.googleProfileUrl, "_blank", "noopener,noreferrer");
    trackGoogleOpen();
    completeFlowMutation.mutate();
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  type PhotoItem = { url: string; originalName?: string } | string;
  const photoItems: PhotoItem[] = reviewData?.photos || [];
  const hasPhotos = photoItems.length > 0;
  const photosPending = hasPhotos && !photosDownloaded && !photosSkipped;
  const getPhotoUrl = (p: PhotoItem) => typeof p === "string" ? p : p.url;
  const getPhotoName = (p: PhotoItem, i: number) => typeof p === "string" ? `photo-${i + 1}.jpg` : (p.originalName || `photo-${i + 1}.jpg`);
  const getDownloadUrl = (p: PhotoItem, i: number) => {
    const url = getPhotoUrl(p);
    const name = getPhotoName(p, i);
    return `${url}/download?name=${encodeURIComponent(name)}`;
  };
  const activeRating = hoveredRating || rating;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <FloatingParticles color={THEME_COLOR} />
        <div className="flex flex-col items-center gap-4 relative z-10">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-gray-200 border-t-amber-500 animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground animate-pulse">Loading your feedback form...</p>
        </div>
      </div>
    );
  }

  if (error || !reviewData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 px-4">
        <FloatingParticles color={THEME_COLOR} />
        <Card className="max-w-md mx-auto border shadow-lg relative z-10">
          <CardContent className="p-8 text-center space-y-4">
            <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mx-auto">
              <AlertCircle className="w-10 h-10 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold">Link Not Found</h2>
            <p className="text-muted-foreground leading-relaxed">This feedback link may have expired or is invalid. Please contact the company that sent you this link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const companyName = reviewData.companyName || "Our Team";
  const companyLogoUrl = reviewData.companyLogoUrl;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 relative">
      <FloatingParticles color={THEME_COLOR} />
      <div className="max-w-xl mx-auto px-4 py-6 sm:py-10 relative z-10">
        {preview && (
          <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 px-4 py-3 text-sm text-amber-900 dark:text-amber-200" data-testid="banner-review-preview">
            <strong>Preview</strong> — nothing you do here is recorded for your customer.
          </div>
        )}

        <div className="text-center mb-6 sm:mb-8">
          <div className="relative inline-block mb-4">
            {companyLogoUrl ? (
              <img
                src={companyLogoUrl}
                alt={companyName}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-2 border-gray-200 dark:border-gray-700 shadow-lg"
                data-testid="img-company-logo"
              />
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gray-900 dark:bg-gray-100 flex items-center justify-center border-2 border-gray-200 dark:border-gray-700 shadow-lg">
                <span className="text-white dark:text-gray-900 text-3xl sm:text-4xl font-extrabold">{companyName.charAt(0)}</span>
              </div>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight" data-testid="text-company-name">
            {companyName}
          </h1>
          <div className="inline-flex items-center gap-2 mt-2 px-4 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
            <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Customer Feedback</span>
          </div>
        </div>

        {reviewData.googleProfileUrl && (
          <div className="mb-6 space-y-2 text-center">
            <Button asChild className="w-full h-12">
              <a href={reviewData.googleProfileUrl} target="_blank" rel="noopener noreferrer" onClick={trackGoogleOpen} data-testid="link-google-review-always">
                <ExternalLink className="w-4 h-4 mr-2" /> Leave a Google Review
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">Everyone is welcome to review. No private feedback or referral participation is required, and no reward is offered for a review.</p>
          </div>
        )}
        {[feedbackMutation.error, improvementMutation.error, saveImprovementMutation.error, completeFlowMutation.error].some(Boolean) && (
          <p role="alert" className="mb-4 text-sm text-destructive">Unable to save your request. Please try again.</p>
        )}

        {step === "rating" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-rating-heading">
                  Hi {reviewData.clientName}! How was your experience?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Rate your overall experience with {companyName}
                </p>
              </div>

              <div className="grid grid-cols-5 gap-2 sm:gap-3 max-w-md mx-auto" data-testid="rating-selector">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                  <button
                    key={num}
                    onClick={() => setRating(num)}
                    onMouseEnter={() => setHoveredRating(num)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className={`relative flex flex-col items-center justify-center rounded-xl transition-all duration-300 py-3 sm:py-4 ${
                      rating === num
                        ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 scale-110 shadow-xl z-10"
                        : hoveredRating >= num
                          ? "bg-gray-100 dark:bg-gray-800 border-2 border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-300 scale-105"
                          : "bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"
                    }`}
                    data-testid={`button-rating-${num}`}
                  >
                    <span className="text-lg sm:text-xl font-bold">{num}</span>
                    {(rating === num || hoveredRating === num) && (
                      <span className="text-xs mt-0.5">{ratingEmojis[num]}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex justify-between text-xs text-muted-foreground px-1">
                <span>Not great</span>
                <span>Amazing!</span>
              </div>

              {rating > 0 && (
                <div className="text-center p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <span className="text-3xl mb-1 block">{ratingEmojis[rating]}</span>
                  <p className="text-sm font-medium">
                    {rating <= 3 && "We're sorry to hear that. Your feedback helps us improve."}
                    {rating >= 4 && rating <= 5 && "Thank you for your honesty. We want to do better."}
                    {rating >= 6 && rating <= 8 && "Good to hear! We're always striving to improve."}
                    {rating === 9 && "Wonderful! We're glad you had a great experience."}
                    {rating === 10 && "Amazing! Thank you for the perfect score!"}
                  </p>
                </div>
              )}

              <Button
                className="w-full h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white transition-all duration-300"
                disabled={rating === 0 || feedbackMutation.isPending}
                onClick={() => feedbackMutation.mutate()}
                data-testid="button-submit-rating"
              >
                {feedbackMutation.isPending ? (
                  <><Loader2 className="w-5 h-5 animate-spin mr-2" />Submitting...</>
                ) : (
                  <><ArrowRight className="w-5 h-5 mr-2" />Continue</>
                )}
              </Button>

              <div className="flex items-center justify-center gap-6 pt-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Under 2 min</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="w-3.5 h-3.5" />
                  <span>100% Private</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Confidential</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "improvement" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <MessageSquare className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-improvement-heading">
                  Help Us Improve
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your honest feedback is completely private and helps us deliver better service.
                </p>
              </div>

              <div>
                <Label className="text-sm font-semibold mb-3 block">What areas could we improve?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {improvementCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`p-3 rounded-xl text-sm text-left transition-all duration-200 border-2 ${
                        selectedCategories.includes(cat)
                          ? "bg-gray-100 dark:bg-gray-800 border-gray-900 dark:border-gray-100 font-semibold"
                          : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 text-foreground"
                      }`}
                      data-testid={`button-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <span className="flex items-center gap-2">
                        {selectedCategories.includes(cat) && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                        {cat}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="comments" className="font-semibold">Additional comments (optional)</Label>
                <Textarea
                  id="comments"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Tell us more about your experience..."
                  rows={4}
                  className="border-2"
                  data-testid="input-improvement-comments"
                />
              </div>

              <Button
                className="w-full h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                onClick={() => improvementMutation.mutate()}
                disabled={improvementMutation.isPending}
                data-testid="button-submit-improvement"
              >
                {improvementMutation.isPending ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...</>
                ) : (
                  <><ThumbsUp className="w-5 h-5 mr-2" /> Submit Feedback</>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3" />
                Your feedback is completely confidential
              </p>

              <Button
                variant="outline"
                className="w-full"
                disabled={saveImprovementMutation.isPending}
                onClick={() => (selectedCategories.length > 0 || comments.trim()) ? saveImprovementMutation.mutate() : setStep("describe")}
                data-testid="button-improvement-draft"
              >
                {saveImprovementMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Help me draft my honest review
              </Button>

              {reviewData?.googleProfileUrl && (
                <div className="pt-2 border-t space-y-3 text-center" data-testid="section-improvement-google-review">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    You're also welcome to share your experience publicly on Google. Every review helps other homeowners — and helps us improve.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full h-12 text-base font-bold border-2"
                    onClick={() => {
                      window.open(reviewData.googleProfileUrl, "_blank", "noopener,noreferrer");
    trackGoogleOpen();
                      completeFlowMutation.mutate();
                    }}
                    data-testid="button-improvement-google-review"
                  >
                    <ExternalLink className="w-5 h-5 mr-2" /> Leave a Google Review
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(() => {
          const progress = getStepProgress();
          if (!progress) return null;
          return (
            <div className="mb-4 px-1" data-testid="step-progress">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Step {progress.current} of {progress.total}</span>
                <span className="text-xs text-muted-foreground">{Math.round((progress.current / progress.total) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gray-900 dark:bg-white transition-all duration-500 ease-out"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          );
        })()}

        {step === "referral" && reviewData.referralOffer && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <Heart className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-referral-heading">
                  We Appreciate You!
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Your positive experience means everything to us. We'd love for you to share it in a Google review. Separately, if you know someone who needs work done, our referral program rewards referrals:
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gray-900 dark:bg-white flex items-center justify-center shrink-0">
                      <DollarSign className="w-7 h-7 text-white dark:text-gray-900" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-extrabold text-lg">Referral Offer</p>
                        <span className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-[10px] font-bold uppercase tracking-wider">Referral reward</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{reviewData.referralOffer}</p>
                    </div>
                  </div>
                </div>
              </div>

              <label htmlFor="referralOptIn" className="flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500 transition-colors cursor-pointer" data-testid="row-referral-optin">
                <Checkbox
                  id="referralOptIn"
                  checked={referralOptIn}
                  onCheckedChange={(c) => setReferralOptIn(!!c)}
                  className="mt-0.5"
                  data-testid="checkbox-referral-optin"
                />
                <span className="text-sm leading-relaxed font-medium">
                  Yes, I'm interested in the referral program! Send me details on how to earn.
                </span>
              </label>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12 border-2 text-muted-foreground"
                  onClick={() => { setReferralOptIn(false); setStep("referral_feedback"); }}
                  data-testid="button-skip-review"
                >
                  Maybe Later
                </Button>
                <Button
                  className="flex-1 h-12 font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                  onClick={() => setStep("referral_feedback")}
                  data-testid="button-leave-review"
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "referral_feedback" && reviewData.referralOffer && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <MessageSquare className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-referral-feedback-heading">
                  Quick Question About Our Referral Program
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  What do you think about the referral incentive we just shared?
                </p>
              </div>

              <div className="flex justify-center gap-4 sm:gap-6">
                <button
                  onClick={() => setReferralFeedback("up")}
                  className={`flex flex-col items-center gap-3 p-6 sm:p-8 rounded-2xl border-2 transition-all duration-300 ${
                    referralFeedback === "up"
                      ? "bg-gray-50 dark:bg-gray-800 border-gray-900 dark:border-white scale-105 shadow-lg"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
                  }`}
                  data-testid="button-referral-thumbs-up"
                >
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                    referralFeedback === "up" ? "bg-gray-900 dark:bg-white" : "bg-gray-100 dark:bg-gray-800"
                  }`}>
                    <ThumbsUp className={`w-7 h-7 ${referralFeedback === "up" ? "text-white dark:text-gray-900" : "text-muted-foreground"}`} />
                  </div>
                  <span className={`text-sm font-bold ${referralFeedback === "up" ? "" : "text-muted-foreground"}`}>Great Idea!</span>
                </button>
                <button
                  onClick={() => setReferralFeedback("down")}
                  className={`flex flex-col items-center gap-3 p-6 sm:p-8 rounded-2xl border-2 transition-all duration-300 ${
                    referralFeedback === "down"
                      ? "bg-gray-50 dark:bg-gray-800 border-gray-900 dark:border-white scale-105 shadow-lg"
                      : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500"
                  }`}
                  data-testid="button-referral-thumbs-down"
                >
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                    referralFeedback === "down" ? "bg-gray-900 dark:bg-white" : "bg-gray-100 dark:bg-gray-800"
                  }`}>
                    <ThumbsDown className={`w-7 h-7 ${referralFeedback === "down" ? "text-white dark:text-gray-900" : "text-muted-foreground"}`} />
                  </div>
                  <span className={`text-sm font-bold ${referralFeedback === "down" ? "" : "text-muted-foreground"}`}>Not For Me</span>
                </button>
              </div>

              {referralFeedback && (
                <div className="text-center p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                  <p className="text-sm text-muted-foreground">
                    {referralFeedback === "up" ? "Glad to hear it! We appreciate your enthusiasm." : "No worries at all! Your honest opinion helps us."}
                  </p>
                </div>
              )}

              <Button
                className="w-full h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                onClick={() => setStep("describe")}
                data-testid="button-continue-to-review"
              >
                <ArrowRight className="w-5 h-5 mr-2" />
                Continue to Leave a Review
              </Button>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  completeFlowMutation.mutate();
                }}
                disabled={completeFlowMutation.isPending}
                data-testid="button-skip-all"
              >
                {completeFlowMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Skip — I don't want to leave a review
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "describe" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <PenLine className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-describe-heading">
                  Tell Us About Your Project
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Describe your own experience, positive or negative. We can help edit your words into a draft for you to check before posting.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                <div className="flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold mb-1">Enhance Your Review with AI</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Not a wordsmith? No problem. Just describe what work was done in a sentence or two, and we'll generate a detailed, professional Google review you can edit before posting. You stay in control — we just help you say it better.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="highlights" className="font-semibold">What work was done? Any highlights?</Label>
                <Textarea
                  id="highlights"
                  value={highlights}
                  onChange={(e) => setHighlights(e.target.value)}
                  placeholder="e.g., They replaced our roof with architectural shingles, finished in 2 days, cleaned up everything. Great communication throughout."
                  rows={4}
                  className="border-2"
                  data-testid="input-review-highlights"
                />
                <p className="text-xs text-muted-foreground">
                  Examples: "New siding installation", "Kitchen remodel with quartz countertops", "Replaced 12 windows, very professional crew"
                </p>
              </div>

              <Button
                className="w-full h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                onClick={() => {
                  setStep("review");
                  generateMutation.mutate();
                }}
                disabled={!highlights.trim()}
                data-testid="button-generate-review"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                Generate My Review
              </Button>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground hover:text-foreground text-sm"
                onClick={() => {
                  setSkippedDescribe(true);
                  setStep("review");
                  track("track-review-method", { method: "own" });
                }}
                data-testid="button-skip-describe"
              >
                Skip — I'll write my own review
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "review" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <Sparkles className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-review-heading">
                  Leave Your Google Review
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Review the text below, edit it however you'd like, then copy and paste it into Google.
                </p>
              </div>

              {!generatedReview && generateMutation.isPending && (
                <div className="flex flex-col items-center gap-4 py-10">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-white animate-spin" />
                    <Sparkles className="w-5 h-5 text-gray-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <p className="text-sm text-muted-foreground animate-pulse font-medium">Generating your personalized review...</p>
                </div>
              )}

              {!generatedReview && !generateMutation.isPending && generateMutation.error && (
                <p role="alert" className="text-sm text-destructive text-center" data-testid="text-generate-error">
                  {generateMutation.error.message} You can use your own words below instead.
                </p>
              )}

              {!generatedReview && !generateMutation.isPending && (
                <div className="space-y-4">
                  {skippedDescribe ? (
                    <>
                      <p className="text-sm text-muted-foreground text-center leading-relaxed">
                        Write your review below, or describe a few words about your experience and let AI polish it for you.
                      </p>
                      <Textarea
                        value={highlights}
                        onChange={(e) => setHighlights(e.target.value)}
                        placeholder="e.g., Great communication, finished early, beautiful tile work, replaced our entire roof in two days..."
                        rows={5}
                        className="border-2"
                        data-testid="input-review-write-own"
                      />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                          onClick={acceptOwnWords}
                          disabled={!highlights.trim()}
                          data-testid="button-use-own-review"
                        >
                          <PenLine className="w-5 h-5 mr-2" />
                          Use My Review
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 h-12 text-base font-bold border-2"
                          onClick={() => generateMutation.mutate()}
                          disabled={!highlights.trim()}
                          data-testid="button-generate-review-retry"
                        >
                          <Sparkles className="w-5 h-5 mr-2" />
                          AI Polish
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Label className="font-semibold">Write your review or describe what you'd like mentioned:</Label>
                      <Textarea
                        value={highlights}
                        onChange={(e) => setHighlights(e.target.value)}
                        placeholder="e.g., Great communication, finished early, beautiful tile work..."
                        rows={3}
                        className="border-2"
                        data-testid="input-review-highlights-fallback"
                      />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                          onClick={acceptOwnWords}
                          disabled={!highlights.trim()}
                          data-testid="button-use-own-review"
                        >
                          <PenLine className="w-5 h-5 mr-2" />
                          Use My Review
                        </Button>
                        <Button
                          variant="outline"
                          className="flex-1 h-12 text-base font-bold border-2"
                          onClick={() => generateMutation.mutate()}
                          disabled={!highlights.trim()}
                          data-testid="button-generate-review-retry"
                        >
                          <Sparkles className="w-5 h-5 mr-2" />
                          {generateMutation.error ? "Try AI Again" : "Generate Review"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {generatedReview && (
                <div className="space-y-4">
                  <p className="text-sm font-bold text-center">Follow these steps to leave your review:</p>

                  {hasPhotos && (
                    <div className={`p-4 rounded-xl border-2 transition-all ${
                      photosDownloaded
                        ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
                        : "border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50"
                    }`}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                          photosDownloaded ? "bg-green-500" : "bg-gray-900 dark:bg-white dark:text-gray-900"
                        }`}>
                          {photosDownloaded ? <CheckCircle2 className="w-4 h-4" /> : "1"}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">
                            {photosDownloaded ? "Photos Ready to Upload!" : "Download Your Project Photos"}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-3 pl-11">
                        {companyName} has provided edited photos of your project, ready to post with your Google review. Reviews with photos get significantly more visibility and help other homeowners see the quality of work firsthand.
                      </p>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {photoItems.map((photo, i) => (
                          <div key={i} className="relative group rounded-lg overflow-hidden border-2 border-gray-200 dark:border-gray-700">
                            <img src={getPhotoUrl(photo)} alt={getPhotoName(photo, i)} className="w-full aspect-square object-cover" />
                            <a
                              href={getDownloadUrl(photo, i)}
                              download={getPhotoName(photo, i)}
                              className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1"
                              data-testid={`link-download-photo-${i}`}
                            >
                              <Download className="w-5 h-5 text-white" />
                              <span className="text-[9px] text-white/80 px-1 truncate max-w-full">{getPhotoName(photo, i)}</span>
                            </a>
                          </div>
                        ))}
                      </div>
                      {!photosDownloaded && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-2"
                          onClick={() => {
                            photoItems.forEach((photo, i) => {
                              const a = document.createElement("a");
                              a.href = getDownloadUrl(photo, i);
                              a.download = getPhotoName(photo, i);
                              a.click();
                            });
                            setPhotosDownloaded(true);
                            track("track-photos");
                          }}
                          data-testid="button-download-all-photos"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download All Photos
                        </Button>
                      )}
                      {photosDownloaded && (
                        <p className="text-xs text-green-600 dark:text-green-400 text-center font-semibold flex items-center justify-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Photos saved! Upload these when you paste your review on Google.
                        </p>
                      )}
                    </div>
                  )}

                  <div className={`p-4 rounded-xl border-2 transition-all ${
                    photosPending
                      ? "border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 opacity-50"
                      : copied
                        ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10"
                        : "border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/50"
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                        copied ? "bg-green-500" : photosPending ? "bg-gray-300 dark:bg-gray-600" : "bg-gray-900 dark:bg-white dark:text-gray-900"
                      }`}>
                        {copied ? <CheckCircle2 className="w-4 h-4" /> : hasPhotos ? "2" : "1"}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          {copied ? "Review Copied to Clipboard!" : "Copy Your Review"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {photosPending ? "Download your photos first" : "Edit it however you'd like, then copy"}
                        </p>
                      </div>
                    </div>

                    <div className="relative mb-3">
                      <Textarea
                        ref={reviewBox}
                        value={generatedReview}
                        onChange={(e) => {
                          setGeneratedReview(e.target.value);
                          setCopied(false);
                        }}
                        rows={7}
                        className="text-sm leading-relaxed border-2"
                        disabled={photosPending}
                        data-testid="textarea-generated-review"
                      />
                    </div>
                    {copyError && (
                      <p role="alert" className="mb-3 text-xs text-destructive" data-testid="text-copy-review-error">
                        Your browser blocked automatic copying. Select the review text above and copy it yourself (Ctrl+C, ⌘C on Mac, or long-press and choose Copy), then open Google and paste it.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={handleCopyReview}
                        disabled={photosPending}
                        className={`flex-1 h-10 font-bold ${copied ? "bg-green-500 hover:bg-green-600" : photosPending ? "bg-gray-200 dark:bg-gray-700 text-muted-foreground cursor-not-allowed" : "bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900"} text-white`}
                        data-testid="button-copy-review"
                      >
                        {copied ? (
                          <><CheckCircle2 className="w-4 h-4 mr-2" />Copied!</>
                        ) : (
                          <><Copy className="w-4 h-4 mr-2" />Copy Review</>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 border-2"
                        disabled={photosPending}
                        onClick={() => {
                          setGeneratedReview("");
                          setCopied(false);
                          setCopyError(false);
                          generateMutation.mutate();
                        }}
                        title="Regenerate"
                        data-testid="button-regenerate"
                      >
                        <Sparkles className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className={`p-4 rounded-xl border-2 transition-all ${
                    copied || copyError
                      ? "border-gray-900 dark:border-white bg-gray-50 dark:bg-gray-800/50"
                      : "border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50"
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        copied || copyError ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "bg-gray-300 dark:bg-gray-600 text-white"
                      }`}>
                        {hasPhotos ? "3" : "2"}
                      </div>
                      <div>
                        <p className={`font-semibold text-sm ${!copied && !copyError ? "text-muted-foreground" : ""}`}>
                          Open Google & Paste Your Review
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {copied ? "You're ready! Click below to open Google." : copyError ? "Copy the review text yourself, then click below to open Google." : "Copy the review first to unlock this step."}
                        </p>
                      </div>
                    </div>

                    <Button
                      className={`w-full h-12 font-bold ${copied || copyError ? "bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white" : "bg-gray-200 dark:bg-gray-700 text-muted-foreground cursor-not-allowed"}`}
                      onClick={handleGoogleClick}
                      disabled={completeFlowMutation.isPending}
                      data-testid="button-open-google-review"
                    >
                      {completeFlowMutation.isPending ? (
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      ) : (
                        <ExternalLink className="w-5 h-5 mr-2" />
                      )}
                      Open Google & Leave Review
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === "bonus_reviews" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto">
                  <Award className="w-8 h-8 text-gray-500" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-bonus-reviews-heading">
                  You're Amazing! One More Thing...
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Since you had such an incredible experience, would you consider sharing your review on other platforms too?
                </p>
              </div>

              <div className="space-y-3">
                <a
                  href="https://www.bbb.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 hover:shadow-lg hover:scale-[1.02] transition-all duration-300 group"
                  data-testid="link-bbb-review"
                >
                  <div className="w-14 h-14 rounded-xl bg-gray-900 dark:bg-white flex items-center justify-center shrink-0">
                    <span className="text-white dark:text-gray-900 font-black text-lg">BBB</span>
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-base">Better Business Bureau</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">BBB reviews carry serious credibility with homeowners researching contractors.</p>
                  </div>
                  <ExternalLink className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </a>

              </div>

              <div className="bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold">Multi-Platform Reviews Make a Huge Difference</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Having reviews on both Google and BBB makes {companyName} stand out as a trusted professional and boosts search rankings!
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                Tip: You can paste the same review you copied earlier — just adjust it slightly for each platform.
              </p>

              <Button
                className="w-full h-12 text-base font-bold bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white"
                onClick={() => setStep("done")}
                data-testid="button-finish-bonus-reviews"
              >
                <CheckCircle2 className="w-5 h-5 mr-2" />
                I'm All Done — Thank You!
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "done" && (
          <Card className="border shadow-lg overflow-hidden">
            <CardContent className="p-8 sm:p-10 text-center space-y-5">
              <div className="relative inline-block">
                <div className="w-24 h-24 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-12 h-12 text-green-500" />
                </div>
              </div>
              <h2 className="text-3xl font-extrabold" data-testid="text-thank-you">
                Thank You!
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto">
                Your feedback means the world to us. {referralOptIn && "We'll be in touch about the referral program!"}
              </p>
              <p className="text-sm text-muted-foreground">
                You can close this page now.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col items-center gap-3 mt-8">
          <div className="flex items-center justify-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
            <img src="/chub-logo-square-text.png" alt="ConstructHUB" className="w-6 h-6 rounded" />
            <span className="text-xs text-muted-foreground">Powered by <strong>ConstructHUB</strong></span>
          </div>
          <a
            href={`/review/${token}/unsubscribe`}
            className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            data-testid="link-unsubscribe"
          >
            Unsubscribe from future emails
          </a>
        </div>
      </div>

      {showPhotoReminder && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPhotoReminder(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Camera className="w-5 h-5 text-gray-500" />
                Don't Forget Your Photos!
              </h3>
              <button onClick={() => setShowPhotoReminder(false)} className="text-muted-foreground hover:text-foreground" data-testid="button-close-photo-reminder">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {companyName} provided edited project photos for you. Reviews with photos get significantly more visibility on Google and help other homeowners see the quality of work.
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {photoItems.slice(0, 4).map((photo, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                  <img src={getPhotoUrl(photo)} alt={getPhotoName(photo, i)} className="w-full aspect-square object-cover" />
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-2"
                onClick={() => {
                  setShowPhotoReminder(false);
                  setPhotosSkipped(true);
                  void copyReview();
                }}
                data-testid="button-skip-photos"
              >
                Skip Photos
              </Button>
              <Button
                className="flex-1 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white font-bold"
                onClick={() => {
                  photoItems.forEach((photo, i) => {
                    const a = document.createElement("a");
                    a.href = getDownloadUrl(photo, i);
                    a.download = getPhotoName(photo, i);
                    a.click();
                  });
                  setPhotosDownloaded(true);
                  track("track-photos");
                  setShowPhotoReminder(false);
                  void copyReview();
                }}
                data-testid="button-download-and-continue"
              >
                <Download className="w-4 h-4 mr-2" />
                Download & Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {showCopyWarning && (
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowCopyWarning(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Wait — Copy Your Review First!
              </h3>
              <button onClick={() => setShowCopyWarning(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You haven't copied the review to your clipboard yet. You'll need it when Google opens so you can paste it.
            </p>
            <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border-2 border-gray-200 dark:border-gray-700">
              <p className="text-xs text-muted-foreground line-clamp-3">{generatedReview}</p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-2"
                onClick={handleSkipAndGo}
                data-testid="button-skip-copy"
              >
                I'll write my own
              </Button>
              <Button
                className="flex-1 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 dark:text-gray-900 text-white font-bold"
                onClick={handleCopyAndGo}
                data-testid="button-copy-and-go"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy & Go
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
