/**
 * /seo/mentions: unlinked mentions and the mentions watch for one of the customer's sites, on their own page — where
 * a "New mentions" alert leads (?site=<id>&check=<id>). The same view as Site Explorer -> Mentions, without needing a
 * Site Explorer report first. Saved data only until something is bought on the page itself.
 */
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "@/lib/queryClient";
import { Empty, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { MentionsView } from "./mentions";

export default function SeoMentionsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  const search = useSearch();
  const params = new URLSearchParams(search);
  const wanted = Number(params.get("site")) || null, check = Number(params.get("check")) || null;
  const [missing, setMissing] = useState(false);
  // ?site=<id>, whenever the address changes (also a link followed while this page is open): that site when it is one
  // of this account's — otherwise it is said, and the site shown is not taken for it.
  useEffect(() => {
    if (!wanted || !sites.data) { setMissing(false); return; }
    const found = sites.data.some((s) => s.id === wanted);
    setMissing(!found);
    if (found && site?.id !== wanted) onSite(wanted);
  }, [search, sites.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SeoShell title="Mentions" description="Pages on other websites that use your business's name, and whether they link to you." site={site} onSite={onSite} sites={sites} status={status}>
      {sites.isLoading ? <p className="g-text-2 flex items-center gap-2 text-[14px]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading your sites…</p>
        : sites.isError ? <div className="g-callout" role="alert"><h3>Couldn't load your sites</h3><p>{apiErrorMessage(sites.error)}</p><button type="button" className="g-pill mt-2" onClick={() => void sites.refetch()}>Try again</button></div>
        : !site ? <Empty testId="mentions-page-no-site"><h3>No site yet</h3><p>Add your website on the SEO dashboard first.</p></Empty>
        : <>
            {missing && <p className="mb-3 text-[13px]" role="status" style={{ color: "#b06000" }} data-testid="mentions-page-missing">The site this link is for isn't one of yours (or was removed). Showing {site.domain}.</p>}
            <MentionsView key={site.id} siteId={site.id} domain={site.domain} status={status.data} checkId={!missing && wanted === site.id ? check : null} />
          </>}
    </SeoShell>
  );
}
