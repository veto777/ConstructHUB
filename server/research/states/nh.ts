/**
 * New Hampshire. Checked 2026-10-15: no source could be searched.
 *
 * New Hampshire licenses no general or home-improvement contractors statewide: the occupations title of its
 * statutes (RSA Title XXX, gc.nh.gov/rsa/html/NHTOC/NHTOC-XXX.htm) has chapters for electricians (319-C) and
 * plumbers (329-A) and none for contractors. The trade licenses are issued by the Office of Professional Licensure
 * and Certification, whose sites refuse our bot (below).
 */
import type { StatePack } from "./types";

export const pack: StatePack = {
  state: "NH",
  checked: "2026-10-15",
  noStatewideGcLicense: "New Hampshire does not license general or home-improvement contractors statewide; electricians and plumbers are licensed by the Office of Professional Licensure and Certification, whose license lookup could not be searched",
  blocked: [
    "OPLC license lookup (www.oplc.nh.gov/license-lookup, forms.nh.gov/licenseverification): HTTP 403 'Access Denied' (Akamai) to our bot, robots.txt included",
    "Every other nh.gov host tried (www.nh.gov, data.nh.gov, quickstart.sos.nh.gov business search, www.dol.nh.gov): HTTP 403 to our bot",
  ],
};
