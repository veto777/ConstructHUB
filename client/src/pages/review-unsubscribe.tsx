import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { Mail, MessageSquare, CheckCircle, Star, Heart, ArrowRight } from "lucide-react";

function FloatingParticles() {
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
        ctx.fillStyle = "#d4d4d8";
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
  }, []);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />;
}

export default function ReviewUnsubscribePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<"convince" | "feedback" | "done">("convince");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/review/${token}/unsubscribe-info`)
      .then(r => r.json())
      .then(data => { setInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  async function handleUnsubscribe() {
    setSubmitting(true);
    try {
      await apiRequest("POST", `/api/review/${token}/unsubscribe`, { feedback: feedback || undefined });
      setStep("done");
    } catch {
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <FloatingParticles />
        <div className="animate-pulse text-muted-foreground relative z-10">Loading...</div>
      </div>
    );
  }

  if (!info || info.message) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <FloatingParticles />
        <Card className="max-w-md w-full mx-4 relative z-10">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">This link is no longer valid.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (info.unsubscribed || step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <FloatingParticles />
        <Card className="max-w-md w-full mx-4 relative z-10">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold" data-testid="text-unsubscribed">You've been unsubscribed</h2>
            <p className="text-muted-foreground">
              You won't receive any more reminder emails from {info.companyName}.
              {feedback && " Thank you for sharing your feedback — it truly helps us improve."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "feedback") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 p-4">
        <FloatingParticles />
        <Card className="max-w-lg w-full relative z-10">
          <CardContent className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <MessageSquare className="h-12 w-12 text-gray-400 mx-auto" />
              <h2 className="text-2xl font-bold">Before you go...</h2>
              <p className="text-muted-foreground">
                Could you share a quick note about your experience with {info.companyName}? This is completely private and helps us improve.
              </p>
            </div>

            <Textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="What could we have done better? Any suggestions or concerns..."
              rows={4}
              className="resize-none"
              data-testid="input-unsubscribe-feedback"
            />

            <div className="space-y-3">
              <Button
                onClick={handleUnsubscribe}
                disabled={submitting}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white"
                data-testid="button-submit-feedback-unsubscribe"
              >
                {submitting ? "Processing..." : feedback ? "Submit Feedback & Unsubscribe" : "Unsubscribe Without Feedback"}
              </Button>

              <button
                onClick={() => setStep("convince")}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-back-to-convince"
              >
                Go Back
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 p-4">
      <FloatingParticles />
      <Card className="max-w-lg w-full relative z-10">
        <CardContent className="p-8 space-y-6">
          <div className="text-center space-y-3">
            <Mail className="h-12 w-12 text-gray-400 mx-auto" />
            <h2 className="text-2xl font-bold">
              {info.clientName}, wait!
            </h2>
            <p className="text-lg text-muted-foreground">
              {info.companyName} values your opinion
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
              <Star className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Your feedback matters</p>
                <p className="text-sm text-muted-foreground">Good or bad — your honest experience helps us deliver better results for future clients.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
              <Heart className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">It takes less than 2 minutes</p>
                <p className="text-sm text-muted-foreground">Just rate your experience from 1-10. That's it. No lengthy forms or obligations.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
              <MessageSquare className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">100% private</p>
                <p className="text-sm text-muted-foreground">Ratings below 8 stay private and are only used internally to improve our service.</p>
              </div>
            </div>
          </div>

          <a
            href={`/review/${token}`}
            className="flex items-center justify-center gap-2 w-full py-3 px-6 rounded-lg bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white font-semibold text-lg transition-colors"
            data-testid="link-leave-feedback"
          >
            Leave Quick Feedback
            <ArrowRight className="h-5 w-5" />
          </a>

          <div className="pt-4 border-t text-center">
            <button
              onClick={() => setStep("feedback")}
              className="text-sm text-muted-foreground hover:text-foreground underline transition-colors"
              data-testid="button-still-unsubscribe"
            >
              I still want to unsubscribe
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
