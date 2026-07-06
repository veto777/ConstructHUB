import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Check, Crown, Zap, Shield, Star, Loader2, ExternalLink,
  Search, Camera, BarChart3, Building2, Clock, Users,
  Wrench, Globe, Megaphone, UserPlus, ArrowRight, Briefcase,
  ShoppingCart, CheckCircle2, TrendingUp, X,
} from "lucide-react";
import { useCart } from "@/contexts/cart-context";

const PLAN_ICONS: Record<string, any> = {
  standard: Zap,
  professional: Star,
  business: Briefcase,
  premium: Crown,
  gold: Crown,
  platinum: Shield,
};

const PLAN_COLORS: Record<string, string> = {
  standard: "ring-2 ring-blue-500/40 border-blue-500/30 hover:border-blue-500/60",
  professional: "ring-2 ring-[#F97316]/40 border-[#F97316]/30 hover:border-[#F97316]/60",
  business: "ring-2 ring-teal-500/40 border-teal-500/30 hover:border-teal-500/60",
  premium: "ring-2 ring-purple-500/40 border-purple-500/30 hover:border-purple-500/60",
  gold: "ring-2 ring-amber-500/40 border-amber-500/30 hover:border-amber-500/60",
  platinum: "ring-2 ring-yellow-500/40 border-yellow-500/30 hover:border-yellow-500/60",
};

