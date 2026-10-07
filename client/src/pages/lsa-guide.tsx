import { useState } from "react";
import { inNativeApp } from "@/lib/app-shell";
import { PublicPageHeader } from "@/components/public-page-chrome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GooglePill } from "@/components/google";
import {
  BadgeCheck, Shield, DollarSign, MapPin, Clock, Star,
  CheckCircle, ChevronDown, ChevronUp, ChevronRight, ArrowRight,
  Users, Zap, Phone, MessageSquare, Target, Award,
  FileCheck, Wrench, TrendingUp, Search, ThumbsUp,
  AlertTriangle, Lightbulb, GraduationCap, Globe,
  Camera, PhoneCall, Calendar, Settings2, Ban,
  ImageIcon, Building2, Heart, ShieldCheck,
} from "lucide-react";

import verificationImg from "@assets/image_1772143162244.png";
import settingsImg from "@assets/image_1772143427414.png";
import servicesImg from "@assets/image_1772143583811.png";
import serviceAreasImg from "@assets/image_1772143887357.png";
import googleAdsLogo from "@assets/google-ads-logo.png";

const SECTIONS = [
  {
    id: "verification",
    icon: Shield,
    number: 1,
    title: "Business Verification & Getting Google Verified",
    description: "Complete all verification steps to earn your Google Verified badge and go live with LSA.",
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    borderColor: "border-[#4285F4]/30",
    content: [
      { type: "text" as const, text: "Google Local Services Ads (formerly Google Guaranteed) requires full business verification before your ad goes live. This includes billing information, proof of insurance, background checks, Google Business Profile linking, bidding & budget setup, and all applicable trade licenses." },
      { type: "image" as const, src: verificationImg, caption: "Business Verification dashboard showing all required steps completed — billing, insurance, background check, GBP linking, budget, and trade licenses." },
      { type: "tip" as const, text: "Have all your documents ready before you start the verification process. Missing or expired documents are the #1 cause of delays. Double-check that your insurance certificate lists the exact business name registered with Google." },
      { type: "text" as const, text: "Verification typically takes 2-5 weeks depending on your state and trade. The background check through Google's partner (Pinkerton) is usually the bottleneck. Some trades require additional certifications — for example, HVAC requires EPA certification." },
    ],
  },
  {
    id: "answering-calls",
    icon: PhoneCall,
    number: 2,
    title: "Always Answer Your Calls — This Is Everything",
    description: "Unlike Google Ads, LSA ranking is based on reliability. Answering calls is the single most important factor.",
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    borderColor: "border-[#34A853]/30",
    content: [
      { type: "warning" as const, text: "Unlike Google Ads where you can set it and forget it, LSA is strictly based on reliable sources. If you answer the phone and the client needs services you offer, Google will prioritize you over your competitors. The algorithm rewards your consistency." },
      { type: "text" as const, text: "This is the #1 difference between LSA and Google Ads. With Google Ads, a missed call just means a wasted click. With LSA, a missed call directly hurts your ranking. Google tracks your answer rate, response time, and booking rate — and uses all of it to decide who shows up first." },
      { type: "tip" as const, text: "You can technically save money on LSA by not answering the phone and calling people back — but this works against your ranking. Google wants to see you picking up live calls. Contractors who answer consistently dominate the top spots." },
      { type: "list" as const, items: [
        "Answer every call within 3 rings if possible — Google tracks response time",
        "Download the Google Local Services app for real-time lead notifications",
        "Mark leads as 'Booked' when you schedule a job — this improves your ranking",
        "Your booking rate directly impacts how often Google shows your ad",
        "Treat every lead like gold — Google rewards contractors who convert more leads",
      ]},
    ],
  },
  {
    id: "reviews",
    icon: Star,
    number: 3,
    title: "Reviews Are Your Ranking Fuel",
    description: "More reviews and higher ratings mean more leads. Don't dispute bad leads — Google doesn't like complainers.",
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    borderColor: "border-[#FBBC05]/30",
    content: [
      { type: "text" as const, text: "Reviews are the second most important ranking factor for LSA after proximity. The more reviews you have and the higher your rating, the more Google trusts your business. Ask every happy customer to leave a Google review — this compounds over time and builds an unstoppable lead machine." },
      { type: "warning" as const, text: "Don't dispute bad leads excessively. Google does not like a complainer. The algorithm will work against you if you're constantly flagging leads as invalid. Yes, you should dispute genuinely spam or wrong-service leads — but if you're disputing everything, Google notices and your ranking will suffer." },
      { type: "tip" as const, text: "The mindset should be: pay to play. LSA rewards businesses that invest consistently, answer calls, and build reviews. Think of it as a long-term investment in your local dominance, not a short-term lead gen hack." },
    ],
  },
  {
    id: "services",
    icon: Settings2,
    number: 4,
    title: "Selecting Your Services — Avoid the Traps",
    description: "Only check services you actually do. Avoid 'Other' and repairs you don't handle to save money.",
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    borderColor: "border-[#4285F4]/30",
    content: [
      { type: "text" as const, text: "Unlike Google Ads where you select keywords, LSA works more like a pre-prompted system similar to Google Basics. You cannot select keywords — only services. This means the services you check are everything. Choose wisely." },
      { type: "image" as const, src: servicesImg, caption: "Manage industries and services — only check the specific services you actually perform. Notice 'Other' and repair categories are deselected." },
      { type: "warning" as const, text: "NEVER select 'Other' as a service category. 'Other' can mean anything and that's where Google gets you. You'll get calls about a crack in the siding, random handyman requests, or services completely outside your wheelhouse. If you have roofing repairs deselected but 'Other' is on, you'll still get calls for roof repairs through the 'Other' bucket." },
      { type: "list" as const, items: [
        "Only check services you actually perform and are licensed for",
        "Avoid selecting repair categories for services you don't handle — this wastes money",
        "Deselect 'Other' in every trade category — it's a catch-all that drives irrelevant calls",
        "Review your service selections quarterly and adjust based on lead quality",
        "You can add or remove service categories anytime without restarting verification",
      ]},
      { type: "tip" as const, text: "Be specific. If you do roof installation and inspection but not roof repair, only check those two. Every unnecessary service you have checked is money wasted on leads you can't convert." },
    ],
  },
  {
    id: "messages",
    icon: MessageSquare,
    number: 5,
    title: "Message Leads — The Hidden Trade-Off",
    description: "Google prefers companies with messaging on, but expect a lot of low-quality leads. Our recommendation: keep it off.",
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    borderColor: "border-[#34A853]/30",
    content: [
      { type: "image" as const, src: settingsImg, caption: "LSA Settings — Message Leads toggle and Direct Business Search settings." },
      { type: "text" as const, text: "Turning on Message Leads is a preference, but Google does favor companies that have it enabled. The cost of a message lead is usually about half the cost of a phone call lead. Some people are too spooked to call — they'll only fill out forms, so messaging captures this group of people." },
      { type: "warning" as const, text: "However, you will get a lot of spammy and useless message leads. People submit forms without real intent far more often than they make phone calls. The lead quality from messages is significantly lower than calls." },
      { type: "tip" as const, text: "Our recommendation for most contractors: keep Message Leads OFF. The volume of low-quality leads typically isn't worth the hassle. Focus your budget on phone call leads where intent is much higher. If you do turn it on, be prepared to quickly filter through a lot of noise." },
      { type: "text" as const, text: "Direct Business Search should always be ON — this lets your LSA appear when someone searches for your business name directly, and you won't be charged for returning customers." },
    ],
  },
  {
    id: "service-areas",
    icon: MapPin,
    number: 6,
    title: "Service Areas & Business Hours — Coverage Is Everything",
    description: "Select by counties to avoid gaps. Run your ad 24 hours — customers research after work hours.",
    color: "text-[#FBBC05]",
    bg: "bg-[#FBBC05]/10",
    borderColor: "border-[#FBBC05]/30",
    content: [
      { type: "image" as const, src: serviceAreasImg, caption: "Service areas should cover your full territory (select by counties). Business hours should be set to 24 hours, 7 days a week." },
      { type: "warning" as const, text: "Set your business hours to 24 hours, every day. If you only set 9-5, your ad will only appear during those times. Customers aren't looking for contractors during work hours — they research after 5pm, before work, and on weekends. If your ad is off during these times, you'll never be seen when it matters most." },
      { type: "list" as const, items: [
        "Select service areas by COUNTIES preferably — this ensures you don't skip anyone in your territory",
        "Zip code targeting can leave gaps; county-level selection gives complete coverage",
        "Always set business hours to 24/7 so your ad is always visible",
        "Customers research contractors in the evening and on weekends — your ad must be live",
        "You can still choose when to answer calls, but your ad should always be showing",
      ]},
      { type: "tip" as const, text: "Just because your hours say 24/7 doesn't mean you have to answer at 3am. It means your ad is visible 24/7. Missed calls can be returned the next morning — but at least you appeared in the search results when the customer was looking." },
    ],
  },
  {
    id: "photos",
    icon: Camera,
    number: 7,
    title: "Photos — Show People, Not Just Work",
    description: "Add plenty of photos with branded trucks, team members, and quality workmanship. People hire people they trust.",
    color: "text-[#4285F4]",
    bg: "bg-[#4285F4]/10",
    borderColor: "border-[#4285F4]/30",
    content: [
      { type: "text" as const, text: "Photos are one of the most underestimated ranking and conversion factors in LSA. Most contractors upload a few project photos and call it done. That's a mistake." },
      { type: "warning" as const, text: "A profile with nobody in the photos will almost never get as many calls as a profile with photos of owners, the team, and local presence. Clients want to see quality of work, but more importantly they want to see a company they can trust — and trust is built through people, not just finished projects." },
      { type: "list" as const, items: [
        "Add photos of your branded trucks and vehicles — this shows legitimacy",
        "Include team photos with branded uniforms or shirts",
        "Show photos of real people on job sites — owners, crew members, happy customers",
        "Quality-of-work photos are important but secondary to showing your team",
        "A company that looks like real people beats a faceless lead gen operation every time",
        "Update photos seasonally to show recent work and keep your profile fresh",
      ]},
      { type: "tip" as const, text: "Think about it from the customer's perspective: they're letting a stranger into their home. They want to see the face of who's coming. Profiles with team photos, branded trucks, and real people consistently outperform profiles with only project photos." },
    ],
  },
  {
    id: "bio",
    icon: Building2,
    number: 8,
    title: "Business Bio & Trust Signals",
    description: "Choose your business details wisely. Clients love locally owned, family owned, and warranty details.",
    color: "text-[#34A853]",
    bg: "bg-[#34A853]/10",
    borderColor: "border-[#34A853]/30",
    content: [
      { type: "text" as const, text: "Your business bio and detail selections are what set you apart from every other contractor in your area. Google gives you up to 6 business highlight options — choose them wisely because customers use these to decide who to call." },
      { type: "list" as const, items: [
        "\"Locally Owned\" — customers overwhelmingly prefer local businesses over national chains",
        "\"Family Owned\" — this builds emotional trust and makes you relatable",
        "\"Warranty Offered\" — customers want to know their investment is protected",
        "\"Licensed & Insured\" — reinforces credibility (even though LSA already verifies this)",
        "\"Free Estimates\" — removes friction and gets more people to call",
        "\"Satisfaction Guaranteed\" — shows confidence in your work quality",
      ]},
      { type: "tip" as const, text: "The combination of 'Locally Owned' + 'Family Owned' + 'Warranty Offered' is the most powerful trust signal combination for contractors. These three details consistently drive the highest call rates." },
      { type: "text" as const, text: "Write a compelling business bio that speaks to your local community. Mention your years of experience, the neighborhoods you serve, and what makes your company different. This is your elevator pitch to every potential customer who sees your LSA listing." },
    ],
  },
];

