/**
 * Listing editor (/listing-editor?location=ID): edit a linked Google Business Profile and save
 * through the Business Information API — only the fields that changed, with Google's verdict per
 * field (applied / pending review / rejected with Google's message).
 *
 * Rules and limits come from shared/gbp-listing.ts (the server validates with the same code), so
 * what the form flags is exactly what the save would refuse. The preview is our own card, not
 * Google's layout. Nothing is guessed: an unknown value is shown empty.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  PenLine, Store, Phone, FileText, MapPin, Clock, CalendarDays, Sparkles, Wrench, Tag, Eye, Save, RotateCcw, Plus, X, Copy, Check, AlertTriangle, Loader2, Search,
} from "lucide-react";
import { AppPage, PageHeader, Section, Notice } from "@/components/app-ui";
import { useAgencyFilter } from "@/components/agency-workspace";
import { GbpConnection } from "@/components/gbp-connection";
import { guardErrorMessage } from "@/components/profile-guard";
import { ListingPreview } from "@/components/listing-editor/preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useUrlParam } from "@/hooks/use-url-param";
import { apiRequest, apiErrorMessage, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  LISTING_FIELD_LABELS, LIMITS, NAME_RULES, NAME_RULES_SOURCE, DESCRIPTION_RULES, DAYS, OPEN_STATUSES,
  buildUpdateMask, validateListing, buildAttributeMask, validateAttributes, withUtm, moneyFromDecimal, decimalFromMoney,
  type AttributeValue, type FieldIssues,
} from "@shared/gbp-listing";

type Listing = { location: any; attributes: AttributeValue[] | null; attributesError: string | null; pending: { field: string; value: any; since: string }[]; locationId: number; businessName: string };
type Meta = { name: string; valueType: AttributeValue["valueType"]; displayName: string; groupDisplayName: string; repeatable: boolean; deprecated: boolean; valueMetadata: { value: any; displayName: string }[] };
type Verdict = "applied" | "pending" | "unconfirmed";
type SaveResult = { fields: Record<string, Verdict>; attributes: Record<string, Verdict>; warnings: FieldIssues; rejected?: string; rejectedErrors?: FieldIssues };

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const labelOf = (f: string) => (LISTING_FIELD_LABELS as Record<string, string>)[f] ?? f;
const select = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Set a dotted path on a copy of the draft; undefined/null removes the key (buildUpdateMask turns that into a clear). */
function assign(obj: any, path: string, value: any) {
  const keys = path.split(".");
  let node = obj;
  for (const k of keys.slice(0, -1)) node = node[k] ??= {};
  if (value === undefined || value === null) delete node[keys.at(-1)!]; else node[keys.at(-1)!] = value;
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function ListingEditorPage() {
  const f = useAgencyFilter();
  const { data: locations = [], isLoading, error } = useQuery<any[]>({ queryKey: [`/api/locations?${f.params}`] });
  const [locationParam, setLocationParam] = useUrlParam("location");
  const linked = locations.filter((l) => l.gbpLocationName);
  const chosen = linked.find((l) => String(l.id) === locationParam);
  return (
    <AppPage width="wide" testId="page-listing-editor" className="pb-24 sm:pb-10">
      <PageHeader icon={PenLine} title="Listing editor" description="Edit what Google shows for a linked location and save it straight to your Business Profile." back={{ href: "/locations", label: "Locations" }} />
      {error && <Notice tone="danger" testId="notice-locations-error">Unable to load locations. Reload the page.</Notice>}
      <Section title="Profile to edit" icon={Store} description="Only locations linked to a Google Business Profile listing can be edited here.">
        <label className="block text-sm">
          <span className="sr-only">Location</span>
          <select className={select} aria-label="Location" value={chosen ? String(chosen.id) : ""} onChange={(e) => setLocationParam(e.target.value || null)} data-testid="select-listing-location">
            <option value="">{isLoading ? "Loading locations…" : "Choose a linked location"}</option>
            {linked.map((l) => <option key={l.id} value={l.id}>{l.businessName}{l.city ? ` — ${l.city}${l.state ? `, ${l.state}` : ""}` : ""}</option>)}
          </select>
        </label>
        {!isLoading && !error && !linked.length && <p className="mt-3 text-sm text-muted-foreground" data-testid="text-no-linked-locations">No locations are linked to Google yet. Connect your Google account, then use <strong>Link &amp; sync</strong> in <Link href="/locations" className="text-primary underline">Locations</Link>.</p>}
      </Section>
      {!chosen ? <GbpConnection context="locations" /> : <Editor key={chosen.id} location={chosen} others={linked.filter((l) => l.id !== chosen.id)} />}
    </AppPage>
  );
}

/* ── Editor ──────────────────────────────────────────────────────────────── */
function Editor({ location, others }: { location: any; others: any[] }) {
  const base = `/api/gbp/locations/${location.id}/listing`;
  const { toast } = useToast();
  const { data, error, isLoading, refetch } = useQuery<Listing>({ queryKey: [base] });
  const { data: metaData } = useQuery<{ attributes: Meta[] }>({ queryKey: [`${base}/attribute-metadata`], enabled: !!data });
  const metadata = metaData?.attributes ?? [];
  const [draft, setDraft] = useState<any>(null);
  const [attrs, setAttrs] = useState<AttributeValue[]>([]);
  const [result, setResult] = useState<SaveResult | null>(null);
  useEffect(() => { if (data) { setDraft(clone(data.location)); setAttrs(clone(data.attributes ?? [])); } }, [data]);
  const original = data?.location;
  const set = (path: string, value: any) => setDraft((d: any) => { const n = clone(d); assign(n, path, value); return n; });

  const change = useMemo(() => (original && draft ? buildUpdateMask(original, draft) : { fields: {}, mask: [] as string[] }), [original, draft]);
  const attrChange = useMemo(() => buildAttributeMask(data?.attributes ?? [], attrs), [data?.attributes, attrs]);
  const { errors, warnings } = useMemo(() => validateListing(change.fields), [change.fields]);
  const attrErrors = useMemo(() => validateAttributes(attrChange.attributes), [attrChange.attributes]);
  const errorCount = Object.keys(errors).length + Object.keys(attrErrors).length;
  const changeCount = change.mask.length + attrChange.attributeMask.length;

  const save = useMutation({
    mutationFn: async (): Promise<SaveResult> => {
      const out: SaveResult = { fields: {}, attributes: {}, warnings: {} };
      try {
        if (change.mask.length) { const r = await (await apiRequest("PATCH", base, { fields: change.fields })).json(); out.fields = r.verdicts; out.warnings = r.warnings ?? {}; }
        if (attrChange.attributeMask.length) { const r = await (await apiRequest("PATCH", `${base}/attributes`, attrChange)).json(); out.attributes = r.verdicts; }
      } catch (e: any) {
        let body: any = null; try { body = JSON.parse(String(e?.message ?? "").replace(/^\d{3}:\s*/, "")); } catch { /* not JSON */ }
        out.rejected = guardErrorMessage(e); out.rejectedErrors = body?.errors;
      }
      return out;
    },
    onSuccess: async (out) => {
      setResult(out);
      await queryClient.invalidateQueries({ queryKey: [base] });
      for (const key of ["/api/locations", `/api/gbp/locations/${location.id}/guard`, "/api/gbp/guard/status"]) void queryClient.invalidateQueries({ queryKey: [key] });
      const n = Object.values(out.fields).concat(Object.values(out.attributes));
      if (out.rejected) toast({ title: "Google rejected the change", description: out.rejected, variant: "destructive" });
      else if (n.some((v) => v === "pending")) toast({ title: "Saved — Google is reviewing part of it" });
      else if (n.every((v) => v === "applied")) toast({ title: "Saved to your Business Profile" });
      else toast({ title: "Saved, but Google did not confirm every field", variant: "destructive" });
    },
  });

  if (error) return <Notice tone="danger" testId="notice-listing-error" title="Could not load this listing from Google">{guardErrorMessage(error)}<div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void refetch()}>Try again</Button><Button size="sm" variant="outline" asChild><Link href={`/locations?location=${location.id}`}>Open in Locations</Link></Button></div></Notice>;
  if (isLoading || !data || !draft) return <p role="status" className="text-sm text-muted-foreground" data-testid="text-listing-loading"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden="true" /> Loading the live listing from Google…</p>;

  const pendingAtGoogle = data.pending;
  const sab = draft.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY";
  const reset = () => { setDraft(clone(data.location)); setAttrs(clone(data.attributes ?? [])); setResult(null); };
  const fieldErr = (f: string) => errors[f];
  const fieldWarn = (f: string) => warnings[f];

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6" data-testid="listing-editor">
      <div className="space-y-5 sm:space-y-6">
        {data.location.metadata?.hasPendingEdits && !pendingAtGoogle.length && <Notice tone="warning" testId="notice-google-pending">Google reports edits under review on this listing (made outside ConstructHUB or earlier). Values below are what Google publishes now.</Notice>}
        {pendingAtGoogle.length > 0 && <Notice tone="warning" testId="notice-our-pending" title="Google is reviewing your earlier edits">{pendingAtGoogle.map((p) => <span key={p.field} className="block">{labelOf(p.field)} → <code className="text-xs">{typeof p.value === "string" ? p.value : JSON.stringify(p.value)}</code> (since {new Date(p.since).toLocaleDateString()})</span>)}<span className="mt-1 block text-xs">Shown as pending, not saved. Profile Guard will recognise the value when Google publishes it.</span></Notice>}
        {data.attributesError && <Notice tone="warning" testId="notice-attributes-error">Attributes could not be loaded: {data.attributesError}. The other fields can still be edited.</Notice>}

        <Section title="Name and categories" icon={Store}>
          <div className="space-y-4">
            <Field label="Business name" field="title" errors={fieldErr("title")} warnings={fieldWarn("title")} hint={<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Google's naming rules</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{NAME_RULES.map((r) => <li key={r}>{r}</li>)}</ul><a className="mt-1 inline-block underline" href={NAME_RULES_SOURCE} target="_blank" rel="noreferrer">Google's guideline</a></details>}>
              <Input value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={300} data-testid="input-listing-title" />
            </Field>
            <CategoryEditor base={base} value={draft.categories} onChange={(v) => set("categories", v)} errors={fieldErr("categories")} />
          </div>
        </Section>

        <Section title="Contact" icon={Phone}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary phone" field="phoneNumbers" errors={fieldErr("phoneNumbers")}>
              <Input value={draft.phoneNumbers?.primaryPhone ?? ""} onChange={(e) => set("phoneNumbers.primaryPhone", e.target.value || undefined)} inputMode="tel" data-testid="input-listing-phone" />
            </Field>
            <div className="space-y-2">
              <span className="text-sm font-medium">Additional phones <span className="text-xs text-muted-foreground">(up to {LIMITS.additionalPhones})</span></span>
              {[0, 1].map((i) => <Input key={i} value={draft.phoneNumbers?.additionalPhones?.[i] ?? ""} placeholder={i === 0 ? "Mobile or second line" : "Another line"} inputMode="tel" onChange={(e) => { const list = [...(draft.phoneNumbers?.additionalPhones ?? [])]; list[i] = e.target.value; set("phoneNumbers.additionalPhones", list.filter(Boolean).length ? list.filter(Boolean) : undefined); }} data-testid={`input-listing-phone-extra-${i}`} />)}
            </div>
            <div className="sm:col-span-2">
              <WebsiteEditor value={draft.websiteUri ?? ""} onChange={(v) => set("websiteUri", v || undefined)} errors={fieldErr("websiteUri")} />
            </div>
          </div>
        </Section>

        <Section title="Description" icon={FileText} description={`Up to ${LIMITS.description} characters, in your own voice.`}>
          <Field label="Description" field="profile.description" errors={fieldErr("profile.description")} warnings={fieldWarn("profile.description")} hint={<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">What Google allows</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{DESCRIPTION_RULES.map((r) => <li key={r}>{r}</li>)}</ul></details>} hideLabel>
            <Textarea rows={6} value={draft.profile?.description ?? ""} onChange={(e) => set("profile.description", e.target.value || undefined)} data-testid="textarea-listing-description" />
            <p className={cn("mt-1 text-right text-xs", (draft.profile?.description?.length ?? 0) > LIMITS.description ? "text-destructive" : "text-muted-foreground")} data-testid="text-description-count">{draft.profile?.description?.length ?? 0} / {LIMITS.description}</p>
          </Field>
        </Section>

        <Section title={sab ? "Service area" : "Address and service area"} icon={MapPin}>
          <div className="space-y-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">How customers reach you</legend>
              {[["CUSTOMER_AND_BUSINESS_LOCATION", "Customers come to my address (I may also travel)"], ["CUSTOMER_LOCATION_ONLY", "I go to my customers — service-area business (address hidden)"]].map(([v, text]) => (
                <label key={v} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", (draft.serviceArea?.businessType ?? "CUSTOMER_AND_BUSINESS_LOCATION") === v && "border-primary bg-primary/5")}>
                  <input type="radio" name="businessType" className="mt-0.5" checked={(draft.serviceArea?.businessType ?? "CUSTOMER_AND_BUSINESS_LOCATION") === v} onChange={() => set("serviceArea.businessType", v)} data-testid={`radio-listing-${v === "CUSTOMER_LOCATION_ONLY" ? "sab" : "storefront"}`} />
                  <span>{text}</span>
                </label>
              ))}
            </fieldset>
            {!sab && <AddressEditor value={draft.storefrontAddress} onChange={(v) => set("storefrontAddress", v)} errors={fieldErr("storefrontAddress")} warnings={fieldWarn("storefrontAddress")} />}
            {sab && draft.storefrontAddress && <Notice tone="info">Google hides the address of a service-area business. It stays on the listing for verification; this editor does not remove it.</Notice>}
            <ServiceAreaEditor value={draft.serviceArea?.places?.placeInfos ?? []} onChange={(list) => set("serviceArea.places", list.length ? { placeInfos: list } : undefined)} errors={fieldErr("serviceArea")} required={sab} />
          </div>
        </Section>

        <Section title="Hours" icon={Clock}>
          <HoursEditor periods={draft.regularHours?.periods ?? []} onChange={(periods) => set("regularHours", periods.length ? { periods } : undefined)} errors={fieldErr("regularHours")} />
          <div className="mt-5 border-t pt-4">
            <SpecialHoursEditor periods={draft.specialHours?.specialHourPeriods ?? []} onChange={(p) => set("specialHours", p.length ? { specialHourPeriods: p } : undefined)} errors={fieldErr("specialHours")} />
          </div>
        </Section>

        <Section title="Opening date and status" icon={CalendarDays}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opening date" field="openInfo.openingDate" errors={fieldErr("openInfo.openingDate")} hint="Year, or year and month, or the full date. At most one year in the future.">
              <div className="grid grid-cols-3 gap-2">
                {(["year", "month", "day"] as const).map((part) => <Input key={part} type="number" placeholder={cap(part)} min={part === "year" ? 1 : 1} max={part === "year" ? 9999 : part === "month" ? 12 : 31} value={draft.openInfo?.openingDate?.[part] ?? ""} onChange={(e) => { const od = { ...(draft.openInfo?.openingDate ?? {}) }; if (e.target.value === "") delete od[part]; else od[part] = Number(e.target.value); set("openInfo.openingDate", Object.keys(od).length ? od : undefined); }} data-testid={`input-listing-opening-${part}`} />)}
              </div>
            </Field>
            <Field label="Open status" field="openInfo.status" errors={fieldErr("openInfo.status")} warnings={fieldWarn("openInfo.status")}>
              <select className={select} value={draft.openInfo?.status ?? ""} onChange={(e) => set("openInfo.status", e.target.value || undefined)} data-testid="select-listing-status">
                <option value="">Not set</option>
                {OPEN_STATUSES.map((s) => <option key={s} value={s}>{{ OPEN: "Open", CLOSED_TEMPORARILY: "Temporarily closed", CLOSED_PERMANENTLY: "Permanently closed" }[s]}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Attributes" icon={Sparkles} description="What Google offers for your primary category — yes/no, choices and links.">
          {data.attributes === null ? <p className="text-sm text-muted-foreground">Attributes are unavailable for this listing right now.</p>
            : <AttributesEditor metadata={metadata} value={attrs} onChange={setAttrs} errors={attrErrors} loading={!metaData} />}
        </Section>

        <Section title="Services" icon={Wrench} description="Google's service types for your categories, or your own names, with optional fixed prices.">
          {draft.metadata?.canModifyServiceList === false
            ? <Notice tone="info" testId="notice-services-locked">Google does not allow the service list of this listing to be edited through the API.</Notice>
            : <ServicesEditor draft={draft} onChange={(items) => set("serviceItems", items.length ? items : undefined)} errors={fieldErr("serviceItems")} warnings={fieldWarn("serviceItems")} />}
        </Section>

        <Section title="Labels" icon={Tag} description="Private tags for your own filtering (and Google Ads). Customers never see them.">
          <LabelsEditor value={draft.labels ?? []} onChange={(v) => set("labels", v.length ? v : undefined)} errors={fieldErr("labels")} />
        </Section>

        {others.length > 0 && changeCount > 0 && <BulkApply fields={change.fields} others={others} />}
      </div>

      <aside className="mt-6 space-y-4 lg:sticky lg:top-6 lg:mt-0">
        <Section title="What Google will see" icon={Eye} description="Our rendering of the values you are saving — not Google's layout." flush>
          <div className="p-3 pt-0"><ListingPreview draft={draft} attributes={attrs} metadata={metadata} /></div>
        </Section>
        <Section title="Changes" icon={Save} testId="section-changes">
          <ChangesPanel change={change} attrChange={attrChange} metadata={metadata} errors={errors} attrErrors={attrErrors} warnings={warnings} result={result} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="flex-1" disabled={!changeCount || errorCount > 0 || save.isPending} onClick={() => save.mutate()} data-testid="button-save-listing">{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1 h-4 w-4" aria-hidden="true" />}Save to Google</Button>
            <Button variant="outline" disabled={!changeCount || save.isPending} onClick={reset} data-testid="button-reset-listing"><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Reset</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Only changed fields are sent. Every save is recorded in your account activity and Profile Guard, and you get a notice of the change.</p>
        </Section>
      </aside>

      <div className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 lg:hidden" data-testid="bar-listing-save">
        <span className="text-sm">{changeCount ? `${changeCount} change${changeCount === 1 ? "" : "s"}` : "No changes"}{errorCount ? <span className="text-destructive"> · {errorCount} to fix</span> : null}</span>
        <Button size="sm" disabled={!changeCount || errorCount > 0 || save.isPending} onClick={() => save.mutate()} data-testid="button-save-listing-mobile">Save to Google</Button>
      </div>
    </div>
  );
}

/* ── Shared field shell ──────────────────────────────────────────────────── */
function Field({ label, field, errors, warnings, hint, children, hideLabel }: { label: string; field: string; errors?: string[]; warnings?: string[]; hint?: React.ReactNode; children: React.ReactNode; hideLabel?: boolean }) {
  return (
    <div className="space-y-1.5" data-testid={`field-${field.replace(/\./g, "-")}`}>
      {!hideLabel && <span className="block text-sm font-medium">{label}</span>}
      {children}
      {errors?.map((e) => <p key={e} role="alert" className="flex items-start gap-1 text-xs text-destructive" data-testid={`error-${field.replace(/\./g, "-")}`}><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{e}</p>)}
      {warnings?.map((w) => <p key={w} className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300" data-testid={`warning-${field.replace(/\./g, "-")}`}><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{w}</p>)}
      {hint && <div>{typeof hint === "string" ? <p className="text-xs text-muted-foreground">{hint}</p> : hint}</div>}
    </div>
  );
}

/* ── Categories ──────────────────────────────────────────────────────────── */
function CategoryEditor({ base, value, onChange, errors }: { base: string; value: any; onChange: (v: any) => void; errors?: string[] }) {
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState(""), [mode, setMode] = useState<"primary" | "additional">("additional");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, isFetching, error } = useQuery<{ categories: { name: string; displayName: string; serviceTypes: any[] }[] }>({ queryKey: [`${base}/categories?q=${encodeURIComponent(debounced)}`], enabled: debounced.length >= 2 });
  const primary = value?.primaryCategory, additional: any[] = value?.additionalCategories ?? [];
  const pick = (c: any) => {
    const cat = { name: c.name, displayName: c.displayName, serviceTypes: c.serviceTypes };
    if (mode === "primary") onChange({ primaryCategory: cat, additionalCategories: additional.filter((a) => a.name !== c.name) });
    else if (c.name !== primary?.name && !additional.some((a) => a.name === c.name)) onChange({ primaryCategory: primary, additionalCategories: [...additional, cat] });
    setQ("");
  };
  return (
    <Field label="Categories" field="categories" errors={errors} hint={`One primary category — what the business IS — plus up to ${LIMITS.additionalCategories} more. Pick from Google's list; the ids are Google's.`}>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="list-categories">
        {primary ? <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-primary/30" data-testid="chip-category-primary">Primary · {primary.displayName ?? primary.name}</span> : <span className="text-xs text-destructive">No primary category</span>}
        {additional.map((c) => <span key={c.name} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs" data-testid="chip-category-additional">{c.displayName ?? c.name}<button type="button" className="rounded hover:bg-muted" aria-label={`Remove ${c.displayName ?? c.name}`} onClick={() => onChange({ primaryCategory: primary, additionalCategories: additional.filter((a) => a.name !== c.name) })}><X className="h-3 w-3" /></button></span>)}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className={cn(select, "sm:w-44")} value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="Which category to set" data-testid="select-category-mode"><option value="additional">Add additional</option><option value="primary">Replace primary</option></select>
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-8" placeholder="Search Google's categories (e.g. roofing)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-listing-category-search" /></div>
      </div>
      {debounced.length >= 2 && <div className="max-h-48 overflow-y-auto rounded-md border text-sm" data-testid="list-category-results">
        {isFetching && !data ? <p className="p-2 text-muted-foreground">Searching Google's categories…</p>
          : error ? <p className="p-2 text-destructive">{guardErrorMessage(error)}</p>
            : !data?.categories.length ? <p className="p-2 text-muted-foreground">No category matches "{debounced}".</p>
              : data.categories.map((c) => <button type="button" key={c.name} className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted" onClick={() => pick(c)} data-testid={`button-category-pick-${c.name.replace(/[^\w]/g, "_")}`}><span>{c.displayName}</span><span className="text-xs text-muted-foreground">{c.serviceTypes?.length ? `${c.serviceTypes.length} service types` : ""}</span></button>)}
      </div>}
    </Field>
  );
}

/* ── Website + UTM ───────────────────────────────────────────────────────── */
function WebsiteEditor({ value, onChange, errors }: { value: string; onChange: (v: string) => void; errors?: string[] }) {
  const [utm, setUtm] = useState({ source: "google", medium: "organic", campaign: "business-profile" });
  const [open, setOpen] = useState(false);
  const apply = () => { try { onChange(withUtm(value, utm)); } catch { /* the field's own validation shows the problem */ } };
  return (
    <Field label="Website" field="websiteUri" errors={errors} hint="A full address starting with https://. The UTM option tags visits from your profile in your analytics.">
      <div className="flex gap-2"><Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="url" placeholder="https://" data-testid="input-listing-website" /><Button type="button" variant="outline" onClick={() => setOpen((o) => !o)} data-testid="button-listing-utm">UTM</Button></div>
      {open && <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]" data-testid="panel-utm">
        {(["source", "medium", "campaign"] as const).map((k) => <label key={k} className="text-xs"><span className="text-muted-foreground">utm_{k}</span><Input value={utm[k]} onChange={(e) => setUtm({ ...utm, [k]: e.target.value })} data-testid={`input-utm-${k}`} /></label>)}
        <Button type="button" size="sm" className="self-end" disabled={!/^https?:\/\//.test(value)} onClick={apply} data-testid="button-utm-apply">Add to URL</Button>
      </div>}
    </Field>
  );
}

/* ── Address ─────────────────────────────────────────────────────────────── */
function AddressEditor({ value, onChange, errors, warnings }: { value: any; onChange: (v: any) => void; errors?: string[]; warnings?: string[] }) {
  const a = value ?? {};
  const put = (k: string, v: any) => { const n = { ...a }; if (v === "" || v === undefined) delete n[k]; else n[k] = v; onChange(Object.keys(n).length ? n : undefined); };
  const lines: string[] = a.addressLines ?? [];
  return (
    <Field label="Address" field="storefrontAddress" errors={errors} warnings={warnings} hint="Changing the address can make Google ask you to verify the listing again.">
      <div className="grid gap-2 sm:grid-cols-6">
        <Input className="sm:col-span-6" placeholder="Street address" value={lines[0] ?? ""} onChange={(e) => put("addressLines", [e.target.value, ...lines.slice(1)].filter((l, i) => i === 0 || l))} data-testid="input-listing-address-1" />
        <Input className="sm:col-span-6" placeholder="Suite, unit (optional)" value={lines[1] ?? ""} onChange={(e) => put("addressLines", [lines[0] ?? "", e.target.value].filter((l, i) => i === 0 || l))} data-testid="input-listing-address-2" />
        <Input className="sm:col-span-3" placeholder="City" value={a.locality ?? ""} onChange={(e) => put("locality", e.target.value)} data-testid="input-listing-city" />
        <Input className="sm:col-span-1" placeholder="State" value={a.administrativeArea ?? ""} onChange={(e) => put("administrativeArea", e.target.value)} data-testid="input-listing-state" />
        <Input className="sm:col-span-1" placeholder="ZIP" value={a.postalCode ?? ""} onChange={(e) => put("postalCode", e.target.value)} data-testid="input-listing-zip" />
        <Input className="sm:col-span-1" placeholder="US" maxLength={2} value={a.regionCode ?? ""} onChange={(e) => put("regionCode", e.target.value.toUpperCase())} aria-label="Country code" data-testid="input-listing-country" />
      </div>
    </Field>
  );
}

/* ── Service area (Places regions) ───────────────────────────────────────── */
function ServiceAreaEditor({ value, onChange, errors, required }: { value: { placeName: string; placeId: string }[]; onChange: (v: any[]) => void; errors?: string[]; required: boolean }) {
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const { data, isFetching, error } = useQuery<{ places: { placeId: string; placeName: string }[] }>({ queryKey: [`/api/gbp/listing/places?q=${encodeURIComponent(debounced)}`], enabled: debounced.length >= 2 });
  return (
    <Field label={required ? "Service areas (required)" : "Service areas (optional)"} field="serviceArea" errors={errors} hint={`Up to ${LIMITS.serviceAreaPlaces} cities, counties or ZIP areas. Each must be a place Google knows, so pick from the search.`}>
      <div className="flex flex-wrap gap-1.5" data-testid="list-service-areas">
        {value.map((p) => <span key={p.placeId} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs" data-testid="chip-service-area">{p.placeName}<button type="button" aria-label={`Remove ${p.placeName}`} className="rounded hover:bg-muted" onClick={() => onChange(value.filter((v) => v.placeId !== p.placeId))}><X className="h-3 w-3" /></button></span>)}
        {!value.length && <span className="text-xs text-muted-foreground">None yet.</span>}
      </div>
      <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-8" placeholder="Search a city, county or ZIP" value={q} onChange={(e) => setQ(e.target.value)} disabled={value.length >= LIMITS.serviceAreaPlaces} data-testid="input-listing-area-search" /></div>
      {debounced.length >= 2 && <div className="max-h-40 overflow-y-auto rounded-md border text-sm" data-testid="list-area-results">
        {isFetching && !data ? <p className="p-2 text-muted-foreground">Searching…</p>
          : error ? <p className="p-2 text-destructive">{apiErrorMessage(error)}</p>
            : !data?.places.length ? <p className="p-2 text-muted-foreground">No region matches "{debounced}".</p>
              : data.places.map((p) => <button type="button" key={p.placeId} className="block w-full px-3 py-1.5 text-left hover:bg-muted disabled:opacity-50" disabled={value.some((v) => v.placeId === p.placeId)} onClick={() => { onChange([...value, p]); setQ(""); }} data-testid="button-area-pick">{p.placeName}</button>)}
      </div>}
    </Field>
  );
}

/* ── Hours ───────────────────────────────────────────────────────────────── */
const TIME_OPTIONS = Array.from({ length: 97 }, (_, i) => i * 15).map((m) => ({ value: m, label: m === 1440 ? "Midnight (24:00)" : `${(Math.floor(m / 60) % 12) || 12}:${String(m % 60).padStart(2, "0")} ${Math.floor(m / 60) < 12 ? "AM" : "PM"}` }));
const toMin = (t: any) => Number(t?.hours ?? 0) * 60 + Number(t?.minutes ?? 0);
const fromMin = (m: number) => ({ hours: Math.floor(m / 60), ...(m % 60 ? { minutes: m % 60 } : {}) });
function TimeSelect({ value, onChange, testId, label }: { value: any; onChange: (t: any) => void; testId: string; label: string }) {
  const m = toMin(value);
  const options = TIME_OPTIONS.some((o) => o.value === m) ? TIME_OPTIONS : [...TIME_OPTIONS, { value: m, label: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` }].sort((a, b) => a.value - b.value);
  return <select className={cn(select, "w-auto")} aria-label={label} value={m} onChange={(e) => onChange(fromMin(Number(e.target.value)))} data-testid={testId}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
function HoursEditor({ periods, onChange, errors }: { periods: any[]; onChange: (p: any[]) => void; errors?: string[] }) {
  const update = (day: string, next: any[]) => onChange([...periods.filter((p) => p.openDay !== day), ...next]);
  return (
    <Field label="Regular hours" field="regularHours" errors={errors} hideLabel>
      <div className="divide-y rounded-md border">
        {DAYS.map((day) => {
          const mine = periods.filter((p) => p.openDay === day).sort((a, b) => toMin(a.openTime) - toMin(b.openTime));
          const allDay = mine.length === 1 && toMin(mine[0].openTime) === 0 && toMin(mine[0].closeTime) === 1440;
          return (
            <div key={day} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start" data-testid={`hours-${day.toLowerCase()}`}>
              <span className="w-24 pt-1.5 text-sm font-medium">{cap(day)}</span>
              <div className="flex-1 space-y-1.5">
                {!mine.length && <p className="pt-1.5 text-sm text-muted-foreground">Closed</p>}
                {allDay && <p className="pt-1.5 text-sm">Open 24 hours</p>}
                {!allDay && mine.map((p, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1.5">
                    <TimeSelect label={`${cap(day)} opens`} value={p.openTime} onChange={(t) => update(day, mine.map((x, j) => j === i ? { ...x, openTime: t } : x))} testId={`select-hours-${day.toLowerCase()}-${i}-open`} />
                    <span className="text-xs text-muted-foreground">to</span>
                    <TimeSelect label={`${cap(day)} closes`} value={p.closeTime} onChange={(t) => update(day, mine.map((x, j) => j === i ? { ...x, closeTime: t } : x))} testId={`select-hours-${day.toLowerCase()}-${i}-close`} />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Remove hours" onClick={() => update(day, mine.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                {!allDay && <Button type="button" size="sm" variant="outline" onClick={() => update(day, [...mine, { openDay: day, closeDay: day, openTime: fromMin(mine.length ? Math.min(1425, toMin(mine.at(-1)!.closeTime) + 60) : 540), closeTime: fromMin(mine.length ? Math.min(1440, toMin(mine.at(-1)!.closeTime) + 240) : 1020) }])} data-testid={`button-hours-${day.toLowerCase()}-add`}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{mine.length ? "Split" : "Add"}</Button>}
                {!allDay && <Button type="button" size="sm" variant="ghost" onClick={() => update(day, [{ openDay: day, closeDay: day, openTime: {}, closeTime: { hours: 24 } }])} data-testid={`button-hours-${day.toLowerCase()}-24`}>24h</Button>}
                {allDay && <Button type="button" size="sm" variant="ghost" onClick={() => update(day, [])} data-testid={`button-hours-${day.toLowerCase()}-clear`}>Closed</Button>}
                {mine.length > 0 && !allDay && <Button type="button" size="sm" variant="ghost" aria-label={`Copy ${cap(day)} to all weekdays`} title="Copy to Mon–Fri" onClick={() => onChange([...periods.filter((p) => !["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].includes(p.openDay)), ...["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"].flatMap((d) => mine.map((p) => ({ ...p, openDay: d, closeDay: d })))])} data-testid={`button-hours-${day.toLowerCase()}-copy`}><Copy className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
          );
        })}
      </div>
    </Field>
  );
}

/** Next occurrence of a US federal holiday, from the calendar rule — no lookup, no guess. */
function nextHoliday(rule: (year: number) => Date): { year: number; month: number; day: number } {
  const now = new Date(); let d = rule(now.getFullYear());
  if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = rule(now.getFullYear() + 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}
const nthWeekday = (year: number, month: number, weekday: number, n: number) => { const first = new Date(year, month, 1); const offset = (weekday - first.getDay() + 7) % 7; return new Date(year, month, 1 + offset + (n - 1) * 7); };
const lastWeekday = (year: number, month: number, weekday: number) => { const last = new Date(year, month + 1, 0); const offset = (last.getDay() - weekday + 7) % 7; return new Date(year, month, last.getDate() - offset); };
const HOLIDAYS: [string, (y: number) => Date][] = [
  ["New Year's Day", (y) => new Date(y, 0, 1)], ["Memorial Day", (y) => lastWeekday(y, 4, 1)], ["Independence Day", (y) => new Date(y, 6, 4)],
  ["Labor Day", (y) => nthWeekday(y, 8, 1, 1)], ["Thanksgiving", (y) => nthWeekday(y, 10, 4, 4)], ["Christmas Day", (y) => new Date(y, 11, 25)],
];
const dateStr = (d: any) => d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}` : "";
const parseDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : undefined; };
function SpecialHoursEditor({ periods, onChange, errors }: { periods: any[]; onChange: (p: any[]) => void; errors?: string[] }) {
  const put = (i: number, p: any) => onChange(periods.map((x, j) => j === i ? p : x));
  const sorted = [...periods].map((p, i) => ({ p, i })).sort((a, b) => dateStr(a.p.startDate).localeCompare(dateStr(b.p.startDate)));
  return (
    <Field label="Special hours (holidays)" field="specialHours" errors={errors} hint="A row per day. Closed, or different hours. Past dates are harmless; Google ignores them.">
      <div className="flex flex-wrap gap-1.5" data-testid="list-holiday-quick-add">
        {HOLIDAYS.map(([name, rule]) => { const d = nextHoliday(rule); const exists = periods.some((p) => dateStr(p.startDate) === dateStr(d)); return <Button key={name} type="button" size="sm" variant="outline" disabled={exists} onClick={() => onChange([...periods, { startDate: d, closed: true }])} data-testid={`button-holiday-${name.replace(/[^\w]/g, "-").toLowerCase()}`}><Plus className="h-3.5 w-3.5" aria-hidden="true" />{name} {d.year}</Button>; })}
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...periods, { startDate: parseDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10)), closed: true }])} data-testid="button-special-add"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Other date</Button>
      </div>
      {sorted.length > 0 && <div className="divide-y rounded-md border">
        {sorted.map(({ p, i }) => (
          <div key={i} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`special-${i}`}>
            <Input type="date" className="w-40" value={dateStr(p.startDate)} onChange={(e) => put(i, { ...p, startDate: parseDate(e.target.value) ?? p.startDate })} data-testid={`input-special-${i}-date`} aria-label="Date" />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!p.closed} onChange={(e) => put(i, e.target.checked ? { startDate: p.startDate, closed: true } : { startDate: p.startDate, openTime: { hours: 9 }, closeTime: { hours: 17 } })} data-testid={`checkbox-special-${i}-closed`} />Closed</label>
            {!p.closed && <><TimeSelect label="Opens" value={p.openTime} onChange={(t) => put(i, { ...p, openTime: t })} testId={`select-special-${i}-open`} /><span className="text-xs text-muted-foreground">to</span><TimeSelect label="Closes" value={p.closeTime} onChange={(t) => put(i, { ...p, closeTime: t })} testId={`select-special-${i}-close`} /></>}
            <Button type="button" size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="Remove special day" onClick={() => onChange(periods.filter((_, j) => j !== i))} data-testid={`button-special-${i}-remove`}><X className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>}
    </Field>
  );
}

/* ── Attributes ──────────────────────────────────────────────────────────── */
function AttributesEditor({ metadata, value, onChange, errors, loading }: { metadata: Meta[]; value: AttributeValue[]; onChange: (v: AttributeValue[]) => void; errors: FieldIssues; loading: boolean }) {
  const byName = new Map(value.map((a) => [a.name, a]));
  const put = (m: Meta, next: Partial<AttributeValue> | null) => {
    const rest = value.filter((a) => a.name !== m.name);
    onChange(next ? [...rest, { name: m.name, valueType: m.valueType, ...next }] : rest);
  };
  if (loading) return <p className="text-sm text-muted-foreground" data-testid="text-attributes-loading">Loading the attributes Google offers for this category…</p>;
  const groups = new Map<string, Meta[]>();
  for (const m of metadata) if (!m.deprecated) (groups.get(m.groupDisplayName) ?? groups.set(m.groupDisplayName, []).get(m.groupDisplayName)!).push(m);
  if (!groups.size) return <p className="text-sm text-muted-foreground" data-testid="text-attributes-none">Google lists no editable attributes for this category.</p>;
  const unknown = value.filter((a) => !metadata.some((m) => m.name === a.name));
  return (
    <div className="space-y-4" data-testid="list-attributes">
      {[...groups.entries()].map(([group, list]) => (
        <details key={group} className="rounded-md border" open={list.some((m) => byName.has(m.name))}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{group} <span className="text-xs text-muted-foreground">({list.filter((m) => byName.has(m.name)).length}/{list.length} set)</span></summary>
          <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
            {list.map((m) => {
              const cur = byName.get(m.name); const err = errors[m.name]; const tid = `attr-${m.name.split("/").pop()}`;
              return (
                <div key={m.name} className="space-y-1" data-testid={tid}>
                  <span className="block text-sm">{m.displayName}</span>
                  {m.valueType === "BOOL" && <select className={select} value={cur ? String(cur.values?.[0]) : ""} onChange={(e) => put(m, e.target.value === "" ? null : { values: [e.target.value === "true"] })} data-testid={`${tid}-select`}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>}
                  {m.valueType === "ENUM" && <select className={select} value={cur?.values?.[0] ?? ""} onChange={(e) => put(m, e.target.value === "" ? null : { values: [e.target.value] })} data-testid={`${tid}-select`}><option value="">Not set</option>{m.valueMetadata.map((v) => <option key={String(v.value)} value={v.value}>{v.displayName}</option>)}</select>}
                  {m.valueType === "URL" && <Input value={cur?.uriValues?.[0]?.uri ?? ""} placeholder="https://" inputMode="url" onChange={(e) => put(m, e.target.value ? { uriValues: [{ uri: e.target.value }] } : null)} data-testid={`${tid}-input`} />}
                  {m.valueType === "REPEATED_ENUM" && <div className="grid gap-1 sm:grid-cols-2">{m.valueMetadata.map((v) => {
                    const setV = cur?.repeatedEnumValue?.setValues ?? [], unsetV = cur?.repeatedEnumValue?.unsetValues ?? [];
                    const state = setV.includes(v.value) ? "yes" : unsetV.includes(v.value) ? "no" : "";
                    return <label key={String(v.value)} className="flex items-center gap-1.5 text-xs"><select className="h-7 rounded border border-input bg-background px-1 text-xs" aria-label={v.displayName} value={state} onChange={(e) => { const s = setV.filter((x) => x !== v.value), u = unsetV.filter((x) => x !== v.value); if (e.target.value === "yes") s.push(v.value); if (e.target.value === "no") u.push(v.value); put(m, s.length || u.length ? { repeatedEnumValue: { setValues: s, unsetValues: u } } : null); }} data-testid={`${tid}-${String(v.value)}`}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>{v.displayName}</label>;
                  })}</div>}
                  {err?.map((e) => <p key={e} role="alert" className="text-xs text-destructive">{e}</p>)}
                </div>
              );
            })}
          </div>
        </details>
      ))}
      {unknown.length > 0 && <p className="text-xs text-muted-foreground" data-testid="text-attributes-unknown">{unknown.length} attribute{unknown.length === 1 ? "" : "s"} on the listing are not offered for this category any more and are left as they are.</p>}
    </div>
  );
}

/* ── Services ────────────────────────────────────────────────────────────── */
function ServicesEditor({ draft, onChange, errors, warnings }: { draft: any; onChange: (items: any[]) => void; errors?: string[]; warnings?: string[] }) {
  const items: any[] = draft.serviceItems ?? [];
  const cats = [draft.categories?.primaryCategory, ...(draft.categories?.additionalCategories ?? [])].filter(Boolean);
  const types = cats.flatMap((c: any) => (c.serviceTypes ?? []).map((t: any) => ({ ...t, category: c.displayName ?? c.name })));
  const typeName = (id: string) => types.find((t) => t.serviceTypeId === id)?.displayName ?? id.split(":").pop()!.replace(/_/g, " ");
  const used = new Set(items.map((i) => i.structuredServiceItem?.serviceTypeId).filter(Boolean));
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const put = (i: number, item: any) => onChange(items.map((x, j) => j === i ? item : x));
  const price = (i: number, text: string) => { const item = { ...items[i] }; if (!text.trim()) delete item.price; else { const m = moneyFromDecimal(text, item.price?.currencyCode ?? "USD"); item.price = m ?? { currencyCode: item.price?.currencyCode ?? "USD", units: text }; } put(i, item); };
  return (
    <Field label="Services" field="serviceItems" errors={errors} warnings={warnings} hideLabel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 gap-2">
          <select className={select} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Google service type" data-testid="select-service-type">
            <option value="">Add one of Google's service types…</option>
            {types.filter((t) => !used.has(t.serviceTypeId)).map((t) => <option key={t.serviceTypeId} value={t.serviceTypeId}>{t.displayName} ({t.category})</option>)}
          </select>
          <Button type="button" variant="outline" disabled={!pick} onClick={() => { onChange([...items, { structuredServiceItem: { serviceTypeId: pick } }]); setPick(""); }} data-testid="button-service-add-structured"><Plus className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        <div className="flex flex-1 gap-2">
          <Input placeholder="Or a custom service name" value={custom} onChange={(e) => setCustom(e.target.value)} data-testid="input-service-custom" />
          <Button type="button" variant="outline" disabled={!custom.trim() || !cats[0]?.name} onClick={() => { onChange([...items, { freeFormServiceItem: { category: cats[0].name, label: { displayName: custom.trim(), languageCode: draft.languageCode ?? "en" } } }]); setCustom(""); }} data-testid="button-service-add-custom"><Plus className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </div>
      {!types.length && <p className="text-xs text-muted-foreground">Google's predefined service types appear here once a category with service types is set.</p>}
      {items.length > 0 && <div className="divide-y rounded-md border">
        {items.map((item, i) => {
          const s = item.structuredServiceItem, f = item.freeFormServiceItem; const desc = s ? s.description : f?.label?.description; const limit = s ? LIMITS.structuredServiceDescription : LIMITS.freeFormServiceDescription;
          return (
            <div key={i} className="grid gap-2 p-2.5 sm:grid-cols-[1fr_8rem_auto]" data-testid={`service-${i}`}>
              <div className="min-w-0 space-y-1">
                {s ? <p className="text-sm font-medium">{typeName(s.serviceTypeId)} <span className="text-xs font-normal text-muted-foreground">Google service type</span></p>
                  : <Input value={f.label?.displayName ?? ""} onChange={(e) => put(i, { ...item, freeFormServiceItem: { ...f, label: { ...f.label, displayName: e.target.value } } })} aria-label="Service name" data-testid={`input-service-${i}-name`} />}
                <Textarea rows={2} placeholder={`Description (optional, up to ${limit})`} value={desc ?? ""} onChange={(e) => { const v = e.target.value || undefined; put(i, s ? { ...item, structuredServiceItem: { ...s, description: v } } : { ...item, freeFormServiceItem: { ...f, label: { ...f.label, description: v } } }); }} data-testid={`textarea-service-${i}-description`} />
              </div>
              <label className="text-xs"><span className="text-muted-foreground">Fixed price ({item.price?.currencyCode ?? "USD"})</span><Input inputMode="decimal" placeholder="—" value={decimalFromMoney(item.price)} onChange={(e) => price(i, e.target.value)} data-testid={`input-service-${i}-price`} /></label>
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8 self-start" aria-label="Remove service" onClick={() => onChange(items.filter((_, j) => j !== i))} data-testid={`button-service-${i}-remove`}><X className="h-4 w-4" /></Button>
            </div>
          );
        })}
      </div>}
    </Field>
  );
}

/* ── Labels ──────────────────────────────────────────────────────────────── */
function LabelsEditor({ value, onChange, errors }: { value: string[]; onChange: (v: string[]) => void; errors?: string[] }) {
  const [text, setText] = useState("");
  const add = () => { const t = text.trim(); if (t && !value.includes(t)) onChange([...value, t]); setText(""); };
  return (
    <Field label="Labels" field="labels" errors={errors} hideLabel hint={`1–${LIMITS.labelLength} characters each. Press Enter to add.`}>
      <div className="flex flex-wrap gap-1.5" data-testid="list-labels">{value.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs" data-testid="chip-label">{l}<button type="button" aria-label={`Remove ${l}`} className="rounded hover:bg-muted" onClick={() => onChange(value.filter((x) => x !== l))}><X className="h-3 w-3" /></button></span>)}{!value.length && <span className="text-xs text-muted-foreground">No labels.</span>}</div>
      <div className="flex gap-2"><Input value={text} maxLength={LIMITS.labelLength} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="e.g. north-crew" data-testid="input-label-new" /><Button type="button" variant="outline" onClick={add} disabled={!text.trim()} data-testid="button-label-add"><Plus className="h-4 w-4" aria-hidden="true" /></Button></div>
    </Field>
  );
}

/* ── Changes + verdicts ──────────────────────────────────────────────────── */
function VerdictBadge({ v }: { v: Verdict | "rejected" }) {
  const styles: Record<string, string> = {
    applied: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    pending: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30",
    unconfirmed: "bg-muted text-muted-foreground ring-border", rejected: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
  };
  const text: Record<string, string> = { applied: "Saved", pending: "Pending Google review", unconfirmed: "Not confirmed", rejected: "Rejected" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", styles[v])} data-testid={`verdict-${v}`}>{v === "applied" ? <Check className="h-3 w-3" aria-hidden="true" /> : v === "pending" ? <Clock className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}{text[v]}</span>;
}
function ChangesPanel({ change, attrChange, metadata, errors, attrErrors, warnings, result }: { change: { fields: Record<string, any>; mask: string[] }; attrChange: { attributeMask: string[] }; metadata: Meta[]; errors: FieldIssues; attrErrors: FieldIssues; warnings: FieldIssues; result: SaveResult | null }) {
  const attrLabel = (n: string) => metadata.find((m) => m.name === n)?.displayName ?? n.split("/").pop()!.replace(/_/g, " ");
  const total = change.mask.length + attrChange.attributeMask.length;
  return (
    <div className="space-y-3 text-sm">
      {result && (
        <div className="space-y-1.5 rounded-md border p-3" data-testid="panel-save-result">
          {result.rejected && <Notice tone="danger" title="Google rejected the change" testId="notice-rejected">{result.rejected}{result.rejectedErrors && <ul className="mt-1 list-disc pl-4 text-xs">{Object.entries(result.rejectedErrors).map(([f, list]) => list.map((e) => <li key={f + e}>{labelOf(f)}: {e}</li>))}</ul>}</Notice>}
          {Object.entries(result.fields).map(([f, v]) => <div key={f} className="flex items-center justify-between gap-2"><span>{labelOf(f)}</span><VerdictBadge v={v} /></div>)}
          {Object.entries(result.attributes).map(([n, v]) => <div key={n} className="flex items-center justify-between gap-2"><span>{attrLabel(n)}</span><VerdictBadge v={v} /></div>)}
          {Object.values(result.fields).some((v) => v === "pending") && <p className="text-xs text-muted-foreground">Pending fields are not saved yet: Google reviews them and publishes or declines. The editor shows them as pending until then.</p>}
          {Object.values(result.fields).concat(Object.values(result.attributes)).some((v) => v === "unconfirmed") && <p className="text-xs text-muted-foreground">"Not confirmed" means Google accepted the request but its reply did not carry the value. Reload and check before trying again.</p>}
        </div>
      )}
      {total === 0 ? <p className="text-muted-foreground" data-testid="text-no-changes">No changes yet. Edit a field and it appears here with the exact update mask.</p> : (
        <ul className="space-y-1" data-testid="list-changes">
          {change.mask.map((f) => <li key={f} className="flex items-start justify-between gap-2"><span>{labelOf(f)}{change.fields[f] === null && <span className="text-xs text-muted-foreground"> · cleared</span>}</span><code className="shrink-0 text-xs text-muted-foreground">{f}</code></li>)}
          {attrChange.attributeMask.map((n) => <li key={n} className="flex items-start justify-between gap-2"><span>{attrLabel(n)}</span><code className="shrink-0 truncate text-xs text-muted-foreground">{n}</code></li>)}
        </ul>
      )}
      {Object.keys(errors).length + Object.keys(attrErrors).length > 0 && <p className="text-xs text-destructive" data-testid="text-errors-count">{Object.keys(errors).length + Object.keys(attrErrors).length} field{Object.keys(errors).length + Object.keys(attrErrors).length === 1 ? "" : "s"} to fix before saving.</p>}
      {Object.keys(warnings).length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Guideline warnings on {Object.keys(warnings).map(labelOf).join(", ")} — Google may still accept the save.</p>}
    </div>
  );
}

/* ── Multi-location apply ────────────────────────────────────────────────── */
function BulkApply({ fields, others }: { fields: Record<string, any>; others: any[] }) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [targets, setTargets] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const subset = Object.fromEntries(Object.entries(fields).filter(([f]) => picked.includes(f)));
  const { errors } = validateListing(subset);
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/gbp/listing/bulk", { locationIds: targets, fields: subset })).json(),
    onSuccess: (r) => { setResults(r.results); setOpen(false); void queryClient.invalidateQueries({ queryKey: ["/api/locations"] }); toast({ title: `Applied to ${r.results.filter((x: any) => x.ok).length} of ${r.results.length} locations` }); },
    onError: (e: Error) => toast({ title: "Could not apply", description: guardErrorMessage(e), variant: "destructive" }),
  });
  const toggle = <T,>(list: T[], v: T) => list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const risky = ["title", "storefrontAddress", "serviceArea", "phoneNumbers", "websiteUri"];
  return (
    <Section title="Apply to other locations" icon={Copy} description="Write the same change to more of your linked locations. Each gets its own verdict." testId="section-bulk">
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-medium">Fields to copy</legend>
          {Object.keys(fields).map((f) => <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={picked.includes(f)} onChange={() => setPicked(toggle(picked, f))} data-testid={`checkbox-bulk-field-${f.replace(/\./g, "-")}`} />{labelOf(f)}{risky.includes(f) && <span className="text-xs text-amber-700 dark:text-amber-300">(location-specific — usually not copied)</span>}</label>)}
        </fieldset>
        <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-medium">Locations</legend>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">{others.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targets.includes(l.id)} onChange={() => setTargets(toggle(targets, l.id))} data-testid={`checkbox-bulk-location-${l.id}`} />{l.businessName}{l.city ? <span className="text-xs text-muted-foreground"> — {l.city}{l.state ? `, ${l.state}` : ""}</span> : null}</label>)}</div>
        </fieldset>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!picked.length || !targets.length || Object.keys(errors).length > 0} onClick={() => setOpen(true)} data-testid="button-bulk-review">Review and apply…</Button>
        {Object.keys(errors).length > 0 && <span className="text-xs text-destructive">Fix the field errors first.</span>}
      </div>
      {results && <ul className="mt-3 divide-y rounded-md border text-sm" data-testid="list-bulk-results">{results.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"><span>{r.name ?? `Location ${r.id}`}</span>{r.ok ? <span className="flex flex-wrap gap-1">{Object.entries(r.verdicts as Record<string, Verdict>).map(([f, v]) => <span key={f} className="inline-flex items-center gap-1 text-xs">{labelOf(f)} <VerdictBadge v={v} /></span>)}</span> : <span className="text-xs text-destructive">{r.error}</span>}</li>)}</ul>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="dialog-bulk-confirm">
          <DialogHeader><DialogTitle>Apply to {targets.length} location{targets.length === 1 ? "" : "s"}?</DialogTitle><DialogDescription>These fields will be written to each listing below through Google's API. Each location gets a notice and its own result.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><p className="font-medium">Fields</p><ul className="list-disc pl-5">{picked.map((f) => <li key={f}>{labelOf(f)}: <code className="text-xs [overflow-wrap:anywhere]">{typeof subset[f] === "string" ? subset[f] : JSON.stringify(subset[f])}</code></li>)}</ul></div>
            <div><p className="font-medium">Locations</p><ul className="list-disc pl-5">{others.filter((l) => targets.includes(l.id)).map((l) => <li key={l.id}>{l.businessName}{l.city ? ` — ${l.city}` : ""}</li>)}</ul></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-bulk-confirm">{run.isPending ? "Applying…" : "Apply now"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
