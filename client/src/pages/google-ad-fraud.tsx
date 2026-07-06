import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, ShieldCheck, ShieldAlert, Ban, Users, BarChart3,
  AlertTriangle, CheckCircle, X, Search, Download,
  Fingerprint, Bot, Link2, GraduationCap,
  ChevronRight, FileText, Skull, ChevronDown, Scale, Flame,
  Siren, Network, PhoneOff,
} from "lucide-react";
import googleAdsLogo from "@assets/google-ads-logo.png";

export default function GoogleAdFraudPage() {
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggleSection = (id: string) => {
    setOpenSection(openSection === id ? null : id);
  };

  const sections = [
    {
      id: "the-big-lie",
      icon: Skull,
      color: "text-[#4285F4]",
      bg: "bg-[#4285F4]/10",
      borderColor: "border-[#4285F4]/20",
      title: "The Big Lie: \"We Block Invalid Clicks\"",
      subtitle: "Google claims to protect advertisers from fraudulent clicks. Our research proves otherwise.",
      content: [
        {
          heading: "Google Does NOT Block Competitor Clicks",
          text: "Google claims they block \"invalid clicks\" from competitors. This is a carefully crafted lie. Google's own systems allow the same competitor to click your ads multiple times a day, every single day, as long as the clicks are spaced a few minutes apart. They call this \"legitimate interest\" — a competitor researching your business. In reality, it's budget drain that Google directly profits from. They make money every time someone clicks your ad. Why would they stop it?"
        },
        {
          heading: "The Numbers Don't Lie",
          text: "We deployed one of the most advanced IP tracking systems on the planet across dozens of contractor accounts. The results were devastating: Google Ads consistently reported 33% to 50% MORE clicks than our IP tracker detected — and our tracker captured every single ad click. Google's explanation? They claimed traffic was being sent to \"ad extensions\" despite zero ad extensions being visible on the actual ads and all location extensions being disabled. There are only two explanations: either Google is fabricating click numbers, or they're counting phantom interactions at their discretion."
        },
        {
          heading: "Why Google Removed IP Tracking",
          text: "Google used to share the IP addresses of everyone who clicked your ads. Then they removed this feature. They claimed it was for \"privacy.\" But here's the real reason: when advertisers could see IPs, they could prove fraud. They could show the same IPs clicking their ads 10, 20, 50 times. They could prove competitors were draining their budgets. Google realized this transparency was exposing them, so they killed it. Now you have to buy your own IP tracking tool — and when you do, Google argues that YOUR tracking tool isn't reliable. Convenient."
        },
        {
          heading: "Half of Google's Revenue Comes From Fraud",
          text: "Think about Google's business model. They make money per click. Competitors clicking ads is pure profit — Google gets paid, the advertiser gets nothing. Industry research estimates that fraudulent and invalid clicks account for a massive portion of Google Ads revenue. Google makes approximately half its advertising money from clicks that will never convert into customers. That's not a bug — it's a business model. Why would the biggest advertising company on earth shut down its biggest revenue stream?"
        },
      ],
    },
    {
      id: "bot-farms",
      icon: Bot,
      color: "text-[#34A853]",
      bg: "bg-[#34A853]/10",
      borderColor: "border-[#34A853]/20",
      title: "Bot Farms & Fake Traffic: Google Knows and Does Nothing",
      subtitle: "We recorded visitor behavior. What we found will make your blood boil.",
      content: [
        {
          heading: "80% of Recorded Visitors Were Bots",
          text: "We installed screen recording software that captures every visitor's mouse movements, clicks, scrolls, and behavior on our clients' websites. After analyzing thousands of sessions from Google Ads traffic, the results were staggering: approximately 80% of the recorded behavior was clearly not human. These weren't real people — they were bots. The behavior was unmistakable: instant bounces, robotic mouse movements that covered just enough distance to mimic a real user, or completely static sessions with zero interaction. These bots are sophisticated enough to trigger a \"click\" in Google's system but provide zero value to the advertiser."
        },
        {
          heading: "Google Can Track Bots — It Chooses Not To",
          text: "Here's what makes this criminal: Google absolutely has the technology to identify and block bots. Google owns reCAPTCHA. Google owns one of the world's most advanced AI systems. Google can tell the difference between a human and a bot in milliseconds. They do it billions of times per day on their own properties. But when it comes to Google Ads clicks? Suddenly their systems \"can't detect\" these bots. The same company that can identify a cat in a blurry photo supposedly can't tell that a visitor who bounces in 0.3 seconds with zero mouse movement isn't a real customer."
        },
        {
          heading: "The Bot Behavior We Documented",
          text: "Our recordings revealed consistent patterns across fraudulent visits: (1) Instant bounces — the page loads and the \"visitor\" leaves within 0-2 seconds, (2) Artificial mouse movements — the cursor moves in unnaturally straight lines, just enough to register as \"engagement,\" (3) Zero scroll depth — real users scroll to read content; bots don't bother, (4) No form interaction — real customers engage with forms, request quotes, or call; bots never do, (5) Repeated patterns — the same behavior signature appears across different IPs, suggesting bot farms cycling through VPN servers."
        },
        {
          heading: "Does Google Run Its Own Bot Farms?",
          text: "This is the question nobody dares to ask publicly. When you see the same artificial behavior patterns coming from thousands of different IPs, all clicking Google Ads, all bouncing immediately — you have to wonder. Google limits you to blocking 500 IPs. Google removed IP transparency. Google's \"invalid click detection\" conveniently misses the vast majority of this traffic. Could Google be operating or enabling bot farms to inflate click revenue? We can't prove it. But the circumstantial evidence is overwhelming, and Google's deliberate opacity makes it impossible to disprove."
        },
      ],
    },
    {
      id: "vpn-tracking",
      icon: Network,
      color: "text-[#FBBC05]",
      bg: "bg-[#FBBC05]/10",
      borderColor: "border-[#FBBC05]/20",
      title: "VPN & Proxy Detection: Google Could Do It, But Won't",
      subtitle: "Google has the most advanced network intelligence on the planet — and pretends it can't track VPNs.",
      content: [
        {
          heading: "Google Knows Every VPN Server on Earth",
          text: "Google operates the largest network infrastructure in the world. They know the IP ranges of every major VPN provider. They know which IPs are data center IPs vs. residential IPs. They have this data because they use it for their own services — try accessing certain Google services from a VPN and you'll get CAPTCHAs or blocks. So Google CAN identify VPN traffic. They just choose not to apply this knowledge to protect advertisers. When a competitor uses NordVPN to click your ad from 5 different IP addresses, Google treats each click as a unique, legitimate user. They could flag this in milliseconds. They won't."
        },
        {
          heading: "Our Tracking Caught What Google Won't",
          text: "Using our IP tracking and device fingerprinting system, we documented the same device fingerprints appearing from multiple different IP addresses — a clear sign of VPN hopping. The same person would click an ad from a New York IP, then an LA IP, then a Chicago IP — all within hours. Our system caught this because we track device fingerprints, not just IPs. Google, with infinitely more data and resources, could do the same. They don't. Because every VPN-hopped click is another $30-50 in their pocket."
        },
        {
          heading: "The Proxy Problem Is Even Worse",
          text: "Residential proxies are the new frontier of click fraud. These services route traffic through real residential IP addresses, making fraudulent clicks look like they come from real homes in your service area. Google's own documentation admits these are hard to detect — but that's a choice, not a limitation. Google processes billions of signals per user. They know a click from a residential proxy in Atlanta that bounces in 0.5 seconds is not a homeowner looking for a roofer. They know. They just don't act on it."
        },
        {
          heading: "The \"People In or Regularly In\" Targeting Scam",
          text: "Google offers a location targeting option called \"People in or regularly in your targeted locations.\" Sounds great, right? Except it doesn't work. We've documented ads being shown to users in completely different states — and when confronted, Google says \"well, our data shows they're interested in your area.\" How do you disprove that? You can't. Google controls the data, Google controls the definition, and Google gets paid regardless of whether the person clicking your ad is in your city or on the other side of the country. This setting creates the illusion of control while giving you none."
        },
      ],
    },
    {
      id: "500-ip-limit",
      icon: Ban,
      color: "text-[#4285F4]",
      bg: "bg-[#4285F4]/10",
      borderColor: "border-[#4285F4]/20",
      title: "The 500 IP Limit: An Artificial Stranglehold",
      subtitle: "Google limits you to blocking just 500 IPs per campaign. Here's why that's deliberate sabotage.",
      content: [
        {
          heading: "Why 500? There's No Technical Reason",
          text: "Google processes billions of ad impressions daily. Their infrastructure handles petabytes of data in real-time. Checking an impression against a list of 5,000 IPs vs. 500 IPs is computationally trivial — we're talking microseconds of difference. Google's claim that larger exclusion lists would \"impact ad-serving efficiency\" is laughable. Your email spam filter checks against millions of rules in milliseconds. A firewall can block millions of IPs with zero latency. The 500 limit exists for one reason: to prevent you from effectively blocking fraud."
        },
        {
          heading: "500 IPs Fills Up in Weeks",
          text: "A typical contractor running Google Ads in a competitive market like roofing, HVAC, or plumbing can identify 100+ suspicious IPs per week. At 500 max, you're full in 5 weeks. Then what? You have to manually rotate IPs, removing old blocks to add new ones — while the old fraudsters come right back. This is by design. Google forces you into a whack-a-mole game that you can never win, because the limit ensures you can never fully protect yourself."
        },
        {
          heading: "Performance Max: You Can't Block ANY IPs",
          text: "It gets worse. Google's newest campaign type — Performance Max — doesn't even support IP exclusions at all. Neither do Demand Gen, Video (YouTube), or Smart Shopping campaigns. Google is actively pushing advertisers toward campaign types where they have ZERO ability to block fraudulent traffic. The message is clear: stop trying to protect yourself and trust our \"automated systems\" — the same systems that miss 80% of bot traffic."
        },
        {
          heading: "The Real Reason for the Limit",
          text: "If Google allowed unlimited IP exclusions, advertisers would block thousands of fraudulent IPs. Auction competition would decrease. Google's revenue would drop. The 500 limit is a revenue protection mechanism disguised as a technical limitation. When a contractor has 2,000 known fraudulent IPs and can only block 500, the remaining 1,500 continue clicking ads and generating revenue for Google. This is not incompetence — it's a business strategy."
        },
      ],
    },
    {
      id: "analytics-fraud",
      icon: BarChart3,
      color: "text-[#34A853]",
      bg: "bg-[#34A853]/10",
      borderColor: "border-[#34A853]/20",
      title: "Analytics Manipulation: The Click Count Scam",
      subtitle: "Google Ads reports more clicks than actually happen. Here's the proof.",
      content: [
        {
          heading: "The 33-50% Click Inflation",
          text: "Across every client account we tracked, Google Ads consistently reported 33% to 50% more clicks than our independent IP tracking system detected. Our tracker was installed directly on the landing pages, capturing every single visit via JavaScript, server logs, and pixel tracking. There was no way to miss a real visitor. Yet Google insisted more clicks happened. Their explanation for the discrepancy shifted every time we asked — sometimes it was \"ad extensions,\" sometimes \"repeat visits from the same session,\" sometimes \"clicks that didn't result in a full page load.\" None of these explanations held up under scrutiny."
        },
        {
          heading: "The Ad Extension Ghost Clicks",
          text: "Google's most common excuse for phantom clicks is \"ad extension interactions.\" They claim users clicked on phone numbers, map pins, or sitelinks that count as clicks but don't result in landing page visits. There's just one problem: the accounts we tested had ALL location extensions disabled and ZERO ad extensions showing on the actual ads. We verified this by searching for our own ads and examining them. No extensions visible. Zero. Yet Google still attributed clicks to extensions that didn't exist. This is either a system error — or a lie."
        },
        {
          heading: "No Way to Verify Google's Numbers",
          text: "Here's the fundamental problem: Google controls the data. They tell you how many clicks you got. They tell you how much you owe. They don't give you the IPs, they don't give you the device data, they don't give you timestamps granular enough to cross-reference. You're paying a bill based entirely on the word of the company sending you the bill. In any other industry, this would be considered fraud. Imagine a utility company telling you that you used 50% more electricity than your own meter shows, but refusing to let you see their meter. That's Google Ads."
        },
        {
          heading: "Why Google Analytics Doesn't Match Google Ads",
          text: "Google's own analytics tool — Google Analytics — doesn't match Google Ads click numbers. Google explains this away with privacy settings, cookie consent, and \"technical differences.\" But the real issue is simpler: Google Ads counts clicks that don't correspond to real visitors. Whether those phantom clicks are from bots, fabricated data, or system errors, the result is the same: advertisers are paying for clicks that never happened, and Google has structured its systems to make this impossible to prove."
        },
      ],
    },
    {
      id: "dispute-impossible",
      icon: Scale,
      color: "text-[#FBBC05]",
      bg: "bg-[#FBBC05]/10",
      borderColor: "border-[#FBBC05]/20",
      title: "Disputing Clicks: A Rigged System",
      subtitle: "Tried to get a refund for fraudulent clicks? Here's why it's designed to be impossible.",
      content: [
        {
          heading: "The Investigation Request Black Hole",
          text: "Google allows you to submit a \"click quality investigation request\" when you suspect fraud. Sounds fair, right? In practice, it's a rubber stamp. We've submitted dozens of detailed investigations with IP logs, screen recordings, fingerprint data, and behavioral analysis proving systematic fraud. The response is always the same: \"After reviewing your account, our systems found no significant invalid activity beyond what was already filtered.\" They never share what they reviewed, what criteria they used, or how they reached their conclusion. It's a black box designed to reject claims."
        },
        {
          heading: "You Can't Prove What Google Won't Show You",
          text: "To prove click fraud, you need data. Google has all of it. You have none. Google won't share the IPs that clicked your ads. Google won't share device information. Google won't share the exact timestamps of interactions. Google won't explain how their \"invalid click detection\" works. They've created a system where the accused (Google) is also the judge, the jury, and the only one with access to the evidence. They control the switch. No independent audit exists. No third-party verification is possible."
        },
        {
          heading: "The Refund Game",
          text: "When Google does issue invalid click refunds, they're typically 1-3% of total spend. Industry research suggests actual invalid traffic rates of 15-30% for contractor keywords. That means Google is refunding a fraction of what they should. They point to their \"automated refund system\" as proof they're protecting you — but it's window dressing. Refunding 1% of stolen money while keeping 99% is not protection. It's a bribe to keep you from asking questions."
        },
        {
          heading: "Litigation Is Impossible by Design",
          text: "Who will challenge Google? A $1-2 million lawsuit against the largest corporation on Earth? 95% of small businesses running Google Ads can barely afford the ads themselves, let alone legal action against a tech giant with unlimited legal resources. Google knows this. Their terms of service include mandatory arbitration clauses. Class action waivers. Venue restrictions. They've built a legal fortress specifically to prevent advertisers from holding them accountable. This isn't a coincidence — it's architecture."
        },
      ],
    },
    {
      id: "who-clicks",
      icon: Users,
      color: "text-[#4285F4]",
      bg: "bg-[#4285F4]/10",
      borderColor: "border-[#4285F4]/20",
      title: "Who's Actually Clicking Your Ads?",
      subtitle: "The breakdown of who really clicks on contractor Google Ads — and how much of your budget is wasted.",
      content: [
        {
          heading: "About One-Third Are Telemarketers",
          text: "We analyzed thousands of ad clicks across contractor accounts and found that approximately one-third of all clicks come from telemarketers and lead-selling companies. These companies click your ads to get your phone number, then call to sell you their services — SEO, web design, \"exclusive leads,\" marketing packages. You paid $30-50 for them to click your ad, and now they're trying to sell YOU something. They click, grab the number, and move on to the next ad. Google counts every one of these as a valid click."
        },
        {
          heading: "Competitors Make Up Another Third",
          text: "In competitive contractor markets, competitors clicking each other's ads is rampant. A roofing company might click competitors' ads 3-5 times per day, every day, to drain their budgets. At $40 per click, that's $120-200 per competitor per day. Multiply by 5 competitors doing this to each other and you have $600-1,000 in daily waste — per company. Google makes money on every single one of these clicks. Their \"invalid click detection\" does almost nothing to stop it because the clicks are spaced out and come from different devices."
        },
        {
          heading: "Only 10-25% Are Real Potential Customers",
          text: "After subtracting bots, telemarketers, competitors, and accidental clicks, the actual percentage of Google Ads clicks from real potential customers in the contractor space is roughly 10-25%. If you're lucky. This means for every $1,000 you spend on Google Ads, only $100-250 goes toward reaching actual customers. The rest goes to waste — but it's all profit for Google. This is the math that Google doesn't want you to understand."
        },
        {
          heading: "The Budget Catch-22",
          text: "Here's Google's trap: when your $200/day budget gets eaten by fraud and you're not getting enough leads, Google's recommendation is to increase your budget. So you go to $500/day, then $1,000/day. But the fraud percentage doesn't change — it scales with your budget. At $1,000/day, you're now wasting $750-900/day on non-customers and bots. Google makes more money, you get more frustrated, and the cycle continues. The only way out is to block the fraud yourself, which is exactly why we built Click Guard — because Google won't do it for you."
        },
      ],
    },
    {
      id: "google-report",
      icon: FileText,
      color: "text-[#34A853]",
      bg: "bg-[#34A853]/10",
      borderColor: "border-[#34A853]/20",
      title: "Google's Own Report: A Masterclass in Deflection",
      subtitle: "We obtained Google's analysis on invalid traffic. Here's what they're actually saying — and what they're hiding.",
      content: [
        {
          heading: "\"Cookie Consent Rejection\" — The Privacy Shield",
          text: "Google's report claims that click-visit discrepancies exist because \"over 50% of users reject data collection.\" This is their go-to excuse. Yes, some users reject cookies. But this doesn't explain why Google's click count is HIGHER than our server-side tracking that doesn't rely on cookies at all. Our IP tracker works at the server level — no cookies, no JavaScript, no consent required. It captures every single request to our server. And Google's numbers are still 33-50% higher. Cookie consent has nothing to do with it."
        },
        {
          heading: "\"Quick Bounces / Slow Page Load\" — Blame the Advertiser",
          text: "Google loves to blame the advertiser. \"Your page loads too slowly.\" \"Users bounced before analytics loaded.\" Our test landing pages loaded in under 1.5 seconds. Server-side logging captured every request. We weren't relying on client-side analytics — we had server access logs that timestamp every single HTTP request. Even with sub-2-second load times and server-side tracking, the discrepancy persisted. Google is blaming advertisers' infrastructure for a problem that exists in Google's reporting."
        },
        {
          heading: "\"Ad Extension Clicks\" — The Phantom Interaction",
          text: "Google's report states that \"clicks on phone numbers/maps don't lead to website visits\" and are counted separately. We tested this by running campaigns with ALL extensions disabled — no call extensions, no location extensions, no sitelinks, nothing. The discrepancy remained identical. Google was counting \"ad extension clicks\" on ads that had no extensions. Either their system is broken, or they're fabricating interactions. Neither explanation is acceptable when you're paying per click."
        },
        {
          heading: "\"Sophisticated Invalid Traffic (SIVT)\" — An Admission of Failure",
          text: "The most revealing part of Google's own analysis: they admit that 78% of detected invalid traffic is \"Sophisticated Invalid Traffic\" that their automated systems struggle to catch. Read that again. Google admits their systems miss the majority of sophisticated fraud. They then argue that advertisers shouldn't be allowed to block IPs manually because \"manual exclusions are prone to errors.\" So Google can't catch the fraud automatically, but also won't let you catch it manually. The advertiser is trapped: Google's automated defense doesn't work, and they won't let you defend yourself."
        },
        {
          heading: "The $172 Billion Elephant in the Room",
          text: "Google's own cited research projects global ad fraud will reach $172 billion by 2028. That's not some fringe estimate — it's from Juniper Research, a respected analytics firm. If Google's \"automated invalid traffic detection\" actually worked, this number would be going down, not up. Instead, it's doubling every few years. Google's response is to tell advertisers to \"trust the system\" while the system demonstrably fails to protect them. At what point does inaction become complicity?"
        },
      ],
    },
    {
      id: "call-only-death",
      icon: PhoneOff,
      color: "text-[#FBBC05]",
      bg: "bg-[#FBBC05]/10",
      borderColor: "border-[#FBBC05]/20",
      title: "Killing Call-Only Ads: Destroying the Last Honest Lead Source",
      subtitle: "Google is phasing out Call-Only Ads — the only ad format that guaranteed real phone leads. Here's why that's by design.",
      content: [
        {
          heading: "Call-Only Ads Were the One Thing That Worked",
          text: "For contractors, Call-Only Ads were the gold standard. Someone searches 'emergency plumber near me,' sees your ad, and calls you directly. No website visit to fake, no bot click to inflate — just a real phone call from a real person. You only paid when someone actually called your business. It was the closest thing to an honest ad format Google ever offered. And now they're killing it. As of January/February 2026, you can no longer create or duplicate new Call-Only Ads. Google is forcing everyone to Responsive Search Ads (RSAs) with Call Assets instead."
        },
        {
          heading: "Why RSAs With Call Assets Are Worse — By Design",
          text: "Here's the scam: with Call-Only Ads, Google only got paid when someone called you. With RSAs + Call Assets, Google gets paid for every click — whether it's a call, a website visit, or a bot bouncing in 0.3 seconds. The call button becomes an optional 'asset' that Google can choose to show or not show, based on what it thinks will 'perform best.' Translation: Google's algorithm decides when to show your phone number, and it optimizes for clicks (which make Google money), not calls (which make YOU money). You've lost control of the one lead format that actually worked."
        },
        {
          heading: "Extensions Are Not the Same as Dedicated Call Ads",
          text: "Google's pitch is that Call Assets (formerly Call Extensions) are 'just as good.' They're not. A Call-Only Ad was dedicated to driving phone calls — the entire ad was a call button. With an RSA + Call Asset, the call button is a tiny add-on that competes with headlines, descriptions, sitelinks, and other extensions for space. Google decides what to show and when. On mobile, the call button might appear. Or it might not. You have zero control. For contractors who rely on phone leads — roofers, HVAC, plumbers, electricians — this is devastating. Google just eliminated your most reliable lead source and replaced it with a format designed to maximize their revenue, not your calls."
        },
        {
          heading: "The Pattern Is Clear: Remove Advertiser Control, Increase Google Revenue",
          text: "This isn't an isolated change. Look at the pattern: Google removed IP tracking (so you can't prove fraud). Google limited IP exclusions to 500 (so you can't block fraud). Google created Performance Max with zero manual controls. Google is killing Call-Only Ads. Every single change removes control from the advertiser and increases Google's ability to charge for low-quality interactions. They're systematically eliminating every tool that lets you verify whether your money is being well spent. When the only ad format that guaranteed a real human interaction gets killed, that tells you everything about Google's priorities. They don't want you getting guaranteed leads. They want you getting clicks — real or fake — because that's what they bill you for."
        },
        {
          heading: "What Contractors Need to Do Right Now",
          text: "If you're still running Call-Only Ads, they'll keep running for now, but you can't create new ones. Start transitioning to RSAs with Call Assets immediately, but understand the limitations. Set up independent call tracking (CallRail, WhatConverts) so you can verify which clicks actually produce calls. Monitor your cost-per-call closely — it will likely increase because you're now paying for clicks that don't result in calls. And use Click Guard to block the fraudulent clicks that will inevitably increase when Google starts billing you for website visits instead of just phone calls. The math is simple: Call-Only Ads meant you only paid for calls. RSAs mean you pay for everything. Google's revenue goes up. Your lead quality goes down. That's not a coincidence — it's the plan."
        },
      ],
    },
    {
      id: "monopoly",
      icon: Flame,
      color: "text-[#4285F4]",
      bg: "bg-[#4285F4]/10",
      borderColor: "border-[#4285F4]/20",
      title: "The Monopoly Problem: Google Controls the Playing Field",
      subtitle: "Google is the ad platform, the analytics tool, the browser, and the referee. They are not on your side.",
      content: [
        {
          heading: "Judge, Jury, and Executioner",
          text: "Google sells the ads. Google counts the clicks. Google decides what's valid. Google bills you. Google handles disputes. Google issues (or denies) refunds. In no other industry does one company control every step of the transaction AND handle the fraud investigation when something goes wrong. Imagine your credit card company charging you, investigating your disputes, and then telling you they found nothing wrong — with no independent recourse. That's Google Ads."
        },
        {
          heading: "They Created the Playing Field for Foul Play",
          text: "Can you really blame a competitor for clicking your ads when Google makes it trivially easy and virtually undetectable? Google created a system where fraud is profitable, consequences are nonexistent, and detection is nearly impossible. They're the referees of a game where cheating generates revenue for the ref. They've built the perfect environment for foul play and then charge you admission to play in it."
        },
        {
          heading: "No One Can Challenge Them",
          text: "Google controls over 90% of the search advertising market. There is no meaningful alternative. You can't take your ad spend to a competitor and get the same reach. Microsoft Ads covers maybe 5-10% of search traffic. Google knows this. They know you can't leave. They know you can't sue. They know you can't prove fraud without data they refuse to share. This is the definition of a monopoly abusing its position — and until regulators catch up (if they ever do), advertisers are trapped."
        },
        {
          heading: "This Should Be Illegal",
          text: "Charging for services not rendered. Concealing evidence of fraud. Restricting your ability to protect yourself. Refusing independent audits. Creating artificial limitations (500 IP limit) that serve no purpose except to protect revenue. In any regulated industry, these practices would result in massive fines, consent decrees, and criminal referrals. But because Google is a tech company operating in a largely unregulated advertising space, they operate with impunity. This should be illegal. Until it is, you have to protect yourself."
        },
      ],
    },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-12 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-3xl mx-auto mb-8">
            <img src={googleAdsLogo} alt="Google Ads" className="h-12 w-12 rounded-lg object-contain mx-auto mb-4" />
            <div className="inline-flex items-center gap-2 bg-[#FBBC05]/10 border border-[#FBBC05]/20 rounded-full px-4 py-1.5 mb-4 animate-in animate-badge-glow">
              <Skull className="h-4 w-4 text-[#FBBC05]" />
              <span className="text-sm text-[#FBBC05] font-medium">Industry Investigation</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-3 animate-in-delay-1" data-testid="text-fraud-title">
              Google Click Fraud:
              <br />
              <span className="bg-gradient-to-r from-[#4285F4] via-[#34A853] to-[#4285F4] bg-clip-text text-transparent animate-gradient-text">
                The Billion-Dollar Scam Nobody Talks About
              </span>
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl mx-auto animate-in-delay-2">
              We deployed advanced IP tracking, device fingerprinting, and screen recording across dozens of contractor Google Ads accounts. What we found is that Google is not protecting you — and the evidence suggests they never intended to.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto mb-8">
            {[
              { label: "Bot Traffic", value: "~80%", sub: "of recorded visitors were bots", color: "text-[#4285F4]", bg: " bg-[#4285F4]/5 border-[#4285F4]/20" },
              { label: "Click Inflation", value: "33-50%", sub: "more clicks than real visits", color: "text-[#34A853]", bg: " bg-[#34A853]/5 border-[#34A853]/20" },
              { label: "Real Customers", value: "10-25%", sub: "of clicks are actual leads", color: "text-[#FBBC05]", bg: " bg-[#FBBC05]/5 border-[#FBBC05]/20" },
              { label: "Global Ad Fraud", value: "$172B", sub: "projected losses by 2028", color: "text-[#4285F4]", bg: " bg-[#4285F4]/5 border-[#4285F4]/20" },
            ].map((stat, i) => (
              <Card key={stat.label} className={`${stat.bg} card-hover-glow animate-scale-in`} style={{ animationDelay: `${0.3 + i * 0.1}s` }} data-testid={`card-stat-${stat.label.toLowerCase().replace(/\s/g, "-")}`}>
                <CardContent className="p-4 text-center">
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                  <p className="text-[10px] text-muted-foreground">{stat.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#FBBC05]/10 to-[#4285F4]/10 border-[#FBBC05]/20 animate-in-delay-4" data-testid="card-disclaimer">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Siren className="h-5 w-5 text-[#FBBC05] flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-[#FBBC05] mb-1">This Is Not Theory — This Is Data</h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Every claim on this page is backed by our direct tracking data from real contractor Google Ads accounts, combined with industry research from Juniper Research, Lunio, ClickPatrol, Fraud Blocker, and Google's own published documentation. We used server-side IP tracking, device fingerprinting, screen recording software, and cross-referenced everything against Google Ads reporting. The findings are consistent across every account we analyzed.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="max-w-4xl mx-auto space-y-3">
            {sections.map((section, i) => (
              <Card
                key={section.id}
                className={`transition-all duration-300 card-hover-lift stagger-item ${openSection === section.id ? ` ${section.borderColor}` : "bg-card border-border"}`}
                style={{ animationDelay: `${0.5 + i * 0.06}s` }}
                data-testid={`card-section-${section.id}`}
              >
                <button
                  className="w-full text-left p-5 flex items-center gap-4"
                  onClick={() => toggleSection(section.id)}
                  data-testid={`button-toggle-${section.id}`}
                >
                  <div className={`w-10 h-10 rounded-lg ${section.bg} flex items-center justify-center flex-shrink-0 transition-transform duration-300 ${openSection === section.id ? "scale-110" : ""}`}>
                    <section.icon className={`h-5 w-5 ${section.color}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{section.subtitle}</p>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-muted-foreground transition-all duration-300 flex-shrink-0 ${openSection === section.id ? "rotate-90 text-[#4285F4]" : ""}`} />
                </button>

                {openSection === section.id && (
                  <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
                    {section.content.map((item, idx) => (
                      <div key={idx} className="flex gap-3" data-testid={`content-${section.id}-${idx}`}>
                        <div className="flex-shrink-0 mt-1">
                          <div className={`w-6 h-6 rounded-full ${section.bg} flex items-center justify-center`}>
                            <span className={`text-xs font-bold ${section.color}`}>{idx + 1}</span>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-foreground mb-1">{item.heading}</h4>
                          <p className="text-xs text-muted-foreground leading-relaxed">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>

          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#FBBC05]/5 to-transparent border-border" data-testid="card-google-excuses">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#FBBC05]/10 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-[#FBBC05]" />
                </div>
                <div>
                  <CardTitle className="text-foreground text-base">Google's Excuses vs. Reality</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">What Google claims vs. what our data actually shows</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    claim: "\"Our automated systems detect and filter invalid clicks.\"",
                    reality: "Their own data shows 78% of sophisticated fraud bypasses these systems. Global ad fraud is growing, not shrinking — projected to reach $172B by 2028.",
                  },
                  {
                    claim: "\"Click discrepancies are caused by privacy settings and cookie rejection.\"",
                    reality: "Our server-side tracking (no cookies required) still shows 33-50% fewer visits than Google reports. Cookie consent is irrelevant to server logs.",
                  },
                  {
                    claim: "\"Ad extension clicks count as interactions but don't produce visits.\"",
                    reality: "We ran accounts with zero ad extensions enabled. No call extensions. No location extensions. No sitelinks. The click inflation persisted identically.",
                  },
                  {
                    claim: "\"Manual IP exclusions are error-prone and could block legitimate traffic.\"",
                    reality: "Translation: don't try to protect yourself — trust our system that misses 78% of sophisticated fraud. They won't let you block fraud manually AND their automated system doesn't work.",
                  },
                  {
                    claim: "\"The 500 IP limit is due to technical infrastructure constraints.\"",
                    reality: "Google processes billions of impressions daily. Checking against 5,000 IPs vs. 500 is computationally trivial. Email spam filters check millions of rules per message in milliseconds.",
                  },
                  {
                    claim: "\"We removed IP reporting to protect user privacy.\"",
                    reality: "They removed it because advertisers were using IP data to prove fraud. Now Google is the only one with the evidence, and they're also the defendant.",
                  },
                  {
                    claim: "\"Location targeting shows ads to people interested in your area.\"",
                    reality: "This setting shows your ads to people in different cities and states. Google defines \"interest\" however they want, and you can't verify or dispute it.",
                  },
                ].map((item, idx) => (
                  <div key={idx} className="bg-card rounded-lg p-4 border border-border" data-testid={`excuse-${idx}`}>
                    <p className="text-xs text-[#FBBC05] font-medium mb-1.5 flex items-center gap-1.5">
                      <X className="h-3 w-3" />
                      Google says: {item.claim}
                    </p>
                    <p className="text-xs text-[#34A853] flex items-start gap-1.5">
                      <CheckCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <span>Reality: {item.reality}</span>
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#4285F4]/5 to-transparent border-[#4285F4]/20" data-testid="card-what-to-do">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#4285F4]/10 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-[#4285F4]" />
                </div>
                <div>
                  <CardTitle className="text-foreground text-base">What Can You Do About It?</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Google won't protect you. Here's how to protect yourself.</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    icon: Shield,
                    title: "Use Click Guard",
                    desc: "Our tracking script captures every visitor's IP, device fingerprint, and behavior. We detect bots, VPN hopping, and competitor clicks that Google won't catch.",
                    color: "text-[#4285F4]",
                    bg: "bg-[#4285F4]/10",
                  },
                  {
                    icon: Link2,
                    title: "Link to Google Ads",
                    desc: "Use the Google Click Guard page to install our automated sync script. It pushes blocked IPs directly into your Google Ads campaigns every hour — no manual work needed.",
                    color: "text-[#34A853]",
                    bg: "bg-[#34A853]/10",
                  },
                  {
                    icon: Fingerprint,
                    title: "Track Device Fingerprints",
                    desc: "IP blocking alone isn't enough. Click Guard's canvas fingerprinting identifies devices even when they switch VPNs, catching fraud that IP-only tools miss entirely.",
                    color: "text-[#FBBC05]",
                    bg: "bg-[#FBBC05]/10",
                  },
                  {
                    icon: BarChart3,
                    title: "Monitor Your Data",
                    desc: "Use the Dashboard and Fraud Analytics tabs to see exactly who's clicking your ads, how often, and from where. Knowledge is the first step to stopping the bleeding.",
                    color: "text-[#4285F4]",
                    bg: "bg-[#4285F4]/10",
                  },
                  {
                    icon: Download,
                    title: "Export Evidence",
                    desc: "Download CSV reports of all fraudulent activity. If you ever need to dispute charges with Google or take legal action, you'll have documentation they can't argue with.",
                    color: "text-[#34A853]",
                    bg: "bg-[#34A853]/10",
                  },
                  {
                    icon: GraduationCap,
                    title: "Learn Google Ads Strategy",
                    desc: "Check out the Google Ads page for our complete playbook on running profitable campaigns — including strategies to minimize exposure to fraud in the first place.",
                    color: "text-[#FBBC05]",
                    bg: "bg-[#FBBC05]/10",
                  },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 bg-card rounded-lg p-3 border border-border card-hover-glow stagger-item" style={{ animationDelay: `${idx * 0.08}s` }} data-testid={`action-${idx}`}>
                    <div className={`w-8 h-8 rounded-lg ${item.bg} flex items-center justify-center flex-shrink-0`}>
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="max-w-4xl mx-auto bg-gradient-to-r from-[#4285F4]/10 to-[#34A853]/10 border-[#4285F4]/20 card-hover-glow" data-testid="card-bottom-line-fraud">
            <CardContent className="p-6 text-center">
              <Flame className="h-8 w-8 text-[#FBBC05] mx-auto mb-3 animate-float" />
              <h3 className="text-lg font-bold text-foreground mb-2">The Bottom Line</h3>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-4">
                Google has created an advertising ecosystem where fraud is profitable, detection is deliberately limited, evidence is hidden from advertisers, and accountability is nonexistent. They're not the referees looking out for fair play — they're the house in a casino that's rigged against you. Until regulation catches up, the only person who will protect your ad budget is you. That's why Click Guard exists.
              </p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <Badge className="bg-[#4285F4]/10 text-[#4285F4] border-[#4285F4]/20 px-3 py-1">
                  <Skull className="h-3 w-3 mr-1" /> 80% bot traffic documented
                </Badge>
                <Badge className="bg-[#34A853]/10 text-[#34A853] border-[#34A853]/20 px-3 py-1">
                  <AlertTriangle className="h-3 w-3 mr-1" /> 33-50% inflated clicks
                </Badge>
                <Badge className="bg-[#FBBC05]/10 text-[#FBBC05] border-[#FBBC05]/20 px-3 py-1">
                  <Ban className="h-3 w-3 mr-1" /> 500 IP limit is artificial
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="max-w-4xl mx-auto text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sources: ConstructHUB internal research data, Juniper Research, Lunio, ClickPatrol, Fraud Blocker, Search Engine Journal, Google Ads Help Center, Google Ad Traffic Quality documentation. All claims are based on observed data from real contractor Google Ads accounts and publicly available industry research.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
