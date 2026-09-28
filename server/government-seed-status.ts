/** Boot preserves newer verifier verdicts, including a dead URL already nulled. */
export function preserveNewerGovernmentCheck<T extends {
  portalUrl: string | null; searchUrl: string | null; linkStatus: string | null;
  isActive: boolean; lastVerifiedAt: Date | null;
}>(existing: T, incoming: Pick<T, 'portalUrl' | 'searchUrl' | 'linkStatus' | 'isActive' | 'lastVerifiedAt'>) {
  const newer = existing.lastVerifiedAt && (!incoming.lastVerifiedAt || existing.lastVerifiedAt > incoming.lastVerifiedAt);
  // Once a periodic verifier nulls the URL, equality cannot identify the rejected
  // candidate. Require a newer source check before making this office link active.
  if (newer && existing.linkStatus === 'dead' && !existing.portalUrl && !existing.searchUrl) {
    return { portalUrl: null, searchUrl: null, linkStatus: 'dead', isActive: false, lastVerifiedAt: existing.lastVerifiedAt };
  }
  if (existing.portalUrl === incoming.portalUrl && existing.searchUrl === incoming.searchUrl &&
      newer) {
    return { linkStatus: existing.linkStatus, isActive: existing.isActive, lastVerifiedAt: existing.lastVerifiedAt };
  }
  return { linkStatus: incoming.linkStatus, isActive: incoming.isActive, lastVerifiedAt: incoming.lastVerifiedAt };
}
