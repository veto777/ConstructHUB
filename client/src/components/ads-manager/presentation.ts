/** Display labels only; API values and saved change documents stay unchanged. */
export function adsStatusLabel(value?: string, severity = false): string {
  if (!value) return 'Unknown';
  if (severity) return ({ warning: 'Needs attention', info: 'Information', unknown: 'Could not be checked' } as Record<string, string>)[value] || sentenceCase(value);
  return ({ ENABLED: 'Enabled', preview: 'Ready for review', unknown: 'Outcome unknown', no_change: 'No changes needed' } as Record<string, string>)[value] || sentenceCase(value);
}

function sentenceCase(value: string): string {
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Translate known saved copy without hiding unfamiliar warnings. */
export function protectionText(text: string): string {
  return text
    .replace('Rotation uses ConstructHUB first-observed time (resource name breaks ties on initial import).', 'When space is needed, exclusions are removed in the order ConstructHUB first saw them. If several were first seen together, their Google resource names determine the order.')
    .replace(/rotate (\d+) oldest observed exclusions/g, (_, count: string) => Number(count) === 0
      ? 'keep all existing exclusions'
      : `remove ${count} exclusion${count === '1' ? '' : 's'} that ConstructHUB first saw earliest`);
}
