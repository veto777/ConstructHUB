/**
 * The Master Class (/master-class): the contractor business course.
 *
 * Tabs = the course's homes: Overview (free), the four module homes — State guide (Business Formation &
 * Licensing), Google Business (GMB Setup & Optimization), Website (Website & Online Presence), SEO & ads (SEO &
 * Directory Domination) — the Vetting bonus lessons, and Enroll. Each module home lives in
 * components/master-class/* and decides what it shows from ONE access answer (/api/course-access, resolved per
 * module category on the server) that is first checked, then trusted: a loading or failed check shows as such,
 * never as "not bought". The catalog (/api/course-catalog) prices everything; the page types no price. The lesson
 * bodies are not in this bundle: an open module fetches them from /api/master-class/lessons/:module
 * (server/master-class/routes.ts), which answers only an entitled account.
 *
 * The open tab, the chosen state and the lesson (#lesson-…) live in the address, so a reload or a shared link
 * returns to the same material.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Layers, Lock, Search, Sparkles, Target } from "lucide-react";
import { Link } from "wouter";
import { AppPage, AppTabsList, Notice, PageHeader, Section, Stat, StatGrid, appTable, appTableCards } from "@/components/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/hooks/use-url-param";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { apiErrorMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { SALES_HREF, SALES_REP_LABEL, formatUsd, priceOrSalesRep } from "@shared/plan-copy";
import { useState } from "react";
import {
  CATEGORY_TAB, MASTER_CLASS_TABS, TAB_LABELS, resolveTab, tabUnlocked,
  type CourseAccess, type CourseCatalog, type MasterClassTab, type ModuleCategory,
} from "@/components/master-class/access";
import { MASTER_CLASS_PLANS } from "@/components/master-class/gate";
import { bundleSavings, EnrollTab } from "@/components/master-class/enroll";
import { GmbModule } from "@/components/master-class/module-gmb";
import { WebsiteModule } from "@/components/master-class/module-website";
import { SeoModule } from "@/components/master-class/module-seo";
import { VettingModule } from "@/components/master-class/module-vetting";
import { StateGuideTab, workersCompLabel, type PublicStateGuide } from "@/components/master-class/state-guide";

const status = (q: { isPending: boolean; isError: boolean }): "pending" | "error" | "success" => (q.isPending ? "pending" : q.isError ? "error" : "success");

export default function MasterClassPage() {
  // The open tab and the chosen state live in the address (?tab=…&state=…) so a reload or a shared link reopens them.
  const [tabParam, setTabParam] = useUrlParam("tab");
  const [stateParam, setStateParam] = useUrlParam("state");
  const activeTab = resolveTab(tabParam);
  const setActiveTab = (tab: string) => setTabParam(tab === "overview" ? null : tab);
  const openState = (code: string) => { setStateParam(code); setActiveTab("state-guide"); };
  const [searchQuery, setSearchQuery] = useState("");

  const guidesQ = useQuery<PublicStateGuide[]>({ queryKey: ["/api/state-guides"] });
  const catalogQ = useQuery<CourseCatalog>({ queryKey: ["/api/course-catalog"] });
  const accessQ = useQuery<CourseAccess>({ queryKey: ["/api/course-access"] });

  const guides = guidesQ.data;
  const catalog = catalogQ.data;
  const access = accessQ.isSuccess ? accessQ.data : undefined;
  const moduleFor = (category: ModuleCategory) => catalog?.modules.find((m) => m.category === category) ?? null;
  const moduleProps = {
    access, accessStatus: status(accessQ), accessError: accessQ.error, onRetryAccess: () => void accessQ.refetch(),
    onEnroll: () => setActiveTab("pricing"),
  };

  const statesWithLicensing = guides ? guides.filter((g) => g.licensingRequired).length : null;
  const statesNoLicensing = guides && statesWithLicensing !== null ? guides.length - statesWithLicensing : null;
  const writtenStates = guides?.filter((g) => g.walkthrough === "written").map((g) => g.stateName) ?? [];
  const { bundlePriceShown, modulesTotalCents, savingsPct } = bundleSavings(catalog);
  const everything = access?.all === true;

  const filteredStates = (guides ?? []).filter((g) => !searchQuery || g.stateName.toLowerCase().includes(searchQuery.toLowerCase()) || g.stateCode.toLowerCase().includes(searchQuery.toLowerCase()));

  const lockIcon = (tab: MasterClassTab) => accessQ.isSuccess && !tabUnlocked(access, tab) && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Locked" />;

  return (
    <>
    {/* Signed out, this page has no app frame: the header brings the way home, sign-in and the cart the Add to cart buttons fill. */}
    <PublicPageHeader next="/master-class" cart />
    <div className="h-full overflow-y-auto">
      <AppPage width="narrow" className="[&_p]:leading-relaxed [&_button:not([role=checkbox])]:min-h-10 [&_input]:min-h-10">
        <PageHeader title={<span data-testid="text-master-class-title">Master Class</span>}
          description={<span data-testid="text-master-class-subtitle">Build your construction business, one lesson at a time.</span>}
          meta={<>
            <Badge variant="outline" data-testid="badge-states-count">{guides ? `${guides.length} states` : "50 states"}</Badge>
            <Badge variant="outline" data-testid="badge-licensing-count">{statesWithLicensing !== null ? `${statesWithLicensing} require licensing` : "— require licensing"}</Badge>
            {everything && <Badge variant="outline" className="gap-1" data-testid="badge-course-unlocked"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {access?.included ? "Included in your plan" : "Enrolled"}</Badge>}
          </>}
          actions={activeTab === "overview" ? <>
            <Button className="!basis-full sm:!basis-auto" onClick={() => setActiveTab("state-guide")}>Choose your state</Button>
            <Button variant="outline" onClick={() => setActiveTab("pricing")} data-testid="button-overview-enroll">{everything ? "Your modules" : "How to enroll"}</Button>
          </> : undefined} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <AppTabsList data-testid="tabs-master-class">
            {MASTER_CLASS_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="gap-1 px-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm" data-testid={`tab-${tab}`}>
                {TAB_LABELS[tab]}
                {lockIcon(tab)}
              </TabsTrigger>
            ))}
          </AppTabsList>

          <TabsContent value="overview" className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
            <Section testId="card-overview-hero">
              <div className="relative">
                {savingsPct !== null && !everything && (
                  <div className="absolute right-0 top-0">
                    <Badge className="bg-muted px-2 py-1 text-xs text-foreground hover:bg-muted sm:px-3 sm:text-sm" data-testid="badge-sale">Bundle saves {savingsPct}%</Badge>
                  </div>
                )}
                <h2 className="mb-2 max-w-lg text-base font-semibold sm:mb-3">Start with the essentials</h2>
                <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
                  Form the business and get licensed in your state, build the Google profile, then the website and the search presence that bring in calls.
                </p>
              </div>
              <StatGrid cols={4}>
                <Stat label="Modules" value={catalog ? catalog.modules.length : <Skeleton className="h-7 w-10" />} hint="each with ordered lessons" />
                <Stat label="State guides" value={guides ? guides.length : guidesQ.isError ? "—" : <Skeleton className="h-7 w-10" />} hint={writtenStates.length ? `${writtenStates.length} with a written walkthrough` : "agencies, links, checklist"} />
                <Stat label="Require a license" value={statesWithLicensing ?? (guidesQ.isError ? "—" : <Skeleton className="h-7 w-10" />)} hint="statewide contractor license" testId="stat-licensing-states" />
                {everything ? (
                  <Stat label="Your access" value="Unlocked" hint={access?.included ? "included in your plan" : "bundle purchased"} href="/master-class?tab=pricing" testId="stat-course-access" />
                ) : catalog ? (
                  bundlePriceShown
                    ? <Stat label="Complete bundle" value={formatUsd(catalog.bundle.priceCents)} hint={modulesTotalCents !== null ? <><span className="line-through">{formatUsd(modulesTotalCents)}</span> separately</> : "all four modules"} href="/master-class?tab=pricing" testId="text-overview-bundle-price" />
                    : <Stat label="Complete bundle" value={<Link href={SALES_HREF} className="block whitespace-normal text-base font-semibold leading-tight hover:underline sm:text-lg" data-testid="link-overview-bundle-sales">{SALES_REP_LABEL}</Link>} hint="all four modules, quoted for your business" testId="text-bundle-reference" />
                ) : (
                  <Stat label="Complete bundle" value={catalogQ.isError ? "—" : <Skeleton className="h-7 w-16" />} hint={catalogQ.isError ? "catalog didn't load" : "loading the catalog"} />
                )}
              </StatGrid>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setActiveTab("state-guide")} data-testid="button-overview-preview">Preview state guide</Button>
                {everything && <Button variant="outline" onClick={() => setActiveTab("gmb")} data-testid="button-overview-open-gmb">Open Google Business</Button>}
              </div>
            </Section>

            <Section title="Course modules" icon={Layers} description={everything ? "Every module is open on this account." : "Everything you get across all four modules."} testId="card-curriculum">
              {catalogQ.isError && (
                <Notice tone="danger" title="Couldn't load the modules" action={<Button variant="outline" size="sm" onClick={() => void catalogQ.refetch()} data-testid="button-curriculum-retry">Try again</Button>}>{apiErrorMessage(catalogQ.error)}</Notice>
              )}
              {catalogQ.isPending && <div className="space-y-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>}
              {catalog && (
                <div className="space-y-4">
                  {catalog.modules.map((mod, i) => {
                    const category = mod.category as ModuleCategory;
                    const tab = CATEGORY_TAB[category];
                    const open = access?.unlocked?.[category] === true;
                    return (
                      <div key={mod.id} className="border-l-4 border-border pl-4" data-testid={`curriculum-${mod.category}`}>
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold [overflow-wrap:anywhere]">Module {i + 1}: {mod.title}</h4>
                          {accessQ.isSuccess && open ? (
                            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => tab && setActiveTab(tab)} data-testid={`link-curriculum-open-${mod.category}`}>
                              {access?.included ? "Included" : "Purchased"} · Open {tab ? TAB_LABELS[tab] : "module"}
                            </Button>
                          ) : (
                            <span className="shrink-0 text-xs font-semibold text-muted-foreground" data-testid={`text-curriculum-price-${mod.category}`}>{priceOrSalesRep(mod.price)}</span>
                          )}
                        </div>
                        <p className="mb-2 text-xs text-muted-foreground">{mod.description}</p>
                        {mod.features && (
                          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                            {mod.features.map((item) => (
                              <div key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span>{item}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">Any module also opens the <b className="font-medium text-foreground">Vetting contractors</b> lessons and the 12-section <Link href="/google-ads-guide" className="underline underline-offset-2">Google Ads guide</Link>.{MASTER_CLASS_PLANS ? ` The ${MASTER_CLASS_PLANS} plan includes the whole course.` : ""}</p>
                </div>
              )}
            </Section>

            <details className="rounded-xl border bg-card p-4"><summary className="min-h-10 cursor-pointer text-sm font-medium">About the course and licensing</summary><div className="mt-3 space-y-4">
            <Section title="Who this course is for" icon={Target}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { title: "New contractors", desc: "Just getting started and need to know exactly what to do, in what order, without missing steps that cost thousands later." },
                  { title: "Experienced tradespeople", desc: "You know the work, but you've been doing it under someone else's license. Now you want to launch your own company the right way." },
                  { title: "Construction business owners", desc: "Already have a business but your online presence is weak. You're losing jobs to competitors who show up on Google first." },
                  { title: "Multi-state operators", desc: "Expanding into new states and need to understand different licensing, bonding, insurance and tax requirements quickly." },
                  { title: "Home service companies", desc: "Roofing, siding, plumbing, electrical, HVAC, painting, landscaping — every trade benefits from the same system." },
                  { title: "Franchise owners", desc: "Running a franchise location and need local compliance, profile optimization and local SEO." },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3 rounded-lg bg-background/60 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.desc}</p></div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="What makes this different" icon={Sparkles}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="mb-1 text-sm font-semibold">Built by owners who scaled</p>
                  <p className="text-xs text-muted-foreground">Created by company owners who grew from solo owner-operators to multi-state operations. Real experience, not theory.</p>
                </div>
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="mb-1 text-sm font-semibold">Built for construction</p>
                  <p className="text-xs text-muted-foreground">Not a generic business course with a hard hat logo. Every lesson is about contractors and trades, and links to the ConstructHUB tool that does the work.</p>
                </div>
                <div className="rounded-lg border bg-background/60 p-3">
                  <p className="mb-1 text-sm font-semibold">All 50 states covered</p>
                  <p className="text-xs text-muted-foreground">
                    Each state guide names its formation, licensing, workers' comp and tax agencies with checked links, and orders them into a checklist.
                    {writtenStates.length > 0 && <> {writtenStates.join(" and ")} also {writtenStates.length === 1 ? "has" : "have"} a written step-by-step walkthrough.</>}
                  </p>
                </div>
              </div>
            </Section>

            {guidesQ.isError && (
              <Notice tone="danger" title="Couldn't load the state list" action={<Button variant="outline" size="sm" onClick={() => void guidesQ.refetch()} data-testid="button-overview-states-retry">Try again</Button>}>{apiErrorMessage(guidesQ.error)}</Notice>
            )}
            {guidesQ.isPending && <Skeleton className="h-28 w-full" />}
            {guides && (
              <div className="space-y-4">
                <Section title={<><CheckCircle2 className="mr-1 inline h-4 w-4 text-muted-foreground" aria-hidden="true" /> States requiring a contractor license ({statesWithLicensing})</>}>
                  <div className="flex flex-wrap gap-1.5">
                    {guides.filter((g) => g.licensingRequired).map((g) => (
                      <button key={g.stateCode} type="button" className={cn("rounded-md border bg-secondary px-2 py-1 text-xs font-medium hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", "!min-h-8")} title={g.stateName}
                        onClick={() => openState(g.stateCode)} data-testid={`badge-licensed-${g.stateCode}`}>{g.stateCode}</button>
                    ))}
                  </div>
                </Section>
                <Section title={<><AlertCircle className="mr-1 inline h-4 w-4 text-muted-foreground" aria-hidden="true" /> No state contractor license required ({statesNoLicensing})</>}>
                  <div className="flex flex-wrap gap-1.5">
                    {guides.filter((g) => !g.licensingRequired).map((g) => (
                      <button key={g.stateCode} type="button" className="!min-h-8 rounded-md border px-2 py-1 text-xs font-medium hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={g.stateName}
                        onClick={() => openState(g.stateCode)} data-testid={`badge-unlicensed-${g.stateCode}`}>{g.stateCode}</button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">These states may still require local licenses or trade-specific licenses (electrical, plumbing, etc.).</p>
                </Section>
              </div>
            )}
            </div></details>

            <details className="rounded-xl border bg-card p-4"><summary className="min-h-10 cursor-pointer text-sm font-medium">Compare all 50 states</summary>
            <div className="mt-3">
              <p className="mb-3 text-sm text-muted-foreground">Key facts for each state at a glance — free to read. Pick a row for the state's guide.</p>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input placeholder="Search states…" aria-label="Search states" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-states" />
              </div>
              {guidesQ.isError && <Notice tone="danger" title="Couldn't load the state list" action={<Button variant="outline" size="sm" onClick={() => void guidesQ.refetch()}>Try again</Button>}>{apiErrorMessage(guidesQ.error)}</Notice>}
              {guidesQ.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>}
              {guides && (
                <div className={appTable.wrapper}>
                  <table className={appTable.table}>
                    <thead className={appTableCards.thead}>
                      <tr className="border-b text-left">
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">State</th>
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">License</th>
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">Workers' comp</th>
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">Sales tax on labor</th>
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">B&amp;O tax</th>
                        <th scope="col" className="pb-2 pr-3 font-medium sm:pr-4">Bond</th>
                        <th scope="col" className="pb-2 font-medium">Filing office</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStates.length === 0 && (
                        <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground" data-testid="text-states-empty">No state matches "{searchQuery}".</td></tr>
                      )}
                      {filteredStates.map((guide) => (
                        <tr key={guide.stateCode} className={cn(appTable.tr, appTableCards.tr, "cursor-pointer")} onClick={() => openState(guide.stateCode)} data-testid={`row-state-${guide.stateCode}`}>
                          <td className={cn(appTableCards.td, "whitespace-nowrap py-2 pr-3 font-medium sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">State</span>
                            <button type="button" className="!min-h-0 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(e) => { e.stopPropagation(); openState(guide.stateCode); }}>{guide.stateName}</button>
                          </td>
                          <td className={cn(appTableCards.td, "py-2 pr-3 sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">License</span>
                            {guide.licensingRequired ? <Badge className="bg-muted text-xs text-foreground hover:bg-muted">Yes</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}
                          </td>
                          <td className={cn(appTableCards.td, "whitespace-nowrap py-2 pr-3 text-xs text-muted-foreground sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">Workers' comp</span>{workersCompLabel(guide.workersCompType)}</td>
                          <td className={cn(appTableCards.td, "py-2 pr-3 sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">Sales tax on labor</span>
                            {guide.salesTaxOnLabor ? <Badge variant="destructive" className="text-xs">Yes</Badge> : <Badge variant="outline" className="text-xs text-muted-foreground">No</Badge>}
                          </td>
                          <td className={cn(appTableCards.td, "py-2 pr-3 sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">B&amp;O tax</span>
                            {guide.bAndOTax ? <Badge variant="destructive" className="text-xs">Yes</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}
                          </td>
                          <td className={cn(appTableCards.td, "py-2 pr-3 sm:pr-4")}><span className="mr-2 text-muted-foreground sm:hidden">Bond</span>
                            {guide.bondRequired ? <Badge variant="secondary" className="text-xs">Yes</Badge> : <Badge variant="outline" className="text-xs">No</Badge>}
                          </td>
                          <td className={cn(appTableCards.td, "break-words py-2 text-xs text-muted-foreground")}><span className="mr-2 text-muted-foreground sm:hidden">Filing office</span>{guide.sosName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </details>
          </TabsContent>

          <TabsContent value="state-guide" className="mt-4 sm:mt-6">
            <StateGuideTab {...moduleProps} module={moduleFor("licensing")}
              guides={guides} guidesStatus={status(guidesQ)} guidesError={guidesQ.error} onRetryGuides={() => void guidesQ.refetch()}
              state={stateParam} setState={(code) => setStateParam(code)} />
          </TabsContent>
          <TabsContent value="gmb" className="mt-4 sm:mt-6"><GmbModule {...moduleProps} module={moduleFor("gmb")} /></TabsContent>
          <TabsContent value="website" className="mt-4 sm:mt-6" data-testid="tab-content-website"><WebsiteModule {...moduleProps} module={moduleFor("website")} /></TabsContent>
          <TabsContent value="seo" className="mt-4 sm:mt-6" data-testid="tab-content-seo"><SeoModule {...moduleProps} module={moduleFor("seo")} /></TabsContent>
          <TabsContent value="vetting" className="mt-4 sm:mt-6"><VettingModule {...moduleProps} module={null} /></TabsContent>
          <TabsContent value="pricing" className="mt-4 sm:mt-6">
            <EnrollTab access={access} accessStatus={status(accessQ)} accessError={accessQ.error} onRetryAccess={() => void accessQ.refetch()}
              catalog={catalog} catalogStatus={status(catalogQ)} catalogError={catalogQ.error} onRetryCatalog={() => void catalogQ.refetch()}
              onOpenTab={(tab) => setActiveTab(tab)} writtenStates={writtenStates} />
          </TabsContent>
        </Tabs>
      </AppPage>
      <PublicPageFooter />
    </div>
    </>
  );
}
