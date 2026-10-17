/**
 * The homeowner's review page (pages/review-feedback.tsx): when the contractor
 * attached no photos to a request sent to one of their CRM clients, the
 * homeowner picks which of their OWN project photos to add to the Google
 * review. Everything goes through the request's token
 * (server/crm/photo-library.ts registerReviewProjectPhotoRoutes); a request
 * typed by hand (no linked client) or a client without photos shows nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Offered = { id: string; stage: "progress" | "finished" | null; thumbUrl: string; url: string };
export type ChosenPhoto = { url: string; originalName: string };

// 5–10 photos (owner rule); the server takes at most 10 (HOMEOWNER_PICK_MAX).
const MIN = 5;
const MAX = 10;

export function ReviewPhotoChooser({ token, companyName, onChosen }: {
  token: string; companyName: string; onChosen: (photos: ChosenPhoto[]) => void;
}) {
  const { data } = useQuery<{ available: boolean; photos: Offered[]; selected: string[] }>({
    queryKey: [`/api/review/${token}/project-photos`],
    queryFn: async () => {
      const r = await fetch(`/api/review/${encodeURIComponent(token)}/project-photos`);
      if (!r.ok) return { available: false, photos: [], selected: [] };
      return r.json();
    },
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!data?.available || !data.photos.length) return null;
  // At least 5, or every photo when the job has fewer.
  const need = Math.min(MIN, data.photos.length);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < MAX) next.add(id);
    return next;
  });
  const save = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/review/${encodeURIComponent(token)}/project-photos`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...picked] }),
      });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.message || "Could not save your photos.");
      onChosen(out.photos as ChosenPhoto[]);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-gray-300 bg-gray-50/50 p-4 dark:border-gray-600 dark:bg-gray-800/50" data-testid="section-choose-project-photos">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold">Add photos of your project (optional)</p>
      </div>
      <p className="mb-3 pl-11 text-xs leading-relaxed text-muted-foreground">
        These are the photos {companyName} has of your project. Tap {Math.min(MIN, data.photos.length) === data.photos.length ? "the ones" : `${Math.min(MIN, data.photos.length)} to ${Math.min(MAX, data.photos.length)}`} you'd like to download and add to your review.
      </p>
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="grid-choose-project-photos">
        {data.photos.map((p) => {
          const on = picked.has(p.id);
          return (
            <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 ${on ? "border-green-500 ring-2 ring-green-500/30" : "border-gray-200 dark:border-gray-700"}`}
              data-testid={`button-choose-photo-${p.id}`}>
              <img src={p.thumbUrl} alt="Project photo" loading="lazy" className="h-full w-full object-cover" />
              {on && <span className="absolute right-1 top-1 rounded-full bg-green-500 text-white"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>}
              {p.stage === "finished" && <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 px-1 text-[9px] font-semibold uppercase text-white">Finished</span>}
            </button>
          );
        })}
      </div>
      {error && <p className="mb-2 text-xs text-red-600" role="alert">{error}</p>}
      <Button className="w-full" variant="outline" onClick={save} disabled={picked.size < need || busy} data-testid="button-use-chosen-photos">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {picked.size >= need ? `Use ${picked.size} photo${picked.size === 1 ? "" : "s"}` : picked.size ? `Pick ${need - picked.size} more` : "Tap photos to choose"}
      </Button>
    </div>
  );
}
