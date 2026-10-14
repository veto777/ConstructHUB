/**
 * One assessor / appraiser office, as the Property records list shows it: name, place, the honest link
 * status line and the pill actions (open the site, search it, the web-search fallback, call). The county
 * map's panel renders this same row, so both say exactly the same thing about an office.
 */
import { GoogleListRow, GooglePill } from "@/components/google";
import { ExternalLink, Phone, Search } from "lucide-react";
import type { County } from "@shared/schema";
import { propertyJurisdictionLabel, propertyOfficeLinks } from "@/pages/property-display";

export interface PropertyAppraiser {
  id: number;
  name: string;
  countyId: number;
  portalUrl: string | null;
  searchUrl: string | null;
  platform: string | null;
  linkStatus: string | null;
  lastVerifiedAt?: string | null;
  phone: string | null;
  address: string | null;
  searchableFields: string[] | null;
  isActive: boolean;
  notes: string | null;
  county?: County;
}

export function PropertyOfficeRow({ appraiser, testIdPrefix = "" }: { appraiser: PropertyAppraiser; testIdPrefix?: string }) {
  const { challenge, showPortal, showSearch, notice, fallback } = propertyOfficeLinks(appraiser);
  const unconfirmed = appraiser.linkStatus === "unconfirmed";
  const id = `${testIdPrefix}${appraiser.id}`;
  return (
    <GoogleListRow
      testId={`card-appraiser-${id}`}
      title={appraiser.name}
      meta={[
        appraiser.county ? `${propertyJurisdictionLabel(appraiser.county)}, ${appraiser.county.state}` : null,
        appraiser.address,
      ]}
      line={notice || appraiser.notes ? (
        <>
          {notice && <span>{notice}</span>}
          {notice && appraiser.notes && <span aria-hidden="true"> · </span>}
          {appraiser.notes && <span>{appraiser.notes}</span>}
        </>
      ) : undefined}
      actions={<>
        {showPortal && (
          <GooglePill icon={ExternalLink} label={unconfirmed ? "Open unconfirmed site" : "Open portal"} href={appraiser.portalUrl!} external testId={`button-visit-appraiser-${id}`} />
        )}
        {showSearch && (
          <GooglePill icon={Search} label={unconfirmed ? "Search unconfirmed site" : "Search records"} href={appraiser.searchUrl!} external testId={`button-search-appraiser-${id}`} />
        )}
        {fallback && (
          <GooglePill
            icon={Search}
            variant={challenge ? "solid" : "quiet"}
            label="Find property records"
            external
            testId={`link-appraiser-fallback-${id}`}
            title="Find the official property records office through a web search"
            href={`https://www.google.com/search?q=${encodeURIComponent(`${appraiser.county?.name || appraiser.name} ${appraiser.county?.stateCode || ""} assessor property records`)}`}
          />
        )}
        {appraiser.phone && (
          <GooglePill icon={Phone} label="Call" href={`tel:${appraiser.phone.replace(/[^\d+]/g, "")}`} title={appraiser.phone} testId={`link-phone-${id}`} />
        )}
      </>}
    />
  );
}
