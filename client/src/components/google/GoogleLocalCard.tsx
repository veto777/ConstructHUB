import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GoogleStars } from "./GoogleStars";
import { GoogleOpenStatus } from "./GoogleOpenStatus";

export type GooglePhoto = { src: string; alt?: string; href?: string | null };

/** The blue person circle before a review snippet. */
export function GoogleAvatar({ src, initial, small, alt }: { src?: string | null; initial?: string | null; small?: boolean; alt?: string }) {
  return (
    <span className={cn("g-avatar", small && "g-avatar--sm")} aria-hidden={alt ? undefined : true}>
      {src ? <img src={src} alt={alt ?? ""} referrerPolicy="no-referrer" loading="lazy" />
        : initial ? <span>{initial}</span>
        : <svg viewBox="0 0 24 24" width={small ? 14 : 20} height={small ? 14 : 20} fill="currentColor" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z" /></svg>}
    </span>
  );
}

/** Wraps every match of `highlight` in <b>, Google-style. */
export function highlightText(text: string, highlight?: string | null): ReactNode {
  const term = highlight?.trim();
  if (!term) return text;
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

/**
 * One Google local-pack entry: name, rating row, status row, years in business, review snippet, photo
 * strip on the right, pill actions underneath. Pass only real data — any prop left out is simply not shown.
 */
export function GoogleLocalCard({
  name, onOpen, href, rating, reviewCount, priceRange, category, open, hours, address, statusTitle, closedLabel,
  yearsInBusiness, snippet, photos, actions, meta, badges, children, testId, className, nameTestId,
}: {
  /** Replaces "Closed" (e.g. "Permanently closed"). */
  closedLabel?: string;
  name: ReactNode;
  /** Makes the name a button (our detail view) … */
  onOpen?: () => void;
  /** … or a link. */
  href?: string;
  rating?: number | string | null;
  reviewCount?: number | null;
  priceRange?: string | null;
  category?: string | null;
  /** null = unknown: the status is omitted, never assumed. */
  open?: boolean | null;
  hours?: string | null;
  address?: ReactNode;
  statusTitle?: string;
  /** e.g. "7+ years in business" — only when the opening date is known. */
  yearsInBusiness?: string | null;
  snippet?: { text: string; highlight?: string | null; avatarSrc?: string | null } | null;
  photos?: GooglePhoto[] | null;
  /** The pill row (GooglePill elements). */
  actions?: ReactNode;
  /** A small grey meta line under the title block (source, sync state). */
  meta?: ReactNode;
  /** Small inline markers after the name (NEW, flags). */
  badges?: ReactNode;
  children?: ReactNode;
  testId?: string;
  nameTestId?: string;
  className?: string;
}) {
  const pics = (photos ?? []).filter((p) => p.src).slice(0, 2);
  const title = onOpen
    ? <button type="button" onClick={onOpen} data-testid={nameTestId}>{name}</button>
    : href ? <a href={href} data-testid={nameTestId}>{name}</a>
    : <span data-testid={nameTestId}>{name}</span>;
  return (
    <article className={cn("g-card", className)} data-testid={testId}>
      <div className="g-card__row">
      <div className="g-card__body">
        <h3 className="g-card__title">{title}{badges && <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">{badges}</span>}</h3>
        <GoogleStars rating={rating} count={reviewCount} priceRange={priceRange} category={category} />
        <GoogleOpenStatus open={open ?? null} hours={hours} address={address} title={statusTitle} closedLabel={closedLabel} />
        {yearsInBusiness && <p className="g-card__line">{yearsInBusiness}</p>}
        {meta && <p className="g-card__meta">{meta}</p>}
        {snippet?.text && (
          <div className="g-card__snippet">
            <GoogleAvatar src={snippet.avatarSrc} small />
            <span>“{highlightText(snippet.text, snippet.highlight)}”</span>
          </div>
        )}
        {children}
      </div>
      {pics.length > 0 && (
        <div className={cn("g-card__photos", pics.length > 1 && "g-card__photos--two")} aria-hidden={pics.every((p) => !p.alt) || undefined}>
          {pics.map((p, i) => p.href
            ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" tabIndex={-1}><img src={p.src} alt={p.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /></a>
            : <span key={i}><img src={p.src} alt={p.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /></span>)}
        </div>
      )}
      </div>
      {actions && <div className="g-card__actions">{actions}</div>}
    </article>
  );
}
