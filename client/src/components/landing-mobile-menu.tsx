/**
 * Phone-width section menu for the marketing landing pages. Their section
 * links sit in a `hidden md:flex` row, so under 768px there was no way to
 * reach them from the nav at all. On phones it also carries Sign In and the
 * theme toggle, which the nav hides there to make room for the logo.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

export interface LandingSectionLink {
  href: `#${string}`;
  label: string;
}

export function LandingMobileMenu({ links, routeLinks = [], signInHref }: { links: LandingSectionLink[]; routeLinks?: { href: string; label: string }[]; signInHref?: string }) {
  const [open, setOpen] = useState(false);

  const jump = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setOpen(false);
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    try { window.history.replaceState(window.history.state, "", href); } catch { /* cosmetic only */ }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center rounded-md h-9 w-9 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Open menu"
          data-testid="button-landing-menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      {/* Focus stays on the section we jumped to instead of snapping back to the trigger. */}
      <SheetContent side="right" className="w-72 max-w-[85vw]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>{routeLinks.length ? "Jump to a section of this page, or open another page." : "Jump to a section of this page."}</SheetDescription>
        </SheetHeader>
        <nav className="mt-4 flex flex-col gap-1" aria-label={routeLinks.length ? "Menu" : "Page sections"}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => jump(e, link.href)}
              className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted transition-colors"
              data-testid={`link-mobile-nav-${link.href.slice(1)}`}
            >
              {link.label}
            </a>
          ))}
          {routeLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted transition-colors"
              data-testid={`link-mobile-nav-${link.href.slice(1)}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t pt-4 space-y-2">
          {signInHref && (
            <Link
              href={signInHref}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2.5 text-base font-medium hover:bg-muted transition-colors"
              data-testid="link-mobile-signin"
            >
              Sign In
            </Link>
          )}
          <div className="flex items-center justify-between pl-3">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
