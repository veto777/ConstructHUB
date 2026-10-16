import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
/** The Guide tab of each site-connection page shows its own provider's steps only (review w2-agent10 #10);
 *  the Guides library (no provider) shows both. */
export function SiteConnectionGuide({ provider }: { provider?: "cloudflare" | "gsc" }) {
  if (provider === "gsc") return <SearchConsoleGuide />;
  if (provider === "cloudflare") return <CloudflareGuide />;
  return <div className="space-y-5"><CloudflareGuide /><SearchConsoleGuide /></div>;
}

/**
 * The Search Console guide, written from the real flow: Connections → SearchConsoleConnectSteps
 * (site-connect-steps.tsx), the Sites tab (sync range, Sync selected / Sync all matching sites, the site's
 * breakdowns, sitemaps and URL inspections), Onboarding (server/cloudflare/worker.ts invitation email) and the
 * Locations Insights card (/api/gsc/locations/:id/summary).
 */
function SearchConsoleGuide() {
  return (
    <div className="space-y-5" data-testid="search-console-guide">
      <Card>
        <CardHeader>
          <CardTitle>Connect your Google Search Console</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              Find the Google account that can already see your website in
              Search Console (an owner or a full user of the property). Not
              sure? Open Search Console and check which account lists your
              site.
            </li>
            <li>
              Open the Connections tab and choose “Connect Google Search
              Console”. Google’s own sign-in page opens.
            </li>
            <li>
              Pick that Google account and allow access. Google asks for your
              email address and Search Console; tick the Search Console box if
              Google shows one, then choose Continue or Allow.
            </li>
            <li>
              You come back here automatically. The account shows under
              Connections, and its websites appear under Sites within a minute
              or two. Work queue shows the import as it runs. “Discover sites”
              beside a connection looks again.
            </li>
          </ol>
          <p className="text-sm text-muted-foreground">
            This connection gives ConstructHUB Search Console access only. It
            is kept separate from Google Business Profile and Calendar.
          </p>
          <a
            className="text-primary underline"
            href="https://search.google.com/search-console"
            target="_blank"
            rel="noreferrer"
          >
            Open Google Search Console
          </a>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bring in your search numbers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              On the Sites tab, tick the websites you want and choose “Sync
              selected”, or choose “Sync all matching sites”. “Import date
              range” sets how far back to go, up to 16 months.
            </li>
            <li>
              Choose Open on a site to see its clicks and impressions. The
              Breakdown list splits them by date, search query, page, device or
              country.
            </li>
            <li>
              A site whose web address matches the website of one of your
              Locations is linked to it. That location’s Insights tab then
              shows the site’s Search Console clicks and impressions for the
              last 30 days.
            </li>
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sitemaps and page checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            On a site’s page, under “Sitemaps and URL inspections”, add your
            sitemap address (for example https://your-site.com/sitemap.xml) to
            submit it to Google, or add page addresses to have Google check
            whether they are indexed. Checks run in the background, and Google
            limits how many pages of one site can be checked each day.
          </p>
          <p>
            A check only reports what Google says about the page. It does not
            ask Google to index it.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>A client’s website you can’t see yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              On the Connections tab, select the Google account the client
              should share with (the round button beside it).
            </li>
            <li>
              On the Onboarding tab, enter one client per line: their email,
              then the location ID (listed on the same tab). The location needs
              a website. Choose “Send onboarding emails”.
            </li>
            <li>
              The client opens Search Console → Settings → Users and
              permissions → Add user, enters your Google email, chooses Full,
              and adds it. ConstructHUB checks for the website in the
              background and it appears under Sites.
            </li>
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Disconnecting</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Disconnect on the Connections tab removes the Search Console
            connection and the Search Console data saved here. To also remove
            ConstructHUB from your Google account, go to your Google Account →
            Security → third-party access. That can remove ConstructHUB’s other
            Google access too, such as Google Business Profile and Calendar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CloudflareGuide() {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Put a client site behind Cloudflare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              Create a Cloudflare account at cloudflare.com, choose Add a
              domain, enter the existing domain, and select a plan. Cloudflare
              proxies and protects the site; the site stays hosted where it is.
            </li>
            <li>
              Review imported DNS records against the current DNS provider.
              Preserve email MX/TXT records and origin addresses. Proxy the web
              records you want protected; DNS-only records bypass edge
              protection.
            </li>
            <li>
              Cloudflare supplies two nameservers. At the registrar, replace the
              current nameservers with those exact values. Coordinate DNSSEC
              changes using Cloudflare’s setup instructions before switching.
            </li>
            <li>
              GoDaddy: Domain Portfolio → select domain → DNS → Nameservers →
              Change. Namecheap: Domain List → Manage → Nameservers → Custom
              DNS. Google Domains registrations moved to Squarespace: Domains →
              domain → DNS → Domain Nameservers → Use custom nameservers.
              Bluehost: Domains → domain → DNS → Nameservers → Edit. Labels may
              vary; use the registrar’s current help if the screens differ.
            </li>
            <li>
              Wait for Cloudflare to show Active; nameserver changes can take up
              to 48 hours. Confirm the website and email still work before
              applying protection rules.
            </li>
          </ol>
          <a
            className="text-primary underline"
            href="https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare setup instructions
          </a>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Connect Cloudflare to ConstructHUB</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p>
            Recommended: open ConstructHUB → Cloudflare → Connections and choose
            “Connect with Cloudflare”. Sign in at Cloudflare, tick the account
            with your websites, and choose Authorize; you are brought straight
            back and your sites import on their own.
          </p>
          <p>
            Without the sign-in: Cloudflare → My Profile → API Tokens → Global
            API Key → View. Under “Other ways to connect”, enter your Cloudflare
            login email and Global API Key, verify, select the zones, and create
            the limited key.
          </p>
          <p>
            Your Global Key is used once to create a limited ConstructHUB key
            and is never saved. You can see and revoke it in Cloudflare → My
            Profile → API Tokens. During zone selection it stays only in this
            browser form and each verification request; the server does not
            retain it. The form clears it after exchange.
          </p>
          <p>
            The created token is named ConstructHUB (date). Zone Read discovers
            sites; Analytics Read reads traffic/security analytics; Zone WAF
            Edit manages edge rules. These permissions apply only to selected
            zones. ConstructHUB does not request DNS edit, billing, member
            management, or token management on that limited token.
          </p>
          <p>
            Agency option: the owner configures the agency login email/token.
            The client invites that email under Manage Account → Members, scoped
            to the desired zone, with the domain-scoped Domain Administrator
            role and API access enabled. This grants full access to the selected
            domain, including DNS, and is broader than the token option. The
            Analytics and Firewall roles are account-scoped alternatives that
            apply across all account domains; do not select those when access
            must be limited to one domain. If that scope is too broad or roles
            are unavailable on the plan, use the scoped-token method. Do not
            grant Super Administrator or billing roles. Onboarding needs the
            client’s account ID and an existing location with its website.
          </p>
          <p>
            Fallback: My Profile → API Tokens → Create Token → Custom token. Add
            Zone → Zone → Read; Zone → Analytics → Read; Zone → WAF → Edit. For
            Zone Resources choose Include → Specific zone. Continue to summary →
            Create Token, copy once, and paste into Scoped API token.
          </p>
          <p>
            Disconnect deletes local credentials, queued work and cached
            provider data. A token created by ConstructHUB is deleted remotely
            if Cloudflare permits self-revocation; otherwise follow the
            displayed instruction to delete it in API Tokens. Pasted tokens and
            agency memberships must be revoked in Cloudflare. Applied rules stay
            active until you undo them before disconnecting or remove them in
            Cloudflare.
          </p>
          <p>
            Rules require preview and confirmation. They may block real
            customers; check office-IP exemptions. Rate-limit availability
            depends on the Cloudflare plan. High security level is not applied
            automatically because Cloudflare’s current security-level behavior
            differs from the older playbook. Review Security settings directly
            in Cloudflare. This integration cannot protect unproxied traffic or
            guarantee the elimination of click fraud.
          </p>
          <a
            className="text-primary underline"
            href="https://developers.cloudflare.com/fundamentals/manage-members/roles/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare role reference
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
