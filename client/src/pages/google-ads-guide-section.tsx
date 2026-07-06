import { useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useRoute } from "wouter";
import {
  ArrowLeft, AlertTriangle, CheckCircle, Shield, ShieldCheck,
  Ban, Target, Eye, ChevronRight, XCircle,
} from "lucide-react";

import imgSitelinks from "@assets/image_1772130987636.png";
import imgAiMax from "@assets/image_1772131483853.png";
import imgLeadsGoal from "@assets/image_1772131693564.png";
import imgSearchPartners from "@assets/image_1772131724868.png";
import imgBudget from "@assets/image_1772131871333.png";
import imgBidding from "@assets/image_1772131956561.png";
import imgCustomerAcq from "@assets/image_1772132057150.png";
import imgAiMaxToggle from "@assets/image_1772132276466.png";
import imgLocations from "@assets/image_1772132338474.png";
import imgAutoAssets from "@assets/image_1772132687296.png";
import imgIpExclusions from "@assets/image_1772133112337.png";
import imgChecklist from "@assets/image_1772134707386.png";
import imgOverview from "@assets/image_1772131623518.png";

type ContentBlock = {
  type: "text" | "heading" | "warning" | "image" | "list" | "tip" | "divider";
  content?: string;
  items?: string[];
  src?: string;
  caption?: string;
};

type SectionData = {
  title: string;
  subtitle: string;
  accentColor: string;
  blocks: ContentBlock[];
  prevSection?: { slug: string; title: string };
  nextSection?: { slug: string; title: string };
};

