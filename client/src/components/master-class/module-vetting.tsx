/**
 * Vetting contractors — the bonus lessons of the Master Class (/master-class?tab=vetting): the 19 checks
 * homeowners use before they hire, the honest way to build a credible brand, and the homeowner's checklist.
 * They come with any module or the bundle (server/state-guides.ts courseUnlocks → `any`), as the Enroll tab says.
 */
import { AlertTriangle, Award, BadgeCheck, Building, CheckCircle2, CircleDollarSign, Clock, DollarSign, Eye, FileText, Globe, Handshake, Heart, Home, Lightbulb, Phone, Receipt, Scale, Search, Shield, ShieldAlert, Star, ThumbsDown, Truck, UserX, Users } from "lucide-react";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PROGRESS_NOTE, progressLabel, useChecklist } from "@/components/guides/progress";
import type { ModuleHomeProps } from "./module-home";
import { ModuleHome } from "./module-home";
import type { LessonMeta } from "./lesson";

const KEY = "mc:vetting";

const TOPICS = [
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
];

export const VETTING_LESSONS: LessonMeta[] = TOPICS.map((t) => ({ id: `tip-${t.num}`, title: t.text, icon: t.icon }));

const CHECKLIST = [
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
];

export function VettingModule(p: ModuleHomeProps) {
  const unlocked = p.access?.any === true;
  const checklist = useChecklist("mc:vetting:checklist");
  return (
    <ModuleHome {...p} module={null} title="19 Essential Tips for Vetting a Contractor" icon={ShieldAlert} unlocked={unlocked} lessons={VETTING_LESSONS} storageKey={KEY}
      what="The vetting lessons" moduleTitle="Vetting contractors" outlineTitle="The 19 tips" progress={false}
      opensWith={<>The vetting lessons come with any Master Class module or the complete bundle.</>}
      badge={p.access?.included ? <Badge variant="outline" className="font-normal">Included in your plan</Badge> : <Badge variant="outline" className="font-normal">Included with your purchase</Badge>}
      description="What homeowners check before they hire, and the honest way to build a brand that passes every check. Don't fake it till you make it." testId="module-vetting">

    <div className="space-y-4">
      <Section flush id="lesson-tip-1" className="scroll-mt-24" testId="card-vetting-tip-1">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">1</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <UserX className="h-4 w-4 text-muted-foreground" /> False Claims of Affiliation
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Some companies falsely claim to have worked for or been affiliated with established brands to gain credibility they haven't earned. They use misleading language like "partnered with" or "worked alongside" when no real connection exists.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">How to Protect Yourself:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Ask for proof of any claimed affiliations — documentation, references</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Verify directly with the company they claim to be affiliated with</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Be aware that AI can fabricate photos, documents, and endorsements</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-2" className="scroll-mt-24" testId="card-vetting-tip-2">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">2</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" /> Experience Can't Be Faked
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                How long a company has been in business is one of the strongest indicators of reliability. Watch out for the "combined experience" trick — adding up individual employee years to inflate the company's track record.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Red Flags:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> "Combined years of experience" claims (e.g., "Joe 3yr + Phil 4yr = 7 years!")</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Taking credit for a hired employee's prior experience</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Cross-reference their claims with BBB and state licensing records</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-3" className="scroll-mt-24" testId="card-vetting-tip-3">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">3</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" /> The Permitting Loophole
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Many counties have no permitting requirements for certain work (siding, windows, doors). This creates a massive loophole allowing unqualified contractors to operate without oversight. No inspection means no accountability.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Protect Yourself:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Ask for active jobs in the area — established companies always have them</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Demand industry-standard installation practices regardless of permit requirements</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Consider hiring a third-party inspector if permits aren't required</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-4" className="scroll-mt-24" testId="card-vetting-tip-4">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">4</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Award className="h-4 w-4 text-muted-foreground" /> Manufacturer Programs (Diluted Standards)
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Programs like James Hardie Elite used to require 36 full re-siding projects per year. Now it's just 10, and partial jobs as small as 150 sq ft qualify. Verification has been minimized. Don't rely on these badges alone.
              </p>
              <div className="bg-muted border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  Manufacturer certifications that once meant something may now be easily obtained. Always verify a company's actual project history — not just their badges.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-5" className="scroll-mt-24" testId="card-vetting-tip-5">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">5</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" /> Vanishing Estimates
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Some contractors send estimates via links that later disappear. If they can delete an estimate, they can alter a contract. This is a massive red flag for accountability.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Always:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Request a downloadable PDF or printed copy of every estimate</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> If a company only provides a disappearing link, walk away</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Keep copies of all signed contracts independently</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-6" className="scroll-mt-24" testId="card-vetting-tip-6">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">6</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" /> The Illusion of Size
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Some companies use branded trucks, slick websites, and multiple Google listings to look like large operations. In reality, they may be a single-person company using virtual addresses and PO boxes. They hide behind titles like "project manager" or "estimator" when they're the sole operator.
              </p>
              <div className="bg-muted border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  If something goes wrong, these companies often vanish with your money or fail to fix their mistakes, leaving you with zero accountability.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-7" className="scroll-mt-24" testId="card-vetting-tip-7">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">7</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-muted-foreground" /> Lower Price ≠ Equal Service
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Comparing a 20-year company with staff and offices to a 1-year company working from a pickup truck is not "apples to apples." Established companies anticipate structural issues. New companies discover them mid-project — costing you more.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Real Risks of Cheap Bids:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> No workers' comp — if an employee is injured on your property, YOU could be sued</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Insurance may not cover defective work or wrong materials</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> A $6K contractor bond won't cover your legal fees</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-8" className="scroll-mt-24" testId="card-vetting-tip-8">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">8</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-muted-foreground" /> New Companies Badmouthing Veterans
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                It's a major red flag when a company tears down competitors instead of building its own reputation. Claims like "I used to work for them and they're terrible" are often manipulation tactics. Companies that succeed on merit don't need to badmouth others.
              </p>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  A company that actively works to tear down others rather than build up their own reputation likely doesn't have the skills or track record to succeed on merit alone.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-9" className="scroll-mt-24" testId="card-vetting-tip-9">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">9</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" /> Licensed ≠ Legitimate
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                In many states (like Washington), getting a contractor's license just means paying $65, getting a $300/year bond, and $100/month insurance. No experience required. No testing. States like California require 4 years experience + exams. Know your state's requirements.
              </p>
              <div className="bg-muted border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  A license is just a minimum legal requirement — not proof of skill, experience, or quality workmanship. Use the State Guide tab to check your state's licensing requirements.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-10" className="scroll-mt-24" testId="card-vetting-tip-10">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">10</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" /> Web Presence ≠ Legitimacy
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                High Google rankings can be bought through marketing firms. A polished website with customer reviews, ads, and "10 years in business" claims means nothing without verification. Many companies pay to manipulate their online positions.
              </p>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  When vetting a contractor, read their Google reviews critically — repeated phrasing and clustered review dates can be signals worth a closer look, but do not establish authorship or authenticity.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-11" className="scroll-mt-24" testId="card-vetting-tip-11">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">11</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" /> Unsolicited Calls = Lead Gen
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                If a company calls you out of the blue, your information was likely sold through a lead generation form. These companies buy leads in bulk and often lack the experience to deliver quality work. Only engage with companies you've researched yourself.
              </p>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-12" className="scroll-mt-24" testId="card-vetting-tip-12">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">12</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <BadgeCheck className="h-4 w-4 text-muted-foreground" /> Warranty Is Key
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Companies offering 1-2 year warranties don't want to be held accountable. But beware the opposite too — a company in business for 2 years offering a 10-year warranty is a red flag. Always ask how long they've been operating before trusting a warranty promise.
              </p>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  The warranty is the best indicator of a company's commitment to their work and customers. A company can't honor a 15-year warranty if they've only existed for 3.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-13" className="scroll-mt-24" testId="card-vetting-tip-13">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">13</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Building className="h-4 w-4 text-muted-foreground" /> Physical Office Verification
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Schedule a meeting at their office. A legitimate company will have a physical space, showroom, or office. Ask how many employees they have. Verify the address on Google Maps — many scam companies use PO boxes, storage units, or random warehouses as false addresses.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Check for:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Real office or showroom (not a PO box, Suite #, or storage unit)</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Actual staff — customer service, project managers</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Drive by the address if you're unsure</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-14" className="scroll-mt-24" testId="card-vetting-tip-14">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">14</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" /> BBB & Online Credibility
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
      </Section>

      <Section flush id="lesson-tip-15" className="scroll-mt-24" testId="card-vetting-tip-15">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">15</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Handshake className="h-4 w-4 text-muted-foreground" /> Fabricated Accomplishments
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Some companies subcontract work and present it as their own. They leverage established brand names by falsely claiming affiliation or insider knowledge. When encountering such claims, question the integrity of the source.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Common Fabrication Tactics:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Displaying project photos from other companies as their own work</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Claiming "trained by" or "formerly with" established companies without proof</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Listing subcontracted projects as direct company accomplishments</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Ask for job site addresses you can drive by and verify in person</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-16" className="scroll-mt-24" testId="card-vetting-tip-16">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">16</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Star className="h-4 w-4 text-muted-foreground" /> Referrals & Fake Reviews
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
      </Section>

      <Section flush id="lesson-tip-17" className="scroll-mt-24" testId="card-vetting-tip-17">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">17</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" /> Fabrication of Credibility
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Companies create dozens of online profiles across Houzz, Thumbtack, YouTube, Facebook, and more. They duplicate competitor content, steal branding colors and logos, and display vendor logos they have no real partnership with. They acquire credentials to emulate successful local companies.
              </p>
              <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-medium">Signs of Fabricated Credibility:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Website design, colors, or layout that closely mimics a well-known local competitor</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Displaying manufacturer logos without being an actual certified installer</li>
                  <li className="flex items-start gap-1.5"><AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Having profiles on 15+ platforms but only 6 months in business</li>
                  <li className="flex items-start gap-1.5"><CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" /> Verify certifications directly with the manufacturer's installer lookup tool</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-18" className="scroll-mt-24" testId="card-vetting-tip-18">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">18</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-muted-foreground" /> Real Financing vs. 3rd Party Referrals
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Legitimate in-house financing requires years of established operations, solid financial stability, and significant revenue (millions). Many new companies claim to offer financing but actually just partner with obscure third-party vendors for referral commissions.
              </p>
              <div className="bg-muted border border-border rounded-md p-3">
                <p className="text-xs text-muted-foreground text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  If a company offers financing but has been in business less than 5 years, chances are it's a third-party referral program — not real in-house financing.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>

      <Section flush id="lesson-tip-19" className="scroll-mt-24" testId="card-vetting-tip-19">
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground shrink-0">19</div>
            <div>
              <h3 className="font-semibold mb-1.5 flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" /> Too-Good-to-Be-True Prices
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Low bids mean the company is cutting costs — unskilled labor, no insurance, no overhead. When you pay a higher price, you're investing in experience and a company that has already overcome the hurdles of running a business. Lack of experience often results in redoing the job entirely.
              </p>
              <div className="bg-muted/50 rounded-md p-3">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Lightbulb className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  Find the middle ground. The cheapest option often leads to the most expensive outcome — incorrect products, project delays, and lawsuits with insurance that doesn't cover the work.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Section>
    </div>

    <Section flush>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-3 mb-3 sm:mb-4">
          <Shield className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground shrink-0 mt-0.5" />
          <h3 className="text-base font-semibold">Building a Legit Brand — The Right Way</h3>
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
              <item.icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{item.text}</span>
            </div>
          ))}
        </div>
        <div className="p-3 rounded-lg border bg-background/60">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" /> The Bottom Line
          </p>
          <p className="text-xs text-muted-foreground">
            Every established company in your market started exactly where you are. The difference between the ones that made it and the ones that didn't is simple: the successful ones built their reputation on real work, real customers, and real results. They didn't cut corners on insurance, they didn't fake reviews, and they didn't pretend to be bigger than they were. They earned every star, every referral, and every repeat customer. That's the path — and it works.
          </p>
        </div>
      </CardContent>
    </Section>

    <Section id="lesson-checklist" title="Homeowner's Quick Vetting Checklist" icon={CheckCircle2} className="scroll-mt-24" testId="card-vetting-checklist"
      description={<>Use it before signing any contract; if a company can't satisfy most of these, keep looking. {progressLabel(checklist.count, CHECKLIST.length)} · {PROGRESS_NOTE}</>}
      actions={checklist.count > 0 ? <Button variant="ghost" size="sm" onClick={checklist.reset} data-testid="button-vetting-checklist-reset">Reset</Button> : undefined}>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="list-vetting-checklist">
        {CHECKLIST.map((item, i) => {
          const id = `item-${i + 1}`;
          const done = checklist.isDone(id);
          const boxId = `vet-check-${i + 1}`;
          return (
            <li key={id}>
              <label htmlFor={boxId} className="flex min-h-10 cursor-pointer items-start gap-2 rounded border bg-background/60 p-2 text-xs text-muted-foreground hover:bg-muted/50">
                <Checkbox id={boxId} checked={done} onCheckedChange={(v) => checklist.toggle(id, v === true)} className="mt-0.5" data-testid={`checkbox-vetting-${i + 1}`} />
                <span className={done ? "line-through" : ""}>{item}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Section>
    </ModuleHome>
  );
}
