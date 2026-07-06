import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  GraduationCap, MapPin, Building2, Shield, FileText, DollarSign,
  ExternalLink, CheckCircle2, AlertCircle, ChevronRight, Search,
  BookOpen, Globe, Camera, TrendingUp, ArrowRight, Star,
  HardHat, Briefcase, Scale, Heart, Calculator, Users,
  Clock, Lightbulb, X, Loader2, Monitor, ShieldAlert, Link2,
  Gauge, Eye, BarChart3, Zap, Ban, Send, FileSearch,
  UserX, Phone, Home, Award, Receipt, Truck, ThumbsDown,
  AlertTriangle, CircleDollarSign, Handshake, Building, BadgeCheck, Lock,
  Target, Wrench, MessageSquare, Palette, Code, Layers,
  Megaphone, PenTool, ShoppingCart, Smartphone, MousePointer,
  Share2, Hash, Mail, Sparkles, Trophy
} from "lucide-react";
import { useCart } from "@/contexts/cart-context";

type CoursePurchase = {
  id: number;
  userId: number;
  moduleId: number | null;
  isBundle: boolean | null;
  stripeSessionId: string | null;
  purchasedAt: string;
};

const TAB_MODULE_MAP: Record<string, number> = {
  "state-guide": 1,
  "website-seo": 3,
  "vetting": 4,
};

