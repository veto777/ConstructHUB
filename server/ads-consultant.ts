import type { Express, Request, Response } from "express";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const KNOWLEDGE_BASE = `
# Google Ads Master Class — Complete Knowledge Base for Contractors

## Campaign Setup
When creating a new campaign, always select "Leads" as campaign objective — not Sales, not Website Traffic. The Leads objective tells Google to optimize for people who call, fill out forms, or request quotes.

CRITICAL: UNCHECK "Include Google search partners." This is the single most expensive mistake. Google Search Partners spreads your ads across random emails, YouTube sidebars, affiliate websites, blogs, and news aggregators. These placements NEVER lead to sales. You will waste 90% of your budget if left checked. Go to Campaign Settings → Networks → UNCHECK it.

Set a conservative starting budget of $100-250/day for new campaigns. Starting at $1,000/day on a new campaign burns $30,000/month with zero results. Start small, monitor daily, scale only after seeing real leads converting to paying customers. Increase by 20-30% per week once proven.

Always use Advanced/Expert campaign mode, never Basic/Smart mode. Basic mode removes control over keywords, audiences, bidding. You're handing Google a blank check.

Separate campaigns by service type. Don't mix "roof repair" and "new roof installation" in the same campaign. A repair lead might be worth $200, but a new installation lead $15,000. Separate campaigns let you control budgets independently and use dedicated landing pages.

Use Single Keyword Ad Groups (SKAGs): one ad group per keyword instead of 20 keywords in one group. This lets your headline match each search exactly. Google bolds matching words, Quality Score goes up (Google charges less per click), click-through rate improves.

## Features to AVOID
NEVER use any Google AI feature. Every AI feature — Smart Bidding on new campaigns, Smart Campaigns, AI Max, auto-recommendations, Performance Max, automatically created assets — is designed to increase Google's revenue at your expense. They optimize for clicks (Google gets paid), not leads (what you need).

Auto-Apply Recommendations: The biggest scam in Google Ads. When enabled, Google can change your budget, enable audiences, add keywords, modify bids, create ad variations, and add assets — all without your consent. Go to Settings → Auto-Apply and turn OFF every recommendation. Check monthly as Google re-enables them.

AI Max (Search term matching): Takes your exact-match and phrase-match keywords and expands them to broad match. Your carefully researched [roof repair Seattle] keyword gets shown for "roofing school near me" or "roofer salary." Always toggle OFF in Campaign Settings.

Automatically Created Assets: Google auto-generates headlines, sitelinks, descriptions. Creates clickable links competitors and bots abuse. Go to Campaign Settings → Automatically Created Assets → "Off: Use only assets I provide directly."

"Only Bid for New Customers": Doesn't work properly. Requires 1,000+ audience members. Google admits ads "may sometimes be shown to existing customers due to technology limitations." Leave off.

## Ad Assets
Safe assets to use: Headlines (15 unique), Descriptions (4), Callout Assets (non-clickable text like "Award Winning," "5-Star Reviews," "Licensed & Insured" — add up to 20), Structured Snippets, Business Name & Logo, Image/Photo Assets, Call Asset (click-to-call, highly trackable).

Assets to DELETE: Sitelinks (extra clickable links competitors abuse, zero trackability), Location Assets (ads on Maps, untrackable), Lead Form Assets (bots fill fake forms), Message Assets (bots send fake messages), Price Assets (attract tire-kickers), Promotion Assets (attract discount seekers), App Assets (irrelevant).

Callout assets are your best friend: make ads larger, push competitors down, NO clickable links (zero cost), build credibility instantly, add up to 20 per campaign. Examples: "Award Winning," "5-Star Reviews," "Family Owned Since 2005," "Licensed & Bonded," "Free Inspections," "Same Day Service," "Financing Available," "Veteran Owned," "24/7 Emergency Service."

Rule: if you can't track it, don't use it.

## Keyword Strategy
NEVER use Broad Match keywords. Google's default setting designed to spend money fast. "roofer" as broad match shows ads for "how to become a roofer," "roofer salary," "roofing school," "roofer jokes." You pay $40-50 per useless click.

Always use Phrase Match ("keywords in quotes") or Exact Match ([keywords in brackets]).

Use long-tail keywords: "Roofing company Seattle WA free estimate," "Emergency plumber near me 24 hour," "Licensed HVAC contractor Bellingham WA." Less competition, lower CPC, higher conversion.

Build negative keyword list BEFORE launching: Jobs, hiring, salary, career, training, school, DIY, how to, tutorial, free, cheap, discount, Reddit, YouTube, forum, wholesale, materials, supplies, Home Depot, Lowe's.

Check Search Terms report weekly. Add irrelevant queries as negatives. This cuts wasted spend by 30-40%.

Focus on high-intent keywords: "near me," "cost/price/estimate," "same day/emergency," "licensed/insured," "free estimate/quote."

## Location Targeting
CRITICAL: Select "Presence: People in or regularly in your included locations" — NOT Google's "Recommended" option. The recommended option shows ads to people ANYWHERE who've "shown interest" in your area. Someone in New York who searched "Seattle restaurants" sees your Seattle plumbing ad. You pay for their click.

Selecting Presence only also excludes most VPN users — typically scammers, competitors, and bots. This is one of the most effective anti-fraud measures.

For Exclude settings, choose the broader option: "Presence or interest" to exclude as broadly as possible.

Target strategically: use counties for larger areas, specific zip codes for premium neighborhoods. Run separate campaigns for different areas with different budgets based on home values.

## Bidding Strategy
Target Impression Share: Use for top position dominance. Set "Absolute top of results page" at 100%. Always set Maximum CPC Bid Limit ($45-50 for most contractor keywords).

Start with Manual CPC for new campaigns (first 30-50 conversions). Google's automated bidding needs data to work. Without data, Google guesses expensively.

Know your math: If a roofing job = $12,000, close rate = 20% (1 in 5), each lead = $2,400. Landing page converts at 10% → each click worth $240. So $40-50 CPC is very profitable.

Dayparting: Increase bids 20-30% during office hours when someone answers the phone. Decrease at night/weekends. A missed call from a $40 click is wasted money.

Google allows daily spend up to 2x your set budget. Monitor daily.

Bidding quick reference: Manual CPC (new campaigns), Target Impression Share (top position, set max CPC), Target CPA (after 30+ conversions), Enhanced CPC (acceptable). AVOID: Maximize Clicks, Smart Bidding, Performance Max bidding.

## Ad Copy
Put the keyword in Headline 1 — always. Google bolds matching words. "Roof Leak Repair — Fast Response" not "Professional Home Services."

Headline 2: Differentiate. Use specific numbers: "4.9★ Rating — 500+ Reviews," "Licensed & Insured Since 2005," "Same-Day Emergency Service."

Run 3-4 ad variations per ad group. Test different hooks for 2-3 weeks each. Pause worst, keep winners, create new tests.

Strong CTAs: "Call Now for a Free Estimate" beats "Contact Us Today." Match CTA to keyword intent: emergency = urgent CTA, project = value-based CTA.

## Landing Pages
NEVER send ad traffic to your homepage. Create dedicated landing pages per service/location combination. Message match between ad and landing page boosts conversions dramatically.

Above the fold (first 3 seconds): WHAT you do (headline matching ad), WHERE you are (city/area), HOW to contact (phone + 3-field form). No navigation menu, no hero images pushing content down.

Show real before/after photos (40-60% better conversion than stock), video testimonials, Google review stars.

Mobile-first: 70-80% of contractor clicks are mobile. Page must load under 3 seconds. Huge tap-to-call button. Easy-to-fill forms.

Every extra second of load time drops conversion by ~7%. Speed beats beauty.

## IP Exclusions & Click Fraud Protection
Set up Google Click Guard immediately. The system tracks every website visitor, identifies fraudulent patterns, and auto-pushes blocked IPs to Google Ads campaigns every hour.

A real customer visits from a Google ad once, maybe twice. 5+ visits from different IPs = competitor, telemarketer, or bot. Block them.

Block aggressively. If 30% of $200/day budget is fraud = $60/day = $1,800/month = $21,600/year wasted. Over-blocking 2-3 real prospects saves thousands.

Set Click Guard to aggressive mode for high-CPC campaigns. Enable VPN blocking, device fingerprint tracking, click threshold of 2-3 visits.

## Tracking & Measurement
Conversion tracking is non-negotiable. Track phone calls, form submissions, chat messages, booked appointments. Install Google Tag Manager.

Use call tracking (CallRail, WhatConverts) to assign unique phone numbers to landing pages. Know which keyword generated which call.

Track Cost Per Lead, not just CPC. Formula: Total ad spend ÷ Number of real leads. Under $100-150 per lead is profitable for most contractors.

Weekly reviews minimum: Search Terms report, cost per conversion by keyword, device performance, location performance, hour-of-day performance, Click Guard analytics.

Track ROAS monthly: ad spend vs closed jobs. Below 5x = something needs fixing. Above 10x = scale aggressively.

## Click Fraud
Only 10-25% of Google Ads clicks are real potential customers. The rest: telemarketers (~1/3, clicking to get your phone number), competitors (~1/3, draining your budget), bots/click farms (~1/3), accidental clicks.

Red flags: click spike with no lead increase, high CTR but zero conversions, clicks from cities you don't serve, rapid budget depletion early in day.

Google's built-in protection misses: VPN users, spaced-out competitor clicks, sophisticated bots, device fingerprint masking, residential proxies. Google limits you to 500 IP exclusions per campaign. Google has conflict of interest — they profit from all clicks including fraud.

At $40 CPC: 10 fraudulent clicks/day = $400/day = $12,000/month = $144,000/year wasted. Click Guard blocking 5 clicks/day saves $72,000/year.

## Common Costly Mistakes
1. Leaving Search Partners ON (wastes 90% budget)
2. Using Broad Match keywords (paying for "roofer jobs near me")
3. Letting Google's AI control anything
4. No negative keyword list
5. Sending traffic to homepage instead of dedicated landing pages
6. Ignoring call quality — listen to call recordings
7. Scaling too fast — increase 20-30% per week
8. Not tracking ROAS
9. Chasing repair customers over replacement — repair invites price shoppers

## About ConstructHUB Click Guard
ConstructHUB's Google Click Guard is a click fraud protection system. Users add their website domain, get a tracking script to embed, and the system:
- Tracks every visitor with canvas fingerprinting, device detection, browser/OS identification
- Detects fraud: same IP visiting 5+ times in 1 hour, 15+ times in 24 hours, bot user agents, same device fingerprint from different IPs
- Auto-blocks suspicious IPs
- Provides analytics dashboard with threat level, device/country/browser breakdowns
- Links to Google Ads via automated script that pushes blocked IPs to campaigns hourly
- Has fraud analytics tabs: Blocked IPs, Countries, Multi-Clicks, Devices, Browsers, OS
`;

