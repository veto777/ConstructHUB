import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** "a · b · c": the parts joined by Google's middots; empty parts are dropped. */
export function GoogleMeta({ parts, className, testId }: { parts: ReactNode[]; className?: string; testId?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  if (!shown.length) return null;
  return (
    <p className={cn("g-card__line", className)} data-testid={testId}>
      {shown.map((p, i) => <span key={i}>{i > 0 && <span aria-hidden="true"> · </span>}{p}</span>)}
    </p>
  );
}

/**
 * A generic hairline-divided row in Google's local-pack format, for lists of things that are not businesses
 * (permit offices, appraiser offices, searches, schedules, activity): a title (plain, a link or a button), a
 * meta line with middots, an optional small line under it, an optional thumbnail or trailing controls on the
 * right, and pill actions underneath. Only what is passed is rendered.
 */
export function GoogleListRow({
  title, href, external, onOpen, meta, line, leading, thumbnail, trailing, actions, badges, children,
  size = "lg", as: Tag = "article", testId, titleTestId, className, ...rest
}: {
  title: ReactNode;
  /** The title links here … */
  href?: string;
  external?: boolean;
  /** … or is a button (our own detail view). */
  onOpen?: () => void;
  /** The 14px grey line: parts joined with middots, or any node. */
  meta?: ReactNode[] | ReactNode;
  /** A second small (12px) grey line. */
  line?: ReactNode;
  /** An icon circle before the row. */
  leading?: ReactNode;
  /** One square thumbnail on the right. */
  thumbnail?: { src: string; alt?: string; href?: string | null } | null;
  /** Controls on the right edge (a switch, an icon button). */
  trailing?: ReactNode;
  /** The pill row under the body (GooglePill elements). */
  actions?: ReactNode;
  /** Small inline markers after the title. */
  badges?: ReactNode;
  children?: ReactNode;
  /** lg: 20px title (the local pack) · md: 16px title (dense lists). */
  size?: "lg" | "md";
  as?: ElementType;
  testId?: string;
  titleTestId?: string;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  const heading = onOpen
    ? <button type="button" onClick={onOpen} data-testid={titleTestId}>{title}</button>
    : href
      ? <a href={href} data-testid={titleTestId} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{title}</a>
      : <span data-testid={titleTestId}>{title}</span>;
  const metaNode = Array.isArray(meta) ? <GoogleMeta parts={meta} /> : meta ? <p className="g-card__line">{meta}</p> : null;
  return (
    <Tag className={cn("g-card", className)} data-testid={testId} {...rest}>
      <div className="g-card__row">
        {leading && <span className="g-card__lead" aria-hidden="true">{leading}</span>}
        <div className="g-card__body">
          <h3 className={cn("g-card__title", size === "md" && "g-card__title--md")}>
            {heading}
            {badges && <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">{badges}</span>}
          </h3>
          {metaNode}
          {line && <p className="g-card__meta">{line}</p>}
          {children}
        </div>
        {thumbnail?.src && (
          thumbnail.href
            ? <a className="g-card__thumb" href={thumbnail.href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden={thumbnail.alt ? undefined : true}><img src={thumbnail.src} alt={thumbnail.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /></a>
            : <span className="g-card__thumb" aria-hidden={thumbnail.alt ? undefined : true}><img src={thumbnail.src} alt={thumbnail.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" /></span>
        )}
        {trailing && <div className="g-card__trailing">{trailing}</div>}
      </div>
      {actions && <div className="g-card__actions">{actions}</div>}
    </Tag>
  );
}

/** The list the rows sit in (no border of its own; the rows draw the hairlines). */
export function GoogleList({ children, as: Tag = "div", testId, className, ...rest }: { children: ReactNode; as?: ElementType; testId?: string; className?: string } & HTMLAttributes<HTMLElement>) {
  return <Tag className={cn("g-list", className)} data-testid={testId} {...rest}>{children}</Tag>;
}