function PaywallOverlay({ tabName, onGoToPricing }: { tabName: string; onGoToPricing: () => void }) {
  return (
    <div className="relative mt-4 sm:mt-6">
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
        <div className="text-center max-w-md px-4 py-6 sm:p-8">
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-[#4A6CF7]/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <Lock className="h-6 w-6 sm:h-8 sm:w-8 text-[#4A6CF7]" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold mb-2" data-testid="text-paywall-title">Premium Content</h3>
          <p className="text-muted-foreground mb-4 sm:mb-6 text-sm">
            This {tabName} content is available to enrolled students. Purchase the course to unlock the full detailed guide, step-by-step instructions, and expert tips.
          </p>
          <Button
            className="bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white"
            size="lg"
            onClick={onGoToPricing}
            data-testid="button-paywall-unlock"
          >
            <Lock className="h-4 w-4 mr-2" />
            View Course Pricing
          </Button>
        </div>
      </div>
      <div className="pointer-events-none select-none" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="mb-4 opacity-40 blur-[2px]">
            <CardContent className="p-3 sm:p-5">
              <div className="h-4 bg-muted rounded w-3/4 mb-3" />
              <div className="h-3 bg-muted rounded w-full mb-2" />
              <div className="h-3 bg-muted rounded w-5/6 mb-2" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  formation: { label: "Business Formation", icon: Building2, color: "bg-blue-500" },
  licensing: { label: "Licensing", icon: Shield, color: "bg-purple-500" },
  insurance: { label: "Insurance", icon: Heart, color: "bg-red-500" },
  tax: { label: "Tax & Revenue", icon: Calculator, color: "bg-green-500" },
  payroll: { label: "Payroll & Reporting", icon: Users, color: "bg-orange-500" },
};

type StateGuide = {
  id: number;
  stateCode: string;
  stateName: string;
  sosName: string;
  sosUrl: string;
  entityTypes: string[] | null;
  licensingBoardName: string | null;
  licensingBoardUrl: string | null;
  licensingRequired: boolean | null;
  licensingNotes: string | null;
  workersCompType: string | null;
  workersCompAgency: string | null;
  workersCompUrl: string | null;
  taxBoardName: string | null;
  taxBoardUrl: string | null;
  salesTaxOnLabor: boolean | null;
  bAndOTax: boolean | null;
  bondRequired: boolean | null;
  gcBondAmount: string | null;
  specialtyBondAmount: string | null;
  insuranceNotes: string | null;
  payrollNotes: string | null;
  overview: string | null;
  steps?: StateGuideStep[];
};

type StateGuideStep = {
  id: number;
  stepNumber: number;
  title: string;
  description: string;
  url: string | null;
  urlLabel: string | null;
  category: string;
  isRequired: boolean | null;
  tips: string | null;
};

type MasterClassModule = {
  id: number;
  title: string;
  description: string;
  price: number;
  category: string;
  features: string[] | null;
};

const MODULE_ICONS: Record<string, any> = {
  licensing: HardHat,
  gmb: Camera,
  website: Globe,
  seo: TrendingUp,
};

const MODULE_COLORS: Record<string, string> = {
  licensing: "from-blue-600 to-blue-800",
  gmb: "from-purple-600 to-purple-800",
  website: "from-emerald-600 to-emerald-800",
  seo: "from-orange-600 to-orange-800",
};

export default function MasterClassPage() {
  const [selectedState, setSelectedState] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [seoName, setSeoName] = useState("");
  const [seoEmail, setSeoEmail] = useState("");
  const [seoPhone, setSeoPhone] = useState("");
  const [seoWebsite, setSeoWebsite] = useState("");
  const [seoServices, setSeoServices] = useState<string[]>([]);
  const [seoMessage, setSeoMessage] = useState("");
  const { toast } = useToast();

  const { data: guides } = useQuery<StateGuide[]>({
    queryKey: ["/api/state-guides"],
  });

  const { data: stateGuide, isLoading: loadingGuide } = useQuery<StateGuide>({
    queryKey: ["/api/state-guides", selectedState],
    enabled: !!selectedState,
  });

  const { data: modules } = useQuery<MasterClassModule[]>({
    queryKey: ["/api/master-class-modules"],
  });

  const { data: purchases } = useQuery<CoursePurchase[]>({
    queryKey: ["/api/course-purchases"],
  });

  const { addItem, isInCart } = useCart();
  const isDev = import.meta.env.DEV;
  const hasBundle = purchases?.some(p => p.isBundle) ?? false;
  const purchasedModuleIds = new Set(purchases?.map(p => p.moduleId).filter(Boolean) ?? []);
  const isTabUnlocked = (tab: string): boolean => {
    if (isDev) return true;
    if (hasBundle) return true;
    const moduleId = TAB_MODULE_MAP[tab];
    if (!moduleId) return true;
    return purchasedModuleIds.has(moduleId);
  };

  const enrollMutation = useMutation({
    mutationFn: async (params: { moduleId?: number; bundle?: boolean }) => {
      const res = await apiRequest("POST", "/api/stripe/create-course-checkout", params);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (err: Error) => {
      if (err.message.includes("Login required") || err.message.includes("401")) {
        toast({ title: "Sign in required", description: "Please sign in to enroll in a course.", variant: "destructive" });
      } else {
        toast({ title: "Enrollment failed", description: err.message, variant: "destructive" });
      }
    },
  });

  const seoInquiryMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; phone: string; website: string; services: string[]; message: string }) => {
      const res = await apiRequest("POST", "/api/seo-inquiry", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inquiry sent", description: "We'll be in touch within 1 business day." });
      setSeoName(""); setSeoEmail(""); setSeoPhone(""); setSeoWebsite(""); setSeoServices([]); setSeoMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const toggleSeoService = (service: string) => {
    setSeoServices(prev => prev.includes(service) ? prev.filter(s => s !== service) : [...prev, service]);
  };

  const filteredStates = searchQuery
    ? US_STATES.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : US_STATES;

  const statesWithLicensing = guides?.filter(g => g.licensingRequired)?.length ?? 0;
  const statesNoLicensing = guides ? guides.length - statesWithLicensing : 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <GraduationCap className="h-7 w-7 sm:h-8 sm:w-8 text-[#4A6CF7]" />
              <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-master-class-title">Master Class</h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-2xl" data-testid="text-master-class-subtitle">
              Your complete step-by-step guide to starting a construction business. Select your state to see exactly what you need — from forming your LLC to getting licensed, insured, and ready to work.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className="gap-1 text-xs" data-testid="badge-states-count">
              <MapPin className="h-3 w-3" /> 50 States
            </Badge>
            <Badge variant="outline" className="gap-1 text-xs" data-testid="badge-licensing-count">
              <Shield className="h-3 w-3" /> {statesWithLicensing} Require Licensing
            </Badge>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full flex-wrap h-auto gap-1 p-1" data-testid="tabs-master-class">
            <TabsTrigger value="overview" className="text-xs sm:text-sm gap-1 sm:gap-1.5 px-2 sm:px-3" data-testid="tab-overview">
              <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden xs:inline">Overview</span><span className="xs:hidden">Info</span>
            </TabsTrigger>
            <TabsTrigger value="state-guide" className="text-xs sm:text-sm gap-1 sm:gap-1.5 px-2 sm:px-3" data-testid="tab-state-guide">
              <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">State Guide</span><span className="sm:hidden">States</span>
              {!isTabUnlocked("state-guide") && <Lock className="h-3 w-3 text-amber-500" />}
            </TabsTrigger>
            <TabsTrigger value="website-seo" className="text-xs sm:text-sm gap-1 sm:gap-1.5 px-2 sm:px-3" data-testid="tab-website-seo">
              <Monitor className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Website & SEO</span><span className="sm:hidden">SEO</span>
              {!isTabUnlocked("website-seo") && <Lock className="h-3 w-3 text-amber-500" />}
            </TabsTrigger>
            <TabsTrigger value="vetting" className="text-xs sm:text-sm gap-1 sm:gap-1.5 px-2 sm:px-3" data-testid="tab-vetting">
              <ShieldAlert className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Vetting Contractors</span><span className="sm:hidden">Vetting</span>
              {!isTabUnlocked("vetting") && <Lock className="h-3 w-3 text-amber-500" />}
            </TabsTrigger>
            <TabsTrigger value="pricing" className="text-xs sm:text-sm gap-1 sm:gap-1.5 px-2 sm:px-3" data-testid="tab-pricing">
              <DollarSign className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Course Pricing</span><span className="sm:hidden">Pricing</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
            <Card className="border-[#F97316]/30 bg-gradient-to-br from-[#F97316]/5 via-transparent to-[#4A6CF7]/5 overflow-hidden">
              <CardContent className="p-4 sm:p-6 relative">
                <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
                  <Badge className="bg-red-600 text-white text-xs sm:text-sm px-2 sm:px-3 py-1 animate-pulse" data-testid="badge-sale">50% OFF — Limited Time</Badge>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-[#F97316]" />
                  <Badge variant="outline" className="text-xs border-[#F97316] text-[#F97316]">Master Class</Badge>
                </div>
                <h2 className="text-lg sm:text-2xl font-bold mb-2 sm:mb-3 max-w-lg">The Complete Blueprint to Building a Profitable Construction Business</h2>
                <p className="text-muted-foreground text-sm mb-4 max-w-2xl">
                  This isn't a generic business course. This is a battle-tested, step-by-step system built specifically for contractors, trades professionals, and construction entrepreneurs. Every module is packed with real-world knowledge from people who've actually built and scaled construction companies — not theory from someone who read a book about it.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <div className="text-center p-3 rounded-lg bg-background/60 border">
                    <p className="text-xl sm:text-2xl font-bold text-[#4A6CF7]">4</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">In-Depth Modules</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-background/60 border">
                    <p className="text-xl sm:text-2xl font-bold text-[#4A6CF7]">50</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">State Guides</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-background/60 border">
                    <p className="text-xl sm:text-2xl font-bold text-[#4A6CF7]">100+</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">Action Steps</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-background/60 border">
                    <p className="text-xl sm:text-2xl font-bold text-[#F97316]">$2,499</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground line-through">$4,999</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button className="bg-[#F97316] hover:bg-[#E86C0A] text-white" onClick={() => setActiveTab("pricing")} data-testid="button-overview-enroll">
                    View Course Pricing <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab("state-guide")} data-testid="button-overview-preview">
                    Preview State Guide
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[
                { icon: Building2, color: "text-blue-500", bg: "bg-blue-500/10", title: "Business Formation", desc: "Everything you need to legally establish your construction company — entity type, state filings, and compliance" },
                { icon: Shield, color: "text-purple-500", bg: "bg-purple-500/10", title: "Licensing & Bonding", desc: "Navigate your state's contractor licensing requirements and get properly bonded" },
                { icon: Heart, color: "text-red-500", bg: "bg-red-500/10", title: "Insurance & Workers Comp", desc: "The right insurance coverage for your trade — what you actually need and what's optional" },
                { icon: Calculator, color: "text-green-500", bg: "bg-green-500/10", title: "Tax & Payroll Setup", desc: "Tax registration, payroll compliance, and reporting — set up right from day one" },
              ].map((item, i) => (
                <Card key={i} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className={`w-10 h-10 rounded-lg ${item.bg} flex items-center justify-center mb-3`}>
                      <item.icon className={`h-5 w-5 ${item.color}`} />
                    </div>
                    <p className="font-semibold text-sm mb-1">{item.title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Layers className="h-5 w-5 text-[#4A6CF7]" />
                  Full Curriculum Breakdown
                </CardTitle>
                <CardDescription>Everything you get across all four modules</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  {
                    module: "Module 1: Business Formation & Licensing",
                    color: "border-l-blue-500",
                    price: "$1,500",
                    desc: "The complete legal blueprint for getting your construction business up and running in any state — entity formation, licensing, bonding, insurance, and compliance.",
                    highlights: ["All 50 states covered with direct agency links", "Entity selection, licensing & bonding guides", "Insurance, workers comp & tax setup", "Subcontractor management & sales strategy"]
                  },
                  {
                    module: "Module 2: GMB Setup & Optimization",
                    color: "border-l-purple-500",
                    price: "$2,000",
                    desc: "Build a Google Business Profile that dominates local search, generates leads consistently, and withstands competitor attacks.",
                    highlights: ["Full GMB setup & verification system", "Review strategy & fake review defense", "Photo optimization & posting calendar", "Suspension prevention & recovery"]
                  },
                  {
                    module: "Module 3: Website & Online Presence",
                    color: "border-l-emerald-500",
                    price: "$1,500",
                    desc: "Build a contractor website that actually converts visitors into booked jobs — the same framework used by 7-figure contractors.",
                    highlights: ["High-converting website blueprint", "Service & location page strategy", "Lead capture & speed optimization", "Portfolio showcases & trust signals"]
                  },
                  {
                    module: "Module 4: SEO & Directory Domination",
                    color: "border-l-orange-500",
                    price: "$1,500",
                    desc: "Get found everywhere your customers search — the complete local SEO, citation, content, and advertising playbook.",
                    highlights: ["Local SEO strategy for contractors", "Citation & link building systems", "Google Ads & LSA campaign setup", "Tracking, analytics & monthly maintenance"]
                  }
                ].map((section, i) => (
                  <div key={i} className={`border-l-4 ${section.color} pl-4`}>
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-semibold text-sm">{section.module}</h4>
                      <span className="text-xs font-bold text-[#4A6CF7]">{section.price}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{section.desc}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {section.highlights.map((item, j) => (
                        <div key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-[#4A6CF7]/20 bg-[#4A6CF7]/5">
              <CardContent className="p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold mb-3 flex items-center gap-2">
                  <Target className="h-5 w-5 text-[#4A6CF7]" />
                  Who This Course Is For
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { title: "New Contractors", desc: "Just getting started and need to know exactly what to do, in what order, without missing critical steps that could cost you thousands later" },
                    { title: "Experienced Tradespeople", desc: "You know the work, but you've been doing it under someone else's license. Now you want to launch your own company the right way" },
                    { title: "Construction Business Owners", desc: "Already have a business but your online presence is weak. You're losing jobs to competitors who show up on Google first" },
                    { title: "Multi-State Operators", desc: "Expanding into new states and need to understand different licensing, bonding, insurance, and tax requirements quickly" },
                    { title: "Home Service Companies", desc: "Roofing, siding, plumbing, electrical, HVAC, painting, landscaping — every trade benefits from this system" },
                    { title: "Franchise Owners", desc: "Running a franchise location and need to understand local compliance, GMB optimization, and local SEO strategy" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-background/60">
                      <CheckCircle2 className="h-4 w-4 text-[#4A6CF7] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-transparent">
              <CardContent className="p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold mb-3 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-amber-500" />
                  What Makes This Different
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border bg-background/60">
                    <p className="font-semibold text-sm mb-1">Built by Owners Who Scaled</p>
                    <p className="text-xs text-muted-foreground">Created by several company owners who grew from solo owner-operators to running multi-state operations with hundreds of employees. Real experience, not theory.</p>
                  </div>
                  <div className="p-3 rounded-lg border bg-background/60">
                    <p className="font-semibold text-sm mb-1">Built for Construction</p>
                    <p className="text-xs text-muted-foreground">This isn't a generic business course with a hard hat logo. Every section is built specifically for contractors and trades — by people who've done it.</p>
                  </div>
                  <div className="p-3 rounded-lg border bg-background/60">
                    <p className="font-semibold text-sm mb-1">All 50 States Covered</p>
                    <p className="text-xs text-muted-foreground">Every state has different requirements. We've mapped them all so you don't have to figure it out yourself.</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    States Requiring Contractor License ({statesWithLicensing})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {guides?.filter(g => g.licensingRequired).map(g => (
                      <Badge
                        key={g.stateCode}
                        variant="secondary"
                        className="cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => { setSelectedState(g.stateCode); setActiveTab("state-guide"); }}
                        data-testid={`badge-licensed-${g.stateCode}`}
                      >
                        {g.stateCode}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
                    No State Contractor License Required ({statesNoLicensing})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {guides?.filter(g => !g.licensingRequired).map(g => (
                      <Badge
                        key={g.stateCode}
                        variant="outline"
                        className="cursor-pointer hover:bg-primary/10 transition-colors"
                        onClick={() => { setSelectedState(g.stateCode); setActiveTab("state-guide"); }}
                        data-testid={`badge-unlicensed-${g.stateCode}`}
                      >
                        {g.stateCode}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    These states may still require local licenses or trade-specific licenses (electrical, plumbing, etc.)
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Quick State Comparison</CardTitle>
                <CardDescription>Key facts for each state at a glance</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search states..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-states"
                  />
                </div>
                <div className="overflow-x-auto -mx-2 sm:mx-0">
                  <table className="w-full text-xs sm:text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">State</th>
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">License</th>
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">Workers Comp</th>
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">Sales Tax</th>
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">B&O Tax</th>
                        <th className="pb-2 pr-3 sm:pr-4 font-medium">Bond</th>
                        <th className="pb-2 font-medium">SOS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStates.map(state => {
                        const guide = guides?.find(g => g.stateCode === state.code);
                        if (!guide) return null;
                        return (
                          <tr
                            key={state.code}
                            className="border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => { setSelectedState(state.code); setActiveTab("state-guide"); }}
                            data-testid={`row-state-${state.code}`}
                          >
                            <td className="py-2 pr-3 sm:pr-4 font-medium whitespace-nowrap">{state.name}</td>
                            <td className="py-2 pr-3 sm:pr-4">
                              {guide.licensingRequired ? (
                                <Badge variant="default" className="bg-green-600 text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">No</Badge>
                              )}
                            </td>
                            <td className="py-2 pr-3 sm:pr-4 text-xs text-muted-foreground whitespace-nowrap">
                              {guide.workersCompType === "state_fund" ? "State Fund" :
                               guide.workersCompType === "state_fund_or_private" ? "State/Private" :
                               guide.workersCompType === "private_or_state" ? "Private/State" : "Private"}
                            </td>
                            <td className="py-2 pr-3 sm:pr-4">
                              {guide.salesTaxOnLabor ? (
                                <Badge variant="destructive" className="text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="text-green-600 text-xs">No</Badge>
                              )}
                            </td>
                            <td className="py-2 pr-3 sm:pr-4">
                              {guide.bAndOTax ? (
                                <Badge variant="destructive" className="text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">No</Badge>
                              )}
                            </td>
                            <td className="py-2 pr-3 sm:pr-4">
                              {guide.bondRequired ? (
                                <Badge variant="secondary" className="text-xs">Yes</Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs">No</Badge>
                              )}
                            </td>
                            <td className="py-2">
                              <a
                                href={guide.sosUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#4A6CF7] hover:underline inline-flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`link-sos-${state.code}`}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="state-guide" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={selectedState} onValueChange={setSelectedState}>
                <SelectTrigger className="w-full sm:w-72" data-testid="select-state">
                  <SelectValue placeholder="Select your state..." />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => (
                    <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedState && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedState("")} data-testid="button-clear-state">
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
            </div>

            {!selectedState && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <MapPin className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Select Your State</h3>
                  <p className="text-muted-foreground max-w-md">
                    Choose a state from the dropdown above to see the complete step-by-step process for starting a construction business there.
                  </p>
                </CardContent>
              </Card>
            )}

            {selectedState && loadingGuide && (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            )}

            {stateGuide && (
              <>
                <Card className="border-[#4A6CF7]/20">
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col gap-3 mb-4">
                      <div>
                        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2" data-testid="text-state-name">
                          <MapPin className="h-5 w-5 text-[#4A6CF7] shrink-0" />
                          {stateGuide.stateName}
                        </h2>
                        <p className="text-muted-foreground mt-1 text-sm max-w-2xl">
                          {isTabUnlocked("state-guide") ? stateGuide.overview : "Complete step-by-step guide for starting a construction business in " + stateGuide.stateName + ". Purchase the course to unlock all details."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {stateGuide.licensingRequired ? (
                          <Badge className="bg-green-600 gap-1"><Shield className="h-3 w-3" /> License Required</Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1"><AlertCircle className="h-3 w-3" /> No State License</Badge>
                        )}
                        {stateGuide.bondRequired && (
                          <Badge variant="secondary" className="gap-1"><Scale className="h-3 w-3" /> Bond Required</Badge>
                        )}
                        {stateGuide.salesTaxOnLabor && (
                          <Badge variant="destructive" className="gap-1"><DollarSign className="h-3 w-3" /> Tax on Labor</Badge>
                        )}
                        {!isTabUnlocked("state-guide") && (
                          <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600"><Lock className="h-3 w-3" /> Locked</Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{stateGuide.sosName}</p>
                          <p className="text-[10px] text-muted-foreground">Form Entity</p>
                        </div>
                        {!isTabUnlocked("state-guide") && <Lock className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                        {isTabUnlocked("state-guide") && <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <Shield className="h-4 w-4 text-purple-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">Licensing Board</p>
                          <p className="text-[10px] text-muted-foreground">Get Licensed</p>
                        </div>
                        {!isTabUnlocked("state-guide") && <Lock className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <Heart className="h-4 w-4 text-red-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">Workers Comp</p>
                          <p className="text-[10px] text-muted-foreground">Coverage Info</p>
                        </div>
                        {!isTabUnlocked("state-guide") && <Lock className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                        <Calculator className="h-4 w-4 text-green-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">Tax Board</p>
                          <p className="text-[10px] text-muted-foreground">Taxes</p>
                        </div>
                        {!isTabUnlocked("state-guide") && <Lock className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {isTabUnlocked("state-guide") ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <Card className="text-center">
                        <CardContent className="p-4">
                          <p className="text-lg font-bold">{stateGuide.entityTypes?.length || 0}</p>
                          <p className="text-xs text-muted-foreground">Entity Types</p>
                        </CardContent>
                      </Card>
                      <Card className="text-center">
                        <CardContent className="p-4">
                          <p className="text-lg font-bold">{stateGuide.licensingRequired ? "Yes" : "No"}</p>
                          <p className="text-xs text-muted-foreground">State License</p>
                        </CardContent>
                      </Card>
                      <Card className="text-center">
                        <CardContent className="p-4">
                          <p className="text-lg font-bold">{stateGuide.workersCompType === "state_fund" ? "State" : "Private"}</p>
                          <p className="text-xs text-muted-foreground">Workers Comp</p>
                        </CardContent>
                      </Card>
                      <Card className="text-center">
                        <CardContent className="p-4">
                          <p className="text-lg font-bold">{stateGuide.salesTaxOnLabor ? "Yes" : "No"}</p>
                          <p className="text-xs text-muted-foreground">Tax on Labor</p>
                        </CardContent>
                      </Card>
                      <Card className="text-center">
                        <CardContent className="p-4">
                          <p className="text-lg font-bold">{stateGuide.gcBondAmount || "None"}</p>
                          <p className="text-xs text-muted-foreground">GC Bond</p>
                        </CardContent>
                      </Card>
                    </div>

                    {stateGuide.licensingNotes && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Shield className="h-4 w-4 text-purple-500" /> Licensing Details
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{stateGuide.licensingNotes}</p>
                        </CardContent>
                      </Card>
                    )}

                    {stateGuide.insuranceNotes && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Heart className="h-4 w-4 text-red-500" /> Insurance & Workers Comp
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{stateGuide.insuranceNotes}</p>
                        </CardContent>
                      </Card>
                    )}

                    {stateGuide.payrollNotes && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4 text-orange-500" /> Payroll & Tax Reporting
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{stateGuide.payrollNotes}</p>
                        </CardContent>
                      </Card>
                    )}

                    {stateGuide.steps && stateGuide.steps.length > 0 && (
                      <div className="space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                          <Briefcase className="h-5 w-5 text-[#4A6CF7]" />
                          Step-by-Step Process for {stateGuide.stateName}
                        </h3>
                        <div className="space-y-3">
                          {stateGuide.steps.map((step, idx) => {
                            const catConfig = CATEGORY_CONFIG[step.category] || CATEGORY_CONFIG.formation;
                            const CatIcon = catConfig.icon;
                            return (
                              <Card key={step.id} className="overflow-hidden" data-testid={`card-step-${idx + 1}`}>
                                <div className="flex">
                                  <div className={`w-1.5 ${catConfig.color} shrink-0`} />
                                  <div className="flex-1 p-4">
                                    <div className="flex items-start gap-3">
                                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#4A6CF7] text-white text-sm font-bold shrink-0">
                                        {step.stepNumber}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                          <h4 className="font-semibold text-sm">{step.title}</h4>
                                          <Badge variant="outline" className="text-[10px] gap-1">
                                            <CatIcon className="h-2.5 w-2.5" /> {catConfig.label}
                                          </Badge>
                                          {step.isRequired ? (
                                            <Badge className="bg-green-600/10 text-green-600 text-[10px]">Required</Badge>
                                          ) : (
                                            <Badge variant="outline" className="text-[10px]">Optional</Badge>
                                          )}
                                        </div>
                                        <p className="text-sm text-muted-foreground mb-2">{step.description}</p>
                                        {step.tips && (
                                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10 mb-2">
                                            <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                            <p className="text-xs text-muted-foreground">{step.tips}</p>
                                          </div>
                                        )}
                                        {step.url && (
                                          <a
                                            href={step.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-xs text-[#4A6CF7] hover:underline font-medium"
                                            data-testid={`link-step-${idx + 1}`}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                            {step.urlLabel || "Visit Website"}
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {(!stateGuide.steps || stateGuide.steps.length === 0) && (
                      <Card className="border-dashed">
                        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                          <Clock className="h-10 w-10 text-muted-foreground/30 mb-3" />
                          <h3 className="font-semibold mb-1">Detailed Steps Coming Soon</h3>
                          <p className="text-sm text-muted-foreground max-w-md">
                            We're building out the step-by-step guide for {stateGuide.stateName}. In the meantime, use the quick links above to access the key state agencies directly.
                          </p>
                        </CardContent>
                      </Card>
                    )}

                    <div className="space-y-4 mt-6">
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-[#4A6CF7]" />
                        Building & Running Your Business
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        The way you structure your company — hiring, sales, branding, subcontractors — can make or break you, especially in the early stages. This section covers the real-world operations lessons that most courses skip entirely.
                      </p>

                      <Card className="border-blue-500/20" data-testid="card-subs-section">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Handshake className="h-4 w-4 text-blue-500" /> Working with Subcontractors (1099)
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Using subs will always be easier than building a W-2 crew, but there are critical legal and operational realities you need to understand.
                          </p>
                          <div className="space-y-2">
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/5 border border-red-500/10">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Insurance & Workers Comp:</strong> Every sub MUST carry their own insurance and workers comp. If they don't and one of their employees gets hurt on your jobsite, the liability falls back on YOU. Always verify their certificates of insurance (COIs) and make sure they're current.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
                              <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Subcontractor Agreement:</strong> Create a contract stating they are responsible for their own employees, taxes, fees, and liability. This is your legal protection. Without it, you're exposed.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/10">
                              <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">1099 Rule — No Schedule Dictation:</strong> You cannot dictate a sub's schedule. This is a hard legal requirement for 1099 classification. If you control when and how they work, the IRS can reclassify them as W-2 employees, exposing you to back taxes, penalties, and fines.
                              </p>
                            </div>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Quality vs. Efficiency Trade-off</h4>
                          <p className="text-sm text-muted-foreground">
                            Controlling quality is always harder with subs — it's a constant balance of quality vs. efficiency and less hands-on work. Most subs will NOT clean up jobsites or do the small things to cater to clients (covering furniture, cleaning up after themselves, communicating updates). These details always reflect on YOUR company, not the sub.
                          </p>

                          <h4 className="font-semibold text-sm mt-3">Keeping Subs Anonymous to Clients</h4>
                          <p className="text-sm text-muted-foreground">
                            Most clients don't like knowing a company uses subs — they hired YOU, not a mystery crew. Make sure subs keep this anonymous:
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                            {[
                              "Subs should NOT wear their own logos or company decals on the jobsite",
                              "Provide branded shirts and vehicle magnets with YOUR company logo",
                              "Amazon does this with their delivery drivers — branded vans, branded uniforms",
                              "Uber, Lyft, and FedEx all operate with 1099 contractors using company branding",
                              "FedEx drivers use company trucks despite being classified as 1099",
                              "There are gray areas in this space — but consistent branding is key to client trust"
                            ].map((item, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <CheckCircle2 className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
                                <span>{item}</span>
                              </div>
                            ))}
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Non-Competes vs NDAs</h4>
                          <p className="text-sm text-muted-foreground">
                            Non-compete agreements have been largely abolished due to freedom of rights rulings. You can no longer force a sub to sign one. However, you CAN have them sign an <strong>NDA (Non-Disclosure Agreement)</strong> which limits who they can talk to — restricting them from sharing your client lists, pricing structures, operational processes, or contacting your clients directly. This is your best legal protection for keeping your business intelligence private.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="border-green-500/20" data-testid="card-sales-section">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <CircleDollarSign className="h-4 w-4 text-green-500" /> Sales — The Most Important Role
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            The most important role in any construction business is <strong>SALES</strong>. Without sales, nothing else matters — not your crew, not your tools, not your license. Everything starts with closing jobs.
                          </p>

                          <div className="p-3 rounded-lg border border-green-500/20 bg-green-500/5">
                            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                              <Target className="h-4 w-4 text-green-500" /> Close Rate Benchmarks
                            </h4>
                            <div className="grid grid-cols-3 gap-3 text-center">
                              <div>
                                <p className="text-lg font-bold text-green-500">33%+</p>
                                <p className="text-[10px] text-muted-foreground">Great Sales (1 of 3)</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-yellow-500">20%</p>
                                <p className="text-[10px] text-muted-foreground">Average</p>
                              </div>
                              <div>
                                <p className="text-lg font-bold text-red-500">&lt;15%</p>
                                <p className="text-[10px] text-muted-foreground">Dangerous</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              Anything below 15% is dangerous because of the cost of leads. At $50-150/lead, a low close rate can be financially devastating for a business.
                            </p>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Hiring a Sales Rep</h4>
                          <div className="space-y-2">
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-green-500/5 border border-green-500/10">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Commission only — 8-10% of revenue minus sales tax.</strong> Do NOT put a sales rep on salary. This is a huge long-term exposure. Commission-only reps perform better because if they don't sell, they don't eat.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
                              <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Poaching from competitors:</strong> This is what Elon Musk does — he recruits top talent from Microsoft and Google. Hiring a proven sales rep from a competitor saves you training time and they already know the trade. However, this is risky: they could flip on you, and they may have an NDA with their previous employer that could expose you legally. Always ask about prior arrangements before bringing them on.
                              </p>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            <strong>Best places to recruit:</strong> Craigslist and Indeed are the best platforms to find a new sales rep or project manager. Post clear commission structures and expectations upfront.
                          </p>

                          <h4 className="font-semibold text-sm mt-3">Sales Tactics That Win Jobs</h4>
                          <div className="space-y-2">
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/10">
                              <Clock className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Never say you're available same day — even if you are.</strong> Schedule estimates 1-2 days ahead. If you show up immediately, the client assumes you're not busy, which signals you don't have much work. A slight wait creates perceived demand and makes them value your time more.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-green-500/5 border border-green-500/10">
                              <Phone className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Stay in constant contact while bidding.</strong> Out of sight, out of mind — and that's deadly during the bidding process. Follow up after the estimate, send a thank-you text or email, check in 2-3 days later. Most contractors give a bid and disappear. The one who stays top of mind wins the job.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-purple-500/5 border border-purple-500/10">
                              <Award className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Differentiate yourself from the competition.</strong> Every homeowner is getting 3-5 bids. If your estimate looks like everyone else's — a number scribbled on a piece of paper — you blend in. Present a professional proposal with your branding, scope of work, timeline, warranty details, and photos of past work. Make it impossible for the client to compare you to the guy in a beat-up truck with a handwritten quote.
                              </p>
                            </div>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Avoid High-Pressure Sales Tactics</h4>
                          <p className="text-sm text-muted-foreground">
                            Don't fall into the trap of sleazy one-call-close tactics — "sign today or lose the price" pressure selling. High-pressure sales is an art form that takes years to master, and if you don't know what you're doing, it will backfire badly. You'll lose the sale, damage your reputation, and potentially earn a bad review that costs you far more than the job was worth. Homeowners talk to each other, post in neighborhood groups, and share experiences online. One pushy encounter can label your company as "aggressive" or "scammy" in an entire community. Instead, focus on building trust through professionalism, clear communication, and honest timelines. Let the quality of your proposal and follow-up do the selling — the best closers in construction don't need to pressure anyone because they've already built enough confidence during the estimate.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="border-red-500/20" data-testid="card-reputation-section">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Star className="h-4 w-4 text-red-500" /> Reputation & Review Management
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Your online reputation is the single most valuable asset in your business — more important than your trucks, your tools, or even your crew. Every decision you make with a client should be filtered through this question: <strong>"Is this worth risking a bad review?"</strong>
                          </p>

                          <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4 text-red-500" /> The Real Cost of Bad Reviews
                            </h4>
                            <div className="grid grid-cols-2 gap-3 text-center mb-3">
                              <div className="p-2 rounded border border-red-500/10">
                                <p className="text-lg font-bold text-red-500">10-15%</p>
                                <p className="text-[10px] text-muted-foreground">Business loss per year from a single bad review</p>
                              </div>
                              <div className="p-2 rounded border border-red-500/10">
                                <p className="text-lg font-bold text-red-500">20-50%</p>
                                <p className="text-[10px] text-muted-foreground">Business loss from damaging reviews (scam, abandoned job, etc.)</p>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              A standard negative review — "slow communication" or "went over budget" — will cost you roughly 10-15% of your annual revenue. But devastating reviews that use words like <strong>"walked off the job," "didn't finish the work," "ripped us off,"</strong> or <strong>"scammers"</strong> can destroy 20-50% of your business. These are the reviews that kill companies, because the number one thing a customer looks for in reviews is <strong>trustworthiness</strong>. Quality matters, but trust comes first — if a company looks untrustworthy, they're not getting the job no matter how good their work is.
                            </p>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">The $1,000 Rule: Reviews Over Revenue</h4>
                          <p className="text-sm text-muted-foreground">
                            It is never worth arguing with a client over unfinished work. Nobody likes doing free work — but a glowing 5-star review is worth far more than $1,000 of disputed punch-list items. If you have a client who's unhappy about minor remaining work, don't dig your heels in. Finish it, do it right, and leverage that effort into a contractual agreement for a detailed, positive review.
                          </p>
                          <div className="space-y-2 mt-2">
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-green-500/5 border border-green-500/10">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Trade work for reviews.</strong> If a client has a remaining $500-1,000 complaint, offer to resolve it in exchange for a written, detailed 5-star review. Frame it as a goodwill gesture — "We want to make this right, and if you're happy with the result, we'd love an honest review." Put this in writing. They're now contractually incentivized to follow through, and you've turned a potential disaster into a marketing win.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/5 border border-red-500/10">
                              <Ban className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Never get into a pissing contest with a client.</strong> You will always lose. Even if you're right, even if the client is being unreasonable — the public will side with the homeowner every time. A back-and-forth argument in Google Reviews makes you look petty and unprofessional. Responding to negative reviews should be calm, professional, and focused on resolution — never defensive or combative.
                              </p>
                            </div>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">What Clients Actually Look For in Reviews</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                            {[
                              { rank: "1", trait: "Trustworthiness", desc: "Did they do what they said? Did they show up? Did they finish? This is the #1 filter and the reason 'scam' reviews are devastating", weight: "text-red-500" },
                              { rank: "2", trait: "Communication", desc: "Did they keep the client in the loop? Were they responsive? Did they return calls and texts promptly?", weight: "text-orange-500" },
                              { rank: "3", trait: "Quality of Work", desc: "Was the craftsmanship good? Did they pay attention to details? Were there callbacks or warranty issues?", weight: "text-yellow-500" },
                              { rank: "4", trait: "Timeline & Reliability", desc: "Did they start and finish on time? Were there unexplained delays? Did they manage expectations?", weight: "text-blue-500" },
                              { rank: "5", trait: "Cleanliness & Respect", desc: "Did they protect the property? Clean up daily? Treat the home and family with respect?", weight: "text-green-500" },
                              { rank: "6", trait: "Price Fairness", desc: "Was pricing transparent? Were there surprise charges? Interestingly, price is one of the least-mentioned traits in positive reviews", weight: "text-purple-500" },
                            ].map((item, i) => (
                              <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-md border border-border/30">
                                <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold ${item.weight} shrink-0`}>{item.rank}</div>
                                <div>
                                  <p className="text-xs font-semibold">{item.trait}</p>
                                  <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div className="flex items-start gap-2 p-3 rounded-md bg-[#4A6CF7]/5 border border-[#4A6CF7]/10 mt-2">
                            <Lightbulb className="h-4 w-4 text-[#4A6CF7] shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium mb-1">The Math That Should Change How You Handle Every Client</p>
                              <p className="text-xs text-muted-foreground">
                                If your business does $500K/year and a single bad review costs you 10-15%, that's $50,000-$75,000 in lost revenue — every year it sits there. A devastating "scam" or "abandoned job" review at 20-50% impact is $100,000-$250,000 per year. Now compare that to the $500-1,000 of disputed work you're arguing about. The math is not even close. Protect your reputation at all costs. Eat the small loss, get the review, and move on to the next job.
                              </p>
                            </div>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Handling Difficult Clients</h4>
                          <p className="text-sm text-muted-foreground">
                            Some clients will never be satisfied — no matter how good your work is, how many extras you throw in, or how many times you come back to fix things. These clients exist in every market, and you need to recognize them early. Their goal may be to get free work, negotiate after the fact, or simply find fault with everything. Some are looking for blood from the start, and you may be their chosen victim before you even pick up a hammer.
                          </p>

                          <div className="space-y-2 mt-2">
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/5 border border-red-500/10">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">The goal is always the same: walk away without a lawsuit or a bad review.</strong> You won't win every client relationship, but you can control how it ends. A clean exit — where the client feels heard and you part on neutral terms — is worth more than being "right." Standing your ground with a difficult client is not a winning approach. Pride has no ROI in this business.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
                              <Shield className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Never get personal — no politics, religion, personal views, or opinions.</strong> Keep every interaction 100% professional and focused on the work. Even casual small talk can turn dangerous. If a client brings up a topic you disagree with — don't engage, don't push back, don't even hint at your position. They may seem fine in the moment, but disagreements plant seeds of resentment that surface later as "difficult to work with" reviews or refusal to pay. You are there to build, not to debate.
                              </p>
                            </div>
                            <div className="flex items-start gap-2 p-2.5 rounded-md bg-blue-500/5 border border-blue-500/10">
                              <Handshake className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                              <p className="text-xs text-muted-foreground">
                                <strong className="text-foreground">Always be agreeable — stay neutral, stay relevant, stay professional.</strong> Even when the client is wrong about a construction method, a timeline, or a material choice — correct them with facts, not attitude. "I totally understand why you'd think that, and here's what we've found works best..." will always land better than "That's not how it works." Agreeable doesn't mean pushover — it means you control the conversation without creating conflict. The contractors who build the biggest businesses are the ones who know how to manage people, not just projects.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                            <div className="p-2.5 rounded-md border border-border/30">
                              <p className="text-xs font-semibold text-red-500 mb-1">Red Flags of a Problem Client</p>
                              <div className="space-y-1">
                                {[
                                  "Mentions lawsuits or attorneys early in the process",
                                  "Has left multiple 1-star reviews for other businesses",
                                  "Constantly compares your pricing to other bids",
                                  "Wants to negotiate the price after work has started",
                                  "Refuses to sign a contract or put anything in writing",
                                  "Changes scope repeatedly without acknowledging cost changes",
                                  "Becomes overly friendly too fast — could be setting you up for a favor later",
                                ].map((flag, i) => (
                                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                    <X className="h-2.5 w-2.5 text-red-400 shrink-0 mt-0.5" />
                                    <span>{flag}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="p-2.5 rounded-md border border-border/30">
                              <p className="text-xs font-semibold text-green-500 mb-1">How to De-Escalate & Exit Clean</p>
                              <div className="space-y-1">
                                {[
                                  "Document everything — texts, emails, photos of completed work",
                                  "Communicate in writing, not just phone calls or in-person",
                                  "Offer a resolution before they escalate — be the bigger person",
                                  "If they want free work, trade it for a written positive review",
                                  "Never raise your voice, curse, or get emotional on a jobsite",
                                  "If it's unsalvageable, offer a partial refund to close the chapter",
                                  "Consult your attorney before walking off any job mid-contract",
                                ].map((tip, i) => (
                                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                                    <CheckCircle2 className="h-2.5 w-2.5 text-green-400 shrink-0 mt-0.5" />
                                    <span>{tip}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-purple-500/20" data-testid="card-pm-section">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4 text-purple-500" /> Hiring & Staffing Strategy
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/5 border border-red-500/10">
                            <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-muted-foreground">
                              <strong className="text-foreground">Avoid hiring too fast.</strong> In the early stages, do NOT hire a ton of help like PMs or secretaries. The majority of the work will fall back on you regardless. Every salary you add is overhead that eats into margins before you have consistent revenue to support it.
                            </p>
                          </div>

                          <h4 className="font-semibold text-sm mt-3">Project Managers (PMs)</h4>
                          <p className="text-sm text-muted-foreground">
                            Your PM is the most trusted person in the operation. In the beginning, this should be YOU. Don't rush to fill this role until the workload is genuinely too large to keep up with.
                          </p>
                          <div className="p-3 rounded-lg border border-border/40 bg-muted/30">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <p className="text-xs text-muted-foreground">Typical PM Salary</p>
                                <p className="text-sm font-bold">$45,000 – $75,000/yr</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Depends On</p>
                                <p className="text-sm font-bold">Experience & Scope</p>
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Incentivize PMs with performance bonuses, paid time off, and potentially a company vehicle. But don't buy assets you can't afford — if you're not closing enough work to support it, a company truck becomes a liability, not a perk.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="border-amber-500/20" data-testid="card-branding-section">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Award className="h-4 w-4 text-amber-500" /> Branding & Professional Image
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Creating the illusion of size is critical for customer trust. Clients want to know they're hiring a real company that isn't going anywhere — not a one-person operation that might disappear.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                              { icon: Truck, text: "Have at least a few company vehicles with a full wrap — this signals permanence and professionalism" },
                              { icon: Users, text: "All reps should wear branded uniforms — never trashy clothes, even if you're doing physical work" },
                              { icon: Shield, text: "Clients want to know they'll be taken care of by a company with staff, even if you're running lean" },
                              { icon: Building2, text: "If you're owner-operator, never tell the client you're the owner — say you're a PM or sales rep" },
                            ].map((item, i) => (
                              <div key={i} className="flex items-start gap-2 p-2.5 rounded-md border border-border/30">
                                <item.icon className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                <p className="text-xs text-muted-foreground">{item.text}</p>
                              </div>
                            ))}
                          </div>

                          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/10 mt-2">
                            <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium mb-1">Why Separation Between You and the Brand Matters</p>
                              <p className="text-xs text-muted-foreground">
                                If a client knows you're the owner doing the install, they take you less seriously. There should be a clear separation between you and the brand. Tell them you're the PM or the sales rep — it creates a perception of structure, hierarchy, and accountability that makes clients feel safer about their investment. They want to see a company with departments, not a solo operator with a pickup truck.
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-[#4A6CF7]/20 bg-[#4A6CF7]/5" data-testid="card-business-structure-summary">
                        <CardContent className="p-4">
                          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                            <Lightbulb className="h-4 w-4 text-[#4A6CF7]" /> The Bottom Line on Business Structure
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            How your company is structured can make you or break you, especially in the early stages. Keep overhead low, use subs strategically with proper contracts, hire sales commission-only, don't rush into salaried positions, and always project a professional image. The companies that survive year one are the ones that sell well and spend smart — not the ones that hire fastest.
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                ) : (
                  <>
                    <Card className="border-dashed border-amber-500/30 bg-amber-500/5">
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-[#4A6CF7]" />
                          What's Included in the {stateGuide.stateName} Guide
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                          {[
                            "LLC / Corporation Formation Steps",
                            "Secretary of State Links & Requirements",
                            "Contractor Licensing Process & Exams",
                            "Workers Comp Setup (State vs Private)",
                            "Bonding Requirements & Amounts",
                            "Insurance Requirements & Tips",
                            "Tax Registration & Obligations",
                            "Payroll Setup & Reporting",
                          ].map((item, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                              {item}
                            </div>
                          ))}
                        </div>
                        {stateGuide.steps && stateGuide.steps.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Includes {stateGuide.steps.length} detailed steps with direct links, pro tips, and agency resources.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                    <PaywallOverlay tabName="State Guide" onGoToPricing={() => setActiveTab("pricing")} />
                  </>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="website-seo" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6" data-testid="tab-content-website-seo">
            <Card className="border-[#4A6CF7]/20 bg-gradient-to-r from-[#4A6CF7]/5 to-transparent">
              <CardContent className="p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3 flex items-center gap-2">
                  <Monitor className="h-5 w-5 sm:h-6 sm:w-6 text-[#4A6CF7] shrink-0" />
                  Building a Strong Website That Ranks
                  {!isTabUnlocked("website-seo") && <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600 ml-2"><Lock className="h-3 w-3" /> Locked</Badge>}
                </h2>
                <p className="text-muted-foreground mb-4">
                  Your website is the foundation of your online presence. This module covers everything from location pages and unique content strategy to Google Search Console, page speed optimization, tracking analytics, and advanced backlink building.
                </p>
                {!isTabUnlocked("website-seo") && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-4">
                    {[
                      { icon: Globe, text: "Location Pages & Slug Pages" },
                      { icon: FileSearch, text: "Google Search Console Setup" },
                      { icon: Gauge, text: "Page Speed & Performance" },
                      { icon: BarChart3, text: "Tracking & Analytics" },
                      { icon: Link2, text: "Backlinks & Link Building" },
                      { icon: Send, text: "SEO Services & Consultation" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded border bg-muted/30">
                        <item.icon className="h-3.5 w-3.5 text-[#4A6CF7] shrink-0" />
                        {item.text}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isTabUnlocked("website-seo") ? (
              <PaywallOverlay tabName="Website & SEO" onGoToPricing={() => setActiveTab("pricing")} />
            ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-500" />
                    Location Pages & Slug Pages
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Your homepage matters, but your location pages and slug pages (service pages, city pages) are just as important — sometimes more. These are the pages that actually rank for local and service-specific searches. Every city and service you cover should have its own dedicated landing page with unique content.
                  </p>
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/10">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Each landing page must have unique content. Do not duplicate content across pages or copy from competitors. Use AI tools minimally — if you lean on AI too heavily, your content will read the same as everyone else's. Google grades your content on uniqueness. If it detects duplicate or thin content, your pages will not rank and can actually hurt your entire site.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileSearch className="h-5 w-5 text-green-500" />
                    Google Search Console (GSC)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Google Search Console is where you index your pages so Google actually knows they exist. This is where you submit sitemaps, request indexing for new pages, and monitor for crawl errors. If there are errors, fix them immediately — errors hurt your rankings.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-medium mb-1">GSC Verification Methods</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> Website HTML tag or file upload</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> Server access (root level)</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> Email access to that domain account</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> Cloudflare DNS</li>
                        <li className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> DNS TXT record</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-medium mb-1">What to Monitor</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-blue-500 shrink-0" /> Index coverage & errors</li>
                        <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-blue-500 shrink-0" /> Sitemap submission status</li>
                        <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-blue-500 shrink-0" /> Manual actions or penalties</li>
                        <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-blue-500 shrink-0" /> Core Web Vitals</li>
                        <li className="flex items-center gap-1.5"><Eye className="h-3 w-3 text-blue-500 shrink-0" /> Page experience signals</li>
                      </ul>
                    </div>
                  </div>

                  <Card className="border-red-500/30 bg-red-500/5">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">Critical Warning: Protect Your GSC Access</p>
                          <p className="text-xs text-muted-foreground mb-2">
                            Never give Google Search Console access to someone you don't fully trust. There is a feature called <strong>Disavow</strong> that allows someone to reject all of your site's backlinks. A disgruntled employee, fired contractor, or untrustworthy agency can pull your backlink profile from tools like Ahrefs or Semrush, then disavow every single backlink your site has built. This will destroy your rankings entirely — and it is extremely difficult to recover from.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Always be careful who you trust with this level of access. If you fire someone or end a contractor relationship on bad terms, revoke their GSC access immediately. This is one of the most dangerous attack vectors in SEO and can ruin you or your clients.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-orange-500" />
                    Page Speed & Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Page speed is a direct ranking factor. Google rolled out a Core Web Vitals update and sites that load slowly will lose position. This is not optional — it directly affects where you show up in search results.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <a href="https://pagespeed.web.dev/" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-testid="link-pagespeed">
                      <Gauge className="h-5 w-5 text-orange-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Google PageSpeed Insights</p>
                        <p className="text-xs text-muted-foreground">Check your speed score, SEO issues, and Core Web Vitals. This is the tool Google uses to grade your site.</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                    </a>
                    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                      <Zap className="h-5 w-5 text-yellow-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">NitroPack</p>
                        <p className="text-xs text-muted-foreground">A performance optimization tool that handles caching, image compression, and code minification automatically to boost page speed scores.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-purple-500" />
                    Tracking & Analytics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Install tracking tools on your website so you can see exactly where your traffic is coming from, what visitors are doing, and which pages perform best. This data is essential for making informed decisions about your marketing.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                      <BarChart3 className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">Google Analytics</p>
                        <p className="text-xs text-muted-foreground">Track visitor behavior, traffic sources, conversions, and user demographics. Essential for understanding how people find and use your site.</p>
                      </div>
                    </div>
                    <a href="https://www.tracemyip.org/" target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-testid="link-tracemyip">
                      <Eye className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">IP Tracker Tools</p>
                        <p className="text-xs text-muted-foreground">Tools like TraceMyIP.org let you track individual visitor behavior, see exactly where traffic is coming from, and monitor user activity on your site in real-time.</p>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    </a>
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
                    <Lightbulb className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Tools like <strong>Ahrefs</strong> and <strong>Semrush</strong> are highly recommended for tracking your organic keywords, monitoring your backlink profile, analyzing competitors, and finding ranking opportunities. These are industry-standard tools used by serious SEO professionals.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-teal-500" />
                    Backlinks & Link Building
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Link building is one of the most important factors for SEO page rank. Backlinks tell Google that other sites trust your content. But not all backlinks are equal — quality matters far more than quantity.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border bg-green-500/5 border-green-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400">Good Backlinks</p>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>DR/DA of 30 or higher</li>
                        <li>Relevant industry sites</li>
                        <li>Guest posts on real blogs</li>
                        <li>Local business directories</li>
                        <li>Press releases (PBNs)</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-red-500/5 border-red-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Ban className="h-4 w-4 text-red-500" />
                        <p className="text-xs font-semibold text-red-700 dark:text-red-400">Bad Backlinks</p>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>Fiverr spam packages</li>
                        <li>Links from low DR/DA sites</li>
                        <li>Irrelevant foreign sites</li>
                        <li>Link farms and PBN spam</li>
                        <li>Same anchor text repeatedly</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-blue-500/5 border-blue-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-blue-500" />
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">Best Practices</p>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>Aim for 75% quality / 25% other</li>
                        <li>Vary your anchor text</li>
                        <li>Build links gradually</li>
                        <li>Mix dofollow & nofollow</li>
                        <li>Monitor with Ahrefs/Semrush</li>
                      </ul>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/10">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><strong>Guest Posts:</strong> Writing guest posts on relevant industry blogs is a great way to build quality backlinks. But avoid using the same keywords across all your guest posts — Google will notice the pattern and it can look manipulative.</p>
                      <p><strong>PBNs / Press Releases:</strong> Press release networks and news announcements can generate powerful, high-authority backlinks. These can be very effective but also expensive. Think of them as a big news push for launches, milestones, or major projects.</p>
                    </div>
                  </div>

                  <Card className="border-red-500/30 bg-red-500/5">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Ban className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-red-600 dark:text-red-400 mb-1">Avoid Buying Backlinks on Fiverr</p>
                          <p className="text-xs text-muted-foreground">
                            Cheap backlink packages on platforms like Fiverr are almost always spam. These sellers blast your URL across low-quality sites, link farms, and irrelevant directories. Google's algorithm detects this and your site will get de-ranked. If your backlink profile is mostly spam, you will lose your rankings — and recovering from a penalty is extremely difficult.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PenTool className="h-5 w-5 text-indigo-500" />
                    Content Strategy That Actually Ranks
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Content is what Google reads to understand what your business does and where you do it. Without content, you're invisible. But the wrong content strategy will waste months of effort. Here's what actually works for contractors.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-indigo-500" /> Service Pages</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> One dedicated page per service (roofing, siding, windows, etc.)</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Include process details, materials used, and expected timelines</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Add before/after photos with proper alt text</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Include FAQ sections targeting "how much does X cost" queries</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-indigo-500" /> Location Pages</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Create unique pages for every city and neighborhood you serve</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Reference local landmarks, neighborhoods, and community details</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Include photos from actual projects in that area</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Never copy-paste the same content across location pages</li>
                      </ul>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5 text-indigo-500" /> Blog & Guide Content</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Write guides answering real customer questions: "How long does a roof last?"</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Comparison posts: "Standing seam vs architectural shingles"</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Case studies from real projects with cost breakdowns</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Post consistently — at least 2-4 articles per month</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-red-500/5 border-red-500/20">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-red-600 dark:text-red-400"><Ban className="h-3.5 w-3.5" /> Content Mistakes That Kill Rankings</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" /> Using AI to generate all your content — Google detects it</li>
                        <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" /> Copy-pasting competitor content or spinning articles</li>
                        <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" /> Publishing thin pages with less than 300 words</li>
                        <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" /> Keyword stuffing — repeating the same phrase 20 times</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Code className="h-5 w-5 text-cyan-500" />
                    Schema Markup & Structured Data
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Schema markup is code you add to your website that tells Google exactly what your business is, what services you offer, and where you're located. It's how you get rich results in search — star ratings, service lists, business hours, and more showing up directly in Google.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border bg-cyan-500/5 border-cyan-500/20">
                      <p className="text-xs font-semibold mb-1 text-cyan-700 dark:text-cyan-400">LocalBusiness Schema</p>
                      <p className="text-xs text-muted-foreground">Business name, address, phone, hours, service area, and geo coordinates. This is the foundation — every contractor site needs it.</p>
                    </div>
                    <div className="p-3 rounded-lg border bg-cyan-500/5 border-cyan-500/20">
                      <p className="text-xs font-semibold mb-1 text-cyan-700 dark:text-cyan-400">Service Schema</p>
                      <p className="text-xs text-muted-foreground">Define each service with descriptions, price ranges, and service areas. Helps Google match your pages to specific service queries.</p>
                    </div>
                    <div className="p-3 rounded-lg border bg-cyan-500/5 border-cyan-500/20">
                      <p className="text-xs font-semibold mb-1 text-cyan-700 dark:text-cyan-400">Review & FAQ Schema</p>
                      <p className="text-xs text-muted-foreground">Embed review data and FAQ answers directly in search results. This takes up more space in Google and increases click-through rates.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/10">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Use Google's <strong>Rich Results Test</strong> tool to validate your schema markup. If your schema has errors, Google will ignore it entirely. Most WordPress SEO plugins like Yoast or RankMath can generate basic schema automatically, but you'll want to customize it for contractor-specific services.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-pink-500" />
                    Mobile-First Design & User Experience
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Over 70% of contractor website traffic comes from mobile devices. Google uses mobile-first indexing, meaning it ranks your site based on the mobile version. If your site doesn't work well on phones, you're losing both rankings and customers.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2">Mobile Must-Haves</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Click-to-call button visible on every page</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Fast load time — under 3 seconds on mobile networks</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Large tap targets — buttons at least 48px tall</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Readable text without zooming — 16px minimum font size</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Sticky header or floating CTA button for easy contact</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2">Conversion Optimization</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" /> Contact form above the fold on every service page</li>
                        <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" /> Social proof near CTAs — review count, star rating, years in business</li>
                        <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" /> Simple forms — name, phone, zip code, service needed (4 fields max)</li>
                        <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" /> Urgency elements — "Free estimates this week" or "Limited availability"</li>
                        <li className="flex items-start gap-1.5"><MousePointer className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" /> Trust badges — BBB, manufacturer certifications, insurance logos</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Share2 className="h-5 w-5 text-blue-600" />
                    Social Media & Reputation Building
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Social media won't directly rank your website, but it builds brand recognition, drives referral traffic, and signals to Google that your business is active and legitimate. For contractors, the key platforms are Facebook, Instagram, YouTube, and NextDoor.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { platform: "Facebook", tip: "Post project updates, before/after photos, and customer testimonials. Join local community groups and participate without being salesy. Run targeted ads to homeowners within your service radius." },
                      { platform: "Instagram", tip: "Visual platform perfect for construction. Post project progress photos, time-lapse videos, and finished work. Use local hashtags and location tags. Stories and Reels get more reach than static posts." },
                      { platform: "YouTube", tip: "Create walkthrough videos of completed projects, how-to guides, and behind-the-scenes content. YouTube is the #2 search engine — your videos can rank for contractor-related queries." },
                      { platform: "NextDoor", tip: "Claim your business page. Neighbors recommend contractors here constantly. Respond to recommendation requests in your area. This is hyperlocal and high-intent traffic." },
                    ].map((item, i) => (
                      <div key={i} className="p-3 rounded-lg border bg-muted/30">
                        <p className="text-xs font-semibold mb-1">{item.platform}</p>
                        <p className="text-xs text-muted-foreground">{item.tip}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
                    <Lightbulb className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <strong>Pro Tip:</strong> Don't spread yourself thin across every platform. Pick 2 and do them well. Facebook + Google Business Profile posting is the minimum. Add Instagram or YouTube if you have the bandwidth.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Mail className="h-5 w-5 text-emerald-500" />
                    Email Marketing & Follow-Up Systems
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Most contractors completely ignore email marketing, which means it's a huge opportunity. Not every lead is ready to buy today — a follow-up system keeps you top of mind when they're ready. This is especially powerful for seasonal services.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
                      <p className="text-xs font-semibold mb-1 text-emerald-700 dark:text-emerald-400">Lead Follow-Up Sequence</p>
                      <p className="text-xs text-muted-foreground">Set up automated emails after someone fills out your contact form. Day 1: confirmation. Day 3: case study. Day 7: special offer. Day 14: check-in.</p>
                    </div>
                    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
                      <p className="text-xs font-semibold mb-1 text-emerald-700 dark:text-emerald-400">Seasonal Campaigns</p>
                      <p className="text-xs text-muted-foreground">Send seasonal reminders: spring gutter cleaning, fall roof inspections, winter prep, etc. These are high-conversion emails because they're timely and relevant.</p>
                    </div>
                    <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20">
                      <p className="text-xs font-semibold mb-1 text-emerald-700 dark:text-emerald-400">Past Customer Nurture</p>
                      <p className="text-xs text-muted-foreground">Stay in touch with completed customers. They're your best source of referrals and repeat business. Quarterly newsletters with maintenance tips work great.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-rose-500" />
                    Google Ads & Local Service Ads (LSA)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Paid advertising gets you immediate visibility while your SEO builds over time. For contractors, Google Ads and Local Service Ads are the two most effective paid channels. Here's how they differ and when to use each.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-blue-500" /> Google Search Ads</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Target specific keywords: "roof repair near me," "siding contractor [city]"</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Set geographic targeting to your exact service radius</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Use negative keywords to filter out DIY and job-seeker clicks</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Start with $500-$1,500/month and scale based on ROI</li>
                      </ul>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/30">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5 text-green-500" /> Local Service Ads (Google Guaranteed)</p>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Pay per lead, not per click — only charged for actual phone calls/messages</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Google Guaranteed badge builds instant trust with consumers</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Shows above regular ads — top of search results</li>
                        <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Requires background check and license/insurance verification</li>
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/10">
                    <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      <strong>Budget Strategy:</strong> Run LSA as your primary paid channel (it's cheaper per lead for most trades). Layer in Google Search Ads for keywords that LSA doesn't cover. Track every lead source so you know your actual cost per customer acquisition — not just cost per click.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-[#F97316]/20 bg-gradient-to-r from-[#F97316]/5 to-transparent">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Send className="h-5 w-5 text-[#F97316]" />
                    Need Help With Any of These Services?
                  </CardTitle>
                  <CardDescription>
                    Whether you need help with link building, SEO audits, page speed optimization, Google Search Console setup, or content creation — we offer all of these services. Fill out the form below and we'll get back to you.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="seo-name">Full Name</Label>
                      <Input id="seo-name" placeholder="Your name" value={seoName} onChange={(e) => setSeoName(e.target.value)} data-testid="input-seo-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="seo-email">Email</Label>
                      <Input id="seo-email" type="email" placeholder="you@company.com" value={seoEmail} onChange={(e) => setSeoEmail(e.target.value)} data-testid="input-seo-email" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="seo-phone">Phone</Label>
                      <Input id="seo-phone" type="tel" placeholder="(555) 123-4567" value={seoPhone} onChange={(e) => setSeoPhone(e.target.value)} data-testid="input-seo-phone" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="seo-website">Website URL</Label>
                      <Input id="seo-website" placeholder="https://yoursite.com" value={seoWebsite} onChange={(e) => setSeoWebsite(e.target.value)} data-testid="input-seo-website" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Services Interested In</Label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Link Building", "Guest Posts", "Press Releases / PBNs", "SEO Audit",
                        "Page Speed Optimization", "Google Search Console Setup", "Google Analytics Setup",
                        "Content Writing", "Website Design", "Local SEO", "Backlink Cleanup"
                      ].map(service => (
                        <Badge
                          key={service}
                          variant={seoServices.includes(service) ? "default" : "outline"}
                          className={`cursor-pointer transition-colors ${seoServices.includes(service) ? "bg-[#4A6CF7]" : "hover:bg-muted"}`}
                          onClick={() => toggleSeoService(service)}
                          data-testid={`badge-service-${service.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          {service}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="seo-message">Tell Us About Your Project</Label>
                    <Textarea
                      id="seo-message"
                      placeholder="Describe what you need help with, your current situation, goals, and any specific concerns..."
                      value={seoMessage}
                      onChange={(e) => setSeoMessage(e.target.value)}
                      rows={4}
                      data-testid="textarea-seo-message"
                    />
                  </div>

                  <Button
                    className="bg-[#F97316] hover:bg-[#E86C0A] text-white"
                    data-testid="button-submit-seo-inquiry"
                    disabled={seoInquiryMutation.isPending || !seoName || !seoEmail}
                    onClick={() => seoInquiryMutation.mutate({ name: seoName, email: seoEmail, phone: seoPhone, website: seoWebsite, services: seoServices, message: seoMessage })}
                  >
                    {seoInquiryMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    Submit Inquiry
                  </Button>
                </CardContent>
              </Card>
            </div>
            )}
          </TabsContent>

          <TabsContent value="vetting" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
            <Card className="border-red-500/20 bg-gradient-to-r from-red-500/5 to-transparent">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                    <ShieldAlert className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-xl font-bold flex items-center gap-2 flex-wrap">
                      19 Essential Tips for Vetting a Contractor
                      {!isTabUnlocked("vetting") && <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600"><Lock className="h-3 w-3" /> Locked</Badge>}
                    </h2>
                    <p className="text-sm text-muted-foreground">Don't fake it till you make it — build a legit brand the right way</p>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  The construction industry has been flooded with new companies across every sector. This guide helps homeowners identify red flags and helps legitimate contractors understand what NOT to do when building their brand. These tips apply industry-wide — roofing, siding, general contracting, plumbing, electrical, and more.
                </p>
                {!isTabUnlocked("vetting") && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-4">
                    {[
                      { num: 1, icon: UserX, text: "False Claims of Affiliation" },
                      { num: 2, icon: Clock, text: "Experience Can't Be Faked" },
                      { num: 3, icon: FileText, text: "The Permitting Loophole" },
                      { num: 4, icon: Award, text: "Manufacturer Programs (Diluted)" },
                      { num: 5, icon: Receipt, text: "Vanishing Estimates" },
                      { num: 6, icon: Truck, text: "The Illusion of Size" },
                      { num: 7, icon: CircleDollarSign, text: "Lower Price ≠ Equal Service" },
                      { num: 8, icon: ThumbsDown, text: "Badmouthing Veterans" },
                      { num: 9, icon: Shield, text: "Licensed ≠ Legitimate" },
                      { num: 10, icon: Globe, text: "Web Presence ≠ Legitimacy" },
                      { num: 11, icon: Phone, text: "Unsolicited Calls = Lead Gen" },
                      { num: 12, icon: BadgeCheck, text: "Warranty Is Key" },
                      { num: 13, icon: Building, text: "Physical Office Verification" },
                      { num: 14, icon: Search, text: "BBB & Online Credibility" },
                      { num: 15, icon: Handshake, text: "Fabricated Accomplishments" },
                      { num: 16, icon: Star, text: "Referrals & Fake Reviews" },
                      { num: 17, icon: Eye, text: "Credibility Fabrication" },
                      { num: 18, icon: DollarSign, text: "Financing Scams" },
                      { num: 19, icon: AlertTriangle, text: "Too-Good-To-Be-True Pricing" },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded border bg-muted/30">
                        <div className="w-5 h-5 rounded-full bg-red-500/10 flex items-center justify-center text-[10px] font-bold text-red-500 shrink-0">{item.num}</div>
                        <item.icon className="h-3 w-3 text-red-400 shrink-0" />
                        {item.text}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isTabUnlocked("vetting") ? (
              <PaywallOverlay tabName="Vetting Contractors" onGoToPricing={() => setActiveTab("pricing")} />
            ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <Card data-testid="card-vetting-tip-1">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">1</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <UserX className="h-4 w-4 text-red-500" /> False Claims of Affiliation
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Some companies falsely claim to have worked for or been affiliated with established brands to gain credibility they haven't earned. They use misleading language like "partnered with" or "worked alongside" when no real connection exists.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">How to Protect Yourself:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Ask for proof of any claimed affiliations — documentation, references</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Verify directly with the company they claim to be affiliated with</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Be aware that AI can fabricate photos, documents, and endorsements</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-2">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">2</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-red-500" /> Experience Can't Be Faked
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        How long a company has been in business is one of the strongest indicators of reliability. Watch out for the "combined experience" trick — adding up individual employee years to inflate the company's track record.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Red Flags:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> "Combined years of experience" claims (e.g., "Joe 3yr + Phil 4yr = 7 years!")</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Taking credit for a hired employee's prior experience</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Cross-reference their claims with BBB and state licensing records</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-3">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">3</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-red-500" /> The Permitting Loophole
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Many counties have no permitting requirements for certain work (siding, windows, doors). This creates a massive loophole allowing unqualified contractors to operate without oversight. No inspection means no accountability.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Protect Yourself:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Ask for active jobs in the area — established companies always have them</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Demand industry-standard installation practices regardless of permit requirements</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Consider hiring a third-party inspector if permits aren't required</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-4">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">4</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Award className="h-4 w-4 text-red-500" /> Manufacturer Programs (Diluted Standards)
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Programs like James Hardie Elite used to require 36 full re-siding projects per year. Now it's just 10, and partial jobs as small as 150 sq ft qualify. Verification has been minimized. Don't rely on these badges alone.
                      </p>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          Manufacturer certifications that once meant something may now be easily obtained. Always verify a company's actual project history — not just their badges.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-5">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">5</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-red-500" /> Vanishing Estimates
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Some contractors send estimates via links that later disappear. If they can delete an estimate, they can alter a contract. This is a massive red flag for accountability.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Always:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Request a downloadable PDF or printed copy of every estimate</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> If a company only provides a disappearing link, walk away</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Keep copies of all signed contracts independently</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-6">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">6</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Truck className="h-4 w-4 text-red-500" /> The Illusion of Size
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Some companies use branded trucks, slick websites, and multiple Google listings to look like large operations. In reality, they may be a single-person company using virtual addresses and PO boxes. They hide behind titles like "project manager" or "estimator" when they're the sole operator.
                      </p>
                      <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3">
                        <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          If something goes wrong, these companies often vanish with your money or fail to fix their mistakes, leaving you with zero accountability.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-7">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">7</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <CircleDollarSign className="h-4 w-4 text-red-500" /> Lower Price ≠ Equal Service
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Comparing a 20-year company with staff and offices to a 1-year company working from a pickup truck is not "apples to apples." Established companies anticipate structural issues. New companies discover them mid-project — costing you more.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Real Risks of Cheap Bids:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> No workers' comp — if an employee is injured on your property, YOU could be sued</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Insurance may not cover defective work or wrong materials</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> A $6K contractor bond won't cover your legal fees</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-8">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">8</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <ThumbsDown className="h-4 w-4 text-red-500" /> New Companies Badmouthing Veterans
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        It's a major red flag when a company tears down competitors instead of building its own reputation. Claims like "I used to work for them and they're terrible" are often manipulation tactics. Companies that succeed on merit don't need to badmouth others.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 text-[#4A6CF7] shrink-0 mt-0.5" />
                          A company that actively works to tear down others rather than build up their own reputation likely doesn't have the skills or track record to succeed on merit alone.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-9">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">9</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Shield className="h-4 w-4 text-red-500" /> Licensed ≠ Legitimate
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        In many states (like Washington), getting a contractor's license just means paying $65, getting a $300/year bond, and $100/month insurance. No experience required. No testing. States like California require 4 years experience + exams. Know your state's requirements.
                      </p>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          A license is just a minimum legal requirement — not proof of skill, experience, or quality workmanship. Use the State Guide tab to check your state's licensing requirements.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-10">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">10</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Globe className="h-4 w-4 text-red-500" /> Web Presence ≠ Legitimacy
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        High Google rankings can be bought through marketing firms. A polished website with customer reviews, ads, and "10 years in business" claims means nothing without verification. Many companies pay to manipulate their online positions.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 text-[#4A6CF7] shrink-0 mt-0.5" />
                          Use the BS Meter in Competitor Intelligence to analyze any company's Google reviews for fake patterns, AI-generated content, and suspicious review velocity.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-11">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">11</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Phone className="h-4 w-4 text-red-500" /> Unsolicited Calls = Lead Gen
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        If a company calls you out of the blue, your information was likely sold through a lead generation form. These companies buy leads in bulk and often lack the experience to deliver quality work. Only engage with companies you've researched yourself.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-12">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">12</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <BadgeCheck className="h-4 w-4 text-red-500" /> Warranty Is Key
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Companies offering 1-2 year warranties don't want to be held accountable. But beware the opposite too — a company in business for 2 years offering a 10-year warranty is a red flag. Always ask how long they've been operating before trusting a warranty promise.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 text-[#4A6CF7] shrink-0 mt-0.5" />
                          The warranty is the best indicator of a company's commitment to their work and customers. A company can't honor a 15-year warranty if they've only existed for 3.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-13">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">13</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Building className="h-4 w-4 text-red-500" /> Physical Office Verification
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Schedule a meeting at their office. A legitimate company will have a physical space, showroom, or office. Ask how many employees they have. Verify the address on Google Maps — many scam companies use PO boxes, storage units, or random warehouses as false addresses.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Check for:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Real office or showroom (not a PO box, Suite #, or storage unit)</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Actual staff — customer service, project managers</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Drive by the address if you're unsure</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-14">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">14</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Search className="h-4 w-4 text-red-500" /> BBB & Online Credibility
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Check the Better Business Bureau (BBB). It reveals the owner's name, complaints history, and accreditation status. If a company doesn't have an A+ and isn't accredited, they're either very new or have unresolved complaints.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs font-medium mb-1">BBB checks reveal:</p>
                        <p className="text-xs text-muted-foreground">Owner identity and age, years in business, complaint history, accreditation status, and whether complaints were resolved or ignored.</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-15">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">15</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Handshake className="h-4 w-4 text-red-500" /> Fabricated Accomplishments
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Some companies subcontract work and present it as their own. They leverage established brand names by falsely claiming affiliation or insider knowledge. When encountering such claims, question the integrity of the source.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Common Fabrication Tactics:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Displaying project photos from other companies as their own work</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Claiming "trained by" or "formerly with" established companies without proof</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Listing subcontracted projects as direct company accomplishments</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Ask for job site addresses you can drive by and verify in person</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-16">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">16</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Star className="h-4 w-4 text-red-500" /> Referrals & Fake Reviews
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Don't just trust online reviews — ask for 5-10 verified addresses as references. Many new companies have 80-90% of reviews from family or friends. Watch for reviews duplicated across 3-4 platforms (real customers rarely post on multiple sites). Check suspicious usernames.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Cross-reference reviews on:</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {["Google", "Yelp", "BBB", "Houzz", "Angi", "GuildQuality", "Networx"].map(site => (
                            <Badge key={site} variant="outline" className="text-[10px]">{site}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-17">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">17</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Eye className="h-4 w-4 text-red-500" /> Fabrication of Credibility
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Companies create dozens of online profiles across Houzz, Thumbtack, YouTube, Facebook, and more. They duplicate competitor content, steal branding colors and logos, and display vendor logos they have no real partnership with. They acquire credentials to emulate successful local companies.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                        <p className="text-xs font-medium">Signs of Fabricated Credibility:</p>
                        <ul className="text-xs text-muted-foreground space-y-1">
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Website design, colors, or layout that closely mimics a well-known local competitor</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Displaying manufacturer logos without being an actual certified installer</li>
                          <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" /> Having profiles on 15+ platforms but only 6 months in business</li>
                          <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" /> Verify certifications directly with the manufacturer's installer lookup tool</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-18">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">18</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <CircleDollarSign className="h-4 w-4 text-red-500" /> Real Financing vs. 3rd Party Referrals
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Legitimate in-house financing requires years of established operations, solid financial stability, and significant revenue (millions). Many new companies claim to offer financing but actually just partner with obscure third-party vendors for referral commissions.
                      </p>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-md p-3">
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          If a company offers financing but has been in business less than 5 years, chances are it's a third-party referral program — not real in-house financing.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-vetting-tip-19">
                <CardContent className="p-3 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-sm font-bold text-red-500 shrink-0">19</div>
                    <div>
                      <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                        <Home className="h-4 w-4 text-red-500" /> Too-Good-to-Be-True Prices
                      </h3>
                      <p className="text-sm text-muted-foreground mb-2">
                        Low bids mean the company is cutting costs — unskilled labor, no insurance, no overhead. When you pay a higher price, you're investing in experience and a company that has already overcome the hurdles of running a business. Lack of experience often results in redoing the job entirely.
                      </p>
                      <div className="bg-muted/50 rounded-md p-3">
                        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <Lightbulb className="h-3 w-3 text-[#4A6CF7] shrink-0 mt-0.5" />
                          Find the middle ground. The cheapest option often leads to the most expensive outcome — incorrect products, project delays, and lawsuits with insurance that doesn't cover the work.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-[#4A6CF7]/20 bg-[#4A6CF7]/5">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-start gap-3 mb-3 sm:mb-4">
                  <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-[#4A6CF7] shrink-0 mt-0.5" />
                  <h3 className="text-base sm:text-lg font-bold">Building a Legit Brand — The Right Way</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  For contractors building their own business: don't try to fake it till you make it. It usually never ends well. The construction industry rewards authenticity and punishes shortcuts. Here's the honest path to a credible brand that lasts:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {[
                    { icon: Clock, text: "Build real experience over time — there are no shortcuts to expertise. Do the work, document every project, and let your portfolio speak for itself." },
                    { icon: Star, text: "Earn reviews organically from real customers — never buy or fabricate them. One honest 4-star review is worth more than ten fake 5-star reviews." },
                    { icon: FileText, text: "Keep permanent records of all estimates, contracts, change orders, and communications. This protects you legally and builds a professional reputation." },
                    { icon: Heart, text: "Carry proper insurance and workers' comp — it protects everyone. Cutting corners on coverage puts your customers, your employees, and your personal assets at risk." },
                    { icon: Building, text: "Establish a real physical presence — office, showroom, or shop. A real address shows permanence and gives customers confidence you'll be around to honor warranties." },
                    { icon: Shield, text: "Stand behind your warranty with real history to back it up. Only promise warranty periods that your company has actually been in business long enough to fulfill." },
                    { icon: Users, text: "Compete on merit — never tear down others to build yourself up. The best companies focus on their own strengths rather than attacking competitors." },
                    { icon: Scale, text: "Be transparent about your company's actual age and experience. Honesty about where you are in your journey builds more trust than inflated claims." },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <item.icon className="h-4 w-4 text-[#4A6CF7] shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{item.text}</span>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg border bg-background/60">
                  <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-[#4A6CF7]" /> The Bottom Line
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Every established company in your market started exactly where you are. The difference between the ones that made it and the ones that didn't is simple: the successful ones built their reputation on real work, real customers, and real results. They didn't cut corners on insurance, they didn't fake reviews, and they didn't pretend to be bigger than they were. They earned every star, every referral, and every repeat customer. That's the path — and it works.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-bold mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Homeowner's Quick Vetting Checklist
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Use this checklist before signing any contract. If a company can't satisfy most of these, keep looking.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    "Verify contractor license with your state's licensing board",
                    "Confirm active general liability insurance (get certificate)",
                    "Confirm workers compensation coverage (get certificate)",
                    "Check BBB rating, accreditation status, and complaint history",
                    "Ask for 5-10 recent project addresses you can drive by",
                    "Request a physical office visit or showroom tour",
                    "Get a downloadable PDF estimate (not a disappearing link)",
                    "Ask how long the company has been in business under this name",
                    "Cross-reference Google reviews on Yelp, BBB, and Houzz",
                    "Verify manufacturer certifications directly with the manufacturer",
                    "Ask about their warranty terms relative to years in business",
                    "Confirm they pull permits when required by your jurisdiction",
                    "Ask for proof of employees (not just subcontractors)",
                    "Check if financing is in-house or a third-party referral",
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground p-2 rounded border bg-background/60">
                      <div className="w-4 h-4 rounded border-2 border-green-500/40 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            </>
            )}
          </TabsContent>

          <TabsContent value="pricing" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
            <div className="text-center max-w-2xl mx-auto mb-4 sm:mb-8">
              <Badge className="bg-red-600 text-white text-xs sm:text-sm px-3 py-1 mb-3 animate-pulse">50% OFF — Limited Time Offer</Badge>
              <h2 className="text-xl sm:text-2xl font-bold mb-2">Master Class Courses</h2>
              <p className="text-muted-foreground">
                Go from zero to a fully operational, online-dominant construction business. Each module walks you through every detail with step-by-step instructions, direct links to every resource, and real-world strategies that actually work.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {modules?.map((mod) => {
                const ModIcon = MODULE_ICONS[mod.category] || BookOpen;
                const gradientClass = MODULE_COLORS[mod.category] || "from-gray-600 to-gray-800";
                const isPurchased = hasBundle || purchasedModuleIds.has(mod.id);
                return (
                  <Card key={mod.id} className={`overflow-hidden ${isPurchased ? "ring-2 ring-green-500/50" : ""}`} data-testid={`card-module-${mod.category}`}>
                    <div className={`bg-gradient-to-r ${gradientClass} p-4 sm:p-6 text-white relative`}>
                      {isPurchased && (
                        <Badge className="absolute top-3 right-3 bg-green-600 text-white gap-1" data-testid={`badge-purchased-${mod.category}`}>
                          <CheckCircle2 className="h-3 w-3" /> Purchased
                        </Badge>
                      )}
                      <ModIcon className="h-8 w-8 mb-3 opacity-80" />
                      <h3 className="text-lg font-bold">{mod.title}</h3>
                      <div className="flex items-baseline gap-1 mt-2">
                        <span className="text-2xl sm:text-3xl font-bold">${(mod.price / 100).toLocaleString()}</span>
                        <span className="text-xs sm:text-sm opacity-70">one-time</span>
                      </div>
                    </div>
                    <CardContent className="p-3 sm:p-5">
                      <p className="text-sm text-muted-foreground mb-4">{mod.description}</p>
                      {mod.features && (
                        <ul className="space-y-2">
                          {mod.features.map((feat, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {isPurchased ? (
                        <Button
                          className="w-full mt-5 bg-green-600 hover:bg-green-700"
                          disabled
                          data-testid={`button-enrolled-${mod.category}`}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Enrolled
                        </Button>
                      ) : (
                        <div className="flex gap-2 mt-5">
                          <Button
                            className={`flex-1 ${isInCart(`course_module_${mod.id}`) ? "bg-green-600 hover:bg-green-600" : ""}`}
                            variant={isInCart(`course_module_${mod.id}`) ? "default" : "outline"}
                            disabled={isInCart(`course_module_${mod.id}`)}
                            onClick={() => {
                              addItem({
                                id: `course_module_${mod.id}`,
                                type: "course_module",
                                name: `Master Class — ${mod.title}`,
                                price: mod.price,
                                description: mod.description,
                                moduleId: mod.id,
                              });
                              toast({ title: "Added to cart", description: `${mod.title} has been added to your cart.` });
                            }}
                            data-testid={`button-add-cart-${mod.category}`}
                          >
                            {isInCart(`course_module_${mod.id}`) ? (
                              <><CheckCircle2 className="h-4 w-4 mr-1" /> In Cart</>
                            ) : (
                              <><ShoppingCart className="h-4 w-4 mr-1" /> Add to Cart</>
                            )}
                          </Button>
                          <Button
                            className="bg-[#4A6CF7] hover:bg-[#3B5CE5]"
                            data-testid={`button-enroll-${mod.category}`}
                            onClick={() => enrollMutation.mutate({ moduleId: mod.id })}
                            disabled={enrollMutation.isPending}
                          >
                            {enrollMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                            Buy Now
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className={`border-[#F97316]/30 bg-gradient-to-br from-[#F97316]/10 via-[#F97316]/5 to-transparent overflow-hidden relative ${hasBundle ? "ring-2 ring-green-500/50" : ""}`}>
              <div className="absolute top-3 right-3">
                <Badge className="bg-red-600 text-white text-xs px-2 py-0.5">BEST VALUE</Badge>
              </div>
              <CardContent className="p-4 sm:p-6 text-center">
                <Star className="h-8 w-8 text-[#F97316] mx-auto mb-3" />
                <h3 className="text-lg sm:text-xl font-bold mb-2">Complete Master Class Bundle — 50% Off</h3>
                <p className="text-muted-foreground text-sm mb-4 max-w-lg mx-auto">
                  Get all four modules at half price. The complete system — from forming your business to dominating local search. Built by owners who scaled from solo operators to hundreds of employees.
                </p>
                <div className="flex items-center justify-center gap-3 mb-2">
                  <span className="text-xl sm:text-2xl font-bold text-muted-foreground line-through">$4,999</span>
                  <span className="text-2xl sm:text-3xl font-bold text-[#F97316]">$2,499</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">Save $2,500 — individual modules total $6,500 purchased separately</p>
                {hasBundle ? (
                  <Button size="lg" className="bg-green-600 hover:bg-green-700 text-white" disabled data-testid="button-enrolled-bundle">
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Bundle Purchased
                  </Button>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      size="lg"
                      className={isInCart("course_bundle") ? "bg-green-600 hover:bg-green-600 text-white" : ""}
                      variant={isInCart("course_bundle") ? "default" : "outline"}
                      disabled={isInCart("course_bundle")}
                      onClick={() => {
                        addItem({
                          id: "course_bundle",
                          type: "course_bundle",
                          name: "Master Class — Complete Bundle (50% Off)",
                          price: 249900,
                          description: "All four modules at half price — licensing, GMB, website & SEO",
                        });
                        toast({ title: "Added to cart", description: "Master Class Bundle has been added to your cart." });
                      }}
                      data-testid="button-add-cart-bundle"
                    >
                      {isInCart("course_bundle") ? (
                        <><CheckCircle2 className="h-4 w-4 mr-2" /> In Cart</>
                      ) : (
                        <><ShoppingCart className="h-4 w-4 mr-2" /> Add to Cart</>
                      )}
                    </Button>
                    <Button
                      size="lg"
                      className="bg-[#F97316] hover:bg-[#E86C0A] text-white"
                      data-testid="button-enroll-bundle"
                      onClick={() => enrollMutation.mutate({ bundle: true })}
                      disabled={enrollMutation.isPending}
                    >
                      {enrollMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      Buy Now — $2,499
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardContent className="p-4 sm:p-6">
                <h3 className="text-base font-bold mb-3 text-center">What You're Getting for $2,499</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { value: "$1,500", label: "Business Formation & Licensing", desc: "All 50 states covered" },
                    { value: "$2,000", label: "GMB Setup & Optimization", desc: "Dominate local search" },
                    { value: "$1,500", label: "Website & Online Presence", desc: "Convert visitors to customers" },
                    { value: "$1,500", label: "SEO & Directory Domination", desc: "Get found everywhere" },
                    { value: "Free", label: "Vetting Contractors Guide", desc: "19 essential tips included" },
                    { value: "Free", label: "Lifetime Access & Updates", desc: "Content updated regularly" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold ${item.value === "Free" ? "text-green-500" : "text-[#4A6CF7]"}`}>{item.value}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-center mt-4 pt-4 border-t">
                  <p className="text-sm text-muted-foreground">Total individual value: <span className="font-bold line-through">$6,500</span></p>
                  <p className="text-lg font-bold text-[#F97316]">Your price today: $2,499</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardContent className="p-4 sm:p-6">
                <h3 className="text-base font-bold mb-3 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-[#4A6CF7]" />
                  Frequently Asked Questions
                </h3>
                <div className="space-y-3">
                  {[
                    { q: "Is this course right for someone just starting out?", a: "Absolutely. It's designed to take you from zero to fully operational in your state. Built by owners who started from scratch themselves." },
                    { q: "I already have a business. Is this still worth it?", a: "Yes. Most established contractors are leaving money on the table with their online presence. The marketing and SEO modules alone can transform your lead generation." },
                    { q: "Do I get access to all modules at once with the bundle?", a: "Yes. When you purchase the bundle, everything unlocks immediately. You get lifetime access to all content and future updates." },
                    { q: "Is this specific to my state?", a: "Yes. The course covers all 50 states with state-specific guidance. Requirements vary widely — we've mapped them all." },
                    { q: "Can I purchase individual modules instead?", a: "Yes, you can buy any module separately. But the bundle saves you over $4,000 compared to buying individually." },
                    { q: "Who created this course?", a: "Several construction company owners who scaled from solo owner-operators to running multi-state operations with hundreds of employees. Real-world experience, not theory from consultants." },
                  ].map((item, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-background/60">
                      <p className="text-sm font-medium mb-1">{item.q}</p>
                      <p className="text-xs text-muted-foreground">{item.a}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}