const INDUSTRY_STATS = [
  { trade: "Plumber", costRange: "$25 - $50", avgCost: "$35", icon: Wrench },
  { trade: "Roofer", costRange: "$50 - $100", avgCost: "$75", icon: Shield },
  { trade: "HVAC", costRange: "$30 - $60", avgCost: "$45", icon: Zap },
  { trade: "Electrician", costRange: "$20 - $45", avgCost: "$30", icon: Lightbulb },
  { trade: "Painter", costRange: "$15 - $35", avgCost: "$25", icon: Target },
  { trade: "Locksmith", costRange: "$15 - $30", avgCost: "$20", icon: Shield },
  { trade: "Pest Control", costRange: "$20 - $40", avgCost: "$28", icon: Search },
  { trade: "Garage Door", costRange: "$25 - $50", avgCost: "$35", icon: Wrench },
];

export default function LsaGuidePage() {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setOpenSection(openSection === id ? null : id);
  };

  return (
    <>
    <PublicPageHeader next="/lsa-guide" />
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="pt-12 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">

          <div className="text-center max-w-3xl mx-auto mb-8">
            <img src={googleAdsLogo} alt="Google Ads" className="h-12 w-12 rounded-lg object-contain mx-auto mb-4" />
            {/* Google's typography and hairlines (owner, 2026-10-07): the content as it was. */}
            <div className="g-pill g-pill--sm mb-4" data-testid="badge-lsa">
              <BadgeCheck className="g-open" aria-hidden="true" />
              <span>Google Verified (Local Services Ads)</span>
            </div>
            <h1 className="g-header__title !text-[28px] !leading-[34px] sm:!text-[32px] sm:!leading-[40px] mb-3" data-testid="text-lsa-title">
              Local Services Ads:
              <br />
              The Complete LSA Setup & Optimization Playbook
            </h1>
            <p className="g-text-2 text-sm leading-relaxed max-w-2xl mx-auto">
              LSA puts your business at the very top of Google — above regular ads and organic results. You only pay when a real customer contacts you. No clicks, no impressions — just leads. This guide covers every trick to staying on top.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto mb-8">
            {[
              { label: "Position", value: "#1", sub: "top of Google search", color: "text-[#4285F4]" },
              { label: "Pay Model", value: "Per Lead", sub: "not per click", color: "text-[#34A853]" },
              { label: "Avg CPL", value: "$25-100", sub: "by trade & market", color: "text-[#FBBC05]" },
              { label: "Guide Sections", value: "8", sub: "expert strategies", color: "text-[#4285F4]" },
            ].map((stat) => (
              <div key={stat.label} className="g-stat text-center" data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                <p className="g-stat__value">{stat.value}</p>
                <p className="g-stat__label mt-1">{stat.label}</p>
                <p className="g-stat__hint">{stat.sub}</p>
              </div>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto shadow-none" data-testid="card-lsa-overview">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <BadgeCheck className="h-5 w-5 g-open flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h4 className="g-card__title g-card__title--md mb-1">LSA Is Better Than Google Ads — Here's Why</h4>
                  <p className="g-card__line">
                    With LSA, you don't get charged until someone actually calls you. Unlike Google Ads where you pay for every click (including bots and competitors), LSA only charges for real customer contacts. The Google Verified badge builds instant trust, reviews are front and center, and you appear at the absolute top of search results. But there are tricks to staying on top — and this guide covers all of them.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="max-w-4xl mx-auto g-list">
            {SECTIONS.map((section) => (
              <article
                key={section.id}
                className="g-card"
                data-testid={`card-section-${section.id}`}
              >
                <button
                  type="button"
                  className="g-card__row items-center w-full text-left"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={openSection === section.id}
                  data-testid={`button-toggle-${section.id}`}
                >
                  <span className="g-text-2 w-7 text-right flex-shrink-0 tabular-nums">{section.number}</span>
                  <span className="g-card__lead" aria-hidden="true"><section.icon /></span>
                  <span className="g-card__body">
                    <span className="g-card__title g-card__title--md block">{section.title}</span>
                    <span className="g-card__line block line-clamp-2">{section.description}</span>
                  </span>
                  <span className="g-card__trailing">
                    <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${openSection === section.id ? "rotate-90 g-accent" : ""}`} aria-hidden="true" />
                  </span>
                </button>

                {openSection === section.id && (
                  <div className="pb-2 space-y-4 pt-4 sm:pl-[68px]">
                    {section.content.map((item, idx) => {
                      switch (item.type) {
                        case "text":
                          return (
                            <p key={idx} className="text-sm g-text-2 leading-relaxed" data-testid={`content-text-${idx}`}>
                              {item.text}
                            </p>
                          );
                        case "warning":
                          return (
                            <Card key={idx} className="shadow-none" data-testid={`content-warning-${section.id}-${idx}`}>
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <AlertTriangle className="h-5 w-5 g-star flex-shrink-0 mt-0.5" aria-hidden="true" />
                                  <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        case "tip":
                          return (
                            <Card key={idx} className="shadow-none" data-testid={`content-tip-${section.id}-${idx}`}>
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <CheckCircle className="h-5 w-5 g-open flex-shrink-0 mt-0.5" aria-hidden="true" />
                                  <p className="text-sm text-muted-foreground leading-relaxed">{item.text}</p>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        case "image":
                          return (
                            <div key={idx} className="my-4 rounded-lg overflow-hidden border border-border" data-testid={`content-image-${section.id}-${idx}`}>
                              <img
                                src={item.src}
                                alt={item.caption || "LSA screenshot"}
                                className="w-full h-auto"
                                loading="lazy"
                              />
                              {item.caption && (
                                <div className="bg-muted px-4 py-3 border-t border-border">
                                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                                    <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                    {item.caption}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        case "list":
                          return (
                            <ul key={idx} className="space-y-2 pl-1" data-testid={`content-list-${section.id}-${idx}`}>
                              {item.items?.map((li, j) => (
                                <li key={j} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed" data-testid={`list-item-${section.id}-${idx}-${j}`}>
                                  <ChevronRight className="h-4 w-4 g-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
                                  <span>{li}</span>
                                </li>
                              ))}
                            </ul>
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                )}
              </article>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto shadow-none" data-testid="card-cost-table">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <span className="g-card__lead" aria-hidden="true">
                  <DollarSign />
                </span>
                <div>
                  <CardTitle className="g-card__title g-card__title--md">Average Cost Per Lead by Trade</CardTitle>
                  <p className="g-card__meta">Approximate ranges based on national averages. Your cost depends on market and competition.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {INDUSTRY_STATS.map((stat, i) => (
                  <div key={i} className="g-stat text-center" data-testid={`card-trade-${i}`}>
                    <stat.icon className="h-5 w-5 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
                    <p className="g-stat__label">{stat.trade}</p>
                    <p className="g-stat__value !text-base g-open">{stat.costRange}</p>
                    <p className="g-stat__hint">avg. {stat.avgCost}/lead</p>
                  </div>
                ))}
              </div>
              <Card className="mt-4 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 g-star flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Costs in major metros (NYC, LA, Chicago) can be 2-3x higher than suburban or rural areas. Seasonal demand also affects pricing — expect higher costs during peak season for your trade.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto shadow-none" data-testid="card-lsa-vs-ads">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <span className="g-card__lead" aria-hidden="true">
                  <Zap />
                </span>
                <div>
                  <CardTitle className="g-card__title g-card__title--md">LSA vs. Google Ads — Key Differences</CardTitle>
                  <p className="g-card__meta">Understanding why LSA wins for contractors</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="g-list">
                {[
                  { feature: "Payment Model", lsa: "Pay per lead (call/message)", ads: "Pay per click (including bots)", winner: "lsa" },
                  { feature: "Position", lsa: "Top of search results (#1)", ads: "Below LSA, above organic", winner: "lsa" },
                  { feature: "Trust Badge", lsa: "Google Verified badge included", ads: "No trust badge", winner: "lsa" },
                  { feature: "Keyword Control", lsa: "No keywords — services only", ads: "Full keyword control", winner: "ads" },
                  { feature: "Fraud Protection", lsa: "Only pay for real contacts", ads: "Massive click fraud problem", winner: "lsa" },
                  { feature: "Ranking Factor", lsa: "Reviews + responsiveness", ads: "Budget + Quality Score", winner: "lsa" },
                  { feature: "Setup Complexity", lsa: "Verification takes 2-5 weeks", ads: "Live in minutes", winner: "ads" },
                ].map((row, idx) => (
                  <div key={idx} className="g-card !py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" data-testid={`comparison-${idx}`}>
                    <div className="sm:w-28 flex-shrink-0">
                      <p className="text-sm font-medium g-text">{row.feature}</p>
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <div className={`text-xs px-2 py-1 rounded ${row.winner === "lsa" ? "g-chip g-chip--sm !text-[var(--g-green)] !normal-case !min-h-0" : "g-text-2"}`}>
                        {row.lsa}
                      </div>
                      <div className={`text-xs px-2 py-1 rounded ${row.winner === "ads" ? "g-chip g-chip--sm !normal-case !min-h-0" : "g-text-2"}`}>
                        {row.ads}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto shadow-none" data-testid="card-bottom-cta">
            <CardContent className="p-6 text-center">
              <BadgeCheck className="h-8 w-8 g-open mx-auto mb-3" aria-hidden="true" />
              <h3 className="g-header__title mb-2">Ready to Dominate Local Search?</h3>
              <p className="g-text-2 text-sm leading-relaxed max-w-2xl mx-auto mb-4">
                {inNativeApp()
                  ? "LSA is just one piece of the puzzle. Set up Click Guard to protect your Google Ads campaigns from click fraud."
                  : "LSA is just one piece of the puzzle. Learn the complete system for building a profitable contractor business with our Master Class, or set up Click Guard to protect your Google Ads campaigns from click fraud."}
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {/* Not in the iPhone apps: the Master Class is a paid course (the apps sell nothing). */}
                {!inNativeApp() && (
                  <GooglePill icon={GraduationCap} variant="solid" href="/master-class" label="Explore Master Class" testId="button-masterclass" />
                )}
                <GooglePill icon={Shield} href="/google-ads" label="Set Up Click Guard" testId="button-click-guard" />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
    </>
  );
}
