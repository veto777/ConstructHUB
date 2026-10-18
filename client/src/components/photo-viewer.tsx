/**
 * Tap a photo → it opens full size over the page (not a download). Arrows / swipe / ←→ keys step through the set,
 * Esc or the X closes, and a small Download button saves the original.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, ImageIcon, X } from "lucide-react";

export type ViewerPhoto = { id: string; src: string | null; downloadUrl: string; name: string; label?: string | null };

export function PhotoViewer({ photos, index, onIndex, onClose }: {
  photos: ViewerPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const p = photos[index];
  const touch = useRef<number | null>(null);
  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={p.name} data-testid="photo-viewer"
      onClick={onClose}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current; touch.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}>
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-white" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 text-sm">
          <span className="font-medium">{index + 1} / {photos.length}</span>
          {p.label && <span className="ml-2 rounded bg-white/15 px-1.5 py-0.5 text-xs">{p.label}</span>}
        </div>
        <div className="flex items-center gap-1">
          <a href={p.downloadUrl} download className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-medium hover:bg-white/20"
            data-testid="photo-viewer-download" onClick={(e) => e.stopPropagation()}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />Download
          </a>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-white/15" aria-label="Close" data-testid="photo-viewer-close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        {p.src ? (
          <img src={p.src} alt={p.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} data-testid="photo-viewer-image" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-white/80" onClick={(e) => e.stopPropagation()}>
            <ImageIcon className="h-10 w-10" aria-hidden="true" />
            <p className="text-sm">No preview for this format — use Download.</p>
          </div>
        )}
        {photos.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); go(-1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); go(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
