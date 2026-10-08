import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { US_TIMEZONES, toE164 } from "@/lib/voice-studio";
import type { VoiceProfile } from "@shared/voice-profile";
import { HoursEditor, RowCard, SectionCard, SelectField, StringListEditor, TextAreaField, TextField, type SectionProps } from "./fields";

type Company = VoiceProfile["company"];

/** Company — who the assistant answers for. OWNER: studio-frontend lane. */
export function CompanySection({ value, onChange, disabled }: SectionProps<Company>) {
  const set = <K extends keyof Company>(k: K, v: Company[K]) => onChange({ ...value, [k]: v });
  return (
    <SectionCard title="Company" blurb="The assistant introduces itself with these words. Say it the way a caller would hear it." testid="section-company">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="company-name" label="Company name" value={value.name} onChange={(v) => set("name", v)} disabled={disabled}
          testid="input-company-name" placeholder="Evergreen Exteriors LLC" hint="Required. Used everywhere, never abbreviated unless you set a spoken name." maxLength={200} />
        <TextField id="company-spoken" label="Spoken name (optional)" value={value.spokenName} onChange={(v) => set("spokenName", v)} disabled={disabled}
          testid="input-company-spoken-name" placeholder="Evergreen" hint="How the assistant says the name on the phone if the legal name is a mouthful." maxLength={200} />
        <TextField id="company-trade" label="Trade, in one line" value={value.trade} onChange={(v) => set("trade", v)} disabled={disabled}
          testid="input-company-trade" placeholder="licensed exterior contractor" hint='Finishes the sentence "We are a …".' maxLength={200} />
        <TextField id="company-tagline" label="Tagline (optional)" value={value.tagline} onChange={(v) => set("tagline", v)} disabled={disabled}
          testid="input-company-tagline" placeholder="Siding, roofing, windows and decks since 1998" maxLength={200}
          hint="The assistant may use it when a caller asks what the company is about." />
        <TextField id="company-phone" label="Office phone" value={value.officePhone} onChange={(v) => set("officePhone", toE164(v))} disabled={disabled}
          testid="input-company-phone" placeholder="+13605551234" inputMode="tel" hint={'For "what is your number?" — the office line, never the assistant\'s own.'} />
        <TextField id="company-website" label="Website" value={value.website} onChange={(v) => set("website", v)} disabled={disabled}
          testid="input-company-website" placeholder="https://example.com" inputMode="url" maxLength={300} />
        <SelectField id="company-timezone" label="Timezone" value={value.timezone} onChange={(v) => set("timezone", v)} disabled={disabled}
          testid="select-company-timezone" options={US_TIMEZONES.map((t) => ({ value: t.id, label: t.label }))}
          hint="Hours, reminders and 'call you back tomorrow' all use this clock." />
      </div>
      <TextAreaField id="company-about" label="About the company" value={value.about} onChange={(v) => set("about", v)} disabled={disabled}
        testid="textarea-company-about" rows={4} maxLength={2000}
        placeholder="Family-owned since 1998. Three crews. We only install what we'd put on our own homes."
        hint="Plain facts the assistant may read from when a caller asks about you. Nothing here is invented — if you leave it blank, it says nothing." />
      <div className="space-y-1.5">
        <Label>Hours</Label>
        <HoursEditor value={value.hours} onChange={(v) => set("hours", v)} disabled={disabled} />
      </div>
    </SectionCard>
  );
}

