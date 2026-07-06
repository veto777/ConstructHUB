import type { Express, Request, Response } from "express";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const KNOWLEDGE_BASE = `
# ConstructHUB — Complete Platform Knowledge Base

ConstructHUB (constructhub.us) is the one-stop shop for construction professionals — whether you're starting a construction business from scratch or scaling an existing one. It's everything you need in one platform: permit data, Google Business tools, advertising protection, competitor intelligence, and complete business education from LLC formation to marketing domination. No experience needed. We take you from zero to a fully operational, lead-generating construction business.

## Pricing & Plans
- **Standard Plan**: $15/month — 50 permit searches, 5 GMB photo optimizations, 3 ranking grids, basic monitoring, email support
- **Professional Plan**: $30/month — 200 permit searches, 25 GMB photo optimizations, 10 ranking grids, property records, priority email support
- **Business Plan**: $50/month — 350 permit searches, 50 GMB photo optimizations, 15 ranking grids, scrape scheduling, property records, Google Click Guard (1 site), priority support
- **Premium Plan**: $100/month — 500 permit searches, unlimited photos, 25 ranking grids, Click Guard (3 sites), IP Tracker (1 site), dedicated support
- **Gold Plan**: $499/month — Unlimited everything, IP Tracker, VPN Shield, Competitor Intel (1 site), 2 users, priority support
- **Platinum Plan**: $995/month — Unlimited everything, Competitor Intel (10 sites), IP Tracker (10 sites), VPN Shield (10 sites), expert consulting, 5 users, dedicated support
- **First Page SEO**: $3,000/month (6-month minimum) — 1-2 keywords on Google's first page in 4-6 months.
- **SEO Growth**: $6,000/month (6-month minimum) — Guaranteed top 3 positions for 1-2 keywords in 6-9 months. Bank account payment available.
- **SEO Domination**: $10,000/month (6-month minimum) — Guaranteed top 3 positions for 3-5 keywords in 6-9 months. Bank account payment available.
- **Done-For-You Business Formation**: Starting at $5,500 — LLC setup, licensing, bonding, insurance handled for you
- **Done-For-You Marketing Management**: Starting at $9,999 — Complete digital marketing management
- Free trial available for new users to explore the platform

## Permits & Databases
ConstructHUB aggregates permit databases from all 50 states plus DC. The platform covers 3,139 counties with 32,864 permit database entries spanning 29,838 cities and 3,026 county-level jurisdictions.

### Permit Search
- Cross-database search across all 50 states
- Filter by state, county, city, permit type
- Real-time and scheduled scraping of government permit systems
- Data deduplication ensures clean results
- Search history tracking to revisit past queries

### Database Directory
- Filterable directory of all 32,864 permit databases
- Direct portal links to official government permit systems
- Coverage information for each jurisdiction
- Organized by state and county

### Property Records
- Access to county property appraiser records nationwide (3,139 counties covered — every US county)
- Look up ownership details, assessed values, construction history, tax records
- Direct links to official government property appraiser portals
- Searchable fields include owner info, LLC status, property values, lot size, sales records, tax details, exemptions

### Scrape Schedules
- Schedule automated data collection from permit databases
- Set frequency (daily, weekly, monthly)
- Monitor scrape status and results
- Automatic data deduplication

## Google Business Profile (GBP) Tools

### GMB Monitor
- Monitor your Google Business Profile listings
- AI-powered review response generator — automatically draft professional responses to customer reviews
- Track review count, ratings, and trends over time

### GMB Ranking Grid
- Visualize your local search rankings on a geographic grid
- See exactly where you rank for target keywords in different locations
- Track ranking changes over time
- Identify areas where you need to improve visibility

### SEO Photo Optimizer
- Optimize photos for Google Business Profile with AI-generated SEO descriptions
- Proper metadata helps photos rank in Google image search
- Increase visibility and attract more local customers

### Locations Manager
- Manage multiple business locations from one dashboard
- GBP analytics for each location
- Import location details via Google Places API
- Citation campaign tools to build consistent business listings across the web

### GBP Reinstatement Service
- Help getting suspended Google Business Profiles reinstated
- Expert guidance through Google's reinstatement process
- Common suspension reasons and how to address them

### LSA (Local Services Ads) Setup Guide
An 8-section expert guide covering everything contractors need to know about Google's Local Services Ads (the "Google Guaranteed" badge):
1. Verification process and requirements
2. Call answering strategy for maximum lead conversion
3. Getting and leveraging reviews
4. Service selection traps to avoid
5. Handling message leads effectively
6. Service areas and hours optimization
7. Photos with people and branding tips
8. Business bio and trust signals

## Google Ads Tools

### Google Click Guard (Click Fraud Protection)
Protects your Google Ads budget from fraudulent clicks:
- Embeddable tracking script for your website
- Fraud analytics dashboard showing threat levels
- Traffic Sources tab showing referrer breakdown by domain/vendor with percentage, page loads, and unique visitors
- Tracks visitors with canvas fingerprinting, device detection, browser/OS identification
- Detects fraud patterns: repeated visits, bot user agents, same fingerprint from different IPs
- Auto-blocks suspicious IPs and pushes exclusions to Google Ads campaigns hourly
- Google Ads IP exclusion integration
- Configurable detection thresholds and settings
- At $40 CPC, blocking just 5 fraudulent clicks/day saves $72,000/year

### Google Ad Fraud (Exposé Page)
Educational content revealing the truth about click fraud in Google Ads:
- 9 expandable investigation sections with real data
- Stat cards showing fraud percentages and dollar impact
- "Google Excuses vs Reality" comparison table
- Action items contractors can take immediately
- Only 10-25% of Google Ads clicks are real potential customers

### Google Ads Master Class Guide
A comprehensive 12-section course covering everything contractors need to know:
1. Campaign setup — always choose "Leads" objective, uncheck Search Partners
2. Features to avoid — never use Google AI features, Auto-Apply, AI Max, Smart Campaigns
3. Ad assets — which to use (callouts, headlines) and which to delete (sitelinks, lead forms)
4. Keyword strategy — use Phrase/Exact match only, never Broad Match, build negative keyword lists
5. Location targeting — always use "Presence" only, never "Recommended"
6. Bidding strategies — start with Manual CPC, move to Target Impression Share
7. Ad copy best practices — put keyword in Headline 1, use specific numbers
8. Landing page optimization — never send traffic to homepage, mobile-first design
9. IP exclusions and Click Guard setup
10. Tracking and measurement — conversion tracking, call tracking, ROAS
11. Click fraud deep dive
12. Common costly mistakes to avoid

### AI Ads Consultant Chat Bot
Available on all Google Ads pages — a floating chat widget powered by OpenAI with the full Master Class content as its knowledge base. Provides instant answers about campaign setup, keyword strategy, click fraud protection, bidding, and more.

## IP Tracker
A full visitor tracking dashboard (modern TraceMyIP replacement):
- Shares tracked domains and visit data with Click Guard
- Dashboard with online visitors, daily stats, project list
- Visitor List with paginated, expandable detail including system specs, fingerprint, geo, activity timeline
- Traffic Sources showing referrer breakdown by domain
- Pages tab showing landing page hit counts
- Geo tab with country/city breakdown
- Platforms tab with browser/OS/device/resolution breakdown
- Purple/violet accent color scheme

## VPN Shield
A standalone VPN/proxy blocker:
- Generates an embeddable script that detects VPN/proxy visitors
- Detection methods: WebRTC IP leak detection, timezone/geolocation mismatch, datacenter IP range matching, VPN browser extension detection
- Identifies major VPN providers (NordVPN, ExpressVPN, Surfshark, etc.)
- Detects datacenter IPs (AWS, Digital Ocean, Linode, etc.)
- Blocks or redirects VPN users while automatically whitelisting search engine crawlers (Google, Bing, Yahoo are NEVER blocked)
- Features: Overview with educational content, Blocked Visitors log, Install Script, Settings (block/log/redirect modes, whitelisted IPs)
- Protects analytics data from being polluted by VPN users
- Identifies competitors who try to anonymously snoop on your site
- Red/orange accent color scheme

## Competitor Intelligence (Platinum Plan)
- Market scans to track competitor activity
- Ad spy functionality to monitor competitor Google advertising
- Detailed review analysis of competitor businesses
- Google advertising monitoring and competitive insights
- Available exclusively to Platinum tier subscribers

## Master Class — State-by-State Business Guide
A comprehensive guide for starting and running a construction business, covering:
- LLC formation process state by state
- Licensing requirements for each state
- Bonding requirements and how to get bonded
- Insurance requirements (general liability, workers comp, etc.)
- Business management strategies
- Subcontractor management best practices
- Sales techniques for contractors
- Hiring and team building
- Branding and marketing
- Website & SEO fundamentals
- Contractor vetting guide

## Settings & Account
- Profile management with email/password updates
- Google OAuth login support
- Email verification and password reset via email
- Theme toggle (light/dark mode)
- Session management

## Done-For-You Services (Premium)
For contractors who want everything handled:
- **Business Formation Package** ($5,500+): LLC creation, state licensing, bonding, insurance, bank account setup
- **Marketing Management** ($9,999+): Complete Google Ads management, SEO, GBP optimization, review management
- **First Page SEO** ($3,000/month × 6 months): 1-2 keywords on Google's first page in 4-6 months
- **SEO Growth** ($6,000/month × 6 months): Guaranteed top 3 for 1-2 keywords in 6-9 months
- **SEO Domination** ($10,000/month × 6 months): Guaranteed top 3 for 3-5 keywords in 6-9 months
- **Consulting**: One-on-one strategy sessions with construction marketing experts

## Technical Details
- Platform runs as a modern web application with React frontend and Express backend
- PostgreSQL database for reliable data storage
- Real-time data scraping using Playwright headless browser automation
- Stripe payment processing for secure checkout
- Google OAuth for easy account creation
- Mobile-responsive design that works on all devices
`;

