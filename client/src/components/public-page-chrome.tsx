/**
 * Minimal header + footer for marketing-site pages a signed-out visitor can
 * land on directly (/reinstatement, /crm-app). Signed in, those pages render
 * inside the dashboard frame, which already has navigation — so this renders
 * nothing unless the visitor is signed out.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CHLogo } from "@/components/ch-logo";
import { copyrightNotice } from "@/lib/marketing";

function useSignedOut(): boolean {
  const { data: user, isLoading } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  return !isLoading && !user;
}

export function PublicPageHeader({ next }: { next: string }) {
  if (!useSignedOut()) return null;
  return (
    <header className="bg-[#1e2a4a] border-b border-white/5" data-testid="header-public-page">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <Link href="/" aria-label="ConstructHUB home" data-testid="link-public-home">
          <CHLogo height={32} />
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/pricing" className="hidden sm:inline px-3 py-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10" data-testid="link-public-pricing">
            Pricing
          </Link>
          <Link href={`/auth?next=${encodeURIComponent(next)}`} className="px-3 py-1.5 rounded-md bg-[#4A6CF7] hover:bg-[#3B5CE5] text-white font-medium" data-testid="link-public-signin">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicPageFooter() {
  if (!useSignedOut()) return null;
  return (
    <footer className="border-t py-6 px-4 text-center text-xs text-muted-foreground" data-testid="footer-public-page">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span aria-hidden>·</span>
        <a href="mailto:support@constructhub.us" className="hover:text-foreground">support@constructhub.us</a>
        <span aria-hidden>·</span>
        <a href="/terms" className="hover:text-foreground">Terms</a>
        <span aria-hidden>·</span>
        <a href="/privacy" className="hover:text-foreground">Privacy</a>
      </div>
      <p className="mt-2">{copyrightNotice()}</p>
    </footer>
  );
}
