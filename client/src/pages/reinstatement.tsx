import { AppPage, PageHeader, Section, StatGrid, Stat } from "@/components/app-ui";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert, PhoneOff, MapPinOff, StarOff, CheckCircle2,
  AlertTriangle, ArrowRight, Loader2, Shield, Search, Wrench,
  FileCheck, MessageCircle, Clock, Building2,
} from "lucide-react";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { GBP_REINSTATEMENT_CENTS } from "@shared/plans";
import { formatUsd } from "@shared/plan-copy";
import { StandingGator } from "@/components/mascot";
import { BTN_LG, BTN_PRIMARY, H2, Kicker, LEAD } from "@/components/feature-landing/primitives";

const SUSPENSION_REASONS = [
  { icon: AlertTriangle, title: "Business name keyword stuffing", desc: "Adding extra keywords or location names to your business name that don't reflect your real-world name." },
  { icon: AlertTriangle, title: "Address or eligibility issues", desc: "Using virtual offices, PO Boxes, or co-working space addresses that violate Google's location policies." },
  { icon: AlertTriangle, title: "Multiple listings for one location", desc: "Creating duplicate profiles for the same business at the same address." },
  { icon: AlertTriangle, title: "Suspicious review patterns", desc: "A surge of reviews that Google flags as potentially incentivized or fake." },
  { icon: AlertTriangle, title: "Service area or category issues", desc: "Misrepresenting your service area, categories, or the nature of your business." },
];

const PROCESS_STEPS = [
  { num: 1, title: "Tell us about your situation", desc: "Fill out our request form to get things started. We'll review your case, follow up with any questions, and let you know if we think we can help." },
  { num: 2, title: "Full assessment", desc: "If we think we can help, we ask for all the details and look into what caused the suspension." },
  { num: 3, title: "Fix & comply", desc: "We tell you every change to make and every supporting document that may be needed, and bring the profile in line with Google's guidelines before anything is submitted." },
  { num: 4, title: "Appeal", desc: "We write and submit an evidence-based appeal and keep you updated until Google makes its decision." },
];

const CONSEQUENCES = [
  { icon: PhoneOff, title: "Your phone stops ringing", desc: "No listing means no calls from Google. For businesses that depend on local search leads, this means revenue dries up almost instantly." },
  { icon: MapPinOff, title: "Customers can't find you", desc: "You vanish from Google Maps and local search results. Potential customers searching for your services will find your competitors instead." },
  { icon: StarOff, title: "Your reviews disappear", desc: "Years of hard-earned reviews and star ratings go invisible. The social proof you've built — gone from sight when you need it most." },
];

// Only claims this page can stand behind: what the service does. Track-record
// figures (years, businesses helped, staff credentials) stay off until the
// owner supplies ones that can be backed up.
const TRUST_POINTS = [
  { icon: FileCheck, title: "Guideline-first review", desc: "Every case is checked against Google's published Business Profile guidelines before anything is submitted." },
  { icon: Search, title: "Honest case assessment", desc: "We review your situation first and tell you whether we think we can help before taking the case." },
  { icon: Shield, title: "Robust, foundational approach", desc: "We don't just appeal — we fix the root cause, so your profile is built on a compliant foundation." },
  { icon: MessageCircle, title: "Communication until resolved", desc: "We handle the appeal and keep you updated until Google makes its decision. Google alone decides whether a profile is reinstated." },
];