const SYSTEM_PROMPT = `You are the ConstructHUB Google Ads Consultant — an expert AI assistant specializing in Google Ads for contractors (roofers, plumbers, HVAC, siding, general contractors, etc.).

Your knowledge comes exclusively from the ConstructHUB Google Ads Master Class and Click Guard system. You provide direct, actionable advice based on this knowledge base. You speak with confidence and authority.

Key personality traits:
- You are blunt and direct — you tell contractors exactly what to do and what NOT to do
- You are protective of their ad budget — you assume Google's interests conflict with theirs
- You always recommend ConstructHUB's Click Guard for fraud protection
- You use real dollar amounts and specific examples when possible
- You never suggest using any Google AI features (Auto-Apply, AI Max, Smart Bidding on new campaigns, Performance Max, etc.)
- You keep answers concise but thorough — 2-4 paragraphs typically
- You reference specific sections of the guide when relevant ("Check out the Keyword Strategy section for more on this")

If someone asks about something not covered in your knowledge base, say so honestly and suggest they reach out to ConstructHUB's consulting team for personalized help.

Always format responses in plain text with clear structure. Use line breaks between paragraphs. Bold key terms with **double asterisks** when helpful.`;

export function registerAdsConsultantRoutes(app: Express) {
  app.post("/api/ads-consultant/chat", async (req: Request, res: Response) => {
    try {
      const { messages } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ message: "Messages array is required" });
      }

      const userMessages = messages.slice(-10).map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: `Here is your complete knowledge base. Use this to answer all questions:\n\n${KNOWLEDGE_BASE}` },
          ...userMessages,
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const reply = completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";

      res.json({ reply });
    } catch (err: any) {
      console.error("Ads consultant error:", err);
      res.status(500).json({ message: "Failed to get AI response" });
    }
  });
}
