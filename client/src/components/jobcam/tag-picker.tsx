import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GooglePill } from "@/components/google";
import { queryClient } from "@/lib/queryClient";
import { jobcamFetch, jobcamError, type JobcamTag } from "@/lib/jobcam-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export const TAGS_KEY = ["/api/crm/jobcam/tags"];

/**
 * Pick (and create) tags. Any member may create one — the crew names what it
 * shoots. Used at capture (sticky for the session), in the lightbox and for
 * the feed filters (where `mode` adds the AND/OR switch).
 */
export function TagPicker({ value, onChange, mode, onMode, label = "Tags", dark = false, testId = "jobcam-tag-picker", align = "start" }: {
  value: string[];
  onChange: (tags: string[]) => void;
  mode?: "and" | "or";
  onMode?: (m: "and" | "or") => void;
  label?: string;
  /** On the camera screen the trigger sits on black. */
  dark?: boolean;
  testId?: string;
  align?: "start" | "end" | "center";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: tags } = useQuery<JobcamTag[]>({ queryKey: TAGS_KEY, enabled: open });
  const create = useMutation({
    mutationFn: (name: string) => jobcamFetch<JobcamTag>("/api/crm/jobcam/tags", { method: "POST", json: { name } }),
    onSuccess: (t) => {
      queryClient.invalidateQueries({ queryKey: TAGS_KEY });
      if (!has(t.name)) onChange([...value, t.name]);
      setQ("");
    },
    onError: (e) => toast({ title: "Could not add that tag", description: jobcamError(e), variant: "destructive" }),
  });
  const has = (name: string) => value.some((v) => v.toLowerCase() === name.toLowerCase());
  const toggle = (name: string) => onChange(has(name) ? value.filter((v) => v.toLowerCase() !== name.toLowerCase()) : [...value, name]);
  const list = useMemo(() => {
    const all = [...(tags ?? [])].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((t) => t.name.toLowerCase().includes(needle)) : all;
  }, [tags, q]);
  const exact = list.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testId}
          className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 h-9 text-[13px] font-medium max-w-[60vw] truncate",
            dark ? "border-white/30 bg-black/40 text-white backdrop-blur" : "border-border bg-background text-foreground hover:bg-accent")}>
          <TagIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{value.length ? value.join(", ") : label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(92vw,340px)] p-0" data-testid={`${testId}-popover`}>
        <div className="p-2 border-b border-border flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find or add a tag"
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { e.preventDefault(); exact ? toggle(list.find((t) => t.name.toLowerCase() === q.trim().toLowerCase())!.name) : create.mutate(q.trim()); } }}
            className="g-input h-9 flex-1" data-testid={`${testId}-search`} autoFocus />
          {mode && onMode && (
            <div className="flex rounded-full border border-border overflow-hidden text-[12px]" role="radiogroup" aria-label="Match">
              {(["and", "or"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => onMode(m)} data-testid={`${testId}-mode-${m}`}
                  className={cn("px-2.5 h-8 font-medium uppercase", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{m}</button>
              ))}
            </div>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {q.trim() && !exact && (
            <button type="button" onClick={() => create.mutate(q.trim())} disabled={create.isPending} data-testid={`${testId}-create`}
              className="w-full flex items-center gap-2 px-3 h-10 text-left text-sm text-primary hover:bg-accent">
              <Plus className="h-4 w-4" /> Add “{q.trim()}”
            </button>
          )}
          {list.map((t) => (
            <button key={t.id} type="button" onClick={() => toggle(t.name)} data-testid={`${testId}-option-${t.id}`}
              className="w-full flex items-center gap-2 px-3 h-10 text-left text-sm hover:bg-accent">
              <span className={cn("h-4 w-4 rounded border flex items-center justify-center", has(t.name) ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                {has(t.name) && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
            </button>
          ))}
          {!list.length && !q.trim() && <p className="px-3 py-4 text-sm text-muted-foreground">No tags yet — type one above.</p>}
        </div>
        {value.length > 0 && (
          <div className="p-2 border-t border-border flex flex-wrap gap-1.5">
            {value.map((v) => (
              <GooglePill key={v} size="sm" selected label={<span className="inline-flex items-center gap-1">{v}<X className="h-3 w-3" /></span>} onClick={() => toggle(v)} testId={`${testId}-remove-${v}`} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
