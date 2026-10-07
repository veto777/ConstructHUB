/**
 * JobCam upload queue — every capture lands in IndexedDB first (the Blob
 * included), then a single background loop uploads it part by part through
 * the resumable API. A lost connection, a closed tab or a killed web view
 * leaves the queue intact: on the next open the loop asks the server which
 * parts already arrived and sends only the rest.
 *
 *   queued → uploading (parts) → processing (server) → done | failed (retry)
 *
 * Direct-to-R2 part PUTs are used when the server hands out presigned URLs;
 * if the browser can't complete one (bucket CORS not set, offline), the same
 * part goes through the API proxy URL instead. XHR is used for the PUTs so
 * progress is real, not guessed.
 */
import { jobcamFetch } from "./jobcam-api";

export type QueueStatus = "queued" | "uploading" | "processing" | "done" | "failed";

export type QueueItem = {
  id: string;
  createdAt: number;
  projectId: string;
  projectName: string | null;
  file: Blob;
  fileName: string;
  mime: string;
  bytes: number;
  kind: "photo" | "video";
  meta: {
    capturedAt: string | null;
    deviceLat: number | null;
    deviceLng: number | null;
    gpsAccuracyM: number | null;
    tags: string[];
    durationS: number | null;
    width: number | null;
    height: number | null;
    stamp: { time?: boolean; gps?: boolean } | null;
    caption: string | null;
  };
  status: QueueStatus;
  uploadId: string | null;
  mediaId: string | null;
  partsDone: number[];
  attempts: number;
  error: string | null;
  updatedAt: number;
};

export type QueueView = QueueItem & { progress: number };

const DB_NAME = "jobcam";
const STORE = "queue";
const MAX_ATTEMPTS = 8;

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result: T | undefined;
    const r = fn(store);
    if (r) { r.onsuccess = () => { result = r.result; }; }
    t.oncomplete = () => resolve(result as T);
    t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
  }));
}

const listAll = () => tx<QueueItem[]>("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>);
const putItem = (it: QueueItem) => tx<void>("readwrite", (s) => { s.put(it); });
const delItem = (id: string) => tx<void>("readwrite", (s) => { s.delete(id); });

// ── In-memory mirror + subscribers ──────────────────────────────────────────

const progress = new Map<string, number>();
let cache: QueueItem[] = [];
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }

async function refresh() {
  try { cache = (await listAll()).sort((a, b) => a.createdAt - b.createdAt); } catch { cache = []; }
  emit();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  if (cache.length === 0) void refresh();
  return () => { listeners.delete(listener); };
}

