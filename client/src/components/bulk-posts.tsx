/**
 * Bulk posts — a folder of photos becomes one Google post a day (owner 2026-10-15: "dump 300 photos and the algo
 * actually takes a photo a day and gives it a snappy description for google posts and submits daily at random
 * times"). Its own section, apart from the composer. Server: server/gbp/bulk-posts.ts.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Pause, Play, Square, Upload } from "lucide-react";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Section, Notice } from "@/components/app-ui";
import { InfoTip } from "@/components/info-tip";
import { useToast } from "@/hooks/use-toast";
import { BrandIcon } from "@/components/brand-icon";

type Item = { id: number; position: number; photo_id: number | null; source_name: string | null; due_at: string | null; status: string; caption: string | null; error: string | null; photo_url: string | null };
type Run = { id: number; name: string; source: string; sourceLabel: string; status: string; every_days: number; start_on: string; timezone: string; open_hour: number; close_hour: number; total: number; imported: number; error: string | null; counts: Record<string, number>; next: string | null; items: Item[] };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function BulkPosts({ locationId }: { locationId: number }) {
  const { toast } = useToast();
  const base = `/api/gbp/content/${locationId}/bulk-posts`;
  const runs = useQuery<{ runs: Run[]; workerEnabled: boolean; fileloaded: boolean }>({ queryKey: [base], refetchInterval: 30000 });
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"library" | "fileloaded" | "dropbox">("library");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [slug, setSlug] = useState(""), [key, setKey] = useState(""), [checked, setChecked] = useState<{ count: number; sample: string[] } | null>(null);
  const [dropbox, setDropbox] = useState("");
  const [everyDays, setEveryDays] = useState(1), [startOn, setStartOn] = useState(tomorrow());
  const [openHour, setOpenHour] = useState(9), [closeHour, setCloseHour] = useState(17), [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [instructions, setInstructions] = useState("");
  const [progress, setProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [base] });

  const check = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/check-fileloaded`, { slug, key })).json(),
    onSuccess: (r) => setChecked(r),
    onError: (e: Error) => { setChecked(null); toast({ title: "FileLoaded", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  const start = useMutation({
    mutationFn: async () => {
      let photoIds: number[] = [];
      if (source === "library") {
        if (!files.length) throw new Error("Choose the photos first");
        for (let i = 0; i < files.length; i++) {
          setProgress(`Uploading ${i + 1} of ${files.length}…`);
          const fd = new FormData();
          fd.append("photo", files[i]); fd.append("pattern", "{business}-{n}"); fd.append("index", String(i));
          const r = await fetch(`/api/gbp/content/${locationId}/upload`, { method: "POST", body: fd, credentials: "include" });
          const photo = await r.json();
          if (!r.ok) throw new Error(photo.message || `Upload failed on photo ${i + 1}`);
          photoIds.push(photo.id);
        }
      }
      setProgress("Starting the run…");
      const body = { name: name.trim() || `Photos from ${new Date().toLocaleDateString()}`, source, photoIds, everyDays, startOn, timezone, openHour, closeHour, weekdays, instructions,
        ...(source === "fileloaded" ? { fileloaded: { slug, key } } : {}), ...(source === "dropbox" ? { dropbox: { url: dropbox } } : {}) };
      return (await apiRequest("POST", base, body)).json();
    },
    onSuccess: (r: Run) => {
      setProgress(""); setOpen(false); setFiles([]); setName(""); setChecked(null); setKey(""); setDropbox("");
      if (fileInput.current) fileInput.current.value = "";
      refresh();
      toast({ title: "Bulk posts started", description: r.status === "importing" ? "Photos are being pulled in now; the schedule appears once they are all here." : `${r.total} posts planned, the first on ${when(r.next)}.` });
    },
    onError: (e: Error) => { setProgress(""); toast({ title: "Could not start bulk posts", description: apiErrorMessage(e), variant: "destructive" }); },
  });

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "pause" | "resume" | "cancel" }) => (await apiRequest("POST", `${base}/${id}/${action}`)).json(),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast({ title: "Bulk posts", description: apiErrorMessage(e), variant: "destructive" }),
  });

  const hourOptions = Array.from({ length: 24 }, (_, h) => h);
  const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : h === 24 ? "midnight" : `${h - 12} PM`);
  const busy = start.isPending;

  return (
    <Section title={<span className="inline-flex items-center gap-1">Bulk posts <InfoTip k="bulk-posts" /></span>} contentClassName="space-y-4 text-sm" testId="bulk-posts">
      <p className="text-muted-foreground">Drop a folder of photos and the listing gets one post a day, each with a short caption written from the photo, published at a random time inside your window. Runs for as long as the photos last.</p>
      {runs.data && !runs.data.workerEnabled && <Notice tone="warning">The publishing worker is off, so bulk posts will wait until it is enabled.</Notice>}

      {!open ? (
        <Button onClick={() => setOpen(true)} data-testid="button-new-bulk-run"><Upload className="mr-2 h-4 w-4" /> Start a bulk run</Button>
      ) : (
        <fieldset disabled={busy} className="space-y-4 rounded-xl border bg-card p-4">
          <legend className="px-1 font-medium">New bulk run</legend>
          <label className="block">Name (optional)<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring roofing jobs" maxLength={120} /></label>

          <div className="space-y-2">
            <p className="font-medium">Where are the photos?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={source === "library" ? "secondary" : "outline"} onClick={() => setSource("library")} data-testid="bulk-source-library"><Upload className="mr-2 h-4 w-4" />Upload from this device</Button>
              {runs.data?.fileloaded && <Button type="button" variant={source === "fileloaded" ? "secondary" : "outline"} onClick={() => setSource("fileloaded")} data-testid="bulk-source-fileloaded">FileLoaded project</Button>}
              <Button type="button" variant={source === "dropbox" ? "secondary" : "outline"} onClick={() => setSource("dropbox")} data-testid="bulk-source-dropbox"><BrandIcon brand="dropbox" className="mr-2 h-4 w-4" />Dropbox shared link</Button>
            </div>
            {source === "library" && (
              <div className="space-y-1">
                <Input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 400))} data-testid="bulk-files" />
                <p className="text-xs text-muted-foreground">{files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} chosen` : "Up to 400 photos, 15 MB each. They are uploaded when you start the run."}</p>
              </div>
            )}
            {source === "fileloaded" && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block">Project name<Input value={slug} onChange={(e) => { setSlug(e.target.value); setChecked(null); }} placeholder="the project's slug" /></label>
                  <label className="block">Project key<Input type="password" value={key} onChange={(e) => { setKey(e.target.value); setChecked(null); }} placeholder="flp_… from the project's Key panel" autoComplete="off" /></label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!slug || !key || check.isPending} onClick={() => check.mutate()}>{check.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Check the project</Button>
                  {checked && <span className="text-xs text-muted-foreground">{checked.count} photo{checked.count === 1 ? "" : "s"} found{checked.sample.length ? ` — ${checked.sample.join(", ")}${checked.count > checked.sample.length ? ", …" : ""}` : ""}</span>}
                </div>
                <p className="text-xs text-muted-foreground">The key is stored encrypted and used only to download these photos. Photos post in filename order, so number them if the order matters.</p>
              </div>
            )}
            {source === "dropbox" && (
              <div className="space-y-1">
                <Input value={dropbox} onChange={(e) => setDropbox(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/… (a shared folder link)" />
                <p className="text-xs text-muted-foreground">In Dropbox: right-click the folder → Share → Copy link, anyone with the link can view. The folder is downloaded once; up to 400 MB.</p>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">Post every
              <select className="mt-1 block w-full min-h-10 rounded-lg border bg-background p-2" value={everyDays} onChange={(e) => setEveryDays(Number(e.target.value))}>
                {[1, 2, 3, 7, 14].map((d) => <option key={d} value={d}>{d === 1 ? "day" : d === 7 ? "week" : d === 14 ? "two weeks" : `${d} days`}</option>)}
              </select>
            </label>
            <label className="block">First post on<Input className="mt-1" type="date" value={startOn} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setStartOn(e.target.value)} /></label>
            <div className="block">Posting window <span className="text-xs text-muted-foreground">({timezone})</span>
              <div className="mt-1 flex items-center gap-2">
                <select className="min-h-10 rounded-lg border bg-background p-2" value={openHour} onChange={(e) => setOpenHour(Number(e.target.value))}>{hourOptions.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
                <span>to</span>
                <select className="min-h-10 rounded-lg border bg-background p-2" value={closeHour} onChange={(e) => setCloseHour(Number(e.target.value))}>{hourOptions.slice(1).concat(24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((d, i) => (
              <label key={d} className="inline-flex items-center gap-1 rounded-full border px-3 py-1">
                <input type="checkbox" checked={weekdays.includes(i)} onChange={(e) => setWeekdays((w) => (e.target.checked ? [...w, i].sort() : w.filter((x) => x !== i)))} />{d}
              </label>
            ))}
          </div>
          <label className="block">How the captions should sound (optional)
            <Textarea className="mt-1" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} placeholder="e.g. Proud but plain. Name the town when you can. Never mention prices." />
          </label>
          <p className="text-xs text-muted-foreground">A random minute inside the window each day, so the posts never land at the same time. Each caption is written the day before it goes out and you can see it below before it publishes. Nothing posts if you pause.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => start.mutate()} disabled={busy || !weekdays.length || (source === "library" && !files.length) || (source === "fileloaded" && (!slug || !key)) || (source === "dropbox" && !dropbox)} data-testid="button-start-bulk-run">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Start posting
            </Button>
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            {progress && <span className="text-xs text-muted-foreground" role="status">{progress}</span>}
          </div>
        </fieldset>
      )}

      {runs.error && <p role="alert" className="text-destructive">Could not load bulk runs.</p>}
      {runs.data?.runs.map((run) => <RunCard key={run.id} run={run} onAction={(action) => act.mutate({ id: run.id, action })} busy={act.isPending} />)}
      {runs.data && !runs.data.runs.length && <p className="text-xs text-muted-foreground">No bulk runs yet.</p>}
    </Section>
  );
}

function RunCard({ run, onAction, busy }: { run: Run; onAction: (a: "pause" | "resume" | "cancel") => void; busy: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const done = run.counts.published ?? 0, failed = run.counts.failed ?? 0, left = (run.counts.pending ?? 0) + (run.counts.queued ?? 0);
  const label: Record<string, string> = { importing: `Importing photos · ${run.imported}${run.total ? ` of ${run.total}` : ""}`, active: "Posting", paused: "Paused", done: "Finished" };
  const items = showAll ? run.items : run.items.filter((i) => i.status !== "published" && i.status !== "skipped").slice(0, 5);
  return (
    <article className="rounded-xl border bg-card p-4 space-y-3" data-testid={`bulk-run-${run.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{run.name}</p>
          <p className="text-xs text-muted-foreground">{run.sourceLabel} · every {run.every_days === 1 ? "day" : `${run.every_days} days`} · {label[run.status] ?? run.status}
            {run.status !== "importing" && ` · ${done} posted, ${left} to go${failed ? `, ${failed} failed` : ""}`}
            {run.next && run.status === "active" && ` · next ${when(run.next)}`}</p>
          {run.error && <p className="text-xs text-destructive">{run.error}</p>}
        </div>
        <div className="flex gap-2">
          {(run.status === "active" || run.status === "importing") && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("pause")}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>}
          {run.status === "paused" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("resume")}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button>}
          {run.status !== "done" && <Button size="sm" variant="outline" className="border-destructive/50 text-destructive" disabled={busy} onClick={() => { if (window.confirm("Stop this run? Posts already published stay on Google; the rest are dropped.")) onAction("cancel"); }}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button>}
        </div>
      </div>
      {items.length > 0 && (
        <ul className="divide-y text-xs">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 py-2">
              {i.photo_url ? <img src={i.photo_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" /> : <span className="h-10 w-10 shrink-0 rounded bg-muted" />}
              <div className="min-w-0 flex-1">
                <p><span className="font-medium">{when(i.due_at)}</span> · {i.status === "pending" ? "planned" : i.status}{i.source_name ? ` · ${i.source_name}` : ""}</p>
                {i.caption && <p className="text-muted-foreground line-clamp-2">{i.caption}</p>}
                {i.error && <p className="text-destructive">{i.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {run.items.length > items.length && <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show all ${run.items.length}`}</Button>}
    </article>
  );
}
