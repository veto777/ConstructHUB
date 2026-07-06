import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check, X, Fingerprint, ShieldOff, Shield, BarChart3, Camera, Search,
  Crosshair, ArrowRight, Zap, Star, Crown, Building2, Eye, Bot,
  Globe, TrendingUp, Users, Clock, ChevronDown, ChevronUp,
} from "lucide-react";

interface ToolTier {
  name: string;
  price: number;
  popular?: boolean;
  features: string[];
  limits: Record<string, string | boolean>;
}

interface ToolCategory {
  id: string;
  name: string;
  icon: any;
  color: string;
  buttonColor: string;
  ringColor: string;
  badgeColor: string;
  tagline: string;
  description: string;
  tiers: ToolTier[];
  comparisonFeatures: string[];
}

const TOOLS: ToolCategory[] = [
  {
    id: "ip-tracker",
    name: "IP Tracker",
    icon: Fingerprint,
    color: "text-blue-500",
    buttonColor: "bg-blue-500 hover:bg-blue-600 text-white",
    ringColor: "ring-blue-500/40",
    badgeColor: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    tagline: "Know exactly who visits your website",
    description: "Real-time visitor tracking with device fingerprinting, geo-location, traffic source analysis, and detailed visitor timelines. A modern replacement for TraceMyIP built for contractors.",
    tiers: [
      {
        name: "Starter",
        price: 49,
        features: [
          "1 user only",
          "3 tracked websites",
          "5,000 visits/mo",
          "Real-time visitor tracking",
          "Geo-location (country/city)",
          "Browser & OS detection",
          "7-day data retention",
        ],
        limits: {
          "Users": "1",
          "Tracked Websites": "3",
          "Monthly Visits": "5,000",
          "Real-Time Tracking": true,
          "Geo-Location": true,
          "Device Fingerprinting": false,
          "Traffic Source Analysis": false,
          "Visitor Timelines": false,
          "Page Analytics": false,
          "Platform Breakdown": false,
          "Data Retention": "7 days",
        },
      },
      {
        name: "Pro",
        price: 89,
        popular: true,
        features: [
          "1 user only",
          "10 tracked websites",
          "25,000 visits/mo",
          "Real-time visitor tracking",
          "Device fingerprinting",
          "Traffic source analysis",
          "Visitor activity timelines",
          "Page analytics",
          "30-day data retention",
        ],
        limits: {
          "Users": "1",
          "Tracked Websites": "10",
          "Monthly Visits": "25,000",
          "Real-Time Tracking": true,
          "Geo-Location": true,
          "Device Fingerprinting": true,
          "Traffic Source Analysis": true,
          "Visitor Timelines": true,
          "Page Analytics": true,
          "Platform Breakdown": true,
          "Data Retention": "30 days",
        },
      },
      {
        name: "Elite",
        price: 179,
        features: [
          "1 user only",
          "25 tracked websites",
          "100,000 visits/mo",
          "Everything in Pro",
          "Platform breakdown reports",
          "Priority data processing",
          "90-day data retention",
        ],
        limits: {
          "Users": "1",
          "Tracked Websites": "25",
          "Monthly Visits": "100,000",
          "Real-Time Tracking": true,
          "Geo-Location": true,
          "Device Fingerprinting": true,
          "Traffic Source Analysis": true,
          "Visitor Timelines": true,
          "Page Analytics": true,
          "Platform Breakdown": true,
          "Data Retention": "90 days",
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Tracked Websites", "Monthly Visits", "Real-Time Tracking", "Geo-Location",
      "Device Fingerprinting", "Traffic Source Analysis", "Visitor Timelines",
      "Page Analytics", "Platform Breakdown", "Data Retention",
    ],
  },
  {
    id: "click-guard",
    name: "Google Click Guard",
    icon: Shield,
    color: "text-emerald-500",
    buttonColor: "bg-emerald-500 hover:bg-emerald-600 text-white",
    ringColor: "ring-emerald-500/40",
    badgeColor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    tagline: "Stop competitors from draining your ad budget",
    description: "Detect and block click fraud on your Google Ads campaigns. Automatic IP exclusions, device fingerprinting, VPN detection, and real-time fraud analytics dashboard.",
    tiers: [
      {
        name: "Starter",
        price: 99,
        features: [
          "1 user only",
          "1 protected website",
          "5,000 tracked visits/mo",
          "Click fraud detection",
          "IP fingerprinting",
          "Manual IP blocking",
          "Basic fraud dashboard",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "1",
          "Tracked Visits/mo": "5,000",
          "Click Fraud Detection": true,
          "IP Fingerprinting": true,
          "VPN/Bot Detection": false,
          "Auto IP Exclusion": false,
          "Fraud Analytics Dashboard": "Basic",
          "Traffic Sources Tab": false,
          "Detection Settings": false,
          "Google Ads Sync": false,
        },
      },
      {
        name: "Growth",
        price: 179,
        popular: true,
        features: [
          "1 user only",
          "5 protected websites",
          "25,000 tracked visits/mo",
          "Click fraud detection",
          "VPN & bot detection",
          "Auto Google Ads IP exclusion",
          "Full fraud analytics dashboard",
          "Traffic sources breakdown",
          "Custom detection settings",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "5",
          "Tracked Visits/mo": "25,000",
          "Click Fraud Detection": true,
          "IP Fingerprinting": true,
          "VPN/Bot Detection": true,
          "Auto IP Exclusion": true,
          "Fraud Analytics Dashboard": "Full",
          "Traffic Sources Tab": true,
          "Detection Settings": true,
          "Google Ads Sync": true,
        },
      },
      {
        name: "Elite",
        price: 349,
        features: [
          "1 user only",
          "15 protected websites",
          "100,000 tracked visits/mo",
          "Everything in Growth",
          "Priority fraud processing",
          "Embeddable tracking pixel",
          "Conversion tracking scripts",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "15",
          "Tracked Visits/mo": "100,000",
          "Click Fraud Detection": true,
          "IP Fingerprinting": true,
          "VPN/Bot Detection": true,
          "Auto IP Exclusion": true,
          "Fraud Analytics Dashboard": "Full",
          "Traffic Sources Tab": true,
          "Detection Settings": true,
          "Google Ads Sync": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Protected Websites", "Tracked Visits/mo", "Click Fraud Detection", "IP Fingerprinting",
      "VPN/Bot Detection", "Auto IP Exclusion", "Fraud Analytics Dashboard",
      "Traffic Sources Tab", "Detection Settings", "Google Ads Sync",
    ],
  },
  {
    id: "vpn-shield",
    name: "VPN Shield",
    icon: ShieldOff,
    color: "text-red-500",
    buttonColor: "bg-red-500 hover:bg-red-600 text-white",
    ringColor: "ring-red-500/40",
    badgeColor: "bg-red-500/10 text-red-500 border-red-500/20",
    tagline: "Block anonymous visitors polluting your data",
    description: "Detect and block VPN, proxy, and datacenter traffic from your websites. Protects analytics accuracy and exposes competitors trying to anonymously spy on your site.",
    tiers: [
      {
        name: "Basic",
        price: 39,
        features: [
          "1 user only",
          "1 protected website",
          "VPN/proxy detection",
          "Datacenter IP matching",
          "Log-only mode",
          "Crawler whitelist (Google, Bing)",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "1",
          "VPN/Proxy Detection": true,
          "WebRTC Leak Detection": false,
          "Datacenter IP Matching": true,
          "VPN Provider ID": false,
          "Block Mode": "Log only",
          "Redirect Mode": false,
          "Whitelisted IPs": false,
          "Crawler Whitelist": true,
        },
      },
      {
        name: "Pro",
        price: 79,
        popular: true,
        features: [
          "1 user only",
          "5 protected websites",
          "VPN/proxy detection",
          "WebRTC IP leak detection",
          "VPN provider identification",
          "Block & redirect modes",
          "Custom whitelisted IPs",
          "Crawler whitelist",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "5",
          "VPN/Proxy Detection": true,
          "WebRTC Leak Detection": true,
          "Datacenter IP Matching": true,
          "VPN Provider ID": true,
          "Block Mode": "Block + Redirect",
          "Redirect Mode": true,
          "Whitelisted IPs": true,
          "Crawler Whitelist": true,
        },
      },
      {
        name: "Enterprise",
        price: 149,
        features: [
          "1 user only",
          "15 protected websites",
          "Everything in Pro",
          "Timezone/geo mismatch detection",
          "Browser extension detection",
          "Priority threat processing",
        ],
        limits: {
          "Users": "1",
          "Protected Websites": "15",
          "VPN/Proxy Detection": true,
          "WebRTC Leak Detection": true,
          "Datacenter IP Matching": true,
          "VPN Provider ID": true,
          "Block Mode": "All modes",
          "Redirect Mode": true,
          "Whitelisted IPs": true,
          "Crawler Whitelist": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Protected Websites", "VPN/Proxy Detection", "WebRTC Leak Detection",
      "Datacenter IP Matching", "VPN Provider ID", "Block Mode",
      "Redirect Mode", "Whitelisted IPs", "Crawler Whitelist",
    ],
  },
  {
    id: "competitor-intel",
    name: "Competitor Intelligence",
    icon: Crosshair,
    color: "text-yellow-500",
    buttonColor: "bg-yellow-500 hover:bg-yellow-600 text-black",
    ringColor: "ring-yellow-500/40",
    badgeColor: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    tagline: "See everything your competitors are doing",
    description: "Track competitor Google Business profiles, analyze reviews with our BS Meter for fake review detection, monitor their ad activity, and uncover their strategies.",
    tiers: [
      {
        name: "Scout",
        price: 69,
        features: [
          "1 user only",
          "Track 5 competitors",
          "5 market scans/mo",
          "Basic competitor reports",
          "Review count tracking",
          "Rating monitoring",
        ],
        limits: {
          "Users": "1",
          "Competitor Tracking": "5",
          "Market Scans/mo": "5",
          "Competitor Reports": "Basic",
          "Review Analysis": false,
          "BS Meter (Fake Reviews)": false,
          "Ad Spy Monitoring": false,
          "Scheduled Scans": false,
          "Rating Monitoring": true,
        },
      },
      {
        name: "Analyst",
        price: 129,
        popular: true,
        features: [
          "1 user only",
          "Track 15 competitors",
          "20 market scans/mo",
          "Full competitor reports",
          "Review sentiment analysis",
          "BS Meter fake review detection",
          "Ad spy monitoring",
        ],
        limits: {
          "Users": "1",
          "Competitor Tracking": "15",
          "Market Scans/mo": "20",
          "Competitor Reports": "Full",
          "Review Analysis": true,
          "BS Meter (Fake Reviews)": true,
          "Ad Spy Monitoring": true,
          "Scheduled Scans": false,
          "Rating Monitoring": true,
        },
      },
      {
        name: "Dominator",
        price: 249,
        features: [
          "1 user only",
          "Track unlimited competitors",
          "Unlimited market scans",
          "Full competitor reports",
          "BS Meter + review analysis",
          "Ad spy monitoring",
          "Scheduled automatic scans",
        ],
        limits: {
          "Users": "1",
          "Competitor Tracking": "Unlimited",
          "Market Scans/mo": "Unlimited",
          "Competitor Reports": "Full",
          "Review Analysis": true,
          "BS Meter (Fake Reviews)": true,
          "Ad Spy Monitoring": true,
          "Scheduled Scans": true,
          "Rating Monitoring": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Competitor Tracking", "Market Scans/mo", "Competitor Reports",
      "Review Analysis", "BS Meter (Fake Reviews)", "Ad Spy Monitoring",
      "Scheduled Scans", "Rating Monitoring",
    ],
  },
  {
    id: "ranking-grid",
    name: "GMB Ranking Grid",
    icon: BarChart3,
    color: "text-violet-500",
    buttonColor: "bg-violet-500 hover:bg-violet-600 text-white",
    ringColor: "ring-violet-500/40",
    badgeColor: "bg-violet-500/10 text-violet-500 border-violet-500/20",
    tagline: "See exactly where you rank on Google Maps",
    description: "Generate visual ranking grid reports showing your Google Business position across your entire service area. Track ranking changes over time and identify weak spots.",
    tiers: [
      {
        name: "Starter",
        price: 39,
        features: [
          "1 user only",
          "10 locations tracked",
          "3 grid reports/mo",
          "5x5 ranking grid",
          "Basic ranking data",
        ],
        limits: {
          "Users": "1",
          "Locations Tracked": "10",
          "Grid Reports/mo": "3",
          "Grid Size": "5x5",
          "Ranking History": false,
          "Keyword Tracking": false,
          "Competitor Comparison": false,
          "Scheduled Reports": false,
        },
      },
      {
        name: "Pro",
        price: 79,
        popular: true,
        features: [
          "1 user only",
          "25 locations tracked",
          "15 grid reports/mo",
          "7x7 ranking grid",
          "Ranking history & trends",
          "Multi-keyword tracking",
        ],
        limits: {
          "Users": "1",
          "Locations Tracked": "25",
          "Grid Reports/mo": "15",
          "Grid Size": "7x7",
          "Ranking History": true,
          "Keyword Tracking": true,
          "Competitor Comparison": false,
          "Scheduled Reports": false,
        },
      },
      {
        name: "Elite",
        price: 159,
        features: [
          "1 user only",
          "Unlimited locations",
          "Unlimited grid reports",
          "9x9 ranking grid",
          "Full ranking history",
          "Competitor grid comparison",
          "Scheduled auto-reports",
        ],
        limits: {
          "Users": "1",
          "Locations Tracked": "Unlimited",
          "Grid Reports/mo": "Unlimited",
          "Grid Size": "9x9",
          "Ranking History": true,
          "Keyword Tracking": true,
          "Competitor Comparison": true,
          "Scheduled Reports": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Locations Tracked", "Grid Reports/mo", "Grid Size",
      "Ranking History", "Keyword Tracking", "Competitor Comparison", "Scheduled Reports",
    ],
  },
  {
    id: "photo-optimizer",
    name: "GMB Photo Optimizer",
    icon: Camera,
    color: "text-pink-500",
    buttonColor: "bg-pink-500 hover:bg-pink-600 text-white",
    ringColor: "ring-pink-500/40",
    badgeColor: "bg-pink-500/10 text-pink-500 border-pink-500/20",
    tagline: "Make your Google Business photos convert",
    description: "Optimize your Google Business Profile photos for maximum visibility and engagement. Geo-tag images, add metadata, and ensure your photos meet Google's quality standards.",
    tiers: [
      {
        name: "Basic",
        price: 29,
        features: [
          "1 user only",
          "10 photo optimizations/mo",
          "Geo-tagging",
          "Metadata optimization",
          "Quality scoring",
        ],
        limits: {
          "Users": "1",
          "Photos/mo": "10",
          "Geo-Tagging": true,
          "Metadata Optimization": true,
          "Quality Scoring": true,
          "AI Suggestions": false,
          "Batch Processing": false,
        },
      },
      {
        name: "Pro",
        price: 59,
        popular: true,
        features: [
          "1 user only",
          "50 photo optimizations/mo",
          "Geo-tagging",
          "Metadata optimization",
          "Quality scoring",
          "AI-powered suggestions",
        ],
        limits: {
          "Users": "1",
          "Photos/mo": "50",
          "Geo-Tagging": true,
          "Metadata Optimization": true,
          "Quality Scoring": true,
          "AI Suggestions": true,
          "Batch Processing": false,
        },
      },
      {
        name: "Unlimited",
        price: 119,
        features: [
          "1 user only",
          "Unlimited photo optimizations",
          "Everything in Pro",
          "Batch processing",
          "Priority optimization queue",
        ],
        limits: {
          "Users": "1",
          "Photos/mo": "Unlimited",
          "Geo-Tagging": true,
          "Metadata Optimization": true,
          "Quality Scoring": true,
          "AI Suggestions": true,
          "Batch Processing": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Photos/mo", "Geo-Tagging", "Metadata Optimization",
      "Quality Scoring", "AI Suggestions", "Batch Processing",
    ],
  },
  {
    id: "permit-search",
    name: "Permit Database Search",
    icon: Search,
    color: "text-[#4A6CF7]",
    buttonColor: "bg-[#4A6CF7] hover:bg-[#3b5de0] text-white",
    ringColor: "ring-[#4A6CF7]/40",
    badgeColor: "bg-[#4A6CF7]/10 text-[#4A6CF7] border-[#4A6CF7]/20",
    tagline: "Access 32,864+ permit databases nationwide",
    description: "Search construction permit records across all 50 states. Find new construction projects, renovation permits, and property ownership details to generate warm leads.",
    tiers: [
      {
        name: "Explorer",
        price: 49,
        features: [
          "1 user only",
          "100 searches/mo",
          "All 50 states + DC",
          "32,864+ databases",
          "Basic permit details",
        ],
        limits: {
          "Users": "1",
          "Searches/mo": "100",
          "States Covered": "All 50 + DC",
          "Databases": "32,864+",
          "Property Records": false,
          "Scrape Scheduling": false,
          "Search History": true,
          "Data Export": false,
        },
      },
      {
        name: "Professional",
        price: 99,
        popular: true,
        features: [
          "1 user only",
          "500 searches/mo",
          "All 50 states + DC",
          "Property records access",
          "Search history & saved results",
          "Data export",
        ],
        limits: {
          "Users": "1",
          "Searches/mo": "500",
          "States Covered": "All 50 + DC",
          "Databases": "32,864+",
          "Property Records": true,
          "Scrape Scheduling": false,
          "Search History": true,
          "Data Export": true,
        },
      },
      {
        name: "Enterprise",
        price: 199,
        features: [
          "1 user only",
          "Unlimited searches",
          "All 50 states + DC",
          "Property records access",
          "Automated scrape scheduling",
          "Full search history",
          "Data export",
        ],
        limits: {
          "Users": "1",
          "Searches/mo": "Unlimited",
          "States Covered": "All 50 + DC",
          "Databases": "32,864+",
          "Property Records": true,
          "Scrape Scheduling": true,
          "Search History": true,
          "Data Export": true,
        },
      },
    ],
    comparisonFeatures: [
      "Users", "Searches/mo", "States Covered", "Databases",
      "Property Records", "Scrape Scheduling", "Search History", "Data Export",
    ],
  },
];

export default function IndividualPricingPage() {
  const [, setLocation] = useLocation();
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <div className="text-center space-y-4">
        <Badge className="bg-[#F97316]/10 text-[#F97316] border-[#F97316]/20 px-4 py-1.5" data-testid="badge-individual-tools">
          <Zap className="w-4 h-4 mr-2" /> À La Carte Tools
        </Badge>
        <h1 className="text-4xl font-extrabold tracking-tight" data-testid="text-individual-title">
          Pay Only For What You Need
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
          Don't need the full platform? Pick individual tools and only pay for the features that matter to your business. 
          Each tool comes with its own tiered pricing so you get exactly the right level.
        </p>
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            onClick={() => setLocation("/pricing")}
            data-testid="link-full-plans"
          >
            <ArrowRight className="w-4 h-4 mr-2" /> View Full Plans Instead
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              const el = document.getElementById(`tool-${tool.id}`);
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={`flex flex-col items-center gap-2 p-3 rounded-xl border border-border/50 hover:border-border transition-all hover:-translate-y-0.5 cursor-pointer bg-card`}
            data-testid={`nav-tool-${tool.id}`}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tool.badgeColor}`}>
              <tool.icon className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-center leading-tight">{tool.name}</span>
            <span className="text-[10px] text-muted-foreground">from ${Math.min(...tool.tiers.map(t => t.price))}/mo</span>
          </button>
        ))}
      </div>

      {TOOLS.map((tool) => {
        const isExpanded = expandedTool === tool.id;
        return (
          <section key={tool.id} id={`tool-${tool.id}`} className="scroll-mt-8" data-testid={`section-tool-${tool.id}`}>
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${tool.badgeColor}`}>
                  <tool.icon className="w-7 h-7" />
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-extrabold tracking-tight" data-testid={`text-tool-title-${tool.id}`}>{tool.name}</h2>
                  <p className={`text-sm font-semibold ${tool.color}`}>{tool.tagline}</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{tool.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {tool.tiers.map((tier, ti) => (
                  <Card
                    key={tier.name}
                    className={`relative flex flex-col ring-2 ${tool.ringColor} ${tier.popular ? "scale-[1.02]" : ""}`}
                    data-testid={`card-tier-${tool.id}-${ti}`}
                  >
                    {tier.popular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <Badge className={`${tool.buttonColor} border-none px-3 text-xs font-bold`}>
                          Most Popular
                        </Badge>
                      </div>
                    )}
                    <CardContent className="flex flex-col flex-1 p-6 pt-8">
                      <div className="text-center mb-4">
                        <h3 className="text-lg font-bold">{tier.name}</h3>
                        <div className="mt-1">
                          <span className="text-4xl font-extrabold">${tier.price}</span>
                          <span className="text-muted-foreground text-sm">/month</span>
                        </div>
                      </div>
                      <ul className="space-y-2.5 flex-1">
                        {tier.features.map((feature, fi) => (
                          <li key={fi} className="flex items-start gap-2 text-sm">
                            <Check className={`w-4 h-4 shrink-0 mt-0.5 ${tool.color}`} />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        className={`w-full mt-6 font-bold border-0 ${tool.buttonColor}`}
                        onClick={() => setLocation("/pricing")}
                        data-testid={`button-tier-${tool.id}-${ti}`}
                      >
                        Get Started
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedTool(isExpanded ? null : tool.id)}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid={`button-compare-${tool.id}`}
                >
                  {isExpanded ? (
                    <>Hide Comparison <ChevronUp className="w-4 h-4 ml-1" /></>
                  ) : (
                    <>Compare All Features <ChevronDown className="w-4 h-4 ml-1" /></>
                  )}
                </Button>
              </div>

              {isExpanded && (
                <div className="overflow-x-auto rounded-xl border border-border" data-testid={`table-compare-${tool.id}`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left p-4 font-bold min-w-[180px]">Feature</th>
                        {tool.tiers.map((tier, ti) => (
                          <th key={ti} className={`text-center p-3 font-bold min-w-[120px] ${tier.popular ? `${tool.badgeColor.split(' ')[0]}` : ""}`}>
                            <div className="flex flex-col items-center gap-1">
                              <span className={tool.color}>{tier.name}</span>
                              <span className="text-xs font-normal text-muted-foreground">${tier.price}/mo</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tool.comparisonFeatures.map((feature, fi) => (
                        <tr key={fi} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3 text-sm font-medium">{feature}</td>
                          {tool.tiers.map((tier, ti) => {
                            const val = tier.limits[feature];
                            return (
                              <td key={ti} className={`p-3 text-center ${tier.popular ? `${tool.badgeColor.split(' ')[0]}` : ""}`}>
                                {val === true ? (
                                  <Check className="w-5 h-5 text-green-500 mx-auto" />
                                ) : val === false ? (
                                  <X className="w-5 h-5 text-muted-foreground/30 mx-auto" />
                                ) : (
                                  <span className="text-sm font-semibold">{val}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="border-b border-border/30" />
            </div>
          </section>
        );
      })}

      <div className="bg-muted/30 border border-border/50 rounded-xl p-4 text-center text-sm text-muted-foreground max-w-2xl mx-auto">
        <Users className="w-5 h-5 mx-auto mb-2 text-muted-foreground/60" />
        All individual tool plans are limited to <span className="font-bold text-foreground">1 user only</span>. 
        Need team access or multiple users? Our full platform plans include multi-user support and every tool at a fraction of the cost.
      </div>

      <div className="text-center space-y-4 pt-4 pb-8">
        <h2 className="text-2xl font-extrabold" data-testid="text-bundle-cta">Need Multiple Tools? Save With a Full Plan</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Buying tools individually adds up fast. Our Gold plan ($499/mo) includes every tool on this page 
          for less than what 4 individual mid-tier subscriptions would cost. Platinum ($995/mo) unlocks unlimited everything.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-8"
            onClick={() => setLocation("/pricing")}
            data-testid="button-view-gold"
          >
            <Crown className="w-4 h-4 mr-2" /> View Gold Plan — $499/mo
          </Button>
          <Button
            className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-8"
            onClick={() => setLocation("/pricing")}
            data-testid="button-view-platinum"
          >
            <Shield className="w-4 h-4 mr-2" /> View Platinum Plan — $995/mo
          </Button>
        </div>
      </div>
    </div>
  );
}
