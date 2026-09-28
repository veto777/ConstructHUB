import { governmentFailureIsDead, isGenericGovernmentVendorUrl, isDedicatedGovernmentPortal } from './government-url-check';

export type GovernmentLinkTier = 'verified' | 'unconfirmed' | 'dead' | 'none';
export interface LinkEvidence {
  status?: string; reason?: string; httpStatus?: number | null; finalUrl?: string | null;
  title?: string; excerpt?: string; text?: string; jurisdictionMatched?: boolean;
  linkedFromSource?: boolean; checkedAt?: string;
}
const normalize = (value: string) => value.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');

/** Shared state portals need agency identity, not an individual county's name.
 * Restrict this exception to documented agencies and to source-listed county links.
 */
export function statewideAgencyMatches(url: string, state: string, text: string): boolean {
  const host = new URL(url).hostname;
  if (state === 'MD' && host === 'sdat.dat.maryland.gov') return /Maryland|SDAT/i.test(text) && /real property|assessments and taxation/i.test(text);
  if (state === 'MT' && host === 'svc.mt.gov') return /Montana Department of Revenue|Property\.MT\.Gov/i.test(text) && /property|assessment/i.test(text);
  if (state === 'TN' && /(^|\.)tn\.gov$/.test(host)) return /Tennessee|TN Comptroller/i.test(text) && /Comptroller|Division of Property Assessments/i.test(text);
  return false;
}

/** Source provenance is mandatory: an unknown URL never becomes a public link. */
export function classifySourceListedLink(url: string | null, check: LinkEvidence | undefined, identity: { state: string; jurisdiction: string; sourceListed: boolean }): GovernmentLinkTier {
  if (!url) return 'none';
  if (!identity.sourceListed) throw new Error('Government URL has no source evidence');
  const reason = check?.reason || '';
  const tenantHome = reason === 'generic homepage; department URL required' && isDedicatedGovernmentPortal(check?.finalUrl || url);
  if (isGenericGovernmentVendorUrl(url) || (check?.finalUrl && /^https?:/.test(check.finalUrl) && isGenericGovernmentVendorUrl(check.finalUrl)) ||
      (check?.status === 'dead' && !tenantHome) || [404, 410].includes(check?.httpStatus || 0) || governmentFailureIsDead(reason) ||
      (!tenantHome && /generic homepage; department URL required/.test(reason)) || /parked|for.sale|soft 404/.test(reason)) return 'dead';
  const text = [check?.title, check?.excerpt, check?.text].filter(Boolean).join(' ');
  const jurisdiction = normalize(identity.jurisdiction.replace(/\s*\([^)]*\)/g, '').replace(/\b(county|parish|borough|municipality|city and borough)\b/gi, '').trim());
  const onTopic = tenantHome || check?.status === 'live' || check?.status === 'verified' || /does not identify expected jurisdiction/.test(reason);
  if (onTopic && (!check?.httpStatus || check.httpStatus < 400) && (check?.jurisdictionMatched || check?.linkedFromSource ||
      (jurisdiction.length > 2 && normalize(text).includes(jurisdiction)) || statewideAgencyMatches(check?.finalUrl || url, identity.state, text))) return 'verified';
  return 'unconfirmed';
}