/** Same shape the server's email check accepts (name@domain.tld). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ReinstatementPage() {
  const { toast } = useToast();
  const { data: user } = useQuery<any>({queryKey:["/api/auth/me"]});
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    businessName: "",
    websiteUrl: "",
    businessAddress: "",
    businessType: "",
    multipleLocations: "no",
    problemDescription: "",
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reinstatement/request", formData);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Request submitted", description: "We'll review your case and get back to you within 1-2 business days." });
      setFormData({ name: "", email: "", businessName: "", websiteUrl: "", businessAddress: "", businessType: "", multipleLocations: "no", problemDescription: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: apiErrorMessage(err), variant: "destructive" });
    },
  });

  // A real <form>: the browser checks type="email" first, then this catches
  // what it lets through (e.g. "name@host" with no domain ending).
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitMutation.isPending) return;
    if (!EMAIL_PATTERN.test(formData.email.trim())) {
      toast({ title: "Check your email", description: "Enter a valid email address", variant: "destructive" });
      return;
    }
    submitMutation.mutate();
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canSubmit = [formData.name, formData.email, formData.businessName, formData.businessAddress, formData.businessType, formData.problemDescription]
    .every((v) => v.trim() !== "");

  const requestForm = (                <form className="space-y-4" onSubmit={handleSubmit} data-testid="form-reinstatement">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Your name <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                      <Input value={formData.name} onChange={e => updateField("name", e.target.value)} className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="input-reinstate-name" />
                    </div>
                    <div>
                      <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Your email <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                      <Input type="email" required value={formData.email} onChange={e => updateField("email", e.target.value)} className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="input-reinstate-email" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Business name <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                      <Input value={formData.businessName} onChange={e => updateField("businessName", e.target.value)} className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="input-reinstate-business" />
                    </div>
                    <div>
                      <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Website URL</Label>
                      <Input value={formData.websiteUrl} onChange={e => updateField("websiteUrl", e.target.value)} className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="input-reinstate-website" />
                    </div>
                  </div>
                  <div>
                    <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Business address <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                    <p className="text-xs text-muted-foreground">Please include this, even if the address is hidden.</p>
                    <Input value={formData.businessAddress} onChange={e => updateField("businessAddress", e.target.value)} className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="input-reinstate-address" />
                  </div>
                  <div>
                    <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Which best describes your business? <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                    <Select value={formData.businessType} onValueChange={v => updateField("businessType", v)}>
                      <SelectTrigger className={user ? "mt-1.5 min-h-10" : FIELD} data-testid="select-business-type">
                        <SelectValue placeholder="Please choose one" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="storefront">Storefront / Physical location</SelectItem>
                        <SelectItem value="service-area">Service area business (no storefront)</SelectItem>
                        <SelectItem value="hybrid">Hybrid (storefront + service area)</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Does this business have multiple locations? <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                    <RadioGroup value={formData.multipleLocations} onValueChange={v => updateField("multipleLocations", v)} className="flex gap-4 mt-2">
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="no" id="multi-no" data-testid="radio-multi-no" />
                        <Label htmlFor="multi-no" className="text-sm">No</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="yes" id="multi-yes" data-testid="radio-multi-yes" />
                        <Label htmlFor="multi-yes" className="text-sm">Yes</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div>
                    <Label className={user ? "text-sm font-medium" : FIELD_LABEL}>Describe the problem you're having <span className={user ? "text-muted-foreground font-normal" : REQUIRED}>(required)</span></Label>
                    <Textarea
                      value={formData.problemDescription}
                      onChange={e => updateField("problemDescription", e.target.value)}
                      placeholder="Tell us about the suspension — when it happened, any details from Google, anything you've already tried, and anything else we should know."
                      rows={4}
                      className={user ? "mt-1.5" : "mt-1.5 rounded-lg bg-mkt-paper text-[15px] md:text-[15px]"}
                      data-testid="textarea-problem-description"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-12 rounded-lg text-base font-semibold"
                    disabled={!canSubmit || submitMutation.isPending}
                    data-testid="button-submit-reinstatement"
                  >
                    {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Submit
                  </Button>
                </form>);
  if (user) return <AppPage width="narrow" testId="page-reinstatement">
    <PageHeader title={<span data-testid="text-reinstatement-title">Profile reinstatement</span>} description="Request help with a suspended Google Business Profile." actions={<Button asChild variant="outline"><a href="#request" data-testid="button-get-reinstated">Review request form</a></Button>}/>
    <div data-testid="reinstatement-facts"><StatGrid cols={2}><Stat label="Flat project rate" value={formatUsd(GBP_REINSTATEMENT_CENTS)} testId="card-reinstatement-pricing"/><Stat label="Initial review" value="1–2 days" hint="Business days"/></StatGrid></div>
    <Section id="request" title={<span data-testid="text-form-title">Tell us about your suspension</span>} testId="card-reinstatement-form" description="We’ll review your case before taking it on.">
      {requestForm}
    </Section>
    <details className="rounded-xl border bg-card p-4 space-y-4"><summary className="cursor-pointer min-h-10 py-2 font-medium">How reinstatement works</summary>
      <p className="text-sm text-muted-foreground" data-testid="badge-service-label">Google Business Profile reinstatement service</p>
      <h2 className="font-semibold" data-testid="text-process-title">How we get you back on the map</h2>
      <ol className="space-y-4">{PROCESS_STEPS.map(step=><li key={step.num} data-testid={`process-step-${step.num}`}><h3 className="text-sm font-medium">{step.num}. {step.title}</h3><p className="text-sm text-muted-foreground">{step.desc}</p></li>)}</ol>
      <h2 className="font-semibold" data-testid="text-suspension-reasons-title">Common suspension reasons</h2>
      {SUSPENSION_REASONS.map((reason,i)=><p className="text-sm" key={i} data-testid={`suspension-reason-${i}`}><strong>{reason.title}.</strong> {reason.desc}</p>)}
      <h2 className="font-semibold" data-testid="text-consequences-title">What a suspension affects</h2>
      {CONSEQUENCES.map((item,i)=><p className="text-sm" key={i} data-testid={`card-consequence-${i}`}>{item.title}: {item.desc}</p>)}
      <h2 className="font-semibold" data-testid="text-trust-title">What to expect</h2>
      {TRUST_POINTS.map((item,i)=><p className="text-sm" key={i} data-testid={`card-trust-${i}`}><strong>{item.title}.</strong> {item.desc}</p>)}
    </details>
  </AppPage>;

  return (
    <div className="h-full overflow-y-auto">
      <PublicPageHeader next="/reinstatement" />
      <div className="mkt-editorial mkt-shadcn bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid="page-reinstatement">
      <section className="relative">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]" aria-hidden />
        <div className={`relative max-w-6xl mx-auto ${SECTION_X} pt-8 sm:pt-12 lg:pt-16 pb-12 lg:pb-20`}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <div className="lg:col-span-7">
              <Kicker n="" className="">
                <span className="inline-flex items-center gap-1.5" data-testid="badge-service-label"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> GBP REINSTATEMENT SERVICE</span>
              </Kicker>
              <h1 className="font-display mt-5 font-semibold text-[2.45rem] leading-[1.04] sm:text-[3.2rem] lg:text-[3.7rem] tracking-[-0.02em] [text-wrap:balance]" data-testid="text-reinstatement-title">
                Is your Google Business Profile <span className="mkt-marker">Suspended</span>?
              </h1>
              <p className="mt-6 text-base sm:text-lg text-mkt-ink-soft leading-relaxed max-w-[37rem]">
                We get it — it's devastating. Your phones go quiet, customers can't find you, and revenue drops overnight. We'll work your case and do everything we can to get your listing back on the map.
              </p>
              <div className="mt-9 grid grid-cols-3 max-w-lg border-y border-mkt-rule divide-x divide-[color:var(--mkt-rule)]" data-testid="reinstatement-facts">
                <div className="py-4 pr-4">
                  <p className="font-display font-semibold text-[2rem] leading-none text-mkt-orange-ink">4</p>
                  <p className="mt-2 text-[13px] text-mkt-ink-soft leading-snug">Step<br />process</p>
                </div>
                <div className="py-4 px-4">
                  <p className="font-display font-semibold text-[2rem] leading-none text-mkt-orange-ink">1–2</p>
                  <p className="mt-2 text-[13px] text-mkt-ink-soft leading-snug">Business days<br />to review your case</p>
                </div>
                <div className="py-4 pl-4">
                  <p className="font-display font-semibold text-[2rem] leading-none text-mkt-orange-ink">{formatUsd(GBP_REINSTATEMENT_CENTS)}</p>
                  <p className="mt-2 text-[13px] text-mkt-ink-soft leading-snug">Per<br />project</p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-2xl border-2 border-mkt-ink bg-mkt-card overflow-hidden" data-testid="card-reinstatement-pricing">
              <div className="mkt-hazard h-2" aria-hidden />
              <div className="p-7 lg:p-8">
                <h2 className="font-display font-semibold text-[1.4rem] leading-tight">Start your reinstatement</h2>
                <div className="flex items-baseline gap-1.5 mt-3 mb-5">
                  <span className="font-display font-semibold text-[3rem] leading-none">{formatUsd(GBP_REINSTATEMENT_CENTS)}</span>
                  <span className="text-mkt-muted text-[15px]">per project</span>
                </div>
                <ul className="space-y-3 mb-7 border-t border-mkt-rule pt-5">
                  {[
                    "Full profile & eligibility assessment",
                    "Guideline compliance review & fixes",
                    "Evidence & documentation guidance",
                    "Expert appeal submission & follow-up",
                    "Ongoing communication until resolved",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[14.5px]">
                      <CheckCircle2 className="h-[18px] w-[18px] text-mkt-orange-ink shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`${BTN_PRIMARY} ${BTN_LG} w-full`}
                  onClick={() => document.getElementById("reinstatement-form")?.scrollIntoView({ behavior: "smooth" })}
                  data-testid="button-get-reinstated"
                >
                  Request a case review
                </button>
                <p className="text-[13px] text-mkt-muted text-center mt-3">
                  We only take cases where we're confident we can help.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="mkt-ruler" aria-hidden />
      </section>

      <section className={`relative bg-mkt-navy text-mkt-navy-ink py-20 lg:py-24 ${SECTION_X} overflow-hidden`}>
        <div className="absolute inset-0 mkt-grid-paper-panel [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_75%)] opacity-70 dark:opacity-40" aria-hidden />
        <div className="relative max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-12 gap-8 items-end">
            <div className="lg:col-span-8">
              <Kicker n="01" className="!text-mkt-orange [&>span:nth-child(2)]:!text-mkt-navy-muted">The cost</Kicker>
              <h2 className="font-display font-semibold text-[2.1rem] sm:text-[2.6rem] lg:text-[3rem] leading-[1.05] tracking-[-0.02em] mt-5 [text-wrap:balance]" data-testid="text-consequences-title">A suspension can break your business</h2>
              <p className="mt-4 text-[17px] text-mkt-navy-muted">If your Google Business Profile disappears, the consequences are immediate and severe.</p>
            </div>
            <div className="hidden lg:flex lg:col-span-4 items-end justify-end gap-3" aria-hidden>
              <p className="mkt-bubble px-4 py-3 text-[17px] leading-snug -rotate-1 mb-10 max-w-[13rem]">Let's get you back on the map.</p>
              <StandingGator height={170} className="shrink-0" />
            </div>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-5">
            {CONSEQUENCES.map((c, i) => (
              <div key={i} className="rounded-2xl border border-mkt-navy-rule bg-[color:color-mix(in_srgb,var(--mkt-navy-ink)_5%,transparent)] p-6 lg:p-7" data-testid={`card-consequence-${i}`}>
                <c.icon className="h-7 w-7 text-mkt-orange mb-4" strokeWidth={1.75} />
                <h3 className="font-display font-semibold text-[1.25rem] leading-tight mb-2">{c.title}</h3>
                <p className="text-[14.5px] text-mkt-navy-muted leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`py-20 lg:py-28 ${SECTION_X}`}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            <div>
              <Kicker n="02">How It Works</Kicker>
              <h2 className={H2} data-testid="text-process-title">How we get you back on the map</h2>
              <p className={`mt-4 ${LEAD}`}>Our 4-step reinstatement process, from first review to appeal.</p>
              <ol className="mt-8 border-t border-mkt-rule">
                {PROCESS_STEPS.map(step => (
                  <li key={step.num} className="flex gap-5 py-5 border-b border-mkt-rule" data-testid={`process-step-${step.num}`}>
                    <span className="font-display italic text-[2.2rem] leading-none text-mkt-orange-ink w-12 shrink-0">{String(step.num).padStart(2, "0")}</span>
                    <div>
                      <h3 className="font-display font-semibold text-[1.2rem] leading-tight mb-1.5">{step.title}</h3>
                      <p className="text-[14.5px] text-mkt-ink-soft leading-relaxed">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-6">
              <Kicker n="03">The usual causes</Kicker>
              <h2 className="font-display font-semibold text-[1.8rem] sm:text-[2.1rem] leading-[1.1] tracking-[-0.015em] [text-wrap:balance]" data-testid="text-suspension-reasons-title">Why do Google Business Profiles get suspended?</h2>
              <p className="text-[15px] text-mkt-ink-soft leading-relaxed">
                Google can suspend a profile for a wide range of reasons. Even minor or accidental infringements can trigger a suspension — and Google rarely tells you exactly which rule you broke.
              </p>
              <div className="border-t border-mkt-rule">
                {SUSPENSION_REASONS.map((reason, i) => (
                  <div key={i} className="flex items-start gap-3 py-3.5 border-b border-dotted border-mkt-rule" data-testid={`suspension-reason-${i}`}>
                    <AlertTriangle className="h-4 w-4 text-mkt-orange-ink shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold text-[15px]">{reason.title}</p>
                      <p className="text-[13.5px] text-mkt-ink-soft leading-relaxed mt-0.5">{reason.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-mkt-rule bg-mkt-card p-6">
                <h3 className="font-display font-semibold text-[1.2rem] mb-4">Types of suspensions</h3>
                <div className="space-y-3">
                  <div className="p-4 rounded-lg border-l-4 border-mkt-orange bg-mkt-paper">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink">SOFT SUSPENSION</p>
                    <p className="text-[13.5px] text-mkt-ink-soft mt-1.5 leading-relaxed">Your listing becomes unverified but may still be partially visible. This is the most common type and usually the most straightforward to resolve.</p>
                  </div>
                  <div className="p-4 rounded-lg border-l-4 border-mkt-ink bg-mkt-paper">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-ink">HARD SUSPENSION</p>
                    <p className="text-[13.5px] text-mkt-ink-soft mt-1.5 leading-relaxed">Your listing is completely removed from Google Search and Maps. You'll see the "not visible to customers" message in your dashboard.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`py-20 lg:py-28 ${SECTION_X} bg-mkt-paper-2 border-y border-mkt-rule`}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center">
            <Kicker n="04" className="justify-center">Our Approach</Kicker>
            <h2 className={H2} data-testid="text-trust-title">Why trust ConstructHUB with your GBP</h2>
            <p className={`mt-4 ${LEAD} max-w-2xl mx-auto`}>A compliance-first approach built on Google's own Business Profile guidelines.</p>
          </div>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-mkt-rule border border-mkt-rule rounded-2xl overflow-hidden">
            {TRUST_POINTS.map((point, i) => (
              <div key={i} className="group bg-mkt-paper p-6 lg:p-7 text-left transition-colors hover:bg-mkt-card" data-testid={`card-trust-${i}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="h-10 w-10 rounded-lg border border-mkt-rule bg-mkt-card flex items-center justify-center group-hover:border-mkt-orange group-hover:text-mkt-orange-ink transition-colors">
                    <point.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <span className="font-display italic text-mkt-muted text-lg leading-none" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-display font-semibold text-[1.15rem] leading-tight mb-2">{point.title}</h3>
                <p className="text-[14px] text-mkt-ink-soft leading-relaxed">{point.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="reinstatement-form" className={`py-20 lg:py-28 ${SECTION_X} scroll-mt-16`}>
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <Kicker n="05">Request</Kicker>
              <h2 className={H2} data-testid="text-form-title">Let's get you back on the <span className="mkt-marker">map</span>!</h2>
              <p className={`mt-5 ${LEAD}`}>
                Complete the form with details about your listing and a member of our team will get right back to you. If you're eligible for a Google Business Profile and willing to do the work, we can likely help.
              </p>
              <div className="mt-8 border-t border-mkt-rule">
                {[
                  { icon: Clock, title: "Quick response", desc: "A team member will review your case and get back to you promptly." },
                  { icon: Search, title: "Honest assessment", desc: "We'll tell you upfront whether we think we can help." },
                  { icon: Shield, title: "No obligation", desc: "There's zero commitment at this stage. Just tell us what's going on." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 py-4 border-b border-dotted border-mkt-rule">
                    <CheckCircle2 className="h-5 w-5 text-mkt-orange-ink shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[15px]">{item.title}</p>
                      <p className="text-[14px] text-mkt-ink-soft">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-mkt-rule bg-mkt-card" data-testid="card-reinstatement-form">
              <div className="p-6 sm:p-7">
                <h3 className="font-display font-semibold text-[1.35rem] mb-5">Tell us about your suspension</h3>
{requestForm}
              </div>
            </div>
          </div>
        </div>
      </section>
      </div>
      <PublicPageFooter />
    </div>
  );
}

const SECTION_X = "px-4 sm:px-6 lg:px-8";
const FIELD_LABEL = "text-[13px] font-semibold text-mkt-ink";
const FIELD = "mt-1.5 h-11 rounded-lg bg-mkt-paper text-[15px] md:text-[15px]";
const REQUIRED = "font-normal text-mkt-muted";