const SECTIONS: Record<string, SectionData> = {
  "campaign-setup": {
    title: "Campaign Setup: Do It Right From Day One",
    subtitle: "This is where most contractors lose money before they even start. Every setting matters. Follow this step-by-step walkthrough exactly.",
    accentColor: "blue",
    prevSection: undefined,
    nextSection: { slug: "features-to-avoid", title: "Features to AVOID" },
    blocks: [
      { type: "warning", content: "Google Ads comes with almost every setting configured to benefit Google, not you. The default settings will drain your budget on bot traffic, fake clicks, and irrelevant audiences. This guide shows you the exact settings to change — do not skip any step." },

      { type: "heading", content: "Step 1: Always Choose 'Leads' as Your Campaign Goal" },
      { type: "text", content: "When creating a new campaign, the very first thing Google asks is your campaign objective. Select 'Leads' — not Sales, not Website Traffic, and definitely not 'Create a campaign without a goal's guidance.'" },
      { type: "text", content: "The Leads objective tells Google to optimize for people who are likely to take action — call you, fill out a form, request a quote. This is critical for contractors because your entire business runs on leads, not impressions or website views. Every other objective optimizes for metrics that don't put money in your pocket." },
      { type: "image", src: imgLeadsGoal, caption: "Select 'Leads' as your campaign goal — this optimizes Google's algorithm for real customer actions like calls and form fills" },

      { type: "heading", content: "Step 2: UNCHECK Google Search Partners — This Is Critical" },
      { type: "warning", content: "This is the single most expensive mistake you can make in Google Ads. If you leave this checked, you will waste the majority of your budget." },
      { type: "text", content: "Google Search Partners means Google can share your ads anywhere — on random emails, YouTube sidebars, affiliate websites, blogs, news aggregators, and virtually any company that allows Google to place advertising (which is almost everyone on the internet)." },
      { type: "text", content: "These placements will NEVER lead to sales and are barely even considered leads. They are magnets for bot attacks, spam clicks, and accidental clicks from people who had zero intention of hiring a contractor. You will pay 90% of your budget to just this one feature if you leave it checked." },
      { type: "text", content: "Go to Campaign Settings → Networks → UNCHECK 'Include Google search partners.' This single action can save you thousands of dollars per month. Do it right now if you haven't already." },
      { type: "image", src: imgSearchPartners, caption: "UNCHECK 'Include Google search partners' — this will destroy your budget if left on. Google spreads your ads across thousands of low-quality websites." },

      { type: "heading", content: "Step 3: Set a Conservative Starting Budget" },
      { type: "text", content: "Do NOT put more than $100-250/day for your campaign during the first few weeks while Google Ads is learning. Google's algorithm needs time to understand your market, your keywords, and your audience." },
      { type: "text", content: "Starting at $1,000/day on a new campaign is how you burn through $30,000 in a month with zero results. Google will happily spend every penny you give them — they have no incentive to be conservative with your money." },
      { type: "text", content: "Start small, monitor everything daily, and scale only after you see real leads coming in and you've verified those leads are turning into actual paying customers. Only increase budget by 20-30% per week once you have proven results." },
      { type: "image", src: imgBudget, caption: "Start with $100-150/day budget — you can always increase later, but you can never get wasted money back" },

      { type: "heading", content: "Step 4: Use Advanced Campaign Mode — NEVER Basic" },
      { type: "text", content: "Google offers a 'Basic' or 'Smart' campaign setup that sounds easier but removes your ability to control keywords, audiences, bidding, and most other critical settings. This is a trap designed for people who don't know any better." },
      { type: "text", content: "Basic mode lets Google make ALL the decisions for you — including which keywords to target, where to show your ads, how much to bid, and who sees them. You're essentially handing Google a blank check and saying 'spend this however you want.'" },
      { type: "text", content: "Always choose the Advanced or Expert mode so you maintain full control over every aspect of your campaign. If you can't see individual keyword settings, audience targeting options, or bid adjustment controls, you're in Basic mode and Google is spending your money however they want." },

      { type: "heading", content: "Step 5: Separate Campaigns by Service Type" },
      { type: "text", content: "Don't mix 'roof repair' and 'new roof installation' in the same campaign. The customer intent is completely different, the budget should be different, and the landing pages should be different." },
      { type: "text", content: "A roof repair lead might be worth $200, but a new roof installation lead could be worth $15,000. If you lump them together, you can't allocate budget properly — you'll underspend on the high-value service and overspend on the low-value one." },
      { type: "text", content: "Create a separate campaign for each major service you offer. This lets you control budgets independently, write more relevant ad copy for each service, and send traffic to dedicated landing pages that match exactly what the person searched for." },

      { type: "heading", content: "Step 6: Single Keyword Ad Groups (SKAGs)" },
      { type: "text", content: "Instead of stuffing 20 keywords into one ad group, create one ad group per keyword (or a very small, tightly related group of 2-3 keywords). This is called a SKAG — Single Keyword Ad Group." },
      { type: "text", content: "Why does this matter? When you have 20 keywords in one ad group, Google shows the same ad for all 20 searches. But 'emergency roof leak repair' and 'roof inspection near me' are completely different searches with completely different intent. The ad copy should match each search exactly." },
      { type: "text", content: "With SKAGs, your ad headline can match the exact search term. Google bolds matching words, making your ad stand out. Your Quality Score goes up (meaning Google charges you less per click), and your click-through rate improves because the ad is hyper-relevant. Yes, it's more work upfront — but it pays off massively." },

      { type: "tip", content: "Download the Google Ads mobile app and check your campaigns multiple times per day during your first few weeks. Set up budget alerts so you get notified if spending suddenly spikes — this is often the first sign of click fraud or a misconfigured setting." },
    ],
  },

  "features-to-avoid": {
    title: "Google Ads Features to AVOID at All Costs",
    subtitle: "These features are designed to make Google more money, not to help you. Every single one of them will increase your costs while decreasing your lead quality. Disable all of them.",
    accentColor: "yellow",
    prevSection: { slug: "campaign-setup", title: "Campaign Setup" },
    nextSection: { slug: "assets", title: "Ad Assets Guide" },
    blocks: [
      { type: "warning", content: "Every AI feature Google offers for Google Ads is designed to increase Google's revenue at your expense. They optimize for clicks (which Google gets paid for), not for leads (which you need). This is not an exaggeration — it is the fundamental business model conflict at the heart of Google Ads." },

      { type: "heading", content: "Auto-Apply Recommendations — The Biggest Scam in Google Ads" },
      { type: "text", content: "Auto-Apply is the single biggest scam in the entire Google Ads platform. When enabled, Google uses AI to 'optimize' your campaigns by automatically making changes without your knowledge or consent." },
      { type: "text", content: "Here's what Google can do with Auto-Apply turned on:" },
      { type: "list", items: [
        "Change your daily budget — increasing it to spend more of your money",
        "Enable audiences you never approved — showing your ads to people who will never hire you",
        "Add keywords you never wanted — broad match terms that trigger your ads for irrelevant searches",
        "Modify your bids — often raising them so you pay more per click",
        "Create new ad variations — with headlines and descriptions you didn't write",
        "Enable extensions and assets — adding clickable links that competitors and bots can abuse",
      ] },
      { type: "text", content: "Go to Settings → Auto-Apply and turn OFF every single recommendation. Click through every category and make sure nothing is checked. Google occasionally adds new Auto-Apply categories, so check this setting monthly to make sure they haven't re-enabled something." },
      { type: "tip", content: "Google has been caught re-enabling Auto-Apply recommendations after users turn them off. Check this setting at least once a month. If you notice unexpected changes to your campaigns, Auto-Apply is the first thing to investigate." },

      { type: "heading", content: "AI Max — Search Term Matching Is a Revenue Grab" },
      { type: "text", content: "AI Max is Google's newest tool that does 'search term matching' — it takes your carefully chosen exact-match and phrase-match keywords and expands them to broad match, letting Google's AI decide what searches trigger your ads." },
      { type: "text", content: "This is a massive scam. You spend hours researching the perfect keywords for your roofing business, set them up as exact match [roof repair Seattle] — and then AI Max overrides all of that and shows your ad for 'roofing school near me' or 'how to repair a roof yourself' or 'roofing jobs hiring.'" },
      { type: "text", content: "You will ALWAYS overspend with AI Max enabled. It dramatically increases your impression volume (which looks good in reports) while tanking your conversion rate (which costs you money). Google gets paid for every click regardless of whether it converts." },
      { type: "image", src: imgAiMax, caption: "AI Max 'Search term matching' — this overrides your keyword settings and lets Google show your ads for whatever searches they want" },
      { type: "text", content: "Go to Campaign Settings → AI Max and make sure 'Optimize your campaign with AI Max' is toggled OFF. If you see it enabled, disable it immediately." },
      { type: "image", src: imgAiMaxToggle, caption: "Make sure the AI Max toggle is OFF in your campaign settings" },

      { type: "heading", content: "Automatically Created Assets — Google Writing Your Ads" },
      { type: "text", content: "This feature lets Google auto-generate headlines, descriptions, sitelinks, and other assets for your ads using AI. It sounds convenient but it's dangerous for multiple reasons:" },
      { type: "list", items: [
        "Google will create sitelinks you never approved — these are clickable links that competitors and bots can click, costing you money with zero trackability",
        "Google will write headlines that don't match your brand voice or may even be inaccurate about your services",
        "Google will add assets designed to increase click volume (their revenue) regardless of lead quality (your revenue)",
        "You lose control over what your ad says and where clicks go",
      ] },
      { type: "text", content: "Go to Campaign Settings → Automatically Created Assets and select 'Off: Use only assets I provide directly for my ads.' Do NOT let Google create any assets for you. You write every headline, every description, and you decide which assets to include." },
      { type: "image", src: imgAutoAssets, caption: "Turn off automatically created assets — select 'Off: Use only assets I provide directly for my ads'" },

      { type: "heading", content: "The 'Only Bid for New Customers' Trap" },
      { type: "text", content: "Google offers a Customer Acquisition setting that claims to 'only bid for new customers.' Sounds great for contractors, right? You only want new leads, not existing customers clicking your ads again." },
      { type: "text", content: "In practice, this feature doesn't work properly. The optimization requires an audience segment with at least 1,000 active members, and even then, Google's own documentation admits 'your ads may sometimes be shown to existing customers due to technology limitations.' That's Google-speak for 'this doesn't actually work but we'll charge you for it anyway.'" },
      { type: "text", content: "This setting severely restricts your campaign reach while not actually delivering on its promise. Leave this off and manage your targeting manually through keywords and location settings." },
      { type: "image", src: imgCustomerAcq, caption: "The 'Only bid for new customers' feature — sounds great but doesn't work as advertised" },

      { type: "heading", content: "The Universal Rule: NEVER Use Google's AI for Anything" },
      { type: "text", content: "This is not an overstatement. Never use any AI feature Google offers for your ads. Every single AI tool they provide — Smart Bidding on new campaigns, Smart Campaigns, AI Max, auto-recommendations, automatically created assets, Performance Max — is designed to increase Google's revenue at your expense." },
      { type: "text", content: "They optimize for clicks (which Google gets paid for), not for leads (which you need). The 30 minutes per week you spend manually managing your campaigns will save you literally thousands of dollars per month compared to letting Google's AI run things." },
      { type: "text", content: "The only good use of AI in your Google Ads process is using tools like ChatGPT to brainstorm keyword variations and write ad copy — NOT Google's own AI tools that control your spending." },
    ],
  },

  "assets": {
    title: "Ad Assets: What to Use and What to Delete",
    subtitle: "Not all ad assets are created equal. Some make your ad bigger and more effective — others create clickable links that drain your budget and can't be tracked. Here's the complete breakdown.",
    accentColor: "green",
    prevSection: { slug: "features-to-avoid", title: "Features to AVOID" },
    nextSection: { slug: "keywords", title: "Keyword Strategy" },
    blocks: [
      { type: "text", content: "Google Ads assets (formerly called extensions) are additional pieces of information that appear with your ad. Some are tremendously valuable. Others are traps that create clickable links competitors and bots can exploit. The rule is simple: if you can't track it, don't use it." },

      { type: "heading", content: "Assets You SHOULD Use" },
      { type: "text", content: "These assets are safe and effective because they either have no clickable cost or they drive real engagement that you can track:" },

      { type: "tip", content: "Headlines — Write 15 unique headlines that match your keywords and services. Google rotates through these to find the best performers. Include your city name, service type, and differentiators like '5-Star Rated' or 'Licensed & Insured.'" },
      { type: "tip", content: "Descriptions — Write 4 descriptions highlighting your value proposition. Focus on what makes you different: years in business, number of reviews, specific certifications, guarantees, financing options." },
      { type: "tip", content: "Callout Assets — These are your best friend. Non-clickable text snippets like 'Award Winning,' '5-Star Reviews,' 'Licensed & Insured,' 'Free Estimates,' '24/7 Emergency Service,' 'Family Owned,' 'Veteran Owned,' 'Financing Available.' They make your ad larger without adding clickable links that cost money. You can add up to 20 callouts per campaign — use them all!" },
      { type: "tip", content: "Structured Snippets — Categories like 'Services: Roof Repair, New Installation, Inspections, Gutter Cleaning.' These help Google understand your business and give searchers more context." },
      { type: "tip", content: "Business Name & Logo — Upload your company name and logo for brand recognition. These appear in your ad and help build trust." },
      { type: "tip", content: "Image / Photo Assets — Upload high-quality photos of your work, your trucks, your team. Visual assets make your ad stand out dramatically from text-only competitors." },
      { type: "tip", content: "Call Asset — Adds a click-to-call button to your ad. You only pay when someone actually calls, and calls are highly trackable. This is one of the most valuable assets for contractors." },

      { type: "heading", content: "Assets You Must DELETE and NEVER Use" },
      { type: "warning", content: "These assets create clickable links that cost you money, can't be tracked properly, and open the door to competitor abuse and bot clicks. Delete them immediately if Google has auto-created them." },

      { type: "text", content: "Sitelinks — Google AI will try to auto-add these. DELETE THEM. Sitelinks create extra clickable links below your ad that competitors and bots can click, costing you money with zero trackability. Each sitelink click costs you the same as a regular ad click. Competitors click these specifically because they know you can't track which sitelink was clicked." },
      { type: "image", src: imgSitelinks, caption: "Delete sitelinks and other AI-generated assets — these create extra clickable links that cost you money with zero tracking ability" },

      { type: "text", content: "Location Assets — AVOID. These can add your ad to Google Business Profile (Maps) where competitors click with zero ways for you to track the source. Your ad appears in places you didn't intend, and you pay for clicks from people browsing Maps who may not have any intent to hire." },
      { type: "text", content: "Lead Form Assets — Competitors and bots WILL fill out fake forms. You pay higher rates for these 'conversions' and get garbage leads that waste your sales team's time. The cost per 'conversion' looks great in reports but the lead quality is terrible." },
      { type: "text", content: "Message Assets — Same problem as forms. Bots and competitors send fake messages. You pay for each interaction and get nothing of value in return." },
      { type: "text", content: "Price Assets — Creates clickable pricing links that attract tire-kickers and price shoppers. These people rarely convert into paying customers." },
      { type: "text", content: "Promotion Assets — Clickable promo links that attract discount seekers. If you want to promote a discount, put it in your headline or callout instead." },
      { type: "text", content: "App Assets — Completely irrelevant for contractors. Delete if present." },

      { type: "heading", content: "Why Callout Assets Are Your Best Friend" },
      { type: "text", content: "Callout assets deserve special attention because they are the one asset type that is purely beneficial with zero downside. Here's why:" },
      { type: "list", items: [
        "They make your ad physically larger — taking up more space on the search results page",
        "They push competitor ads further down the page — less visibility for them, more for you",
        "They have NO clickable links — meaning zero additional cost per impression",
        "They build credibility instantly — '5-Star Reviews,' 'Licensed & Bonded,' 'Veteran Owned'",
        "You can add up to 20 per campaign — load up on these",
      ] },
      { type: "text", content: "Examples of great callouts for contractors: 'Award Winning,' '5-Star Reviews,' 'Family Owned Since 2005,' 'Licensed & Bonded,' 'Free Inspections,' 'Same Day Service,' 'Financing Available,' 'Veteran Owned,' '24/7 Emergency Service,' 'BBB A+ Rated,' 'Locally Owned,' 'Satisfaction Guaranteed.'" },

      { type: "heading", content: "The Critical Rule: Everything Must Be Trackable" },
      { type: "text", content: "This is the single most important principle for choosing assets: if you can't track it, don't use it. Competitors will fill out fake forms. Bots will send fake messages. Scammers will click on sitelinks. And you pay higher rates for these 'conversions' that are actually worthless." },
      { type: "text", content: "When you use only trackable assets (phone calls, callouts, headlines, descriptions, images), you maintain complete visibility into what's working and what's wasting money. Without tracking, you're flying blind — and Google is the pilot." },
    ],
  },

  "keywords": {
    title: "Keyword Strategy: Be Specific or Go Broke",
    subtitle: "The difference between a profitable Google Ads campaign and one that loses money every month almost always comes down to keyword selection. This is not something you set up once and forget — it requires ongoing attention every week.",
    accentColor: "blue",
    prevSection: { slug: "assets", title: "Ad Assets Guide" },
    nextSection: { slug: "location", title: "Location Targeting" },
    blocks: [
      { type: "heading", content: "NEVER Use Broad Match Keywords — This Is Non-Negotiable" },
      { type: "warning", content: "Broad match is Google's default keyword setting and it is specifically designed to spend your money as fast as possible. If you use a keyword without quotes or brackets, Google considers it broad match." },
      { type: "text", content: "Here's what happens with broad match: you enter the keyword 'roofer' thinking Google will show your ad when someone searches for a roofer. Instead, Google shows your ad for 'how to become a roofer,' 'roofer salary,' 'roofing school near me,' 'roofer jokes,' 'roofing materials wholesale,' and literally anything Google's algorithm thinks is vaguely related to roofing." },
      { type: "text", content: "You pay $40-50 for each of those clicks, and not a single one of those people wants to hire a roofer. They're looking for a career, studying for school, or browsing Reddit." },
      { type: "text", content: "Always use one of these two match types:" },
      { type: "list", items: [
        "Phrase Match (\"keywords in quotes\") — Your ad shows when someone searches for your phrase in the correct order, with possible words before or after. Example: \"roof repair contractor\" matches 'best roof repair contractor near me'",
        "Exact Match ([keywords in brackets]) — Your ad only shows for that exact search or very close variations. Example: [roof repair Seattle] only matches 'roof repair Seattle' or 'Seattle roof repair'",
      ] },
      { type: "text", content: "Turn off Broad Match Keywords in your campaign settings. This single change can cut your wasted spend by 50% or more overnight." },

      { type: "heading", content: "Use Long-Tail Keywords for Maximum ROI" },
      { type: "text", content: "Instead of targeting generic keywords like 'roofer' or 'plumber,' use highly specific long-tail keywords that match buying intent. These have less competition, lower cost-per-click, and dramatically higher conversion rates because the person searching is ready to hire right now." },
      { type: "text", content: "Examples of high-converting long-tail keywords for contractors:" },
      { type: "list", items: [
        "\"Roofing company Seattle WA free estimate\"",
        "\"Emergency plumber near me 24 hour\"",
        "\"Licensed HVAC contractor Bellingham WA\"",
        "\"Siding installation Whatcom County\"",
        "[roof leak repair Seattle same day]",
        "\"Commercial roofing contractor [city name]\"",
        "\"Foundation repair estimate [city name]\"",
      ] },
      { type: "text", content: "Generate hundreds of variations combining your services + locations + qualifiers (licensed, insured, free estimate, same day, emergency, etc.). AI tools like ChatGPT are actually useful here — ask it to generate 100 long-tail keyword variations for your specific trade and service area." },

      { type: "heading", content: "Negative Keywords Are Just as Important as Keywords" },
      { type: "warning", content: "You MUST build a negative keyword list BEFORE launching any campaign. Without negatives, you will pay for clicks from people who will never hire you. This is the biggest ongoing waste of money in contractor Google Ads." },
      { type: "text", content: "Add these negative keywords immediately — before your first ad runs:" },
      { type: "list", items: [
        "Jobs, hiring, salary, career, training, school, courses, apprentice, intern, certification",
        "Free, cheap, low price, discount, budget, affordable, cheapest",
        "DIY, how to, tutorial, ideas, design, colors, pictures, Pinterest, inspiration",
        "Reddit, YouTube, forum, review, reviews, complaints, BBB",
        "Near me jobs, contractor school, trade school",
        "Wholesale, materials, supplies, Home Depot, Lowe's",
      ] },
      { type: "text", content: "Check your Search Terms report every single week and add any irrelevant queries you find. This alone can cut wasted spend by 30-40%. It's better to pay $50 for one solid lead than $150 for three clicks from people searching for DIY roofing tutorials." },

      { type: "heading", content: "High-Intent Keywords Win Every Time" },
      { type: "text", content: "'Emergency roof repair' converts 5x better than 'roofing companies.' Why? Because the first person has an active emergency and needs someone NOW. The second person is casually browsing." },
      { type: "text", content: "Focus on keywords that signal someone is ready to hire RIGHT NOW:" },
      { type: "list", items: [
        "'near me' — they're searching locally and ready to call",
        "'cost' or 'price' or 'estimate' — they're evaluating options and ready to get quotes",
        "'same day' or 'emergency' — they need immediate service",
        "'licensed' or 'insured' — they're doing due diligence before hiring",
        "'free estimate' or 'free quote' — they're actively seeking proposals",
      ] },
      { type: "text", content: "These keywords are more expensive per click but cost far less per actual lead. In a niche market, not everyone is a customer — your keywords should filter for buyers, not browsers." },
    ],
  },

  "location": {
    title: "Location Targeting: The VPN & Scammer Filter",
    subtitle: "Proper location settings are your first line of defense against scammers, competitors from other areas, and bot traffic. This one setting can dramatically reduce fraudulent clicks.",
    accentColor: "green",
    prevSection: { slug: "keywords", title: "Keyword Strategy" },
    nextSection: { slug: "bidding", title: "Bidding Strategy" },
    blocks: [
      { type: "heading", content: "Select 'Presence' Only — NOT Google's Recommended Option" },
      { type: "warning", content: "This is one of the most important settings in your entire campaign. Google's 'recommended' option sounds reasonable but it will waste a massive portion of your budget on people who are nowhere near your service area." },
      { type: "text", content: "Google gives you two options for location targeting:" },
      { type: "list", items: [
        "Recommended: 'Presence or interest: People in, regularly in, or who've shown interest in your included locations'",
        "Better option: 'Presence: People in or regularly in your included locations'",
      ] },
      { type: "text", content: "Always select 'Presence: People in or regularly in your included locations.' Here's why the 'recommended' option is terrible:" },
      { type: "text", content: "The 'recommended' setting shows your ads to people ANYWHERE in the world who have 'shown interest' in your area — which Google defines however they want. A person sitting in New York who once searched for 'Seattle restaurants' is now considered 'interested in Seattle' and will see your Seattle plumbing ad. They're 3,000 miles away. They will never hire you. You still pay for their click." },
      { type: "text", content: "More importantly, VPN servers are typically located in large cities like Seattle, New York, Los Angeles, and Austin. By selecting Presence only, you exclude most VPN users — who are almost always scammers, competitors, telemarketers, and bots. This is one of the most effective anti-fraud measures you can take." },
      { type: "text", content: "Is it possible you'll miss a few real potential customers who are physically outside your area but interested in your services? Yes, a small number. But it's far better to filter out those few potential customers than to deplete your budget daily paying for clicks from bots and scammers who will never become customers." },
      { type: "image", src: imgLocations, caption: "ALWAYS select 'Presence: People in or regularly in your included locations' — the 'Recommended' option wastes your money on people outside your service area and VPN users" },

      { type: "heading", content: "For Exclude Settings, Choose the Broader Option" },
      { type: "text", content: "For the Exclude locations setting, do the opposite — select 'Presence or interest: People in, regularly in, or who've shown interest in your excluded locations.' You want to exclude as broadly as possible." },
      { type: "text", content: "If you exclude a city or region, you want to exclude everyone connected to that area, not just people physically there. This creates a tighter geographic fence around your service area and prevents ads from showing to anyone associated with areas you don't serve." },

      { type: "heading", content: "Be Strategic About Your Service Area" },
      { type: "text", content: "If you want a larger service area, choose counties instead of individual cities. If you want to target the highest-value areas for maximum ROI, be strategic about which neighborhoods and zip codes you select." },
      { type: "text", content: "You can filter out lower-value areas if your services target premium customers. This sounds harsh but it's strategic business sense — a $15,000 roof replacement customer doesn't live everywhere. Target where your ideal customers actually are. Focus your ad spend on the zip codes and neighborhoods where your average job value is highest." },

      { type: "heading", content: "Run Separate Campaigns for Different Areas" },
      { type: "text", content: "A click from downtown Seattle is worth more than a click from a rural area 90 miles away. Run separate campaigns for different service areas so you can bid accordingly and not waste budget on low-value areas." },
      { type: "text", content: "You can also adjust budgets by area — spend more in high-value zip codes where homes are worth $500K+ and less in areas where the average home value is lower. The same roofing service generates a $20,000 job in one neighborhood and a $8,000 job in another. Your ad budget should reflect that difference." },
    ],
  },

  "bidding": {
    title: "Bidding Strategy & Budget Management",
    subtitle: "How you bid determines whether Google Ads is profitable or a money pit. Get this wrong and nothing else matters — you'll either get zero impressions or spend wildly with no return.",
    accentColor: "yellow",
    prevSection: { slug: "location", title: "Location Targeting" },
    nextSection: { slug: "ad-copy", title: "Writing Ad Copy" },
    blocks: [
      { type: "heading", content: "Target Impression Share: Dominate the Top Position" },
      { type: "text", content: "If you want to be at the very top of search results every single time someone searches for your service, use Target Impression Share bidding. Set it to 'Absolute top of results page' at 100% impression share." },
      { type: "text", content: "The challenge with this strategy is you'll pay a premium — anywhere from $10-100 per click depending on your market and competition. To prevent Google from spending wildly, you MUST set a Maximum CPC Bid Limit. We recommend $45-50 for most contractor keywords." },
      { type: "text", content: "This strategy works best with a controlled budget of $100-250/day. You'll get fewer clicks than other strategies, but every click will be from someone who saw your ad in the top position — which means higher trust and higher conversion rates." },
      { type: "image", src: imgBidding, caption: "Target Impression Share with a $45 max CPC bid limit — this controls your costs while keeping you at the top of search results" },

      { type: "heading", content: "Start with Manual CPC for Brand New Campaigns" },
      { type: "text", content: "Don't let Google auto-bid on a brand new campaign. Google's automated bidding strategies need data to work — at least 30-50 conversions worth of data. Without that data, Google is essentially guessing, and their guesses tend to be expensive for you." },
      { type: "text", content: "Start with Manual CPC for the first 30-50 conversions so you understand your actual costs. Set your max CPC to what makes financial sense for your business (more on this in the next section). Once you have real conversion data, you can experiment with automated strategies like Target CPA." },
      { type: "text", content: "Start at $100/day budget and increase only when you see consistent leads converting into real customers. Jumping to auto-bid too early means Google spends wildly while 'learning' — and you foot the bill for that entire learning period." },

      { type: "heading", content: "Know Your Numbers Before You Set a Single Bid" },
      { type: "text", content: "Before you bid a single dollar, you need to know your math:" },
      { type: "text", content: "If a roofing job is worth $12,000 and you close 1 in 5 leads (20% close rate), each lead is worth $2,400 to you. If your landing page converts at 10% (1 in 10 clicks becomes a lead), each click is worth $240. That means a $40-50 CPC is very profitable — you're paying $40-50 per click but each click is worth $240 on average." },
      { type: "text", content: "Most contractors don't do this math and either underbid (getting zero impressions and wondering why Google Ads 'doesn't work') or overbid (burning through profit margins). Calculate your maximum acceptable cost-per-lead BEFORE setting any bids." },

      { type: "heading", content: "Dayparting: Bid Higher When You Can Answer the Phone" },
      { type: "text", content: "Increase bids by 20-30% during your office hours when someone can answer the phone immediately. Decrease bids at night and on weekends unless you have a 24/7 answering service." },
      { type: "text", content: "A missed call from a Google Ads click is wasted money. When someone searches 'emergency plumber near me' and clicks your ad, they need help NOW. If they get voicemail, they hang up and call the next contractor. You paid $40 for nothing. Schedule your ads to run heaviest during peak call hours (7am-6pm local time)." },

      { type: "heading", content: "Watch Your Budget Like a Hawk" },
      { type: "warning", content: "It is incredibly easy to spend $1,000+ per day if you're not careful — and this can wreck you financially. Google allows daily spend up to 2x your set budget on any given day. They claim it 'averages out' monthly, but that's cold comfort when you see a $2,000 charge on a day you expected $500." },
      { type: "text", content: "Monitor your spending daily during the first few weeks. Set up alerts in the Google Ads app on your phone. If you see a sudden spike in clicks with no corresponding increase in leads, pause the campaign immediately and investigate. This is often the first sign of click fraud." },

      { type: "heading", content: "Bidding Strategy Quick Reference" },
      { type: "list", items: [
        "Manual CPC — Best for new campaigns. Full control, no AI involvement. Start here.",
        "Target Impression Share — Best for dominating the top position. Always set max CPC limits.",
        "Target CPA — Use only after 30+ conversions. Tells Google your target cost per lead.",
        "Enhanced CPC — A middle ground where Google adjusts your manual bids slightly. Acceptable.",
        "AVOID: Maximize Clicks — Google optimizes for click volume, not quality. You'll get tons of junk clicks.",
        "AVOID: Smart Bidding, Performance Max bidding, or anything labeled 'Recommended' by Google.",
      ] },
    ],
  },

  "ad-copy": {
    title: "Writing Ad Copy That Actually Converts",
    subtitle: "Your ad copy is the very first thing a potential customer sees. You have about 2 seconds to convince them to click YOUR ad instead of the 8 other ads on the page. Here's how to make those 2 seconds count.",
    accentColor: "blue",
    prevSection: { slug: "bidding", title: "Bidding Strategy" },
    nextSection: { slug: "landing-pages", title: "Landing Pages" },
    blocks: [
      { type: "heading", content: "Put the Keyword in Headline 1 — Every Single Time" },
      { type: "text", content: "If someone searches 'roof leak repair,' your headline should be 'Roof Leak Repair — Fast Response.' If they search 'emergency plumber Seattle,' your headline should be 'Emergency Plumber Seattle — 24/7.'" },
      { type: "text", content: "Google bolds the words in your ad that match the search query. This makes your ad visually stand out from competitors who use generic headlines like 'Professional Home Services' or 'Quality You Can Trust.' Match the search intent exactly and your click-through rate will be significantly higher." },

      { type: "heading", content: "Headline 2: Tell Them WHY You Over Everyone Else" },
      { type: "text", content: "Your second headline is where you differentiate yourself from the 8 other contractors bidding on the same keyword. Be specific with numbers and proof:" },
      { type: "list", items: [
        "'Licensed & Insured Since 2005' — proves longevity and professionalism",
        "'4.9★ Rating — 500+ Reviews' — social proof with specific numbers",
        "'Same-Day Emergency Service' — urgency and availability",
        "'Family Owned, Locally Operated' — trust and community connection",
        "'Financing Available — 0% APR' — removes a buying barrier",
      ] },
      { type: "text", content: "Don't be generic. '15 Years Experience' beats 'Experienced Professionals.' '4.9 Stars, 523 Reviews' beats 'Great Customer Service.' Specific numbers are always more credible than vague claims." },

      { type: "heading", content: "Ad Rotations: Never Stop Testing" },
      { type: "text", content: "Run at least 3-4 ad variations per ad group at all times. Test different hooks and angles:" },
      { type: "list", items: [
        "Variation A: '10% Off Your First Install — Licensed & Insured'",
        "Variation B: 'Over 500 Five-Star Reviews — Free Estimates'",
        "Variation C: 'Same Day Emergency Service — Call Now'",
        "Variation D: 'Family Owned Since 2005 — Satisfaction Guaranteed'",
      ] },
      { type: "text", content: "Let each variation run for at least 2-3 weeks with meaningful click volume before making decisions. Pause the worst performers, keep the winners, and create new variations to test against them. This is an ongoing process — the day you stop testing is the day your competitors start beating you." },

      { type: "heading", content: "Strong Call to Action — Tell Them Exactly What to Do" },
      { type: "text", content: "'Call Now for a Free Estimate' beats 'Contact Us Today.' Be direct and specific. Tell them exactly what action to take and what they'll get in return." },
      { type: "text", content: "Match your CTA to the keyword intent. Emergency keywords need urgent CTAs: 'Call Now — We're Available 24/7.' Project keywords need value-based CTAs: 'Get Your Free Estimate Today — No Obligation.' Price-shopping keywords need competitive CTAs: 'Best Price Guarantee — Free Quotes in 24 Hours.'" },
      { type: "text", content: "Add urgency when appropriate and honest: 'Limited Spring Slots Available,' 'Book This Week, Save 10%,' 'Only 3 Openings Left This Month.' Urgency works because it's often true — contractors do fill up during busy seasons." },
    ],
  },

  "landing-pages": {
    title: "Landing Pages That Close Deals",
    subtitle: "You can have the perfect campaign, perfect keywords, and perfect ad copy — but if your landing page doesn't convert, every click is wasted money. This is where most contractors throw away their ad budget.",
    accentColor: "blue",
    prevSection: { slug: "ad-copy", title: "Writing Ad Copy" },
    nextSection: { slug: "ip-exclusions", title: "IP Exclusions" },
    blocks: [
      { type: "heading", content: "NEVER Send Ad Traffic to Your Homepage" },
      { type: "warning", content: "This is the #1 mistake contractors make with Google Ads. Your homepage talks about everything you do — 6 different services, your company history, your team, your blog. Someone who searched 'roof leak repair Seattle' doesn't want to read about your siding installation services. They want roof leak repair information and they want it immediately." },
      { type: "text", content: "Create dedicated landing pages for each service and location combination. 'Roof Repair in Seattle' ad clicks should go to a 'Roof Repair in Seattle' landing page. 'Emergency Plumber Bellevue' ad clicks should go to an 'Emergency Plumber Bellevue' landing page." },
      { type: "text", content: "The match between ad copy and landing page content is called 'message match.' When someone clicks your ad that says 'Roof Leak Repair — Same Day Service' and lands on a page with the headline 'Seattle's #1 Roof Leak Repair — Same Day Response,' they know they're in the right place. Conversions go up dramatically." },

      { type: "heading", content: "Above the Fold: The First 3 Seconds" },
      { type: "text", content: "Within 3 seconds of landing on your page, a visitor should see three things:" },
      { type: "list", items: [
        "WHAT you do — a big, clear headline matching the ad they clicked",
        "WHERE you are — city/area name proving you're local",
        "HOW to contact you — a visible phone number (click-to-call on mobile) and a short form",
      ] },
      { type: "text", content: "That's it. No navigation menu at the top (it gives them ways to leave). No giant hero image that pushes the content down. No company mission statement. Just the headline, your phone number, and a 3-field form (Name, Phone, Service Needed). Everything else goes below the fold." },

      { type: "heading", content: "Social Proof: Show Your Real Work" },
      { type: "text", content: "Put your Google review stars, BBB rating, and real photos front and center. Not stock photos — photos of YOUR actual work. Before/after photos of jobs you've completed. Photos of your trucks, your team, your crew on a job site." },
      { type: "text", content: "Contractors who show real before/after photos convert 40-60% better than those using generic stock images. People want to see YOUR work, not a stock photo of a perfect kitchen that could be anyone's. Video testimonials from real customers are even better — a 30-second video of a happy customer saying 'They showed up on time and did great work' is worth more than any written testimonial." },

      { type: "heading", content: "Mobile-First: 70-80% of Your Clicks Are Mobile" },
      { type: "text", content: "The vast majority of contractor ad clicks come from mobile devices — people standing in their kitchen looking at a leaking ceiling, or sitting in their car after a storm damaged their roof. Your landing page MUST be built for mobile first." },
      { type: "list", items: [
        "Page must load in under 3 seconds on a phone — test it yourself on cellular data, not WiFi",
        "Tap-to-call button must be huge and prominent — this is your primary conversion action on mobile",
        "Form fields must be easy to fill out with thumbs — no tiny text inputs",
        "No horizontal scrolling — everything must fit within the phone screen width",
        "No pop-ups that are hard to close on mobile — Google actually penalizes these",
      ] },

      { type: "heading", content: "Page Speed: Every Second Costs You Money" },
      { type: "text", content: "Every extra second of page load time drops your conversion rate by approximately 7%. A page that loads in 2 seconds converts roughly 15% better than one that loads in 4 seconds." },
      { type: "text", content: "Use Google PageSpeed Insights to test your landing pages. Compress images, remove unnecessary scripts, use a fast hosting provider. A simple, fast $20/month landing page that loads in 1.5 seconds will outperform a beautiful $5,000 custom design that loads in 6 seconds. Speed beats beauty every time when you're paying per click." },
    ],
  },

  "ip-exclusions": {
    title: "IP Exclusions & Click Fraud Protection",
    subtitle: "IP blocking is your most powerful defense against click fraud — and it's exactly why you need Google Click Guard. This section explains how IP exclusions work and why they're essential.",
    accentColor: "blue",
    prevSection: { slug: "landing-pages", title: "Landing Pages" },
    nextSection: { slug: "tracking", title: "Tracking & Measurement" },
    blocks: [
      { type: "heading", content: "Set Up Google Click Guard Immediately" },
      { type: "text", content: "IP exclusions are one of the most important settings in your campaign. Every time a fraudulent IP clicks your ad, you lose $30-50. Without a system to detect and block these IPs automatically, you're bleeding money every single day." },
      { type: "text", content: "That's exactly what our Google Click Guard does. Go to Google Click Guard in the sidebar to set up your tracking script and link your Google Ads account. The system tracks every visitor to your website, identifies fraudulent click patterns, and automatically pushes blocked IPs to your Google Ads campaigns every hour." },
      { type: "text", content: "The setup takes less than 5 minutes: add a small tracking script to your website, connect your Google Ads account, and Click Guard handles everything automatically from there." },
      { type: "image", src: imgIpExclusions, caption: "IP Exclusions section in Campaign Settings — Click Guard automates this entire process for you, pushing blocked IPs to your campaigns every hour" },

      { type: "heading", content: "A Customer Has No Business Coming Back More Than Once" },
      { type: "text", content: "Remember this rule: a real customer has no business coming back to your website from a Google ad more than once — maybe twice at most. They search, they click, they call or fill out a form. Done." },
      { type: "text", content: "If someone visits your landing page 5 times from different IPs over a few days, they're not 'comparison shopping.' They're either a competitor monitoring your ads, a telemarketer harvesting your phone number, or a bot. Block them." },
      { type: "text", content: "And even if they ARE a tire-kicker who keeps coming back for weeks without calling — you don't want this customer anyway. They're not serious, they'll beat you down on price, and they'll waste your sales team's time. It's better to block them and spend that budget reaching someone who's ready to hire." },

      { type: "heading", content: "Stay Away from Cheapskate Customers" },
      { type: "text", content: "This is a business strategy point that directly impacts your ad strategy: stay away from cheapskate customers. They are the pickiest, they'll always be the first to leave a bad review or threaten one to get a discount, and they want free work or discounts on everything." },
      { type: "text", content: "This is why repair work isn't always ideal — it invites people who don't want to pay for premium services. They often won't do a full replacement because they're too cheap, even when a replacement is clearly the better option. Focus your ads and keywords on premium customers, not bargain hunters." },
      { type: "text", content: "A customer isn't always a customer worth having. Target replacement and new installation keywords for higher-value jobs with better customers who respect your expertise and pay your rates." },

      { type: "heading", content: "Block Aggressively — It's Better to Over-Block" },
      { type: "text", content: "Think about the math: if you have a $200/day budget and 30% is wasted on fraudulent clicks, that's $60/day or $1,800/month going straight to Google with zero return. Over a year, that's $21,600 wasted." },
      { type: "text", content: "Even if aggressive blocking accidentally prevents 2-3 real potential customers per month from seeing your ad, you're still coming out thousands of dollars ahead. Those 2-3 missed opportunities are a fraction of the $1,800+ you're saving by blocking fraudsters." },
      { type: "text", content: "Set Click Guard to aggressive mode for high-CPC campaigns. Enable VPN blocking, device fingerprint tracking, and set your click threshold to 2-3 visits. The small risk of over-blocking is nothing compared to the massive savings from stopping fraud." },
    ],
  },

  "tracking": {
    title: "Tracking & Measurement: Stop Flying Blind",
    subtitle: "If you're not tracking every conversion, every call, and every dollar spent versus earned, you're guessing — and guessing with a $3,000/month ad budget is a fast way to go broke.",
    accentColor: "yellow",
    prevSection: { slug: "ip-exclusions", title: "IP Exclusions" },
    nextSection: { slug: "click-fraud", title: "Click Fraud" },
    blocks: [
      { type: "heading", content: "Conversion Tracking Is Absolutely Non-Negotiable" },
      { type: "text", content: "Without conversion tracking, Google cannot optimize your campaigns and you cannot tell which keywords actually generate revenue. You're spending thousands per month completely blind." },
      { type: "text", content: "Track every conversion action on your website:" },
      { type: "list", items: [
        "Phone calls — both click-to-call from the ad and calls from your landing page",
        "Form submissions — contact forms, quote request forms, scheduling forms",
        "Chat messages — if you use a live chat widget on your site",
        "Booked appointments — if you use online scheduling software",
      ] },
      { type: "text", content: "Install Google Tag Manager on your website first — it makes adding and managing tracking tags dramatically easier without needing to edit your website code every time. Your web developer can set this up in 30 minutes." },

      { type: "heading", content: "Call Tracking Is Essential for Contractors" },
      { type: "text", content: "For most contractors, phone calls are 70-80% of your leads. If you're not tracking which keywords generated which calls, you're optimizing blind." },
      { type: "text", content: "Use a call tracking service (CallRail, WhatConverts, or even Google's own call forwarding numbers) to assign unique phone numbers to your landing pages. This tells you exactly which keyword, which ad, and which campaign generated each call." },
      { type: "text", content: "A keyword with 100 clicks and 0 calls is eating your budget — kill it immediately. A keyword with 10 clicks and 5 calls is gold — increase the bid and scale it up. Without call tracking, you can't tell the difference." },

      { type: "heading", content: "Track Cost Per Lead — Not Just Cost Per Click" },
      { type: "text", content: "CPC (cost per click) is a vanity metric. It tells you how much each click costs, but not how much each actual lead costs. Cost per lead is the number that matters." },
      { type: "text", content: "Here's the formula: (Total ad spend ÷ Number of real leads) = Cost per lead. If you spent $3,000 and got 40 real leads (calls + form fills), your cost per lead is $75. For most contractors, a cost per lead under $100-150 is profitable. Above that, something needs fixing — either your landing page isn't converting or your keywords are attracting the wrong people." },

      { type: "heading", content: "Weekly Reviews Are the Minimum" },
      { type: "text", content: "Log into Google Ads at least once per week and check:" },
      { type: "list", items: [
        "Search Terms report — add any irrelevant search queries as negative keywords",
        "Cost per conversion by keyword — pause keywords that cost too much per lead",
        "Device performance — are you getting better results from mobile or desktop?",
        "Location performance — which zip codes/cities are generating the best leads?",
        "Hour-of-day performance — are you wasting money on clicks at 2am?",
        "Click Guard analytics — how much suspicious traffic is being blocked?",
      ] },
      { type: "text", content: "Monthly reviews aren't enough. You can waste thousands in a single week from a bad search term Google started matching your ads to. A 5-minute weekly check can save you hundreds." },

      { type: "heading", content: "Cross-Reference Click Guard with Google Ads Data" },
      { type: "text", content: "Click Guard shows you which IPs are fraudulent, how much of your traffic is suspicious, and your device/country breakdown. Cross-reference this with your Google Ads data." },
      { type: "text", content: "If Click Guard shows 20% suspicious traffic on a campaign but Google shows 0% invalid clicks filtered, you know exactly how much money Google is failing to protect. This data is powerful when evaluating whether Google Ads is truly working for your business or if a significant portion of your budget is being wasted on fraud that Google refuses to acknowledge." },
    ],
  },

  "click-fraud": {
    title: "Click Fraud: The Hidden Budget Killer",
    subtitle: "Up to 25-33% of all Google Ads clicks in the contractor space are fraudulent. This isn't paranoia — it's documented by multiple independent studies. Here's everything you need to know about who's stealing your ad budget and how to stop them.",
    accentColor: "green",
    prevSection: { slug: "tracking", title: "Tracking & Measurement" },
    nextSection: { slug: "mistakes", title: "Costly Mistakes" },
    blocks: [
      { type: "heading", content: "Who's Actually Clicking Your Ads?" },
      { type: "text", content: "Only about 10-25% of the people clicking your Google Ads are real potential customers. Let that sink in. For every $100 you spend, only $10-25 is going toward reaching real people who might actually hire you. The rest goes to:" },
      { type: "list", items: [
        "Telemarketers (about 1/3 of fraud) — clicking your ad to get your phone number so they can sell you SEO services, marketing packages, insurance, or other garbage. They click, grab your number, and call you pretending to be a customer before pitching their service.",
        "Competitors (about 1/3 of fraud) — deliberately clicking your ads to drain your daily budget so their ads show instead. At $40-50 per click, 3-5 daily clicks from competitors costs you $120-250/day. Some hire people overseas to do this systematically.",
        "Bots and click farms (about 1/3 of fraud) — automated scripts and overseas workers clicking ads at scale. Some are targeting you specifically; others are part of larger click fraud operations that hit thousands of advertisers.",
        "Accidental clicks — people who click your ad by mistake, realize they don't need a contractor, and immediately leave. You still pay full price for these clicks.",
      ] },

      { type: "heading", content: "How to Spot Click Fraud in Your Account" },
      { type: "text", content: "Watch for these red flags in your Google Ads dashboard:" },
      { type: "list", items: [
        "Sudden spike in clicks with no corresponding increase in leads or calls",
        "High click-through rate (CTR) but zero conversions — lots of people clicking but nobody calling",
        "Multiple clicks from the same geographic area in a short time window",
        "Clicks from countries or cities where you don't operate",
        "Suspiciously high bounce rates — people clicking and immediately leaving",
        "Google Ads showing 33-50% more clicks than your website analytics records as actual visitors",
        "Rapid budget depletion early in the day — your daily budget runs out by noon",
      ] },

      { type: "heading", content: "Why Google's Built-In Protection Doesn't Work" },
      { type: "text", content: "Google claims to filter 'invalid clicks' automatically and even refund you for some of them. In reality, their system catches only the most obvious fraud — the low-hanging fruit. Here's what they miss:" },
      { type: "list", items: [
        "VPN users clicking from different IP addresses each time — Google can't connect the clicks",
        "Competitors who space their clicks out over days and weeks instead of clicking rapidly",
        "Sophisticated bots that mimic real human browsing behavior",
        "Device fingerprint masking — tools that make each click look like a different device",
        "Residential proxies — clicks that appear to come from real home internet connections",
      ] },
      { type: "text", content: "Google limits you to only 500 IP exclusions per campaign. For active campaigns in competitive markets, you can burn through that limit quickly. And Google has a fundamental conflict of interest — they make money from every click, including fraudulent ones. Their incentive to catch fraud is limited because catching fraud means refunding money." },
      { type: "text", content: "Read the Google Ad Fraud section in the sidebar for a full investigation into Google's role in ad fraud — it's eye-opening." },

      { type: "heading", content: "The Real Cost of Click Fraud for Contractors" },
      { type: "text", content: "At $30-50 per click (standard for contractor keywords like roofing, plumbing, HVAC), even modest click fraud is devastating:" },
      { type: "list", items: [
        "10 fraudulent clicks per day × $40 average CPC = $400/day wasted",
        "$400/day × 30 days = $12,000 per month going straight to Google with zero return",
        "$12,000/month × 12 months = $144,000 per year in pure waste",
      ] },
      { type: "text", content: "Click Guard pays for itself by blocking even a handful of fraudulent clicks per day. If it blocks just 5 fraudulent clicks per day at $40/click, that's $200/day saved — $6,000/month — $72,000/year redirected from fraud to reaching real customers." },

      { type: "heading", content: "Enable All Click Guard Detection Features" },
      { type: "text", content: "Go to Google Click Guard in the sidebar and make sure every detection feature is enabled:" },
      { type: "list", items: [
        "Device ID tracking — identifies the same device even if the IP address changes",
        "VPN blocking — blocks clicks from known VPN and proxy services",
        "Behavior analysis — detects bot-like browsing patterns (no mouse movement, instant bounces)",
        "Click threshold — set to 2-3 visits; anyone who visits more than that from an ad is suspicious",
        "Aggressive blocking mode — recommended for high-CPC campaigns (roofing, HVAC, plumbing)",
        "Google Ads sync — automated script that pushes blocked IPs to your campaigns every hour",
      ] },
      { type: "text", content: "Link your Google Ads account using the automated sync script on the 'Link Google Ads' tab. This ensures blocked IPs are pushed to your campaigns automatically without any manual work." },
    ],
  },

  "mistakes": {
    title: "Costly Mistakes That Will Wreck Your Budget",
    subtitle: "These are the mistakes that waste the most money in contractor Google Ads. Avoid every single one and you're already ahead of 80% of your competitors who are making most of these errors right now.",
    accentColor: "yellow",
    prevSection: { slug: "click-fraud", title: "Click Fraud" },
    nextSection: undefined,
    blocks: [
      { type: "heading", content: "Mistake #1: Leaving Google Search Partners ON" },
      { type: "warning", content: "We cannot stress this enough. This single checkbox can consume 90% of your budget on worthless traffic from random blogs, emails, and affiliate websites. Go to Campaign Settings → Networks → Uncheck 'Include Google search partners.' Do it right now." },

      { type: "heading", content: "Mistake #2: Using Broad Match Keywords" },
      { type: "text", content: "Using the keyword 'roofer' or 'plumber' without quotes or brackets is the equivalent of setting your money on fire. Google will show your ad for every remotely related search — career searches, DIY tutorials, Reddit discussions, salary comparisons — and charge you $40+ for each useless click. Always use \"phrase match\" or [exact match]. This is the difference between paying for 'roofer jobs near me' (worthless) and 'roof repair contractor Seattle WA' (a real customer ready to hire)." },

      { type: "heading", content: "Mistake #3: Letting Google's AI Control Anything" },
      { type: "text", content: "Auto-Apply recommendations, AI Max search term matching, automatically created assets, Smart Bidding on new campaigns, Performance Max — all of these features exist to increase Google's revenue by increasing your click volume. More clicks = more revenue for Google, regardless of whether those clicks become your customers." },
      { type: "text", content: "Turn off every single AI feature. Manage everything manually. The 30 minutes per week you invest in manual campaign management will save you literally thousands of dollars compared to letting Google's algorithms run unchecked." },

      { type: "heading", content: "Mistake #4: Not Building a Negative Keyword List" },
      { type: "text", content: "This is the single biggest ongoing waste of money in contractor Google Ads. Without negative keywords, you pay for clicks from people searching for roofing jobs, plumbing schools, DIY tutorials, free services, and hundreds of other irrelevant searches." },
      { type: "text", content: "Build your negative keyword list BEFORE your first ad runs. Then check your Search Terms report every week and add new negatives. This is not optional — it's the most important weekly maintenance task for any Google Ads campaign." },

      { type: "heading", content: "Mistake #5: Sending Traffic to Your Homepage" },
      { type: "text", content: "Your homepage talks about everything. Your ad is about one specific service in one specific location. When someone clicks an ad for 'roof leak repair Seattle' and lands on your homepage that shows 6 different services, company history, and team bios — they leave. Create a dedicated landing page for every service/location combination you advertise." },

      { type: "heading", content: "Mistake #6: Ignoring Call Quality" },
      { type: "text", content: "Not all leads are equal. If you're not listening to your call recordings (through CallRail or similar), you have no idea whether your ads are generating real buyer calls or junk calls from telemarketers and tire-kickers." },
      { type: "text", content: "If most of your calls are junk, your keywords or ad copy are attracting the wrong audience. Adjust before scaling — don't just throw more money at a broken campaign hoping volume will fix the quality problem." },

      { type: "heading", content: "Mistake #7: Scaling Too Fast" },
      { type: "text", content: "Going from $500/month to $5,000/month overnight rarely works. Google's algorithm needs time to adjust to budget changes, and your team needs to be ready to handle the increased lead volume. If you can't answer every phone call within 2 rings, you're not ready to scale." },
      { type: "text", content: "Scale by 20-30% per week, monitoring your cost per lead and conversion rate at each step. If your cost per lead stays stable as you increase budget, keep scaling. If it jumps, pull back and investigate." },

      { type: "heading", content: "Mistake #8: Not Tracking Return on Ad Spend (ROAS)" },
      { type: "text", content: "You should know your ROAS to the dollar. If you spend $3,000 on ads and close $45,000 in jobs from those leads, your ROAS is 15x. Track this monthly." },
      { type: "text", content: "If ROAS drops below 5x, something needs fixing — your keywords, landing pages, or close rate. Above 10x, you have a money machine — scale aggressively and protect it with Click Guard." },

      { type: "heading", content: "Mistake #9: Chasing Repair Customers Over Replacement" },
      { type: "text", content: "Repair work invites price shoppers who don't want to pay for premium services. They want the cheapest fix, they'll leave bad reviews to leverage discounts, and they often refuse the full replacement even when it's clearly the better option." },
      { type: "text", content: "Target replacement and new installation keywords for higher-value jobs with better customers. A customer isn't always a customer worth having — don't waste your ad budget attracting people who will make your life difficult and leave a 1-star review because you wouldn't give them a 50% discount." },

      { type: "divider" },

      { type: "heading", content: "Campaign Launch Checklist" },
      { type: "text", content: "Before you turn on your first campaign, verify every single one of these settings. Items marked CRITICAL will waste thousands of dollars if left unchecked." },
      { type: "image", src: imgChecklist, caption: "Your complete Campaign Launch Checklist — verify every setting before turning on your campaign" },
    ],
  },
};

