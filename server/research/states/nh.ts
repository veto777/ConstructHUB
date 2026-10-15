/**
 * New Hampshire. Checked again 2026-10-15: no source could be searched.
 *
 * New Hampshire licenses no general or home-improvement contractors statewide: the occupations title of its
 * statutes (RSA Title XXX, gc.nh.gov/rsa/html/NHTOC/NHTOC-XXX.htm) has chapters for electricians (319-C) and
 * plumbers (329-A) and none for contractors. The trade licenses are issued by the Office of Professional Licensure
 * and Certification. Every state host that publishes license, roster, open-data or disciplinary records answers our
 * bot (its honest User-Agent, ../../scrapers/polite-fetch.ts) with an Akamai "Access Denied" page and HTTP 403, its
 * robots.txt included (below); gc.nh.gov (the legislature) is the only nh.gov host that answered.
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "NH",
  checked: "2026-10-15",
  noStatewideGcLicense: "New Hampshire does not license general or home-improvement contractors statewide; electricians and plumbers are licensed by the Office of Professional Licensure and Certification, whose license lookup could not be searched",
  blocked: [
    "OPLC license lookup and board pages (www.oplc.nh.gov/license-lookup, www.oplc.nh.gov/electricians-board, forms.nh.gov/licenseverification): HTTP 403 \"Access Denied\" (Akamai, \"You don't have permission to access … on this server\") to our bot on 2026-10-15, robots.txt included, so no lookup, roster or board disciplinary decisions can be read",
    "NH open data (data.nh.gov): HTTP 403 to our bot on 2026-10-15; its datasets were not looked for through another host",
    "Every other nh.gov host tried on 2026-10-15 (www.nh.gov, www.des.nh.gov, www.doj.nh.gov, www.courts.nh.gov, www.dol.nh.gov, www.nhes.nh.gov, www.revenue.nh.gov, www.sos.nh.gov, quickstart.sos.nh.gov business search): HTTP 403 to our bot; sos.nh.gov answered HTTP 503",
  ],
};
