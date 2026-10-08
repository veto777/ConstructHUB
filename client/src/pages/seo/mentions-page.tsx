/**
 * /seo/mentions: unlinked mentions and the mentions watch for one of the customer's sites, on their own page — where
 * a "New mentions" alert leads (?site=<id>). The same view as Site Explorer -> Mentions, without needing a Site
 * Explorer report first. Saved data only until something is bought on the page itself.
 */
import { useEffect } from "react";
import { Empty, SeoShell, useSelectedSite, useSeoSites, useSeoStatus } from "./shell";
import { MentionsView } from "./mentions";

export default function SeoMentionsPage() {
  const status = useSeoStatus();
  const sites = useSeoSites();
  const [site, onSite] = useSelectedSite(sites.data);
  // ?site=<id> from an alert: open that site when it is one of this account's.
  useEffect(() => {
    const want = Number(new URLSearchParams(window.location.search).get("site"));
    if (want && sites.data?.some((s) => s.id === want)) onSite(want);
  }, [sites.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SeoShell title="Mentions" description="Pages on other websites that use your business's name, and whether they link to you." site={site} onSite={onSite} sites={sites} status={status}>
      {site ? <MentionsView key={site.id} siteId={site.id} domain={site.domain} status={status.data} />
        : <Empty testId="mentions-page-no-site"><h3>No site yet</h3><p>Add your website on the SEO dashboard first.</p></Empty>}
    </SeoShell>
  );
}