export function queueSnapshot(): QueueView[] {
  return cache.map((it) => ({ ...it, progress: it.status === "done" ? 1 : it.status === "processing" ? 1 : progress.get(it.id) ?? (it.partsDone.length ? it.partsDone.length / Math.max(1, Math.ceil(it.bytes / (5 * 1024 * 1024))) : 0) }));
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function enqueueUpload(file: Blob, args: {
  projectId: string; projectName?: string | null; fileName: string; mime: string; kind: "photo" | "video";
  meta: Partial<QueueItem["meta"]>;
}): Promise<QueueItem> {
  const it: QueueItem = {
    id: (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    createdAt: Date.now(), projectId: args.projectId, projectName: args.projectName ?? null,
    file, fileName: args.fileName, mime: args.mime, bytes: file.size, kind: args.kind,
    meta: {
      capturedAt: null, deviceLat: null, deviceLng: null, gpsAccuracyM: null, tags: [], durationS: null, width: null, height: null, stamp: null, caption: null,
      ...args.meta,
    },
    status: "queued", uploadId: null, mediaId: null, partsDone: [], attempts: 0, error: null, updatedAt: Date.now(),
  };
  await putItem(it);
  await refresh();
  void startQueue();
  return it;
}

export async function retryUpload(id: string): Promise<void> {
  const it = cache.find((x) => x.id === id);
  if (!it) return;
  await putItem({ ...it, status: "queued", attempts: 0, error: null, updatedAt: Date.now() });
  await refresh();
  void startQueue();
}

export async function removeUpload(id: string): Promise<void> {
  const it = cache.find((x) => x.id === id);
  if (it?.uploadId && it.status !== "done" && it.status !== "processing") {
    jobcamFetch(`/api/crm/jobcam/uploads/${it.uploadId}`, { method: "DELETE" }).catch(() => {});
  }
  await delItem(id);
  progress.delete(id);
  await refresh();
}

export async function clearFinished(): Promise<void> {
  for (const it of cache) if (it.status === "done") await delItem(it.id);
  await refresh();
}

// ── The loop ────────────────────────────────────────────────────────────────

let running = false;
let wake: (() => void) | null = null;

export async function startQueue(): Promise<void> {
  if (running) { wake?.(); return; }
  running = true;
  try {
    await refresh();
    while (true) {
      const next = cache.find((it) => it.status === "queued" || it.status === "uploading");
      if (!next) break;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await new Promise<void>((resolve) => {
          const done = () => { window.removeEventListener("online", done); resolve(); };
          wake = done;
          window.addEventListener("online", done);
          setTimeout(done, 30_000);
        });
        continue;
      }
      await uploadOne(next);
      await refresh();
    }
  } finally {
    running = false;
    wake = null;
  }
}

type PartTarget = { n: number; url: string; proxyUrl: string };

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void): Promise<{ etag: string | null; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (url.startsWith("/")) xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let etag = xhr.getResponseHeader("ETag");
        if (!etag && url.startsWith("/")) { try { etag = JSON.parse(xhr.responseText).etag ?? null; } catch { /* proxy answered without JSON */ } }
        resolve({ etag, status: xhr.status });
      } else reject(new Error(`PUT ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.timeout = 10 * 60_000;
    xhr.send(body);
  });
}

async function uploadOne(item: QueueItem): Promise<void> {
  let it = { ...item, status: "uploading" as QueueStatus, attempts: item.attempts + 1, updatedAt: Date.now() };
  await putItem(it); await refresh();
  try {
    let partSize = 5 * 1024 * 1024, partsTotal = Math.max(1, Math.ceil(it.bytes / partSize));
    let targets: PartTarget[] = [];
    // Resume if the server still has the upload; otherwise open a new one.
    if (it.uploadId) {
      try {
        const st = await jobcamFetch<any>(`/api/crm/jobcam/uploads/${it.uploadId}`);
        if (st.status === "completed") { await finish(it, st.mediaId); return; }
        if (st.status !== "open" || st.expired) it = { ...it, uploadId: null, mediaId: null, partsDone: [] };
        else { partSize = st.partSize; partsTotal = st.partsTotal; targets = st.parts; it.partsDone = st.partsDone; }
      } catch (e: any) {
        if (/^404/.test(String(e?.message))) it = { ...it, uploadId: null, mediaId: null, partsDone: [] };
        else throw e;
      }
    }
    if (!it.uploadId) {
      const created = await jobcamFetch<any>("/api/crm/jobcam/uploads", {
        method: "POST",
        json: {
          projectId: it.projectId, fileName: it.fileName, mime: it.mime, bytes: it.bytes,
          durationS: it.meta.durationS, width: it.meta.width, height: it.meta.height,
          capturedAt: it.meta.capturedAt, deviceLat: it.meta.deviceLat, deviceLng: it.meta.deviceLng, gpsAccuracyM: it.meta.gpsAccuracyM,
          tags: it.meta.tags, caption: it.meta.caption, stamp: it.meta.stamp,
        },
      });
      it = { ...it, uploadId: created.uploadId, mediaId: created.mediaId, partsDone: [] };
      partSize = created.partSize; partsTotal = created.partsTotal; targets = created.parts;
      await putItem(it);
    }
    const doneSet = new Set(it.partsDone);
    const perPart = new Map<number, number>();
    const report = () => {
      let loaded = 0;
      for (let n = 1; n <= partsTotal; n++) {
        if (doneSet.has(n)) loaded += n < partsTotal ? partSize : it.bytes - (partsTotal - 1) * partSize;
        else loaded += perPart.get(n) ?? 0;
      }
      progress.set(it.id, Math.min(0.99, loaded / Math.max(1, it.bytes)));
      emit();
    };
    for (const t of targets.sort((a, b) => a.n - b.n)) {
      if (doneSet.has(t.n)) continue;
      const start = (t.n - 1) * partSize;
      const body = it.file.slice(start, Math.min(it.bytes, start + partSize));
      let etag: string | null = null;
      let viaProxy = t.url === t.proxyUrl;
      if (!viaProxy) {
        try {
          const r = await putPart(t.url, body, (l) => { perPart.set(t.n, l); report(); });
          etag = r.etag;
          if (!etag) viaProxy = true;      // CORS didn't expose ETag — redo through the API
        } catch {
          viaProxy = true;
        }
      }
      if (viaProxy) {
        const r = await putPart(t.proxyUrl, body, (l) => { perPart.set(t.n, l); report(); });
        etag = r.etag;
      } else {
        await jobcamFetch(`/api/crm/jobcam/uploads/${it.uploadId}/parts/${t.n}`, { method: "POST", json: { etag } });
      }
      doneSet.add(t.n);
      it = { ...it, partsDone: [...doneSet].sort((a, b) => a - b), updatedAt: Date.now() };
      await putItem(it);
      report();
    }
    const media = await jobcamFetch<any>(`/api/crm/jobcam/uploads/${it.uploadId}/complete`, { method: "POST", json: {} });
    await finish(it, media.id);
  } catch (e: any) {
    const msg = String(e?.message || e);
    // A refused file (415/413/402/404) will never succeed — park it as failed at once.
    const fatal = /^(400|402|404|413|415):/.test(msg);
    const failed = fatal || it.attempts >= MAX_ATTEMPTS;
    await putItem({ ...it, status: failed ? "failed" : "queued", error: msg.replace(/^\d{3}:\s*/, "").slice(0, 300), updatedAt: Date.now() });
    if (!failed) await new Promise((r) => setTimeout(r, Math.min(60_000, 1000 * 2 ** it.attempts)));
  }
}

async function finish(it: QueueItem, mediaId: string) {
  progress.delete(it.id);
  // Keep the Blob out of the finished record — the server has it now.
  await putItem({ ...it, file: new Blob([]), mediaId, status: "processing", error: null, updatedAt: Date.now() });
  await refresh();
  void watchProcessing(it.id, mediaId);
}

/** Poll the media row until the server has made its renditions (or gave up). */
async function watchProcessing(id: string, mediaId: string) {
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 1500 : 5000));
    try {
      const m = await jobcamFetch<any>(`/api/crm/jobcam/media/${mediaId}`);
      if (m.status === "ready") {
        const it = cache.find((x) => x.id === id);
        if (it) await putItem({ ...it, status: "done", updatedAt: Date.now() });
        await refresh();
        return;
      }
      if (m.status === "failed") {
        const it = cache.find((x) => x.id === id);
        if (it) await putItem({ ...it, status: "failed", error: m.error || "Processing failed", updatedAt: Date.now() });
        await refresh();
        return;
      }
    } catch { /* keep polling; the row may be mid-write */ }
  }
}

/** The app shell calls this once so a reopened tab resumes what it owes. */
export function bootJobcamQueue(): void {
  if (typeof window === "undefined") return;
  void refresh().then(() => {
    // Items the server was processing when we closed: re-check them.
    for (const it of cache) if (it.status === "processing" && it.mediaId) void watchProcessing(it.id, it.mediaId);
    void startQueue();
  });
  window.addEventListener("online", () => void startQueue());
}
