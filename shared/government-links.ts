/** Only a verified, active office may expose an outbound records link. */
export function governmentLinksAvailable(row: { isActive: boolean; linkStatus?: string | null }): boolean {
  return row.isActive && row.linkStatus === 'live';
}
