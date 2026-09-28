/** Office labels observed on NETR state/county listings, not invented titles.
 * Combined assessor/treasurer offices remain assessment offices; deed recorders do not.
 */
export function isAssessmentOffice(name: string): boolean {
  if (/historic aerials|netr mapping|mapping and gis|\bgis\b|clerk|recorder|register of deeds|sheriff/i.test(name)) return false;
  return /assess(?:or|ment|ing)|apprais(?:er|al)|property valuation|property lister|\blisters?\b|board of taxation|real property tax|tax administration|commissioner of revenue|revenue commission(?:er)?|tax commissioner|equalization|auditor/i.test(name);
}
