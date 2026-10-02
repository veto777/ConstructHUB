import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceProfile } from "@shared/voice-profile";
import { NumberField, RowCard, SectionCard, SelectField, StringListEditor, SwitchRow, TextAreaField, TextField, type SectionProps } from "./fields";

type Credibility = VoiceProfile["credibility"];
type Offers = VoiceProfile["offers"];
type Policies = VoiceProfile["policies"];

/** Credibility — facts the assistant may use on the phone. Typed by you; nothing is fetched or guessed. */
export function CredibilitySection({ value, onChange, disabled }: SectionProps<Credibility>) {
  const set = <K extends keyof Credibility>(k: K, v: Credibility[K]) => onChange({ ...value, [k]: v });
  return (
    <SectionCard title="Credibility" blurb="What the assistant can say when a caller asks why they should trust you. Only what you type here — it never invents a rating or a license." testid="section-credibility">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField id="years" label="Years in business" value={value.yearsInBusiness ?? 0} min={0} max={200} disabled={disabled} testid="input-years-in-business"
          onChange={(n) => set("yearsInBusiness", n > 0 ? n : null)} hint="0 = don't mention." />
        <NumberField id="founded" label="Founded (year)" value={value.foundedYear ?? 0} min={0} max={2100} disabled={disabled} testid="input-founded-year"
          onChange={(n) => set("foundedYear", n >= 1800 ? n : null)} hint="Leave 0 to skip." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchRow id="insured" label="Insured" checked={value.insured} onChange={(v) => set("insured", v)} disabled={disabled} testid="switch-insured" />
        <SwitchRow id="bonded" label="Bonded" checked={value.bonded} onChange={(v) => set("bonded", v)} disabled={disabled} testid="switch-bonded" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <StringListEditor id="licenses" label="Licenses" values={value.licenses} onChange={(v) => set("licenses", v)} disabled={disabled} testid="list-licenses" placeholder="WA license ALPINEX123AB" max={20} />
        <StringListEditor id="warranties" label="Warranties" values={value.warranties} onChange={(v) => set("warranties", v)} disabled={disabled} testid="list-warranties" placeholder="Lifetime workmanship warranty" max={20} />
        <StringListEditor id="certifications" label="Certifications" values={value.certifications} onChange={(v) => set("certifications", v)} disabled={disabled} testid="list-certifications" placeholder="James Hardie Elite Preferred" max={20} />
        <StringListEditor id="awards" label="Awards" values={value.awards} onChange={(v) => set("awards", v)} disabled={disabled} testid="list-awards" placeholder="Best of Bellingham 2025" max={20} />
        <StringListEditor id="memberships" label="Memberships" values={value.memberships} onChange={(v) => set("memberships", v)} disabled={disabled} testid="list-memberships" placeholder="BBB A+, NAHB" max={20} />
        <TextField id="reviews" label="Reviews and ratings" value={value.reviews} onChange={(v) => set("reviews", v)} disabled={disabled} testid="input-reviews"
          placeholder="4.9 stars on Google (312 reviews)" hint="Typed by you. Update it when it changes — the assistant quotes it as-is." maxLength={200} />
      </div>
    </SectionCard>
  );
}

