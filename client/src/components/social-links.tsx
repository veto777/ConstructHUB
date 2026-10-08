/**
 * "Follow ConstructHUB": the row of icon links to the official social accounts (shared/social-links.ts is the
 * one list). Every footer, the landing strip, the sign-up page and the dashboard's getting-started card render
 * this component, so a new account appears everywhere at once.
 *
 * Each link opens in a new tab; inside the iPhone apps the shell hands any off-site link to Safari
 * (ios/Shared/BrowserController.swift), the same as every other external link. The links sell nothing.
 * Touch targets are 44 px on phones and 36 px from `sm` up.
 */
import type { ComponentType, SVGProps } from "react";
import { Instagram, Linkedin, Youtube } from "lucide-react";
import { SOCIAL_LINKS, type SocialKey } from "@shared/social-links";

/** TikTok is not in lucide: a plain single-stroke note in the same 24 px outline style as the other icons. */
export function TikTokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 3v12.5a4.5 4.5 0 1 1-4.5-4.5" />
      <path d="M14 3c.3 3 2.4 5 6 5.2" />
    </svg>
  );
}

const ICONS: Record<SocialKey, ComponentType<SVGProps<SVGSVGElement>>> = {
  youtube: Youtube,
  instagram: Instagram,
  tiktok: TikTokIcon,
  linkedin: Linkedin,
};

/** Where the row sits: the navy marketing footers, the cream marketing paper, or the app's own surfaces. */
export type SocialTone = "navy" | "paper" | "app";

const LINK_BASE = "inline-flex h-11 w-11 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const LINK_TONE: Record<SocialTone, string> = {
  navy: "text-mkt-navy-muted hover:text-mkt-navy-ink hover:bg-white/10 focus-visible:text-mkt-navy-ink focus-visible:ring-mkt-orange focus-visible:ring-offset-mkt-navy",
  paper: "text-mkt-ink-soft hover:text-mkt-ink hover:bg-mkt-paper-2 focus-visible:text-mkt-ink focus-visible:ring-mkt-orange focus-visible:ring-offset-mkt-paper",
  app: "text-muted-foreground hover:text-primary hover:bg-primary/10 focus-visible:text-primary focus-visible:ring-ring focus-visible:ring-offset-background",
};
const LABEL_TONE: Record<SocialTone, string> = {
  navy: "text-mkt-navy-muted",
  paper: "text-mkt-ink-soft",
  app: "text-muted-foreground",
};

export function SocialLinks({
  tone, label = "Follow ConstructHUB", className = "", testId = "social-links",
}: {
  tone: SocialTone;
  /** The words before the icons; `null` renders the icons alone (the row is still named for screen readers). */
  label?: string | null;
  className?: string;
  testId?: string;
}) {
  if (!SOCIAL_LINKS.length) return null;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 ${className}`} data-testid={testId}>
      {label && <span className={`text-[13px] leading-none ${LABEL_TONE[tone]}`}>{label}</span>}
      <ul className="flex items-center gap-1 sm:gap-0.5" aria-label={label ?? "Follow ConstructHUB"}>
        {SOCIAL_LINKS.map((link) => {
          const Icon = ICONS[link.key];
          return (
            <li key={link.key} className="flex">
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                title={link.label}
                className={`${LINK_BASE} ${LINK_TONE[tone]}`}
                data-testid={`link-social-${link.key}`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