const PLAN_BADGE_COLORS: Record<string, string> = {
  standard: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  professional: "bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20",
  business: "bg-teal-500/10 text-teal-500 border-teal-500/20",
  premium: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  gold: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  platinum: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

const PLAN_BUTTON_COLORS: Record<string, string> = {
  standard: "bg-blue-500 hover:bg-blue-600 text-white",
  professional: "bg-[#F97316] hover:bg-[#ea6c10] text-white",
  business: "bg-teal-500 hover:bg-teal-600 text-white",
  premium: "bg-purple-500 hover:bg-purple-600 text-white",
  gold: "bg-amber-500 hover:bg-amber-600 text-black",
  platinum: "bg-yellow-500 hover:bg-yellow-600 text-black",
};

const PLAN_CHECK_COLORS: Record<string, string> = {
  standard: "text-green-500",
  professional: "text-green-500",
  business: "text-teal-500",
  premium: "text-green-500",
  gold: "text-amber-500",
  platinum: "text-yellow-500",
};

export default function PricingPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const success = params.get("success");
  const canceled = params.get("canceled");

  const { data: plans } = useQuery<Record<string, { name: string; price: number; features: string[] }>>({
    queryKey: ["/api/stripe/plans"],
  });

  const { data: subscription } = useQuery<{
    plan: string;
    status: string;
    currentPeriodEnd?: string;
    stripeSubscriptionId?: string;
  }>({
    queryKey: ["/api/stripe/subscription"],
  });

  const { data: user } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (plan: string) => {
      const res = await apiRequest("POST", "/api/stripe/create-checkout", { plan });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/create-portal", {});
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (success) {
    toast({ title: "Subscription activated!", description: "Welcome to ConstructHUB. Your plan is now active." });
    window.history.replaceState({}, "", "/pricing");
  }
  if (canceled) {
    toast({ title: "Checkout canceled", description: "No charges were made." });
    window.history.replaceState({}, "", "/pricing");
  }

  const { addItem, isInCart } = useCart();
  const currentPlan = subscription?.plan || "free";
  const isActive = subscription?.status === "active";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight" data-testid="text-pricing-title">
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Scale your contractor business with the right tools. All plans include a 1-day free trial.
          </p>
        </div>

        {isActive && (
          <div className="flex items-center justify-center gap-3">
            <Badge variant="outline" className="text-sm px-3 py-1 border-green-500/30 text-green-500" data-testid="badge-current-plan">
              <Check className="w-3.5 h-3.5 mr-1" />
              Active: {plans?.[currentPlan]?.name || currentPlan} Plan
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="button-manage-subscription"
            >
              {portalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
              Manage Subscription
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {plans && Object.entries(plans).map(([key, plan]) => {
            const Icon = PLAN_ICONS[key] || Zap;
            const isCurrentPlan = currentPlan === key && isActive;
            const isPopular = key === "professional";
            const isBusiness = key === "business";
            const isGold = key === "gold";
            const isPlatinum = key === "platinum";

            return (
              <Card
                key={key}
                className={`relative flex flex-col transition-all duration-200 ${PLAN_COLORS[key]}`}
                data-testid={`card-plan-${key}`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-[#F97316] text-white border-none px-3 text-xs">Most Popular</Badge>
                  </div>
                )}
                {isBusiness && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-teal-500 text-white border-none px-3 text-xs font-bold">Best Value</Badge>
                  </div>
                )}
                {isGold && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-amber-500 text-black border-none px-3 text-xs font-bold">Gold Membership</Badge>
                  </div>
                )}
                {isPlatinum && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-yellow-500 text-black border-none px-3 text-xs font-bold">Agencies & Teams</Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className="flex justify-center mb-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${PLAN_BADGE_COLORS[key]}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-4xl font-extrabold">${(plan.price / 100).toFixed(0)}</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col flex-1 space-y-4">
                  <ul className="space-y-2.5 flex-1">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className={`w-4 h-4 shrink-0 mt-0.5 ${PLAN_CHECK_COLORS[key] || "text-green-500"}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className={`w-full mt-auto font-bold border-0 ${PLAN_BUTTON_COLORS[key] || "bg-blue-500 hover:bg-blue-600 text-white"}`}
                    onClick={() => {
                      if (!user && !import.meta.env.DEV) {
                        setLocation("/auth");
                        return;
                      }
                      if (isCurrentPlan) {
                        portalMutation.mutate();
                      } else {
                        checkoutMutation.mutate(key);
                      }
                    }}
                    disabled={checkoutMutation.isPending || portalMutation.isPending}
                    data-testid={`button-subscribe-${key}`}
                  >
                    {(checkoutMutation.isPending || portalMutation.isPending) && (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    )}
                    {isCurrentPlan ? "Manage Plan" : "Get Started"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center space-y-4 pt-4">
          <h2 className="text-xl font-bold" data-testid="text-features-heading">Everything You Need to Grow</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {[
              { icon: Search, label: "Permit Search", desc: "All 50 states" },
              { icon: Camera, label: "Photo Optimizer", desc: "GMB ready photos" },
              { icon: BarChart3, label: "Ranking Grid", desc: "Track local rankings" },
              { icon: Shield, label: "Edit Monitor", desc: "GMB change alerts" },
              { icon: Building2, label: "Property Records", desc: "Nationwide data" },
              { icon: Users, label: "Expert Consulting", desc: "Platinum only — $250 first session" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 text-left">
                <item.icon className="w-5 h-5 text-[#F97316] shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-center mt-4">
            <Button
              variant="outline"
              className="border-[#F97316]/40 text-[#F97316] hover:bg-[#F97316]/10"
              onClick={() => setLocation("/individual-pricing")}
              data-testid="button-individual-pricing-link"
            >
              <Zap className="w-4 h-4 mr-2" />
              Or Buy Individual Tools À La Carte
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>

        <div id="comparison" className="border-t border-border/50 pt-12 mt-8 space-y-6">
          <div className="text-center space-y-3">
            <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 px-3 py-1">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
              Side-by-Side
            </Badge>
            <h2 className="text-3xl font-extrabold tracking-tight" data-testid="text-comparison-heading">
              Plan Comparison
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every plan is designed to help contractors grow — from solo operators just getting started to agencies managing multiple clients. 
              See exactly what's included at each level.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border" data-testid="table-plan-comparison">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-4 font-bold min-w-[200px]">Feature</th>
                  <th className="text-center p-3 font-bold text-blue-500 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Zap className="w-4 h-4" />
                      <span>Standard</span>
                      <span className="text-xs font-normal text-muted-foreground">$15/mo</span>
                    </div>
                  </th>
                  <th className="text-center p-3 font-bold text-[#F97316] min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Star className="w-4 h-4" />
                      <span>Professional</span>
                      <span className="text-xs font-normal text-muted-foreground">$30/mo</span>
                    </div>
                  </th>
                  <th className="text-center p-3 font-bold text-teal-500 min-w-[100px] bg-teal-500/5">
                    <div className="flex flex-col items-center gap-1">
                      <Briefcase className="w-4 h-4" />
                      <span>Business</span>
                      <span className="text-xs font-normal text-muted-foreground">$50/mo</span>
                      <Badge className="bg-teal-500 text-white border-none text-[10px] px-1.5 py-0">Best Value</Badge>
                    </div>
                  </th>
                  <th className="text-center p-3 font-bold text-purple-500 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Crown className="w-4 h-4" />
                      <span>Premium</span>
                      <span className="text-xs font-normal text-muted-foreground">$100/mo</span>
                    </div>
                  </th>
                  <th className="text-center p-3 font-bold text-amber-500 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Crown className="w-4 h-4" />
                      <span>Gold</span>
                      <span className="text-xs font-normal text-muted-foreground">$499/mo</span>
                    </div>
                  </th>
                  <th className="text-center p-3 font-bold text-yellow-500 min-w-[100px]">
                    <div className="flex flex-col items-center gap-1">
                      <Shield className="w-4 h-4" />
                      <span>Platinum</span>
                      <span className="text-xs font-normal text-muted-foreground">$995/mo</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { category: "Permits & Databases", features: [
                    { name: "Permit Searches", values: ["50/mo", "200/mo", "350/mo", "500/mo", "Unlimited", "Unlimited"] },
                    { name: "Property Records Access", values: [false, true, true, true, true, true] },
                    { name: "Scrape Scheduling", values: [false, false, true, true, true, true] },
                    { name: "All 50 States + DC Coverage", values: [true, true, true, true, true, true] },
                    { name: "32,864+ Permit Databases", values: [true, true, true, true, true, true] },
                  ]},
                  { category: "Google Business Tools", features: [
                    { name: "GMB Photo Optimizations", values: ["5/mo", "25/mo", "50/mo", "Unlimited", "Unlimited", "Unlimited"] },
                    { name: "GMB Ranking Grid Reports", values: ["3/mo", "10/mo", "15/mo", "25/mo", "Unlimited", "Unlimited"] },
                    { name: "Basic GMB Edit Monitoring", values: [true, false, false, false, false, false] },
                    { name: "Advanced GMB Edit Monitoring", values: [false, true, true, true, true, true] },
                    { name: "AI Review Response Generator", values: [false, false, true, true, true, true] },
                    { name: "GBP Reinstatement Service", values: [false, false, false, false, true, true] },
                  ]},
                  { category: "Protection & Analytics", features: [
                    { name: "Google Click Guard", values: [false, false, "1 site", "3 sites", "Included", "Included"] },
                    { name: "IP Tracker", values: [false, false, false, "1 site", "1 site", "10 sites"] },
                    { name: "VPN Shield", values: [false, false, false, false, "1 site", "10 sites"] },
                    { name: "Traffic Source Analytics", values: [false, false, false, true, true, true] },
                    { name: "Fraud Detection Dashboard", values: [false, false, true, true, true, true] },
                  ]},
                  { category: "Intelligence & Education", features: [
                    { name: "Competitor Intelligence", values: [false, false, false, false, "1 site", "10 sites"] },
                    { name: "BS Meter (Fake Review Detection)", values: [false, false, false, false, true, true] },
                    { name: "Master Class Access", values: [false, false, true, true, true, true] },
                    { name: "Google Ads Master Class", values: [false, false, true, true, true, true] },
                    { name: "LSA Setup Guide", values: [false, false, false, true, true, true] },
                  ]},
                  { category: "Support & Team", features: [
                    { name: "Users Included", values: ["1", "1", "1", "1", "2", "5"] },
                    { name: "Email Support", values: [true, true, false, false, false, false] },
                    { name: "Priority Support", values: [false, false, true, true, true, false] },
                    { name: "Dedicated Support", values: [false, false, false, false, false, true] },
                    { name: "Expert Consulting Sessions", values: [false, false, false, false, false, true] },
                  ]},
                ].flatMap((section) => [
                  <tr key={`cat-${section.category}`} className="bg-muted/30">
                    <td colSpan={7} className="p-3 font-bold text-sm text-foreground">
                      {section.category}
                    </td>
                  </tr>,
                  ...section.features.map((feature, fi) => (
                    <tr key={`${section.category}-${fi}`} className="border-b border-border/50 hover:bg-muted/20 transition-colors" data-testid={`row-comparison-${section.category.toLowerCase().replace(/\s+/g, '-')}-${fi}`}>
                      <td className="p-3 text-sm font-medium">{feature.name}</td>
                      {feature.values.map((val, vi) => (
                        <td key={vi} className={`p-3 text-center ${vi === 2 ? "bg-teal-500/5" : ""}`}>
                          {val === true ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                          ) : val === false ? (
                            <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                          ) : (
                            <span className="text-sm font-semibold text-foreground">{val}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {[
              { icon: Search, title: "Find Leads Before Anyone Else", desc: "Access 32,864+ permit databases across all 50 states. Know who's building, renovating, and pulling permits in your area before your competitors do." },
              { icon: Shield, title: "Stop Wasting Money on Fake Clicks", desc: "Google Click Guard blocks competitors and bots from draining your ad budget. Most contractors lose 25%+ of their ad spend to fraud without knowing it." },
              { icon: Globe, title: "Dominate Your Local Market", desc: "From GMB optimization to competitor analysis, get the same tools that 7-figure contractors use to own their local search results and generate leads 24/7." },
            ].map((item, i) => (
              <Card key={i} className="border-border/50 p-5" data-testid={`card-benefit-${i}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#F97316]/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-[#F97316]" />
                  </div>
                  <h3 className="font-bold text-sm">{item.title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>

        <div id="done-for-you" className="border-t border-border/50 pt-12 mt-8 space-y-8">
          <div className="text-center space-y-3">
            <Badge className="bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20 px-3 py-1">
              <Briefcase className="w-3.5 h-3.5 mr-1.5" />
              Turnkey Business Building
            </Badge>
            <h2 className="text-3xl font-extrabold tracking-tight" data-testid="text-dfy-heading">
              Done-For-You Services
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Don't want to do it yourself? We'll build your entire construction business for you. Our team handles all the paperwork, 
              setup, and marketing — the only thing we can't do is take your licensing exams for you.
            </p>
            <p className="text-xs text-muted-foreground max-w-lg mx-auto">
              All services paid upfront. Typical timeline: 4-6 months from start to finish (excluding licensing exam timelines).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {[
              {
                icon: Wrench,
                cartId: "dfy_formation",
                title: "Business Formation & Filing",
                price: "$5,500",
                priceCents: 550000,
                color: "border-blue-500/30 hover:border-blue-500/60",
                iconBg: "bg-blue-500/10 text-blue-500",
                features: [
                  "LLC or Corp formation with Secretary of State",
                  "Contractor license application processing",
                  "Surety bond procurement",
                  "Insurance setup (GL, auto, workers comp)",
                  "EIN, state tax ID, and business bank guidance",
                  "All filing and paperwork handled for you",
                ],
              },
              {
                icon: Globe,
                cartId: "dfy_gmb_website",
                title: "GMB & Website Setup",
                price: "$15,000",
                priceCents: 1500000,
                color: "border-purple-500/30 hover:border-purple-500/60",
                iconBg: "bg-purple-500/10 text-purple-500",
                features: [
                  "Full Google Business Profile creation & verification",
                  "Professional contractor website (design + content)",
                  "Service pages for every trade you offer",
                  "Location pages for your service areas",
                  "Photo optimization & GMB posting calendar",
                  "Mobile-responsive, fast-loading, conversion-focused",
                ],
              },
              {
                icon: Megaphone,
                cartId: "dfy_seo_ads",
                title: "SEO & Ad Campaigns",
                price: "$7,500",
                priceCents: 750000,
                color: "border-emerald-500/30 hover:border-emerald-500/60",
                iconBg: "bg-emerald-500/10 text-emerald-500",
                features: [
                  "Local SEO strategy & implementation",
                  "Google Ads campaign setup & optimization",
                  "Local Services Ads (LSA) enrollment",
                  "Citation building across 80+ directories",
                  "Schema markup & technical SEO",
                  "Google Search Console & Analytics setup",
                ],
              },
              {
                icon: UserPlus,
                cartId: "dfy_recruiting",
                title: "Recruiting Support",
                price: "$9,500",
                priceCents: 950000,
                color: "border-orange-500/30 hover:border-orange-500/60",
                iconBg: "bg-orange-500/10 text-orange-500",
                features: [
                  "Help recruit commission-only sales reps",
                  "Project Manager sourcing ($45-75k range)",
                  "Administrative / secretary hiring support",
                  "Job posting creation & candidate screening",
                  "Interview process setup & guidance",
                  "Compensation structure recommendations",
                ],
              },
            ].map((service, i) => {
              const inCart = isInCart(service.cartId);
              return (
                <Card
                  key={i}
                  className={`relative transition-all duration-200 hover:shadow-lg ${service.color}`}
                  data-testid={`card-dfy-${i}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${service.iconBg}`}>
                          <service.icon className="w-5 h-5" />
                        </div>
                        <CardTitle className="text-lg">{service.title}</CardTitle>
                      </div>
                      <span className="text-2xl font-extrabold text-[#4A6CF7]">{service.price}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {service.features.map((feature, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 shrink-0 mt-0.5 text-green-500" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full ${inCart ? "bg-green-600 hover:bg-green-600 text-white" : ""}`}
                      variant={inCart ? "default" : "outline"}
                      disabled={inCart}
                      onClick={() => {
                        addItem({
                          id: service.cartId,
                          type: "dfy_service",
                          name: service.title,
                          price: service.priceCents,
                          description: `Done-For-You ${service.title}`,
                        });
                        toast({ title: "Added to cart", description: `${service.title} has been added to your cart.` });
                      }}
                      data-testid={`button-add-cart-dfy-${service.cartId}`}
                    >
                      {inCart ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          In Cart
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-4 h-4 mr-2" />
                          Add to Cart
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="max-w-4xl mx-auto mt-6 space-y-4">
            <div className="text-center mb-2">
              <Badge className="bg-emerald-500 text-white border-none px-4 text-xs font-bold shadow-lg">
                GUARANTEED FIRST PAGE SEO
              </Badge>
              <h3 className="text-xl font-extrabold mt-3" data-testid="text-first-page-title">Get Your Business on Google's First Page</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mt-1">
                We get your contractor website ranking on Google's first page for your target keywords. 
                6-month minimum on all SEO packages. Bank account payments accepted for purchases over $5,000.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
              <Card className="relative border-teal-500/30 hover:border-teal-500/60 transition-all duration-200 flex flex-col" data-testid="card-seo-first-page">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-t-lg" />
                <CardContent className="p-6 pt-6 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-teal-500" />
                    </div>
                    <div>
                      <h4 className="font-bold">First Page SEO</h4>
                      <p className="text-xs text-muted-foreground">1-2 keywords · Page 1</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <span className="text-3xl font-extrabold text-teal-500">$3,000</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2 mb-4 flex-1">
                    {[
                      "1-2 keywords on Google's first page",
                      "Results in 4-6 months",
                      "Dedicated SEO strategist",
                      "Full technical SEO audit & fixes",
                      "Keyword research & content strategy",
                      "Local SEO & Google Business optimization",
                      "Backlink building & authority development",
                      "Monthly ranking reports",
                    ].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-teal-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-2.5 mb-4 mt-auto">
                    <p className="text-[11px] text-muted-foreground text-center">
                      6-month minimum · $3,000/mo ($18,000 total)
                    </p>
                  </div>
                  {isInCart("dfy_seo_first_page") ? (
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-600 text-white text-xs" disabled data-testid="button-seo-first-page-in-cart">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> In Cart
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full bg-teal-500 hover:bg-teal-600 text-white shadow-lg shadow-teal-500/25 text-xs"
                      onClick={() => {
                        addItem({
                          id: "dfy_seo_first_page",
                          type: "dfy_service",
                          name: "First Page SEO — 1-2 Keywords (6-Month)",
                          price: 1800000,
                          description: "Get 1-2 keywords on Google's first page in 4-6 months. $3,000/mo × 6 months.",
                        });
                        toast({ title: "Added to cart", description: "First Page SEO (6-month package) added to your cart." });
                      }}
                      data-testid="button-seo-first-page-add-cart"
                    >
                      <ShoppingCart className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                      <span className="truncate">Add to Cart — $18,000</span>
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card className="relative border-emerald-500/30 hover:border-emerald-500/60 transition-all duration-200 flex flex-col" data-testid="card-seo-starter">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-t-lg" />
                <CardContent className="p-6 pt-6 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <h4 className="font-bold">SEO Growth</h4>
                      <p className="text-xs text-muted-foreground">1-2 keywords · Guaranteed Top 3</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <span className="text-3xl font-extrabold text-emerald-500">$6,000</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2 mb-4 flex-1">
                    {[
                      "Guaranteed top 3 for 1-2 keywords",
                      "Results in 6-9 months",
                      "Dedicated SEO strategist",
                      "Full technical SEO audit & fixes",
                      "Keyword research & content strategy",
                      "Local SEO & Google Business optimization",
                      "Backlink building & authority development",
                      "Monthly ranking reports & traffic analysis",
                    ].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 mb-4 mt-auto">
                    <p className="text-[11px] text-muted-foreground text-center">
                      6-month minimum · $6,000/mo ($36,000 total) · Bank account payment available
                    </p>
                  </div>
                  {isInCart("dfy_seo_growth") ? (
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-600 text-white text-xs" disabled data-testid="button-seo-growth-in-cart">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> In Cart
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 text-xs"
                      onClick={() => {
                        addItem({
                          id: "dfy_seo_growth",
                          type: "dfy_service",
                          name: "SEO Growth — Top 3 for 1-2 Keywords (6-Month)",
                          price: 3600000,
                          description: "Guaranteed top 3 positions for 1-2 keywords in 6-9 months. $6,000/mo × 6 months.",
                        });
                        toast({ title: "Added to cart", description: "SEO Growth (6-month package) added to your cart." });
                      }}
                      data-testid="button-seo-growth-add-cart"
                    >
                      <ShoppingCart className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                      <span className="truncate">Add to Cart — $36,000</span>
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card className="relative border-amber-500/30 hover:border-amber-500/60 transition-all duration-200 ring-2 ring-amber-500/30 flex flex-col" data-testid="card-seo-domination">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 rounded-t-lg" />
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <Badge className="bg-amber-500 text-black border-none px-3 text-xs font-bold">BEST VALUE</Badge>
                </div>
                <CardContent className="p-6 pt-8 flex flex-col flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                      <h4 className="font-bold">SEO Domination</h4>
                      <p className="text-xs text-muted-foreground">3-5 keywords · Top 3 in 6-9 months</p>
                    </div>
                  </div>
                  <div className="mb-3">
                    <span className="text-3xl font-extrabold text-amber-500">$10,000</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <ul className="space-y-2 mb-4 flex-1">
                    {[
                      "Guaranteed top 3 for 3-5 keywords",
                      "Results in 6-9 months",
                      "Senior dedicated SEO strategist",
                      "Full technical SEO audit & fixes",
                      "Advanced keyword research & content strategy",
                      "Local SEO & Google Business optimization",
                      "Aggressive backlink building",
                      "Competitor keyword gap analysis",
                      "Schema markup & structured data",
                      "Content creation & blog publishing",
                    ].map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 mb-4 mt-auto">
                    <p className="text-[11px] text-muted-foreground text-center">
                      6-month minimum · $10,000/mo ($60,000 total) · Bank account payment available
                    </p>
                  </div>
                  {isInCart("dfy_seo_domination") ? (
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-600 text-white text-xs" disabled data-testid="button-seo-domination-in-cart">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> In Cart
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/25 text-xs"
                      onClick={() => {
                        addItem({
                          id: "dfy_seo_domination",
                          type: "dfy_service",
                          name: "SEO Domination — Top 3 for 3-5 Keywords (6-Month)",
                          price: 6000000,
                          description: "Guaranteed top 3 positions for 3-5 keywords in 6-9 months. $10,000/mo × 6 months.",
                        });
                        toast({ title: "Added to cart", description: "SEO Domination (6-month package) added to your cart." });
                      }}
                      data-testid="button-seo-domination-add-cart"
                    >
                      <ShoppingCart className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                      <span className="truncate">Add to Cart — $60,000</span>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <Card className="relative max-w-4xl mx-auto border-[#F97316]/30 hover:border-[#F97316]/60 transition-all duration-200" data-testid="card-dfy-bundle">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#4A6CF7] via-[#F97316] to-[#4A6CF7] rounded-t-lg" />
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
              <Badge className="bg-[#F97316] text-white border-none px-4 text-xs font-bold shadow-lg">
                SAVE ~30%
              </Badge>
            </div>
            <CardContent className="p-6 sm:p-8 text-center pt-8">
              <div className="flex items-center justify-center gap-3 mb-3">
                <Briefcase className="w-8 h-8 text-[#F97316]" />
                <h3 className="text-2xl font-extrabold" data-testid="text-dfy-bundle-title">Complete Business Build</h3>
              </div>
              <p className="text-muted-foreground max-w-xl mx-auto mb-4">
                Everything above in one package. We handle your entire business setup from formation to marketing — 
                all paperwork, online presence, SEO, advertising, and recruiting. You focus on getting licensed and learning your trade.
              </p>
              <div className="flex items-center justify-center gap-4 mb-3">
                <span className="text-xl font-bold text-muted-foreground line-through">$38,000+</span>
                <span className="text-4xl font-extrabold text-[#F97316]">$29,999</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Paid upfront. 4-6 months from start to finish. Excludes licensing exams, prerequisites, and any required testing.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 mb-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-green-500" /> Business Formation
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-green-500" /> GMB & Website
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-green-500" /> SEO & Ads
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-green-500" /> Recruiting
                </div>
              </div>
              {isInCart("dfy_bundle") ? (
                <Button
                  size="lg"
                  className="bg-green-600 hover:bg-green-600 text-white px-8"
                  disabled
                  data-testid="button-dfy-bundle-in-cart"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  In Cart
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="bg-[#F97316] hover:bg-[#ea6c10] text-white px-8 shadow-lg shadow-orange-500/25"
                  onClick={() => {
                    addItem({
                      id: "dfy_bundle",
                      type: "dfy_bundle",
                      name: "Complete Business Build",
                      price: 2999900,
                      description: "Formation, GMB & Website, SEO & Ads, Recruiting — everything in one package",
                    });
                    toast({ title: "Added to cart", description: "Complete Business Build bundle has been added to your cart." });
                  }}
                  data-testid="button-dfy-bundle-add-cart"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Add to Cart — $29,999
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
