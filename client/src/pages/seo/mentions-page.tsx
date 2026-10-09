/**
 * /seo/mentions: unlinked mentions and the mentions watch for one of the customer's sites, on their own page — where
 * a "New mentions" alert leads (?site=<id>&check=<id>). The same view as Site Explorer -> Mentions, without needing a
 * Site Explorer report first. Saved data only until something is bought on the page itself.
 *
 * The address is the view (links.ts seoLinks.mentions): ?site= the site (every SEO page honours it), ?check= one
 * watched check, ?tab= which mentions; a chip says what narrowed it.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { ActiveFilter, clearParams, Empty, SeoShell, useAddress, useSelectedSite, useSeoSites, useSeoStatus, useSiteMissing } from "./shell";
import { MentionsView, TAB_LABEL } from "./mentions";

export default function SeoMentionsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  // ?site=<id> is honoured by useSelectedSite; one that is not one of this account's is said, and the site shown is not taken for it.
  const missing = useSiteMissing(sites.data);
  const params = useAddress();
  const checkParam = params.get("check");
  const check = Number(checkParam) || null;
  const tab = params.get("tab");
  /** What the view made of ?check= once it loaded, and for which check: that check shown, or not available (the newest shown instead). */
  const [checkState, setCheckState] = useState<{ check: number | null; chosen: boolean; missing: boolean } | null>(null);
  const known = checkState !== null && checkState.check === check ? checkState : null;
  // The chip says what is on screen: the check named, or why it is not (not a number, not available — the newest
  // instead). Nothing is said of a check number until its answer is in: before that it is not known to be shown.
  const checkWords = checkParam === null ? "" : !check ? `check "${checkParam}" — not a check number, so the newest check is shown`
    : missing || !known ? "" : known.missing ? `check #${check} — not available (it may belong to another site), so the newest check is shown`
    : known.chosen ? `the check an alert was raised from (#${check}), in the monthly watch below` : `check #${check}`;
  const chip = [checkWords, tab ? (TAB_LABEL[tab] ? `${TAB_LABEL[tab]} only` : `"${tab}" — not a tab here, so ${TAB_LABEL.prospects} is shown`) : ""].filter(Boolean).join(" · ");
  // Another site has its own checks and tabs.
  const changeSite = (id: number) => { clearParams(["check", "tab"]); onSite(id); };
  return (
    <SeoShell title="Mentions" description="Pages on other websites that use your business's name, and whether they link to you." site={site} onSite={changeSite} sites={sites} status={status}>
      {chip && site && <ActiveFilter onClear={() => clearParams(["check", "tab"], false)} clearLabel={`Newest check · ${TAB_LABEL.prospects}`}>Showing {chip}</ActiveFilter>}
      {sites.isLoading ? <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your sites…</p>
        : sites.isError ? <div className="g-callout" role="alert"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(sites.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void sites.refetch()}>Try again</button></div>
        : !site ? <Empty testId="mentions-page-no-site"><h3>No site yet</h3><p>Add your website on the SEO dashboard first.</p></Empty>
        : <>
            {missing && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="mentions-page-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
            <MentionsView key={site.id} siteId={site.id} domain={site.domain} status={status.data} checkId={!missing ? check : null} onCheck={(s) => setCheckState({ ...s, check })} />
          </>}
    </SeoShell>
  );
}
