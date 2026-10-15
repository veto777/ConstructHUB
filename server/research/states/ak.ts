/**
 * Alaska. Checked live 2026-10-15: no usable source today.
 *
 * Every Alaska contractor-license record the state publishes sits behind a DataDome bot challenge:
 *   - CBPL (Division of Corporations, Business and Professional Licensing, DCCED) holds construction contractor
 *     registrations, electrical/mechanical administrator licenses, business licenses and the CBPL download files on
 *     www.commerce.alaska.gov (and commerce.alaska.gov). robots.txt and every page answer HTTP 403 with a DataDome
 *     CAPTCHA page (geo.captcha-delivery.com).
 *   - The DCCED map server (maps.commerce.alaska.gov), whose Economics_Related/Business_Licenses layer this pack used
 *     until 2026-10-15, now answers robots.txt with the same DataDome 403 challenge, so the research code refuses the
 *     host ("robots.txt answered HTTP 403; no automated requests until it can be read"). Its REST endpoints still
 *     answer JSON, but a challenge on robots.txt is a refusal: the source is dropped, not worked around.
 *
 * DOLWD Mechanical Inspection (labor.alaska.gov/lss) issues electrician and plumber certificates of fitness but
 * publishes no lookup or list; its Wage and Hour debarment list is empty. See `blocked`.
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "AK",
  checked: "2026-10-15",
  blocked: [
    "CBPL professional-license search, business-license search and download files (www.commerce.alaska.gov/cbp and commerce.alaska.gov), which hold construction contractor registrations, electrical/mechanical administrator licenses and business licenses: HTTP 403 with a DataDome CAPTCHA page (geo.captcha-delivery.com) on robots.txt and on every page (rechecked 2026-10-15)",
    "DCCED map server business-license layer (maps.commerce.alaska.gov/server/rest/services/Economics_Related/Business_Licenses/MapServer/2), used until 2026-10-15: robots.txt now answers HTTP 403 with the DataDome CAPTCHA page, so the research code refuses the host; the same data's ArcGIS Online item (owner DCRAOpenData) points at that host",
    "DOLWD Mechanical Inspection certificates of fitness (electricians, plumbers; labor.alaska.gov/lss/mihome.htm, plumbing_electrical.htm, mi-faq.html): no public lookup or list published (rechecked 2026-10-15)",
    "DOLWD Wage and Hour public-construction debarment list (labor.alaska.gov/lss/debarments.htm, 'last updated: November 6, 2025'): live and readable, but its table lists no company today, so nothing to search or verify",
    "DOT&PF 'Suspended Contractors' link (dot.alaska.gov/procurement/warrant_manual/): points to the federal EPLS (now SAM.gov), not a state list",
    "ArcGIS Online 'The Alaska General Contractors 2023 Layer' (AKDOT, services.arcgis.com/r4A0V7UzH9fcLVvv): one polyline layer 'AGC_FIGURES Events', no description and no license fields; not a license register",
  ],
};
