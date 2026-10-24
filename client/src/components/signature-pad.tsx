/**
 * A signature box: draw with a finger, mouse or pen, or type the name and adopt it as a script signature.
 * Reports a PNG data URL (transparent background) or null while empty. Used by the proposal page (/proposal/<token>).
 */
import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SCRIPT_FONT = `"Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", cursive`;

export function SignaturePad({ name, onChange, className }: { name: string; onChange: (dataUrl: string | null) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(false);
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [hasInk, setHasInk] = useState(false);

  const ctx = () => {
    const c = canvas.current;
    if (!c) return null;
    const g = c.getContext("2d");
    if (!g) return null;
    g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0f172a"; g.lineWidth = 2.4 * (c.width / c.clientWidth || 1);
    return g;
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    ink.current = false;
    setHasInk(false);
    onChange(null);
  };

  // Typed mode: the name drawn in a script face, refreshed as it is edited.
  useEffect(() => {
    if (mode !== "type") return;
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.clearRect(0, 0, c.width, c.height);
    const text = name.trim();
    if (!text) { setHasInk(false); onChange(null); return; }
    let size = Math.round(c.height * 0.5);
    g.fillStyle = "#0f172a"; g.textBaseline = "middle";
    do { g.font = `${size}px ${SCRIPT_FONT}`; size -= 2; } while (g.measureText(text).width > c.width * 0.9 && size > 12);
    g.fillText(text, c.width * 0.05, c.height * 0.55);
    setHasInk(true);
    onChange(c.toDataURL("image/png"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, name]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode !== "draw") return;
    const g = ctx();
    const p = point(e);
    if (!g || !last.current) return;
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
    last.current = p;
    if (!ink.current) { ink.current = true; setHasInk(true); }
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvas.current && ink.current) onChange(canvas.current.toDataURL("image/png"));
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={mode === "draw" ? "default" : "outline"} onClick={() => { setMode("draw"); clear(); }} data-testid="button-signature-draw">
          <PenLine className="mr-1.5 h-3.5 w-3.5" /> Draw
        </Button>
        <Button type="button" size="sm" variant={mode === "type" ? "default" : "outline"} onClick={() => setMode("type")} data-testid="button-signature-type">
          <Type className="mr-1.5 h-3.5 w-3.5" /> Use my typed name
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { if (mode === "type") setMode("draw"); clear(); }} disabled={!hasInk} data-testid="button-signature-clear">
          <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear
        </Button>
      </div>
      <div className="relative rounded-lg border-2 border-dashed bg-white">
        <canvas ref={canvas} width={900} height={240} className="block h-[120px] w-full touch-none select-none sm:h-[150px]"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature box" data-testid="canvas-signature" />
        <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-300" aria-hidden="true" />
        {!hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            {mode === "draw" ? "Sign here with your finger, mouse or pen" : "Type your full name above"}
          </p>
        )}
      </div>
    </div>
  );
}
