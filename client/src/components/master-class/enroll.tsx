/**
 * The Enroll tab (/master-class?tab=pricing): the complete bundle and the four modules, priced by the server's
 * catalog (/api/course-catalog → server/catalog.ts COURSE_BUNDLE and the module rows) — no price is typed here.
 *
 * One state at a time, never two at once (review, 2026-10-10):
 *   catalog loading → skeleton cards · catalog failed → the error and a retry
 *   access included / bundle bought → every module says so and opens; no sales button anywhere on the tab
 *   a module bought → that card opens, the others sell
 *   nothing bought → the price and checkout under the sales threshold, the sales-rep button at or above it
 */
import { BookOpen, Camera, CheckCircle2, Globe, GraduationCap, HardHat, Loader2, MessageSquare, ShoppingCart, Star, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Notice, Section } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, apiRequest } from "@/lib/queryClient";
import { useCart } from "@/contexts/cart-context";
import { showsPrice } from "@shared/plans";
import { SALES_REP_LABEL, formatUsd } from "@shared/plan-copy";
import { TalkToSalesButton } from "@/components/talk-to-sales";
import { CATEGORY_TAB, TAB_LABELS, type CourseAccess, type CourseCatalog, type MasterClassTab, type ModuleCategory } from "./access";
import { AccessChecking, AccessError, MASTER_CLASS_PLANS } from "./gate";

const MODULE_ICONS: Record<string, LucideIcon> = { licensing: HardHat, gmb: Camera, website: Globe, seo: TrendingUp };

export type EnrollTabProps = {
  access: CourseAccess | undefined;
  accessStatus: "pending" | "error" | "success";
  accessError: unknown;
  onRetryAccess: () => void;
  catalog: CourseCatalog | undefined;
  catalogStatus: "pending" | "error" | "success";
  catalogError: unknown;
  onRetryCatalog: () => void;
  onOpenTab: (tab: MasterClassTab) => void;
  /** States with a written walkthrough, for the FAQ's honest answer. */
  writtenStates: string[];
};

/** The bundle's reference price and saving — only when every price can be shown (the saving compares them). */
export function bundleSavings(catalog: CourseCatalog | undefined) {
  if (!catalog) return { bundlePriceShown: false, allPricesShown: false, modulesTotalCents: null, savingsCents: null, savingsPct: null };
  const bundlePriceShown = !catalog.bundle.salesOnly && showsPrice(catalog.bundle.priceCents);
  const allPricesShown = bundlePriceShown && catalog.modules.length > 0 && catalog.modules.every((m) => showsPrice(m.price));
  const modulesTotalCents = allPricesShown ? catalog.modules.reduce((sum, m) => sum + m.price, 0) : null;
  const savingsCents = modulesTotalCents !== null && modulesTotalCents > catalog.bundle.priceCents ? modulesTotalCents - catalog.bundle.priceCents : null;
  const savingsPct = savingsCents !== null && modulesTotalCents ? Math.round((savingsCents / modulesTotalCents) * 100) : null;
  return { bundlePriceShown, allPricesShown, modulesTotalCents, savingsCents, savingsPct };
}

