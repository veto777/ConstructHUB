/**
 * Montana. Checked live 2026-10-15: no source could be used today (see `blocked`). Montana's Construction Contractor
 * License (HB 239, from 2026-01-01) and the trade licenses are only searchable through the Department of Labor &
 * Industry's licensee lookup, which a firewall refuses for automated requests.
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "MT",
  checked: "2026-10-15",
  blocked: [
    "DLI Employment Standards licensee lookup and licensee list download (ebizws.mt.gov/PUBLICPORTAL; construction contractor, electrical, plumbing and other trade licenses): the F5 firewall answers 'Request Rejected', even for robots.txt",
    "DLI professional licensing on Accela (ebiz.mt.gov/pol → aca-prod.accela.com/pol): its license lookup redirects to the same rejected portal",
    "Secretary of State business search (biz.sosmt.gov): Cloudflare security check (HTTP 403)",
    "DLI prevailing-wage debarment list (erd.dli.mt.gov/labor-standards/public-contracts-prevailing-wage-law/debarment): live, but lists 'None' today",
    "State Procurement debarred-vendor list: the link from DLI (spb.mt.gov/Agency-Resources/Debarred-Suspended-Vendors) is a 404",
    "DEQ enforcement: annual summary reports only, no case-level list",
  ],
};
