/** A boot must not overwrite a newer verifier verdict for the same stored URL. */
export function preserveNewerGovernmentCheck<T extends {
  portalUrl: string | null; searchUrl: string | null; linkStatus: string | null;
  isActive: boolean; lastVerifiedAt: Date | null;
}>(existing: T, incoming: Pick<T, 'portalUrl' | 'searchUrl' | 'linkStatus' | 'isActive' | 'lastVerifiedAt'>) {
  if (existing.portalUrl === incoming.portalUrl && existing.searchUrl === incoming.searchUrl &&
      existing.lastVerifiedAt && (!incoming.lastVerifiedAt || existing.lastVerifiedAt > incoming.lastVerifiedAt)) {
    return { linkStatus: existing.linkStatus, isActive: existing.isActive, lastVerifiedAt: existing.lastVerifiedAt };
  }
  return { linkStatus: incoming.linkStatus, isActive: incoming.isActive, lastVerifiedAt: incoming.lastVerifiedAt };
}
