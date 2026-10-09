/**
 * "What Google will see": our own rendering of the values the owner is about to save — ConstructHUB's
 * card style and tokens, deliberately not Google's layout (the Business Profile API policy forbids
 * replicating Google's look and feel). Every line comes from the draft; nothing is guessed, and an
 * unknown value is simply left out.
 */
import { Globe, MapPin, Phone, Clock, Tag, Wrench, Sparkles } from "lucide-react";
import { DAYS, type AttributeValue } from "@shared/gbp-listing";
import { cn } from "@/lib/utils";

type Meta = { name: string; displayName: string; valueType: string; valueMetadata: { value: any; displayName: string }[] };

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const minutes = (t: any) => Number(t?.hours ?? 0) * 60 + Number(t?.minutes ?? 0);
const clock = (t: any) => { const m = minutes(t); const h = Math.floor(m / 60) % 24, mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/** Open-now from regular + special hours, computed in the viewer's clock (Google uses the business's zone). */
export function openState(loc: any, now = new Date()): { label: string; open: boolean | null } {
  const status = loc?.openInfo?.status;
  if (status === "CLOSED_PERMANENTLY") return { label: "Permanently closed", open: false };
  if (status === "CLOSED_TEMPORARILY") return { label: "Temporarily closed", open: false };
  const day = DAYS[(now.getDay() + 6) % 7], nowMin = now.getHours() * 60 + now.getMinutes();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const special = (loc?.specialHours?.specialHourPeriods ?? []).filter((p: any) => p?.startDate && p.startDate.year === today.year && p.startDate.month === today.month && p.startDate.day === today.day);
  if (special.length) {
    if (special.every((p: any) => p.closed)) return { label: "Closed today (special hours)", open: false };
    const open = special.some((p: any) => !p.closed && nowMin >= minutes(p.openTime) && nowMin < minutes(p.closeTime));
    return { label: open ? "Open now · special hours" : "Closed now · special hours", open };
  }
  const periods = loc?.regularHours?.periods ?? [];
  if (!periods.length) return { label: "Hours not set", open: null };
  const todays = periods.filter((p: any) => p.openDay === day);
  const ranges: { from: number; to: number }[] = todays.map((p: any) => ({ from: minutes(p.openTime), to: p.closeDay && p.closeDay !== p.openDay ? 1440 : minutes(p.closeTime) }));
  for (const p of periods) if (p.closeDay === day && p.openDay !== day) ranges.push({ from: 0, to: minutes(p.closeTime) });
  if (!ranges.length) return { label: `Closed ${cap(day)}`, open: false };
  const hit = ranges.find((r) => nowMin >= r.from && nowMin < r.to);
  if (hit) return { label: hit.to >= 1440 && hit.from === 0 ? "Open 24 hours" : `Open now · closes ${clock({ hours: Math.floor(hit.to / 60), minutes: hit.to % 60 })}`, open: true };
  const next = ranges.filter((r) => r.from > nowMin).sort((a, b) => a.from - b.from)[0];
  return { label: next ? `Closed · opens ${clock({ hours: Math.floor(next.from / 60), minutes: next.from % 60 })}` : "Closed now", open: false };
}

export function hoursByDay(loc: any): { day: string; text: string }[] {
  const periods = loc?.regularHours?.periods ?? [];
  return DAYS.map((d) => {
    const mine = periods.filter((p: any) => p.openDay === d).sort((a: any, b: any) => minutes(a.openTime) - minutes(b.openTime));
    if (!mine.length) return { day: cap(d), text: "Closed" };
    return { day: cap(d), text: mine.map((p: any) => (minutes(p.openTime) === 0 && minutes(p.closeTime) === 1440 && (!p.closeDay || p.closeDay === d)) ? "Open 24 hours" : `${clock(p.openTime)} – ${minutes(p.closeTime) === 1440 ? "12:00 AM" : clock(p.closeTime)}${p.closeDay && p.closeDay !== d ? ` (${cap(p.closeDay).slice(0, 3)})` : ""}`).join(", ") };
  });
}

export function ListingPreview({ draft, attributes, metadata, className }: { draft: any; attributes: AttributeValue[]; metadata: Meta[]; className?: string }) {
  if (!draft) return null;
  const cats = [draft.categories?.primaryCategory, ...(draft.categories?.additionalCategories ?? [])].filter(Boolean);
  const catLabel = (c: any) => c.displayName || c.name?.replace(/^categories\/gcid:/, "").replace(/_/g, " ");
  const a = draft.storefrontAddress;
  const sab = draft.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY";
  const areas = (draft.serviceArea?.places?.placeInfos ?? []).map((p: any) => p.placeName).filter(Boolean);
  const address = a ? [...(a.addressLines ?? []), [a.locality, a.administrativeArea].filter(Boolean).join(", "), a.postalCode].filter(Boolean).join(", ") : "";
  const state = openState(draft);
  const typeNames = new Map<string, string>(cats.flatMap((c: any) => (c.serviceTypes ?? []).map((t: any) => [t.serviceTypeId, t.displayName])));
  const services = (draft.serviceItems ?? []).map((s: any) => s.freeFormServiceItem?.label?.displayName || (s.structuredServiceItem?.serviceTypeId ? typeNames.get(s.structuredServiceItem.serviceTypeId) ?? s.structuredServiceItem.serviceTypeId.split(":").pop().replace(/_/g, " ") : null)).filter(Boolean);
  const metaByName = new Map(metadata.map((m) => [m.name, m]));
  const highlights = attributes.flatMap((at) => {
    const m = metaByName.get(at.name);
    const label = m?.displayName ?? at.name.split("/").pop()!.replace(/_/g, " ");
    if (at.valueType === "BOOL") return at.values?.[0] === true ? [label] : [];
    if (at.valueType === "ENUM") { const v = m?.valueMetadata.find((x) => x.value === at.values?.[0]); return v ? [`${label}: ${v.displayName}`] : []; }
    if (at.valueType === "REPEATED_ENUM") return (at.repeatedEnumValue?.setValues ?? []).map((v) => m?.valueMetadata.find((x) => x.value === v)?.displayName ?? v);
    return [];
  });
  let host = "";
  try { host = draft.websiteUri ? new URL(draft.websiteUri).host : ""; } catch { host = draft.websiteUri ?? ""; }
  return (
    <div className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} data-testid="preview-listing">
      <div className="h-1.5 rounded-t-xl bg-gradient-to-r from-orange-500 via-amber-400 to-orange-300" aria-hidden="true" />
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold leading-tight" data-testid="preview-title">{draft.title || <span className="text-muted-foreground">Business name</span>}</h3>
          {cats.length > 0 && <p className="mt-0.5 text-sm text-muted-foreground" data-testid="preview-categories">{cats.map(catLabel).join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
            state.open === true ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
              : state.open === false ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30"
                : "bg-muted text-muted-foreground ring-border")} data-testid="preview-open-state">
            <Clock className="h-3 w-3" aria-hidden="true" />{state.label}
          </span>
          {draft.openInfo?.openingDate?.year && <span className="text-xs text-muted-foreground">Since {draft.openInfo.openingDate.year}</span>}
        </div>
        <dl className="space-y-1.5 text-sm">
          {sab
            ? <div className="flex gap-2"><dt className="sr-only">Service area</dt><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="min-w-0" data-testid="preview-areas">{areas.length ? <>Serves {areas.slice(0, 6).join(", ")}{areas.length > 6 ? ` +${areas.length - 6} more` : ""}</> : <span className="text-muted-foreground">Service area not set</span>}</dd></div>
            : address && <div className="flex gap-2"><dt className="sr-only">Address</dt><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="min-w-0 break-words" data-testid="preview-address">{address}{areas.length ? <span className="block text-xs text-muted-foreground">Also serves {areas.slice(0, 4).join(", ")}{areas.length > 4 ? ` +${areas.length - 4}` : ""}</span> : null}</dd></div>}
          {draft.phoneNumbers?.primaryPhone && <div className="flex gap-2"><dt className="sr-only">Phone</dt><Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd data-testid="preview-phone">{draft.phoneNumbers.primaryPhone}</dd></div>}
          {host && <div className="flex gap-2"><dt className="sr-only">Website</dt><Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dd className="truncate" data-testid="preview-website">{host}</dd></div>}
        </dl>
        {draft.profile?.description && <p className="line-clamp-4 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]" data-testid="preview-description">{draft.profile.description}</p>}
        {highlights.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="preview-highlights">
            {highlights.slice(0, 8).map((h) => <span key={h} className="inline-flex items-center gap-1 rounded-md bg-orange-50 px-2 py-0.5 text-xs text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-200 dark:ring-orange-500/25"><Sparkles className="h-3 w-3" aria-hidden="true" />{h}</span>)}
          </div>
        )}
        {services.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"><Wrench className="h-3 w-3" aria-hidden="true" /> Services</p>
            <div className="flex flex-wrap gap-1.5" data-testid="preview-services">
              {services.slice(0, 10).map((s: string, i: number) => <span key={s + i} className="rounded-md border bg-background px-2 py-0.5 text-xs">{s}</span>)}
              {services.length > 10 && <span className="text-xs text-muted-foreground">+{services.length - 10} more</span>}
            </div>
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Hours</summary>
          <ul className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" data-testid="preview-hours">
            {hoursByDay(draft).map((h) => <li key={h.day} className="contents"><span className="text-muted-foreground">{h.day}</span><span>{h.text}</span></li>)}
          </ul>
        </details>
        {(draft.labels?.length ?? 0) > 0 && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="h-3 w-3" aria-hidden="true" /> {draft.labels.length} private label{draft.labels.length === 1 ? "" : "s"} (never shown to customers)</p>}
      </div>
    </div>
  );
}