/** Offers — financing, promotions, free-estimate policy, referral program. */
export function OffersSection({ value, onChange, disabled }: SectionProps<Offers>) {
  const set = <K extends keyof Offers>(k: K, v: Offers[K]) => onChange({ ...value, [k]: v });
  const promos = value.promotions;
  return (
    <SectionCard title="Offers" blurb="Things the assistant may bring up when they fit — never as a pitch, always as an answer." testid="section-offers">
      <SwitchRow id="financing" label="Financing available" checked={value.financing.available} disabled={disabled} testid="switch-financing"
        onChange={(v) => set("financing", { ...value.financing, available: v })} hint="When on, the assistant can answer 'do you offer financing?' with the details below." />
      {value.financing.available && (
        <TextAreaField id="financing-details" label="Financing details" value={value.financing.details} disabled={disabled} testid="textarea-financing-details" rows={2} maxLength={2000}
          onChange={(v) => set("financing", { ...value.financing, details: v })} placeholder="0% for 18 months through Synchrony, on approved credit." />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchRow id="free-estimate" label="Estimates are free" checked={value.freeEstimate} onChange={(v) => set("freeEstimate", v)} disabled={disabled} testid="switch-free-estimate" />
        <TextField id="free-estimate-line" label="How the assistant says it" value={value.freeEstimateLine} onChange={(v) => set("freeEstimateLine", v)} disabled={disabled} testid="input-free-estimate-line" maxLength={200} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Current promotions</Label>
          {!disabled && (
            <Button type="button" variant="outline" size="sm" data-testid="button-add-promotion" onClick={() => set("promotions", [...promos, { name: "", details: "", endsOn: null }])}>
              <Plus className="h-4 w-4 mr-1" /> Add promotion
            </Button>
          )}
        </div>
        {promos.map((p, i) => (
          <RowCard key={i} disabled={disabled} testid={`row-promotion-${i}`} onRemove={() => set("promotions", promos.filter((_, j) => j !== i))}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`promo-name-${i}`}>Promotion</Label>
                <Input id={`promo-name-${i}`} value={p.name} disabled={disabled} placeholder="Spring siding special" data-testid={`input-promotion-name-${i}`}
                  onChange={(e) => set("promotions", promos.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`promo-ends-${i}`}>Ends on</Label>
                <Input id={`promo-ends-${i}`} type="date" value={p.endsOn ?? ""} disabled={disabled} data-testid={`input-promotion-ends-${i}`}
                  onChange={(e) => set("promotions", promos.map((x, j) => (j === i ? { ...x, endsOn: e.target.value || null } : x)))} />
              </div>
            </div>
            <Textarea value={p.details} rows={2} disabled={disabled} placeholder="10% off whole-house siding booked before June 30." data-testid={`textarea-promotion-details-${i}`}
              onChange={(e) => set("promotions", promos.map((x, j) => (j === i ? { ...x, details: e.target.value } : x)))} />
          </RowCard>
        ))}
        <p className="text-xs text-muted-foreground">After the end date the assistant stops mentioning a promotion on its own.</p>
      </div>
      <TextAreaField id="referral-program" label="Referral program (optional)" value={value.referralProgram} onChange={(v) => set("referralProgram", v)} disabled={disabled}
        testid="textarea-referral-program" rows={2} maxLength={2000} placeholder="$250 for every referral that becomes a job." />
    </SectionCard>
  );
}

/** Policies — pricing, repairs, minimum job, emergencies, verbatim rules. */
export function PoliciesSection({ value, onChange, disabled }: SectionProps<Policies>) {
  const set = <K extends keyof Policies>(k: K, v: Policies[K]) => onChange({ ...value, [k]: v });
  const ranges = value.priceRanges;
  return (
    <SectionCard title="Policies" blurb="The rules the assistant follows on every call. Short and specific beats long and vague." testid="section-policies">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="pricing" label="Price questions" value={value.pricing} onChange={(v) => set("pricing", v)} disabled={disabled} testid="select-pricing"
          options={[{ value: "never", label: "Never quote — the estimator prices every job" }, { value: "ranges", label: "Read the typed ranges only" }]}
          hint="'Never' is the safe default: the assistant says a free estimate is the only honest price." />
        <SelectField id="repairs" label="Repairs" value={value.repairs} onChange={(v) => set("repairs", v)} disabled={disabled} testid="select-repairs"
          options={[
            { value: "repairs_and_replacements", label: "Repairs and replacements" },
            { value: "replacements_only", label: "Replacements only — decline repairs" },
            { value: "repairs_only", label: "Repairs only" },
          ]}
          hint="'Replacements only' uses the referral lines from Services & don'ts." />
      </div>
      {value.pricing === "ranges" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Price ranges</Label>
            {!disabled && (
              <Button type="button" variant="outline" size="sm" data-testid="button-add-price-range" onClick={() => set("priceRanges", [...ranges, { service: "", range: "" }])}>
                <Plus className="h-4 w-4 mr-1" /> Add range
              </Button>
            )}
          </div>
          {ranges.map((r, i) => (
            <RowCard key={i} disabled={disabled} testid={`row-price-range-${i}`} onRemove={() => set("priceRanges", ranges.filter((_, j) => j !== i))}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={r.service} placeholder="Roof replacement" disabled={disabled} data-testid={`input-price-range-service-${i}`}
                  onChange={(e) => set("priceRanges", ranges.map((x, j) => (j === i ? { ...x, service: e.target.value } : x)))} />
                <Input value={r.range} placeholder="$18,000 – $35,000 for most homes" disabled={disabled} data-testid={`input-price-range-range-${i}`}
                  onChange={(e) => set("priceRanges", ranges.map((x, j) => (j === i ? { ...x, range: e.target.value } : x)))} />
              </div>
            </RowCard>
          ))}
        </div>
      )}
      <TextField id="minimum-job" label="Minimum job (optional)" value={value.minimumJob} onChange={(v) => set("minimumJob", v)} disabled={disabled} testid="input-minimum-job"
        placeholder="Five windows, or whole-house siding" maxLength={200} hint="Said when a request is smaller than you take." />
      <div className="space-y-3">
        <SwitchRow id="emergencies" label="Handle emergencies" checked={value.emergencies.handle} disabled={disabled} testid="switch-emergencies"
          onChange={(v) => set("emergencies", { ...value.emergencies, handle: v })}
          hint="When on, a matching call triggers the Emergency escalation (see Escalations) at any hour." />
        {value.emergencies.handle && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField id="emergency-definition" label="What counts as an emergency" value={value.emergencies.definition} disabled={disabled} testid="textarea-emergency-definition" rows={2} maxLength={2000}
              onChange={(v) => set("emergencies", { ...value.emergencies, definition: v })} />
            <TextAreaField id="emergency-line" label="What the assistant promises" value={value.emergencies.line} disabled={disabled} testid="textarea-emergency-line" rows={2} maxLength={200}
              onChange={(v) => set("emergencies", { ...value.emergencies, line: v })} hint="Promise only what your escalation rule delivers." />
          </div>
        )}
      </div>
      <StringListEditor id="rules" label="Extra rules, verbatim" values={value.rules} onChange={(v) => set("rules", v)} disabled={disabled} testid="list-rules" max={40}
        placeholder="Never promise a start date." hint="One rule per line. These go into the prompt word for word." />
    </SectionCard>
  );
}
