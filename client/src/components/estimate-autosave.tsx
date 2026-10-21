import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";
import {
  autosavePayload, offersPayload, clearDraftMirror, draftHasContent, draftMirrorKey, readDraftMirror, writeDraftMirror,
  type DraftMirror, type EstimateDraftSnapshot,
} from "@shared/estimate-draft";

/**
 * Autosave for the New estimate dialog (shared/estimate-draft.ts has the rules):
 *  - every change is mirrored to localStorage at once (survives a refresh, a crash or a failed save);
 *  - once the form has content, the estimate is created ONCE on the server as a draft (autosave: true,
 *    no email/SMS), then PATCHed ~2 s after the last change, and at once on blur / tab hidden / close;
 *  - "Saving…" / "Saved · just now" / "Not saved — kept on this device" for the indicator.
 */
export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export function useEstimateAutosave(opts: {
  orgId: string | null | undefined;
  customerId: string | null | undefined;
  open: boolean;
  snapshot: EstimateDraftSnapshot;
  /** Turn off while the final "Create estimate" is in flight. */
  paused?: boolean;
}) {
  const { orgId, customerId, open, snapshot, paused } = opts;
  const key = orgId && customerId ? draftMirrorKey(orgId, customerId) : null;
  const [draftId, setDraftIdState] = useState<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const setDraftId = (id: string | null) => { draftIdRef.current = id; setDraftIdState(id); };
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const savedJson = useRef<string>("");
  const savedOffersJson = useRef<string>("");
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContent = draftHasContent(snapshot);

  // Mirror every change synchronously (cheap, and it is what a refresh restores).
  useEffect(() => {
    if (!key || !open) return;
    if (!hasContent && !draftIdRef.current) return;
    writeDraftMirror(key, { ...snapshot, draftId: draftIdRef.current, open: true });
  }, [key, open, hasContent, JSON.stringify(snapshot), draftId]);

  /** Save now; resolves to the server draft's id, or null when it could not be saved (or there is nothing yet). */
  const saveNow = useCallback(async (): Promise<string | null> => {
    if (!customerId || paused) return draftIdRef.current;
    if (inflight.current) { await inflight.current; }
    const snap = snapRef.current;
    if (!draftHasContent(snap) && !draftIdRef.current) return null;
    const body = autosavePayload(snap);
    const json = JSON.stringify(body);
    const offersSame = !snap.offers || JSON.stringify(offersPayload(snap.offers)) === savedOffersJson.current;
    if (json === savedJson.current && offersSame && draftIdRef.current) return draftIdRef.current;
    let ok = false;
    const run = (async () => {
      setStatus("saving");
      try {
        if (!draftIdRef.current) {
          const created = await (await apiRequest("POST", "/api/crm/estimates", { customerId, ...body, autosave: true })).json();
          setDraftId(created.id);
        } else if (json !== savedJson.current) {
          await apiRequest("PATCH", `/api/crm/estimates/${draftIdRef.current}`, body);
        }
        savedJson.current = json;
        // The discount offers the client will be able to choose (crm_estimate_discounts), when they changed.
        if (snap.offers) {
          const offersJson = JSON.stringify(offersPayload(snap.offers));
          if (offersJson !== savedOffersJson.current) {
            await apiRequest("PUT", `/api/crm/estimates/${draftIdRef.current}/discounts`, { offers: offersPayload(snap.offers) });
            savedOffersJson.current = offersJson;
          }
        }
        setSavedAt(Date.now());
        setStatus("saved");
        setError(null);
        ok = true;
        if (key) writeDraftMirror(key, { ...snapRef.current, draftId: draftIdRef.current, open: true });
      } catch (e: any) {
        setStatus("error");
        setError(apiErrorMessage(e));
      }
    })();
    inflight.current = run;
    try { await run; } finally { if (inflight.current === run) inflight.current = null; }
    return ok ? draftIdRef.current : null;
  }, [customerId, paused, key]);

  // Debounced autosave, ~2 s after the last change.
  useEffect(() => {
    if (!open || paused || !customerId) return;
    if (!hasContent && !draftIdRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [open, paused, customerId, hasContent, JSON.stringify(snapshot), saveNow]);

  // Leaving the tab / window: save at once.
  useEffect(() => {
    if (!open) return;
    const onHide = () => { if (document.visibilityState === "hidden") void saveNow(); };
    const onBlur = () => void saveNow();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onBlur);
    };
  }, [open, saveNow]);

  /** The mirror left by an earlier session for this client, if any. */
  const readMirror = useCallback((): DraftMirror | null => (key ? readDraftMirror(key) : null), [key]);

  /** Start from a restored draft (mirror or server). */
  const adopt = useCallback((id: string | null, savedBody?: EstimateDraftSnapshot) => {
    setDraftId(id);
    savedJson.current = savedBody ? JSON.stringify(autosavePayload(savedBody)) : "";
    savedOffersJson.current = savedBody?.offers ? JSON.stringify(offersPayload(savedBody.offers)) : "";
    setStatus(id ? "saved" : "idle");
    setSavedAt(id ? Date.now() : null);
  }, []);

  /** Forget everything (after Create, or Discard). */
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (key) clearDraftMirror(key);
    setDraftId(null);
    savedJson.current = "";
    savedOffersJson.current = "";
    setStatus("idle");
    setError(null);
    setSavedAt(null);
  }, [key]);

  /** Mark the mirror closed but keep it (the server draft stays as a draft). */
  const keepClosed = useCallback(() => {
    if (key) clearDraftMirror(key);
  }, [key]);

  return { draftId, status, error, savedAt, hasContent, saveNow, readMirror, adopt, reset, keepClosed };
}

/** "Saving…" / "Saved · just now" / "Saved · 3 min ago" / "Not saved — kept on this device". */
export function AutosaveIndicator({ status, savedAt, error }: { status: AutosaveStatus; savedAt: number | null; error: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (status === "idle") return null;
  let text = "";
  if (status === "saving") text = "Saving…";
  else if (status === "error") text = `Not saved to the server${error ? ` (${error})` : ""} — kept on this device`;
  else if (savedAt) {
    const mins = Math.floor((Date.now() - savedAt) / 60_000);
    text = `Saved as draft · ${mins < 1 ? "just now" : `${mins} min ago`}`;
  }
  return (
    <span className={`text-xs ${status === "error" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
      data-testid="text-autosave-status" aria-live="polite">{text}</span>
  );
}

const FULLSCREEN_KEY = (who: string) => `ch:estimate-dialog-fullscreen:${who}`;

/** The dialog's maximize/restore choice, remembered per user on this device. */
export function useDialogFullscreen(who: string | null | undefined) {
  const k = FULLSCREEN_KEY(who || "me");
  const [full, setFull] = useState<boolean>(() => {
    try { return window.localStorage.getItem(k) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { setFull(window.localStorage.getItem(k) === "1"); } catch { /* blocked */ }
  }, [k]);
  const toggle = () => setFull((f) => {
    const next = !f;
    try { window.localStorage.setItem(k, next ? "1" : "0"); } catch { /* blocked */ }
    return next;
  });
  return { full, toggle };
}

export function FullscreenToggle({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle}
      className="absolute right-12 top-[calc(1rem+var(--safe-top,0px))] rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"}
      data-testid="button-estimate-fullscreen">
      {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
  );
}
