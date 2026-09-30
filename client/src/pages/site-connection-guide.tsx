import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function SiteConnectionGuide() {
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
            Recommended: Cloudflare → My Profile → API Tokens → Global API Key →
            View. Open ConstructHUB → Cloudflare → Connections. Enter your
            Cloudflare login email and Global API Key, verify, select the zones,
            and create the limited key.
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
      <Card>
        <CardHeader>
          <CardTitle>Connect Google Search Console</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal pl-6 space-y-3">
            <li>
              The agency connects its Google account in Search Console →
              Connections and grants Search Console permission. This is separate
              from GBP and Calendar grants.
            </li>
            <li>
              Select that connection. Under Onboarding, find the client’s
              location ID, then enter the client email and location ID and send
              the instructions. The client opens Search Console → Settings →
              Users and permissions → Add user, enters the agency Google email,
              and chooses Full.
            </li>
            <li>
              The worker periodically calls sites.list. When the property
              appears, ConstructHUB maps matching website domains to owned
              locations. URL-prefix properties and sc-domain properties can
              overlap; Insights chooses one property to avoid duplicate totals.
            </li>
            <li>
              Choose sites and Sync selected or Sync all matching sites. Choose
              a start date for up to 16 months of history. Open a property for
              clicks, impressions, CTR and position by query, page, date, device
              or country; group by day, week or month.
            </li>
            <li>
              Submit sitemap URLs explicitly, or queue URLs for inspection.
              Inspection is limited per property and runs in the background.
              Coverage only describes inspected URLs. Google’s Indexing API
              supports JobPosting/BroadcastEvent pages only; general pages use
              sitemaps plus inspection monitoring.
            </li>
          </ol>
          <p>
            Owner setup: enable the Search Console API, register the
            /api/gsc/callback redirect URI, and add
            https://www.googleapis.com/auth/webmasters in Google Cloud → Google
            Auth Platform → Data Access. Google may require sensitive-scope
            verification. Keep the consent screen in production for durable
            agency connections.
          </p>
          <p>
            Disconnect removes only the local Search Console grant/cache.
            Revoking ConstructHUB in your Google Account can also revoke the
            app’s other Google permissions, including GBP and Calendar.
          </p>
          <a
            className="text-primary underline"
            href="https://developers.google.com/webmaster-tools/limits"
            target="_blank"
            rel="noreferrer"
          >
            Search Console API quotas
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
