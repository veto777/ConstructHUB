import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { US_STATES, addCounties, hasAllCountiesRegion, regionCounties, stateName, type CountiesResponse, type CountyRef, type CountyRegion } from "@/lib/voice-studio";
import { apiErrorMessage } from "@/lib/queryClient";
import type { VoiceProfile } from "@shared/voice-profile";
import { SectionCard, SelectField, StringListEditor, TextField, type SectionProps } from "./fields";

type ServiceArea = VoiceProfile["serviceArea"];

/**
 * Service area — counties come from the app's own counties table
 * (GET /api/crm/voice/counties?state=WA → { counties, regions }); region
 * shortcuts ("Canadian border to Tacoma") add a whole list at once. Nothing
 * is typed by hand, so the compiler can trust every county id.
 * OWNER: studio-frontend lane.
 */
export function ServiceAreaSection({ value, onChange, disabled }: SectionProps<ServiceArea>) {
  const set = <K extends keyof ServiceArea>(k: K, v: ServiceArea[K]) => onChange({ ...value, [k]: v });
  const [state, setState] = useState<string>(value.defaultStateCode || value.counties[0]?.stateCode || "WA");
  const [search, setSearch] = useState("");
  const counties = useQuery<CountiesResponse>({ queryKey: [`/api/crm/voice/counties?state=${state}`] });

  const selectedIds = useMemo(() => new Set(value.counties.map((c) => c.id)), [value.counties]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (counties.data?.counties ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [counties.data, search]);

  const toggle = (c: CountyRef, on: boolean) => {
    if (on) { if (!selectedIds.has(c.id)) set("counties", [...value.counties, c]); }
    else set("counties", value.counties.filter((x) => x.id !== c.id));
  };
  const addMany = (list: CountyRef[]) => {
    const next = addCounties(value.counties, list);
    if (next.length !== value.counties.length) set("counties", next);
  };
  const addRegion = (region: CountyRegion) => addMany(regionCounties(region, counties.data?.counties ?? []));
  const clearState = () => set("counties", value.counties.filter((c) => c.stateCode !== state));

  const byState = useMemo(() => {
    const m = new Map<string, CountyRef[]>();
    for (const c of value.counties) m.set(c.stateCode, [...(m.get(c.stateCode) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [value.counties]);

  return (
    <SectionCard title="Service area" blurb="Pick every county you take jobs in. A caller outside the area hears your out-of-area line instead of the intake questions." testid="section-service-area">
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(16rem,0.8fr)]">
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="county-state">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="county-state" className="w-56" data-testid="select-county-state"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => <SelectItem key={s.code} value={s.code} data-testid={`select-county-state-option-${s.code}`}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex-1 min-w-[10rem]">
              <Label htmlFor="county-search">Find a county</Label>
              <Input id="county-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter" data-testid="input-county-search" />
            </div>
          </div>

          {counties.data && counties.data.counties.length > 0 && !disabled && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Add all counties in a region</Label>
              <div className="flex flex-wrap gap-1.5" data-testid="region-shortcuts">
                {counties.data.regions.map((r) => {
                  const n = regionCounties(r, counties.data?.counties ?? []).length;
                  const title = [r.description, r.missing?.length ? `Not in our county list: ${r.missing.join(", ")}` : ""].filter(Boolean).join(" · ");
                  return (
                    <Button key={r.id} type="button" size="sm" variant="secondary" data-testid={`button-region-${r.id}`} onClick={() => addRegion(r)}
                      disabled={n === 0} title={title || undefined}>
                      <MapPin className="h-3.5 w-3.5 mr-1" /> {r.name} <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">({n})</span>
                    </Button>
                  );
                })}
                {!hasAllCountiesRegion(counties.data.regions) && (
                  <Button type="button" size="sm" variant="ghost" data-testid="button-region-all" onClick={() => addMany(counties.data?.counties ?? [])}>All of {stateName(state)}</Button>
                )}
                <Button type="button" size="sm" variant="ghost" data-testid="button-region-clear" onClick={clearState}>Clear {state}</Button>
              </div>
            </div>
          )}

          {counties.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading counties…</div>
          ) : counties.isError ? (
            <p className="text-sm text-destructive" data-testid="text-counties-error">Couldn't load counties: {apiErrorMessage(counties.error)}</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y" data-testid="list-counties">
              {visible.length === 0 && <p className="p-3 text-sm text-muted-foreground">No counties match.</p>}
              {visible.map((c) => {
                const checked = selectedIds.has(c.id);
                return (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => toggle(c, v === true)} data-testid={`checkbox-county-${c.id}`} />
                    <span>{c.name} County</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border p-3 space-y-2" data-testid="selected-counties">
            <div className="flex items-center justify-between">
              <Label>Selected</Label>
              <Badge variant="secondary" data-testid="badge-county-count">{value.counties.length} {value.counties.length === 1 ? "county" : "counties"}</Badge>
            </div>
            {value.counties.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Pick counties on the left, or use a region shortcut.</p>}
            {byState.map(([code, list]) => (
              <div key={code} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">{stateName(code)}</div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((c) => (
                    <Badge key={c.id} variant="outline" className="gap-1 pr-1 font-normal" data-testid={`chip-county-${c.id}`}>
                      {c.name}
                      {!disabled && (
                        <button type="button" className="rounded-full p-0.5 hover:bg-muted" aria-label={`Remove ${c.name}`} onClick={() => toggle(c, false)} data-testid={`chip-county-${c.id}-remove`}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <SelectField id="default-state" label="Home state" value={value.defaultStateCode || "none"} disabled={disabled} testid="select-default-state"
            onChange={(v) => set("defaultStateCode", v === "none" ? "" : v)}
            options={[{ value: "none", label: "— none —" }, ...US_STATES.map((s) => ({ value: s.code, label: s.name }))]}
            hint="Added to addresses a caller gives without a state." />
        </div>
      </div>

      <StringListEditor id="spoken-areas" label="Areas the assistant names out loud" values={value.spokenAreas} onChange={(v) => set("spokenAreas", v)} disabled={disabled}
        testid="list-spoken-areas" placeholder="Bellingham to Tacoma" max={60}
        hint='Your words for the area, e.g. "the Puget Sound area" — said when a caller asks "do you come out to…". Counties above decide; this is how it sounds.' />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="out-of-area" label="Caller is outside the area" value={value.outOfArea} onChange={(v) => set("outOfArea", v)} disabled={disabled}
          testid="select-out-of-area" options={[{ value: "decline", label: "Decline politely" }, { value: "take_lead_anyway", label: "Take the lead anyway" }]}
          hint="Taking it anyway files the lead with an out-of-area flag so you decide." />
        <TextField id="out-of-area-line" label="Out-of-area line" value={value.outOfAreaLine} onChange={(v) => set("outOfAreaLine", v)} disabled={disabled}
          testid="input-out-of-area-line" maxLength={200} />
      </div>
    </SectionCard>
  );
}