export function EnrollTab(p: EnrollTabProps) {
  const { toast } = useToast();
  const { addItem, isInCart } = useCart();
  const catalog = p.catalog;
  const { bundlePriceShown, allPricesShown, modulesTotalCents, savingsCents, savingsPct } = bundleSavings(catalog);
  const access = p.accessStatus === "success" ? p.access : undefined;
  const everything = access?.all === true;
  const openLabel = (category: ModuleCategory) => `Open ${TAB_LABELS[CATEGORY_TAB[category]]}`;

  const enrollMutation = useMutation({
    mutationFn: async (params: { moduleId?: number; bundle?: boolean }) => {
      const res = await apiRequest("POST", "/api/stripe/create-course-checkout", params);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: Error) => {
      if (err.message.includes("Login required") || err.message.includes("401")) {
        toast({ title: "Sign in required", description: "Please sign in to enroll in a course.", variant: "destructive" });
      } else {
        toast({ title: "Enrollment failed", description: apiErrorMessage(err), variant: "destructive" });
      }
    },
  });

  return (
    <div className="space-y-4 sm:space-y-6" data-testid="tab-content-pricing">
      <div className="mx-auto mb-2 max-w-2xl text-center sm:mb-4">
        {savingsPct !== null && (
          <Badge className="mb-3 bg-muted px-3 py-1 text-xs text-foreground hover:bg-muted sm:text-sm" data-testid="badge-pricing-savings">
            Bundle saves {savingsPct}% vs. buying modules separately
          </Badge>
        )}
        <h2 className="mb-2 text-xl font-semibold">Courses</h2>
        <p className="text-muted-foreground">
          Four modules that take a construction business from formation to a full online presence, each with ordered lessons, direct links to every agency and tool, and a checklist you can work through.
        </p>
      </div>

      {p.accessStatus === "pending" && <AccessChecking what="what your account has unlocked" />}
      {p.accessStatus === "error" && <AccessError error={p.accessError} onRetry={p.onRetryAccess} what="what your account has unlocked" />}
      {everything && (
        <Notice tone="success" title={access?.included ? `The Master Class is included in your plan` : "You own the complete bundle"} testId="notice-enrolled-all"
          action={<Button size="sm" onClick={() => p.onOpenTab("state-guide")} data-testid="button-open-course">Open the course</Button>}>
          {access?.included
            ? <>Every module is open on this account{MASTER_CLASS_PLANS ? ` as part of the ${MASTER_CLASS_PLANS} plan` : ""}. Nothing to buy — pick a module below to start.</>
            : <>Every module is open on this account. Pick a module below to start.</>}
        </Notice>
      )}
      {access?.devPreview && !access.included && access.purchases.length === 0 && (
        <Notice tone="warning" testId="notice-dev-preview">Developer preview: every module is open on this machine without a purchase. Customers see the locked state.</Notice>
      )}

      {p.catalogStatus === "error" && (
        <Notice tone="danger" title="Couldn't load the course catalog" testId="catalog-error"
          action={<Button variant="outline" size="sm" onClick={p.onRetryCatalog} data-testid="button-catalog-retry">Try again</Button>}>
          {apiErrorMessage(p.catalogError)} Prices and modules come from the server, so none are shown until it answers.
        </Notice>
      )}
      {p.catalogStatus === "pending" && (
        <div className="space-y-4" aria-busy="true" data-testid="catalog-loading">
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-6"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
        </div>
      )}

      {catalog && (
        <>
          <Section className={`relative overflow-hidden ${everything ? "ring-2 ring-border" : ""}`} testId="card-bundle">
            {/* "Best value" only when the page can show the saving that backs it. */}
            {savingsCents !== null && !everything && (
              <div className="absolute right-3 top-3">
                <Badge className="no-default-hover-elevate bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted" data-testid="badge-bundle-best-value">Best value</Badge>
              </div>
            )}
            <div className="text-center">
              <Star className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <h3 className="mb-2 text-base font-semibold">Complete course bundle</h3>
              <p className="mx-auto mb-4 max-w-lg text-sm text-muted-foreground">
                All four modules, from forming your business to growing your online presence, plus the vetting lessons.
              </p>
              {!everything && (
                <div className="mb-2 flex items-center justify-center gap-3">
                  {modulesTotalCents !== null && modulesTotalCents > catalog.bundle.priceCents && (
                    <span className="text-xl font-semibold text-muted-foreground line-through" data-testid="text-bundle-was">{formatUsd(modulesTotalCents)}</span>
                  )}
                  {/* Quoted bundles skip the price slot: the button below says "Talk to a sales rep". */}
                  {bundlePriceShown && <span className="text-2xl font-semibold" data-testid="text-bundle-price">{formatUsd(catalog.bundle.priceCents)}</span>}
                </div>
              )}
              {savingsCents !== null && !everything && (
                <p className="mb-4 text-xs text-muted-foreground" data-testid="text-bundle-savings">
                  Save {formatUsd(savingsCents)} — the four modules total {formatUsd(modulesTotalCents!)} purchased separately
                </p>
              )}
              {everything ? (
                <Button size="lg" className="w-full sm:w-auto" onClick={() => p.onOpenTab("state-guide")} data-testid="button-enrolled-bundle">
                  <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" /> {access?.included ? "Included in your plan — open the course" : "Bundle purchased — open the course"}
                </Button>
              ) : !bundlePriceShown ? (
                <TalkToSalesButton topic={catalog.bundle.name} size="lg" className="w-full sm:w-auto" data-testid="button-bundle-sales" />
              ) : (<>
                <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto" disabled={isInCart("course_bundle")}
                    onClick={() => {
                      addItem({ id: "course_bundle", type: "course_bundle", name: catalog.bundle.name, price: catalog.bundle.priceCents, description: "All four modules — licensing, Google Business, website and SEO" });
                      toast({ title: "Added to cart", description: "Master Class Bundle has been added to your cart." });
                    }}
                    data-testid="button-add-cart-bundle">
                    {isInCart("course_bundle") ? <><CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" /> In cart</> : <><ShoppingCart className="mr-2 h-4 w-4" aria-hidden="true" /> Add to cart</>}
                  </Button>
                  <Button size="lg" className="w-full sm:w-auto" data-testid="button-enroll-bundle" onClick={() => enrollMutation.mutate({ bundle: true })} disabled={enrollMutation.isPending}>
                    {enrollMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    Buy now — {formatUsd(catalog.bundle.priceCents)}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground" data-testid="text-master-class-terms">Master Class purchases are non-refundable. The course teaches the work; it doesn't guarantee any result.</p>
              </>
              )}
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:gap-6">
            {catalog.modules.map((mod) => {
              const category = mod.category as ModuleCategory;
              const ModIcon = MODULE_ICONS[mod.category] || BookOpen;
              const open = access?.unlocked?.[category] === true;
              const why = access?.included ? "Included in your plan" : "Purchased";
              const priceShown = showsPrice(mod.price);
              return (
                <Section key={mod.id} flush className={`overflow-hidden ${open ? "ring-2 ring-border" : ""}`} testId={`card-module-${mod.category}`}>
                  <div className="p-4 sm:p-6">
                    {/* The icon and the unlock badge share one row: a badge stamped over the icon (absolute + the Badge's
                        own hover-elevate positioning) was the Enroll tab's first-round defect (re-score, 2026-10-11). */}
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <ModIcon className="h-8 w-8 shrink-0 opacity-80" aria-hidden="true" />
                      {open && (
                        <Badge className="no-default-hover-elevate gap-1 bg-muted text-foreground hover:bg-muted" data-testid={`badge-purchased-${mod.category}`}>
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {why}
                        </Badge>
                      )}
                    </div>
                    <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{mod.title}</h3>
                    {/* One statement per card: what you own, or what it costs / who quotes it — never both. */}
                    {open ? (
                      <p className="mt-2 text-sm text-muted-foreground" data-testid={`text-module-open-${mod.category}`}>Open on this account</p>
                    ) : priceShown ? (
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-2xl font-semibold" data-testid={`text-module-price-${mod.category}`}>{formatUsd(mod.price)}</span>
                        <span className="text-xs opacity-70 sm:text-sm">one-time</span>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold opacity-90 sm:text-base" data-testid={`text-module-sales-${mod.category}`}>{SALES_REP_LABEL}</p>
                    )}
                  </div>
                  <div className="p-3 pt-0 sm:p-5 sm:pt-0">
                    <p className="mb-4 text-sm text-muted-foreground">{mod.description}</p>
                    {mod.features && (
                      <ul className="space-y-2">
                        {mod.features.map((feat, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {open ? (
                      <Button variant="outline" className="mt-5 w-full" onClick={() => p.onOpenTab(CATEGORY_TAB[category] ?? "overview")} data-testid={`button-open-module-${mod.category}`}>
                        <GraduationCap className="mr-1 h-4 w-4" aria-hidden="true" /> {CATEGORY_TAB[category] ? openLabel(category) : "Open"}
                      </Button>
                    ) : !priceShown ? (
                      // No price and no checkout at or above the sales threshold: the inquiry form names the module.
                      <TalkToSalesButton topic={`Master Class — ${mod.title}`} className="mt-5 w-full" variant="outline" data-testid={`button-module-sales-${mod.category}`} />
                    ) : (
                      <div className="mt-5 flex gap-2">
                        <Button variant="outline" className="flex-1" disabled={isInCart(`course_module_${mod.id}`)}
                          onClick={() => {
                            addItem({ id: `course_module_${mod.id}`, type: "course_module", name: `Master Class — ${mod.title}`, price: mod.price, description: mod.description, moduleId: mod.id });
                            toast({ title: "Added to cart", description: `${mod.title} has been added to your cart.` });
                          }}
                          data-testid={`button-add-cart-${mod.category}`}>
                          {isInCart(`course_module_${mod.id}`) ? <><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> In cart</> : <><ShoppingCart className="mr-1 h-4 w-4" aria-hidden="true" /> Add to cart</>}
                        </Button>
                        <Button variant="outline" data-testid={`button-enroll-${mod.category}`} onClick={() => enrollMutation.mutate({ moduleId: mod.id })} disabled={enrollMutation.isPending}>
                          {enrollMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                          Buy now
                        </Button>
                      </div>
                    )}
                  </div>
                </Section>
              );
            })}
          </div>

          <Section className="border-dashed" testId="card-whats-included">
            <h3 className="mb-3 text-center text-base font-semibold">What's included</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {[
                ...catalog.modules.map((m) => ({ label: m.title, desc: m.features?.[0] ?? m.description })),
                { label: "Vetting contractors", desc: "19 tips and the homeowner's checklist, with any module" },
                { label: "Google Ads guide", desc: "The 12-section playbook, with any module" },
                { label: "Lifetime access", desc: "A purchase stays on your ConstructHUB account" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                  <p className="shrink-0 text-sm font-semibold text-muted-foreground">Included</p>
                  <div className="min-w-0">
                    <p className="text-xs font-medium [overflow-wrap:anywhere]">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t pt-4 text-center">
              {everything ? (
                <p className="text-sm text-muted-foreground" data-testid="text-bundle-summary-owned">{access?.included ? "Included in your plan." : "Bundle purchased."}</p>
              ) : (
                <>
                  {modulesTotalCents !== null && (
                    <p className="text-sm text-muted-foreground">Modules bought separately: <span className="font-semibold line-through">{formatUsd(modulesTotalCents)}</span></p>
                  )}
                  {bundlePriceShown ? (
                    <p className="text-lg font-semibold">Bundle price: {formatUsd(catalog.bundle.priceCents)}</p>
                  ) : (
                    <TalkToSalesButton topic={catalog.bundle.name} variant="link" className="h-auto whitespace-normal p-0 text-lg font-semibold text-muted-foreground" data-testid="button-bundle-summary-sales">
                      <MessageSquare className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> {SALES_REP_LABEL} about the complete bundle
                    </TalkToSalesButton>
                  )}
                </>
              )}
            </div>
          </Section>

          <Section className="bg-muted/30" title="Frequently asked questions" icon={MessageSquare} testId="card-faq">
            <div className="space-y-3">
              {[
                { q: "Is this course right for someone just starting out?", a: "Yes. It follows the order a new company goes in: form the business in your state, get licensed and insured, then build the profile, the website and the search presence that bring in calls." },
                { q: "I already have a business. Is this still worth it?", a: "Most established contractors leave calls on the table online. The Google Business, website and SEO modules are the part they usually need; the state guide helps when you expand into another state." },
                { q: "Do I get access to all modules at once with the bundle?", a: "Yes. The bundle opens all four modules and the vetting lessons on your ConstructHUB account, and a purchase stays on the account." },
                { q: "Is this specific to my state?", a: `Every state has its own guide to the formation, licensing, workers' comp and tax agencies you'll deal with, with checked links. ${p.writtenStates.length ? `${p.writtenStates.join(" and ")} also ${p.writtenStates.length === 1 ? "has" : "have"} a written step-by-step walkthrough; every other state gets a checklist built from its agency records.` : "Each state gets an ordered checklist built from its agency records."}` },
                { q: "Can I purchase individual modules instead?", a: savingsCents !== null
                  ? `Yes, you can buy any module separately. The bundle saves you ${formatUsd(savingsCents)} compared to buying all four individually.`
                  : allPricesShown
                    ? "Yes, you can buy any module separately, or all four together as the bundle."
                    : `Yes. Each module is available on its own, or all four together as the bundle — ${SALES_REP_LABEL.toLowerCase()} to get started.` },
                { q: "Is it in my plan?", a: MASTER_CLASS_PLANS ? `The ${MASTER_CLASS_PLANS} plan includes the whole Master Class; every other plan buys the modules or the bundle separately.` : "No plan includes it; the modules and the bundle are bought separately." },
                { q: "Who created this course?", a: "Construction company owners who scaled from solo owner-operators to multi-state operations. Real-world experience, not theory from consultants." },
              ].map((item) => (
                <div key={item.q} className="rounded-lg border bg-background/60 p-3">
                  <p className="mb-1 text-sm font-medium">{item.q}</p>
                  <p className="text-xs text-muted-foreground">{item.a}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
