import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { GooglePill } from "@/components/google";
import { useRoute } from "wouter";
import {
  ArrowLeft, AlertTriangle, CheckCircle, ShieldCheck,
  Eye, ChevronRight, Lock, GraduationCap, Loader2,
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

// The section text is paid content: GET /api/google-ads-guide/:slug serves it only to
// accounts with a course purchase (server/google-ads-guide-content.ts), so it is not in
// this bundle. Image blocks name their screenshot file; this map gives its bundled URL.
const IMAGES: Record<string, string> = {
  "image_1772130987636.png": imgSitelinks,
  "image_1772131483853.png": imgAiMax,
  "image_1772131693564.png": imgLeadsGoal,
  "image_1772131724868.png": imgSearchPartners,
  "image_1772131871333.png": imgBudget,
  "image_1772131956561.png": imgBidding,
  "image_1772132057150.png": imgCustomerAcq,
  "image_1772132276466.png": imgAiMaxToggle,
  "image_1772132338474.png": imgLocations,
  "image_1772132687296.png": imgAutoAssets,
  "image_1772133112337.png": imgIpExclusions,
  "image_1772134707386.png": imgChecklist,
  "image_1772131623518.png": imgOverview,
};

type ContentBlock = {
  type: "text" | "heading" | "warning" | "image" | "list" | "tip" | "divider";
  content?: string;
  items?: string[];
  image?: string;
  caption?: string;
};

type SectionData = {
  slug: string;
  title: string;
  subtitle: string;
  accentColor: string;
  blocks: ContentBlock[];
  prevSection?: { slug: string; title: string };
  nextSection?: { slug: string; title: string };
  sectionNumber: number;
  totalSections: number;
};

type SectionResult =
  | { status: "ok"; section: SectionData }
  | { status: "locked"; title: string | null }
  | { status: "not-found" };

// 401/403 → locked view (403 carries the public section title), 404 → not found.
// Anything else is an error the page shows with a retry.
async function fetchSection(slug: string): Promise<SectionResult> {
  const res = await fetch(`/api/google-ads-guide/${encodeURIComponent(slug)}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => null);
    return { status: "locked", title: typeof body?.title === "string" ? body.title : null };
  }
  if (res.status === 404) return { status: "not-found" };
  if (!res.ok) throw new Error(`${res.status}`);
  return { status: "ok", section: await res.json() };
}

export default function GoogleAdsGuideSection() {
  const [, params] = useRoute("/google-ads-guide/:section");
  const sectionSlug = params?.section || "";
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: user } = useQuery<{ id: number } | null>({
    queryKey: ["/api/auth/me"],
  });
  // The server applies the entitlement rule (an included Master Class or any course purchase unlocks the playbook,
  // same as the guide index); the page only renders what it is given.
  const { data: result, isLoading, isError, refetch, isFetching } = useQuery<SectionResult>({
    queryKey: ["/api/google-ads-guide", sectionSlug],
    queryFn: () => fetchSection(sectionSlug),
    enabled: !!sectionSlug,
  });
  const section = result?.status === "ok" ? result.section : undefined;

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [sectionSlug]);

  if (sectionSlug && isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background" data-testid="view-guide-section-checking">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="h-full overflow-y-auto bg-background text-foreground">
        <div className="max-w-2xl mx-auto px-4 py-12 text-center space-y-4" data-testid="view-guide-section-error">
          <h2 className="g-header__title">Couldn't load this section</h2>
          <p className="g-text-2 text-sm">Check your connection and try again.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <GooglePill variant="solid" label={<>{isFetching && <Loader2 className="h-4 w-4 mr-2 animate-spin inline" aria-hidden="true" />} Try again</>} onClick={() => refetch()} disabled={isFetching} testId="button-retry-section" />
            <GooglePill icon={ArrowLeft} variant="quiet" href="/google-ads-guide" label="Back to Google Ads Guide" testId="button-back-to-guide" />
          </div>
        </div>
      </div>
    );
  }

  if (result?.status === "locked") {
    return (
      <div className="h-full overflow-y-auto bg-background text-foreground">
        <div className="max-w-2xl mx-auto px-4 py-12 space-y-6" data-testid="view-guide-section-locked">
          <GooglePill icon={ArrowLeft} variant="quiet" href="/google-ads-guide" label="Back to Google Ads Guide" testId="button-back-to-guide" />
          <Card className="shadow-none">
            <CardContent className="p-8 text-center">
              <div className="g-pill g-pill--sm mb-4">
                <Lock aria-hidden="true" />
                <span>Master Class Students Only</span>
              </div>
              <h2 className="g-header__title mb-2" data-testid="text-section-locked-title">
                {result.title || "Google Ads Playbook"}
              </h2>
              <p className="g-text-2 text-sm mb-6 max-w-md mx-auto">
                This section of the Google Ads playbook is included with Master Class plan access or any Master Class purchase.
              </p>
              <GooglePill icon={GraduationCap} variant="solid" href="/master-class" label="Go to Master Class" testId="link-master-class" className="px-8" />
              {!user && (
                <p className="text-xs text-muted-foreground mt-3">
                  Already purchased? <a href="/auth" className="underline" data-testid="link-sign-in">Sign in</a> to open it.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="h-full overflow-y-auto bg-background text-foreground">
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <h2 className="g-header__title mb-4">Section not found</h2>
          <GooglePill icon={ArrowLeft} variant="solid" href="/google-ads-guide" label="Back to Google Ads Guide" />
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-background text-foreground overflow-x-hidden">
      <section className="relative z-10 pt-8 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            {/* Google's typography and hairlines (owner, 2026-10-07): the paid content and its gate as they were. */}
            <div className="mb-4"><GooglePill icon={ArrowLeft} variant="quiet" size="sm" href="/google-ads-guide" label="Back to Google Ads Guide" testId="button-back-to-guide" /></div>

            <div className="flex items-center gap-3 mb-3">
              <span className="g-chip g-chip--sm">
                Section {section.sectionNumber} of {section.totalSections}
              </span>
            </div>

            <h1 className="g-header__title !text-[28px] !leading-[34px] sm:!text-[32px] sm:!leading-[40px] mb-3" data-testid="text-section-title">
              {section.title}
            </h1>
            <p className="g-text-2 text-sm leading-relaxed max-w-3xl" data-testid="text-section-subtitle">
              {section.subtitle}
            </p>
          </div>

          <div className="space-y-6">
            {section.blocks.map((block, idx) => {
              switch (block.type) {
                case "heading":
                  return (
                    <h2 key={idx} className="g-header__title pt-4 g-divider mt-8 first:mt-0 first:border-0 first:pt-0" data-testid={`heading-${idx}`}>
                      {block.content}
                    </h2>
                  );
                case "text":
                  return (
                    <p key={idx} className="text-sm g-text-2 leading-relaxed" data-testid={`text-${idx}`}>
                      {block.content}
                    </p>
                  );
                case "warning":
                  return (
                    <Card key={idx} className="shadow-none" data-testid={`warning-${idx}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="h-5 w-5 g-star flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <p className="text-sm text-muted-foreground leading-relaxed">{block.content}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                case "tip":
                  return (
                    <Card key={idx} className="shadow-none" data-testid={`tip-${idx}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <CheckCircle className="h-5 w-5 g-open flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <p className="text-sm text-muted-foreground leading-relaxed">{block.content}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                case "image":
                  if (!block.image || !IMAGES[block.image]) return null;
                  return (
                    <div key={idx} className="my-6 rounded-lg overflow-hidden border border-border" data-testid={`image-${idx}`}>
                      <img
                        src={IMAGES[block.image]}
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
                    <ul key={idx} className="space-y-2 pl-1" data-testid={`list-${idx}`}>
                      {block.items?.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm g-text-2 leading-relaxed">
                          <ChevronRight className="h-4 w-4 g-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
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

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-12 pt-6 border-t border-border">
            {section.prevSection ? (
              <GooglePill icon={ArrowLeft} variant="quiet" href={`/google-ads-guide/${section.prevSection.slug}`} label={section.prevSection.title} className="max-w-full h-auto py-2 !whitespace-normal text-left" testId="button-prev-section" />
            ) : <div />}

            {section.nextSection ? (
              <GooglePill icon={ChevronRight} variant="solid" href={`/google-ads-guide/${section.nextSection.slug}`} label={section.nextSection.title} className="max-w-full h-auto py-2 !whitespace-normal text-left" testId="button-next-section" />
            ) : (
              <GooglePill icon={ShieldCheck} variant="solid" href="/google-ads" label="Set Up Click Guard" className="max-w-full" testId="button-go-click-guard" />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
