import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
import { hubLinkFor } from "@shared/hub-links";
import { isPortal, marketingUrl, portalUrl } from "@/lib/site";

/**
 * Renders a Hub answer as React text nodes only (guardrails §7): no
 * dangerouslySetInnerHTML and no markdown library. Supported: paragraphs,
 * "- " and "1. " lists, **bold**, and [text](/path) links whose path is in
 * shared/hub-links.ts — any other link renders as its plain text. No bare-URL
 * auto-linking, no images, no HTML.
 */

const INLINE = /(\*\*[^*\n]+\*\*|\[[^\]\n]{1,80}\]\([^)\s]+\))/g;

function scrollToHash(href: string) {
  const hash = href.split("#")[1];
  if (!hash) return;
  window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
}

function HubLink({ text, href, onNavigate }: { text: string; href: string; onNavigate?: () => void }) {
  const link = hubLinkFor(href);
  if (!link) return <>{text}</>;
  const cls = "font-medium text-orange-700 underline underline-offset-2 hover:text-orange-800 dark:text-orange-300 dark:hover:text-orange-200";
  const crmPath = href.startsWith("/crm/");
  // The CRM lives on the portal host and the marketing/growth pages on the apex: cross over with a full link.
  if (isPortal() !== crmPath) {
    const url = crmPath ? portalUrl(href) : marketingUrl(href);
    return <a href={url} className={cls} data-testid="hub-answer-link">{text}</a>;
  }
  return (
    <Link href={href} className={cls} data-testid="hub-answer-link" onClick={() => { onNavigate?.(); scrollToHash(href); }}>
      {text}
    </Link>
  );
}

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  return text.split(INLINE).filter((part) => part !== "").map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold">{inline(part.slice(2, -2), onNavigate)}</strong>;
    }
    const link = part.match(/^\[([^\]\n]{1,80})\]\(([^)\s]+)\)$/);
    if (link) return <HubLink key={i} text={link[1]} href={link[2]} onNavigate={onNavigate} />;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] };

export function parseHubBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-•]\s+(.*)$/);
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    const kind = bullet ? "ul" : numbered ? "ol" : "p";
    const body = (bullet ?? numbered)?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (kind !== "p" && last && last.kind === kind) last.items.push(body);
    else if (kind === "p") blocks.push({ kind, text: body });
    else blocks.push({ kind, items: [body] });
  }
  return blocks;
}

export function HubMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-2 break-words">
      {parseHubBlocks(text).map((block, i) => {
        if (block.kind === "p") return <p key={i}>{inline(block.text, onNavigate)}</p>;
        const items = block.items.map((item, j) => <li key={j}>{inline(item, onNavigate)}</li>);
        return block.kind === "ul"
          ? <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>
          : <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol>;
      })}
    </div>
  );
}
