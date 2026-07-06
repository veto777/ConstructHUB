import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert, PhoneOff, MapPinOff, StarOff, CheckCircle2,
  AlertTriangle, ArrowRight, Loader2, Shield, Search, Wrench,
  FileCheck, MessageCircle, Clock, Users, Award, Building2,
} from "lucide-react";

const SUSPENSION_REASONS = [
  { icon: AlertTriangle, title: "Business name keyword stuffing", desc: "Adding extra keywords or location names to your business name that don't reflect your real-world name." },
  { icon: AlertTriangle, title: "Address or eligibility issues", desc: "Using virtual offices, PO Boxes, or co-working space addresses that violate Google's location policies." },
  { icon: AlertTriangle, title: "Multiple listings for one location", desc: "Creating duplicate profiles for the same business at the same address." },
  { icon: AlertTriangle, title: "Suspicious review patterns", desc: "A surge of reviews that Google flags as potentially incentivized or fake." },
  { icon: AlertTriangle, title: "Service area or category issues", desc: "Misrepresenting your service area, categories, or the nature of your business." },
];

const PROCESS_STEPS = [
  { num: 1, title: "Tell us about your situation", desc: "Fill out our request form to get things started. We'll review your case, follow up with any questions, and let you know if we think we can help." },
  { num: 2, title: "Full assessment", desc: "If we're confident we can get you reinstated, we'll request all the details and perform an in-depth evaluation to get to the bottom of your suspension." },
  { num: 3, title: "Fix & comply", desc: "We'll advise you on all actions required, including any supporting documentation, and ensure your Profile is fully compliant and eligible for reinstatement." },
  { num: 4, title: "Appeal & reinstate", desc: "We'll craft and submit a compelling, evidence-based appeal and manage all communication until your Profile is restored." },
];

const CONSEQUENCES = [
  { icon: PhoneOff, title: "Your phone stops ringing", desc: "No listing means no calls from Google. For businesses that depend on local search leads, this means revenue dries up almost instantly." },
  { icon: MapPinOff, title: "Customers can't find you", desc: "You vanish from Google Maps and local search results. Potential customers searching for your services will find your competitors instead." },
  { icon: StarOff, title: "Your reviews disappear", desc: "Years of hard-earned reviews and star ratings go invisible. The social proof you've built — gone from sight when you need it most." },
];

const TRUST_POINTS = [
  { icon: Award, title: "GBP Product Experts on staff", desc: "Our team includes recognized Google Business Profile specialists with deep knowledge of Google's internal workflows." },
  { icon: Clock, title: "Years of local search expertise", desc: "We've been working in local search and have optimized thousands of profiles and seen every kind of suspension." },
  { icon: Shield, title: "Robust, foundational approach", desc: "We don't just appeal — we fix the root cause. Our approach ensures your profile is built on a compliant foundation so it stays reinstated." },
  { icon: Users, title: "Hundreds of businesses supported", desc: "From single-location shops to enterprise clients, we've helped hundreds of businesses get back on the map with our reinstatement service." },
];