const SECTION_ORDER = [
  "campaign-setup", "features-to-avoid", "assets", "keywords",
  "location", "bidding", "ad-copy", "landing-pages",
  "ip-exclusions", "tracking", "click-fraud", "mistakes",
];

export default function GoogleAdsGuideSection() {
  const [, params] = useRoute("/google-ads-guide/:section");
  const sectionSlug = params?.section || "";
  const section = SECTIONS[sectionSlug];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [sectionSlug]);

  if (!section) {
    return (
      <div className="h-full overflow-y-auto bg-background text-foreground">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Section not found</h2>
          <Link href="/google-ads-guide">
            <Button className="bg-[#4285F4] text-white">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Google Ads Guide
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const accentMap: Record<string, { text: string; bg: string; border: string }> = {
    blue: { text: "text-[#4285F4]", bg: "bg-[#4285F4]/10", border: "border-[#4285F4]/20" },
    green: { text: "text-[#34A853]", bg: "bg-[#34A853]/10", border: "border-[#34A853]/20" },
    yellow: { text: "text-[#FBBC05]", bg: "bg-[#FBBC05]/10", border: "border-[#FBBC05]/20" },
  };
  const accent = accentMap[section.accentColor] || accentMap.blue;
  const currentIdx = SECTION_ORDER.indexOf(sectionSlug);
  const sectionNumber = currentIdx + 1;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <Link href="/google-ads-guide">
              <Button variant="ghost" className="-ml-3 mb-4" data-testid="button-back-to-guide">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Google Ads Guide
              </Button>
            </Link>

            <div className="flex items-center gap-3 mb-3">
              <Badge className={`${accent.bg} ${accent.text} ${accent.border} px-3 py-1 animate-in animate-badge-glow`}>
                Section {sectionNumber} of {SECTION_ORDER.length}
              </Badge>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-3 animate-in-delay-1" data-testid="text-section-title">
              {section.title}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-3xl animate-in-delay-2" data-testid="text-section-subtitle">
              {section.subtitle}
            </p>
          </div>

          <div className="space-y-6">
            {section.blocks.map((block, idx) => {
              switch (block.type) {
                case "heading":
                  return (
                    <h2 key={idx} className="text-lg sm:text-xl font-bold text-foreground pt-4 border-t border-border mt-8 first:mt-0 first:border-0 first:pt-0 stagger-item" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`heading-${idx}`}>
                      {block.content}
                    </h2>
                  );
                case "text":
                  return (
                    <p key={idx} className="text-sm text-muted-foreground leading-relaxed stagger-item" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`text-${idx}`}>
                      {block.content}
                    </p>
                  );
                case "warning":
                  return (
                    <Card key={idx} className=" bg-gradient-to-r from-[#FBBC05]/10 to-[#4285F4]/10 border-[#FBBC05]/20 stagger-item" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`warning-${idx}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 text-[#FBBC05] flex-shrink-0 mt-0.5 animate-pulse-soft" />
                          <p className="text-sm text-muted-foreground leading-relaxed">{block.content}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                case "tip":
                  return (
                    <Card key={idx} className=" bg-gradient-to-r from-[#34A853]/5 to-[#4285F4]/5 border-[#34A853]/20 stagger-item" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`tip-${idx}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <CheckCircle className="h-5 w-5 text-[#34A853] flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-muted-foreground leading-relaxed">{block.content}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                case "image":
                  return (
                    <div key={idx} className="my-6 rounded-xl overflow-hidden border border-border shadow-2xl stagger-item card-hover-glow" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`image-${idx}`}>
                      <img
                        src={block.src}
                        alt={block.caption || "Google Ads screenshot"}
                        className="w-full h-auto"
                        loading="lazy"
                      />
                      {block.caption && (
                        <div className="bg-muted px-4 py-3 border-t border-border">
                          <p className="text-xs text-muted-foreground flex items-center gap-2">
                            <Eye className="h-3.5 w-3.5 flex-shrink-0" />
                            {block.caption}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                case "list":
                  return (
                    <ul key={idx} className="space-y-2 pl-1 stagger-item" style={{ animationDelay: `${0.2 + idx * 0.03}s` }} data-testid={`list-${idx}`}>
                      {block.items?.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                          <ChevronRight className={`h-4 w-4 ${accent.text} flex-shrink-0 mt-0.5`} />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  );
                case "divider":
                  return <hr key={idx} className="border-border my-8" />;
                default:
                  return null;
              }
            })}
          </div>

          <div className="flex items-center justify-between mt-12 pt-6 border-t border-border">
            {section.prevSection ? (
              <Link href={`/google-ads-guide/${section.prevSection.slug}`}>
                <Button variant="ghost" className="" data-testid="button-prev-section">
                  <ArrowLeft className="h-4 w-4 mr-2" /> {section.prevSection.title}
                </Button>
              </Link>
            ) : <div />}

            {section.nextSection ? (
              <Link href={`/google-ads-guide/${section.nextSection.slug}`}>
                <Button className="bg-[#4285F4] hover:bg-[#3367D6] text-white" data-testid="button-next-section">
                  {section.nextSection.title} <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            ) : (
              <Link href="/google-ads">
                <Button className="bg-gradient-to-r from-[#4285F4] to-[#34A853] text-white" data-testid="button-go-click-guard">
                  <ShieldCheck className="h-4 w-4 mr-2" /> Set Up Click Guard
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