/** Services, materials, brands and the declines with referral lines. */
export function ServicesSection({ value, onChange, disabled }: SectionProps<Company>) {
  const set = <K extends keyof Company>(k: K, v: Company[K]) => onChange({ ...value, [k]: v });
  const services = value.services;
  const declines = value.declines;
  return (
    <SectionCard title="Services & don'ts" blurb="What you sell, and — just as important — what the assistant should politely decline and where to send those callers instead." testid="section-services">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Services</Label>
          {!disabled && (
            <Button type="button" variant="outline" size="sm" data-testid="button-add-service"
              onClick={() => set("services", [...services, { name: "", details: "", tier: "primary" }])}>
              <Plus className="h-4 w-4 mr-1" /> Add service
            </Button>
          )}
        </div>
        {services.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-services-empty">No services yet. Add at least one — the assistant only takes calls about what is listed here.</p>}
        {services.map((s, i) => (
          <RowCard key={i} disabled={disabled} testid={`row-service-${i}`} onRemove={() => set("services", services.filter((_, j) => j !== i))} removeLabel="Remove service">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`service-name-${i}`}>Service</Label>
                <Input id={`service-name-${i}`} value={s.name} disabled={disabled} placeholder="Siding replacement" data-testid={`input-service-name-${i}`}
                  onChange={(e) => set("services", services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </div>
              <div className="space-y-1.5">
                <Label>Pitched</Label>
                <RadioGroup value={s.tier} disabled={disabled} className="flex gap-3 pt-2"
                  onValueChange={(tier) => set("services", services.map((x, j) => (j === i ? { ...x, tier: tier as "primary" | "secondary" } : x)))}>
                  <label className="flex items-center gap-1.5 text-sm"><RadioGroupItem value="primary" data-testid={`radio-service-tier-${i}-primary`} /> Primary</label>
                  <label className="flex items-center gap-1.5 text-sm"><RadioGroupItem value="secondary" data-testid={`radio-service-tier-${i}-secondary`} /> Only with a primary job</label>
                </RadioGroup>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`service-details-${i}`}>Details the assistant may share (optional)</Label>
              <Textarea id={`service-details-${i}`} value={s.details} rows={2} disabled={disabled} data-testid={`textarea-service-details-${i}`}
                placeholder="e.g. Full replacement only, fiber cement siding. Minimum five windows per order."
                onChange={(e) => set("services", services.map((x, j) => (j === i ? { ...x, details: e.target.value } : x)))} />
            </div>
          </RowCard>
        ))}
        <p className="text-xs text-muted-foreground">"Primary" services are what the assistant leads with. "Only with a primary job" (gutters with a roof, painting with siding) is never pitched on its own.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StringListEditor id="company-materials" label="Materials" values={value.materials} onChange={(v) => set("materials", v)} disabled={disabled}
          testid="list-materials" placeholder="e.g. fiber cement siding" hint="What you install. The assistant recommends these and does not invent others." max={40} />
        <StringListEditor id="company-brands" label="Brands" values={value.brands} onChange={(v) => set("brands", v)} disabled={disabled}
          testid="list-brands" placeholder="e.g. the siding and window brands you install" max={40} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>What we don't do</Label>
          {!disabled && (
            <Button type="button" variant="outline" size="sm" data-testid="button-add-decline"
              onClick={() => set("declines", [...declines, { what: "", referral: "" }])}>
              <Plus className="h-4 w-4 mr-1" /> Add a don't
            </Button>
          )}
        </div>
        {declines.map((d, i) => (
          <RowCard key={i} disabled={disabled} testid={`row-decline-${i}`} onRemove={() => set("declines", declines.filter((_, j) => j !== i))} removeLabel="Remove">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`decline-what-${i}`}>We don't do…</Label>
                <Input id={`decline-what-${i}`} value={d.what} disabled={disabled} placeholder="Repairs or patch jobs of any kind" data-testid={`input-decline-what-${i}`}
                  onChange={(e) => set("declines", declines.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`decline-referral-${i}`}>Instead, the assistant suggests…</Label>
                <Input id={`decline-referral-${i}`} value={d.referral} disabled={disabled} placeholder="a local handyman company would be the best fit" data-testid={`input-decline-referral-${i}`}
                  onChange={(e) => set("declines", declines.map((x, j) => (j === i ? { ...x, referral: e.target.value } : x)))} />
              </div>
            </div>
          </RowCard>
        ))}
        <p className="text-xs text-muted-foreground">Example: "1–2 windows" → "Safelite's residential window division". A polite no with a real suggestion keeps the caller happy and your crews on the right jobs.</p>
      </div>
    </SectionCard>
  );
}