const SYSTEM_PROMPT = `You are the ConstructHUB AI Assistant — a helpful, knowledgeable guide to the ConstructHUB platform. You help visitors understand that ConstructHUB is the ONE-STOP SHOP for construction professionals — whether they're starting a business from absolute scratch or scaling an existing one.

Your knowledge comes exclusively from the ConstructHUB platform knowledge base. You provide clear, friendly, and informative answers.

Key personality traits:
- You ALWAYS emphasize that ConstructHUB is the complete solution — from starting from zero to running a thriving construction business
- You explain that someone with NO experience can use ConstructHUB to form their LLC, get licensed, get bonded, get insured, set up marketing, find leads through permits, and dominate their market
- You are welcoming and professional — you make visitors feel like they've found exactly what they need
- You explain features in simple, non-technical language
- You highlight the value and ROI of ConstructHUB's tools when relevant
- You use real numbers and specifics from the knowledge base (e.g., "32,864 permit databases across all 50 states, covering 3,139 counties")
- You keep answers concise — 2-3 paragraphs typically
- You suggest relevant features when a visitor describes their needs
- If asked about pricing, give specific plan details
- When someone asks "what does ConstructHUB do" — lead with the fact that it's a complete platform to START and RUN a construction business, not just grow one
- If someone asks about something not covered in your knowledge base, say so honestly and suggest they contact the ConstructHUB team

Always format responses in plain text with clear structure. Use line breaks between paragraphs. Bold key terms with **double asterisks** when helpful.

You should enthusiastically but naturally guide visitors toward trying the platform. When appropriate, mention the free trial.`;

export function registerSiteAssistantRoutes(app: Express) {
  app.post("/api/site-assistant/chat", async (req: Request, res: Response) => {
    try {
      const { messages, captchaToken } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ message: "Messages array is required" });
      }

      const userMessageCount = messages.filter((m: any) => m.role === "user").length;

      if (userMessageCount > 3 && !captchaToken) {
        return res.status(429).json({
          message: "Rate limit reached. Please complete the verification to continue.",
          requiresCaptcha: true,
        });
      }

      if (userMessageCount > 3 && captchaToken) {
        const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `secret=6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe&response=${captchaToken}`,
        });
        const verifyData = await verifyRes.json() as any;
        if (!verifyData.success) {
          return res.status(403).json({ message: "Captcha verification failed" });
        }
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
        max_tokens: 800,
      });

      const reply = completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";

      res.json({ reply });
    } catch (err: any) {
      console.error("Site assistant error:", err);
      res.status(500).json({ message: "Failed to get AI response" });
    }
  });
}
