/**
 * The close-out reward (owner, 2026-10-17): a burst of confetti over the whole screen with "Congrats — a job has
 * been closed out!" for the person who did it. A small canvas of our own — no library. Settings → Celebrations
 * turns it off for the company (org customFields.celebrations, default on); the caller checks that.
 */
import { useEffect, useRef } from "react";
import { PartyPopper } from "lucide-react";

const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#f97316", "#facc15"];

type Piece = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string; shape: 0 | 1 };

function burst(canvas: HTMLCanvasElement, onDone: () => void): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) { onDone(); return () => {}; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  ctx.scale(dpr, dpr);
  // Two cannons at the bottom corners spraying up and in, plus a shower from the top.
  const pieces: Piece[] = [];
  const add = (x: number, y: number, angle: number, spread: number, speed: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.5 + Math.random());
      pieces.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)], shape: Math.random() < 0.3 ? 1 : 0,
      });
    }
  };
  // About five seconds of it (owner): the corner cannons fire again every ¾ s for the first 3½ s, the top keeps
  // showering until the last second, and everything fades out over the final second. Phones get a lighter load.
  const scale = W < 640 ? 0.6 : 1;
  const TOTAL = 300, FADE_FROM = 240;
  const shot = () => {
    add(0, H, -Math.PI / 3, 0.8, 18, Math.round(70 * scale));
    add(W, H, -2 * Math.PI / 3, 0.8, 18, Math.round(70 * scale));
    add(W / 2, H, -Math.PI / 2, 1.2, 16, Math.round(40 * scale));
  };
  shot();
  add(W / 2, -10, Math.PI / 2, 2.2, 5, Math.round(80 * scale));
  let raf = 0, frames = 0, stopped = false;
  const tick = () => {
    if (stopped) return;
    frames++;
    if (frames % 45 === 0 && frames <= 210) shot();
    if (frames % 6 === 0 && frames < FADE_FROM) add(Math.random() * W, -10, Math.PI / 2, 1.6, 4, Math.round(4 * scale));
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of pieces) {
      p.vy += 0.35; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 20) continue;
      alive++;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = frames > FADE_FROM ? Math.max(0, 1 - (frames - FADE_FROM) / (TOTAL - FADE_FROM)) : 1;
      if (p.shape) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if ((alive || frames < FADE_FROM) && frames < TOTAL) raf = requestAnimationFrame(tick); else onDone();
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

/** Mount it to fire once; it calls `onDone` when the pieces have fallen (about 5 s) or the person taps it away. */
export function ConfettiCelebration({ title = "Congrats — a job has been closed out!", subtitle, onDone }: {
  title?: string; subtitle?: string | null; onDone: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }
    return burst(ref.current, onDone);
  }, [onDone]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" role="status" aria-live="polite" onClick={onDone} data-testid="confetti-celebration">
      <canvas ref={ref} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none relative mx-4 flex items-center gap-3 rounded-2xl border bg-background/95 px-5 py-4 shadow-xl animate-in fade-in zoom-in-95">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><PartyPopper className="h-6 w-6" aria-hidden="true" /></span>
        <div>
          <p className="text-base font-bold">{title}</p>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
