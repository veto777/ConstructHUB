/**
 * Vetting contractors — the bonus lessons of the Master Class (/master-class?tab=vetting): the 19 checks
 * homeowners use before they hire, the honest way to build a credible brand, and the homeowner's checklist.
 * They come with any module or the bundle (server/state-guides.ts courseUnlocks → `any`), as the Enroll tab says.
 *
 * This file is the public outline — the 19 tip titles and their icons. The tips' text, the brand lesson and the
 * checklist are served by /api/master-class/lessons/vetting (server/master-class/content/vetting.ts) to an
 * entitled account only, and rendered here in the numbered-card layout the tab has always had.
 */
import { AlertTriangle, Award, BadgeCheck, Building, CheckCircle2, CircleDollarSign, Clock, DollarSign, Eye, FileText, Globe, Handshake, Phone, Receipt, Search, Shield, ShieldAlert, Star, ThumbsDown, Truck, UserX } from "lucide-react";
import { Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import type { ModuleHomeProps } from "./module-home";
import { ModuleHome } from "./module-home";
import type { LessonMeta } from "./lesson";
import { LessonBlockView, LessonBlocks, type RenderLesson } from "./lesson-body";

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

/** The server's two lessons after the tips (server/master-class/content/vetting.ts): the brand lesson and the checklist. */
export const VETTING_EXTRA_LESSONS = { brand: "brand", checklist: "checklist" } as const;

/** A tip's card: its number, its title (the server's full title) and its blocks; the brand lesson and the checklist as sections. */
const renderVettingLesson: RenderLesson = (meta, body) => {
  const tipNumber = /^tip-(\d+)$/.exec(meta.id)?.[1];
  const Icon = meta.icon;
  if (tipNumber) {
    return (
      <Section flush id={`lesson-${meta.id}`} className="scroll-mt-24" testId={`card-vetting-${meta.id}`}>
        <CardContent className="p-3 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">{tipNumber}</div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-1.5 flex items-center gap-2 font-semibold [overflow-wrap:anywhere]">
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />} {body?.title ?? meta.title}
              </h3>
              {body ? <LessonBlocks blocks={body.blocks} className="space-y-2" /> : <p className="text-sm text-muted-foreground" data-testid="text-lesson-missing">This tip isn't available right now. Reload the page or come back later.</p>}
            </div>
          </div>
        </CardContent>
      </Section>
    );
  }
  if (meta.id === VETTING_EXTRA_LESSONS.checklist) {
    const [intro, ...rest] = body?.blocks ?? [];
    return (
      <Section id={`lesson-${meta.id}`} title={body?.title ?? meta.title} icon={CheckCircle2} className="scroll-mt-24" testId="card-vetting-checklist"
        description={intro?.type === "p" ? intro.text : undefined}>
        {body ? <LessonBlocks blocks={intro?.type === "p" ? rest : body.blocks} /> : <p className="text-sm text-muted-foreground" data-testid="text-lesson-missing">The checklist isn't available right now.</p>}
      </Section>
    );
  }
  return (
    <Section flush id={`lesson-${meta.id}`} className="scroll-mt-24" testId={`card-vetting-${meta.id}`}>
      <CardContent className="p-4 sm:p-6">
        <div className="mb-3 flex items-start gap-3 sm:mb-4">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground sm:h-6 sm:w-6" aria-hidden="true" />
          <h3 className="text-base font-semibold">{body?.title ?? meta.title}</h3>
        </div>
        {body ? body.blocks.map((b, i) => <div key={i} className={i > 0 ? "mt-4" : undefined}><LessonBlockView block={b} /></div>) : <p className="text-sm text-muted-foreground" data-testid="text-lesson-missing">This lesson isn't available right now.</p>}
      </CardContent>
    </Section>
  );
};

export function VettingModule(p: ModuleHomeProps) {
  const unlocked = p.access?.any === true;
  return (
    <ModuleHome {...p} module={null} title="19 Essential Tips for Vetting a Contractor" icon={ShieldAlert} unlocked={unlocked} lessons={VETTING_LESSONS} lessonsModule="vetting" storageKey={KEY}
      renderLesson={renderVettingLesson}
      what="The vetting lessons" moduleTitle="Vetting contractors" outlineTitle="The 19 tips" progress={false}
      opensWith={<>The vetting lessons come with any Master Class module or the complete bundle.</>}
      badge={p.access?.included ? <Badge variant="outline" className="font-normal">Included in your plan</Badge> : <Badge variant="outline" className="font-normal">Included with your purchase</Badge>}
      description="What homeowners check before they hire, and the honest way to build a brand that passes every check. Don't fake it till you make it." testId="module-vetting" />
  );
}
