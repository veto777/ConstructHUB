const protectionLabels: Record<string, string> = {
  ip: 'Update blocked IP addresses',
  negative: 'Update negative keywords',
  presence: 'Target people in your campaign locations',
  schedule: 'Update ad schedules',
  suffix: 'Update tracking parameters',
  placement: 'Update excluded placements',
};

/** Describe saved changes, never infer counts from missing documents. */
export function protectionDescription(kind: string, document?: { operations?: any[] }, undoOf?: string | null): string {
  const label = protectionLabels[kind] || 'Update campaign protection';
  if (undoOf) return `Reverse protection changes: ${label[0].toLowerCase()}${label.slice(1)}`;
  if (!Array.isArray(document?.operations)) return label;
  const operations = document.operations;
  if (!operations.length) return 'Already configured — no changes needed';
  if (kind === 'ip') {
    const additions = operations.map(op => op.campaignCriterionOperation?.create).filter(op => op?.ipBlock?.ipAddress);
    const ips = new Set(additions.map(op => op.ipBlock.ipAddress));
    const campaigns = new Set(additions.map(op => op.campaign));
    if (ips.size && additions.every(op => op.campaign)) {
      const removals = operations.filter(op => op.campaignCriterionOperation?.remove).length;
      return `Block ${ips.size} IP${ips.size === 1 ? '' : 's'} on ${campaigns.size} campaign${campaigns.size === 1 ? '' : 's'}${removals ? `; remove ${removals} old exclusion${removals === 1 ? '' : 's'}` : ''}`;
    }
  }
  if (kind === 'presence') {
    const campaigns = new Set(operations.map(op => op.campaignOperation?.update?.resourceName).filter(Boolean));
    if (campaigns.size) return `Target people in your locations on ${campaigns.size} campaign${campaigns.size === 1 ? '' : 's'}`;
  }
  return label;
}

export function auditTitle(kind: string, title: string): string {
  const labels: Record<string, string> = { terms: 'Search terms', conversions: 'Conversion tracking', budgets: 'Campaign budgets', disapproved: 'Ad approval status', leads: 'Local Services Ads leads' };
  return title === `${kind}: unavailable` ? `${labels[kind] || 'This check'} could not be checked` : title;
}
