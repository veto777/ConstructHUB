/**
 * The 404 page in the marketing site's editorial look (design B): the gator on
 * the navy grid panel with his line, and the way back. Signed out it wears the
 * public header and footer; signed in it sits inside the app frame (the
 * chrome renders nothing then).
 */
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { StandingGator } from "@/components/mascot";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { BTN_LG, BTN_OUTLINE, BTN_PRIMARY, Kicker } from "@/components/feature-landing/primitives";

export default function NotFound() {
  const [location] = useLocation();
  // Signed out there is no app frame: fill the window so the footer sits at the bottom.
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const signedOut = !isLoading && !user;
  return (
    <div className={`flex flex-col ${signedOut ? "min-h-screen" : "min-h-full h-full"}`}>
      <PublicPageHeader next={location} />
      <div className="mkt-editorial relative flex-1 bg-mkt-paper text-mkt-ink overflow-hidden" data-testid="page-not-found">
        <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" aria-hidden />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20 grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-7 text-center lg:text-left order-2 lg:order-1">
            <Kicker n="404" className="justify-center lg:justify-start">Error</Kicker>
            <h1 className="font-display mt-5 font-semibold text-[2.6rem] sm:text-[3.3rem] lg:text-[3.8rem] leading-[1.02] tracking-[-0.02em] [text-wrap:balance]">
              Page <span className="mkt-marker">Not Found</span>
            </h1>
            <p className="mt-5 text-[17px] text-mkt-ink-soft leading-relaxed max-w-md mx-auto lg:mx-0">
              The page you're looking for doesn't exist or has been moved.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3">
              <Link href="/" className={`${BTN_PRIMARY} ${BTN_LG}`} data-testid="link-back-home">
                <ArrowLeft className="h-4 w-4" /> Back to home
              </Link>
              <Link href="/features" className={`${BTN_OUTLINE} ${BTN_LG}`} data-testid="link-not-found-features">
                See every feature
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5 order-1 lg:order-2" aria-hidden>
            <div className="relative overflow-hidden rounded-[28px] lg:rounded-[32px] bg-mkt-panel text-mkt-panel-ink max-w-sm mx-auto">
              <div className="absolute inset-0 mkt-grid-paper-panel" />
              <div className="relative flex flex-col items-center gap-5 px-6 pt-8">
                <p className="mkt-bubble px-5 py-3.5 text-[17px] sm:text-[19px] leading-snug -rotate-1" data-testid="text-not-found-bubble">
                  This page wandered off the job site.
                </p>
                <StandingGator height={220} className="shrink-0 -mb-1" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
