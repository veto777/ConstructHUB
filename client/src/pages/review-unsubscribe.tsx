import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { Mail, CheckCircle, ArrowRight } from "lucide-react";

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
  const [step, setStep] = useState<"confirm" | "done">("confirm");
  const [feedback, setFeedback] = useState("");
  const [resubscribed, setResubscribed] = useState(false);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/review/${token}/unsubscribe-info`)
      .then(r => r.json())
      .then(data => { setInfo(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  async function handleUnsubscribe() {
    setSubmitting(true);
    setActionError("");
    try {
      await apiRequest("POST", `/api/review/${token}/unsubscribe`, { feedback: feedback.trim() || undefined });
      setStep("done");
    } catch {
      setActionError("We couldn’t unsubscribe you just now. Please try again.");
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

  if (info.unsubscribed || step === "done" || resubscribed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <FloatingParticles />
        <Card className="max-w-md w-full mx-4 relative z-10">
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold" data-testid="text-unsubscribed">{resubscribed ? "You have resubscribed" : "You’ve been unsubscribed"}</h2>
            <p className="text-muted-foreground">
              {resubscribed ? `You can receive future review requests from ${info.companyName}. Previous requests will stay stopped.` : `You won’t receive future review requests or reminders from ${info.companyName}.`}
              {feedback.trim() && ` Thank you — ${info.companyName} will see your note.`}
            </p>
            {!resubscribed && <Button variant="outline" disabled={submitting} onClick={async () => {
              setSubmitting(true); setActionError("");
              try { await apiRequest("POST", `/api/review/${token}/resubscribe`, { confirm: true }); setResubscribed(true); }
              catch { setActionError("Unable to resubscribe. Open your email link while signed out and try again."); }
              finally { setSubmitting(false); }
            }}>Resubscribe to future review requests</Button>}
            {actionError && <p role="alert">{actionError}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // One screen, one action: unsubscribing never requires a detour through a
  // feedback form. The note is optional and rating the job is a side link.
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 p-4">
      <FloatingParticles />
      <Card className="max-w-lg w-full relative z-10">
        <CardContent className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <Mail className="h-12 w-12 text-gray-400 mx-auto" />
            <h2 className="text-2xl font-bold" data-testid="text-unsubscribe-heading">Unsubscribe from review requests</h2>
            <p className="text-muted-foreground">
              {info.clientName ? `${info.clientName}, you` : "You"}’ll stop receiving review requests and reminders from {info.companyName}.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="unsubscribe-feedback" className="text-sm font-medium block">
              Anything you’d like {info.companyName} to know? <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="unsubscribe-feedback"
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="What could they have done better?"
              rows={3}
              className="resize-none"
              data-testid="input-unsubscribe-feedback"
            />
            <p className="text-xs text-muted-foreground">Private to {info.companyName}. It is not posted anywhere.</p>
          </div>

          <Button
            onClick={handleUnsubscribe}
            disabled={submitting}
            className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-gray-100 dark:hover:bg-gray-200 dark:text-gray-900 text-white"
            data-testid="button-submit-feedback-unsubscribe"
          >
            {submitting ? "Processing..." : feedback.trim() ? "Send Note & Unsubscribe" : "Unsubscribe"}
          </Button>
          {actionError && <p role="alert" className="text-sm text-destructive text-center">{actionError}</p>}

          <div className="pt-4 border-t text-center space-y-1">
            <p className="text-sm text-muted-foreground">Changed your mind? You can still rate your experience.</p>
            <a
              href={`/review/${token}`}
              className="inline-flex items-center gap-1 text-sm font-medium underline"
              data-testid="link-leave-feedback"
            >
              Leave quick feedback instead
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
