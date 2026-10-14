// Normalize a county name for matching NETR display names against the counties
// table (handles "St." vs "Saint", punctuation, "County"/"Parish" suffixes, case).
// Pure (no DB import) so tests can replay the appraiser seed's county join.
export function normCounty(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bst\.?\b/g, "saint")
    .replace(/\bste\.?\b/g, "sainte")
    .replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}
