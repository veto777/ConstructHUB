/** Only a verified, active office may expose an outbound records link. */
export function governmentLinksAvailable(row: { isActive: boolean; linkStatus?: string | null }): boolean {
  return row.isActive && row.linkStatus === 'live';
}

export function governmentLinksForDisplay<T extends { isActive: boolean; linkStatus?: string | null; portalUrl: string | null; searchUrl: string | null }>(row: T): T {
  return governmentLinksAvailable(row) ? row : { ...row, portalUrl: null, searchUrl: null };
}