export default function ReinstatementPage() {
  const { toast } = useToast();
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
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canSubmit = formData.name && formData.email && formData.businessName && formData.businessAddress && formData.businessType && formData.problemDescription;

  return (
    <div className="h-full overflow-y-auto">
      <div className="bg-gradient-to-b from-[#1a1f3d] to-[#2d1f4e] text-white py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge className="bg-white/10 text-white/80 border-white/20 mb-4" data-testid="badge-service-label">
                <ShieldAlert className="h-3 w-3 mr-1" /> GBP REINSTATEMENT SERVICE
              </Badge>
              <h1 className="text-4xl font-bold mb-4" data-testid="text-reinstatement-title">
                Is your Google Business Profile <span className="text-red-400">Suspended</span>?
              </h1>
              <p className="text-white/70 text-lg mb-6">
                We get it — it's devastating. Your phones go quiet, customers can't find you, and revenue drops overnight. We'll work tirelessly to get your listing back on the map.
              </p>
              <div className="flex gap-8 mt-8">
                <div>
                  <p className="text-3xl font-bold text-[#4A6CF7]">15+</p>
                  <p className="text-sm text-white/60">Years in<br />local search</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-[#4A6CF7]">100K+</p>
                  <p className="text-sm text-white/60">Businesses<br />supported</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-[#4A6CF7]">2</p>
                  <p className="text-sm text-white/60">GBP Product<br />Experts on staff</p>
                </div>
              </div>
            </div>

            <Card className="bg-white text-foreground" data-testid="card-reinstatement-pricing">
              <CardContent className="p-8">
                <h2 className="text-xl font-bold mb-1">Start your reinstatement</h2>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-4xl font-bold text-[#4A6CF7]">$599</span>
                  <span className="text-muted-foreground text-sm">per project</span>
                </div>
                <ul className="space-y-3 mb-6">
                  {[
                    "Full profile & eligibility assessment",
                    "Guideline compliance review & fixes",
                    "Evidence & documentation guidance",
                    "Expert appeal submission & follow-up",
                    "Ongoing communication until resolved",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full bg-[#F97316] hover:bg-[#E86C0A] text-white text-base h-12"
                  onClick={() => document.getElementById("reinstatement-form")?.scrollIntoView({ behavior: "smooth" })}
                  data-testid="button-get-reinstated"
                >
                  Get your listing reinstated
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-3">
                  We only take cases where we're confident we can help.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <div className="bg-[#1a1f3d] text-white py-16 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3" data-testid="text-consequences-title">A suspension can break your business</h2>
          <p className="text-white/60 mb-10">If your Google Business Profile disappears, the consequences are immediate and severe.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {CONSEQUENCES.map((c, i) => (
              <Card key={i} className="bg-white/5 border-white/10 text-white" data-testid={`card-consequence-${i}`}>
                <CardContent className="p-6">
                  <c.icon className="h-8 w-8 text-red-400 mb-4" />
                  <h3 className="font-bold mb-2">{c.title}</h3>
                  <p className="text-sm text-white/60">{c.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-background py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-3xl font-bold mb-3" data-testid="text-process-title">How we get you back on the map</h2>
              <p className="text-muted-foreground mb-8">Our proven 4-step reinstatement process is handled by experienced GBP Product Experts.</p>
              <div className="space-y-6">
                {PROCESS_STEPS.map(step => (
                  <div key={step.num} className="flex gap-4" data-testid={`process-step-${step.num}`}>
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#4A6CF7] text-white text-sm font-bold shrink-0">
                      {step.num}
                    </div>
                    <div>
                      <h3 className="font-bold mb-1">{step.title}</h3>
                      <p className="text-sm text-muted-foreground">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-2xl font-bold" data-testid="text-suspension-reasons-title">Why do Google Business Profiles get suspended?</h2>
              <p className="text-sm text-muted-foreground">
                Google can suspend a profile for a wide range of reasons. Even minor or accidental infringements can trigger a suspension — and Google rarely tells you exactly which rule you broke.
              </p>
              <div className="space-y-3">
                {SUSPENSION_REASONS.map((reason, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/40" data-testid={`suspension-reason-${i}`}>
                    <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">{reason.title}</p>
                      <p className="text-xs text-muted-foreground">{reason.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Card className="border-orange-500/20">
                <CardContent className="p-5">
                  <h3 className="font-bold mb-3">Types of suspensions</h3>
                  <div className="space-y-3">
                    <div className="p-3 rounded-lg border-l-4 border-orange-400 bg-orange-500/5">
                      <p className="font-semibold text-sm text-orange-600 dark:text-orange-400">SOFT SUSPENSION</p>
                      <p className="text-xs text-muted-foreground mt-1">Your listing becomes unverified but may still be partially visible. This is the most common type and usually the most straightforward to resolve.</p>
                    </div>
                    <div className="p-3 rounded-lg border-l-4 border-red-500 bg-red-500/5">
                      <p className="font-semibold text-sm text-red-600 dark:text-red-400">HARD SUSPENSION</p>
                      <p className="text-xs text-muted-foreground mt-1">Your listing is completely removed from Google Search and Maps. You'll see the "not visible to customers" message in your dashboard.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-muted/30 py-16 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-3" data-testid="text-trust-title">Why trust ConstructHUB with your GBP</h2>
          <p className="text-muted-foreground mb-10">We've been helping businesses succeed in local search since before the local 3-pack even existed.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {TRUST_POINTS.map((point, i) => (
              <Card key={i} className="text-left" data-testid={`card-trust-${i}`}>
                <CardContent className="p-5">
                  <point.icon className="h-8 w-8 text-[#4A6CF7] mb-3" />
                  <h3 className="font-bold text-sm mb-2">{point.title}</h3>
                  <p className="text-xs text-muted-foreground">{point.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div id="reinstatement-form" className="bg-background py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-3xl font-bold mb-3" data-testid="text-form-title">Let's get you back on the map!</h2>
              <p className="text-muted-foreground mb-6">
                Complete the form with details about your listing and a member of our team will get right back to you. If you're eligible for a Google Business Profile and willing to do the work, we can likely help.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Clock, title: "Quick response", desc: "A team member will review your case and get back to you promptly." },
                  { icon: Search, title: "Honest assessment", desc: "We'll tell you upfront whether we think we can help." },
                  { icon: Shield, title: "No obligation", desc: "There's zero commitment at this stage. Just tell us what's going on." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-sm">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Card data-testid="card-reinstatement-form">
              <CardContent className="p-6">
                <h3 className="text-lg font-bold mb-4">Tell us about your suspension</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Your name <span className="text-red-500">(required)</span></Label>
                      <Input value={formData.name} onChange={e => updateField("name", e.target.value)} className="mt-1" data-testid="input-reinstate-name" />
                    </div>
                    <div>
                      <Label className="text-xs">Your email <span className="text-red-500">(required)</span></Label>
                      <Input type="email" value={formData.email} onChange={e => updateField("email", e.target.value)} className="mt-1" data-testid="input-reinstate-email" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Business name <span className="text-red-500">(required)</span></Label>
                      <Input value={formData.businessName} onChange={e => updateField("businessName", e.target.value)} className="mt-1" data-testid="input-reinstate-business" />
                    </div>
                    <div>
                      <Label className="text-xs">Website URL</Label>
                      <Input value={formData.websiteUrl} onChange={e => updateField("websiteUrl", e.target.value)} className="mt-1" data-testid="input-reinstate-website" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Business address <span className="text-red-500">(required)</span></Label>
                    <p className="text-[10px] text-muted-foreground">Please include this, even if the address is hidden.</p>
                    <Input value={formData.businessAddress} onChange={e => updateField("businessAddress", e.target.value)} className="mt-1" data-testid="input-reinstate-address" />
                  </div>
                  <div>
                    <Label className="text-xs">Which best describes your business? <span className="text-red-500">(required)</span></Label>
                    <Select value={formData.businessType} onValueChange={v => updateField("businessType", v)}>
                      <SelectTrigger className="mt-1" data-testid="select-business-type">
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
                    <Label className="text-xs">Does this business have multiple locations? <span className="text-red-500">(required)</span></Label>
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
                    <Label className="text-xs">Describe the problem you're having <span className="text-red-500">(required)</span></Label>
                    <Textarea
                      value={formData.problemDescription}
                      onChange={e => updateField("problemDescription", e.target.value)}
                      placeholder="Tell us about the suspension — when it happened, any details from Google, anything you've already tried, and anything else we should know."
                      rows={4}
                      className="mt-1"
                      data-testid="textarea-problem-description"
                    />
                  </div>
                  <Button
                    className="w-full bg-[#F97316] hover:bg-[#E86C0A] text-white h-11"
                    onClick={() => submitMutation.mutate()}
                    disabled={!canSubmit || submitMutation.isPending}
                    data-testid="button-submit-reinstatement"
                  >
                    {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Submit
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
