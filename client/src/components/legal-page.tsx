/**
 * The frame of a long-form legal page (/terms, /privacy) in the marketing
 * site's editorial look (design B): the public header when signed out, a
 * grid-paper masthead with the title and date, then the text in readable
 * editorial type (the `mkt-legal` scope in client/src/index.css) beside a
 * sticky table of contents on desktop (a "Contents" drop-down on phones), and
 * the public site footer when signed out.
 *
 * The pages keep their own wording and markup; the contents list is read from
 * their <section> headings after mount, so a section added to a page appears
 * in it without a second list to keep in step. Each section's id is its
 * data-testid without the "section-" prefix (#subscription-plans, #ccpa…).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { PublicPageFooter, PublicPageHeader } from "@/components/public-page-chrome";
import { Kicker } from "@/components/feature-landing/primitives";

type TocEntry = { id: string; label: string };

export function LegalPage({
  path, pageTestId, title, titleTestId, date, dateTestId, children, footer,
}: {
  path: string;
  pageTestId: string;
  title: string;
  titleTestId: string;
  /** "Last updated: …" / "Effective Date: …", shown under the title. */
  date: ReactNode;
  dateTestId: string;
  children: ReactNode;
  /** The copyright line under the text. */
  footer: ReactNode;
}) {
  const article = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const root = article.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section"));
    const entries: TocEntry[] = [];
    for (const section of sections) {
      const heading = section.querySelector("h2");
      if (!heading) continue;
      if (!section.id) {
        const testId = section.getAttribute("data-testid") ?? "";
        section.id = testId.replace(/^section-/, "") || `section-${entries.length + 1}`;
      }
      entries.push({ id: section.id, label: heading.textContent?.trim() ?? section.id });
    }
    setToc(entries);
    if (entries[0]) setActive(entries[0].id);
    // Highlight the section being read: the last one whose top has passed the upper third of the view.
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const observer = new IntersectionObserver((records) => {
      for (const r of records) seen.set(r.target.id, r.isIntersecting);
      const current = entries.find((e) => seen.get(e.id));
      if (current) setActive(current.id);
    }, { rootMargin: "0px 0px -60% 0px" });
    sections.forEach((s) => s.id && observer.observe(s));
    return () => observer.disconnect();
  }, []);

  /**
   * Jump within whatever scrolls the page (the window signed out, the app pane signed in).
   * `beforeScroll` runs first (the phone list closes itself there): closing it collapses the
   * list above the text, so the scroll waits a frame for that layout before aiming at the heading.
   */
  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string, beforeScroll?: () => void) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (beforeScroll) {
      beforeScroll();
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    try { window.history.replaceState(window.history.state, "", `#${id}`); } catch { /* cosmetic */ }
    setActive(id);
  };

  const list = (onPick?: () => void) => (
    <ol className="space-y-0.5 text-[13.5px] leading-snug">
      {toc.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            onClick={(e) => jump(e, entry.id, onPick)}
            className={`block border-l-2 py-1.5 pl-3 transition-colors ${active === entry.id ? "border-mkt-orange font-semibold text-mkt-ink" : "border-transparent text-mkt-ink-soft hover:text-mkt-ink hover:border-mkt-rule"}`}
            data-testid={`link-toc-${entry.id}`}
          >
            {entry.label}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="flex flex-col min-h-full">
      <PublicPageHeader next={path} />
      <div className="mkt-editorial mkt-shadcn flex-1 bg-mkt-paper text-mkt-ink overflow-x-clip" data-testid={pageTestId}>
        <header className="relative">
          <div className="absolute inset-0 mkt-grid-paper [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" aria-hidden />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-10 sm:pb-14">
            <a href="/" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-mkt-muted hover:text-mkt-ink transition-colors" data-testid="link-back-home">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Home
            </a>
            <Kicker n="" className="mt-8">Legal</Kicker>
            <h1 className="font-display mt-4 font-semibold text-[2.6rem] sm:text-[3.4rem] lg:text-[4rem] leading-[1.02] tracking-[-0.02em] text-mkt-ink" data-testid={titleTestId}>
              {title}
            </h1>
            <p className="mt-4 text-[15px] text-mkt-ink-soft" data-testid={dateTestId}>{date}</p>
          </div>
          <div className="mkt-ruler" aria-hidden />
        </header>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 lg:grid lg:grid-cols-12 lg:gap-12">
          <>
              {toc.length > 0 && <details className="lg:hidden mb-8 rounded-2xl border border-mkt-rule bg-mkt-card group" data-testid="toc-legal-mobile">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink [&::-webkit-details-marker]:hidden">
                  Contents · {toc.length} sections
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <nav aria-label="Contents" className="px-3 pb-4">
                  {list(() => {
                    const d = document.querySelector<HTMLDetailsElement>('[data-testid="toc-legal-mobile"]');
                    if (d) d.open = false;
                  })}
                </nav>
              </details>}
              <aside className="hidden lg:block lg:col-span-4 xl:col-span-3">
                <nav aria-label="Contents" className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2" data-testid="toc-legal">
                  <p className="mb-3 pl-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-mkt-orange-ink">Contents</p>
                  {list()}
                </nav>
              </aside>
          </>
          <article ref={article} className="mkt-legal min-w-0 lg:col-span-8 xl:col-span-9 max-w-[46rem]">
            {children}
            <div className="mt-14 pt-6 border-t border-mkt-rule text-[13px] text-mkt-muted" data-testid="text-copyright">
              {footer}
            </div>
          </article>
        </div>
      </div>
      <PublicPageFooter />
    </div>
  );
}
