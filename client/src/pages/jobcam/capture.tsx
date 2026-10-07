/**
 * JobCam camera — mobile first, full-bleed (no app chrome), works in iOS
 * Safari and the WKWebView app shells.
 *
 *   - Project is pre-selected: ?project=<id>, else the nearest project to the
 *     phone (real coordinates only: the project's own lat/lng or where its
 *     media was shot), with a picker sheet for everything else.
 *   - Photos: a getUserMedia viewfinder + canvas capture when the browser
 *     allows it; otherwise the native camera through <input capture>.
 *   - Video: the native recorder through <input capture> (full quality,
 *     survives backgrounding); in-page MediaRecorder as the "record here"
 *     option where supported, capped at 10 minutes.
 *   - Tags stick for the session; every shot carries time + device GPS;
 *     the stamp preference is non-destructive (rendered at view/share time).
 *   - Every capture goes into the IndexedDB queue first (lib/jobcam-queue.ts),
 *     so a lost connection or a killed tab never loses a shot.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Camera, ChevronDown, Grid3X3, Images, Loader2, MapPin, RefreshCw, Search, Video, X, Zap, ZapOff, Circle, Square, Check,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GoogleList, GoogleListRow, GooglePill } from "@/components/google";
import { useToast } from "@/hooks/use-toast";
import { enqueueUpload, bootJobcamQueue } from "@/lib/jobcam-queue";
import { distanceLabel, type JobcamProjectOption } from "@/lib/jobcam-api";
import { TagPicker } from "@/components/jobcam/tag-picker";
import { UploadTray } from "@/components/jobcam/upload-tray";
import { useJobcamQueue } from "@/components/jobcam/use-queue";
import { cn } from "@/lib/utils";
import { JobcamUpgradeCard, useJobcamAccess } from "@/components/jobcam/upgrade-card";
import { StorageFullNotice, useJobcamStorage } from "@/components/jobcam/storage-meter";
import { formatJobcamUsage } from "@shared/jobcam-storage";

type Mode = "photo" | "video";
type Position = { lat: number; lng: number; accuracy: number; at: number } | null;

const TAGS_KEY = "jobcam.tags";
const STAMP_KEY = "jobcam.stamp";
const MAX_RECORD_MS = 10 * 60 * 1000;

const readJson = <T,>(store: Storage, key: string, fallback: T): T => {
  try { const raw = store.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};

function CaptureCamera() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const wantedProject = params.get("project");

  const [mode, setMode] = useState<Mode>("photo");
  const [tags, setTags] = useState<string[]>(() => readJson<string[]>(sessionStorage, TAGS_KEY, []));
  const [stamp, setStamp] = useState<{ time: boolean; gps: boolean }>(() => readJson(localStorage, STAMP_KEY, { time: true, gps: true }));
  const [grid, setGrid] = useState(false);
  const [position, setPosition] = useState<Position>(null);
  const [geoDenied, setGeoDenied] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(wantedProject);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [streamOk, setStreamOk] = useState<boolean | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [recording, setRecording] = useState<{ since: number } | null>(null);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const queue = useJobcamQueue();

  useEffect(() => { bootJobcamQueue(); }, []);
  useEffect(() => { sessionStorage.setItem(TAGS_KEY, JSON.stringify(tags)); }, [tags]);
  useEffect(() => { localStorage.setItem(STAMP_KEY, JSON.stringify(stamp)); }, [stamp]);

  // ── Device GPS: watched while the camera is open, attached to every shot ──
  useEffect(() => {
    if (!("geolocation" in navigator)) { setGeoDenied(true); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      () => setGeoDenied(true),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ── Projects, nearest first once the phone knows where it is ──────────────
  const projectsKey = position ? `/api/crm/jobcam/projects?lat=${position.lat.toFixed(5)}&lng=${position.lng.toFixed(5)}` : "/api/crm/jobcam/projects";
  const { data: projectsData, isLoading: projectsLoading } = useQuery<{ projects: JobcamProjectOption[]; located: boolean }>({ queryKey: [projectsKey] });
  const projects = projectsData?.projects ?? [];
  const project = projects.find((p) => p.id === projectId) ?? null;
  useEffect(() => {
    if (projectId || !projectsData) return;
    const nearest = projects.find((p) => p.distanceM != null);
    if (nearest) setProjectId(nearest.id);
    else setPickerOpen(true);
  }, [projectsData, projectId, projects]);
  const filteredProjects = useMemo(() => {
    const n = pickerQ.trim().toLowerCase();
    return n ? projects.filter((p) => [p.name, p.number, p.address, p.customerName].some((s) => s?.toLowerCase().includes(n))) : projects;
  }, [projects, pickerQ]);

  // ── Viewfinder ────────────────────────────────────────────────────────────
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  const startStream = useCallback(async (withAudio = false) => {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) { setStreamOk(false); return null; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: withAudio,
      });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
      const caps: any = s.getVideoTracks()[0]?.getCapabilities?.() ?? {};
      setTorch(caps.torch ? false : null);
      setStreamOk(true);
      return s;
    } catch {
      setStreamOk(false);
      return null;
    }
  }, [facing, stopStream]);
  useEffect(() => { void startStream(false); return stopStream; }, [startStream, stopStream]);
  useEffect(() => {
    const onVis = () => { if (document.hidden) stopStream(); else if (!recording) void startStream(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [startStream, stopStream, recording]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [recording]);

  const toggleTorch = async () => {
    const track: any = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { /* not on this device */ }
  };

  const gpsMeta = () => position ? { deviceLat: position.lat, deviceLng: position.lng, gpsAccuracyM: position.accuracy } : { deviceLat: null, deviceLng: null, gpsAccuracyM: null };

  const add = async (blob: Blob, args: { fileName: string; mime: string; kind: "photo" | "video"; capturedAt?: string | null; durationS?: number | null; width?: number | null; height?: number | null }) => {
    if (!project) { setPickerOpen(true); toast({ title: "Pick a project first", description: "Every shot lands in a job." }); return; }
    await enqueueUpload(blob, {
      projectId: project.id, projectName: project.name, fileName: args.fileName, mime: args.mime, kind: args.kind,
      meta: { ...gpsMeta(), tags, stamp, capturedAt: args.capturedAt ?? new Date().toISOString(), durationS: args.durationS ?? null, width: args.width ?? null, height: args.height ?? null, caption: null },
    });
    if (args.kind === "photo") {
      if (lastShot) URL.revokeObjectURL(lastShot);
      setLastShot(URL.createObjectURL(blob));
    }
  };

  // ── Photo: canvas capture from the live stream, else the native camera ────
  const snap = async () => {
    const v = videoRef.current;
    if (!streamOk || !v || !v.videoWidth) { photoInputRef.current?.click(); return; }
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d")!;
      if (facing === "user") { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("Could not read the camera frame");
      const stamp = new Date();
      await add(blob, { fileName: `JobCam ${stamp.toISOString().replace(/[:T]/g, "-").slice(0, 19)}.jpg`, mime: "image/jpeg", kind: "photo", width: canvas.width, height: canvas.height, capturedAt: stamp.toISOString() });
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e: any) {
      toast({ title: "Capture failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // ── Video: in-page recording where supported ──────────────────────────────
  const recorderSupported = typeof MediaRecorder !== "undefined" && (MediaRecorder.isTypeSupported?.("video/mp4") || MediaRecorder.isTypeSupported?.("video/webm"));
  const startRecording = async () => {
    const s = await startStream(true);
    if (!s || !recorderSupported) { videoInputRef.current?.click(); return; }
    const mime = MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm";
    const rec = new MediaRecorder(s, { mimeType: mime });
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    const since = Date.now();
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      setRecording(null);
      void startStream(false);
      if (blob.size) void add(blob, { fileName: `JobCam ${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.${mime === "video/mp4" ? "mp4" : "webm"}`, mime, kind: "video", durationS: (Date.now() - since) / 1000 });
    };
    recorderRef.current = rec;
    rec.start(1000);
    setRecording({ since });
    setTimeout(() => { if (recorderRef.current === rec && rec.state === "recording") rec.stop(); }, MAX_RECORD_MS);
  };
  const stopRecording = () => { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); };

  // ── Picked files (native camera or the library) ───────────────────────────
  const onFiles = async (files: FileList | null, kindHint?: "photo" | "video") => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "photo" : kindHint ?? "photo";
      let durationS: number | null = null;
      if (kind === "video") durationS = await probeDuration(f);
      await add(f, { fileName: f.name || `JobCam.${kind === "video" ? "mp4" : "jpg"}`, mime: f.type || (kind === "video" ? "video/mp4" : "image/jpeg"), kind, durationS, capturedAt: f.lastModified ? new Date(f.lastModified).toISOString() : null });
    }
    toast({ title: files.length === 1 ? "Added to the upload queue" : `${files.length} added to the upload queue` });
  };

  const back = () => navigate(project ? `/crm/projects/${project.id}/jobcam` : "/crm/jobcam");
  const active = queue.filter((q) => q.status !== "done").length;
  const recSeconds = recording ? Math.floor((Date.now() - recording.since) / 1000) : 0;
  void tick;

  return (
    <div className="g-surface fixed inset-0 z-[60] flex flex-col bg-black text-white" data-testid="jobcam-capture">
      {/* Hidden inputs: the reliable camera path on every phone. */}
      <input ref={photoInputRef} type="file" accept="image/jpeg,image/png" capture="environment" className="hidden" data-testid="jobcam-input-photo"
        onChange={(e) => { void onFiles(e.target.files, "photo"); e.target.value = ""; }} />
      <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" capture="environment" className="hidden" data-testid="jobcam-input-video"
        onChange={(e) => { void onFiles(e.target.files, "video"); e.target.value = ""; }} />
      <input ref={libraryInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm" className="hidden" data-testid="jobcam-input-library"
        onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />

      {/* Top bar */}
      <header className="flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2">
        <button type="button" onClick={back} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-black/40" aria-label="Close camera" data-testid="jobcam-close"><X className="h-5 w-5" /></button>
        <button type="button" onClick={() => setPickerOpen(true)} data-testid="jobcam-project-chip"
          className="flex-1 min-w-0 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-black/40 backdrop-blur px-3 h-10 text-left">
          <MapPin className="h-4 w-4 shrink-0 text-[#8ab4f8]" />
          <span className="truncate text-[13px] font-medium">{project ? project.name : projectsLoading ? "Finding the nearest job…" : "Choose a project"}</span>
          {project?.distanceM != null && <span className="text-[11px] text-white/60 shrink-0">{distanceLabel(project.distanceM)}</span>}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
        </button>
        <TagPicker value={tags} onChange={setTags} dark testId="jobcam-capture-tags" align="end" />
      </header>

      {/* Viewfinder */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className={cn("absolute inset-0 h-full w-full object-cover", facing === "user" && "scale-x-[-1]", streamOk === false && "hidden")} />
        {streamOk === false && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
            <Camera className="h-10 w-10 opacity-60" />
            <p className="text-sm">The live preview isn't available here — the shutter opens your phone's camera instead.</p>
          </div>
        )}
        {streamOk === null && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin opacity-60" /></div>}
        {grid && (
          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="border border-white/25" />)}
          </div>
        )}
        {/* Non-destructive stamp preview: what a viewer/share page can overlay. */}
        {(stamp.time || stamp.gps) && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/50 px-2 py-1 text-[11px] font-mono text-white/90" data-testid="jobcam-stamp-preview">
            {stamp.time && <div>{new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
            {stamp.gps && <div>{position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} ±${Math.round(position.accuracy)}m` : geoDenied ? "GPS off" : "GPS…"}</div>}
          </div>
        )}
        {recording && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 h-8 text-[13px] font-semibold tabular-nums" data-testid="jobcam-recording">
            <span className="h-2 w-2 rounded-full bg-white animate-pulse" /> {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")}
          </div>
        )}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          {torch !== null && (
            <button type="button" onClick={() => void toggleTorch()} className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-black/40" aria-label="Flashlight" data-testid="jobcam-torch">
              {torch ? <Zap className="h-5 w-5 text-yellow-300" /> : <ZapOff className="h-5 w-5" />}
            </button>
          )}
          <button type="button" onClick={() => setGrid((g) => !g)} className={cn("h-10 w-10 inline-flex items-center justify-center rounded-full bg-black/40", grid && "text-[#8ab4f8]")} aria-label="Grid" aria-pressed={grid} data-testid="jobcam-grid"><Grid3X3 className="h-5 w-5" /></button>
          <button type="button" onClick={() => setStamp((s) => ({ ...s, time: !(s.time || s.gps), gps: !(s.time || s.gps) }))} className={cn("h-10 w-10 inline-flex items-center justify-center rounded-full bg-black/40 text-[10px] font-bold", (stamp.time || stamp.gps) && "text-[#8ab4f8]")} aria-label="Time and GPS stamp" aria-pressed={stamp.time || stamp.gps} data-testid="jobcam-stamp-toggle">GPS</button>
        </div>
        {active > 0 && (
          <div className="absolute left-3 right-3 bottom-3"><UploadTray dark compact /></div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-3">
        <div className="flex justify-center">
          <div className="inline-flex rounded-full bg-white/10 p-1" role="radiogroup" aria-label="Mode">
            {(["photo", "video"] as Mode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { if (!recording) setMode(m); }} data-testid={`jobcam-mode-${m}`}
                className={cn("inline-flex items-center gap-1.5 rounded-full px-4 h-8 text-[13px] font-semibold capitalize", mode === m ? "bg-white text-black" : "text-white/80")}>
                {m === "photo" ? <Camera className="h-4 w-4" /> : <Video className="h-4 w-4" />} {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => lastShot && project ? navigate(`/crm/projects/${project.id}/jobcam`) : libraryInputRef.current?.click()} data-testid="jobcam-last-shot"
            className="h-14 w-14 rounded-xl overflow-hidden bg-white/10 border border-white/20 inline-flex items-center justify-center" aria-label={lastShot ? "Open the project feed" : "Upload from your library"}>
            {lastShot ? <img src={lastShot} alt="" className="h-full w-full object-cover" /> : <Images className="h-6 w-6 opacity-80" />}
          </button>
          {mode === "photo" ? (
            <button type="button" onClick={() => void snap()} disabled={busy || !project} aria-label="Take photo" data-testid="jobcam-shutter"
              className="h-[76px] w-[76px] rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40">
              <span className="h-[62px] w-[62px] rounded-full bg-white" />
            </button>
          ) : recording ? (
            <button type="button" onClick={stopRecording} aria-label="Stop recording" data-testid="jobcam-stop"
              className="h-[76px] w-[76px] rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform">
              <Square className="h-7 w-7 fill-red-600 text-red-600" />
            </button>
          ) : (
            <button type="button" onClick={() => videoInputRef.current?.click()} disabled={!project} aria-label="Record video with the phone camera" data-testid="jobcam-record"
              className="h-[76px] w-[76px] rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40">
              <Circle className="h-[62px] w-[62px] fill-red-600 text-red-600" />
            </button>
          )}
          <button type="button" onClick={() => { setFacing((f) => (f === "environment" ? "user" : "environment")); }} disabled={!!recording} aria-label="Flip camera" data-testid="jobcam-flip"
            className="h-14 w-14 rounded-full bg-white/10 inline-flex items-center justify-center disabled:opacity-40"><RefreshCw className="h-6 w-6" /></button>
        </div>
        {mode === "video" && !recording && recorderSupported && streamOk && (
          <div className="flex justify-center">
            <GooglePill size="sm" icon={Video} label="Record here instead (up to 10 min)" onClick={() => void startRecording()} className="!bg-white/10 !border-white/20 !text-white" testId="jobcam-record-inpage" />
          </div>
        )}
        <p className="text-center text-[11px] text-white/50">
          {project ? <>Shooting into <span className="text-white/80">{project.name}</span>{tags.length ? ` · ${tags.join(", ")}` : ""}</> : "Choose a project to start"}
          {geoDenied && " · location off"}
        </p>
      </div>

      {/* Project picker */}
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent side="bottom" className="g-surface max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]" data-testid="jobcam-project-picker">
          <SheetHeader className="text-left"><SheetTitle>Which job?</SheetTitle></SheetHeader>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search projects, addresses, clients" className="g-input pl-9" data-testid="jobcam-project-search" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {position ? "Nearest first." : geoDenied ? "Turn on location to sort by distance." : "Finding your location…"}
          </p>
          {projectsLoading ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
            <GoogleList className="mt-1">
              {filteredProjects.slice(0, 100).map((p) => (
                <GoogleListRow key={p.id} size="md" title={p.name} onOpen={() => { setProjectId(p.id); setPickerOpen(false); }} testId={`jobcam-project-${p.id}`}
                  meta={[p.customerName, p.address, p.distanceM != null ? distanceLabel(p.distanceM) : null, p.mediaCount ? `${p.mediaCount} shots` : null]}
                  trailing={p.id === projectId ? <Check className="h-5 w-5 text-primary" /> : null} />
              ))}
              {!filteredProjects.length && <p className="py-8 text-center text-sm text-muted-foreground">No projects match.</p>}
            </GoogleList>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => { URL.revokeObjectURL(url); resolve(d); };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    v.src = url;
  });
}

/**
 * The camera only opens for a workspace that has JobCam and room to store a
 * shot. Otherwise the same full-screen surface says why: the upgrade card (no
 * JobCam on the CRM plan) or "Storage full" with the next size and the request
 * button. A device that already holds unsent shots keeps them either way.
 */
export default function JobcamCapturePage() {
  const [, navigate] = useLocation();
  const access = useJobcamAccess();
  const storage = useJobcamStorage(!access.loading && access.entitled);
  const shell = (children: React.ReactNode, testId: string) => (
    <div className="g-surface fixed inset-0 z-[60] flex flex-col bg-black text-white" data-testid={testId}>
      <header className="flex items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+8px)] pb-2">
        <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/crm/jobcam"))}
          className="h-10 w-10 inline-flex items-center justify-center rounded-full bg-white/10" aria-label="Close camera" data-testid="jobcam-close"><X className="h-5 w-5" /></button>
        <span className="text-sm font-medium">JobCam</span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col justify-center gap-4">{children}</div>
    </div>
  );
  if (access.loading || (access.entitled && storage.isLoading)) {
    return shell(<div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin opacity-60" /></div>, "jobcam-capture-loading");
  }
  if (!access.entitled) return shell(<div className="g-surface rounded-2xl bg-background text-foreground"><JobcamUpgradeCard /></div>, "jobcam-capture-upgrade");
  if (storage.data?.full) {
    return shell(
      <>
        <div className="rounded-2xl border border-white/15 bg-white/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm"><Camera className="h-5 w-5 opacity-70" /><span className="tabular-nums" data-testid="jobcam-capture-storage-label">{formatJobcamUsage(storage.data.bytes, storage.data.tierGb)} used</span></div>
          <div className="h-1.5 rounded-full bg-white/15 overflow-hidden"><div className="h-full w-full rounded-full bg-red-500" /></div>
          <StorageFullNotice usage={storage.data} dark />
        </div>
        <UploadTray dark />
      </>,
      "jobcam-capture-storage-full",
    );
  }
  return <CaptureCamera />;
}
